import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadCurationData } from "@objekt-stats/db/curation-loader";
import {
  classifyTradeSymmetry,
  computeMemberTradeRankings,
  detectTradesFromTransfers,
  isCleanSoloPremiumSwap,
  isEligibleP2PTransfer,
  isRealisticAsymmetricSwap,
  isSameClassSwap,
  isSameEditionSoloSwap,
  makeTransferKey,
  shortenAddress,
  type P2PTransferEvent,
} from "@objekt-stats/stats";
import {
  type AggregateTradesSummary,
  normalizeMemberLookupKey,
} from "./aggregate.js";
import {
  ABSTRACT_ADDRESSES,
  DEFAULT_ENDPOINTS,
  ERC721_TRANSFER_TOPIC,
  POLYGON_ADDRESSES,
  topicToAddress,
} from "./constants.js";
import type { IndexerStore, RawTransferRow } from "./store.js";

interface TransferRpcLog {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  blockTimestamp?: string;
}

class RangeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RangeLimitError";
  }
}

function isRangeLimitError(code: number | undefined, message: string, data?: unknown): boolean {
  const combined = `${message} ${typeof data === "string" ? data : JSON.stringify(data ?? "")}`.toLowerCase();
  return (
    combined.includes("more than") ||
    combined.includes("too large") ||
    combined.includes("exceed") ||
    combined.includes("max results") ||
    combined.includes("query returned more") ||
    combined.includes("log response size") ||
    combined.includes("range is too wide") ||
    combined.includes("too many results") ||
    (code === -32602 && combined.includes("block range"))
  );
}

async function transferRpcCall<T>(
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
        throw new Error(`RPC HTTP ${res.status} on ${method}: ${await res.text().catch(() => "")}`);
      }
      const waitMs = Math.min(25_000, baseDelayMs * Math.pow(1.6, Math.min(attempt, 7)) + Math.random() * 500);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) {
      throw new Error(`RPC HTTP ${res.status} on ${method}: ${await res.text().catch(() => "")}`);
    }

    const json = (await res.json()) as {
      result?: T;
      error?: { code?: number; message?: string; data?: unknown };
    };

    if (json.error) {
      const code = json.error.code;
      const msg = json.error.message ?? "Unknown RPC error";
      if (isRangeLimitError(code, msg, json.error.data)) {
        throw new RangeLimitError(`RPC range limit (${code}): ${msg}`);
      }
      if (
        attempt < 16 &&
        (code === -32005 ||
          code === 429 ||
          msg.toLowerCase().includes("rate limit") ||
          msg.toLowerCase().includes("timeout"))
      ) {
        const waitMs = Math.min(25_000, baseDelayMs * Math.pow(1.6, Math.min(attempt, 7)) + Math.random() * 500);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      // On Abstract RPC some dense range rejections return -32000/-32603 with generic text
      if (
        method === "eth_getLogs" &&
        (code === -32000 || code === -32602 || code === -32603)
      ) {
        throw new RangeLimitError(`RPC eth_getLogs error (${code}): ${msg}`);
      }
      throw new Error(`RPC ${method} error ${code}: ${msg}`);
    }

    return json.result as T;
  }

  throw new Error(`RPC ${method} exhausted retries`);
}

/**
 * Fetches ONLY eligible P2P user-to-user ERC-721 Transfer logs for `[fromBlock..toBlock]`.
 *
 * Filters out mints (`0x0`), burns, spins, contracts, and self-transfers INSIDE each leaf
 * response before returning up the recursive binary split, keeping memory flat even across
 * dense migration blocks with millions of mints.
 */
async function fetchEligibleP2PLogsRecursive(
  rpcUrl: string,
  addressParam: string | string[],
  fromBlock: number,
  toBlock: number,
  fetchFn: typeof fetch,
  retryDelayMs: number,
): Promise<TransferRpcLog[]> {
  try {
    const rawLogs = await transferRpcCall<TransferRpcLog[]>(
      rpcUrl,
      "eth_getLogs",
      [
        {
          address: addressParam,
          topics: [ERC721_TRANSFER_TOPIC],
          fromBlock: "0x" + fromBlock.toString(16),
          toBlock: "0x" + toBlock.toString(16),
        },
      ],
      fetchFn,
      retryDelayMs,
    );

    const eligible: TransferRpcLog[] = [];
    for (const log of rawLogs) {
      if (log.topics.length < 4) continue;
      const fromAddr = topicToAddress(log.topics[1]!);
      const toAddr = topicToAddress(log.topics[2]!);
      if (isEligibleP2PTransfer(fromAddr, toAddr)) {
        eligible.push(log);
      }
    }
    return eligible;
  } catch (err) {
    if (err instanceof RangeLimitError) {
      const span = toBlock - fromBlock + 1;
      if (span <= 1) throw err;
      const mid = Math.floor((fromBlock + toBlock) / 2);
      const left = await fetchEligibleP2PLogsRecursive(
        rpcUrl,
        addressParam,
        fromBlock,
        mid,
        fetchFn,
        retryDelayMs,
      );
      const right = await fetchEligibleP2PLogsRecursive(
        rpcUrl,
        addressParam,
        mid + 1,
        toBlock,
        fetchFn,
        retryDelayMs,
      );
      for (const item of right) left.push(item);
      return left;
    }
    throw err;
  }
}

async function fetchExactBlockTimestamps(
  rpcUrl: string,
  blockNumbers: number[],
  cache: Map<number, string>,
  fetchFn: typeof fetch,
  retryDelayMs: number,
): Promise<void> {
  const missing = blockNumbers.filter((b) => !cache.has(b));
  for (const bn of missing) {
    const block = await transferRpcCall<{ timestamp: string }>(
      rpcUrl,
      "eth_getBlockByNumber",
      ["0x" + bn.toString(16), false],
      fetchFn,
      retryDelayMs,
    );
    cache.set(bn, new Date(Number(BigInt(block.timestamp)) * 1000).toISOString());
  }
}

export interface TurboSyncTransfersOptions {
  chain: "polygon" | "abstract";
  fromBlock: number;
  toBlock: number;
  chunkSize?: number;
  parallelism?: number;
  rpcUrl?: string;
  direction?: "oldest-first" | "newest-first";
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  onProgress?: (info: {
    doneChunks: number;
    totalChunks: number;
    blocksSynced: number;
    totalBlocks: number;
    transfersAdded: number;
    blocksPerSec: number;
  }) => void;
}

/**
 * High-throughput, gap-free, crash-resumable historical P2P transfer syncer for BOTH
 * Polygon (tripleS + ARTMS contracts) and Abstract (unified COSMO contract).
 *
 * Strictly stores ONLY eligible user-to-user P2P transfers in `raw_transfers` and
 * records exact block continuity in `synced_ranges` (`kind = 'transfers'`).
 */
export async function turboSyncTransfersRpc(
  store: IndexerStore,
  options: TurboSyncTransfersOptions,
): Promise<{
  totalTransfers: number;
  blocksSynced: number;
}> {
  const chain = options.chain;
  const rpcUrl =
    options.rpcUrl ??
    (chain === "polygon"
      ? DEFAULT_ENDPOINTS.polygonRpc
      : DEFAULT_ENDPOINTS.abstractRpc);
  const addressParam =
    chain === "polygon"
      ? [POLYGON_ADDRESSES.OBJEKT, POLYGON_ADDRESSES.OBJEKT_ARTMS]
      : ABSTRACT_ADDRESSES.OBJEKT;
  const fetchFn = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 600;
  const chunkSize = options.chunkSize ?? (chain === "polygon" ? 10_000 : 5_000);
  const parallelism = options.parallelism ?? (chain === "polygon" ? 6 : 8);
  const direction = options.direction ?? "oldest-first";

  const missingRanges = store.getMissingRanges(
    chain,
    "transfers",
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
    return { totalTransfers: 0, blocksSynced: 0 };
  }

  let nextIdx = 0;
  let doneChunks = 0;
  let blocksSynced = 0;
  let totalTransfers = 0;
  const startedAt = Date.now();
  const blockTsCache = new Map<number, string>();

  await Promise.all(
    Array.from({ length: parallelism }, async () => {
      while (nextIdx < jobs.length) {
        const job = jobs[nextIdx++]!;
        const logs = await fetchEligibleP2PLogsRecursive(
          rpcUrl,
          addressParam,
          job.fromBlock,
          job.toBlock,
          fetchFn,
          retryDelayMs,
        );

        const missingTsBlocks = new Set<number>();
        for (const log of logs) {
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
          await fetchExactBlockTimestamps(
            rpcUrl,
            Array.from(missingTsBlocks).sort((a, b) => a - b),
            blockTsCache,
            fetchFn,
            retryDelayMs,
          );
        }

        const rows: RawTransferRow[] = [];
        for (const log of logs) {
          const bn = Number(BigInt(log.blockNumber));
          rows.push({
            txHash: log.transactionHash.toLowerCase(),
            logIndex: Number(BigInt(log.logIndex)),
            tokenId: Number(BigInt(log.topics[3]!)),
            chain,
            blockNumber: bn,
            transferredAt: blockTsCache.get(bn)!,
            fromAddr: topicToAddress(log.topics[1]!),
            toAddr: topicToAddress(log.topics[2]!),
          });
        }

        store.insertTransfersAndRange(chain, job.fromBlock, job.toBlock, rows);

        doneChunks++;
        blocksSynced += job.toBlock - job.fromBlock + 1;
        totalTransfers += rows.length;

        if (blockTsCache.size > 50_000) {
          blockTsCache.clear();
        }

        if (doneChunks % 20 === 0 || doneChunks === jobs.length) {
          const elapsed = Math.max(0.1, (Date.now() - startedAt) / 1000);
          options.onProgress?.({
            doneChunks,
            totalChunks: jobs.length,
            blocksSynced,
            totalBlocks,
            transfersAdded: totalTransfers,
            blocksPerSec: Math.round(blocksSynced / elapsed),
          });
        }
      }
    }),
  );

  store.compactSyncedRanges(chain, "transfers");
  return { totalTransfers, blocksSynced };
}

function sqlStr(val: string | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  return `'${val.replace(/'/g, "''")}'`;
}

function sqlNum(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "NULL";
  return String(val);
}

function sqlBool(val: boolean): string {
  return val ? "1" : "0";
}

function pushBatchedInserts(
  lines: string[],
  prefix: string,
  tuples: string[],
  batchSize = 40,
): void {
  for (let i = 0; i < tuples.length; i += batchSize) {
    lines.push(`${prefix} VALUES ${tuples.slice(i, i + batchSize).join(", ")};`);
  }
}

interface CatalogRow {
  col_id: number;
  slug: string;
  collection_id: string;
  artist_id: string;
  raw_member: string;
  season: string;
  objekt_class: string;
  collection_no: string;
  on_offline: "online" | "offline";
  image_url: string;
  background_color: string;
}

export interface StreamingTradesOptions {
  dataRoot?: string;
  metadataDbPath?: string;
  tradesOutFile?: string;
  now?: string;
  /** Width of each chronological processing window in ms (default 7 days). */
  windowMs?: number;
  /** Overlap padding added to BOTH sides of each window in ms (default 3 hours > 1h max session span). */
  padMs?: number;
  onProgress?: (info: {
    windowIndex: number;
    totalWindows: number;
    windowStart: string;
    windowEnd: string;
    confirmedTradesSoFar: number;
    directTransfersSoFar: number;
  }) => void;
}

/**
 * Constant-RAM streaming secondary-trade aggregator designed for 100% 4-year COSMO history
 * (tens of millions of P2P transfers across Polygon + Abstract).
 *
 * Reads `raw_transfers` in chronological windows padded by `padMs` (default 3 hours, strictly
 * greater than `DEFAULT_TRADE_MAX_SPAN_SECONDS = 1 hour`) on BOTH ends, commits ONLY trades
 * completing in `[winStart, winEnd)` and transfers timestamped in `[winStart, winEnd)`, and
 * joins against `collection_catalog` + `token_collections` in `metadataDbPath` (or the same DB).
 *
 * Mathematically 100% equivalent to global in-memory `aggregateTradesAndEmitSql` with zero
 * boundary splits and zero double-counting.
 */
export function aggregateTradesStreaming(
  transfersDb: DatabaseSync,
  options: StreamingTradesOptions = {},
): AggregateTradesSummary {
  const dataRoot = options.dataRoot ?? resolve(process.cwd(), "data");
  const tradesOutFile =
    options.tradesOutFile ??
    resolve(process.cwd(), "packages/db/generated/sync-trades.sql");
  const now = options.now ?? new Date().toISOString();
  const windowMs = options.windowMs ?? 7 * 24 * 3600 * 1000;
  const padMs = options.padMs ?? 3 * 3600 * 1000;

  const curation = loadCurationData(dataRoot);
  const trackedArtists = new Set(curation.artists.map((a) => a.id));

  const memberLookup = new Map<string, string>();
  const memberInfoById = new Map<
    string,
    { name: string; hexColor: string; artistId: string }
  >();
  for (const artist of curation.artists) {
    for (const m of artist.members) {
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.name)}`, m.id);
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.cosmoName)}`, m.id);
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.fullName)}`, m.id);
      memberInfoById.set(m.id, {
        name: m.name,
        hexColor: m.hexColor,
        artistId: artist.id,
      });
    }
  }

  let attachedMeta = false;
  const metaSchema = options.metadataDbPath ? "meta_src" : "main";
  if (options.metadataDbPath) {
    const escaped = resolve(options.metadataDbPath).replace(/'/g, "''");
    transfersDb.exec(`ATTACH DATABASE '${escaped}' AS meta_src;`);
    attachedMeta = true;
  }

  try {
    // Load the compact ~15k-row collection catalog once into RAM
    const catalogByColId = new Map<number, CatalogRow>();
    const catalogRows = transfersDb
      .prepare(
        `SELECT col_id, slug, collection_id, artist_id, raw_member,
                season, objekt_class, collection_no, on_offline,
                image_url, background_color
         FROM ${metaSchema}.collection_catalog`,
      )
      .all() as unknown as CatalogRow[];
    for (const r of catalogRows) {
      catalogByColId.set(r.col_id, r);
    }

    const bounds = transfersDb
      .prepare(
        "SELECT MIN(transferred_at) AS min_t, MAX(transferred_at) AS max_t FROM raw_transfers",
      )
      .get() as { min_t: string | null; max_t: string | null };

    // Compact integer wallet interner so Sets across 40M+ transfers stay tiny in RAM
    const walletToId = new Map<string, number>();
    let nextWalletId = 1;
    const internWallet = (addr: string): number => {
      let id = walletToId.get(addr);
      if (id === undefined) {
        id = nextWalletId++;
        walletToId.set(addr, id);
      }
      return id;
    };

    interface ColTradeAcc {
      meta: CatalogRow;
      memberId: string | null;
      tradedCount: number;
      tradeSessions: number;
      directTransferCount: number;
      traders: Set<number>;
      premiumCount: number;
      bulkCount: number;
      premium2xCount: number;
      premium3xCount: number;
      rateSum: number;
      maxExchangeRate: number;
      sameClassLegs: number;
      sameClassPremiumCount: number;
      sameClassBulkCount: number;
      sameClass2xCount: number;
      sameClass3xCount: number;
      sameClassRateSum: number;
      cleanSolo2xCount: number;
      cleanSolo3xCount: number;
      overpayers: Set<number>;
      sameEdition2xCount: number;
      sameEdition3xCount: number;
      sameEditionOverpayers: Set<number>;
      firstTradeAt: string | null;
      lastTradeAt: string | null;
    }

    interface MemberTradeAcc {
      memberId: string;
      artistId: string;
      tradedCount: number;
      tradeSessions: number;
      directTransferCount: number;
      traders: Set<number>;
      collections: Set<string>;
      premiumCount: number;
      bulkCount: number;
      premium2xCount: number;
      premium3xCount: number;
      rateSum: number;
      maxExchangeRate: number;
      sameClassLegs: number;
      sameClassPremiumCount: number;
      sameClassBulkCount: number;
      sameClass2xCount: number;
      sameClass3xCount: number;
      sameClassRateSum: number;
      cleanSolo2xCount: number;
      cleanSolo3xCount: number;
      cleanSoloBulkCount: number;
      overpayerCounts: Map<number, number>;
      sameEdition2xCount: number;
      sameEdition3xCount: number;
      sameEditionBulkCount: number;
      sameEditionOverpayerCounts: Map<number, number>;
      lastTradeAt: string | null;
    }

    interface DailyTradeAcc {
      artistId: string;
      tradeDate: string;
      tradeSessions: number;
      asymmetricSessions: number;
      ratio2xSessions: number;
      ratio3xSessions: number;
      sameClassAsymmetricSessions: number;
      tradedObjekts: number;
      directTransfers: number;
      traders: Set<number>;
      frozenTraderCount: number | null;
    }

    interface RecentTradeRow {
      tradeId: string;
      artistId: string;
      chain: string;
      tradedAt: string;
      durationSeconds: number;
      sideACount: number;
      sideBCount: number;
      isAsymmetric: boolean;
      isSameClass: boolean;
      isCleanSolo: boolean;
      isSameEdition: boolean;
      ratioMultiple: number;
      walletAShort: string;
      walletBShort: string;
      sideASummary: string;
      sideBSummary: string;
    }

    const colTradeMap = new Map<string, ColTradeAcc>();
    const memberTradeMap = new Map<string, MemberTradeAcc>();
    const dailyTradeMap = new Map<string, DailyTradeAcc>();

    // Bounded per-artist recent buffers (newest trades kept as we stream chronologically!)
    const recentGeneralByArtist = new Map<string, RecentTradeRow[]>();
    const recentCleanByArtist = new Map<string, RecentTradeRow[]>();
    const recentAsymByArtist = new Map<string, RecentTradeRow[]>();

    const pushBoundedRecent = (
      map: Map<string, RecentTradeRow[]>,
      artistId: string,
      row: RecentTradeRow,
      cap: number,
    ) => {
      let arr = map.get(artistId);
      if (!arr) {
        arr = [];
        map.set(artistId, arr);
      }
      arr.push(row);
      if (arr.length > cap * 2) {
        arr.sort((a, b) => b.tradedAt.localeCompare(a.tradedAt));
        arr.length = cap;
      }
    };

    const ensureColAcc = (meta: CatalogRow): ColTradeAcc => {
      let acc = colTradeMap.get(meta.slug);
      if (!acc) {
        const memberId =
          memberLookup.get(
            `${meta.artist_id}:${normalizeMemberLookupKey(meta.raw_member)}`,
          ) ?? null;
        acc = {
          meta,
          memberId,
          tradedCount: 0,
          tradeSessions: 0,
          directTransferCount: 0,
          traders: new Set(),
          premiumCount: 0,
          bulkCount: 0,
          premium2xCount: 0,
          premium3xCount: 0,
          rateSum: 0,
          maxExchangeRate: 1,
          sameClassLegs: 0,
          sameClassPremiumCount: 0,
          sameClassBulkCount: 0,
          sameClass2xCount: 0,
          sameClass3xCount: 0,
          sameClassRateSum: 0,
          cleanSolo2xCount: 0,
          cleanSolo3xCount: 0,
          overpayers: new Set(),
          sameEdition2xCount: 0,
          sameEdition3xCount: 0,
          sameEditionOverpayers: new Set(),
          firstTradeAt: null,
          lastTradeAt: null,
        };
        colTradeMap.set(meta.slug, acc);
      }
      return acc;
    };

    const ensureMemberAcc = (memberId: string, artistId: string): MemberTradeAcc => {
      let acc = memberTradeMap.get(memberId);
      if (!acc) {
        acc = {
          memberId,
          artistId,
          tradedCount: 0,
          tradeSessions: 0,
          directTransferCount: 0,
          traders: new Set(),
          collections: new Set(),
          premiumCount: 0,
          bulkCount: 0,
          premium2xCount: 0,
          premium3xCount: 0,
          rateSum: 0,
          maxExchangeRate: 1,
          sameClassLegs: 0,
          sameClassPremiumCount: 0,
          sameClassBulkCount: 0,
          sameClass2xCount: 0,
          sameClass3xCount: 0,
          sameClassRateSum: 0,
          cleanSolo2xCount: 0,
          cleanSolo3xCount: 0,
          cleanSoloBulkCount: 0,
          overpayerCounts: new Map(),
          sameEdition2xCount: 0,
          sameEdition3xCount: 0,
          sameEditionBulkCount: 0,
          sameEditionOverpayerCounts: new Map(),
          lastTradeAt: null,
        };
        memberTradeMap.set(memberId, acc);
      }
      return acc;
    };

    const ensureDailyAcc = (artistId: string, tradeDate: string): DailyTradeAcc => {
      const key = `${artistId}|${tradeDate}`;
      let acc = dailyTradeMap.get(key);
      if (!acc) {
        acc = {
          artistId,
          tradeDate,
          tradeSessions: 0,
          asymmetricSessions: 0,
          ratio2xSessions: 0,
          ratio3xSessions: 0,
          sameClassAsymmetricSessions: 0,
          tradedObjekts: 0,
          directTransfers: 0,
          traders: new Set(),
          frozenTraderCount: null,
        };
        dailyTradeMap.set(key, acc);
      }
      return acc;
    };

    const applyAsymMetrics = (
      target: {
        premiumCount: number;
        bulkCount: number;
        premium2xCount: number;
        premium3xCount: number;
        rateSum: number;
        maxExchangeRate: number;
        sameClassLegs: number;
        sameClassPremiumCount: number;
        sameClassBulkCount: number;
        sameClass2xCount: number;
        sameClass3xCount: number;
        sameClassRateSum: number;
      },
      rate: number,
      sameClass: boolean,
    ) => {
      target.rateSum += rate;
      if (rate > target.maxExchangeRate) target.maxExchangeRate = rate;
      if (rate > 1) target.premiumCount++;
      else if (rate < 1) target.bulkCount++;
      if (rate >= 2) target.premium2xCount++;
      if (rate >= 3) target.premium3xCount++;

      if (sameClass) {
        target.sameClassLegs++;
        target.sameClassRateSum += rate;
        if (rate > 1) target.sameClassPremiumCount++;
        else if (rate < 1) target.sameClassBulkCount++;
        if (rate >= 2) target.sameClass2xCount++;
        if (rate >= 3) target.sameClass3xCount++;
      }
    };

    let confirmedTradesCount = 0;
    let asymmetricTradesCount = 0;
    let confirmedTradedObjekts = 0;
    let directP2PTransfersCount = 0;

    if (bounds.min_t && bounds.max_t) {
      const minMs = Date.parse(bounds.min_t);
      const maxMs = Date.parse(bounds.max_t);
      const totalWindows = Math.max(1, Math.ceil((maxMs - minMs + 1) / windowMs));

      const sliceStmt = transfersDb.prepare(
        `SELECT tx_hash, log_index, token_id, chain, block_number, transferred_at, from_addr, to_addr
         FROM raw_transfers
         WHERE transferred_at >= ? AND transferred_at < ?
         ORDER BY transferred_at ASC, block_number ASC, log_index ASC`,
      );

      // Keep small rolling dedup sets across adjacent window boundaries
      let prevBoundaryTradeIds = new Set<string>();
      let prevBoundaryTransferKeys = new Set<string>();

      let windowIndex = 0;
      for (let winStartMs = minMs; winStartMs <= maxMs; winStartMs += windowMs) {
        windowIndex++;
        const winEndMs = winStartMs + windowMs;
        const winStartIso = new Date(winStartMs).toISOString();
        const winEndIso = new Date(winEndMs).toISOString();
        const paddedStartIso = new Date(winStartMs - padMs).toISOString();
        const paddedEndIso = new Date(winEndMs + padMs).toISOString();

        const rows = sliceStmt.all(paddedStartIso, paddedEndIso) as unknown as Array<{
          tx_hash: string;
          log_index: number;
          token_id: number;
          chain: "polygon" | "abstract";
          block_number: number;
          transferred_at: string;
          from_addr: string;
          to_addr: string;
        }>;

        if (rows.length === 0) continue;

        const detected = detectTradesFromTransfers(
          rows.map((t) => ({
            txHash: t.tx_hash,
            logIndex: t.log_index,
            chain: t.chain,
            blockNumber: t.block_number,
            transferredAt: t.transferred_at,
            from: t.from_addr,
            to: t.to_addr,
            tokenId: t.token_id,
          })),
        );

        // Identify only the transfers and trades committed in THIS [winStartIso, winEndIso) window
        const nextBoundaryTradeIds = new Set<string>();
        const nextBoundaryTransferKeys = new Set<string>();

        const windowTransfers: P2PTransferEvent[] = [];
        const neededTokenIds = new Set<number>();

        for (const t of detected.eligibleTransfers) {
          if (t.transferredAt < winStartIso || t.transferredAt >= winEndIso) continue;
          const key = makeTransferKey(t.txHash, t.logIndex);
          if (prevBoundaryTransferKeys.has(key)) continue;
          if (Date.parse(t.transferredAt) >= winEndMs - padMs) {
            nextBoundaryTransferKeys.add(key);
          }
          windowTransfers.push(t);
          neededTokenIds.add(t.tokenId);
        }

        const windowTrades = detected.trades.filter((tr) => {
          if (tr.completedAt < winStartIso || tr.completedAt >= winEndIso) return false;
          if (prevBoundaryTradeIds.has(tr.tradeId)) return false;
          if (Date.parse(tr.completedAt) >= winEndMs - padMs) {
            nextBoundaryTradeIds.add(tr.tradeId);
          }
          for (const leg of tr.allLegs) {
            neededTokenIds.add(leg.tokenId);
          }
          return true;
        });

        // Resolve token_id -> CatalogRow for ONLY the distinct tokens touched in this window
        const metaByToken = new Map<number, CatalogRow>();
        const tokenIdList = Array.from(neededTokenIds);
        const batch = 500;
        for (let i = 0; i < tokenIdList.length; i += batch) {
          const slice = tokenIdList.slice(i, i + batch);
          const placeholders = slice.map(() => "?").join(",");
          const tcRows = transfersDb
            .prepare(
              `SELECT token_id, col_id FROM ${metaSchema}.token_collections WHERE token_id IN (${placeholders})`,
            )
            .all(...slice) as Array<{ token_id: number; col_id: number }>;
          for (const r of tcRows) {
            const cat = catalogByColId.get(r.col_id);
            if (cat) metaByToken.set(r.token_id, cat);
          }
        }

        const summarizeLegs = (legs: readonly P2PTransferEvent[]) => {
          const grouped = new Map<
            string,
            {
              slug: string;
              collectionId: string;
              artistId: string;
              memberId: string | null;
              memberName: string;
              hexColor: string;
              imageUrl: string | null;
              count: number;
            }
          >();
          for (const leg of legs) {
            const meta = metaByToken.get(leg.tokenId);
            const slug = meta?.slug ?? `token-${leg.tokenId}`;
            const existing = grouped.get(slug);
            if (existing) {
              existing.count++;
              continue;
            }
            const memberId = meta
              ? (memberLookup.get(
                  `${meta.artist_id}:${normalizeMemberLookupKey(meta.raw_member)}`,
                ) ?? null)
              : null;
            const mInfo = memberId ? memberInfoById.get(memberId) : null;
            grouped.set(slug, {
              slug,
              collectionId: meta?.collection_id ?? `Objekt #${leg.tokenId}`,
              artistId: meta?.artist_id ?? "unknown",
              memberId,
              memberName: mInfo?.name ?? meta?.raw_member ?? "Unknown",
              hexColor: mInfo?.hexColor ?? "#71717a",
              imageUrl: meta?.image_url || null,
              count: 1,
            });
          }
          return JSON.stringify(Array.from(grouped.values()));
        };

        // 1. Commit eligible P2P direct transfers in this window
        for (const t of windowTransfers) {
          directP2PTransfersCount++;
          const meta = metaByToken.get(t.tokenId);
          if (!meta || !trackedArtists.has(meta.artist_id as "triples" | "artms")) {
            continue;
          }
          const isConfirmed = detected.tradedTransferKeys.has(
            makeTransferKey(t.txHash, t.logIndex),
          );
          const colAcc = ensureColAcc(meta);
          colAcc.directTransferCount++;
          if (isConfirmed) {
            colAcc.traders.add(internWallet(t.from));
            colAcc.traders.add(internWallet(t.to));
          }
          if (colAcc.memberId) {
            const mAcc = ensureMemberAcc(colAcc.memberId, meta.artist_id);
            mAcc.directTransferCount++;
          }
          const dayAcc = ensureDailyAcc(meta.artist_id, t.transferredAt.slice(0, 10));
          dayAcc.directTransfers++;
        }

        // 2. Commit confirmed trades completing in this window
        for (const trade of windowTrades) {
          confirmedTradesCount++;
          const touchedArtists = new Set<string>();
          const touchedCols = new Set<string>();
          const touchedMembers = new Set<string>();
          const tradeDate = trade.completedAt.slice(0, 10);

          const sym = classifyTradeSymmetry(
            trade.sideALegs.length,
            trade.sideBLegs.length,
          );
          const realisticAsym = isRealisticAsymmetricSwap(
            trade.sideALegs.length,
            trade.sideBLegs.length,
          );
          if (realisticAsym) asymmetricTradesCount++;

          const sameClass = isSameClassSwap(
            trade.sideALegs.map((l) => metaByToken.get(l.tokenId)?.objekt_class),
            trade.sideBLegs.map((l) => metaByToken.get(l.tokenId)?.objekt_class),
          );

          const premSideLegs =
            sym.premiumSide === "A"
              ? trade.sideALegs
              : sym.premiumSide === "B"
                ? trade.sideBLegs
                : [];
          const bulkSideLegs =
            sym.premiumSide === "A"
              ? trade.sideBLegs
              : sym.premiumSide === "B"
                ? trade.sideALegs
                : [];
          const toCleanMeta = (leg: P2PTransferEvent) => {
            const m = metaByToken.get(leg.tokenId);
            if (!m) return null;
            const memberId =
              memberLookup.get(
                `${m.artist_id}:${normalizeMemberLookupKey(m.raw_member)}`,
              ) ?? null;
            return {
              objektClass: m.objekt_class,
              onOffline: m.on_offline,
              memberId,
              season: m.season,
              collectionNo: m.collection_no,
            };
          };
          const premCleanMetas = premSideLegs.map(toCleanMeta);
          const bulkCleanMetas = bulkSideLegs.map(toCleanMeta);
          const isCleanSolo =
            realisticAsym &&
            sym.is2to1Plus &&
            isCleanSoloPremiumSwap(premCleanMetas, bulkCleanMetas);
          const isSameEdition =
            isCleanSolo && isSameEditionSoloSwap(premCleanMetas, bulkCleanMetas);

          const rateA = !sym.isAsymmetric || realisticAsym ? sym.sideAExchangeRate : 1;
          const rateB = !sym.isAsymmetric || realisticAsym ? sym.sideBExchangeRate : 1;

          const sidePairs: Array<readonly [readonly P2PTransferEvent[], number]> = [
            [trade.sideALegs, rateA],
            [trade.sideBLegs, rateB],
          ];

          for (const [sideLegs, legRate] of sidePairs) {
            for (const leg of sideLegs) {
              const meta = metaByToken.get(leg.tokenId);
              if (!meta || !trackedArtists.has(meta.artist_id as "triples" | "artms")) {
                continue;
              }
              confirmedTradedObjekts++;
              touchedArtists.add(meta.artist_id);
              const fromId = internWallet(leg.from);
              const toId = internWallet(leg.to);

              const colAcc = ensureColAcc(meta);
              colAcc.tradedCount++;
              colAcc.traders.add(fromId);
              colAcc.traders.add(toId);
              applyAsymMetrics(colAcc, legRate, sameClass);
              if (!colAcc.firstTradeAt || leg.transferredAt < colAcc.firstTradeAt) {
                colAcc.firstTradeAt = leg.transferredAt;
              }
              if (!colAcc.lastTradeAt || leg.transferredAt > colAcc.lastTradeAt) {
                colAcc.lastTradeAt = leg.transferredAt;
              }
              if (!touchedCols.has(meta.slug)) {
                colAcc.tradeSessions++;
                touchedCols.add(meta.slug);
              }

              if (colAcc.memberId) {
                const mAcc = ensureMemberAcc(colAcc.memberId, meta.artist_id);
                mAcc.tradedCount++;
                mAcc.traders.add(fromId);
                mAcc.traders.add(toId);
                mAcc.collections.add(meta.slug);
                applyAsymMetrics(mAcc, legRate, sameClass);
                if (!mAcc.lastTradeAt || leg.transferredAt > mAcc.lastTradeAt) {
                  mAcc.lastTradeAt = leg.transferredAt;
                }
                if (!touchedMembers.has(colAcc.memberId)) {
                  mAcc.tradeSessions++;
                  touchedMembers.add(colAcc.memberId);
                }
              }

              const dayAcc = ensureDailyAcc(meta.artist_id, tradeDate);
              dayAcc.tradedObjekts++;
              dayAcc.traders.add(fromId);
              dayAcc.traders.add(toId);
            }
          }

          if (isCleanSolo && premSideLegs.length === 1) {
            const premLeg = premSideLegs[0]!;
            const pMeta = metaByToken.get(premLeg.tokenId);
            if (pMeta && trackedArtists.has(pMeta.artist_id as "triples" | "artms")) {
              const overpayerId = internWallet(premLeg.to.toLowerCase());
              const colAcc = ensureColAcc(pMeta);
              colAcc.cleanSolo2xCount++;
              if (sym.is3to1Plus) colAcc.cleanSolo3xCount++;
              colAcc.overpayers.add(overpayerId);
              if (isSameEdition) {
                colAcc.sameEdition2xCount++;
                if (sym.is3to1Plus) colAcc.sameEdition3xCount++;
                colAcc.sameEditionOverpayers.add(overpayerId);
              }

              if (colAcc.memberId) {
                const mAcc = ensureMemberAcc(colAcc.memberId, pMeta.artist_id);
                mAcc.cleanSolo2xCount++;
                if (sym.is3to1Plus) mAcc.cleanSolo3xCount++;
                mAcc.overpayerCounts.set(
                  overpayerId,
                  (mAcc.overpayerCounts.get(overpayerId) ?? 0) + 1,
                );
                if (isSameEdition) {
                  mAcc.sameEdition2xCount++;
                  if (sym.is3to1Plus) mAcc.sameEdition3xCount++;
                  mAcc.sameEditionOverpayerCounts.set(
                    overpayerId,
                    (mAcc.sameEditionOverpayerCounts.get(overpayerId) ?? 0) + 1,
                  );
                }
              }
            }

            for (const bLeg of bulkSideLegs) {
              const bMeta = metaByToken.get(bLeg.tokenId);
              if (!bMeta || !trackedArtists.has(bMeta.artist_id as "triples" | "artms")) {
                continue;
              }
              const bMemberId =
                memberLookup.get(
                  `${bMeta.artist_id}:${normalizeMemberLookupKey(bMeta.raw_member)}`,
                ) ?? null;
              if (bMemberId) {
                const bmAcc = ensureMemberAcc(bMemberId, bMeta.artist_id);
                bmAcc.cleanSoloBulkCount++;
                if (isSameEdition) bmAcc.sameEditionBulkCount++;
              }
            }
          }

          if (touchedArtists.size > 0) {
            const sideASummary = summarizeLegs(trade.sideALegs);
            const sideBSummary = summarizeLegs(trade.sideBLegs);
            for (const artistId of touchedArtists) {
              const dayAcc = ensureDailyAcc(artistId, tradeDate);
              dayAcc.tradeSessions++;
              if (realisticAsym) {
                dayAcc.asymmetricSessions++;
                if (sym.is2to1Plus) dayAcc.ratio2xSessions++;
                if (sym.is3to1Plus) dayAcc.ratio3xSessions++;
                if (sameClass) dayAcc.sameClassAsymmetricSessions++;
              }
              const rtRow: RecentTradeRow = {
                tradeId: trade.tradeId,
                artistId,
                chain: trade.chain,
                tradedAt: trade.completedAt,
                durationSeconds: trade.durationSeconds,
                sideACount: trade.sideALegs.length,
                sideBCount: trade.sideBLegs.length,
                isAsymmetric: realisticAsym,
                isSameClass: sameClass,
                isCleanSolo,
                isSameEdition,
                ratioMultiple: realisticAsym ? sym.ratioMultiple : 1,
                walletAShort: shortenAddress(trade.walletA),
                walletBShort: shortenAddress(trade.walletB),
                sideASummary,
                sideBSummary,
              };
              pushBoundedRecent(recentGeneralByArtist, artistId, rtRow, 120);
              if (isCleanSolo) {
                pushBoundedRecent(recentCleanByArtist, artistId, rtRow, 80);
              }
              if (realisticAsym && sym.ratioMultiple >= 2) {
                pushBoundedRecent(recentAsymByArtist, artistId, rtRow, 80);
              }
            }
          }
        }

        // Freeze daily trader Sets strictly older than winStartMs - 2 days to keep RAM minimal
        const freezeCutoffDate = new Date(winStartMs - 2 * 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);
        for (const dayAcc of dailyTradeMap.values()) {
          if (dayAcc.frozenTraderCount === null && dayAcc.tradeDate < freezeCutoffDate) {
            dayAcc.frozenTraderCount = dayAcc.traders.size;
            dayAcc.traders.clear();
          }
        }

        prevBoundaryTradeIds = nextBoundaryTradeIds;
        prevBoundaryTransferKeys = nextBoundaryTransferKeys;

        options.onProgress?.({
          windowIndex,
          totalWindows,
          windowStart: winStartIso,
          windowEnd: winEndIso,
          confirmedTradesSoFar: confirmedTradesCount,
          directTransfersSoFar: directP2PTransfersCount,
        });
      }
    }

    const round4 = (v: number) => Math.round(v * 10000) / 10000;

    // Emit compact batched SQL for D1
    const tradeLines: string[] = [
      `-- Auto-generated full-history secondary trade aggregates (${now})`,
      "",
      "DELETE FROM recent_trades;",
      "DELETE FROM daily_trade_stats;",
      "DELETE FROM member_trade_stats;",
      "DELETE FROM collection_trade_stats;",
      "",
    ];

    const colTuples: string[] = [];
    for (const col of colTradeMap.values()) {
      const avgRate = col.tradedCount > 0 ? round4(col.rateSum / col.tradedCount) : 1;
      const scAvgRate =
        col.sameClassLegs > 0 ? round4(col.sameClassRateSum / col.sameClassLegs) : 1;
      colTuples.push(
        `(${sqlStr(col.meta.slug)}, ${sqlStr(col.meta.collection_id)}, ${sqlStr(col.meta.artist_id)}, ${sqlStr(col.memberId)}, ${sqlStr(col.meta.raw_member)}, ${sqlStr(col.meta.season)}, ${sqlStr(col.meta.objekt_class)}, ${sqlStr(col.meta.collection_no)}, ${sqlStr(col.meta.on_offline)}, ${sqlStr(col.meta.image_url)}, ${sqlStr(col.meta.background_color)}, ${col.tradedCount}, ${col.tradeSessions}, ${col.directTransferCount}, ${col.traders.size}, ${col.premiumCount}, ${col.bulkCount}, ${col.premium2xCount}, ${col.premium3xCount}, ${avgRate}, ${round4(col.maxExchangeRate)}, ${col.sameClassLegs}, ${col.sameClassPremiumCount}, ${col.sameClassBulkCount}, ${col.sameClass2xCount}, ${col.sameClass3xCount}, ${scAvgRate}, ${col.cleanSolo2xCount}, ${col.cleanSolo3xCount}, ${col.overpayers.size}, ${col.sameEdition2xCount}, ${col.sameEdition3xCount}, ${col.sameEditionOverpayers.size}, ${sqlStr(col.firstTradeAt)}, ${sqlStr(col.lastTradeAt)}, ${sqlStr(now)})`,
      );
    }
    pushBatchedInserts(
      tradeLines,
      "INSERT OR REPLACE INTO collection_trade_stats (collection_slug, collection_id, artist_id, member_id, raw_member_name, season, objekt_class, collection_no, on_offline, front_image_url, background_color, traded_count, trade_sessions, direct_transfer_count, unique_traders, premium_count, bulk_count, premium_2x_count, premium_3x_count, avg_exchange_rate, max_exchange_rate, same_class_legs, same_class_premium_count, same_class_bulk_count, same_class_2x_count, same_class_3x_count, same_class_avg_rate, clean_solo_2x_count, clean_solo_3x_count, unique_overpayers, same_edition_2x_count, same_edition_3x_count, same_edition_overpayers, first_trade_at, last_trade_at, updated_at)",
      colTuples,
      20,
    );

    tradeLines.push("");
    const memberTuples: string[] = [];
    for (const artist of curation.artists) {
      const artistMemberAccs = artist.members.map((m) => {
        const existing = memberTradeMap.get(m.id);
        return (
          existing ?? {
            memberId: m.id,
            artistId: artist.id,
            tradedCount: 0,
            tradeSessions: 0,
            directTransferCount: 0,
            traders: new Set<number>(),
            collections: new Set<string>(),
            premiumCount: 0,
            bulkCount: 0,
            premium2xCount: 0,
            premium3xCount: 0,
            rateSum: 0,
            maxExchangeRate: 1,
            sameClassLegs: 0,
            sameClassPremiumCount: 0,
            sameClassBulkCount: 0,
            sameClass2xCount: 0,
            sameClass3xCount: 0,
            sameClassRateSum: 0,
            cleanSolo2xCount: 0,
            cleanSolo3xCount: 0,
            cleanSoloBulkCount: 0,
            overpayerCounts: new Map<number, number>(),
            sameEdition2xCount: 0,
            sameEdition3xCount: 0,
            sameEditionBulkCount: 0,
            sameEditionOverpayerCounts: new Map<number, number>(),
            lastTradeAt: null,
          }
        );
      });
      const hasAnyArtistTrades = artistMemberAccs.some(
        (a) => a.tradedCount > 0 || a.directTransferCount > 0,
      );
      if (!hasAnyArtistTrades) continue;

      const ranked = computeMemberTradeRankings(
        artistMemberAccs.map((a) => ({
          memberId: a.memberId,
          tradedCount: a.tradedCount,
        })),
      );
      const rankByMember = new Map(ranked.map((r) => [r.memberId, r]));

      for (const a of artistMemberAccs) {
        const r = rankByMember.get(a.memberId);
        if (!r) continue;
        const avgRate = a.tradedCount > 0 ? round4(a.rateSum / a.tradedCount) : 1;
        const scAvgRate =
          a.sameClassLegs > 0 ? round4(a.sameClassRateSum / a.sameClassLegs) : 1;
        let topOverpayerCount = 0;
        for (const c of a.overpayerCounts.values()) {
          if (c > topOverpayerCount) topOverpayerCount = c;
        }
        const topOverpayerSharePct =
          a.cleanSolo2xCount > 0
            ? Math.round((topOverpayerCount / a.cleanSolo2xCount) * 1000) / 10
            : null;
        let topSameEdCount = 0;
        for (const c of a.sameEditionOverpayerCounts.values()) {
          if (c > topSameEdCount) topSameEdCount = c;
        }
        const sameEditionTopSharePct =
          a.sameEdition2xCount > 0
            ? Math.round((topSameEdCount / a.sameEdition2xCount) * 1000) / 10
            : null;
        memberTuples.push(
          `(${sqlStr(a.memberId)}, ${sqlStr(a.artistId)}, ${a.tradedCount}, ${a.tradeSessions}, ${a.directTransferCount}, ${a.traders.size}, ${a.collections.size}, ${r.tradeRank}, ${r.tradeSharePct}, ${r.tradeRelativeIndex}, ${a.premiumCount}, ${a.bulkCount}, ${a.premium2xCount}, ${a.premium3xCount}, ${avgRate}, ${round4(a.maxExchangeRate)}, ${a.sameClassLegs}, ${a.sameClassPremiumCount}, ${a.sameClassBulkCount}, ${a.sameClass2xCount}, ${a.sameClass3xCount}, ${scAvgRate}, ${a.cleanSolo2xCount}, ${a.cleanSolo3xCount}, ${a.cleanSoloBulkCount}, ${a.overpayerCounts.size}, ${sqlNum(topOverpayerSharePct)}, ${a.sameEdition2xCount}, ${a.sameEdition3xCount}, ${a.sameEditionBulkCount}, ${a.sameEditionOverpayerCounts.size}, ${sqlNum(sameEditionTopSharePct)}, ${sqlStr(a.lastTradeAt)}, ${sqlStr(now)})`,
        );
      }
    }
    pushBatchedInserts(
      tradeLines,
      "INSERT OR REPLACE INTO member_trade_stats (member_id, artist_id, traded_count, trade_sessions, direct_transfer_count, unique_traders, collections_traded, trade_rank, trade_share_pct, trade_relative_index, premium_count, bulk_count, premium_2x_count, premium_3x_count, avg_exchange_rate, max_exchange_rate, same_class_legs, same_class_premium_count, same_class_bulk_count, same_class_2x_count, same_class_3x_count, same_class_avg_rate, clean_solo_2x_count, clean_solo_3x_count, clean_solo_bulk_count, unique_overpayers, top_overpayer_share_pct, same_edition_2x_count, same_edition_3x_count, same_edition_bulk_count, same_edition_overpayers, same_edition_top_share_pct, last_trade_at, updated_at)",
      memberTuples,
      15,
    );

    tradeLines.push("");
    const dailyTuples: string[] = [];
    for (const d of dailyTradeMap.values()) {
      const uniqueTraders = d.frozenTraderCount ?? d.traders.size;
      dailyTuples.push(
        `(${sqlStr(d.artistId)}, ${sqlStr(d.tradeDate)}, ${d.tradeSessions}, ${d.asymmetricSessions}, ${d.ratio2xSessions}, ${d.ratio3xSessions}, ${d.sameClassAsymmetricSessions}, ${d.tradedObjekts}, ${d.directTransfers}, ${uniqueTraders})`,
      );
    }
    pushBatchedInserts(
      tradeLines,
      "INSERT OR REPLACE INTO daily_trade_stats (artist_id, trade_date, trade_sessions, asymmetric_sessions, ratio_2x_sessions, ratio_3x_sessions, same_class_asymmetric_sessions, traded_objekts, direct_transfers, unique_traders)",
      dailyTuples,
      40,
    );

    // Emit bounded recent trades matching aggregateTradesAndEmitSql quotas (70 general + 50 clean + 40 asym per artist)
    tradeLines.push("");
    const combinedRecent: RecentTradeRow[] = [];
    const dedupCandidate = new Set<string>();
    for (const map of [recentGeneralByArtist, recentCleanByArtist, recentAsymByArtist]) {
      for (const list of map.values()) {
        for (const rt of list) {
          const k = `${rt.tradeId}|${rt.artistId}`;
          if (!dedupCandidate.has(k)) {
            dedupCandidate.add(k);
            combinedRecent.push(rt);
          }
        }
      }
    }
    combinedRecent.sort((a, b) => b.tradedAt.localeCompare(a.tradedAt));

    const perArtistGeneralCount = new Map<string, number>();
    const perArtistCleanSoloCount = new Map<string, number>();
    const perArtistAsymCount = new Map<string, number>();
    const recentTuples: string[] = [];

    for (const rt of combinedRecent) {
      const genCount = perArtistGeneralCount.get(rt.artistId) ?? 0;
      const cleanCount = perArtistCleanSoloCount.get(rt.artistId) ?? 0;
      const asymCount = perArtistAsymCount.get(rt.artistId) ?? 0;

      const takeGeneral = genCount < 70;
      const takeClean = !takeGeneral && rt.isCleanSolo && cleanCount < 50;
      const takeAsym =
        !takeGeneral &&
        !takeClean &&
        rt.isAsymmetric &&
        rt.ratioMultiple >= 2 &&
        asymCount < 40;
      if (!takeGeneral && !takeClean && !takeAsym) continue;

      if (takeGeneral) perArtistGeneralCount.set(rt.artistId, genCount + 1);
      if (rt.isCleanSolo) perArtistCleanSoloCount.set(rt.artistId, cleanCount + 1);
      if (rt.isAsymmetric && rt.ratioMultiple >= 2) {
        perArtistAsymCount.set(rt.artistId, asymCount + 1);
      }

      recentTuples.push(
        `(${sqlStr(rt.tradeId)}, ${sqlStr(rt.artistId)}, ${sqlStr(rt.chain)}, ${sqlStr(rt.tradedAt)}, ${rt.durationSeconds}, ${rt.sideACount}, ${rt.sideBCount}, ${sqlBool(rt.isAsymmetric)}, ${sqlBool(rt.isSameClass)}, ${sqlBool(rt.isCleanSolo)}, ${sqlBool(rt.isSameEdition)}, ${rt.ratioMultiple}, ${sqlStr(rt.walletAShort)}, ${sqlStr(rt.walletBShort)}, ${sqlStr(rt.sideASummary)}, ${sqlStr(rt.sideBSummary)})`,
      );
    }
    pushBatchedInserts(
      tradeLines,
      "INSERT OR REPLACE INTO recent_trades (trade_id, artist_id, chain, traded_at, duration_seconds, side_a_count, side_b_count, is_asymmetric, is_same_class, is_clean_solo, is_same_edition, ratio_multiple, wallet_a_short, wallet_b_short, side_a_summary, side_b_summary)",
      recentTuples,
      10,
    );

    mkdirSync(resolve(tradesOutFile, ".."), { recursive: true });
    writeFileSync(tradesOutFile, tradeLines.join("\n") + "\n", "utf8");

    return {
      confirmedTradesCount,
      asymmetricTradesCount,
      confirmedTradedObjekts,
      directP2PTransfersCount,
      tradeCollectionsCount: colTradeMap.size,
      tradesOutFile,
    };
  } finally {
    if (attachedMeta) {
      transfersDb.exec("DETACH DATABASE meta_src;");
    }
  }
}
