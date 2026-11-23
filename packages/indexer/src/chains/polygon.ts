import { isEligibleP2PTransfer } from "@objekt-stats/stats";
import {
  DEFAULT_ENDPOINTS,
  ERC721_TRANSFER_TOPIC,
  POLYGON_ADDRESSES,
  ZERO_TOPIC,
  addressToTopic,
  topicToAddress,
} from "../constants.js";
import type {
  IndexerStore,
  RawMintRow,
  RawSpinRow,
  RawTransferRow,
} from "../store.js";

interface SqdBlock {
  header: {
    number: number;
    timestamp: number; // unix seconds
  };
  logs?: Array<{
    logIndex: number;
    transactionHash: string;
    topics: string[];
  }>;
}

interface PolygonRpcLog {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  blockTimestamp?: string;
}

export interface SyncPolygonOptions {
  fromBlock: number;
  toBlock: number;
  chunkSize?: number;
  portalUrl?: string;
  includeTransfers?: boolean;
  transfersOnly?: boolean;
  fetchImpl?: typeof fetch;
  onProgress?: (info: {
    block: number;
    toBlock: number;
    mintsAdded: number;
    spinsAdded: number;
    transfersAdded: number;
  }) => void;
}

/**
 * Streams historical Polygon COSMO Objekt mints, spins, and P2P transfers from
 * SQD Portal's free public NDJSON stream (May 2022 – April 18, 2025).
 *
 * Strictly paginates using `lastReturnedBlock + 1` (SQD Portal returns one
 * worker partition per HTTP response even when `toBlock` is much higher) so
 * zero blocks are ever skipped, and strictly separates primary mints
 * (`from === 0x0`) from P2P transfers.
 */
export async function syncPolygonArchive(
  store: IndexerStore,
  options: SyncPolygonOptions,
): Promise<{
  totalMints: number;
  totalSpins: number;
  totalTransfers: number;
  lastBlock: number;
}> {
  const portalUrl = options.portalUrl ?? DEFAULT_ENDPOINTS.sqdPolygonArchive;
  const fetchFn = options.fetchImpl ?? fetch;
  const spinTopic = addressToTopic(POLYGON_ADDRESSES.SPIN);
  const includeTransfers = options.includeTransfers ?? true;
  const transfersOnly = options.transfersOnly ?? false;
  let chunkSize = options.chunkSize ?? 100_000;

  let cursor = options.fromBlock;
  let totalMints = 0;
  let totalSpins = 0;
  let totalTransfers = 0;

  while (cursor <= options.toBlock) {
    const end = Math.min(cursor + chunkSize - 1, options.toBlock);

    const polygonContracts = [
      POLYGON_ADDRESSES.OBJEKT,
      POLYGON_ADDRESSES.OBJEKT_ARTMS,
    ];
    const logFilters =
      includeTransfers || transfersOnly
        ? [
            {
              address: polygonContracts,
              topic0: [ERC721_TRANSFER_TOPIC],
            },
          ]
        : [
            {
              address: polygonContracts,
              topic0: [ERC721_TRANSFER_TOPIC],
              topic1: [ZERO_TOPIC],
            },
            {
              address: polygonContracts,
              topic0: [ERC721_TRANSFER_TOPIC],
              topic2: [spinTopic],
            },
          ];

    let res: Response | null = null;
    for (let attempt = 1; attempt <= 12; attempt++) {
      res = await fetchFn(portalUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "evm",
          fromBlock: cursor,
          toBlock: end,
          fields: {
            block: { number: true, timestamp: true },
            log: { logIndex: true, transactionHash: true, topics: true },
          },
          logs: logFilters,
        }),
      });

      if (res.ok) break;
      if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 12) {
        if (res.status === 529 && chunkSize > 25_000) {
          chunkSize = Math.floor(chunkSize / 2);
          await new Promise((r) => setTimeout(r, 1500));
          break;
        }
        const waitMs = Math.min(15_000, 1_000 * attempt * attempt);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`SQD Polygon Portal error (${res.status}): ${await res.text()}`);
    }

    if (!res || !res.ok) continue;

    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);

    const mintRows: RawMintRow[] = [];
    const spinRows: RawSpinRow[] = [];
    const transferRows: RawTransferRow[] = [];
    let lastReturnedBlock: number | null = null;

    for (const line of lines) {
      const block = JSON.parse(line) as SqdBlock;
      const bn = block.header.number;
      if (lastReturnedBlock === null || bn > lastReturnedBlock) {
        lastReturnedBlock = bn;
      }
      const iso = new Date(block.header.timestamp * 1000).toISOString();

      for (const log of block.logs ?? []) {
        if (log.topics.length < 4) continue;
        const fromTopic = log.topics[1]!.toLowerCase();
        const toTopic = log.topics[2]!.toLowerCase();
        const tokenId = Number(BigInt(log.topics[3]!));
        const txHash = log.transactionHash.toLowerCase();

        if (fromTopic === ZERO_TOPIC) {
          if (!transfersOnly) {
            mintRows.push({
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              mintedAt: iso,
              minter: topicToAddress(toTopic),
              txHash,
            });
          }
        } else if (toTopic === spinTopic) {
          if (!transfersOnly) {
            spinRows.push({
              txHash,
              logIndex: log.logIndex,
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              spunAt: iso,
            });
          }
        } else if (includeTransfers || transfersOnly) {
          const fromAddr = topicToAddress(fromTopic);
          const toAddr = topicToAddress(toTopic);
          if (isEligibleP2PTransfer(fromAddr, toAddr)) {
            transferRows.push({
              txHash,
              logIndex: log.logIndex,
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              transferredAt: iso,
              fromAddr,
              toAddr,
            });
          }
        }
      }
    }

    const pageEnd =
      lastReturnedBlock !== null
        ? Math.min(end, Math.max(cursor, lastReturnedBlock))
        : end;

    if (!transfersOnly) {
      store.insertMints(mintRows);
      store.insertSpins(spinRows);
      store.setCursor("polygon:last_block", String(pageEnd));
    }
    if (transferRows.length > 0) {
      store.insertTransfers(transferRows);
    }
    if (includeTransfers || transfersOnly) {
      store.setCursor("polygon:transfers_last_block", String(pageEnd));
    }

    totalMints += mintRows.length;
    totalSpins += spinRows.length;
    totalTransfers += transferRows.length;

    options.onProgress?.({
      block: pageEnd,
      toBlock: options.toBlock,
      mintsAdded: mintRows.length,
      spinsAdded: spinRows.length,
      transfersAdded: transferRows.length,
    });

    cursor = pageEnd + 1;
  }

  return { totalMints, totalSpins, totalTransfers, lastBlock: options.toBlock };
}

export interface TurboSyncPolygonOptions {
  fromBlock: number;
  toBlock: number;
  chunkSize?: number;
  portalUrl?: string;
  includeSpins?: boolean;
  fetchImpl?: typeof fetch;
  onProgress?: (info: {
    block: number;
    toBlock: number;
    blocksSynced: number;
    totalBlocks: number;
    mintsAdded: number;
    spinsAdded: number;
    chunkSize: number;
  }) => void;
}

/**
 * Gap-free, crash-resumable full-history Polygon SQD archive syncer covering BOTH
 * tripleS (`0xa4b37be4...`) and ARTMS (`0x0fb69f54...`) contracts from genesis to
 * April 18, 2025 Abstract migration.
 *
 * Advances strictly by `lastReturnedBlock + 1` per SQD Portal NDJSON response page
 * and records only `cursor..pageEnd` in `synced_ranges` so zero blocks are skipped.
 */
export async function turboSyncPolygonArchive(
  store: IndexerStore,
  options: TurboSyncPolygonOptions,
): Promise<{
  totalMints: number;
  totalSpins: number;
  blocksSynced: number;
}> {
  const portalUrl = options.portalUrl ?? DEFAULT_ENDPOINTS.sqdPolygonArchive;
  const fetchFn = options.fetchImpl ?? fetch;
  const spinTopic = addressToTopic(POLYGON_ADDRESSES.SPIN);
  const includeSpins = options.includeSpins ?? true;
  const maxChunkSize = options.chunkSize ?? 100_000;
  let chunkSize = maxChunkSize;

  const missingRanges = store.getMissingRanges(
    "polygon",
    "mints",
    options.fromBlock,
    options.toBlock,
  );
  const totalBlocks = missingRanges.reduce(
    (s, r) => s + (r.toBlock - r.fromBlock + 1),
    0,
  );
  if (totalBlocks === 0) {
    return { totalMints: 0, totalSpins: 0, blocksSynced: 0 };
  }

  const polygonContracts = [
    POLYGON_ADDRESSES.OBJEKT,
    POLYGON_ADDRESSES.OBJEKT_ARTMS,
  ];
  const logFilters = includeSpins
    ? [
        {
          address: polygonContracts,
          topic0: [ERC721_TRANSFER_TOPIC],
          topic1: [ZERO_TOPIC],
        },
        {
          address: polygonContracts,
          topic0: [ERC721_TRANSFER_TOPIC],
          topic2: [spinTopic],
        },
      ]
    : [
        {
          address: polygonContracts,
          topic0: [ERC721_TRANSFER_TOPIC],
          topic1: [ZERO_TOPIC],
        },
      ];

  let totalMints = 0;
  let totalSpins = 0;
  let blocksSynced = 0;
  let cleanStreak = 0;

  for (const range of missingRanges) {
    let cursor = range.fromBlock;
    while (cursor <= range.toBlock) {
      const end = Math.min(cursor + chunkSize - 1, range.toBlock);

      let res: Response | null = null;
      let shrinkRetry = false;
      for (let attempt = 1; attempt <= 20; attempt++) {
        try {
          res = await fetchFn(portalUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "evm",
              fromBlock: cursor,
              toBlock: end,
              fields: {
                block: { number: true, timestamp: true },
                log: { logIndex: true, transactionHash: true, topics: true },
              },
              logs: logFilters,
            }),
          });
        } catch (err) {
          const waitMs = Math.min(20_000, 1_500 * attempt);
          if (attempt === 20) throw err;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        if (res.ok) break;
        const status = res.status;
        const body = await res.text().catch(() => "");
        if (status === 429 || status === 529 || status >= 500) {
          cleanStreak = 0;
          if (status === 529 && chunkSize > 15_000) {
            chunkSize = Math.max(15_000, Math.floor(chunkSize / 2));
            await new Promise((r) => setTimeout(r, 2_000 + Math.random() * 1_500));
            shrinkRetry = true;
            break;
          }
          const waitMs = Math.min(30_000, 1_500 * Math.min(attempt, 6) * 2 + Math.random() * 1_000);
          if (attempt === 20) {
            throw new Error(`SQD Polygon Portal error (${status}): ${body}`);
          }
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`SQD Polygon Portal error (${status}): ${body}`);
      }

      if (shrinkRetry || !res || !res.ok) continue;

      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);

      const mintRows: RawMintRow[] = [];
      const spinRows: RawSpinRow[] = [];
      let lastReturnedBlock: number | null = null;

      for (const line of lines) {
        const block = JSON.parse(line) as SqdBlock;
        const bn = block.header.number;
        if (lastReturnedBlock === null || bn > lastReturnedBlock) {
          lastReturnedBlock = bn;
        }
        const iso = new Date(block.header.timestamp * 1000).toISOString();

        for (const log of block.logs ?? []) {
          if (log.topics.length < 4) continue;
          const fromTopic = log.topics[1]!.toLowerCase();
          const toTopic = log.topics[2]!.toLowerCase();
          const tokenId = Number(BigInt(log.topics[3]!));
          const txHash = log.transactionHash.toLowerCase();

          if (fromTopic === ZERO_TOPIC) {
            mintRows.push({
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              mintedAt: iso,
              minter: topicToAddress(toTopic),
              txHash,
            });
          } else if (includeSpins && toTopic === spinTopic) {
            spinRows.push({
              txHash,
              logIndex: log.logIndex,
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              spunAt: iso,
            });
          }
        }
      }

      const pageEnd =
        lastReturnedBlock !== null
          ? Math.min(end, Math.max(cursor, lastReturnedBlock))
          : end;

      store.insertMintsSpinsAndRange("polygon", cursor, pageEnd, mintRows, spinRows);
      store.setCursor("polygon:last_block", String(pageEnd));

      totalMints += mintRows.length;
      totalSpins += spinRows.length;
      blocksSynced += pageEnd - cursor + 1;
      cleanStreak++;

      options.onProgress?.({
        block: pageEnd,
        toBlock: options.toBlock,
        blocksSynced,
        totalBlocks,
        mintsAdded: totalMints,
        spinsAdded: totalSpins,
        chunkSize,
      });

      cursor = pageEnd + 1;
      // Gently recover chunk size after consecutive healthy chunks
      if (cleanStreak >= 5 && chunkSize < maxChunkSize) {
        chunkSize = Math.min(maxChunkSize, Math.floor(chunkSize * 1.5));
        cleanStreak = 0;
      }
    }
  }

  store.compactSyncedRanges("polygon", "mints");
  return { totalMints, totalSpins, blocksSynced };
}

class PolygonRangeTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolygonRangeTooLargeError";
  }
}

function isRangeLimitRpcError(code: number | undefined, message: string, data?: unknown): boolean {
  const combined = `${message} ${typeof data === "string" ? data : JSON.stringify(data ?? "")}`.toLowerCase();
  if (
    combined.includes("more than") ||
    combined.includes("too large") ||
    combined.includes("exceed") ||
    combined.includes("max results") ||
    combined.includes("query returned more") ||
    combined.includes("log response size") ||
    combined.includes("range is too wide")
  ) {
    return true;
  }
  return code === -32602 && combined.includes("block range");
}

async function polygonRpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  fetchFn: typeof fetch,
  baseDelayMs = 600,
): Promise<T> {
  for (let attempt = 1; attempt <= 16; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      });
    } catch (err) {
      if (attempt === 16) throw err;
      const waitMs = Math.min(20_000, baseDelayMs * Math.min(attempt, 6) + Math.random() * 400);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      if (attempt === 16) {
        throw new Error(`Polygon RPC HTTP ${res.status} on ${method}: ${await res.text().catch(() => "")}`);
      }
      const waitMs = Math.min(25_000, baseDelayMs * Math.pow(1.6, Math.min(attempt, 7)) + Math.random() * 500);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Polygon RPC HTTP ${res.status} on ${method}: ${await res.text().catch(() => "")}`);
    }

    const json = (await res.json()) as {
      result?: T;
      error?: { code?: number; message?: string; data?: unknown };
    };

    if (json.error) {
      const code = json.error.code;
      const msg = json.error.message ?? "Unknown RPC error";
      if (isRangeLimitRpcError(code, msg, json.error.data)) {
        throw new PolygonRangeTooLargeError(
          `RPC ${method} range limit (${code}): ${msg} ${typeof json.error.data === "string" ? json.error.data : ""}`,
        );
      }
      if (
        attempt < 16 &&
        (code === -32005 || code === 429 || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("timeout"))
      ) {
        const waitMs = Math.min(25_000, baseDelayMs * Math.pow(1.6, Math.min(attempt, 7)) + Math.random() * 500);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`Polygon RPC ${method} error ${code}: ${msg}`);
    }

    return json.result as T;
  }

  throw new Error(`Polygon RPC ${method} exhausted retries`);
}

async function fetchPolygonLogsRecursive(
  rpcUrl: string,
  contracts: string[],
  fromBlock: number,
  toBlock: number,
  topics: Array<string | null>,
  fetchFn: typeof fetch,
  retryDelayMs: number,
): Promise<PolygonRpcLog[]> {
  try {
    return await polygonRpcCall<PolygonRpcLog[]>(
      rpcUrl,
      "eth_getLogs",
      [
        {
          address: contracts,
          topics,
          fromBlock: "0x" + fromBlock.toString(16),
          toBlock: "0x" + toBlock.toString(16),
        },
      ],
      fetchFn,
      retryDelayMs,
    );
  } catch (err) {
    if (err instanceof PolygonRangeTooLargeError) {
      const span = toBlock - fromBlock + 1;
      if (span <= 1) throw err;
      const mid = Math.floor((fromBlock + toBlock) / 2);
      // Sequential binary split keeps memory flat and never drops logs
      const left = await fetchPolygonLogsRecursive(
        rpcUrl,
        contracts,
        fromBlock,
        mid,
        topics,
        fetchFn,
        retryDelayMs,
      );
      const right = await fetchPolygonLogsRecursive(
        rpcUrl,
        contracts,
        mid + 1,
        toBlock,
        topics,
        fetchFn,
        retryDelayMs,
      );
      for (const item of right) left.push(item);
      return left;
    }
    throw err;
  }
}

async function fetchExactPolygonBlockTimestamps(
  rpcUrl: string,
  blockNumbers: number[],
  cache: Map<number, string>,
  fetchFn: typeof fetch,
  retryDelayMs: number,
): Promise<void> {
  const missing = blockNumbers.filter((b) => !cache.has(b));
  for (const bn of missing) {
    const block = await polygonRpcCall<{ timestamp: string }>(
      rpcUrl,
      "eth_getBlockByNumber",
      ["0x" + bn.toString(16), false],
      fetchFn,
      retryDelayMs,
    );
    cache.set(bn, new Date(Number(BigInt(block.timestamp)) * 1000).toISOString());
  }
}

export interface TurboSyncPolygonRpcOptions {
  fromBlock: number;
  toBlock: number;
  chunkSize?: number;
  parallelism?: number;
  includeSpins?: boolean;
  rpcUrl?: string;
  direction?: "oldest-first" | "newest-first";
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  onProgress?: (info: {
    doneChunks: number;
    totalChunks: number;
    blocksSynced: number;
    totalBlocks: number;
    mintsAdded: number;
    spinsAdded: number;
    blocksPerSec: number;
  }) => void;
}

/**
 * High-throughput, 100% gap-free Polygon Archive RPC syncer covering BOTH
 * tripleS (`0xa4b37be4...`) and ARTMS (`0x0fb69f54...`) contracts.
 *
 * Uses Tenderly's Polygon archive gateway (which returns native `blockTimestamp`
 * on every `eth_getLogs` record and allows up to 20,000 logs per request),
 * recursively binary-splits dense drops so ZERO logs are ever truncated, and
 * tracks exact continuity in `synced_ranges`.
 */
export async function turboSyncPolygonRpc(
  store: IndexerStore,
  options: TurboSyncPolygonRpcOptions,
): Promise<{
  totalMints: number;
  totalSpins: number;
  blocksSynced: number;
}> {
  const rpcUrl = options.rpcUrl ?? DEFAULT_ENDPOINTS.polygonRpc;
  const fetchFn = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 600;
  const chunkSize = options.chunkSize ?? 15_000;
  const parallelism = options.parallelism ?? 6;
  const includeSpins = options.includeSpins ?? true;
  const direction = options.direction ?? "oldest-first";
  const spinTopic = addressToTopic(POLYGON_ADDRESSES.SPIN);
  const polygonContracts = [
    POLYGON_ADDRESSES.OBJEKT,
    POLYGON_ADDRESSES.OBJEKT_ARTMS,
  ];

  const missingRanges = store.getMissingRanges(
    "polygon",
    "mints",
    options.fromBlock,
    options.toBlock,
  );
  const jobs: Array<{ fromBlock: number; toBlock: number }> = [];
  for (const r of missingRanges) {
    for (let b = r.fromBlock; b <= r.toBlock; b += chunkSize) {
      jobs.push({
        fromBlock: b,
        toBlock: Math.min(b + chunkSize - 1, r.toBlock),
      });
    }
  }
  if (direction === "newest-first") {
    jobs.reverse();
  }

  const totalBlocks = jobs.reduce((s, j) => s + (j.toBlock - j.fromBlock + 1), 0);
  if (jobs.length === 0) {
    return { totalMints: 0, totalSpins: 0, blocksSynced: 0 };
  }

  let nextIdx = 0;
  let doneChunks = 0;
  let blocksSynced = 0;
  let totalMints = 0;
  let totalSpins = 0;
  const startedAt = Date.now();
  const blockTsCache = new Map<number, string>();

  await Promise.all(
    Array.from({ length: parallelism }, async () => {
      while (nextIdx < jobs.length) {
        const job = jobs[nextIdx++]!;
        const mintLogs = await fetchPolygonLogsRecursive(
          rpcUrl,
          polygonContracts,
          job.fromBlock,
          job.toBlock,
          [ERC721_TRANSFER_TOPIC, ZERO_TOPIC],
          fetchFn,
          retryDelayMs,
        );
        const spinLogs = includeSpins
          ? await fetchPolygonLogsRecursive(
              rpcUrl,
              polygonContracts,
              job.fromBlock,
              job.toBlock,
              [ERC721_TRANSFER_TOPIC, null, spinTopic],
              fetchFn,
              retryDelayMs,
            )
          : [];

        const missingTsBlocks = new Set<number>();
        for (const log of mintLogs) {
          const bn = Number(BigInt(log.blockNumber));
          if (log.blockTimestamp) {
            blockTsCache.set(
              bn,
              new Date(Number(BigInt(log.blockTimestamp)) * 1000).toISOString(),
            );
          } else if (!blockTsCache.has(bn)) {
            missingTsBlocks.add(bn);
          }
        }
        for (const log of spinLogs) {
          const bn = Number(BigInt(log.blockNumber));
          if (log.blockTimestamp) {
            blockTsCache.set(
              bn,
              new Date(Number(BigInt(log.blockTimestamp)) * 1000).toISOString(),
            );
          } else if (!blockTsCache.has(bn)) {
            missingTsBlocks.add(bn);
          }
        }

        if (missingTsBlocks.size > 0) {
          await fetchExactPolygonBlockTimestamps(
            rpcUrl,
            Array.from(missingTsBlocks).sort((a, b) => a - b),
            blockTsCache,
            fetchFn,
            retryDelayMs,
          );
        }

        const mintRows: RawMintRow[] = [];
        for (const log of mintLogs) {
          if (log.topics.length < 4) continue;
          const bn = Number(BigInt(log.blockNumber));
          mintRows.push({
            tokenId: Number(BigInt(log.topics[3]!)),
            chain: "polygon",
            blockNumber: bn,
            mintedAt: blockTsCache.get(bn)!,
            minter: topicToAddress(log.topics[2]!),
            txHash: log.transactionHash.toLowerCase(),
          });
        }

        const spinRows: RawSpinRow[] = [];
        for (const log of spinLogs) {
          if (log.topics.length < 4) continue;
          const bn = Number(BigInt(log.blockNumber));
          spinRows.push({
            txHash: log.transactionHash.toLowerCase(),
            logIndex: Number(BigInt(log.logIndex)),
            tokenId: Number(BigInt(log.topics[3]!)),
            chain: "polygon",
            blockNumber: bn,
            spunAt: blockTsCache.get(bn)!,
          });
        }

        store.insertMintsSpinsAndRange(
          "polygon",
          job.fromBlock,
          job.toBlock,
          mintRows,
          spinRows,
        );

        doneChunks++;
        blocksSynced += job.toBlock - job.fromBlock + 1;
        totalMints += mintRows.length;
        totalSpins += spinRows.length;

        if (blockTsCache.size > 50_000) {
          blockTsCache.clear();
        }

        if (doneChunks % 15 === 0 || doneChunks === jobs.length) {
          const elapsed = Math.max(0.1, (Date.now() - startedAt) / 1000);
          options.onProgress?.({
            doneChunks,
            totalChunks: jobs.length,
            blocksSynced,
            totalBlocks,
            mintsAdded: totalMints,
            spinsAdded: totalSpins,
            blocksPerSec: Math.round(blocksSynced / elapsed),
          });
        }
      }
    }),
  );

  store.compactSyncedRanges("polygon", "mints");
  const maxRow = store.db
    .prepare("SELECT MAX(block_number) AS max_b FROM raw_mints WHERE chain = 'polygon'")
    .get() as { max_b: number | null };
  if (maxRow.max_b) {
    store.setCursor("polygon:last_block", String(maxRow.max_b));
  }

  return { totalMints, totalSpins, blocksSynced };
}
