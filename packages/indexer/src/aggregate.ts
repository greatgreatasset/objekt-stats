import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadCurationData } from "@objekt-stats/db/curation-loader";
import {
  classifyTradeSymmetry,
  computeArtistSeriesStats,
  computeMemberTradeRankings,
  detectTradesFromTransfers,
  isCleanSoloPremiumSwap,
  isRealisticAsymmetricSwap,
  isSameClassSwap,
  isSameEditionSoloSwap,
  makeTransferKey,
  shortenAddress,
  type P2PTransferEvent,
  type SaleRoundInput,
} from "@objekt-stats/stats";
import type { IndexerStore } from "./store.js";

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

export function normalizeMemberLookupKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Shared deterministic auto-grouping rule used by both the local indexer aggregator
 * and the Cloudflare Worker edge live-sync engine.
 */
export function inferAutoRoundGroup(
  artistId: string,
  season: string,
  objektClass: string,
  collectionNo: string,
  onOffline: "online" | "offline",
): {
  slug: string;
  title: string;
  saleMechanic: string;
  includeInPopularity: boolean;
  unitPriceUsd: number | null;
} {
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
    let editionLabel = `${collectionNo}`;
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

export interface AggregateOutputSummary {
  collectionsCount: number;
  dailyRowsCount: number;
  roundsCount: number;
  roundMemberStatRows: number;
  confirmedTradesCount: number;
  confirmedTradedObjekts: number;
  directP2PTransfersCount: number;
  tradeCollectionsCount: number;
  outFile: string;
  tradesOutFile: string;
  snapshotFile: string;
}

export function aggregateAndEmitSql(
  store: IndexerStore,
  options: {
    dataRoot?: string;
    outFile?: string;
    tradesOutFile?: string;
    snapshotFile?: string;
  } = {},
): AggregateOutputSummary {
  const dataRoot = options.dataRoot ?? resolve(process.cwd(), "data");
  const outFile =
    options.outFile ??
    resolve(process.cwd(), "packages/db/generated/sync-onchain.sql");
  const tradesOutFile =
    options.tradesOutFile ??
    resolve(process.cwd(), "packages/db/generated/sync-trades.sql");
  const snapshotFile =
    options.snapshotFile ??
    resolve(process.cwd(), "packages/db/generated/snapshot-summary.json");

  const curation = loadCurationData(dataRoot);
  const trackedArtists = new Set(curation.artists.map((a) => a.id));

  const memberLookup = new Map<string, string>();
  const memberInfoById = new Map<string, { name: string; hexColor: string; artistId: string }>();
  const artistMemberTotals = new Map<string, number>();
  for (const artist of curation.artists) {
    artistMemberTotals.set(artist.id, artist.members.length);
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

  // O(N) spin lookup map by collection col_id
  const spinCountsByColId = new Map<number, number>();
  const spinRows = store.db
    .prepare(
      `SELECT tc.col_id AS col_id, COUNT(DISTINCT rs.token_id) AS spun_count
       FROM raw_spins rs
       JOIN token_collections tc ON tc.token_id = rs.token_id
       GROUP BY tc.col_id`,
    )
    .all() as Array<{ col_id: number; spun_count: number }>;
  for (const r of spinRows) {
    spinCountsByColId.set(r.col_id, r.spun_count);
  }

  // 1. Aggregate per-collection totals from normalized SQLite tables (O(N), low RAM at 31M+ rows)
  const collectionRows = store.db
    .prepare(
      `SELECT
        cc.col_id,
        cc.slug,
        cc.collection_id,
        cc.artist_id,
        cc.raw_member,
        cc.season,
        cc.objekt_class,
        cc.collection_no,
        cc.on_offline,
        cc.image_url,
        cc.background_color,
        COUNT(*) AS total_mints,
        COUNT(DISTINCT rm.minter) AS unique_minters,
        MIN(rm.minted_at) AS first_mint_at,
        MAX(rm.minted_at) AS last_mint_at
      FROM collection_catalog cc
      JOIN token_collections tc ON tc.col_id = cc.col_id
      JOIN raw_mints rm ON rm.token_id = tc.token_id
      WHERE cc.artist_id IN ('triples', 'artms')
      GROUP BY cc.col_id`,
    )
    .all() as Array<{
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
    total_mints: number;
    unique_minters: number;
    first_mint_at: string;
    last_mint_at: string;
  }>;

  const filteredCollections = collectionRows
    .filter((c) => trackedArtists.has(c.artist_id as "triples" | "artms"))
    .map((c) => ({
      ...c,
      spun_count: spinCountsByColId.get(c.col_id) ?? 0,
    }));

  // 2. Daily mints per collection (only tracked artists)
  const dailyRows = store.db
    .prepare(
      `SELECT
        cc.slug AS collection_slug,
        substr(rm.minted_at, 1, 10) AS mint_date,
        COUNT(*) AS mint_count,
        COUNT(DISTINCT rm.minter) AS unique_minters
      FROM collection_catalog cc
      JOIN token_collections tc ON tc.col_id = cc.col_id
      JOIN raw_mints rm ON rm.token_id = tc.token_id
      WHERE cc.artist_id IN ('triples', 'artms')
      GROUP BY cc.col_id, substr(rm.minted_at, 1, 10)`,
    )
    .all() as Array<{
    collection_slug: string;
    mint_date: string;
    mint_count: number;
    unique_minters: number;
  }>;

  const validSlugs = new Set(filteredCollections.map((c) => c.slug));
  const filteredDaily = dailyRows.filter((d) => validSlugs.has(d.collection_slug));

  // 3. Group collections into Sale Rounds + compute TRUE deduplicated unique buyers & top-wallet share IN SQLITE
  interface RoundAccumulator {
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
    roundUniqueBuyers: number;
    memberUniqueBuyers: Map<string, number>;
    memberTopBuyerMints: Map<string, number>;
  }

  const rounds = new Map<string, RoundAccumulator>();
  const colMappings: Array<{ colId: number; roundSlug: string; memberId: string }> = [];

  for (const col of filteredCollections) {
    const memberId =
      memberLookup.get(`${col.artist_id}:${normalizeMemberLookupKey(col.raw_member)}`) ??
      null;
    if (!memberId) continue;

    const curatedRounds = curation.roundsByArtist[col.artist_id] ?? [];
    const matchedCurated = curatedRounds.find(
      (r) =>
        r.collectionMatchers.seasons.includes(col.season) &&
        r.collectionMatchers.collectionNos.includes(col.collection_no) &&
        (!r.collectionMatchers.memberIds ||
          r.collectionMatchers.memberIds.includes(memberId)),
    );

    const meta = matchedCurated
      ? {
          slug: matchedCurated.slug,
          title: matchedCurated.title,
          saleMechanic: matchedCurated.saleMechanic,
          includeInPopularity:
            matchedCurated.includeInPopularity ??
            (matchedCurated.saleMechanic === "member_select" ||
              matchedCurated.saleMechanic === "unit_select"),
          unitPriceUsd: matchedCurated.unitPriceUsd ?? null,
          isAutoDetected: false,
          notes: matchedCurated.notes ?? null,
        }
      : {
          ...inferAutoRoundGroup(
            col.artist_id,
            col.season,
            col.objekt_class,
            col.collection_no,
            col.on_offline,
          ),
          isAutoDetected: true,
          notes: null,
        };

    let acc = rounds.get(meta.slug);
    if (!acc) {
      acc = {
        slug: meta.slug,
        artistId: col.artist_id,
        title: meta.title,
        season: col.season,
        objektClass: col.objekt_class,
        onOffline: col.on_offline,
        saleMechanic: meta.saleMechanic,
        startAt: col.first_mint_at,
        endAt: col.last_mint_at,
        unitPriceUsd: meta.unitPriceUsd,
        includeInPopularity: meta.includeInPopularity,
        isAutoDetected: meta.isAutoDetected,
        notes: meta.notes,
        collectionSlugs: [],
        memberMints: new Map(),
        roundUniqueBuyers: 0,
        memberUniqueBuyers: new Map(),
        memberTopBuyerMints: new Map(),
      };
      rounds.set(meta.slug, acc);
    }

    acc.collectionSlugs.push(col.slug);
    acc.memberMints.set(
      memberId,
      (acc.memberMints.get(memberId) ?? 0) + col.total_mints,
    );
    colMappings.push({ colId: col.col_id, roundSlug: acc.slug, memberId });
    if (col.first_mint_at < acc.startAt) acc.startAt = col.first_mint_at;
    if (col.last_mint_at > acc.endAt) acc.endAt = col.last_mint_at;
  }

  // Compute exact deduplicated unique buyers & top-wallet concentration INSIDE SQLite (O(N), constant RAM!)
  store.db.exec(`
    DROP TABLE IF EXISTS temp._round_cols;
    CREATE TEMP TABLE _round_cols (
      col_id INTEGER PRIMARY KEY,
      round_slug TEXT NOT NULL,
      member_id TEXT NOT NULL
    );
  `);
  const insertMappingStmt = store.db.prepare(
    "INSERT INTO temp._round_cols (col_id, round_slug, member_id) VALUES (?, ?, ?)",
  );
  store.db.exec("BEGIN");
  try {
    for (const m of colMappings) {
      insertMappingStmt.run(m.colId, m.roundSlug, m.memberId);
    }
    store.db.exec("COMMIT");
  } catch (err) {
    store.db.exec("ROLLBACK");
    throw err;
  }

  const roundBuyerTotals = store.db
    .prepare(
      `SELECT rc.round_slug AS round_slug, COUNT(DISTINCT rm.minter) AS unique_buyers
       FROM temp._round_cols rc
       JOIN token_collections tc ON tc.col_id = rc.col_id
       JOIN raw_mints rm ON rm.token_id = tc.token_id
       GROUP BY rc.round_slug`,
    )
    .all() as Array<{ round_slug: string; unique_buyers: number }>;

  for (const row of roundBuyerTotals) {
    const acc = rounds.get(row.round_slug);
    if (acc) acc.roundUniqueBuyers = row.unique_buyers;
  }

  const memberBuyerTotals = store.db
    .prepare(
      `SELECT
         round_slug,
         member_id,
         COUNT(*) AS unique_buyers,
         MAX(cnt) AS top_buyer_mints
       FROM (
         SELECT rc.round_slug, rc.member_id, rm.minter, COUNT(*) AS cnt
         FROM temp._round_cols rc
         JOIN token_collections tc ON tc.col_id = rc.col_id
         JOIN raw_mints rm ON rm.token_id = tc.token_id
         GROUP BY rc.round_slug, rc.member_id, rm.minter
       )
       GROUP BY round_slug, member_id`,
    )
    .all() as Array<{
    round_slug: string;
    member_id: string;
    unique_buyers: number;
    top_buyer_mints: number;
  }>;

  for (const row of memberBuyerTotals) {
    const acc = rounds.get(row.round_slug);
    if (!acc) continue;
    acc.memberUniqueBuyers.set(row.member_id, row.unique_buyers);
    acc.memberTopBuyerMints.set(row.member_id, row.top_buyer_mints);
  }
  store.db.exec("DROP TABLE IF EXISTS temp._round_cols;");

  const validRounds = Array.from(rounds.values()).filter(
    (r) => r.memberMints.size >= 2,
  );

  for (const r of validRounds) {
    const fullCount = artistMemberTotals.get(r.artistId) ?? 24;
    if (
      r.isAutoDetected &&
      r.saleMechanic === "member_select" &&
      r.memberMints.size < fullCount &&
      r.memberMints.size >= 2 &&
      fullCount >= 5 &&
      r.memberMints.size <= Math.floor(fullCount * 0.6)
    ) {
      r.saleMechanic = "unit_select";
    }
  }

  // 4. Compute statistical metrics per artist via @objekt-stats/stats
  const statsByRoundSlug = new Map<
    string,
    ReturnType<typeof computeArtistSeriesStats> extends Map<string, infer V> ? V : never
  >();

  for (const artistId of trackedArtists) {
    const artistRounds: SaleRoundInput[] = validRounds
      .filter((r) => r.artistId === artistId)
      .map((r) => ({
        slug: r.slug,
        artistId: r.artistId,
        startAt: r.startAt,
        includeInPopularity: r.includeInPopularity,
        memberMints: Array.from(r.memberMints.entries()).map(
          ([memberId, mintCount]) => ({
            memberId,
            mintCount,
            uniqueBuyers: r.memberUniqueBuyers.get(memberId) ?? 0,
            topBuyerMints: r.memberTopBuyerMints.get(memberId) ?? 0,
          }),
        ),
      }));

    const computed = computeArtistSeriesStats(artistRounds);
    for (const [slug, stats] of computed.entries()) {
      statsByRoundSlug.set(slug, stats);
    }
  }

  // 5. Emit compact multi-row deterministic SQL for D1
  const now = new Date().toISOString();
  const lines: string[] = [
    `-- Auto-generated on-chain aggregates (${now})`,
    "",
    "DELETE FROM sale_round_member_stats;",
    "DELETE FROM sale_round_collections;",
    "DELETE FROM sale_rounds;",
    "",
  ];

  const colTuples: string[] = [];
  for (const col of filteredCollections) {
    const memberId =
      memberLookup.get(`${col.artist_id}:${normalizeMemberLookupKey(col.raw_member)}`) ??
      null;
    const comoAmount =
      col.objekt_class === "Double" || col.objekt_class === "Premier" ? 2 : 1;

    colTuples.push(
      `(${sqlStr(col.slug)}, ${sqlStr(col.collection_id)}, ${sqlStr(col.artist_id)}, ${sqlStr(memberId)}, ${sqlStr(col.raw_member)}, ${sqlStr(col.season)}, ${sqlStr(col.objekt_class)}, ${sqlStr(col.collection_no)}, ${sqlStr(col.on_offline)}, ${comoAmount}, ${col.total_mints}, ${col.total_mints}, ${col.spun_count}, ${col.unique_minters}, ${sqlStr(col.first_mint_at)}, ${sqlStr(col.last_mint_at)}, ${sqlStr(col.image_url)}, ${sqlStr(col.image_url)}, ${sqlStr(col.background_color)}, ${sqlStr(col.background_color)}, NULL, 0, ${sqlStr(now)})`,
    );
  }
  pushBatchedInserts(
    lines,
    "INSERT OR REPLACE INTO collections (slug, collection_id, artist_id, member_id, raw_member_name, season, objekt_class, collection_no, on_offline, como_amount, total_mints, max_serial, spun_count, unique_minters, first_mint_at, last_mint_at, front_image_url, thumbnail_image_url, accent_color, background_color, text_color, is_unobtainable, updated_at)",
    colTuples,
    25,
  );

  lines.push("");
  const dailyTuples = filteredDaily.map(
    (d) =>
      `(${sqlStr(d.collection_slug)}, ${sqlStr(d.mint_date)}, ${d.mint_count}, ${d.unique_minters}, 0)`,
  );
  pushBatchedInserts(
    lines,
    "INSERT OR REPLACE INTO collection_daily_mints (collection_slug, mint_date, mint_count, unique_minters, spin_count)",
    dailyTuples,
    60,
  );

  lines.push("");
  let roundMemberStatRows = 0;
  const roundTuples: string[] = [];
  const roundColTuples: string[] = [];
  const statTuples: string[] = [];

  for (const r of validRounds) {
    const totalMints = Array.from(r.memberMints.values()).reduce(
      (a, b) => a + b,
      0,
    );
    roundTuples.push(
      `(${sqlStr(r.slug)}, ${sqlStr(r.artistId)}, ${sqlStr(r.title)}, ${sqlStr(r.season)}, ${sqlStr(r.objektClass)}, ${sqlStr(r.onOffline)}, ${sqlStr(r.saleMechanic)}, ${sqlStr(r.startAt)}, ${sqlStr(r.endAt)}, ${sqlNum(r.unitPriceUsd)}, ${totalMints}, ${r.roundUniqueBuyers}, ${r.memberMints.size}, ${sqlBool(r.includeInPopularity)}, ${sqlBool(r.isAutoDetected)}, ${sqlStr(r.notes)})`,
    );

    for (const cSlug of r.collectionSlugs) {
      roundColTuples.push(`(${sqlStr(r.slug)}, ${sqlStr(cSlug)})`);
    }

    const stats = statsByRoundSlug.get(r.slug) ?? [];
    for (const s of stats) {
      roundMemberStatRows++;
      statTuples.push(
        `(${sqlStr(s.roundSlug)}, ${sqlStr(s.memberId)}, ${s.mintCount}, ${s.uniqueBuyers}, ${s.mintsPerBuyer}, ${sqlNum(s.topBuyerSharePct)}, ${s.rank}, ${s.uniqueBuyersRank}, ${s.sharePct}, ${s.uniqueBuyersSharePct}, ${s.relativeIndex}, ${s.uniqueBuyersRelativeIndex}, ${s.zScore}, ${sqlNum(s.rankDeltaPrev)}, ${sqlNum(s.rolling5Rank)}, ${sqlNum(s.rolling10Rank)}, ${sqlNum(s.rolling5RelativeIndex)}, ${sqlNum(s.rolling10RelativeIndex)}, ${sqlBool(s.isAnomaly)}, ${sqlStr(s.anomalyDirection)}, ${sqlStr(s.anomalyReason)})`,
      );
    }
  }

  pushBatchedInserts(
    lines,
    "INSERT OR REPLACE INTO sale_rounds (slug, artist_id, title, season, objekt_class, on_offline, sale_mechanic, start_at, end_at, unit_price_usd, total_mints, unique_buyers, participating_members, include_in_popularity, is_auto_detected, notes)",
    roundTuples,
    25,
  );
  pushBatchedInserts(
    lines,
    "INSERT OR IGNORE INTO sale_round_collections (round_slug, collection_slug)",
    roundColTuples,
    60,
  );
  pushBatchedInserts(
    lines,
    "INSERT OR REPLACE INTO sale_round_member_stats (round_slug, member_id, mint_count, unique_buyers, mints_per_buyer, top_buyer_share_pct, rank, unique_buyers_rank, share_pct, unique_buyers_share_pct, relative_index, unique_buyers_relative_index, z_score, rank_delta_prev, rolling5_rank, rolling10_rank, rolling5_relative_index, rolling10_relative_index, is_anomaly, anomaly_direction, anomaly_reason)",
    statTuples,
    25,
  );

  // Update sync_state cursors
  lines.push("");
  const chainSummaries: Record<string, unknown> = {};
  for (const chain of ["polygon", "abstract"] as const) {
    const chainStats = store.db
      .prepare(
        `SELECT MIN(block_number) AS first_block, MAX(block_number) AS last_block,
                MIN(minted_at) AS first_ts, MAX(minted_at) AS last_ts, COUNT(*) AS cnt
         FROM raw_mints WHERE chain = ?`,
      )
      .get(chain) as
      | {
          first_block: number | null;
          last_block: number | null;
          first_ts: string | null;
          last_ts: string | null;
          cnt: number;
        }
      | undefined;
    if (chainStats && chainStats.cnt > 0) {
      chainSummaries[chain] = chainStats;
      lines.push(
        `INSERT OR REPLACE INTO sync_state (chain, last_indexed_block, last_indexed_timestamp, total_tokens_indexed, updated_at) VALUES (${sqlStr(chain)}, ${chainStats.last_block ?? 0}, ${sqlStr(chainStats.last_ts)}, ${chainStats.cnt}, ${sqlStr(now)});`,
      );
    }
  }

  mkdirSync(resolve(outFile, ".."), { recursive: true });
  writeFileSync(outFile, lines.join("\n") + "\n", "utf8");

  // 6. Secondary User-to-User Trade Aggregation (STRICTLY isolated from raw_mints!)
  const tradeSummary = aggregateTradesAndEmitSql(store.db, {
    dataRoot,
    tradesOutFile,
    now,
  });

  const snapshot = {
    generatedAt: now,
    chains: chainSummaries,
    counts: {
      collections: filteredCollections.length,
      dailyRows: filteredDaily.length,
      rounds: validRounds.length,
      roundMemberStatRows,
      confirmedTradesCount: tradeSummary.confirmedTradesCount,
      asymmetricTradesCount: tradeSummary.asymmetricTradesCount,
      confirmedTradedObjekts: tradeSummary.confirmedTradedObjekts,
      directP2PTransfersCount: tradeSummary.directP2PTransfersCount,
      tradeCollectionsCount: tradeSummary.tradeCollectionsCount,
    },
    rounds: validRounds
      .sort((a, b) => b.startAt.localeCompare(a.startAt))
      .map((r) => ({
        slug: r.slug,
        artistId: r.artistId,
        title: r.title,
        season: r.season,
        objektClass: r.objektClass,
        saleMechanic: r.saleMechanic,
        startAt: r.startAt,
        endAt: r.endAt,
        totalMints: Array.from(r.memberMints.values()).reduce((a, b) => a + b, 0),
        uniqueBuyers: r.roundUniqueBuyers,
        participatingMembers: r.memberMints.size,
        includeInPopularity: r.includeInPopularity,
        stats: statsByRoundSlug.get(r.slug) ?? [],
      })),
  };
  writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), "utf8");

  return {
    collectionsCount: filteredCollections.length,
    dailyRowsCount: filteredDaily.length,
    roundsCount: validRounds.length,
    roundMemberStatRows,
    confirmedTradesCount: tradeSummary.confirmedTradesCount,
    confirmedTradedObjekts: tradeSummary.confirmedTradedObjekts,
    directP2PTransfersCount: tradeSummary.directP2PTransfersCount,
    tradeCollectionsCount: tradeSummary.tradeCollectionsCount,
    outFile,
    tradesOutFile,
    snapshotFile,
  };
}

export interface AggregateTradesSummary {
  confirmedTradesCount: number;
  asymmetricTradesCount: number;
  confirmedTradedObjekts: number;
  directP2PTransfersCount: number;
  tradeCollectionsCount: number;
  tradesOutFile: string;
}

/**
 * Fast, read-only-safe secondary trade aggregator (`sync-trades.sql`).
 * Strictly reads `raw_transfers` + joined `token_metadata` and never scans `raw_mints`.
 */
export function aggregateTradesAndEmitSql(
  db: DatabaseSync,
  options: {
    dataRoot?: string;
    tradesOutFile?: string;
    now?: string;
  } = {},
): AggregateTradesSummary {
  const dataRoot = options.dataRoot ?? resolve(process.cwd(), "data");
  const tradesOutFile =
    options.tradesOutFile ??
    resolve(process.cwd(), "packages/db/generated/sync-trades.sql");
  const now = options.now ?? new Date().toISOString();

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

  const rawTransfers = db
    .prepare(
      `SELECT tx_hash, log_index, token_id, chain, block_number, transferred_at, from_addr, to_addr
       FROM raw_transfers
       ORDER BY transferred_at ASC, block_number ASC, log_index ASC`,
    )
    .all() as unknown as Array<{
    tx_hash: string;
    log_index: number;
    token_id: number;
    chain: "polygon" | "abstract";
    block_number: number;
    transferred_at: string;
    from_addr: string;
    to_addr: string;
  }>;

  const detectedTrades = detectTradesFromTransfers(
    rawTransfers.map((t) => ({
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

  // Load metadata for all tokens referenced in raw_transfers in one indexed join
  interface TokenMetaRow {
    token_id: number;
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

  const metaByToken = new Map<number, TokenMetaRow>();
  if (detectedTrades.eligibleTransfers.length > 0) {
    const metaRows = db
      .prepare(
        `SELECT DISTINCT
           tm.token_id, tm.slug, tm.collection_id, tm.artist_id, tm.raw_member,
           tm.season, tm.objekt_class, tm.collection_no, tm.on_offline,
           tm.image_url, tm.background_color
         FROM token_metadata tm
         WHERE tm.token_id IN (SELECT DISTINCT token_id FROM raw_transfers)`,
      )
      .all() as unknown as TokenMetaRow[];
    for (const row of metaRows) {
      metaByToken.set(row.token_id, row);
    }
  }

  interface ColTradeAcc {
    meta: TokenMetaRow;
    memberId: string | null;
    tradedCount: number;
    tradeSessions: number;
    directTransferCount: number;
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
    firstTradeAt: string | null;
    lastTradeAt: string | null;
  }

  interface MemberTradeAcc {
    memberId: string;
    artistId: string;
    tradedCount: number;
    tradeSessions: number;
    directTransferCount: number;
    traders: Set<string>;
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
    overpayerCounts: Map<string, number>;
    sameEdition2xCount: number;
    sameEdition3xCount: number;
    sameEditionBulkCount: number;
    sameEditionOverpayerCounts: Map<string, number>;
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
    traders: Set<string>;
  }

  const colTradeMap = new Map<string, ColTradeAcc>();
  const memberTradeMap = new Map<string, MemberTradeAcc>();
  const dailyTradeMap = new Map<string, DailyTradeAcc>();

  const ensureColAcc = (meta: TokenMetaRow): ColTradeAcc => {
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
      };
      dailyTradeMap.set(key, acc);
    }
    return acc;
  };

  // Count all eligible P2P direct transfers per collection/member/day
  let directP2PTransfersCount = 0;
  for (const t of detectedTrades.eligibleTransfers) {
    directP2PTransfersCount++;
    const meta = metaByToken.get(t.tokenId);
    if (!meta || !trackedArtists.has(meta.artist_id as "triples" | "artms")) {
      continue;
    }
    const isConfirmed = detectedTrades.tradedTransferKeys.has(
      makeTransferKey(t.txHash, t.logIndex),
    );
    const colAcc = ensureColAcc(meta);
    colAcc.directTransferCount++;
    if (isConfirmed) {
      colAcc.traders.add(t.from);
      colAcc.traders.add(t.to);
    }
    if (colAcc.memberId) {
      const mAcc = ensureMemberAcc(colAcc.memberId, meta.artist_id);
      mAcc.directTransferCount++;
    }
    const dayAcc = ensureDailyAcc(meta.artist_id, t.transferredAt.slice(0, 10));
    dayAcc.directTransfers++;
  }

  // Count confirmed reciprocal trades and build recent trade feed
  let confirmedTradedObjekts = 0;
  let asymmetricTradesCount = 0;
  const recentTradeRows: Array<{
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

  for (const trade of detectedTrades.trades) {
    const touchedArtists = new Set<string>();
    const touchedCols = new Set<string>();
    const touchedMembers = new Set<string>();
    const tradeDate = trade.completedAt.slice(0, 10);

    const sym = classifyTradeSymmetry(trade.sideALegs.length, trade.sideBLegs.length);
    const realisticAsym = isRealisticAsymmetricSwap(
      trade.sideALegs.length,
      trade.sideBLegs.length,
    );
    if (realisticAsym) asymmetricTradesCount++;

    const sameClass = isSameClassSwap(
      trade.sideALegs.map((l) => metaByToken.get(l.tokenId)?.objekt_class),
      trade.sideBLegs.map((l) => metaByToken.get(l.tokenId)?.objekt_class),
    );

    // Evaluate clean apples-to-apples Solo N:1 (2:1..6:1, same class + same format, cross-member)
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
        memberLookup.get(`${m.artist_id}:${normalizeMemberLookupKey(m.raw_member)}`) ??
        null;
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

    // Exclude extreme >6:1 / >10-card alt-wallet dumps from distorting exchange-rate averages
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

        const colAcc = ensureColAcc(meta);
        colAcc.tradedCount++;
        colAcc.traders.add(leg.from);
        colAcc.traders.add(leg.to);
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
          mAcc.traders.add(leg.from);
          mAcc.traders.add(leg.to);
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
        dayAcc.traders.add(leg.from);
        dayAcc.traders.add(leg.to);
      }
    }

    // Attribute Grid-Tier-Aware Clean Solo N:1 & Strict Same-Edition swaps + Unique Overpayers
    if (isCleanSolo && premSideLegs.length === 1) {
      const premLeg = premSideLegs[0]!;
      const pMeta = metaByToken.get(premLeg.tokenId);
      if (pMeta && trackedArtists.has(pMeta.artist_id as "triples" | "artms")) {
        const overpayer = premLeg.to.toLowerCase();
        const colAcc = ensureColAcc(pMeta);
        colAcc.cleanSolo2xCount++;
        if (sym.is3to1Plus) colAcc.cleanSolo3xCount++;
        colAcc.overpayers.add(overpayer);
        if (isSameEdition) {
          colAcc.sameEdition2xCount++;
          if (sym.is3to1Plus) colAcc.sameEdition3xCount++;
          colAcc.sameEditionOverpayers.add(overpayer);
        }

        if (colAcc.memberId) {
          const mAcc = ensureMemberAcc(colAcc.memberId, pMeta.artist_id);
          mAcc.cleanSolo2xCount++;
          if (sym.is3to1Plus) mAcc.cleanSolo3xCount++;
          mAcc.overpayerCounts.set(
            overpayer,
            (mAcc.overpayerCounts.get(overpayer) ?? 0) + 1,
          );
          if (isSameEdition) {
            mAcc.sameEdition2xCount++;
            if (sym.is3to1Plus) mAcc.sameEdition3xCount++;
            mAcc.sameEditionOverpayerCounts.set(
              overpayer,
              (mAcc.sameEditionOverpayerCounts.get(overpayer) ?? 0) + 1,
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
        recentTradeRows.push({
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
    }
  }

  const round4 = (v: number) => Math.round(v * 10000) / 10000;

  // Emit deterministic sync-trades.sql
  const tradeLines: string[] = [
    `-- Auto-generated secondary trade aggregates (${now})`,
    "",
    "DELETE FROM recent_trades;",
    "DELETE FROM daily_trade_stats;",
    "DELETE FROM member_trade_stats;",
    "DELETE FROM collection_trade_stats;",
    "",
  ];

  for (const col of colTradeMap.values()) {
    const avgRate = col.tradedCount > 0 ? round4(col.rateSum / col.tradedCount) : 1;
    const scAvgRate =
      col.sameClassLegs > 0 ? round4(col.sameClassRateSum / col.sameClassLegs) : 1;
    tradeLines.push(
      `INSERT OR REPLACE INTO collection_trade_stats (collection_slug, collection_id, artist_id, member_id, raw_member_name, season, objekt_class, collection_no, on_offline, front_image_url, background_color, traded_count, trade_sessions, direct_transfer_count, unique_traders, premium_count, bulk_count, premium_2x_count, premium_3x_count, avg_exchange_rate, max_exchange_rate, same_class_legs, same_class_premium_count, same_class_bulk_count, same_class_2x_count, same_class_3x_count, same_class_avg_rate, clean_solo_2x_count, clean_solo_3x_count, unique_overpayers, same_edition_2x_count, same_edition_3x_count, same_edition_overpayers, first_trade_at, last_trade_at, updated_at) VALUES (${sqlStr(col.meta.slug)}, ${sqlStr(col.meta.collection_id)}, ${sqlStr(col.meta.artist_id)}, ${sqlStr(col.memberId)}, ${sqlStr(col.meta.raw_member)}, ${sqlStr(col.meta.season)}, ${sqlStr(col.meta.objekt_class)}, ${sqlStr(col.meta.collection_no)}, ${sqlStr(col.meta.on_offline)}, ${sqlStr(col.meta.image_url)}, ${sqlStr(col.meta.background_color)}, ${col.tradedCount}, ${col.tradeSessions}, ${col.directTransferCount}, ${col.traders.size}, ${col.premiumCount}, ${col.bulkCount}, ${col.premium2xCount}, ${col.premium3xCount}, ${avgRate}, ${round4(col.maxExchangeRate)}, ${col.sameClassLegs}, ${col.sameClassPremiumCount}, ${col.sameClassBulkCount}, ${col.sameClass2xCount}, ${col.sameClass3xCount}, ${scAvgRate}, ${col.cleanSolo2xCount}, ${col.cleanSolo3xCount}, ${col.overpayers.size}, ${col.sameEdition2xCount}, ${col.sameEdition3xCount}, ${col.sameEditionOverpayers.size}, ${sqlStr(col.firstTradeAt)}, ${sqlStr(col.lastTradeAt)}, ${sqlStr(now)});`,
    );
  }

  tradeLines.push("");
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
          traders: new Set<string>(),
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
          overpayerCounts: new Map<string, number>(),
          sameEdition2xCount: 0,
          sameEdition3xCount: 0,
          sameEditionBulkCount: 0,
          sameEditionOverpayerCounts: new Map<string, number>(),
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
      tradeLines.push(
        `INSERT OR REPLACE INTO member_trade_stats (member_id, artist_id, traded_count, trade_sessions, direct_transfer_count, unique_traders, collections_traded, trade_rank, trade_share_pct, trade_relative_index, premium_count, bulk_count, premium_2x_count, premium_3x_count, avg_exchange_rate, max_exchange_rate, same_class_legs, same_class_premium_count, same_class_bulk_count, same_class_2x_count, same_class_3x_count, same_class_avg_rate, clean_solo_2x_count, clean_solo_3x_count, clean_solo_bulk_count, unique_overpayers, top_overpayer_share_pct, same_edition_2x_count, same_edition_3x_count, same_edition_bulk_count, same_edition_overpayers, same_edition_top_share_pct, last_trade_at, updated_at) VALUES (${sqlStr(a.memberId)}, ${sqlStr(a.artistId)}, ${a.tradedCount}, ${a.tradeSessions}, ${a.directTransferCount}, ${a.traders.size}, ${a.collections.size}, ${r.tradeRank}, ${r.tradeSharePct}, ${r.tradeRelativeIndex}, ${a.premiumCount}, ${a.bulkCount}, ${a.premium2xCount}, ${a.premium3xCount}, ${avgRate}, ${round4(a.maxExchangeRate)}, ${a.sameClassLegs}, ${a.sameClassPremiumCount}, ${a.sameClassBulkCount}, ${a.sameClass2xCount}, ${a.sameClass3xCount}, ${scAvgRate}, ${a.cleanSolo2xCount}, ${a.cleanSolo3xCount}, ${a.cleanSoloBulkCount}, ${a.overpayerCounts.size}, ${sqlNum(topOverpayerSharePct)}, ${a.sameEdition2xCount}, ${a.sameEdition3xCount}, ${a.sameEditionBulkCount}, ${a.sameEditionOverpayerCounts.size}, ${sqlNum(sameEditionTopSharePct)}, ${sqlStr(a.lastTradeAt)}, ${sqlStr(now)});`,
      );
    }
  }

  tradeLines.push("");
  for (const d of dailyTradeMap.values()) {
    tradeLines.push(
      `INSERT OR REPLACE INTO daily_trade_stats (artist_id, trade_date, trade_sessions, asymmetric_sessions, ratio_2x_sessions, ratio_3x_sessions, same_class_asymmetric_sessions, traded_objekts, direct_transfers, unique_traders) VALUES (${sqlStr(d.artistId)}, ${sqlStr(d.tradeDate)}, ${d.tradeSessions}, ${d.asymmetricSessions}, ${d.ratio2xSessions}, ${d.ratio3xSessions}, ${d.sameClassAsymmetricSessions}, ${d.tradedObjekts}, ${d.directTransfers}, ${d.traders.size});`,
    );
  }

  // Keep up to 70 newest general swaps + up to 50 newest clean N:1 swaps + up to 40 newest >=2:1 asymmetric swaps per artist
  tradeLines.push("");
  const perArtistGeneralCount = new Map<string, number>();
  const perArtistCleanSoloCount = new Map<string, number>();
  const perArtistAsymCount = new Map<string, number>();
  const emittedRecentKeys = new Set<string>();
  recentTradeRows.sort((a, b) => b.tradedAt.localeCompare(a.tradedAt));

  for (const rt of recentTradeRows) {
    const key = `${rt.tradeId}|${rt.artistId}`;
    if (emittedRecentKeys.has(key)) continue;

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

    emittedRecentKeys.add(key);
    if (takeGeneral) perArtistGeneralCount.set(rt.artistId, genCount + 1);
    if (rt.isCleanSolo) perArtistCleanSoloCount.set(rt.artistId, cleanCount + 1);
    if (rt.isAsymmetric && rt.ratioMultiple >= 2) {
      perArtistAsymCount.set(rt.artistId, asymCount + 1);
    }

    tradeLines.push(
      `INSERT OR REPLACE INTO recent_trades (trade_id, artist_id, chain, traded_at, duration_seconds, side_a_count, side_b_count, is_asymmetric, is_same_class, is_clean_solo, is_same_edition, ratio_multiple, wallet_a_short, wallet_b_short, side_a_summary, side_b_summary) VALUES (${sqlStr(rt.tradeId)}, ${sqlStr(rt.artistId)}, ${sqlStr(rt.chain)}, ${sqlStr(rt.tradedAt)}, ${rt.durationSeconds}, ${rt.sideACount}, ${rt.sideBCount}, ${sqlBool(rt.isAsymmetric)}, ${sqlBool(rt.isSameClass)}, ${sqlBool(rt.isCleanSolo)}, ${sqlBool(rt.isSameEdition)}, ${rt.ratioMultiple}, ${sqlStr(rt.walletAShort)}, ${sqlStr(rt.walletBShort)}, ${sqlStr(rt.sideASummary)}, ${sqlStr(rt.sideBSummary)});`,
    );
  }

  mkdirSync(resolve(tradesOutFile, ".."), { recursive: true });
  writeFileSync(tradesOutFile, tradeLines.join("\n") + "\n", "utf8");

  return {
    confirmedTradesCount: detectedTrades.trades.length,
    asymmetricTradesCount,
    confirmedTradedObjekts,
    directP2PTransfersCount,
    tradeCollectionsCount: colTradeMap.size,
    tradesOutFile,
  };
}
