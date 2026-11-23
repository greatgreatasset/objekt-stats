import { eq, inArray, sql } from "drizzle-orm";
import {
  collectionDailyMints,
  collections,
  createDb,
  members,
  processedLiveMints,
  saleRoundCollections,
  saleRoundMemberStats,
  saleRounds,
  syncState,
  type AppDatabase,
} from "@objekt-stats/db";
import {
  computeArtistSeriesStats,
  type SaleRoundInput,
} from "@objekt-stats/stats";

const ABSTRACT_OBJEKT = "0x99bb83ae9bb0c0a6be865cacf67760947f91cb70";
const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const COSMO_API = "https://api.cosmo.fans";

interface RpcLog {
  blockNumber: string;
  topics: string[];
  blockTimestamp?: string;
}

interface ParsedMeta {
  slug: string;
  collectionId: string;
  artistId: string;
  rawMember: string;
  season: string;
  objektClass: string;
  collectionNo: string;
  onOffline: "online" | "offline";
  imageUrl: string;
  backgroundColor: string;
}

function slugifyCollection(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function normalizeMemberKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inferAutoRoundGroup(
  artistId: string,
  season: string,
  objektClass: string,
  collectionNo: string,
  onOffline: "online" | "offline",
) {
  const numMatch = /^(\d+)/.exec(collectionNo);
  const num = numMatch ? Number(numMatch[1]) : 0;
  const suffix = onOffline === "offline" ? "physical" : "digital";
  const seasonLower = season.toLowerCase();

  if (objektClass === "Welcome" || collectionNo.toUpperCase() === "100Z") {
    return {
      slug: `${artistId}-${seasonLower}-welcome-100z`,
      title: `${season} Welcome Objekt (100Z)`,
      saleMechanic: "reward",
      includeInPopularity: false,
      unitPriceUsd: 0,
    };
  }
  if (objektClass === "Zero") {
    return {
      slug: `${artistId}-${seasonLower}-zero-${collectionNo.toLowerCase()}`,
      title: `${season} Zero Class (${collectionNo})`,
      saleMechanic: "reward",
      includeInPopularity: false,
      unitPriceUsd: null,
    };
  }
  if (objektClass === "Special" || (num >= 200 && num < 300)) {
    return {
      slug: `${artistId}-${seasonLower}-sco-${collectionNo.toLowerCase()}`,
      title: `${season} Special Class (${collectionNo})`,
      saleMechanic: "reward",
      includeInPopularity: false,
      unitPriceUsd: null,
    };
  }
  if (objektClass === "First" || (num >= 101 && num < 200)) {
    let editionLabel = collectionNo;
    let editionKey = collectionNo.toLowerCase();
    if (num >= 101 && num <= 108) {
      editionLabel = `1st Edition FCO (101–108${onOffline === "online" ? "Z" : "A"})`;
      editionKey = `fco-ed1-${suffix}`;
    } else if (num >= 109 && num <= 116) {
      editionLabel = `2nd Edition FCO (109–116${onOffline === "online" ? "Z" : "A"})`;
      editionKey = `fco-ed2-${suffix}`;
    } else if (num >= 117 && num <= 120) {
      editionLabel = `3rd Edition FCO (117–120${onOffline === "online" ? "Z" : "A"})`;
      editionKey = `fco-ed3-${suffix}`;
    }
    return {
      slug: `${artistId}-${seasonLower}-${editionKey}`,
      title: `${season} ${editionLabel}`,
      saleMechanic: onOffline === "offline" ? "physical_scan" : "member_select",
      includeInPopularity: onOffline === "online",
      unitPriceUsd: onOffline === "online" ? 3.29 : null,
    };
  }
  if (objektClass === "Double" || (num >= 300 && num < 400)) {
    return {
      slug: `${artistId}-${seasonLower}-dco-${collectionNo.toLowerCase()}`,
      title: `${season} DCO ${collectionNo}`,
      saleMechanic: onOffline === "offline" ? "physical_scan" : "member_select",
      includeInPopularity: onOffline === "online",
      unitPriceUsd: onOffline === "online" ? 3.29 : null,
    };
  }
  if (objektClass === "Premier" || (num >= 400 && num < 500)) {
    return {
      slug: `${artistId}-${seasonLower}-pco-${collectionNo.toLowerCase()}`,
      title: `${season} PCO ${collectionNo}`,
      saleMechanic: onOffline === "offline" ? "physical_scan" : "member_select",
      includeInPopularity: onOffline === "online",
      unitPriceUsd: onOffline === "online" ? 3.29 : null,
    };
  }
  if (objektClass === "Motion" || (num >= 500 && num < 600)) {
    return {
      slug: `${artistId}-${seasonLower}-mco-${collectionNo.toLowerCase()}`,
      title: `${season} MCO ${collectionNo}`,
      saleMechanic: onOffline === "offline" ? "physical_scan" : "member_select",
      includeInPopularity: onOffline === "online",
      unitPriceUsd: onOffline === "online" ? 3.29 : null,
    };
  }
  if (objektClass === "Unit" || num >= 600) {
    return {
      slug: `${artistId}-${seasonLower}-unit-${collectionNo.toLowerCase()}`,
      title: `${season} Unit Objekt ${collectionNo}`,
      saleMechanic: onOffline === "offline" ? "physical_scan" : "unit_select",
      includeInPopularity: false,
      unitPriceUsd: onOffline === "online" ? 3.29 : null,
    };
  }
  return {
    slug: `${artistId}-${seasonLower}-${objektClass.toLowerCase()}-${collectionNo.toLowerCase()}`,
    title: `${season} ${objektClass} ${collectionNo}`,
    saleMechanic: onOffline === "offline" ? "physical_scan" : "member_select",
    includeInPopularity: onOffline === "online",
    unitPriceUsd: onOffline === "online" ? 3.29 : null,
  };
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} on ${method}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result as T;
}

async function fetchMetaV3(tokenId: number): Promise<ParsedMeta | null> {
  const res = await fetch(`${COSMO_API}/bff/v3/objekts/nft-metadata/${tokenId}`, {
    headers: {
      "user-agent": "objektstats.com (live-sync)",
      accept: "application/json",
    },
  });
  if (!res.ok) return null;
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
  const rawMember = attrs.get("member") ?? "";
  const season = attrs.get("season") ?? "";
  const objektClass = attrs.get("class") ?? "";
  const collectionNo = attrs.get("collection") ?? "";
  if (!rawArtist || !season || !collectionNo) return null;

  const lowerArtist = rawArtist.toLowerCase();
  const artistId =
    lowerArtist === "triples"
      ? "triples"
      : lowerArtist === "artms"
        ? "artms"
        : lowerArtist;
  const collectionId = `${season} ${rawMember || rawArtist} ${collectionNo}`.trim();
  const slug = slugifyCollection(`${artistId}-${collectionId}`);
  const onOffline: "online" | "offline" = collectionNo.toUpperCase().includes("Z")
    ? "online"
    : "offline";

  return {
    slug,
    collectionId,
    artistId,
    rawMember: rawMember || rawArtist,
    season,
    objektClass: objektClass || "First",
    collectionNo,
    onOffline,
    imageUrl: raw.image ?? "",
    backgroundColor: raw.background_color ?? "#09090b",
  };
}

/**
 * Recomputes `sale_rounds`, `sale_round_collections`, and `sale_round_member_stats`
 * directly from D1's `collections` table so edge cron sync stays 100% consistent.
 * Preserves existing curated (non-auto-detected) round titles/mechanics if present.
 */
export async function recomputeSaleRoundsInD1(db: AppDatabase, rawD1: D1Database) {
  const allMembers = await db.select().from(members);
  const memberTotalsByArtist = new Map<string, number>();
  for (const m of allMembers) {
    memberTotalsByArtist.set(
      m.artistId,
      (memberTotalsByArtist.get(m.artistId) ?? 0) + 1,
    );
  }

  const allCols = await db.select().from(collections);
  const existingRounds = await db.select().from(saleRounds);
  const curatedMetaBySlug = new Map(
    existingRounds
      .filter((r) => !r.isAutoDetected)
      .map((r) => [r.slug, r]),
  );

  interface RoundAcc {
    slug: string;
    artistId: string;
    title: string;
    season: string;
    objektClass: string;
    onOffline: "online" | "offline";
    saleMechanic: string;
    startAt: string;
    endAt: string;
    unitPriceUsd: number | null;
    includeInPopularity: boolean;
    isAutoDetected: boolean;
    notes: string | null;
    collectionSlugs: string[];
    memberMints: Map<string, number>;
  }

  const rounds = new Map<string, RoundAcc>();

  for (const col of allCols) {
    if (!col.memberId || col.totalMints <= 0) continue;
    if (col.artistId !== "triples" && col.artistId !== "artms") continue;

    const auto = inferAutoRoundGroup(
      col.artistId,
      col.season,
      col.objektClass,
      col.collectionNo,
      col.onOffline === "offline" ? "offline" : "online",
    );
    const curated = curatedMetaBySlug.get(auto.slug);

    const key = curated?.slug ?? auto.slug;
    let acc = rounds.get(key);
    const firstTs = col.firstMintAt ?? col.updatedAt;
    const lastTs = col.lastMintAt ?? col.updatedAt;

    if (!acc) {
      acc = {
        slug: key,
        artistId: col.artistId,
        title: curated?.title ?? auto.title,
        season: col.season,
        objektClass: col.objektClass,
        onOffline: col.onOffline === "offline" ? "offline" : "online",
        saleMechanic: curated?.saleMechanic ?? auto.saleMechanic,
        startAt: firstTs,
        endAt: lastTs,
        unitPriceUsd: curated?.unitPriceUsd ?? auto.unitPriceUsd,
        includeInPopularity:
          curated?.includeInPopularity ?? auto.includeInPopularity,
        isAutoDetected: curated ? false : true,
        notes: curated?.notes ?? null,
        collectionSlugs: [],
        memberMints: new Map(),
      };
      rounds.set(key, acc);
    }

    acc.collectionSlugs.push(col.slug);
    acc.memberMints.set(
      col.memberId,
      (acc.memberMints.get(col.memberId) ?? 0) + col.totalMints,
    );
    if (firstTs < acc.startAt) acc.startAt = firstTs;
    if (lastTs > acc.endAt) acc.endAt = lastTs;
  }

  const validRounds = Array.from(rounds.values()).filter(
    (r) => r.memberMints.size >= 2,
  );

  for (const r of validRounds) {
    const fullCount = memberTotalsByArtist.get(r.artistId) ?? 24;
    if (
      r.isAutoDetected &&
      r.saleMechanic === "member_select" &&
      r.memberMints.size <= Math.floor(fullCount * 0.6)
    ) {
      r.saleMechanic = "unit_select";
    }
  }

  const statsByRound = new Map<
    string,
    ReturnType<typeof computeArtistSeriesStats> extends Map<string, infer V> ? V : never
  >();

  for (const artistId of ["triples", "artms"] as const) {
    const input: SaleRoundInput[] = validRounds
      .filter((r) => r.artistId === artistId)
      .map((r) => ({
        slug: r.slug,
        artistId: r.artistId,
        startAt: r.startAt,
        includeInPopularity: r.includeInPopularity,
        memberMints: Array.from(r.memberMints.entries()).map(
          ([memberId, mintCount]) => ({ memberId, mintCount }),
        ),
      }));
    const computed = computeArtistSeriesStats(input);
    for (const [slug, rows] of computed.entries()) {
      statsByRound.set(slug, rows);
    }
  }

  // Batch statements in chunks of 80 for D1 efficiency
  const stmts: D1PreparedStatement[] = [
    rawD1.prepare("DELETE FROM sale_round_member_stats"),
    rawD1.prepare("DELETE FROM sale_round_collections"),
    rawD1.prepare("DELETE FROM sale_rounds"),
  ];

  const insertRound = rawD1.prepare(
    `INSERT OR REPLACE INTO sale_rounds
      (slug, artist_id, title, season, objekt_class, on_offline, sale_mechanic, start_at, end_at, unit_price_usd, total_mints, participating_members, include_in_popularity, is_auto_detected, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRoundCol = rawD1.prepare(
    `INSERT OR IGNORE INTO sale_round_collections (round_slug, collection_slug) VALUES (?, ?)`,
  );
  const insertStat = rawD1.prepare(
    `INSERT OR REPLACE INTO sale_round_member_stats
      (round_slug, member_id, mint_count, rank, share_pct, relative_index, z_score, rank_delta_prev, rolling5_rank, rolling10_rank, rolling5_relative_index, rolling10_relative_index, is_anomaly, anomaly_direction, anomaly_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const r of validRounds) {
    const totalMints = Array.from(r.memberMints.values()).reduce(
      (a, b) => a + b,
      0,
    );
    stmts.push(
      insertRound.bind(
        r.slug,
        r.artistId,
        r.title,
        r.season,
        r.objektClass,
        r.onOffline,
        r.saleMechanic,
        r.startAt,
        r.endAt,
        r.unitPriceUsd,
        totalMints,
        r.memberMints.size,
        r.includeInPopularity ? 1 : 0,
        r.isAutoDetected ? 1 : 0,
        r.notes,
      ),
    );
    for (const cSlug of r.collectionSlugs) {
      stmts.push(insertRoundCol.bind(r.slug, cSlug));
    }
    for (const s of statsByRound.get(r.slug) ?? []) {
      stmts.push(
        insertStat.bind(
          s.roundSlug,
          s.memberId,
          s.mintCount,
          s.rank,
          s.sharePct,
          s.relativeIndex,
          s.zScore,
          s.rankDeltaPrev,
          s.rolling5Rank,
          s.rolling10Rank,
          s.rolling5RelativeIndex,
          s.rolling10RelativeIndex,
          s.isAnomaly ? 1 : 0,
          s.anomalyDirection,
          s.anomalyReason,
        ),
      );
    }
  }

  for (let i = 0; i < stmts.length; i += 100) {
    await rawD1.batch(stmts.slice(i, i + 100));
  }

  return { roundsUpdated: validRounds.length };
}

export interface LiveSyncResult {
  fromBlock: number;
  toBlock: number;
  headBlock: number;
  tokensResolved: number;
  trackedMintsAdded: number;
  roundsUpdated: number;
  skippedReason?: string;
}

/**
 * Automated continuous live sync executed by Cloudflare Workers Cron Trigger.
 * Stays safely within Worker subrequest budgets via `SYNC_MAX_TOKENS` (default 35),
 * deduplicates via `processed_live_mints`, and never skips blocks mid-drop.
 */
export async function runEdgeLiveSync(env: Env): Promise<LiveSyncResult> {
  const db = createDb(env.DB);
  const rpcUrl = env.ABSTRACT_RPC_URL || "https://api.mainnet.abs.xyz";
  const maxTokens = Math.min(
    800,
    Math.max(10, Number(env.SYNC_MAX_TOKENS || "35")),
  );

  const headHex = await rpc<string>(rpcUrl, "eth_blockNumber", []);
  const headBlock = Number(BigInt(headHex));

  const [state] = await db
    .select()
    .from(syncState)
    .where(eq(syncState.chain, "abstract"))
    .limit(1);

  const fromBlock = state?.lastIndexedBlock
    ? state.lastIndexedBlock
    : Math.max(6_363_806, headBlock - 500);
  const toBlock = Math.min(headBlock, fromBlock + 1_500);

  if (fromBlock > headBlock) {
    return {
      fromBlock,
      toBlock: headBlock,
      headBlock,
      tokensResolved: 0,
      trackedMintsAdded: 0,
      roundsUpdated: 0,
      skippedReason: "already_at_head",
    };
  }

  const logs = await rpc<RpcLog[]>(rpcUrl, "eth_getLogs", [
    {
      address: ABSTRACT_OBJEKT,
      topics: [ERC721_TRANSFER_TOPIC, ZERO_TOPIC],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    },
  ]);

  const parsedLogs = logs
    .filter((l) => l.topics.length >= 4)
    .map((l) => ({
      blockNumber: Number(BigInt(l.blockNumber)),
      tokenId: Number(BigInt(l.topics[3]!)),
      timestampIso: l.blockTimestamp
        ? new Date(Number(BigInt(l.blockTimestamp)) * 1000).toISOString()
        : new Date().toISOString(),
    }));

  // Deduplicate against processed_live_mints in <= 80-param chunks (D1 100-param safe)
  const seen = new Set<number>();
  const uniqueIds = Array.from(new Set(parsedLogs.map((l) => l.tokenId)));
  for (let i = 0; i < uniqueIds.length; i += 80) {
    const slice = uniqueIds.slice(i, i + 80);
    const rows = await db
      .select({ tokenId: processedLiveMints.tokenId })
      .from(processedLiveMints)
      .where(inArray(processedLiveMints.tokenId, slice));
    for (const r of rows) seen.add(r.tokenId);
  }

  const pending = parsedLogs.filter((l) => !seen.has(l.tokenId));
  const batch = pending.slice(0, maxTokens);

  if (batch.length === 0) {
    // Advance cursor cleanly to toBlock
    await db
      .insert(syncState)
      .values({
        chain: "abstract",
        lastIndexedBlock: toBlock,
        lastIndexedTimestamp: new Date().toISOString(),
        totalTokensIndexed: state?.totalTokensIndexed ?? 0,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: syncState.chain,
        set: {
          lastIndexedBlock: toBlock,
          updatedAt: new Date().toISOString(),
        },
      });

    return {
      fromBlock,
      toBlock,
      headBlock,
      tokensResolved: 0,
      trackedMintsAdded: 0,
      roundsUpdated: 0,
      skippedReason: "no_new_mints",
    };
  }

  // Fetch metadata in polite waves of 10
  const resolved: Array<{
    tokenId: number;
    blockNumber: number;
    timestampIso: string;
    meta: ParsedMeta | null;
  }> = [];

  for (let i = 0; i < batch.length; i += 10) {
    const wave = batch.slice(i, i + 10);
    const waveRes = await Promise.all(
      wave.map(async (item) => ({
        ...item,
        meta: await fetchMetaV3(item.tokenId).catch(() => null),
      })),
    );
    resolved.push(...waveRes);
  }

  // Load member lookup map
  const allMembers = await db.select().from(members);
  const memberLookup = new Map<string, string>();
  for (const m of allMembers) {
    memberLookup.set(`${m.artistId}:${normalizeMemberKey(m.name)}`, m.id);
    memberLookup.set(`${m.artistId}:${normalizeMemberKey(m.cosmoName)}`, m.id);
    memberLookup.set(`${m.artistId}:${normalizeMemberKey(m.fullName)}`, m.id);
  }

  // Aggregate deltas in-memory before writing cleanly to D1
  const colDeltas = new Map<
    string,
    {
      meta: ParsedMeta;
      memberId: string | null;
      count: number;
      firstAt: string;
      lastAt: string;
    }
  >();
  const dailyDeltas = new Map<string, { slug: string; date: string; count: number }>();

  let trackedMintsAdded = 0;
  const now = new Date().toISOString();

  for (const item of resolved) {
    if (!item.meta) continue;
    if (item.meta.artistId !== "triples" && item.meta.artistId !== "artms") {
      continue;
    }
    trackedMintsAdded++;
    const memberId =
      memberLookup.get(
        `${item.meta.artistId}:${normalizeMemberKey(item.meta.rawMember)}`,
      ) ?? null;

    const existing = colDeltas.get(item.meta.slug);
    if (existing) {
      existing.count++;
      if (item.timestampIso < existing.firstAt) existing.firstAt = item.timestampIso;
      if (item.timestampIso > existing.lastAt) existing.lastAt = item.timestampIso;
    } else {
      colDeltas.set(item.meta.slug, {
        meta: item.meta,
        memberId,
        count: 1,
        firstAt: item.timestampIso,
        lastAt: item.timestampIso,
      });
    }

    const day = item.timestampIso.slice(0, 10);
    const dKey = `${item.meta.slug}|${day}`;
    const dPrev = dailyDeltas.get(dKey);
    if (dPrev) {
      dPrev.count++;
    } else {
      dailyDeltas.set(dKey, { slug: item.meta.slug, date: day, count: 1 });
    }
  }

  const writeStmts: D1PreparedStatement[] = [];
  const markToken = env.DB.prepare(
    "INSERT OR IGNORE INTO processed_live_mints (token_id, synced_at) VALUES (?, ?)",
  );
  for (const item of resolved) {
    writeStmts.push(markToken.bind(item.tokenId, now));
  }

  const upsertCol = env.DB.prepare(
    `INSERT INTO collections
      (slug, collection_id, artist_id, member_id, raw_member_name, season, objekt_class, collection_no, on_offline, como_amount, total_mints, max_serial, spun_count, unique_minters, first_mint_at, last_mint_at, front_image_url, thumbnail_image_url, accent_color, background_color, text_color, is_unobtainable, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)
     ON CONFLICT(slug) DO UPDATE SET
       total_mints = collections.total_mints + excluded.total_mints,
       max_serial = MAX(collections.max_serial, collections.total_mints + excluded.total_mints),
       unique_minters = collections.unique_minters + excluded.unique_minters,
       first_mint_at = CASE WHEN collections.first_mint_at IS NULL OR excluded.first_mint_at < collections.first_mint_at THEN excluded.first_mint_at ELSE collections.first_mint_at END,
       last_mint_at = CASE WHEN collections.last_mint_at IS NULL OR excluded.last_mint_at > collections.last_mint_at THEN excluded.last_mint_at ELSE collections.last_mint_at END,
       front_image_url = COALESCE(NULLIF(collections.front_image_url, ''), excluded.front_image_url),
       updated_at = excluded.updated_at`,
  );

  for (const d of colDeltas.values()) {
    const como =
      d.meta.objektClass === "Double" || d.meta.objektClass === "Premier" ? 2 : 1;
    writeStmts.push(
      upsertCol.bind(
        d.meta.slug,
        d.meta.collectionId,
        d.meta.artistId,
        d.memberId,
        d.meta.rawMember,
        d.meta.season,
        d.meta.objektClass,
        d.meta.collectionNo,
        d.meta.onOffline,
        como,
        d.count,
        d.count,
        d.count,
        d.firstAt,
        d.lastAt,
        d.meta.imageUrl,
        d.meta.imageUrl,
        d.meta.backgroundColor,
        d.meta.backgroundColor,
        now,
      ),
    );
  }

  const upsertDaily = env.DB.prepare(
    `INSERT INTO collection_daily_mints (collection_slug, mint_date, mint_count, unique_minters, spin_count)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(collection_slug, mint_date) DO UPDATE SET
       mint_count = collection_daily_mints.mint_count + excluded.mint_count,
       unique_minters = collection_daily_mints.unique_minters + excluded.unique_minters`,
  );
  for (const d of dailyDeltas.values()) {
    writeStmts.push(upsertDaily.bind(d.slug, d.date, d.count, d.count));
  }

  // Only advance cursor past blocks where all pending tokens were consumed
  const allConsumed = pending.length <= batch.length;
  const highestBatchBlock = batch[batch.length - 1]!.blockNumber;
  const newCursorBlock = allConsumed ? toBlock : highestBatchBlock;
  const newCursorTs = batch[batch.length - 1]!.timestampIso;

  writeStmts.push(
    env.DB.prepare(
      `INSERT INTO sync_state (chain, last_indexed_block, last_indexed_timestamp, total_tokens_indexed, updated_at)
       VALUES ('abstract', ?, ?, ?, ?)
       ON CONFLICT(chain) DO UPDATE SET
         last_indexed_block = MAX(sync_state.last_indexed_block, excluded.last_indexed_block),
         last_indexed_timestamp = excluded.last_indexed_timestamp,
         total_tokens_indexed = sync_state.total_tokens_indexed + ?,
         updated_at = excluded.updated_at`,
    ).bind(
      newCursorBlock,
      newCursorTs,
      (state?.totalTokensIndexed ?? 0) + resolved.length,
      now,
      resolved.length,
    ),
  );

  // Prune processed_live_mints older than 14 days to keep table compact
  const cutoffIso = new Date(Date.now() - 14 * 86_400_000).toISOString();
  writeStmts.push(
    env.DB.prepare("DELETE FROM processed_live_mints WHERE synced_at < ?").bind(
      cutoffIso,
    ),
  );

  for (let i = 0; i < writeStmts.length; i += 80) {
    await env.DB.batch(writeStmts.slice(i, i + 80));
  }

  let roundsUpdated = 0;
  if (trackedMintsAdded > 0) {
    const rec = await recomputeSaleRoundsInD1(db, env.DB);
    roundsUpdated = rec.roundsUpdated;
  }

  // Ensure sql import stays referenced cleanly
  void sql;

  return {
    fromBlock,
    toBlock: newCursorBlock,
    headBlock,
    tokensResolved: resolved.length,
    trackedMintsAdded,
    roundsUpdated,
  };
}
