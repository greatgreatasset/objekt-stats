import { inArray, eq } from "drizzle-orm";
import {
  createDb,
  members,
  saleRoundCollections,
  saleRounds,
  tokenMetadataCache,
  walletPolygonCache,
  type AppDatabase,
} from "@objekt-stats/db";
import {
  ABSTRACT_FIRST_NATIVE_TOKEN_ID,
  ZERO_ADDRESS,
  type WalletTokenMetadata,
  type WalletTransferLog,
} from "@objekt-stats/stats";

const COSMO_API = "https://api.cosmo.fans";
const DEFAULT_ABSTRACT_RPC = "https://api.mainnet.abs.xyz";
const DEFAULT_POLYGON_RPC = "https://polygon.gateway.tenderly.co";

const ABSTRACT_OBJEKT = "0x99bb83ae9bb0c0a6be865cacf67760947f91cb70";
const ABSTRACT_START_BLOCK = 6_363_806;

const POLYGON_OBJEKT_TRIPLES = "0xa4b37be40f7b231ee9574c4b16b7ddb7eacdc99b";
const POLYGON_OBJEKT_ARTMS = "0x0fb69f54ba90f17578a59823e09e5a1f8f3fa200";
const COSMO_SPIN_ADDRESS = "0xd3d5f29881ad87bb10c1100e2c709c9596de345f";

const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const POLYGON_ERAS = [
  {
    index: 0,
    id: "era-0",
    label: "2022–Early 2023 (Atom01)",
    fromBlock: 33_000_000,
    toBlock: 40_000_000,
    includeArtms: false,
  },
  {
    index: 1,
    id: "era-1",
    label: "Mid 2023 (Binary01)",
    fromBlock: 40_000_001,
    toBlock: 46_000_000,
    includeArtms: false,
  },
  {
    index: 2,
    id: "era-2",
    label: "Late 2023 (Cream01)",
    fromBlock: 46_000_001,
    toBlock: 52_000_000,
    includeArtms: true,
  },
  {
    index: 3,
    id: "era-3",
    label: "Early–Mid 2024 (Divine01)",
    fromBlock: 52_000_001,
    toBlock: 58_000_000,
    includeArtms: true,
  },
  {
    index: 4,
    id: "era-4",
    label: "Mid–Late 2024 (Divine01–Ever01)",
    fromBlock: 58_000_001,
    toBlock: 64_000_000,
    includeArtms: true,
  },
  {
    index: 5,
    id: "era-5",
    label: "Nov 2024–Apr 2025 (Pre-Migration)",
    fromBlock: 64_000_001,
    toBlock: 70_500_000,
    includeArtms: true,
  },
] as const;

/** Verified Polygon block -> Unix seconds anchors for accurate fallback interpolation. */
const POLYGON_BLOCK_ANCHORS: ReadonlyArray<[number, number]> = [
  [28_000_000, 1_651_859_160], // 2022-05-06
  [34_500_617, 1_666_105_337], // 2022-10-18
  [40_000_000, 1_678_186_000], // 2023-03-07
  [47_177_648, 1_693_950_000], // 2023-09-05
  [52_000_000, 1_704_540_000], // 2024-01-06
  [58_236_522, 1_718_500_000], // 2024-06-15
  [64_326_580, 1_731_699_806], // 2024-11-15
  [70_500_000, 1_745_080_912], // 2025-04-19
];

interface RawRpcLog {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  blockTimestamp?: string;
}

export interface CosmoIdentity {
  nickname: string | null;
  address: string;
  profileImageUrl: string | null;
  inputType: "nickname" | "address";
}

export interface WalletMemberInfo {
  id: string;
  artistId: string;
  code: string;
  name: string;
  cosmoName: string;
  hexColor: string;
}

function addressToTopic(address: string): string {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function topicToAddress(topic: string): string {
  return "0x" + topic.slice(-40).toLowerCase();
}

function padUint256(n: number): string {
  return BigInt(n).toString(16).padStart(64, "0");
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function normalizeArtistId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower === "triples") return "triples";
  if (lower === "artms") return "artms";
  if (lower === "idntt") return "idntt";
  return lower;
}

function inferClassFromNo(collectionNo: string): string {
  const clean = collectionNo.toUpperCase();
  if (clean === "100Z") return "Welcome";
  if (clean.startsWith("1")) return "First";
  if (clean.startsWith("2")) return "Special";
  if (clean.startsWith("3")) return "Double";
  if (clean.startsWith("4")) return "Premier";
  if (clean.startsWith("5")) return "Motion";
  if (clean.startsWith("6")) return "Unit";
  return "Unknown";
}

async function jsonRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = 15_000,
  maxAttempts = 2,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
          continue;
        }
        throw new Error(`RPC HTTP ${res.status} on ${method}`);
      }
      const json = (await res.json()) as {
        result?: T;
        error?: { code: number; message: string };
      };
      if (json.error) {
        throw new Error(`RPC ${method} error ${json.error.code}: ${json.error.message}`);
      }
      return json.result as T;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Resolves a COSMO nickname (via official unauthenticated COSMO v3 endpoint)
 * or accepts a direct 0x EVM wallet address.
 */
export async function resolveCosmoIdentity(
  rawQuery: string,
): Promise<CosmoIdentity | null> {
  const clean = rawQuery.trim().replace(/^@+/, "");
  if (!clean) return null;

  if (/^0x[a-fA-F0-9]{40}$/.test(clean)) {
    return {
      nickname: null,
      address: clean.toLowerCase(),
      profileImageUrl: null,
      inputType: "address",
    };
  }

  const url = `${COSMO_API}/bff/v3/users/by-nickname/${encodeURIComponent(clean)}`;
  const res = await fetch(url, {
    headers: {
      "user-agent": "objektstats.com (wallet-cost)",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`COSMO user lookup returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    nickname?: string;
    address?: string;
    profileImageUrl?: string;
  };
  if (!json.address || !/^0x[a-fA-F0-9]{40}$/.test(json.address)) {
    return null;
  }

  return {
    nickname: json.nickname ?? clean,
    address: json.address.toLowerCase(),
    profileImageUrl: json.profileImageUrl || null,
    inputType: "nickname",
  };
}

/**
 * Fetches a user's COMPLETE Abstract Mainnet Objekt history (Apr 2025 -> head)
 * in ~500ms using 2 parallel topic-filtered `eth_getLogs` calls (with auto-split fallback).
 */
export async function fetchAbstractWalletLogs(
  walletAddress: string,
  abstractRpcUrl = DEFAULT_ABSTRACT_RPC,
): Promise<{
  logs: WalletTransferLog[];
  migratedTokenIds: number[];
  headBlock: number;
}> {
  const addr = walletAddress.toLowerCase();
  const topic = addressToTopic(addr);

  const headHex = await jsonRpc<string>(abstractRpcUrl, "eth_blockNumber", [], 10_000);
  const headBlock = Number(BigInt(headHex));

  async function queryRange(
    topics: Array<string | null>,
    fromB: number,
    toB: number,
    depth = 0,
  ): Promise<RawRpcLog[]> {
    try {
      return await jsonRpc<RawRpcLog[]>(
        abstractRpcUrl,
        "eth_getLogs",
        [
          {
            address: ABSTRACT_OBJEKT,
            topics,
            fromBlock: "0x" + fromB.toString(16),
            toBlock: "0x" + toB.toString(16),
          },
        ],
        15_000,
      );
    } catch (err) {
      if (depth >= 3 || toB - fromB < 50_000) throw err;
      const mid = Math.floor((fromB + toB) / 2);
      const [left, right] = await Promise.all([
        queryRange(topics, fromB, mid, depth + 1),
        queryRange(topics, mid + 1, toB, depth + 1),
      ]);
      return [...left, ...right];
    }
  }

  const [inRaw, outRaw] = await Promise.all([
    queryRange([ERC721_TRANSFER_TOPIC, null, topic], ABSTRACT_START_BLOCK, headBlock),
    queryRange([ERC721_TRANSFER_TOPIC, topic, null], ABSTRACT_START_BLOCK, headBlock),
  ]);

  const seen = new Set<string>();
  const logs: WalletTransferLog[] = [];
  const migratedSet = new Set<number>();

  for (const raw of [...inRaw, ...outRaw]) {
    if (!raw.topics || raw.topics.length < 4) continue;
    const txHash = raw.transactionHash.toLowerCase();
    const logIndex = Number(BigInt(raw.logIndex));
    const key = `${txHash}:${logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const from = topicToAddress(raw.topics[1]!);
    const to = topicToAddress(raw.topics[2]!);
    const tokenId = Number(BigInt(raw.topics[3]!));
    const blockNumber = Number(BigInt(raw.blockNumber));
    const tsSec = raw.blockTimestamp
      ? Number(BigInt(raw.blockTimestamp))
      : Math.floor(Date.now() / 1000);
    const timestamp = new Date(tsSec * 1000).toISOString();

    if (from === ZERO_ADDRESS && to === addr && tokenId < ABSTRACT_FIRST_NATIVE_TOKEN_ID) {
      migratedSet.add(tokenId);
    }

    logs.push({
      chain: "abstract",
      txHash,
      logIndex,
      blockNumber,
      timestamp,
      from,
      to,
      tokenId,
    });
  }

  logs.sort(
    (a, b) =>
      a.blockNumber - b.blockNumber ||
      a.logIndex - b.logIndex ||
      a.txHash.localeCompare(b.txHash),
  );

  return {
    logs,
    migratedTokenIds: Array.from(migratedSet),
    headBlock,
  };
}

/**
 * Automatically links an Abstract user to their legacy pre-migration Polygon
 * Ramper wallet by calling `ownerOf(tokenId)` on the frozen Polygon Objekt contracts
 * for up to 3 migrated tokenIds (~100ms).
 */
export async function detectLegacyPolygonAddress(
  migratedTokenIds: number[],
  polygonRpcUrl = DEFAULT_POLYGON_RPC,
): Promise<string | null> {
  if (migratedTokenIds.length === 0) return null;

  // Sample up to 3 evenly spaced migrated tokenIds for unanimous verification
  const samples: number[] = [];
  if (migratedTokenIds.length <= 3) {
    samples.push(...migratedTokenIds);
  } else {
    samples.push(
      migratedTokenIds[0]!,
      migratedTokenIds[Math.floor(migratedTokenIds.length / 2)]!,
      migratedTokenIds[migratedTokenIds.length - 1]!,
    );
  }

  const checkOwner = async (contract: string, tokenId: number): Promise<string | null> => {
    try {
      const hex = await jsonRpc<string>(
        polygonRpcUrl,
        "eth_call",
        [{ to: contract, data: "0x6352211e" + padUint256(tokenId) }, "latest"],
        6_000,
      );
      if (!hex || hex.length < 42) return null;
      const addr = "0x" + hex.slice(-40).toLowerCase();
      if (addr === ZERO_ADDRESS || addr === COSMO_SPIN_ADDRESS) return null;
      return addr;
    } catch {
      return null;
    }
  };

  const results = await Promise.all(
    samples.map(async (tid) => {
      const tOwner = await checkOwner(POLYGON_OBJEKT_TRIPLES, tid);
      if (tOwner) return tOwner;
      return checkOwner(POLYGON_OBJEKT_ARTMS, tid);
    }),
  );

  const counts = new Map<string, number>();
  for (const r of results) {
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  let bestAddr: string | null = null;
  let bestCount = 0;
  for (const [addr, cnt] of counts.entries()) {
    if (cnt > bestCount) {
      bestAddr = addr;
      bestCount = cnt;
    }
  }
  return bestAddr;
}

function interpolatePolygonTimestamp(
  blockNumber: number,
  exactMap: ReadonlyMap<number, number>,
): string {
  const exact = exactMap.get(blockNumber);
  if (exact !== undefined) {
    return new Date(exact * 1000).toISOString();
  }

  // Combine verified global anchors + exact fetched blocks in this chunk
  const anchors: Array<[number, number]> = [...POLYGON_BLOCK_ANCHORS];
  for (const [bn, ts] of exactMap.entries()) {
    anchors.push([bn, ts]);
  }
  anchors.sort((a, b) => a[0] - b[0]);

  if (blockNumber <= anchors[0]![0]) {
    const [b0, t0] = anchors[0]!;
    return new Date((t0 - (b0 - blockNumber) * 2.15) * 1000).toISOString();
  }
  const last = anchors[anchors.length - 1]!;
  if (blockNumber >= last[0]) {
    return new Date((last[1] + (blockNumber - last[0]) * 2.15) * 1000).toISOString();
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    const [b0, t0] = anchors[i]!;
    const [b1, t1] = anchors[i + 1]!;
    if (blockNumber >= b0 && blockNumber <= b1) {
      const ratio = b1 > b0 ? (blockNumber - b0) / (b1 - b0) : 0;
      const estSec = Math.round(t0 + ratio * (t1 - t0));
      return new Date(estSec * 1000).toISOString();
    }
  }
  return new Date(last[1] * 1000).toISOString();
}

async function fetchPolygonBlockTimestampsBatch(
  polygonRpcUrl: string,
  priorityBlocks: number[],
  allBlocks: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (allBlocks.length === 0) return result;

  const selectedSet = new Set<number>();
  // Prioritize P2P/spin blocks first so 30-min reciprocal trade windows use exact timestamps
  const uniquePriority = Array.from(new Set(priorityBlocks)).sort((a, b) => a - b);
  if (uniquePriority.length <= 16) {
    for (const bn of uniquePriority) selectedSet.add(bn);
  } else {
    const step = (uniquePriority.length - 1) / 15;
    for (let i = 0; i < 16; i++) {
      selectedSet.add(uniquePriority[Math.round(i * step)]!);
    }
  }

  const uniqueAll = Array.from(new Set(allBlocks)).sort((a, b) => a - b);
  const remainingSlots = Math.max(0, 24 - selectedSet.size);
  if (uniqueAll.length <= remainingSlots) {
    for (const bn of uniqueAll) selectedSet.add(bn);
  } else if (remainingSlots > 0) {
    const step = (uniqueAll.length - 1) / Math.max(1, remainingSlots - 1);
    for (let i = 0; i < remainingSlots; i++) {
      selectedSet.add(uniqueAll[Math.round(i * step)]!);
    }
  }
  const selected = Array.from(selectedSet).sort((a, b) => a - b);

  try {
    const payload = selected.map((bn, idx) => ({
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: ["0x" + bn.toString(16), false],
      id: idx + 1,
    }));
    const res = await fetch(polygonRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return result;
    const json = (await res.json()) as Array<{
      id: number;
      result?: { timestamp?: string };
    }>;
    if (Array.isArray(json)) {
      for (const item of json) {
        const bn = selected[item.id - 1];
        if (bn !== undefined && item.result?.timestamp) {
          result.set(bn, Number(BigInt(item.result.timestamp)));
        }
      }
    }
  } catch {
    // Graceful fallback to global verified Polygon anchor table
  }
  return result;
}

/**
 * Reads cached frozen Polygon logs for a wallet (if all 4 eras are cached under
 * the consolidated key) from D1 `wallet_polygon_cache`.
 */
export async function getCachedPolygonLogs(
  db: AppDatabase,
  polygonAddress: string,
): Promise<WalletTransferLog[] | null> {
  const addr = polygonAddress.toLowerCase();
  try {
    const [row] = await db
      .select()
      .from(walletPolygonCache)
      .where(eq(walletPolygonCache.polygonAddress, addr))
      .limit(1);
    if (!row) return null;
    const parsed = JSON.parse(row.logsJson) as WalletTransferLog[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fetches ONE Polygon historical era chunk server-side (verified RPC data),
 * caches the era chunk in D1, and when all 4 eras are present consolidates
 * the full Polygon history under `polygonAddress` permanently.
 */
export async function fetchAndCachePolygonEra(
  db: AppDatabase,
  rawD1: D1Database,
  polygonAddress: string,
  eraIndex: number,
  polygonRpcUrl = DEFAULT_POLYGON_RPC,
): Promise<{
  eraIndex: number;
  eraLabel: string;
  logs: WalletTransferLog[];
  fromCache: boolean;
}> {
  const era = POLYGON_ERAS[eraIndex];
  if (!era) {
    throw new Error(`Invalid Polygon eraIndex: ${eraIndex}`);
  }

  const addr = polygonAddress.toLowerCase();
  const eraCacheKey = `${addr}#${era.id}`;

  // 1. Check D1 era cache first
  try {
    const [cached] = await db
      .select()
      .from(walletPolygonCache)
      .where(eq(walletPolygonCache.polygonAddress, eraCacheKey))
      .limit(1);
    if (cached) {
      const parsed = JSON.parse(cached.logsJson) as WalletTransferLog[];
      if (Array.isArray(parsed)) {
        return {
          eraIndex: era.index,
          eraLabel: era.label,
          logs: parsed,
          fromCache: true,
        };
      }
    }
  } catch {
    // Table may not be migrated yet — proceed live
  }

  // 2. Query Polygon RPC cleanly (sequential per-direction with half-split retry so Tenderly stays happy)
  const topic = addressToTopic(addr);

  async function queryPoly(
    contract: string,
    topics: Array<string | null>,
    fromB: number,
    toB: number,
    depth = 0,
  ): Promise<RawRpcLog[]> {
    try {
      return await jsonRpc<RawRpcLog[]>(
        polygonRpcUrl,
        "eth_getLogs",
        [
          {
            address: contract,
            topics,
            fromBlock: "0x" + fromB.toString(16),
            toBlock: "0x" + toB.toString(16),
          },
        ],
        12_000,
        1,
      );
    } catch (err) {
      if (depth >= 2 || toB - fromB < 1_000_000) throw err;
      const mid = Math.floor((fromB + toB) / 2);
      const left = await queryPoly(contract, topics, fromB, mid, depth + 1);
      const right = await queryPoly(contract, topics, mid + 1, toB, depth + 1);
      return [...left, ...right];
    }
  }

  const rawLogs: RawRpcLog[] = [];

  // Run tripleS in + out (2 concurrent calls max to avoid Tenderly throttling)
  const [tIn, tOut] = await Promise.all([
    queryPoly(
      POLYGON_OBJEKT_TRIPLES,
      [ERC721_TRANSFER_TOPIC, null, topic],
      era.fromBlock,
      era.toBlock,
    ),
    queryPoly(
      POLYGON_OBJEKT_TRIPLES,
      [ERC721_TRANSFER_TOPIC, topic, null],
      era.fromBlock,
      era.toBlock,
    ),
  ]);
  rawLogs.push(...tIn, ...tOut);

  if (era.includeArtms) {
    const [aIn, aOut] = await Promise.all([
      queryPoly(
        POLYGON_OBJEKT_ARTMS,
        [ERC721_TRANSFER_TOPIC, null, topic],
        era.fromBlock,
        era.toBlock,
      ),
      queryPoly(
        POLYGON_OBJEKT_ARTMS,
        [ERC721_TRANSFER_TOPIC, topic, null],
        era.fromBlock,
        era.toBlock,
      ),
    ]);
    rawLogs.push(...aIn, ...aOut);
  }

  // Dedupe & resolve block timestamps accurately
  const seen = new Set<string>();
  const deduped: Array<{
    txHash: string;
    logIndex: number;
    blockNumber: number;
    from: string;
    to: string;
    tokenId: number;
  }> = [];

  for (const r of rawLogs) {
    if (!r.topics || r.topics.length < 4) continue;
    const txHash = r.transactionHash.toLowerCase();
    const logIndex = Number(BigInt(r.logIndex));
    const key = `${txHash}:${logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);

    deduped.push({
      txHash,
      logIndex,
      blockNumber: Number(BigInt(r.blockNumber)),
      from: topicToAddress(r.topics[1]!),
      to: topicToAddress(r.topics[2]!),
      tokenId: Number(BigInt(r.topics[3]!)),
    });
  }

  // Prioritize exact timestamps for P2P/spin blocks + evenly spaced anchors
  const p2pBlocks = deduped
    .filter((d) => d.from !== ZERO_ADDRESS)
    .map((d) => d.blockNumber);
  const allBlocks = deduped.map((d) => d.blockNumber);
  const exactTsMap = await fetchPolygonBlockTimestampsBatch(
    polygonRpcUrl,
    p2pBlocks,
    allBlocks,
  );

  const logs: WalletTransferLog[] = deduped
    .map((d) => ({
      chain: "polygon" as const,
      txHash: d.txHash,
      logIndex: d.logIndex,
      blockNumber: d.blockNumber,
      timestamp: interpolatePolygonTimestamp(d.blockNumber, exactTsMap),
      from: d.from,
      to: d.to,
      tokenId: d.tokenId,
    }))
    .sort(
      (a, b) =>
        a.blockNumber - b.blockNumber ||
        a.logIndex - b.logIndex ||
        a.txHash.localeCompare(b.txHash),
    );

  // 3. Persist era cache in D1 (best-effort) and consolidate full wallet cache once all 4 eras are stored
  try {
    const now = new Date().toISOString();
    await rawD1
      .prepare(
        `INSERT OR REPLACE INTO wallet_polygon_cache (polygon_address, logs_json, tx_count, cached_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(eraCacheKey, JSON.stringify(logs), logs.length, now)
      .run();

    const allEraKeys = POLYGON_ERAS.map((e) => `${addr}#${e.id}`);
    const existingEras = await db
      .select()
      .from(walletPolygonCache)
      .where(inArray(walletPolygonCache.polygonAddress, allEraKeys));

    if (existingEras.length === POLYGON_ERAS.length) {
      const combined: WalletTransferLog[] = [];
      for (const row of existingEras) {
        const arr = JSON.parse(row.logsJson) as WalletTransferLog[];
        if (Array.isArray(arr)) combined.push(...arr);
      }
      combined.sort(
        (a, b) =>
          a.blockNumber - b.blockNumber ||
          a.logIndex - b.logIndex ||
          a.txHash.localeCompare(b.txHash),
      );
      await rawD1
        .prepare(
          `INSERT OR REPLACE INTO wallet_polygon_cache (polygon_address, logs_json, tx_count, cached_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(addr, JSON.stringify(combined), combined.length, now)
        .run();
    }
  } catch {
    // Graceful no-op if cache table isn't migrated yet
  }

  return {
    eraIndex: era.index,
    eraLabel: era.label,
    logs,
    fromCache: false,
  };
}

/**
 * Reads already-cached token metadata from D1 `token_metadata_cache` in safe chunks.
 */
export async function readCachedTokenMetadata(
  db: AppDatabase,
  tokenIds: number[],
): Promise<{
  found: Record<number, WalletTokenMetadata>;
  missingIds: number[];
  uncachedIds: number[];
}> {
  const unique = Array.from(
    new Set(tokenIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  const found: Record<number, WalletTokenMetadata> = {};
  const missingSet = new Set<number>();
  const cachedSet = new Set<number>();

  try {
    for (let i = 0; i < unique.length; i += 80) {
      const slice = unique.slice(i, i + 80);
      const rows = await db
        .select()
        .from(tokenMetadataCache)
        .where(inArray(tokenMetadataCache.tokenId, slice));

      for (const r of rows) {
        cachedSet.add(r.tokenId);
        if (r.isMissing) {
          missingSet.add(r.tokenId);
        } else {
          found[r.tokenId] = {
            tokenId: r.tokenId,
            slug: r.slug,
            collectionId: r.collectionId,
            artistId: r.artistId,
            rawArtist: r.rawArtist,
            memberName: r.memberName,
            season: r.season,
            objektClass: r.objektClass,
            collectionNo: r.collectionNo,
            onOffline: r.onOffline === "offline" ? "offline" : "online",
            imageUrl: r.imageUrl ?? null,
            backgroundColor: r.backgroundColor ?? null,
          };
        }
      }
    }
  } catch {
    // Table may not be migrated yet — treat all as uncached
  }

  const uncachedIds = unique.filter((id) => !cachedSet.has(id));
  return {
    found,
    missingIds: Array.from(missingSet),
    uncachedIds,
  };
}

async function fetchSingleCosmoMetadataV3(
  tokenId: number,
): Promise<{ status: "ok"; meta: WalletTokenMetadata } | { status: "missing" } | { status: "error" }> {
  try {
    const res = await fetch(`${COSMO_API}/bff/v3/objekts/nft-metadata/${tokenId}`, {
      headers: {
        "user-agent": "objektstats.com (wallet-cost)",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (res.status === 404) return { status: "missing" };
    if (!res.ok) return { status: "error" };

    const raw = (await res.json()) as {
      image?: string;
      background_color?: string;
      attributes?: Array<{ trait_type: string; value: string | number }>;
    };

    const attrs = new Map<string, string>();
    for (const a of raw.attributes ?? []) {
      attrs.set(a.trait_type.toLowerCase(), String(a.value).trim());
    }

    const rawArtist = attrs.get("artist") ?? "";
    const memberName = attrs.get("member") ?? rawArtist;
    const season = attrs.get("season") ?? "";
    const collectionNo = attrs.get("collection") ?? "";
    const objektClass = attrs.get("class") || inferClassFromNo(collectionNo);

    if (!rawArtist || !season || !collectionNo) {
      return { status: "missing" };
    }

    const artistId = normalizeArtistId(rawArtist);
    const collectionId = `${season} ${memberName} ${collectionNo}`.trim();
    const slug = slugify(`${artistId}-${collectionId}`);
    const onOffline: "online" | "offline" = collectionNo
      .toUpperCase()
      .includes("Z")
      ? "online"
      : "offline";

    return {
      status: "ok",
      meta: {
        tokenId,
        slug,
        collectionId,
        artistId,
        rawArtist,
        memberName,
        season,
        objektClass,
        collectionNo,
        onOffline,
        imageUrl: raw.image || null,
        backgroundColor: raw.background_color || null,
      },
    };
  } catch {
    return { status: "error" };
  }
}

/**
 * Resolves up to `maxFetch` (default 30, safe for Cloudflare Workers 50-subrequest limit)
 * tokenIds via COSMO v3 metadata API with D1 read-through & write-through caching.
 */
export async function resolveTokensBatchWithCache(
  db: AppDatabase,
  rawD1: D1Database,
  tokenIds: number[],
  maxFetch = 30,
): Promise<{
  resolved: Record<number, WalletTokenMetadata>;
  missingIds: number[];
  failedIds: number[];
  remainingIds: number[];
}> {
  const { found, missingIds, uncachedIds } = await readCachedTokenMetadata(
    db,
    tokenIds,
  );
  const toFetch = uncachedIds.slice(0, Math.min(maxFetch, 35));
  const remainingIds = uncachedIds.slice(toFetch.length);

  const newlyFound: WalletTokenMetadata[] = [];
  const newlyMissing: number[] = [];
  const failedIds: number[] = [];

  // Fetch in waves of 6 to be polite to COSMO API
  for (let i = 0; i < toFetch.length; i += 6) {
    const wave = toFetch.slice(i, i + 6);
    const results = await Promise.all(
      wave.map(async (id) => ({ id, res: await fetchSingleCosmoMetadataV3(id) })),
    );
    for (const { id, res } of results) {
      if (res.status === "ok") {
        found[id] = res.meta;
        newlyFound.push(res.meta);
      } else if (res.status === "missing") {
        missingIds.push(id);
        newlyMissing.push(id);
      } else {
        failedIds.push(id);
      }
    }
  }

  // Persist newly resolved & 404 tokens to D1 cache
  if (newlyFound.length > 0 || newlyMissing.length > 0) {
    try {
      const now = new Date().toISOString();
      const stmt = rawD1.prepare(
        `INSERT OR REPLACE INTO token_metadata_cache
          (token_id, slug, collection_id, artist_id, raw_artist, member_name, season, objekt_class, collection_no, on_offline, image_url, background_color, is_missing, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const batch: D1PreparedStatement[] = [];
      for (const m of newlyFound) {
        batch.push(
          stmt.bind(
            m.tokenId,
            m.slug,
            m.collectionId,
            m.artistId,
            m.rawArtist,
            m.memberName,
            m.season,
            m.objektClass,
            m.collectionNo,
            m.onOffline,
            m.imageUrl,
            m.backgroundColor,
            0,
            now,
          ),
        );
      }
      for (const id of newlyMissing) {
        batch.push(
          stmt.bind(id, "", "", "", "", "", "", "", "", "online", null, null, 1, now),
        );
      }
      await rawD1.batch(batch);
    } catch {
      // Graceful no-op if cache table isn't migrated yet
    }
  }

  return {
    resolved: found,
    missingIds,
    failedIds,
    remainingIds,
  };
}

/**
 * Loads official member hex colors / codes and curated round pricing hints from D1.
 */
export async function loadWalletReferenceData(db: AppDatabase): Promise<{
  members: WalletMemberInfo[];
  curatedPrices: Record<string, number>;
}> {
  const memberRows = await db
    .select({
      id: members.id,
      artistId: members.artistId,
      code: members.code,
      name: members.name,
      cosmoName: members.cosmoName,
      hexColor: members.hexColor,
    })
    .from(members)
    .catch(() => []);

  const curatedPrices: Record<string, number> = {};
  try {
    const roundCols = await db
      .select({
        collectionSlug: saleRoundCollections.collectionSlug,
        unitPriceUsd: saleRounds.unitPriceUsd,
        saleMechanic: saleRounds.saleMechanic,
      })
      .from(saleRoundCollections)
      .innerJoin(saleRounds, eq(saleRounds.slug, saleRoundCollections.roundSlug));

    for (const rc of roundCols) {
      if (rc.saleMechanic === "reward" || rc.unitPriceUsd === 0) {
        curatedPrices[rc.collectionSlug] = 0;
      } else if (rc.unitPriceUsd !== null && rc.unitPriceUsd > 0) {
        curatedPrices[rc.collectionSlug] = rc.unitPriceUsd;
      }
    }
  } catch {
    // Non-fatal
  }

  return {
    members: memberRows,
    curatedPrices,
  };
}

export function createWalletDb(d1: D1Database): AppDatabase {
  return createDb(d1);
}
