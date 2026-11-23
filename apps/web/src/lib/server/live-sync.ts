import { eq, inArray, sql } from "drizzle-orm";
import {
  collectionDailyMints,
  collections,
  createDb,
  memberTradeStats,
  members,
  pendingP2pTransfers,
  processedLiveMints,
  saleRoundCollections,
  saleRoundMemberStats,
  saleRounds,
  syncState,
  type AppDatabase,
} from "@objekt-stats/db";
import {
  classifyTradeSymmetry,
  computeArtistSeriesStats,
  computeMemberTradeRankings,
  detectTradesFromTransfers,
  isCleanSoloPremiumSwap,
  isEligibleP2PTransfer,
  isRealisticAsymmetricSwap,
  isSameClassSwap,
  isSameEditionSoloSwap,
  makeWalletPairKey,
  shortenAddress,
  type P2PTransferEvent,
  type SaleRoundInput,
} from "@objekt-stats/stats";

const ABSTRACT_OBJEKT = "0x99bb83ae9bb0c0a6be865cacf67760947f91cb70";
const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const COSMO_API = "https://api.cosmo.fans";

function topicToAddress(topic: string): string {
  return "0x" + topic.slice(-40).toLowerCase();
}

interface RpcLog {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
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
export async function recomputeSaleRoundsInD1(
  db: AppDatabase,
  rawD1: D1Database,
  dirtyRounds?: Set<string>,
) {
  const allMembers = await db.select().from(members);
  const memberTotalsByArtist = new Map<string, number>();
  for (const m of allMembers) {
    memberTotalsByArtist.set(
      m.artistId,
      (memberTotalsByArtist.get(m.artistId) ?? 0) + 1,
    );
  }

  const existingRounds = await db.select().from(saleRounds);
  const curatedMetaBySlug = new Map(
    existingRounds
      .filter((r) => !r.isAutoDetected)
      .map((r) => [r.slug, r]),
  );

  // When live-sync touches only 1-5 active rounds, skip loading all 20k historical collections
  const dirtySeasons = new Set<string>();
  const existingRoundBySlug = new Map(existingRounds.map((r) => [r.slug, r]));
  if (dirtyRounds && dirtyRounds.size > 0) {
    for (const slug of dirtyRounds) {
      const ex = existingRoundBySlug.get(slug);
      if (ex) dirtySeasons.add(ex.season);
    }
  }

  const allCols =
    dirtyRounds && dirtyRounds.size > 0 && dirtySeasons.size > 0 && dirtySeasons.size <= 10
      ? await db
          .select()
          .from(collections)
          .where(inArray(collections.season, Array.from(dirtySeasons)))
      : await db.select().from(collections);

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
    memberUniqueBuyers: Map<string, number>;
  }

  const rounds = new Map<string, RoundAcc>();

  // Preserve exact deduplicated unique buyers & top-wallet share from deep indexer where available
  const existingRoundStats =
    dirtyRounds && dirtyRounds.size > 0 && dirtyRounds.size <= 40
      ? await db
          .select()
          .from(saleRoundMemberStats)
          .where(inArray(saleRoundMemberStats.roundSlug, Array.from(dirtyRounds)))
      : await db.select().from(saleRoundMemberStats);
  const existingStatByKey = new Map(
    existingRoundStats.map((s) => [`${s.roundSlug}|${s.memberId}`, s]),
  );
  const existingRoundBuyers = new Map(
    existingRounds.map((r) => [r.slug, r.uniqueBuyers]),
  );

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
        memberUniqueBuyers: new Map(),
      };
      rounds.set(key, acc);
    }

    acc.collectionSlugs.push(col.slug);
    acc.memberMints.set(
      col.memberId,
      (acc.memberMints.get(col.memberId) ?? 0) + col.totalMints,
    );
    acc.memberUniqueBuyers.set(
      col.memberId,
      Math.max(acc.memberUniqueBuyers.get(col.memberId) ?? 0, col.uniqueMinters),
    );
    if (firstTs < acc.startAt) acc.startAt = firstTs;
    if (lastTs > acc.endAt) acc.endAt = lastTs;
  }

  const validRounds = Array.from(rounds.values()).filter(
    (r) => r.memberMints.size >= 2 && (!dirtyRounds || dirtyRounds.size === 0 || dirtyRounds.has(r.slug)),
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
          ([memberId, mintCount]) => {
            const prev = existingStatByKey.get(`${r.slug}|${memberId}`);
            const estBuyers = Math.max(
              prev?.uniqueBuyers ?? 0,
              r.memberUniqueBuyers.get(memberId) ?? 1,
            );
            const topBuyerMints =
              prev?.topBuyerSharePct !== null &&
              prev?.topBuyerSharePct !== undefined &&
              prev.mintCount === mintCount
                ? Math.round((prev.topBuyerSharePct / 100) * mintCount)
                : undefined;
            return {
              memberId,
              mintCount,
              uniqueBuyers: Math.min(mintCount, estBuyers),
              topBuyerMints,
            };
          },
        ),
      }));
    const computed = computeArtistSeriesStats(input);
    for (const [slug, rows] of computed.entries()) {
      statsByRound.set(slug, rows);
    }
  }

  // Zero-downtime incremental UPSERT (NEVER wipe sale_rounds live on Cron ticks!)
  const stmts: D1PreparedStatement[] = [];

  const upsertRound = rawD1.prepare(
    `INSERT INTO sale_rounds
      (slug, artist_id, title, season, objekt_class, on_offline, sale_mechanic, start_at, end_at, unit_price_usd, total_mints, unique_buyers, participating_members, include_in_popularity, is_auto_detected, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       title = excluded.title,
       start_at = MIN(sale_rounds.start_at, excluded.start_at),
       end_at = MAX(COALESCE(sale_rounds.end_at, excluded.end_at), excluded.end_at),
       total_mints = excluded.total_mints,
       unique_buyers = MAX(sale_rounds.unique_buyers, excluded.unique_buyers),
       participating_members = excluded.participating_members`,
  );
  const insertRoundCol = rawD1.prepare(
    `INSERT OR IGNORE INTO sale_round_collections (round_slug, collection_slug) VALUES (?, ?)`,
  );
  const upsertStat = rawD1.prepare(
    `INSERT INTO sale_round_member_stats
      (round_slug, member_id, mint_count, unique_buyers, mints_per_buyer, top_buyer_share_pct, rank, unique_buyers_rank, share_pct, unique_buyers_share_pct, relative_index, unique_buyers_relative_index, z_score, rank_delta_prev, rolling5_rank, rolling10_rank, rolling5_relative_index, rolling10_relative_index, is_anomaly, anomaly_direction, anomaly_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round_slug, member_id) DO UPDATE SET
       mint_count = excluded.mint_count,
       unique_buyers = MAX(sale_round_member_stats.unique_buyers, excluded.unique_buyers),
       mints_per_buyer = excluded.mints_per_buyer,
       top_buyer_share_pct = COALESCE(excluded.top_buyer_share_pct, sale_round_member_stats.top_buyer_share_pct),
       rank = excluded.rank,
       unique_buyers_rank = excluded.unique_buyers_rank,
       share_pct = excluded.share_pct,
       unique_buyers_share_pct = excluded.unique_buyers_share_pct,
       relative_index = excluded.relative_index,
       unique_buyers_relative_index = excluded.unique_buyers_relative_index,
       z_score = excluded.z_score`,
  );

  for (const r of validRounds) {
    const totalMints = Array.from(r.memberMints.values()).reduce(
      (a, b) => a + b,
      0,
    );
    const maxMemberBuyers = Math.max(
      0,
      ...Array.from(r.memberUniqueBuyers.values()),
    );
    const roundUniqueBuyers = Math.max(
      existingRoundBuyers.get(r.slug) ?? 0,
      maxMemberBuyers,
    );
    stmts.push(
      upsertRound.bind(
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
        roundUniqueBuyers,
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
        upsertStat.bind(
          s.roundSlug,
          s.memberId,
          s.mintCount,
          s.uniqueBuyers,
          s.mintsPerBuyer,
          s.topBuyerSharePct,
          s.rank,
          s.uniqueBuyersRank,
          s.sharePct,
          s.uniqueBuyersSharePct,
          s.relativeIndex,
          s.uniqueBuyersRelativeIndex,
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

  for (let i = 0; i < stmts.length; i += 80) {
    await rawD1.batch(stmts.slice(i, i + 80));
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
  p2pTransfersBuffered: number;
  tradesDetected: number;
  skippedReason?: string;
}

const LIVE_TRADE_SETTLE_DELAY_SEC = 300; // Wait 5 min of inactivity so multi-leg swaps finish completely
const LIVE_TRADE_EXPIRE_SEC = 2_100; // 35 min (> 30 min trade window)

async function settlePendingTradesInD1(
  db: AppDatabase,
  rawD1: D1Database,
  options: {
    referenceIso: string;
    maxMetaBudget: number;
    memberLookup: Map<string, string>;
    memberInfoById: Map<string, { name: string; hexColor: string }>;
  },
): Promise<{ tradesDetected: number }> {
  const { referenceIso, maxMetaBudget, memberLookup, memberInfoById } = options;
  const refMs = Date.parse(referenceIso);
  if (Number.isNaN(refMs)) return { tradesDetected: 0 };

  const openRows = await db
    .select()
    .from(pendingP2pTransfers)
    .where(eq(pendingP2pTransfers.status, "open"))
    .limit(2_000);

  if (openRows.length === 0) return { tradesDetected: 0 };

  const byPair = new Map<string, typeof openRows>();
  for (const row of openRows) {
    const arr = byPair.get(row.pairKey) ?? [];
    arr.push(row);
    byPair.set(row.pairKey, arr);
  }

  let budgetLeft = maxMetaBudget;
  let tradesDetected = 0;
  const now = new Date().toISOString();
  const metaCache = new Map<number, ParsedMeta | null>();

  const colTradeDeltas = new Map<
    string,
    {
      meta: ParsedMeta;
      memberId: string | null;
      tradedCount: number;
      tradeSessions: number;
      directTransfers: number;
      traders: Set<string>;
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
      overpayers: Set<string>;
      sameEdition2xCount: number;
      sameEdition3xCount: number;
      sameEditionOverpayers: Set<string>;
      firstAt: string;
      lastAt: string;
    }
  >();
  const memberTradeDeltas = new Map<
    string,
    {
      memberId: string;
      artistId: string;
      tradedCount: number;
      tradeSessions: number;
      directTransfers: number;
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
      overpayers: Set<string>;
      sameEdition2xCount: number;
      sameEdition3xCount: number;
      sameEditionBulkCount: number;
      sameEditionOverpayers: Set<string>;
      lastAt: string;
    }
  >();
  const dailyDeltas = new Map<
    string,
    {
      artistId: string;
      date: string;
      sessions: number;
      asymmetricSessions: number;
      ratio2xSessions: number;
      ratio3xSessions: number;
      sameClassAsymmetricSessions: number;
      tradedObjekts: number;
      directTransfers: number;
    }
  >();
  const recentInserts: Array<{
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
  }> = [];

  const markStatusStmts: D1PreparedStatement[] = [];
  const updateStatusStmt = rawD1.prepare(
    "UPDATE pending_p2p_transfers SET status = ? WHERE tx_hash = ? AND log_index = ?",
  );

  for (const rows of byPair.values()) {
    const latestMs = Math.max(...rows.map((r) => Date.parse(r.transferredAt) || 0));
    const ageSec = (refMs - latestMs) / 1000;
    if (ageSec < LIVE_TRADE_SETTLE_DELAY_SEC) {
      // Pair is still actively transferring; let multi-card swaps finish first
      continue;
    }

    const events: P2PTransferEvent[] = rows.map((r) => ({
      txHash: r.txHash,
      logIndex: r.logIndex,
      chain: r.chain === "polygon" ? "polygon" : "abstract",
      blockNumber: r.blockNumber,
      transferredAt: r.transferredAt,
      from: r.fromAddr,
      to: r.toAddr,
      tokenId: r.tokenId,
    }));

    const res = detectTradesFromTransfers(events);

    if (res.trades.length === 0) {
      if (ageSec >= LIVE_TRADE_EXPIRE_SEC) {
        for (const r of rows) {
          markStatusStmts.push(updateStatusStmt.bind("expired", r.txHash, r.logIndex));
        }
      }
      continue;
    }

    // Check remaining Worker subrequest budget for unique tokenIds in this pair's trades
    const neededTokenIds = Array.from(
      new Set(
        res.trades
          .flatMap((t) => t.allLegs.map((l) => l.tokenId))
          .filter((id) => !metaCache.has(id)),
      ),
    );
    if (neededTokenIds.length > budgetLeft) {
      // Leave pair open for next 5-min tick so we stay safely within Worker subrequest limits
      continue;
    }

    for (let i = 0; i < neededTokenIds.length; i += 6) {
      const wave = neededTokenIds.slice(i, i + 6);
      const fetched = await Promise.all(
        wave.map(async (id) => ({
          id,
          meta: await fetchMetaV3(id).catch(() => null),
        })),
      );
      for (const f of fetched) metaCache.set(f.id, f.meta);
      budgetLeft -= wave.length;
    }

    for (const trade of res.trades) {
      tradesDetected++;
      const touchedArtists = new Set<string>();
      const touchedCols = new Set<string>();
      const touchedMembers = new Set<string>();
      const tradeDate = trade.completedAt.slice(0, 10);

      const sym = classifyTradeSymmetry(trade.sideALegs.length, trade.sideBLegs.length);
      const realisticAsym = isRealisticAsymmetricSwap(
        trade.sideALegs.length,
        trade.sideBLegs.length,
      );
      const sameClass = isSameClassSwap(
        trade.sideALegs.map((l) => metaCache.get(l.tokenId)?.objektClass),
        trade.sideBLegs.map((l) => metaCache.get(l.tokenId)?.objektClass),
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
        const m = metaCache.get(leg.tokenId);
        if (!m) return null;
        const memberId =
          memberLookup.get(`${m.artistId}:${normalizeMemberKey(m.rawMember)}`) ??
          null;
        return {
          objektClass: m.objektClass,
          onOffline: m.onOffline,
          memberId,
          season: m.season,
          collectionNo: m.collectionNo,
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

      const applyDeltaAsym = (
        t: {
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
      ) => {
        t.rateSum += rate;
        if (rate > t.maxExchangeRate) t.maxExchangeRate = rate;
        if (rate > 1) t.premiumCount++;
        else if (rate < 1) t.bulkCount++;
        if (rate >= 2) t.premium2xCount++;
        if (rate >= 3) t.premium3xCount++;
        if (sameClass) {
          t.sameClassLegs++;
          t.sameClassRateSum += rate;
          if (rate > 1) t.sameClassPremiumCount++;
          else if (rate < 1) t.sameClassBulkCount++;
          if (rate >= 2) t.sameClass2xCount++;
          if (rate >= 3) t.sameClass3xCount++;
        }
      };

      const rateA = !sym.isAsymmetric || realisticAsym ? sym.sideAExchangeRate : 1;
      const rateB = !sym.isAsymmetric || realisticAsym ? sym.sideBExchangeRate : 1;
      const sidePairs: Array<readonly [readonly P2PTransferEvent[], number]> = [
        [trade.sideALegs, rateA],
        [trade.sideBLegs, rateB],
      ];

      for (const [sideLegs, legRate] of sidePairs) {
        for (const leg of sideLegs) {
          const meta = metaCache.get(leg.tokenId) ?? null;
          if (!meta || (meta.artistId !== "triples" && meta.artistId !== "artms")) {
            continue;
          }
          touchedArtists.add(meta.artistId);
          const memberId =
            memberLookup.get(
              `${meta.artistId}:${normalizeMemberKey(meta.rawMember)}`,
            ) ?? null;

          let col = colTradeDeltas.get(meta.slug);
          if (!col) {
            col = {
              meta,
              memberId,
              tradedCount: 0,
              tradeSessions: 0,
              directTransfers: 0,
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
              firstAt: leg.transferredAt,
              lastAt: leg.transferredAt,
            };
            colTradeDeltas.set(meta.slug, col);
          }
          col.tradedCount++;
          col.directTransfers++;
          col.traders.add(leg.from);
          col.traders.add(leg.to);
          applyDeltaAsym(col, legRate);
          if (leg.transferredAt < col.firstAt) col.firstAt = leg.transferredAt;
          if (leg.transferredAt > col.lastAt) col.lastAt = leg.transferredAt;
          if (!touchedCols.has(meta.slug)) {
            col.tradeSessions++;
            touchedCols.add(meta.slug);
          }

          if (memberId) {
            let mAcc = memberTradeDeltas.get(memberId);
            if (!mAcc) {
              mAcc = {
                memberId,
                artistId: meta.artistId,
                tradedCount: 0,
                tradeSessions: 0,
                directTransfers: 0,
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
                overpayers: new Set(),
                sameEdition2xCount: 0,
                sameEdition3xCount: 0,
                sameEditionBulkCount: 0,
                sameEditionOverpayers: new Set(),
                lastAt: leg.transferredAt,
              };
              memberTradeDeltas.set(memberId, mAcc);
            }
            mAcc.tradedCount++;
            mAcc.directTransfers++;
            applyDeltaAsym(mAcc, legRate);
            if (leg.transferredAt > mAcc.lastAt) mAcc.lastAt = leg.transferredAt;
            if (!touchedMembers.has(memberId)) {
              mAcc.tradeSessions++;
              touchedMembers.add(memberId);
            }
          }

          const dKey = `${meta.artistId}|${tradeDate}`;
          let dAcc = dailyDeltas.get(dKey);
          if (!dAcc) {
            dAcc = {
              artistId: meta.artistId,
              date: tradeDate,
              sessions: 0,
              asymmetricSessions: 0,
              ratio2xSessions: 0,
              ratio3xSessions: 0,
              sameClassAsymmetricSessions: 0,
              tradedObjekts: 0,
              directTransfers: 0,
            };
            dailyDeltas.set(dKey, dAcc);
          }
          dAcc.tradedObjekts++;
          dAcc.directTransfers++;
        }
      }

      if (isCleanSolo && premSideLegs.length === 1) {
        const premLeg = premSideLegs[0]!;
        const pMeta = metaCache.get(premLeg.tokenId) ?? null;
        if (pMeta && (pMeta.artistId === "triples" || pMeta.artistId === "artms")) {
          const overpayer = premLeg.to.toLowerCase();
          const col = colTradeDeltas.get(pMeta.slug);
          if (col) {
            col.cleanSolo2xCount++;
            if (sym.is3to1Plus) col.cleanSolo3xCount++;
            col.overpayers.add(overpayer);
            if (isSameEdition) {
              col.sameEdition2xCount++;
              if (sym.is3to1Plus) col.sameEdition3xCount++;
              col.sameEditionOverpayers.add(overpayer);
            }
          }
          const memberId =
            memberLookup.get(
              `${pMeta.artistId}:${normalizeMemberKey(pMeta.rawMember)}`,
            ) ?? null;
          if (memberId) {
            const mAcc = memberTradeDeltas.get(memberId);
            if (mAcc) {
              mAcc.cleanSolo2xCount++;
              if (sym.is3to1Plus) mAcc.cleanSolo3xCount++;
              mAcc.overpayers.add(overpayer);
              if (isSameEdition) {
                mAcc.sameEdition2xCount++;
                if (sym.is3to1Plus) mAcc.sameEdition3xCount++;
                mAcc.sameEditionOverpayers.add(overpayer);
              }
            }
          }
        }
        for (const bLeg of bulkSideLegs) {
          const bMeta = metaCache.get(bLeg.tokenId) ?? null;
          if (!bMeta || (bMeta.artistId !== "triples" && bMeta.artistId !== "artms")) {
            continue;
          }
          const bMemberId =
            memberLookup.get(
              `${bMeta.artistId}:${normalizeMemberKey(bMeta.rawMember)}`,
            ) ?? null;
          if (bMemberId) {
            const bmAcc = memberTradeDeltas.get(bMemberId);
            if (bmAcc) {
              bmAcc.cleanSoloBulkCount++;
              if (isSameEdition) bmAcc.sameEditionBulkCount++;
            }
          }
        }
      }

      const summarize = (legs: P2PTransferEvent[]) => {
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
          const meta = metaCache.get(leg.tokenId) ?? null;
          const slug = meta?.slug ?? `token-${leg.tokenId}`;
          const prev = grouped.get(slug);
          if (prev) {
            prev.count++;
            continue;
          }
          const memberId = meta
            ? (memberLookup.get(
                `${meta.artistId}:${normalizeMemberKey(meta.rawMember)}`,
              ) ?? null)
            : null;
          const mInfo = memberId ? memberInfoById.get(memberId) : null;
          grouped.set(slug, {
            slug,
            collectionId: meta?.collectionId ?? `Objekt #${leg.tokenId}`,
            artistId: meta?.artistId ?? "unknown",
            memberId,
            memberName: mInfo?.name ?? meta?.rawMember ?? "Unknown",
            hexColor: mInfo?.hexColor ?? "#71717a",
            imageUrl: meta?.imageUrl || null,
            count: 1,
          });
        }
        return JSON.stringify(Array.from(grouped.values()));
      };

      const sideASummary = summarize(trade.sideALegs);
      const sideBSummary = summarize(trade.sideBLegs);

      for (const artistId of touchedArtists) {
        const dKey = `${artistId}|${tradeDate}`;
        const dAcc = dailyDeltas.get(dKey);
        if (dAcc) {
          dAcc.sessions++;
          if (realisticAsym) {
            dAcc.asymmetricSessions++;
            if (sym.is2to1Plus) dAcc.ratio2xSessions++;
            if (sym.is3to1Plus) dAcc.ratio3xSessions++;
            if (sameClass) dAcc.sameClassAsymmetricSessions++;
          }
        }

        recentInserts.push({
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
        });
      }

      for (const leg of trade.allLegs) {
        markStatusStmts.push(updateStatusStmt.bind("traded", leg.txHash, leg.logIndex));
      }
    }

    if (ageSec >= LIVE_TRADE_EXPIRE_SEC) {
      for (const nt of res.nonTradeTransfers) {
        markStatusStmts.push(updateStatusStmt.bind("expired", nt.txHash, nt.logIndex));
      }
    }
  }

  const stmts: D1PreparedStatement[] = [...markStatusStmts];

  const round4 = (v: number) => Math.round(v * 10000) / 10000;

  const upsertColTrade = rawD1.prepare(
    `INSERT INTO collection_trade_stats
      (collection_slug, collection_id, artist_id, member_id, raw_member_name, season, objekt_class, collection_no, on_offline, front_image_url, background_color, traded_count, trade_sessions, direct_transfer_count, unique_traders, premium_count, bulk_count, premium_2x_count, premium_3x_count, avg_exchange_rate, max_exchange_rate, same_class_legs, same_class_premium_count, same_class_bulk_count, same_class_2x_count, same_class_3x_count, same_class_avg_rate, clean_solo_2x_count, clean_solo_3x_count, unique_overpayers, same_edition_2x_count, same_edition_3x_count, same_edition_overpayers, first_trade_at, last_trade_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(collection_slug) DO UPDATE SET
       avg_exchange_rate = ROUND((collection_trade_stats.avg_exchange_rate * collection_trade_stats.traded_count + excluded.avg_exchange_rate * excluded.traded_count) / MAX(1, collection_trade_stats.traded_count + excluded.traded_count), 4),
       same_class_avg_rate = CASE WHEN collection_trade_stats.same_class_legs + excluded.same_class_legs > 0 THEN ROUND((collection_trade_stats.same_class_avg_rate * collection_trade_stats.same_class_legs + excluded.same_class_avg_rate * excluded.same_class_legs) / (collection_trade_stats.same_class_legs + excluded.same_class_legs), 4) ELSE 1 END,
       traded_count = collection_trade_stats.traded_count + excluded.traded_count,
       trade_sessions = collection_trade_stats.trade_sessions + excluded.trade_sessions,
       direct_transfer_count = collection_trade_stats.direct_transfer_count + excluded.direct_transfer_count,
       unique_traders = collection_trade_stats.unique_traders + excluded.unique_traders,
       premium_count = collection_trade_stats.premium_count + excluded.premium_count,
       bulk_count = collection_trade_stats.bulk_count + excluded.bulk_count,
       premium_2x_count = collection_trade_stats.premium_2x_count + excluded.premium_2x_count,
       premium_3x_count = collection_trade_stats.premium_3x_count + excluded.premium_3x_count,
       max_exchange_rate = MAX(collection_trade_stats.max_exchange_rate, excluded.max_exchange_rate),
       same_class_legs = collection_trade_stats.same_class_legs + excluded.same_class_legs,
       same_class_premium_count = collection_trade_stats.same_class_premium_count + excluded.same_class_premium_count,
       same_class_bulk_count = collection_trade_stats.same_class_bulk_count + excluded.same_class_bulk_count,
       same_class_2x_count = collection_trade_stats.same_class_2x_count + excluded.same_class_2x_count,
       same_class_3x_count = collection_trade_stats.same_class_3x_count + excluded.same_class_3x_count,
       clean_solo_2x_count = collection_trade_stats.clean_solo_2x_count + excluded.clean_solo_2x_count,
       clean_solo_3x_count = collection_trade_stats.clean_solo_3x_count + excluded.clean_solo_3x_count,
       unique_overpayers = collection_trade_stats.unique_overpayers + excluded.unique_overpayers,
       same_edition_2x_count = collection_trade_stats.same_edition_2x_count + excluded.same_edition_2x_count,
       same_edition_3x_count = collection_trade_stats.same_edition_3x_count + excluded.same_edition_3x_count,
       same_edition_overpayers = collection_trade_stats.same_edition_overpayers + excluded.same_edition_overpayers,
       first_trade_at = CASE WHEN collection_trade_stats.first_trade_at IS NULL OR excluded.first_trade_at < collection_trade_stats.first_trade_at THEN excluded.first_trade_at ELSE collection_trade_stats.first_trade_at END,
       last_trade_at = CASE WHEN collection_trade_stats.last_trade_at IS NULL OR excluded.last_trade_at > collection_trade_stats.last_trade_at THEN excluded.last_trade_at ELSE collection_trade_stats.last_trade_at END,
       front_image_url = COALESCE(NULLIF(collection_trade_stats.front_image_url, ''), excluded.front_image_url),
       updated_at = excluded.updated_at`,
  );

  for (const d of colTradeDeltas.values()) {
    const avgRate = d.tradedCount > 0 ? round4(d.rateSum / d.tradedCount) : 1;
    const scAvgRate =
      d.sameClassLegs > 0 ? round4(d.sameClassRateSum / d.sameClassLegs) : 1;
    stmts.push(
      upsertColTrade.bind(
        d.meta.slug,
        d.meta.collectionId,
        d.meta.artistId,
        d.memberId,
        d.meta.rawMember,
        d.meta.season,
        d.meta.objektClass,
        d.meta.collectionNo,
        d.meta.onOffline,
        d.meta.imageUrl || null,
        d.meta.backgroundColor || null,
        d.tradedCount,
        d.tradeSessions,
        d.directTransfers,
        d.traders.size,
        d.premiumCount,
        d.bulkCount,
        d.premium2xCount,
        d.premium3xCount,
        avgRate,
        round4(d.maxExchangeRate),
        d.sameClassLegs,
        d.sameClassPremiumCount,
        d.sameClassBulkCount,
        d.sameClass2xCount,
        d.sameClass3xCount,
        scAvgRate,
        d.cleanSolo2xCount,
        d.cleanSolo3xCount,
        d.overpayers.size,
        d.sameEdition2xCount,
        d.sameEdition3xCount,
        d.sameEditionOverpayers.size,
        d.firstAt,
        d.lastAt,
        now,
      ),
    );
  }

  const upsertMemberTrade = rawD1.prepare(
    `INSERT INTO member_trade_stats
      (member_id, artist_id, traded_count, trade_sessions, direct_transfer_count, unique_traders, collections_traded, trade_rank, trade_share_pct, trade_relative_index, premium_count, bulk_count, premium_2x_count, premium_3x_count, avg_exchange_rate, max_exchange_rate, same_class_legs, same_class_premium_count, same_class_bulk_count, same_class_2x_count, same_class_3x_count, same_class_avg_rate, clean_solo_2x_count, clean_solo_3x_count, clean_solo_bulk_count, unique_overpayers, top_overpayer_share_pct, same_edition_2x_count, same_edition_3x_count, same_edition_bulk_count, same_edition_overpayers, same_edition_top_share_pct, last_trade_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, 999, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET
       avg_exchange_rate = ROUND((member_trade_stats.avg_exchange_rate * member_trade_stats.traded_count + excluded.avg_exchange_rate * excluded.traded_count) / MAX(1, member_trade_stats.traded_count + excluded.traded_count), 4),
       same_class_avg_rate = CASE WHEN member_trade_stats.same_class_legs + excluded.same_class_legs > 0 THEN ROUND((member_trade_stats.same_class_avg_rate * member_trade_stats.same_class_legs + excluded.same_class_avg_rate * excluded.same_class_legs) / (member_trade_stats.same_class_legs + excluded.same_class_legs), 4) ELSE 1 END,
       traded_count = member_trade_stats.traded_count + excluded.traded_count,
       trade_sessions = member_trade_stats.trade_sessions + excluded.trade_sessions,
       direct_transfer_count = member_trade_stats.direct_transfer_count + excluded.direct_transfer_count,
       premium_count = member_trade_stats.premium_count + excluded.premium_count,
       bulk_count = member_trade_stats.bulk_count + excluded.bulk_count,
       premium_2x_count = member_trade_stats.premium_2x_count + excluded.premium_2x_count,
       premium_3x_count = member_trade_stats.premium_3x_count + excluded.premium_3x_count,
       max_exchange_rate = MAX(member_trade_stats.max_exchange_rate, excluded.max_exchange_rate),
       same_class_legs = member_trade_stats.same_class_legs + excluded.same_class_legs,
       same_class_premium_count = member_trade_stats.same_class_premium_count + excluded.same_class_premium_count,
       same_class_bulk_count = member_trade_stats.same_class_bulk_count + excluded.same_class_bulk_count,
       same_class_2x_count = member_trade_stats.same_class_2x_count + excluded.same_class_2x_count,
       same_class_3x_count = member_trade_stats.same_class_3x_count + excluded.same_class_3x_count,
       clean_solo_2x_count = member_trade_stats.clean_solo_2x_count + excluded.clean_solo_2x_count,
       clean_solo_3x_count = member_trade_stats.clean_solo_3x_count + excluded.clean_solo_3x_count,
       clean_solo_bulk_count = member_trade_stats.clean_solo_bulk_count + excluded.clean_solo_bulk_count,
       unique_overpayers = member_trade_stats.unique_overpayers + excluded.unique_overpayers,
       same_edition_2x_count = member_trade_stats.same_edition_2x_count + excluded.same_edition_2x_count,
       same_edition_3x_count = member_trade_stats.same_edition_3x_count + excluded.same_edition_3x_count,
       same_edition_bulk_count = member_trade_stats.same_edition_bulk_count + excluded.same_edition_bulk_count,
       same_edition_overpayers = member_trade_stats.same_edition_overpayers + excluded.same_edition_overpayers,
       last_trade_at = CASE WHEN member_trade_stats.last_trade_at IS NULL OR excluded.last_trade_at > member_trade_stats.last_trade_at THEN excluded.last_trade_at ELSE member_trade_stats.last_trade_at END,
       updated_at = excluded.updated_at`,
  );

  for (const m of memberTradeDeltas.values()) {
    const avgRate = m.tradedCount > 0 ? round4(m.rateSum / m.tradedCount) : 1;
    const scAvgRate =
      m.sameClassLegs > 0 ? round4(m.sameClassRateSum / m.sameClassLegs) : 1;
    stmts.push(
      upsertMemberTrade.bind(
        m.memberId,
        m.artistId,
        m.tradedCount,
        m.tradeSessions,
        m.directTransfers,
        m.premiumCount,
        m.bulkCount,
        m.premium2xCount,
        m.premium3xCount,
        avgRate,
        round4(m.maxExchangeRate),
        m.sameClassLegs,
        m.sameClassPremiumCount,
        m.sameClassBulkCount,
        m.sameClass2xCount,
        m.sameClass3xCount,
        scAvgRate,
        m.cleanSolo2xCount,
        m.cleanSolo3xCount,
        m.cleanSoloBulkCount,
        m.overpayers.size,
        m.sameEdition2xCount,
        m.sameEdition3xCount,
        m.sameEditionBulkCount,
        m.sameEditionOverpayers.size,
        m.lastAt,
        now,
      ),
    );
  }

  const upsertDailyTrade = rawD1.prepare(
    `INSERT INTO daily_trade_stats
      (artist_id, trade_date, trade_sessions, asymmetric_sessions, ratio_2x_sessions, ratio_3x_sessions, same_class_asymmetric_sessions, traded_objekts, direct_transfers, unique_traders)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(artist_id, trade_date) DO UPDATE SET
       trade_sessions = daily_trade_stats.trade_sessions + excluded.trade_sessions,
       asymmetric_sessions = daily_trade_stats.asymmetric_sessions + excluded.asymmetric_sessions,
       ratio_2x_sessions = daily_trade_stats.ratio_2x_sessions + excluded.ratio_2x_sessions,
       ratio_3x_sessions = daily_trade_stats.ratio_3x_sessions + excluded.ratio_3x_sessions,
       same_class_asymmetric_sessions = daily_trade_stats.same_class_asymmetric_sessions + excluded.same_class_asymmetric_sessions,
       traded_objekts = daily_trade_stats.traded_objekts + excluded.traded_objekts,
       direct_transfers = daily_trade_stats.direct_transfers + excluded.direct_transfers`,
  );

  for (const d of dailyDeltas.values()) {
    stmts.push(
      upsertDailyTrade.bind(
        d.artistId,
        d.date,
        d.sessions,
        d.asymmetricSessions,
        d.ratio2xSessions,
        d.ratio3xSessions,
        d.sameClassAsymmetricSessions,
        d.tradedObjekts,
        d.directTransfers,
      ),
    );
  }

  const insertRecent = rawD1.prepare(
    `INSERT OR REPLACE INTO recent_trades
      (trade_id, artist_id, chain, traded_at, duration_seconds, side_a_count, side_b_count, is_asymmetric, is_same_class, is_clean_solo, is_same_edition, ratio_multiple, wallet_a_short, wallet_b_short, side_a_summary, side_b_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const rt of recentInserts) {
    stmts.push(
      insertRecent.bind(
        rt.tradeId,
        rt.artistId,
        rt.chain,
        rt.tradedAt,
        rt.durationSeconds,
        rt.sideACount,
        rt.sideBCount,
        rt.isAsymmetric ? 1 : 0,
        rt.isSameClass ? 1 : 0,
        rt.isCleanSolo ? 1 : 0,
        rt.isSameEdition ? 1 : 0,
        rt.ratioMultiple,
        rt.walletAShort,
        rt.walletBShort,
        rt.sideASummary,
        rt.sideBSummary,
      ),
    );
  }

  // Prune settled/expired rows from pending_p2p_transfers older than 24h
  const pruneIso = new Date(refMs - 86_400_000).toISOString();
  stmts.push(
    rawD1
      .prepare("DELETE FROM pending_p2p_transfers WHERE status != 'open' AND transferred_at < ?")
      .bind(pruneIso),
  );

  for (let i = 0; i < stmts.length; i += 80) {
    await rawD1.batch(stmts.slice(i, i + 80));
  }

  // Re-rank member_trade_stats cleanly when any member trades updated
  if (memberTradeDeltas.size > 0) {
    const rankStmts: D1PreparedStatement[] = [];
    const updateRank = rawD1.prepare(
      `UPDATE member_trade_stats
       SET trade_rank = ?, trade_share_pct = ?, trade_relative_index = ?, updated_at = ?
       WHERE member_id = ?`,
    );

    for (const artistId of ["triples", "artms"] as const) {
      const rows = await db
        .select({
          memberId: memberTradeStats.memberId,
          tradedCount: memberTradeStats.tradedCount,
        })
        .from(memberTradeStats)
        .where(eq(memberTradeStats.artistId, artistId));
      if (rows.length === 0) continue;

      const ranked = computeMemberTradeRankings(rows);
      for (const r of ranked) {
        rankStmts.push(
          updateRank.bind(
            r.tradeRank,
            r.tradeSharePct,
            r.tradeRelativeIndex,
            now,
            r.memberId,
          ),
        );
      }
    }

    for (let i = 0; i < rankStmts.length; i += 80) {
      await rawD1.batch(rankStmts.slice(i, i + 80));
    }
  }

  return { tradesDetected };
}

/**
 * Automated continuous live sync executed by Cloudflare Workers Cron Trigger.
 * Stays safely within Worker subrequest budgets via `SYNC_MAX_TOKENS` (default 35),
 * deduplicates via `processed_live_mints`, and buffers P2P transfers into
 * `pending_p2p_transfers` for secondary trade detection without EVER adding P2P
 * transfers to primary newly-minted sales (`collections.total_mints` / `sale_rounds`).
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
  let toBlock = Math.min(headBlock, fromBlock + 1_200);

  if (fromBlock > headBlock) {
    return {
      fromBlock,
      toBlock: headBlock,
      headBlock,
      tokensResolved: 0,
      trackedMintsAdded: 0,
      roundsUpdated: 0,
      p2pTransfersBuffered: 0,
      tradesDetected: 0,
      skippedReason: "already_at_head",
    };
  }

  // Fetch all ERC-721 Transfer logs in a single RPC call; halve range if a massive drop hits log caps
  let allTransferLogs: RpcLog[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      allTransferLogs = await rpc<RpcLog[]>(rpcUrl, "eth_getLogs", [
        {
          address: ABSTRACT_OBJEKT,
          topics: [ERC721_TRANSFER_TOPIC],
          fromBlock: "0x" + fromBlock.toString(16),
          toBlock: "0x" + toBlock.toString(16),
        },
      ]);
      break;
    } catch (err) {
      if (attempt < 2 && toBlock - fromBlock > 150) {
        toBlock = fromBlock + Math.floor((toBlock - fromBlock) / 2);
        continue;
      }
      throw err;
    }
  }

  const parsedMintLogs: Array<{
    blockNumber: number;
    tokenId: number;
    timestampIso: string;
  }> = [];
  const parsedP2PLogs: Array<{
    txHash: string;
    logIndex: number;
    blockNumber: number;
    transferredAt: string;
    fromAddr: string;
    toAddr: string;
    pairKey: string;
    tokenId: number;
  }> = [];

  let latestLogIso = new Date().toISOString();

  for (const l of allTransferLogs) {
    if (l.topics.length < 4) continue;
    const fromTopic = l.topics[1]!.toLowerCase();
    const toTopic = l.topics[2]!.toLowerCase();
    const blockNumber = Number(BigInt(l.blockNumber));
    const tokenId = Number(BigInt(l.topics[3]!));
    const timestampIso = l.blockTimestamp
      ? new Date(Number(BigInt(l.blockTimestamp)) * 1000).toISOString()
      : new Date().toISOString();
    if (timestampIso > latestLogIso) latestLogIso = timestampIso;

    if (fromTopic === ZERO_TOPIC) {
      // Strictly newly minted primary sales ONLY
      parsedMintLogs.push({ blockNumber, tokenId, timestampIso });
    } else if (toTopic !== ZERO_TOPIC) {
      const fromAddr = topicToAddress(fromTopic);
      const toAddr = topicToAddress(toTopic);
      if (isEligibleP2PTransfer(fromAddr, toAddr)) {
        const { pairKey } = makeWalletPairKey("abstract", fromAddr, toAddr);
        parsedP2PLogs.push({
          txHash: l.transactionHash.toLowerCase(),
          logIndex: Number(BigInt(l.logIndex)),
          blockNumber,
          transferredAt: timestampIso,
          fromAddr,
          toAddr,
          pairKey,
          tokenId,
        });
      }
    }
  }

  // Buffer eligible P2P transfers idempotently (never touches collections/sale_rounds)
  let p2pTransfersBuffered = 0;
  let tradesAvailable = true;
  if (parsedP2PLogs.length > 0) {
    try {
      const insertP2p = env.DB.prepare(
        `INSERT OR IGNORE INTO pending_p2p_transfers
          (tx_hash, log_index, chain, block_number, transferred_at, from_addr, to_addr, pair_key, token_id, status)
         VALUES (?, ?, 'abstract', ?, ?, ?, ?, ?, ?, 'open')`,
      );
      const p2pStmts = parsedP2PLogs.map((p) =>
        insertP2p.bind(
          p.txHash,
          p.logIndex,
          p.blockNumber,
          p.transferredAt,
          p.fromAddr,
          p.toAddr,
          p.pairKey,
          p.tokenId,
        ),
      );
      for (let i = 0; i < p2pStmts.length; i += 80) {
        await env.DB.batch(p2pStmts.slice(i, i + 80));
      }
      p2pTransfersBuffered = parsedP2PLogs.length;
    } catch {
      // Allow graceful operation if migration 0002 has not been applied yet
      tradesAvailable = false;
    }
  }

  // Load member lookup map once (shared by both mint sync and trade settling)
  const allMembers = await db.select().from(members);
  const memberLookup = new Map<string, string>();
  const memberInfoById = new Map<string, { name: string; hexColor: string }>();
  for (const m of allMembers) {
    memberInfoById.set(m.id, { name: m.name, hexColor: m.hexColor });
    memberLookup.set(`${m.artistId}:${normalizeMemberKey(m.name)}`, m.id);
    memberLookup.set(`${m.artistId}:${normalizeMemberKey(m.cosmoName)}`, m.id);
    memberLookup.set(`${m.artistId}:${normalizeMemberKey(m.fullName)}`, m.id);
  }

  // Deduplicate newly minted tokens against processed_live_mints in <= 80-param chunks
  const seen = new Set<number>();
  const uniqueIds = Array.from(new Set(parsedMintLogs.map((l) => l.tokenId)));
  for (let i = 0; i < uniqueIds.length; i += 80) {
    const slice = uniqueIds.slice(i, i + 80);
    const rows = await db
      .select({ tokenId: processedLiveMints.tokenId })
      .from(processedLiveMints)
      .where(inArray(processedLiveMints.tokenId, slice));
    for (const r of rows) seen.add(r.tokenId);
  }

  const pending = parsedMintLogs.filter((l) => !seen.has(l.tokenId));
  const batch = pending.slice(0, maxTokens);

  if (batch.length === 0) {
    let tradesDetected = 0;
    if (tradesAvailable) {
      const settled = await settlePendingTradesInD1(db, env.DB, {
        referenceIso: latestLogIso,
        maxMetaBudget: Math.min(20, maxTokens),
        memberLookup,
        memberInfoById,
      }).catch(() => ({ tradesDetected: 0 }));
      tradesDetected = settled.tradesDetected;
    }

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
      p2pTransfersBuffered,
      tradesDetected,
      skippedReason: "no_new_mints",
    };
  }

  // Fetch metadata for newly minted tokens in polite waves of 10
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

  // Aggregate primary mint deltas in-memory before writing cleanly to D1
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
    const dirtyRoundSlugs = new Set<string>();
    for (const d of colDeltas.values()) {
      const auto = inferAutoRoundGroup(
        d.meta.artistId,
        d.meta.season,
        d.meta.objektClass,
        d.meta.collectionNo,
        d.meta.onOffline,
      );
      dirtyRoundSlugs.add(auto.slug);
    }
    const rec = await recomputeSaleRoundsInD1(db, env.DB, dirtyRoundSlugs);
    roundsUpdated = rec.roundsUpdated;
  }

  // Settle any ready P2P trade sessions using remaining Worker subrequest budget
  let tradesDetected = 0;
  const remainingTradeBudget = Math.max(0, Math.min(10, 42 - resolved.length));
  if (tradesAvailable && remainingTradeBudget >= 2) {
    const settled = await settlePendingTradesInD1(db, env.DB, {
      referenceIso: latestLogIso,
      maxMetaBudget: remainingTradeBudget,
      memberLookup,
      memberInfoById,
    }).catch(() => ({ tradesDetected: 0 }));
    tradesDetected = settled.tradesDetected;
  }

  void sql;

  return {
    fromBlock,
    toBlock: newCursorBlock,
    headBlock,
    tokensResolved: resolved.length,
    trackedMintsAdded,
    roundsUpdated,
    p2pTransfersBuffered,
    tradesDetected,
  };
}
