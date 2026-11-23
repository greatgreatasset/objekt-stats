import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCurationData } from "@objekt-stats/db/curation-loader";
import {
  computeArtistSeriesStats,
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

function normalizeMemberLookupKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Maps a collection number into an auto-grouped round key.
 * - First Class (1xx): Edition buckets (101-108 = Ed1, 109-116 = Ed2, 117-120 = Ed3)
 * - Double / Premier / Motion (3xx, 4xx, 5xx): Exact collectionNo (e.g. 301Z)
 * - Special (2xx) / Welcome (100Z): Grouped by class + collectionNo (excluded from popularity)
 */
function inferAutoRoundGroup(
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
  outFile: string;
}

export function aggregateAndEmitSql(
  store: IndexerStore,
  options: {
    dataRoot?: string;
    outFile?: string;
  } = {},
): AggregateOutputSummary {
  const dataRoot = options.dataRoot ?? resolve(process.cwd(), "data");
  const outFile =
    options.outFile ??
    resolve(process.cwd(), "packages/db/generated/sync-onchain.sql");

  const curation = loadCurationData(dataRoot);
  const trackedArtists = new Set(curation.artists.map((a) => a.id));

  // Build lookup: artistId + normalizedName -> memberId
  const memberLookup = new Map<string, string>();
  const artistMemberTotals = new Map<string, number>();
  for (const artist of curation.artists) {
    artistMemberTotals.set(artist.id, artist.members.length);
    for (const m of artist.members) {
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.name)}`, m.id);
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.cosmoName)}`, m.id);
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.fullName)}`, m.id);
    }
  }

  // 1. Aggregate per-collection totals from SQLite
  const collectionRows = store.db
    .prepare(
      `SELECT
        tm.slug,
        tm.collection_id,
        tm.artist_id,
        tm.raw_member,
        tm.season,
        tm.objekt_class,
        tm.collection_no,
        tm.on_offline,
        MAX(tm.image_url) AS image_url,
        MAX(tm.background_color) AS background_color,
        COUNT(*) AS total_mints,
        COUNT(DISTINCT rm.minter) AS unique_minters,
        MIN(rm.minted_at) AS first_mint_at,
        MAX(rm.minted_at) AS last_mint_at,
        (SELECT COUNT(*) FROM raw_spins rs WHERE rs.token_id IN (
          SELECT t2.token_id FROM token_metadata t2 WHERE t2.slug = tm.slug
        )) AS spun_count
      FROM token_metadata tm
      JOIN raw_mints rm ON rm.token_id = tm.token_id
      GROUP BY tm.slug`,
    )
    .all() as Array<{
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
    spun_count: number;
  }>;

  const filteredCollections = collectionRows.filter((c) =>
    trackedArtists.has(c.artist_id as "triples" | "artms"),
  );

  // 2. Daily mints per collection
  const dailyRows = store.db
    .prepare(
      `SELECT
        tm.slug AS collection_slug,
        substr(rm.minted_at, 1, 10) AS mint_date,
        COUNT(*) AS mint_count,
        COUNT(DISTINCT rm.minter) AS unique_minters
      FROM token_metadata tm
      JOIN raw_mints rm ON rm.token_id = tm.token_id
      GROUP BY tm.slug, substr(rm.minted_at, 1, 10)`,
    )
    .all() as Array<{
    collection_slug: string;
    mint_date: string;
    mint_count: number;
    unique_minters: number;
  }>;

  const validSlugs = new Set(filteredCollections.map((c) => c.slug));
  const filteredDaily = dailyRows.filter((d) => validSlugs.has(d.collection_slug));

  // 3. Group collections into Sale Rounds (curated YAML overrides + auto-detection)
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
  }

  const rounds = new Map<string, RoundAccumulator>();

  for (const col of filteredCollections) {
    const memberId =
      memberLookup.get(`${col.artist_id}:${normalizeMemberLookupKey(col.raw_member)}`) ??
      null;
    if (!memberId) continue;

    // Check curated round matchers first
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
      };
      rounds.set(meta.slug, acc);
    }

    acc.collectionSlugs.push(col.slug);
    acc.memberMints.set(
      memberId,
      (acc.memberMints.get(memberId) ?? 0) + col.total_mints,
    );
    if (col.first_mint_at < acc.startAt) acc.startAt = col.first_mint_at;
    if (col.last_mint_at > acc.endAt) acc.endAt = col.last_mint_at;
  }

  // Keep rounds with >= 2 participating members so single-member test mints don't pollute rankings
  const validRounds = Array.from(rounds.values()).filter(
    (r) => r.memberMints.size >= 2,
  );

  // Detect unit_select automatically when an auto-detected online round has a strict subset of members
  for (const r of validRounds) {
    const fullCount = artistMemberTotals.get(r.artistId) ?? 24;
    if (
      r.isAutoDetected &&
      r.saleMechanic === "member_select" &&
      r.memberMints.size < fullCount &&
      r.memberMints.size >= 2 &&
      fullCount >= 5
    ) {
      // Only reclassify as unit_select if <= 60% of roster participated; partial recent window might just have missed quiet members
      if (r.memberMints.size <= Math.floor(fullCount * 0.6)) {
        r.saleMechanic = "unit_select";
      }
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
          ([memberId, mintCount]) => ({ memberId, mintCount }),
        ),
      }));

    const computed = computeArtistSeriesStats(artistRounds);
    for (const [slug, stats] of computed.entries()) {
      statsByRoundSlug.set(slug, stats);
    }
  }

  // 5. Emit deterministic SQL for D1
  const now = new Date().toISOString();
  const lines: string[] = [
    `-- Auto-generated on-chain aggregates (${now})`,
    "-- Apply locally: npx --workspace=@objekt-stats/web wrangler d1 execute objekt-stats-db --local --file=../../packages/db/generated/sync-onchain.sql",
    "-- Apply remote:  npx --workspace=@objekt-stats/web wrangler d1 execute objekt-stats-db --remote --file=../../packages/db/generated/sync-onchain.sql --yes",
    "",
  ];

  // Clear derived round tables before re-inserting fresh recomputed metrics
  lines.push("DELETE FROM sale_round_member_stats;");
  lines.push("DELETE FROM sale_round_collections;");
  lines.push("DELETE FROM sale_rounds;");
  lines.push("");

  for (const col of filteredCollections) {
    const memberId =
      memberLookup.get(`${col.artist_id}:${normalizeMemberLookupKey(col.raw_member)}`) ??
      null;
    const comoAmount =
      col.objekt_class === "Double" || col.objekt_class === "Premier" ? 2 : 1;

    lines.push(
      `INSERT OR REPLACE INTO collections (slug, collection_id, artist_id, member_id, raw_member_name, season, objekt_class, collection_no, on_offline, como_amount, total_mints, max_serial, spun_count, unique_minters, first_mint_at, last_mint_at, front_image_url, thumbnail_image_url, accent_color, background_color, text_color, is_unobtainable, updated_at) VALUES (${sqlStr(col.slug)}, ${sqlStr(col.collection_id)}, ${sqlStr(col.artist_id)}, ${sqlStr(memberId)}, ${sqlStr(col.raw_member)}, ${sqlStr(col.season)}, ${sqlStr(col.objekt_class)}, ${sqlStr(col.collection_no)}, ${sqlStr(col.on_offline)}, ${comoAmount}, ${col.total_mints}, ${col.total_mints}, ${col.spun_count}, ${col.unique_minters}, ${sqlStr(col.first_mint_at)}, ${sqlStr(col.last_mint_at)}, ${sqlStr(col.image_url)}, ${sqlStr(col.image_url)}, ${sqlStr(col.background_color)}, ${sqlStr(col.background_color)}, NULL, 0, ${sqlStr(now)});`,
    );
  }

  lines.push("");
  for (const d of filteredDaily) {
    lines.push(
      `INSERT OR REPLACE INTO collection_daily_mints (collection_slug, mint_date, mint_count, unique_minters, spin_count) VALUES (${sqlStr(d.collection_slug)}, ${sqlStr(d.mint_date)}, ${d.mint_count}, ${d.unique_minters}, 0);`,
    );
  }

  lines.push("");
  let roundMemberStatRows = 0;

  for (const r of validRounds) {
    const totalMints = Array.from(r.memberMints.values()).reduce(
      (a, b) => a + b,
      0,
    );
    lines.push(
      `INSERT OR REPLACE INTO sale_rounds (slug, artist_id, title, season, objekt_class, on_offline, sale_mechanic, start_at, end_at, unit_price_usd, total_mints, participating_members, include_in_popularity, is_auto_detected, notes) VALUES (${sqlStr(r.slug)}, ${sqlStr(r.artistId)}, ${sqlStr(r.title)}, ${sqlStr(r.season)}, ${sqlStr(r.objektClass)}, ${sqlStr(r.onOffline)}, ${sqlStr(r.saleMechanic)}, ${sqlStr(r.startAt)}, ${sqlStr(r.endAt)}, ${sqlNum(r.unitPriceUsd)}, ${totalMints}, ${r.memberMints.size}, ${sqlBool(r.includeInPopularity)}, ${sqlBool(r.isAutoDetected)}, ${sqlStr(r.notes)});`,
    );

    for (const cSlug of r.collectionSlugs) {
      lines.push(
        `INSERT OR IGNORE INTO sale_round_collections (round_slug, collection_slug) VALUES (${sqlStr(r.slug)}, ${sqlStr(cSlug)});`,
      );
    }

    const stats = statsByRoundSlug.get(r.slug) ?? [];
    for (const s of stats) {
      roundMemberStatRows++;
      lines.push(
        `INSERT OR REPLACE INTO sale_round_member_stats (round_slug, member_id, mint_count, rank, share_pct, relative_index, z_score, rank_delta_prev, rolling5_rank, rolling10_rank, rolling5_relative_index, rolling10_relative_index, is_anomaly, anomaly_direction, anomaly_reason) VALUES (${sqlStr(s.roundSlug)}, ${sqlStr(s.memberId)}, ${s.mintCount}, ${s.rank}, ${s.sharePct}, ${s.relativeIndex}, ${s.zScore}, ${sqlNum(s.rankDeltaPrev)}, ${sqlNum(s.rolling5Rank)}, ${sqlNum(s.rolling10Rank)}, ${sqlNum(s.rolling5RelativeIndex)}, ${sqlNum(s.rolling10RelativeIndex)}, ${sqlBool(s.isAnomaly)}, ${sqlStr(s.anomalyDirection)}, ${sqlStr(s.anomalyReason)});`,
      );
    }
  }

  // Update sync_state cursors
  lines.push("");
  for (const chain of ["polygon", "abstract"] as const) {
    const chainStats = store.db
      .prepare(
        `SELECT MAX(block_number) AS last_block, MAX(minted_at) AS last_ts, COUNT(*) AS cnt
         FROM raw_mints WHERE chain = ?`,
      )
      .get(chain) as
      | { last_block: number | null; last_ts: string | null; cnt: number }
      | undefined;
    if (chainStats && chainStats.cnt > 0) {
      lines.push(
        `INSERT OR REPLACE INTO sync_state (chain, last_indexed_block, last_indexed_timestamp, total_tokens_indexed, updated_at) VALUES (${sqlStr(chain)}, ${chainStats.last_block ?? 0}, ${sqlStr(chainStats.last_ts)}, ${chainStats.cnt}, ${sqlStr(now)});`,
      );
    }
  }

  mkdirSync(resolve(outFile, ".."), { recursive: true });
  writeFileSync(outFile, lines.join("\n") + "\n", "utf8");

  return {
    collectionsCount: filteredCollections.length,
    dailyRowsCount: filteredDaily.length,
    roundsCount: validRounds.length,
    roundMemberStatRows,
    outFile,
  };
}
