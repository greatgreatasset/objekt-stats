import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { aggregateAndEmitSql, inferAutoRoundGroup } from "./aggregate.js";
import { getAbstractHeadBlock, syncAbstractLogs } from "./chains/abstract.js";
import { syncPolygonArchive } from "./chains/polygon.js";
import { ABSTRACT_START_BLOCK, POLYGON_START_BLOCK } from "./constants.js";
import {
  fetchCosmoTokenMetadata,
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

async function resolveMetadataBatch(
  store: IndexerStore,
  limit: number,
  concurrency: number,
  order: "newest" | "oldest",
) {
  const pending = store.getUnresolvedTokenIds(limit, order);
  if (pending.length === 0) {
    console.log("✓ No unresolved tokens remaining.");
    return { okCount: 0, missingCount: 0, errCount: 0 };
  }

  console.log(
    `Resolving metadata for ${pending.length.toLocaleString()} tokens (concurrency=${concurrency}, order=${order})...`,
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
      while (idx < pending.length) {
        const myIndex = idx++;
        const tokenId = pending[myIndex]!;
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
          const etaSec = rps > 0 ? Math.round((pending.length - done) / rps) : 0;
          console.log(
            `  progress: ${done.toLocaleString()}/${pending.length.toLocaleString()} (${rps} req/s, ETA ${etaSec}s, ok=${okCount}, 404=${missingCount}, err=${errCount})`,
          );
        }
      }
    }),
  );

  flush();
  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `✓ Resolved ${okCount.toLocaleString()} tokens (+${missingCount} 404, ${errCount} errors) in ${totalSec}s`,
  );
  return { okCount, missingCount, errCount };
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
      console.log("Indexer SQLite:", store.dbPath);
      console.log("Counts:", counts);
      console.log("Chain ranges:", ranges);
      console.log("Cursors:", {
        abstract: store.getCursor("abstract:last_block"),
        abstractBackfillMin: store.getCursor("abstract:backfill_min_block"),
        polygon: store.getCursor("polygon:last_block"),
      });
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
        chunkSize: Number(args.get("chunk") ?? "5000"),
        onProgress: ({ block, mintsAdded, spinsAdded }) => {
          console.log(
            `  block ${block.toLocaleString()} | +${mintsAdded} mints, +${spinsAdded} spins`,
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
          chunkSize: 5_000,
          onProgress: ({ block, mintsAdded, spinsAdded }) => {
            console.log(
              `  block ${block.toLocaleString()} | +${mintsAdded} mints, +${spinsAdded} spins`,
            );
          },
        });
        store.setCursor("abstract:backfill_min_block", String(lowerBlock));
        console.log(
          `✓ Window logs done: +${logRes.totalMints.toLocaleString()} mints, +${logRes.totalSpins.toLocaleString()} spins`,
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
        onProgress: ({ block, mintsAdded, spinsAdded }) => {
          console.log(
            `  polygon block ${block.toLocaleString()} | +${mintsAdded} mints, +${spinsAdded} spins`,
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
