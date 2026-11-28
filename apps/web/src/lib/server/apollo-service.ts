import { inArray } from "drizzle-orm";
import {
  apolloCollectionCache,
  apolloDropMetadata,
  type AppDatabase,
} from "@objekt-stats/db";
import {
  APOLLO_BASE_URL,
  classifyApolloProvenance,
  makeApolloDropKey,
  toApolloSlug,
  type ApolloCollectionStats,
  type ApolloDropProvenance,
  type ApolloMetadataApiResponse,
  type ProvenanceClass,
} from "@objekt-stats/stats";

const APOLLO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ApolloEnrichTarget {
  apolloSlug: string;
  dropKey: string;
  artistId: string;
  season: string;
  collectionNo: string;
  objektClass?: string;
  onOffline?: "online" | "offline";
  minExpectedCopies?: number;
}

function rowToDropProvenance(
  r: typeof apolloDropMetadata.$inferSelect,
): ApolloDropProvenance {
  return {
    dropKey: r.dropKey,
    sampleApolloSlug: r.sampleApolloSlug,
    artistId: r.artistId,
    season: r.season,
    collectionNo: r.collectionNo,
    description: r.description ?? null,
    eventSlug: r.eventSlug ?? null,
    eventName: r.eventName ?? null,
    eventType: r.eventType ?? null,
    eventDescription: r.eventDescription ?? null,
    twitterUrl: r.twitterUrl ?? null,
    eraSlug: r.eraSlug ?? null,
    eraName: r.eraName ?? null,
    eraImageUrl: r.eraImageUrl ?? null,
    provenanceClass: (r.provenanceClass as ProvenanceClass) || "unknown",
    passBillingMonth: r.passBillingMonth ?? null,
    passBillingLabel: r.passBillingLabel ?? null,
    isFreeDistribution: Boolean(r.isFreeDistribution),
    fetchedAt: r.fetchedAt,
  };
}

function rowToCollectionStats(
  r: typeof apolloCollectionCache.$inferSelect,
): ApolloCollectionStats {
  return {
    apolloSlug: r.apolloSlug,
    dropKey: r.dropKey,
    totalCopies: r.totalCopies,
    transferableCopies: r.transferableCopies,
    transferablePct: r.transferablePct,
    unobtainable: Boolean(r.unobtainable),
    description: r.description ?? null,
    eventSlug: r.eventSlug ?? null,
    eventName: r.eventName ?? null,
    eventType: r.eventType ?? null,
    eventDescription: r.eventDescription ?? null,
    twitterUrl: r.twitterUrl ?? null,
    eraSlug: r.eraSlug ?? null,
    eraName: r.eraName ?? null,
    eraImageUrl: r.eraImageUrl ?? null,
    medianPriceUsd: r.medianPriceUsd ?? null,
    minPriceUsd: r.minPriceUsd ?? null,
    maxPriceUsd: r.maxPriceUsd ?? null,
    listingCount: r.listingCount ?? null,
    priceUpdatedAt: r.priceUpdatedAt ?? null,
    fetchedAt: r.fetchedAt,
  };
}

/**
 * Loads all cached drop-level provenance records from D1 (`apollo_drop_metadata`).
 * Lightweight (~1k small rows) so `/wallet` immediately classifies free rewards & Pass+ drops.
 */
export async function loadAllApolloDrops(
  db: AppDatabase,
): Promise<Record<string, ApolloDropProvenance>> {
  const out: Record<string, ApolloDropProvenance> = {};
  try {
    const rows = await db.select().from(apolloDropMetadata);
    for (const r of rows) {
      out[r.dropKey] = rowToDropProvenance(r);
    }
  } catch {
    // Graceful fallback before migration is applied
  }
  return out;
}

/**
 * Loads cached per-member Apollo collection stats from D1 for a list of Apollo slugs.
 */
export async function readCachedApolloCollections(
  db: AppDatabase,
  apolloSlugs: string[],
): Promise<{
  found: Record<string, ApolloCollectionStats>;
  staleOrMissingSlugs: string[];
}> {
  const unique = Array.from(
    new Set(apolloSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  );
  const found: Record<string, ApolloCollectionStats> = {};
  const freshSet = new Set<string>();
  const nowMs = Date.now();

  try {
    for (let i = 0; i < unique.length; i += 80) {
      const slice = unique.slice(i, i + 80);
      const rows = await db
        .select()
        .from(apolloCollectionCache)
        .where(inArray(apolloCollectionCache.apolloSlug, slice));

      for (const r of rows) {
        const stats = rowToCollectionStats(r);
        found[r.apolloSlug] = stats;
        const fetchedMs = Date.parse(r.fetchedAt);
        if (!Number.isNaN(fetchedMs) && nowMs - fetchedMs < APOLLO_CACHE_TTL_MS) {
          freshSet.add(r.apolloSlug);
        }
      }
    }
  } catch {
    // Table may not be migrated yet
  }

  const staleOrMissingSlugs = unique.filter((slug) => !freshSet.has(slug));
  return { found, staleOrMissingSlugs };
}

async function fetchSingleApolloMetadata(
  apolloSlug: string,
): Promise<ApolloMetadataApiResponse | null> {
  try {
    const res = await fetch(
      `${APOLLO_BASE_URL}/api/objekts/metadata/${encodeURIComponent(apolloSlug)}`,
      {
        headers: {
          "user-agent": "objekt-stats/1.0 (+https://objektstats.com)",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as ApolloMetadataApiResponse;
  } catch {
    return null;
  }
}

/**
 * Read-through D1 cache wrapper around `https://apollo.cafe/api/objekts/metadata/{slug}`.
 * Respectfully caps external requests per call (`maxFetch`), fetches in small waves,
 * persists both per-collection supply/market stats and drop-level provenance in D1.
 */
export async function enrichApolloCollectionsWithCache(
  db: AppDatabase,
  rawD1: D1Database,
  targets: ApolloEnrichTarget[],
  maxFetch = 15,
): Promise<{
  collections: Record<string, ApolloCollectionStats>;
  newDrops: Record<string, ApolloDropProvenance>;
  remainingSlugs: string[];
}> {
  const targetBySlug = new Map<string, ApolloEnrichTarget>();
  for (const t of targets) {
    const slug = t.apolloSlug.trim().toLowerCase();
    if (!slug) continue;
    if (!targetBySlug.has(slug)) {
      targetBySlug.set(slug, { ...t, apolloSlug: slug });
    }
  }

  const allSlugs = Array.from(targetBySlug.keys());
  if (allSlugs.length === 0) {
    return { collections: {}, newDrops: {}, remainingSlugs: [] };
  }

  const { found, staleOrMissingSlugs: baseStaleOrMissing } =
    await readCachedApolloCollections(db, allSlugs);

  // Also treat a cached Apollo row as stale if our live on-chain mint count already
  // exceeds its cached `totalCopies` (happens when Apollo was cached mid-drop).
  const staleSet = new Set(baseStaleOrMissing);
  for (const [slug, t] of targetBySlug.entries()) {
    const cached = found[slug];
    if (
      cached &&
      t.minExpectedCopies !== undefined &&
      t.minExpectedCopies > 0 &&
      cached.totalCopies < t.minExpectedCopies
    ) {
      staleSet.add(slug);
    }
  }
  const staleOrMissingSlugs = allSlugs.filter((slug) => staleSet.has(slug));

  const safeCap = Math.min(Math.max(0, maxFetch), 20);
  const toFetch = staleOrMissingSlugs.slice(0, safeCap);
  const remainingSlugs = staleOrMissingSlugs.slice(toFetch.length);

  const newlyFetchedCols: ApolloCollectionStats[] = [];
  const newlyFetchedDrops: ApolloDropProvenance[] = [];
  const seenDropKeys = new Set<string>();
  const now = new Date().toISOString();

  // Fetch politely in waves of 5
  for (let i = 0; i < toFetch.length; i += 5) {
    const wave = toFetch.slice(i, i + 5);
    const waveRes = await Promise.all(
      wave.map(async (slug) => ({
        slug,
        payload: await fetchSingleApolloMetadata(slug),
      })),
    );

    for (const { slug, payload } of waveRes) {
      if (!payload) continue;
      const t = targetBySlug.get(slug)!;
      const ev = payload.data?.event ?? null;
      const desc = payload.data?.description?.trim() || null;
      const era = ev?.era ?? null;
      const dropKey =
        t.dropKey || makeApolloDropKey(t.artistId, t.season, t.collectionNo);

      const colStats: ApolloCollectionStats = {
        apolloSlug: slug,
        dropKey,
        totalCopies: payload.total ?? 0,
        transferableCopies: payload.transferable ?? 0,
        transferablePct: payload.percentage ?? 0,
        unobtainable: Boolean(payload.unobtainable),
        description: desc,
        eventSlug: ev?.slug ?? null,
        eventName: ev?.name ?? null,
        eventType: ev?.eventType ?? null,
        eventDescription: ev?.description?.trim() || null,
        twitterUrl: ev?.twitterUrl ?? null,
        eraSlug: era?.slug ?? null,
        eraName: era?.name ?? null,
        eraImageUrl: era?.imageUrl ?? era?.spotifyAlbumArt ?? null,
        medianPriceUsd: payload.priceStats?.medianPriceUsd ?? null,
        minPriceUsd: payload.priceStats?.minPriceUsd ?? null,
        maxPriceUsd: payload.priceStats?.maxPriceUsd ?? null,
        listingCount: payload.priceStats?.listingCount ?? null,
        priceUpdatedAt: payload.priceStats?.updatedAt ?? null,
        fetchedAt: now,
      };

      found[slug] = colStats;
      newlyFetchedCols.push(colStats);

      if ((desc || ev) && !seenDropKeys.has(dropKey)) {
        seenDropKeys.add(dropKey);
        const onOffline: "online" | "offline" =
          t.onOffline ?? (t.collectionNo.toUpperCase().endsWith("A") ? "offline" : "online");
        const classified = classifyApolloProvenance({
          artistId: t.artistId,
          season: t.season,
          collectionNo: t.collectionNo,
          objektClass: t.objektClass ?? null,
          onOffline,
          description: desc,
          eventSlug: ev?.slug ?? null,
          eventName: ev?.name ?? null,
          eventType: ev?.eventType ?? null,
          eventDescription: ev?.description?.trim() || null,
        });
        newlyFetchedDrops.push({
          dropKey,
          sampleApolloSlug: slug,
          artistId: t.artistId.toLowerCase(),
          season: t.season,
          collectionNo: t.collectionNo.toUpperCase(),
          description: desc,
          eventSlug: ev?.slug ?? null,
          eventName: ev?.name ?? null,
          eventType: ev?.eventType ?? null,
          eventDescription: ev?.description?.trim() || null,
          twitterUrl: ev?.twitterUrl ?? null,
          eraSlug: era?.slug ?? null,
          eraName: era?.name ?? null,
          eraImageUrl: era?.imageUrl ?? era?.spotifyAlbumArt ?? null,
          provenanceClass: classified.provenanceClass,
          passBillingMonth: classified.passBillingMonth,
          passBillingLabel: classified.passBillingLabel,
          isFreeDistribution: classified.isFreeDistribution,
          fetchedAt: now,
        });
      }
    }
  }

  // Persist to D1 cache in one batch
  const newDropsRecord: Record<string, ApolloDropProvenance> = {};
  if (newlyFetchedCols.length > 0 || newlyFetchedDrops.length > 0) {
    try {
      const batch: D1PreparedStatement[] = [];
      const colStmt = rawD1.prepare(
        `INSERT OR REPLACE INTO apollo_collection_cache
          (apollo_slug, drop_key, total_copies, transferable_copies, transferable_pct, unobtainable, description, event_slug, event_name, event_type, event_description, twitter_url, era_slug, era_name, era_image_url, median_price_usd, min_price_usd, max_price_usd, listing_count, price_updated_at, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of newlyFetchedCols) {
        batch.push(
          colStmt.bind(
            c.apolloSlug,
            c.dropKey,
            c.totalCopies,
            c.transferableCopies,
            c.transferablePct,
            c.unobtainable ? 1 : 0,
            c.description,
            c.eventSlug,
            c.eventName,
            c.eventType,
            c.eventDescription,
            c.twitterUrl,
            c.eraSlug,
            c.eraName,
            c.eraImageUrl,
            c.medianPriceUsd,
            c.minPriceUsd,
            c.maxPriceUsd,
            c.listingCount,
            c.priceUpdatedAt,
            c.fetchedAt ?? now,
          ),
        );
      }

      const dropStmt = rawD1.prepare(
        `INSERT OR REPLACE INTO apollo_drop_metadata
          (drop_key, sample_apollo_slug, artist_id, season, collection_no, description, event_slug, event_name, event_type, event_description, twitter_url, era_slug, era_name, era_image_url, provenance_class, pass_billing_month, pass_billing_label, is_free_distribution, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const d of newlyFetchedDrops) {
        newDropsRecord[d.dropKey] = d;
        batch.push(
          dropStmt.bind(
            d.dropKey,
            d.sampleApolloSlug,
            d.artistId,
            d.season,
            d.collectionNo,
            d.description,
            d.eventSlug,
            d.eventName,
            d.eventType,
            d.eventDescription,
            d.twitterUrl,
            d.eraSlug,
            d.eraName,
            d.eraImageUrl,
            d.provenanceClass,
            d.passBillingMonth,
            d.passBillingLabel,
            d.isFreeDistribution ? 1 : 0,
            d.fetchedAt ?? now,
          ),
        );
      }

      if (batch.length > 0) {
        await rawD1.batch(batch);
      }
    } catch {
      // Non-fatal if cache tables are migrating
    }
  }

  return {
    collections: found,
    newDrops: newDropsRecord,
    remainingSlugs,
  };
}

export interface RoundApolloSupplySummary {
  matchedCollections: number;
  totalCollections: number;
  totalCopies: number;
  transferableCopies: number;
  transferablePct: number | null;
  medianMarketPriceUsd: number | null;
  totalListings: number;
  byCollectionSlug: Record<string, ApolloCollectionStats>;
}

/**
 * Enriches a Sale Round's member collections with cached Apollo supply (`total`,
 * `transferable`, `percentage`) and secondary market `priceStats`.
 * Caps live Apollo calls at 12 per page load so Worker subrequest limits are never approached.
 */
export async function getRoundApolloSupply(
  db: AppDatabase,
  rawD1: D1Database,
  linkedCols: Array<{
    slug: string;
    artistId: string;
    season: string;
    rawMemberName: string;
    objektClass: string;
    collectionNo: string;
    onOffline: string;
    totalMints?: number;
  }>,
  maxLiveFetch = 12,
): Promise<RoundApolloSupplySummary> {
  const targets: Array<{ colSlug: string; target: ApolloEnrichTarget }> =
    linkedCols.slice(0, 24).map((c) => {
      const apolloSlug = toApolloSlug(c.season, c.rawMemberName, c.collectionNo);
      return {
        colSlug: c.slug,
        target: {
          apolloSlug,
          dropKey: makeApolloDropKey(c.artistId, c.season, c.collectionNo),
          artistId: c.artistId,
          season: c.season,
          collectionNo: c.collectionNo,
          objektClass: c.objektClass,
          onOffline: c.onOffline === "offline" ? "offline" : "online",
          minExpectedCopies: c.totalMints,
        },
      };
    });

  const enriched = await enrichApolloCollectionsWithCache(
    db,
    rawD1,
    targets.map((x) => x.target),
    maxLiveFetch,
  );

  const byCollectionSlug: Record<string, ApolloCollectionStats> = {};
  let matchedCollections = 0;
  let totalCopies = 0;
  let transferableCopies = 0;
  const medians: number[] = [];
  let totalListings = 0;

  for (const item of targets) {
    const stats = enriched.collections[item.target.apolloSlug];
    if (!stats || stats.totalCopies <= 0) continue;
    byCollectionSlug[item.colSlug] = stats;
    matchedCollections++;
    totalCopies += stats.totalCopies;
    transferableCopies += stats.transferableCopies;
    if (stats.medianPriceUsd !== null && stats.medianPriceUsd > 0) {
      medians.push(stats.medianPriceUsd);
    }
    if (stats.listingCount !== null && stats.listingCount > 0) {
      totalListings += stats.listingCount;
    }
  }

  medians.sort((a, b) => a - b);
  const medianMarketPriceUsd =
    medians.length > 0
      ? Math.round(medians[Math.floor(medians.length / 2)]! * 100) / 100
      : null;

  return {
    matchedCollections,
    totalCollections: targets.length,
    totalCopies,
    transferableCopies,
    transferablePct:
      totalCopies > 0
        ? Math.round((transferableCopies / totalCopies) * 10000) / 100
        : null,
    medianMarketPriceUsd,
    totalListings,
    byCollectionSlug,
  };
}
