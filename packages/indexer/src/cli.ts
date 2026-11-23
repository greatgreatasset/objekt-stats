import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectTradesFromTransfers } from "@objekt-stats/stats";
import { stringify as stringifyYaml } from "yaml";
import { aggregateAndEmitSql, inferAutoRoundGroup } from "./aggregate.js";
import {
  getAbstractHeadBlock,
  syncAbstractLogs,
  turboSyncAbstractLogs,
} from "./chains/abstract.js";
import {
  syncPolygonArchive,
  turboSyncPolygonArchive,
} from "./chains/polygon.js";
import {
  ABSTRACT_START_BLOCK,
  POLYGON_END_BLOCK,
  POLYGON_START_BLOCK,
} from "./constants.js";
import {
  fetchCosmoTokenMetadata,
  fetchCosmoTokenMetadataFast,
  type NormalizedTokenMetadata,
} from "./cosmo-metadata.js";
import { IndexerStore } from "./store.js";

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.set(key, next);
        i++;
      } else {
        args.set(key, "true");
      }
    } else {
      positional.push(token);
    }
  }
  return { command: positional[0] ?? "status", args };
}

async function resolveSpecificTokenIds(
  store: IndexerStore,
  tokenIds: number[],
  concurrency: number,
  label = "tokens",
) {
  if (tokenIds.length === 0) {
    console.log(`✓ No unresolved ${label} remaining.`);
    return { okCount: 0, missingCount: 0, errCount: 0 };
  }

  console.log(
    `Resolving metadata for ${tokenIds.length.toLocaleString()} ${label} (concurrency=${concurrency})...`,
  );

  const startedAt = Date.now();
  let idx = 0;
  let okCount = 0;
  let missingCount = 0;
  let errCount = 0;
  let consecutiveErrs = 0;
  let bufferOk: NormalizedTokenMetadata[] = [];
  let bufferMissing: number[] = [];

  const flush = () => {
    if (bufferOk.length > 0) {
      store.upsertMetadataBatch(bufferOk);
      bufferOk = [];
    }
    if (bufferMissing.length > 0) {
      store.markMissingMetadata(bufferMissing);
      bufferMissing = [];
    }
  };

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (idx < tokenIds.length) {
        const myIndex = idx++;
        const tokenId = tokenIds[myIndex]!;
        try {
          const meta = await fetchCosmoTokenMetadata(tokenId);
          consecutiveErrs = 0;
          if (meta) {
            bufferOk.push(meta);
            okCount++;
          } else {
            bufferMissing.push(tokenId);
            missingCount++;
          }
        } catch (err) {
          errCount++;
          consecutiveErrs++;
          if (errCount <= 10) {
            console.warn(`! token ${tokenId} failed:`, (err as Error).message);
          }
          if (consecutiveErrs >= 15) {
            await new Promise((r) => setTimeout(r, 2000));
            consecutiveErrs = 0;
          }
        }

        if (bufferOk.length + bufferMissing.length >= 500) {
          flush();
          const done = okCount + missingCount + errCount;
          const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
          const rps = Math.round(done / elapsedSec);
          const etaSec = rps > 0 ? Math.round((tokenIds.length - done) / rps) : 0;
          console.log(
            `  progress: ${done.toLocaleString()}/${tokenIds.length.toLocaleString()} (${rps} req/s, ETA ${etaSec}s, ok=${okCount}, 404=${missingCount}, err=${errCount})`,
          );
        }
      }
    }),
  );

  flush();
  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `✓ Resolved ${okCount.toLocaleString()} ${label} (+${missingCount} 404, ${errCount} errors) in ${totalSec}s`,
  );
  return { okCount, missingCount, errCount };
}

async function resolveMetadataBatch(
  store: IndexerStore,
  limit: number,
  concurrency: number,
  order: "newest" | "oldest",
) {
  const pending = store.getUnresolvedTokenIds(limit, order);
  return resolveSpecificTokenIds(store, pending, concurrency, `mint tokens (${order})`);
}

async function turboResolveMetadata(
  store: IndexerStore,
  options: {
    limit: number;
    batchSize: number;
    startConc: number;
    maxConc: number;
    minConc: number;
    order: "newest" | "oldest";
    chain?: "polygon" | "abstract";
  },
) {
  let targetConc = options.startConc;
  let totalResolved = 0;
  let totalMissing = 0;
  let totalRetries = 0;
  const startedAll = Date.now();
  const initialRemaining = store.countUnresolvedMints(options.chain);

  console.log(
    `Turbo AIMD metadata resolver starting: remaining=${initialRemaining.toLocaleString()}, limit=${options.limit.toLocaleString()}, startConc=${targetConc}, maxConc=${options.maxConc}, order=${options.order}${options.chain ? `, chain=${options.chain}` : ""}`,
  );

  while (totalResolved + totalMissing < options.limit) {
    const remainingBudget = options.limit - (totalResolved + totalMissing);
    const pending = store.getUnresolvedTokenIds(
      Math.min(options.batchSize, remainingBudget),
      options.order,
      options.chain,
    );
    if (pending.length === 0) {
      console.log("✓ 100% of mint tokens resolved! Zero unresolved remaining.");
      break;
    }

    // Queue of { tokenId, attempts } so transient 502/429s are ALWAYS retried cleanly
    const queue: Array<{ tokenId: number; attempts: number }> = pending.map((tokenId) => ({
      tokenId,
      attempts: 0,
    }));
    let qHead = 0;
    let inFlight = 0;
    let batchOk = 0;
    let batchMissing = 0;
    let batchRetry = 0;
    let windowDone = 0;
    let windowRetry = 0;
    let cooldownUntil = 0;
    let bufferOk: NormalizedTokenMetadata[] = [];
    let bufferMissing: number[] = [];

    const flush = () => {
      if (bufferOk.length > 0) {
        store.upsertMetadataBatch(bufferOk);
        bufferOk = [];
      }
      if (bufferMissing.length > 0) {
        store.markMissingMetadata(bufferMissing);
        bufferMissing = [];
      }
    };

    const batchStart = Date.now();

    await new Promise<void>((resolveBatch) => {
      const checkDone = () => {
        if (qHead >= queue.length && inFlight === 0) {
          flush();
          resolveBatch();
          return true;
        }
        return false;
      };

      const pump = () => {
        if (checkDone()) return;
        const now = Date.now();
        if (now < cooldownUntil) {
          setTimeout(pump, Math.max(50, cooldownUntil - now));
          return;
        }

        while (inFlight < targetConc && qHead < queue.length) {
          const item = queue[qHead++]!;
          inFlight++;
          fetchCosmoTokenMetadataFast(item.tokenId)
            .then((res) => {
              windowDone++;
              if (res.kind === "ok") {
                bufferOk.push(res.meta);
                batchOk++;
                totalResolved++;
              } else if (res.kind === "missing") {
                bufferMissing.push(item.tokenId);
                batchMissing++;
                totalMissing++;
              } else {
                batchRetry++;
                totalRetries++;
                windowRetry++;
                if (res.status === 429) {
                  targetConc = Math.max(options.minConc, Math.floor(targetConc * 0.65));
                  cooldownUntil = Math.max(cooldownUntil, Date.now() + 1500);
                }
                if (item.attempts < 8) {
                  queue.push({ tokenId: item.tokenId, attempts: item.attempts + 1 });
                }
              }

              // AIMD controller check every 2,000 responses
              if (windowDone >= 2_000) {
                const errRate = windowRetry / windowDone;
                if (errRate > 0.015) {
                  targetConc = Math.max(options.minConc, Math.floor(targetConc * 0.75));
                  cooldownUntil = Math.max(cooldownUntil, Date.now() + 800);
                } else if (errRate < 0.002 && targetConc < options.maxConc) {
                  targetConc = Math.min(options.maxConc, targetConc + 25);
                }
                windowDone = 0;
                windowRetry = 0;
              }

              if (bufferOk.length + bufferMissing.length >= 5_000) {
                flush();
                const elapsedSec = Math.max(0.5, (Date.now() - startedAll) / 1000);
                const doneAll = totalResolved + totalMissing;
                const rps = Math.round(doneAll / elapsedSec);
                const left = Math.max(0, Math.min(initialRemaining, options.limit) - doneAll);
                const etaMin = rps > 0 ? (left / rps / 60).toFixed(1) : "?";
                console.log(
                  `  resolved ${doneAll.toLocaleString()}/${Math.min(initialRemaining, options.limit).toLocaleString()} | ${rps} req/s | conc=${targetConc} | retries=${totalRetries} | ETA ${etaMin}m`,
                );
              }
            })
            .finally(() => {
              inFlight--;
              if (!checkDone()) {
                pump();
              }
            });
        }
      };

      pump();
    });

    const batchSec = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(
      `✓ Batch complete: +${batchOk.toLocaleString()} ok, +${batchMissing} 404, ${batchRetry} retries in ${batchSec}s (conc=${targetConc})`,
    );
  }

  const totalSec = ((Date.now() - startedAll) / 1000).toFixed(1);
  console.log(
    `✓ Turbo resolve done: ${totalResolved.toLocaleString()} ok, ${totalMissing} 404, ${totalRetries} retries in ${totalSec}s`,
  );
}

function exportRoundsDraftYaml(store: IndexerStore, rootDir: string) {
  const rows = store.db
    .prepare(
      `SELECT
        tm.artist_id,
        tm.season,
        tm.objekt_class,
        tm.collection_no,
        tm.on_offline,
        COUNT(*) AS mints,
        COUNT(DISTINCT tm.raw_member) AS member_count,
        MIN(rm.minted_at) AS first_mint_at,
        MAX(rm.minted_at) AS last_mint_at
      FROM token_metadata tm
      JOIN raw_mints rm ON rm.token_id = tm.token_id
      WHERE tm.artist_id IN ('triples', 'artms')
      GROUP BY tm.artist_id, tm.season, tm.objekt_class, tm.collection_no, tm.on_offline`,
    )
    .all() as Array<{
    artist_id: "triples" | "artms";
    season: string;
    objekt_class: string;
    collection_no: string;
    on_offline: "online" | "offline";
    mints: number;
    member_count: number;
    first_mint_at: string;
    last_mint_at: string;
  }>;

  const grouped = new Map<
    string,
    {
      artistId: "triples" | "artms";
      slug: string;
      title: string;
      season: string;
      objektClass: string;
      onOffline: "online" | "offline";
      saleMechanic: string;
      includeInPopularity: boolean;
      unitPriceUsd: number | null;
      startAt: string;
      endAt: string;
      collectionNos: Set<string>;
      totalMints: number;
      maxMembers: number;
    }
  >();

  for (const row of rows) {
    const auto = inferAutoRoundGroup(
      row.artist_id,
      row.season,
      row.objekt_class,
      row.collection_no,
      row.on_offline,
    );
    let acc = grouped.get(auto.slug);
    if (!acc) {
      acc = {
        artistId: row.artist_id,
        slug: auto.slug,
        title: auto.title,
        season: row.season,
        objektClass: row.objekt_class,
        onOffline: row.on_offline,
        saleMechanic: auto.saleMechanic,
        includeInPopularity: auto.includeInPopularity,
        unitPriceUsd: auto.unitPriceUsd,
        startAt: row.first_mint_at,
        endAt: row.last_mint_at,
        collectionNos: new Set(),
        totalMints: 0,
        maxMembers: 0,
      };
      grouped.set(auto.slug, acc);
    }
    acc.collectionNos.add(row.collection_no);
    acc.totalMints += row.mints;
    acc.maxMembers = Math.max(acc.maxMembers, row.member_count);
    if (row.first_mint_at < acc.startAt) acc.startAt = row.first_mint_at;
    if (row.last_mint_at > acc.endAt) acc.endAt = row.last_mint_at;
  }

  for (const artistId of ["triples", "artms"] as const) {
    const artistRounds = Array.from(grouped.values())
      .filter((r) => r.artistId === artistId && r.maxMembers >= 2 && r.totalMints >= 20)
      .sort((a, b) => b.totalMints - a.totalMints)
      .slice(0, 40)
      .map((r) => ({
        slug: r.slug,
        title: r.title,
        season: r.season,
        objektClass: r.objektClass,
        onOffline: r.onOffline,
        saleMechanic: r.saleMechanic,
        startAt: r.startAt.slice(0, 10),
        endAt: r.endAt.slice(0, 10),
        ...(r.unitPriceUsd !== null ? { unitPriceUsd: r.unitPriceUsd } : {}),
        includeInPopularity: r.includeInPopularity,
        collectionMatchers: {
          seasons: [r.season],
          collectionNos: Array.from(r.collectionNos).sort(),
        },
      }));

    const outDir = resolve(rootDir, `data/rounds/${artistId}`);
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, "auto-discovered.yaml");
    writeFileSync(
      outPath,
      `# Auto-discovered top sale rounds from on-chain data (curate titles/mechanics freely)\n` +
        stringifyYaml({ artistId, rounds: artistRounds }),
      "utf8",
    );
    console.log(`✓ Exported ${artistRounds.length} rounds to ${outPath}`);
  }
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  const rootDir = resolve(import.meta.dirname, "../../..");
  const dbPath = args.get("db") ?? resolve(rootDir, "data/raw/indexer.sqlite");
  const store = new IndexerStore(dbPath);

  try {
    if (command === "status") {
      const counts = store.getSummaryCounts();
      const ranges = store.db
        .prepare(
          `SELECT chain, COUNT(*) AS cnt, MIN(block_number) AS min_b, MAX(block_number) AS max_b,
                  MIN(minted_at) AS min_t, MAX(minted_at) AS max_t
           FROM raw_mints GROUP BY chain`,
        )
        .all();
      const transferRanges = store.db
        .prepare(
          `SELECT chain, COUNT(*) AS cnt, MIN(block_number) AS min_b, MAX(block_number) AS max_b,
                  MIN(transferred_at) AS min_t, MAX(transferred_at) AS max_t
           FROM raw_transfers GROUP BY chain`,
        )
        .all();
      const unresolvedCount = store.countUnresolvedMints();
      const abstractSynced = store.getMergedSyncedRanges("abstract", "mints");
      const polygonSynced = store.getMergedSyncedRanges("polygon", "mints");
      const polyBlocks = polygonSynced.reduce((s, r) => s + (r.toBlock - r.fromBlock + 1), 0);
      const absBlocks = abstractSynced.reduce((s, r) => s + (r.toBlock - r.fromBlock + 1), 0);

      console.log("Indexer SQLite:", store.dbPath);
      console.log("Counts:", { ...counts, unresolvedMints: unresolvedCount });
      console.log("Mint chain ranges:", ranges);
      console.log("Transfer chain ranges:", transferRanges);
      console.log("Synced mint block coverage:", {
        abstractBlocks: absBlocks,
        abstractRanges: abstractSynced.length,
        polygonBlocks: polyBlocks,
        polygonRanges: polygonSynced.length,
        polygonPctOfGenesisToMigration: Number(
          ((polyBlocks / (POLYGON_END_BLOCK - POLYGON_START_BLOCK + 1)) * 100).toFixed(2),
        ),
      });
      console.log("Cursors:", {
        abstract: store.getCursor("abstract:last_block"),
        abstractTransfers: store.getCursor("abstract:transfers_last_block"),
        abstractBackfillMin: store.getCursor("abstract:backfill_min_block"),
        polygon: store.getCursor("polygon:last_block"),
        polygonTransfers: store.getCursor("polygon:transfers_last_block"),
      });
      return;
    }

    if (command === "turbo-sync-abstract") {
      const head = await getAbstractHeadBlock();
      const fromBlock = Number(args.get("from") ?? String(ABSTRACT_START_BLOCK));
      const toBlock = Number(args.get("to") ?? String(head));
      const chunkSize = Number(args.get("chunk") ?? "5000");
      const parallelism = Number(args.get("parallel") ?? "10");
      const includeSpins = args.get("spins") !== "false";
      const direction =
        args.get("direction") === "oldest-first" ? "oldest-first" : "newest-first";

      console.log(
        `Turbo Abstract log sync: ${fromBlock.toLocaleString()} → ${toBlock.toLocaleString()} (head=${head.toLocaleString()}, parallel=${parallelism}, chunk=${chunkSize.toLocaleString()}, spins=${includeSpins}, dir=${direction})`,
      );
      const res = await turboSyncAbstractLogs(store, {
        fromBlock,
        toBlock,
        chunkSize,
        parallelism,
        includeSpins,
        direction,
        onProgress: ({
          doneChunks,
          totalChunks,
          blocksSynced,
          totalBlocks,
          mintsAdded,
          spinsAdded,
          blocksPerSec,
        }) => {
          const pct = ((blocksSynced / Math.max(1, totalBlocks)) * 100).toFixed(1);
          const etaMin =
            blocksPerSec > 0
              ? (((totalBlocks - blocksSynced) / blocksPerSec) / 60).toFixed(1)
              : "?";
          console.log(
            `  [abstract] ${pct}% (${doneChunks}/${totalChunks}) | ${blocksPerSec.toLocaleString()} blk/s | +${mintsAdded.toLocaleString()} mints, +${spinsAdded.toLocaleString()} spins | ETA ${etaMin}m`,
          );
        },
      });
      console.log("✓ Turbo Abstract log sync complete:", res);
      return;
    }

    if (command === "turbo-sync-polygon") {
      const fromBlock = Number(args.get("from") ?? String(POLYGON_START_BLOCK));
      const toBlock = Number(args.get("to") ?? String(POLYGON_END_BLOCK));
      const chunkSize = Number(args.get("chunk") ?? "100000");
      const includeSpins = args.get("spins") !== "false";

      console.log(
        `Turbo Polygon SQD archive sync (tripleS + ARTMS): ${fromBlock.toLocaleString()} → ${toBlock.toLocaleString()} (chunk=${chunkSize.toLocaleString()}, spins=${includeSpins})`,
      );
      const res = await turboSyncPolygonArchive(store, {
        fromBlock,
        toBlock,
        chunkSize,
        includeSpins,
        onProgress: ({
          block,
          blocksSynced,
          totalBlocks,
          mintsAdded,
          spinsAdded,
          chunkSize: cs,
        }) => {
          const pct = ((blocksSynced / Math.max(1, totalBlocks)) * 100).toFixed(1);
          console.log(
            `  [polygon] ${pct}% @ block ${block.toLocaleString()} (chunk=${cs.toLocaleString()}) | +${mintsAdded.toLocaleString()} mints, +${spinsAdded.toLocaleString()} spins`,
          );
        },
      });
      console.log("✓ Turbo Polygon archive sync complete:", res);
      return;
    }

    if (command === "turbo-resolve") {
      const chainArg = args.get("chain");
      await turboResolveMetadata(store, {
        limit: Number(args.get("limit") ?? "100000000"),
        batchSize: Number(args.get("batch") ?? "50000"),
        startConc: Number(args.get("start-conc") ?? "350"),
        maxConc: Number(args.get("max-conc") ?? "520"),
        minConc: Number(args.get("min-conc") ?? "40"),
        order: args.get("order") === "oldest" ? "oldest" : "newest",
        chain:
          chainArg === "polygon" || chainArg === "abstract" ? chainArg : undefined,
      });
      return;
    }

    if (command === "merge-db") {
      const sourceArg = args.get("source");
      if (!sourceArg) {
        throw new Error("merge-db requires --source <path-to-sqlite>");
      }
      const sourcePath = resolve(rootDir, sourceArg).replace(/'/g, "''");
      console.log(`Merging ${sourcePath} into ${store.dbPath}...`);
      store.db.exec(`ATTACH DATABASE '${sourcePath}' AS src;`);
      store.db.exec("BEGIN");
      try {
        store.db.exec(`
          INSERT INTO raw_mints (token_id, chain, block_number, minted_at, minter, tx_hash)
          SELECT token_id, chain, block_number, minted_at, minter, tx_hash FROM src.raw_mints
          ON CONFLICT(token_id) DO UPDATE SET
            chain        = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.chain        ELSE raw_mints.chain END,
            block_number = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.block_number ELSE raw_mints.block_number END,
            minted_at    = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.minted_at    ELSE raw_mints.minted_at END,
            minter       = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.minter       ELSE raw_mints.minter END,
            tx_hash      = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.tx_hash      ELSE raw_mints.tx_hash END;

          INSERT OR IGNORE INTO raw_spins (tx_hash, log_index, token_id, chain, block_number, spun_at)
          SELECT tx_hash, log_index, token_id, chain, block_number, spun_at FROM src.raw_spins;

          INSERT OR REPLACE INTO synced_ranges (chain, kind, from_block, to_block, synced_at)
          SELECT chain, kind, from_block, to_block, synced_at FROM src.synced_ranges;
        `);
        store.db.exec("COMMIT");
      } catch (err) {
        store.db.exec("ROLLBACK");
        throw err;
      } finally {
        store.db.exec("DETACH DATABASE src;");
      }
      store.compactSyncedRanges("polygon", "mints");
      store.compactSyncedRanges("abstract", "mints");
      console.log("✓ Merge complete. New counts:", store.getSummaryCounts());
      return;
    }

    if (command === "sync-transfers") {
      // Backfills P2P user-to-user transfers ONLY (never writes to raw_mints) and resolves
      // COSMO metadata for all tokens involved in confirmed reciprocal trades first.
      const head = await getAbstractHeadBlock();
      const existingRange = store.db
        .prepare(
          "SELECT MIN(block_number) AS min_b, MAX(block_number) AS max_b FROM raw_mints WHERE chain = 'abstract'",
        )
        .get() as { min_b: number | null; max_b: number | null };

      const blocksArg = args.get("blocks");
      const toBlock = args.get("to")
        ? Number(args.get("to"))
        : blocksArg
          ? head
          : (existingRange.max_b ?? head);
      const fromBlock = args.get("from")
        ? Number(args.get("from"))
        : blocksArg
          ? Math.max(ABSTRACT_START_BLOCK, toBlock - Number(blocksArg))
          : (existingRange.min_b ?? Math.max(ABSTRACT_START_BLOCK, head - 50_000));

      console.log(
        `Syncing Abstract P2P transfers ONLY: ${fromBlock.toLocaleString()} → ${toBlock.toLocaleString()}...`,
      );
      const res = await syncAbstractLogs(store, {
        fromBlock,
        toBlock,
        chunkSize: Number(args.get("chunk") ?? "3000"),
        includeTransfers: true,
        transfersOnly: true,
        onProgress: ({ block, transfersAdded }) => {
          console.log(
            `  block ${block.toLocaleString()} | +${transfersAdded} P2P transfers`,
          );
        },
      });
      console.log("✓ Abstract P2P transfer sync complete:", res);

      if (args.get("resolve") !== "false") {
        const allTransfers = store.getAllTransfers();
        const detected = detectTradesFromTransfers(
          allTransfers.map((t) => ({
            txHash: t.txHash,
            logIndex: t.logIndex,
            chain: t.chain,
            blockNumber: t.blockNumber,
            transferredAt: t.transferredAt,
            from: t.fromAddr,
            to: t.toAddr,
            tokenId: t.tokenId,
          })),
        );
        const tradedTokenIds = Array.from(
          new Set(detected.trades.flatMap((tr) => tr.allLegs.map((l) => l.tokenId))),
        );
        console.log(
          `Detected ${detected.trades.length.toLocaleString()} confirmed trades (${tradedTokenIds.length.toLocaleString()} unique tokens) across ${detected.eligibleTransfers.length.toLocaleString()} P2P transfers.`,
        );

        const concurrency = Number(args.get("concurrency") ?? "40");
        const limit = Number(args.get("limit") ?? "50000");
        const unresolvedTraded = store.getUnresolvedTokenIdsFromList(
          tradedTokenIds,
          limit,
        );
        await resolveSpecificTokenIds(
          store,
          unresolvedTraded,
          concurrency,
          "confirmed-trade tokens",
        );

        if (args.get("resolve-all-transfers") === "true") {
          const remaining = store.getUnresolvedTransferTokenIds(limit, "newest");
          await resolveSpecificTokenIds(
            store,
            remaining,
            concurrency,
            "all P2P transfer tokens",
          );
        }
      }
      return;
    }

    if (command === "sync-abstract") {
      const head = await getAbstractHeadBlock();
      const blocksArg = args.get("blocks");
      const fromArg = args.get("from");
      const toArg = args.get("to");

      const toBlock = toArg ? Number(toArg) : head;
      let fromBlock: number;
      if (fromArg) {
        fromBlock = Number(fromArg);
      } else if (blocksArg) {
        fromBlock = Math.max(ABSTRACT_START_BLOCK, toBlock - Number(blocksArg));
      } else {
        const saved = store.getCursor("abstract:last_block");
        fromBlock = saved ? Number(saved) + 1 : Math.max(ABSTRACT_START_BLOCK, head - 25_000);
      }

      console.log(
        `Syncing Abstract blocks ${fromBlock.toLocaleString()} → ${toBlock.toLocaleString()} (head=${head.toLocaleString()})...`,
      );
      const res = await syncAbstractLogs(store, {
        fromBlock,
        toBlock,
        chunkSize: Number(args.get("chunk") ?? "3000"),
        includeTransfers: args.get("transfers") !== "false",
        onProgress: ({ block, mintsAdded, spinsAdded, transfersAdded }) => {
          console.log(
            `  block ${block.toLocaleString()} | +${mintsAdded} mints, +${spinsAdded} spins, +${transfersAdded} P2P transfers`,
          );
        },
      });
      console.log("✓ Abstract log sync complete:", res);

      if (args.get("resolve") !== "false") {
        await resolveMetadataBatch(
          store,
          Number(args.get("limit") ?? "20000"),
          Number(args.get("concurrency") ?? "35"),
          "newest",
        );
        if (args.get("transfers") !== "false") {
          const detected = detectTradesFromTransfers(
            store.getAllTransfers().map((t) => ({
              txHash: t.txHash,
              logIndex: t.logIndex,
              chain: t.chain,
              blockNumber: t.blockNumber,
              transferredAt: t.transferredAt,
              from: t.fromAddr,
              to: t.toAddr,
              tokenId: t.tokenId,
            })),
          );
          const tradedIds = detected.trades.flatMap((tr) =>
            tr.allLegs.map((l) => l.tokenId),
          );
          const unresolvedTraded = store.getUnresolvedTokenIdsFromList(
            tradedIds,
            Number(args.get("limit") ?? "20000"),
          );
          await resolveSpecificTokenIds(
            store,
            unresolvedTraded,
            Number(args.get("concurrency") ?? "35"),
            "confirmed-trade tokens",
          );
        }
      }
      return;
    }

    if (command === "backfill-abstract") {
      // Walks backwards from the oldest synced Abstract block in clean resumable windows
      const head = await getAbstractHeadBlock();
      const totalBlocks = Number(args.get("blocks") ?? "200000");
      const windowSize = Number(args.get("window") ?? "25000");
      const concurrency = Number(args.get("concurrency") ?? "40");
      const resolvePerWindow = args.get("resolve") !== "false";

      const existingMinRow = store.db
        .prepare("SELECT MIN(block_number) AS min_b FROM raw_mints WHERE chain = 'abstract'")
        .get() as { min_b: number | null };

      let upperBlock = args.get("to")
        ? Number(args.get("to"))
        : existingMinRow.min_b
          ? existingMinRow.min_b - 1
          : head;

      const targetLowerBlock = Math.max(
        ABSTRACT_START_BLOCK,
        args.get("from") ? Number(args.get("from")) : upperBlock - totalBlocks,
      );

      console.log(
        `Deep Abstract backwards backfill: ${upperBlock.toLocaleString()} → ${targetLowerBlock.toLocaleString()} (${(upperBlock - targetLowerBlock).toLocaleString()} blocks, window=${windowSize.toLocaleString()}, conc=${concurrency})`,
      );

      while (upperBlock > targetLowerBlock) {
        const lowerBlock = Math.max(targetLowerBlock, upperBlock - windowSize + 1);
        console.log(
          `\n--- Window ${lowerBlock.toLocaleString()} → ${upperBlock.toLocaleString()} ---`,
        );
        const logRes = await syncAbstractLogs(store, {
          fromBlock: lowerBlock,
          toBlock: upperBlock,
          chunkSize: 3_000,
          includeTransfers: args.get("transfers") !== "false",
          onProgress: ({ block, mintsAdded, spinsAdded, transfersAdded }) => {
            console.log(
              `  block ${block.toLocaleString()} | +${mintsAdded} mints, +${spinsAdded} spins, +${transfersAdded} P2P transfers`,
            );
          },
        });
        store.setCursor("abstract:backfill_min_block", String(lowerBlock));
        console.log(
          `✓ Window logs done: +${logRes.totalMints.toLocaleString()} mints, +${logRes.totalSpins.toLocaleString()} spins, +${logRes.totalTransfers.toLocaleString()} P2P transfers`,
        );

        if (resolvePerWindow) {
          await resolveMetadataBatch(store, 100_000, concurrency, "newest");
        }
        upperBlock = lowerBlock - 1;
      }

      // Catch up forward head too so cursor stays fresh
      const latestRow = store.db
        .prepare("SELECT MAX(block_number) AS max_b FROM raw_mints WHERE chain = 'abstract'")
        .get() as { max_b: number | null };
      if (latestRow.max_b) {
        store.setCursor("abstract:last_block", String(latestRow.max_b));
      }
      console.log("✓ Deep Abstract backfill target complete.");
      return;
    }

    if (command === "sync-polygon") {
      const fromBlock = Number(args.get("from") ?? String(POLYGON_START_BLOCK));
      const toBlock = Number(args.get("to") ?? "70500000");
      console.log(
        `Syncing Polygon SQD archive blocks ${fromBlock.toLocaleString()} → ${toBlock.toLocaleString()}...`,
      );
      const res = await syncPolygonArchive(store, {
        fromBlock,
        toBlock,
        chunkSize: Number(args.get("chunk") ?? "100000"),
        includeTransfers: args.get("transfers") !== "false",
        onProgress: ({ block, mintsAdded, spinsAdded, transfersAdded }) => {
          console.log(
            `  polygon block ${block.toLocaleString()} | +${mintsAdded} mints, +${spinsAdded} spins, +${transfersAdded} P2P transfers`,
          );
        },
      });
      console.log("✓ Polygon archive sync complete:", res);
      if (args.get("resolve") === "true") {
        await resolveMetadataBatch(
          store,
          Number(args.get("limit") ?? "20000"),
          Number(args.get("concurrency") ?? "35"),
          "oldest",
        );
      }
      return;
    }

    if (command === "resolve") {
      await resolveMetadataBatch(
        store,
        Number(args.get("limit") ?? "50000"),
        Number(args.get("concurrency") ?? "40"),
        args.get("order") === "oldest" ? "oldest" : "newest",
      );
      return;
    }

    if (command === "export-rounds-draft") {
      exportRoundsDraftYaml(store, rootDir);
      return;
    }

    if (command === "aggregate") {
      const summary = aggregateAndEmitSql(store, {
        dataRoot: resolve(rootDir, "data"),
        outFile: resolve(rootDir, "packages/db/generated/sync-onchain.sql"),
        tradesOutFile: resolve(rootDir, "packages/db/generated/sync-trades.sql"),
        snapshotFile: resolve(rootDir, "packages/db/generated/snapshot-summary.json"),
      });
      console.log("✓ Aggregation complete:", summary);
      return;
    }

    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error("Indexer error:", err);
  process.exitCode = 1;
});
