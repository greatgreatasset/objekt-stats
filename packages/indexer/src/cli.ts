import { resolve } from "node:path";
import { aggregateAndEmitSql } from "./aggregate.js";
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
    return;
  }

  console.log(
    `Resolving metadata for ${pending.length.toLocaleString()} tokens (concurrency=${concurrency}, order=${order})...`,
  );

  const startedAt = Date.now();
  let idx = 0;
  let okCount = 0;
  let missingCount = 0;
  let errCount = 0;
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
          if (meta) {
            bufferOk.push(meta);
            okCount++;
          } else {
            bufferMissing.push(tokenId);
            missingCount++;
          }
        } catch (err) {
          errCount++;
          if (errCount <= 5) {
            console.warn(`! token ${tokenId} failed:`, (err as Error).message);
          }
        }

        if (bufferOk.length + bufferMissing.length >= 200) {
          flush();
          const done = okCount + missingCount + errCount;
          const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
          const rps = Math.round(done / elapsedSec);
          console.log(
            `  progress: ${done.toLocaleString()}/${pending.length.toLocaleString()} (${rps} req/s, ok=${okCount}, 404=${missingCount}, err=${errCount})`,
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
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  const rootDir = resolve(import.meta.dirname, "../../..");
  const dbPath = args.get("db") ?? resolve(rootDir, "data/raw/indexer.sqlite");
  const store = new IndexerStore(dbPath);

  try {
    if (command === "status") {
      const counts = store.getSummaryCounts();
      console.log("Indexer SQLite:", store.dbPath);
      console.log("Counts:", counts);
      console.log("Cursors:", {
        abstract: store.getCursor("abstract:last_block"),
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
          Number(args.get("concurrency") ?? "25"),
          "newest",
        );
      }
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
        onProgress: ({ block, mintsAdded, spinsAdded }) => {
          console.log(
            `  polygon block ${block.toLocaleString()} | +${mintsAdded} mints, +${spinsAdded} spins`,
          );
        },
      });
      console.log("✓ Polygon archive sync complete:", res);
      return;
    }

    if (command === "resolve") {
      await resolveMetadataBatch(
        store,
        Number(args.get("limit") ?? "10000"),
        Number(args.get("concurrency") ?? "25"),
        args.get("order") === "oldest" ? "oldest" : "newest",
      );
      return;
    }

    if (command === "aggregate") {
      const summary = aggregateAndEmitSql(store, {
        dataRoot: resolve(rootDir, "data"),
        outFile: resolve(rootDir, "packages/db/generated/sync-onchain.sql"),
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
