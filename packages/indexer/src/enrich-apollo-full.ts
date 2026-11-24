import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  APOLLO_BASE_URL,
  classifyApolloProvenance,
  makeApolloDropKey,
  toApolloSlug,
  type ApolloCollectionStats,
  type ApolloDropProvenance,
  type ApolloMetadataApiResponse,
} from "@objekt-stats/stats";

interface CollectionTarget {
  apolloSlug: string;
  dropKey: string;
  artistId: string;
  season: string;
  memberName: string;
  collectionNo: string;
  objektClass: string;
  onOffline: "online" | "offline";
  fromExpansion: boolean;
}

type CachedEntry =
  | { kind: "ok"; col: ApolloCollectionStats; checkedAt: string }
  | { kind: "empty"; checkedAt: string };

interface LegacyDropCacheEntry {
  drop: ApolloDropProvenance;
  sampleCollection: ApolloCollectionStats;
}

const TRIPLES_ROSTER_ORDER = [
  "SeoYeon",
  "HyeRin",
  "JiWoo",
  "ChaeYeon",
  "YooYeon",
  "SooMin",
  "NaKyoung",
  "YuBin",
  "Kaede",
  "DaHyun",
  "Kotone",
  "YeonJi",
  "Nien",
  "SoHyun",
  "Xinyu",
  "Mayu",
  "Lynn",
  "JooBin",
  "HaYeon",
  "ShiOn",
  "ChaeWon",
  "Sullin",
  "SeoAh",
  "JiYeon",
] as const;

const ARTMS_ROSTER = ["HeeJin", "HaSeul", "KimLip", "JinSoul", "Choerry"] as const;

const TRIPLES_POLYGON_ROSTER_CUTOFF: Record<string, number> = {
  Atom01: 12,
  Binary01: 16,
  Cream01: 20,
  Divine01: 24,
  Ever01: 24,
};

const ARTMS_POLYGON_SEASONS = new Set([
  "Atom01",
  "Binary01",
  "Cream01",
  "Divine01",
  "Ever01",
]);

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
  batchSize = 25,
): void {
  for (let i = 0; i < tuples.length; i += batchSize) {
    lines.push(`${prefix} VALUES ${tuples.slice(i, i + batchSize).join(", ")};`);
  }
}

async function fetchApolloMetadata(
  apolloSlug: string,
): Promise<{ status: "ok"; data: ApolloMetadataApiResponse } | { status: "not_found" } | { status: "error" }> {
  const url = `${APOLLO_BASE_URL}/api/objekts/metadata/${encodeURIComponent(apolloSlug)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "objekt-stats/1.0 (+https://objektstats.com)",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) return { status: "not_found" };
      if (res.status === 429 || res.status >= 500) {
        const waitMs = res.status === 429 ? 2500 * attempt : 1200 * attempt;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) return { status: "error" };
      const data = (await res.json()) as ApolloMetadataApiResponse;
      return { status: "ok", data };
    } catch (err) {
      const code = (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        throw err;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 900 * attempt));
      }
    }
  }
  return { status: "error" };
}

function loadAllCollectionTargets(sqlitePath: string): {
  targets: CollectionTarget[];
  knownCount: number;
  expandedCount: number;
} {
  const db = new DatabaseSync(sqlitePath, { open: true, readOnly: true });
  const rows = db
    .prepare(
      `SELECT artist_id, season, raw_member, collection_no, objekt_class, on_offline
       FROM collection_catalog
       WHERE artist_id IN ('triples', 'artms', 'idntt')
       ORDER BY artist_id, season, collection_no, raw_member`,
    )
    .all() as Array<{
    artist_id: string;
    season: string;
    raw_member: string;
    collection_no: string;
    objekt_class: string;
    on_offline: string;
  }>;
  db.close();

  const bySlug = new Map<string, CollectionTarget>();
  const dropMeta = new Map<
    string,
    {
      artistId: string;
      season: string;
      collectionNo: string;
      objektClass: string;
      onOffline: "online" | "offline";
      members: Set<string>;
    }
  >();

  for (const r of rows) {
    if (!r.season || !r.raw_member || !r.collection_no) continue;
    const apolloSlug = toApolloSlug(r.season, r.raw_member, r.collection_no);
    const dropKey = makeApolloDropKey(r.artist_id, r.season, r.collection_no);
    const onOffline: "online" | "offline" =
      r.on_offline === "offline" || r.collection_no.toUpperCase().endsWith("A")
        ? "offline"
        : "online";

    if (!bySlug.has(apolloSlug)) {
      bySlug.set(apolloSlug, {
        apolloSlug,
        dropKey,
        artistId: r.artist_id,
        season: r.season,
        memberName: r.raw_member,
        collectionNo: r.collection_no.toUpperCase(),
        objektClass: r.objekt_class,
        onOffline,
        fromExpansion: false,
      });
    }

    let dm = dropMeta.get(dropKey);
    if (!dm) {
      dm = {
        artistId: r.artist_id,
        season: r.season,
        collectionNo: r.collection_no.toUpperCase(),
        objektClass: r.objekt_class,
        onOffline,
        members: new Set(),
      };
      dropMeta.set(dropKey, dm);
    }
    dm.members.add(r.raw_member);
  }

  const knownCount = bySlug.size;

  // Expand pre-migration Polygon-era drops across their debuted roster so any Polygon-only
  // member cards missing from Abstract are also captured!
  for (const [dropKey, dm] of dropMeta.entries()) {
    if (dm.objektClass.toLowerCase() === "unit") continue;

    let roster: readonly string[] | null = null;
    if (dm.artistId === "triples") {
      const cutoff = TRIPLES_POLYGON_ROSTER_CUTOFF[dm.season];
      if (cutoff) roster = TRIPLES_ROSTER_ORDER.slice(0, cutoff);
    } else if (dm.artistId === "artms" && ARTMS_POLYGON_SEASONS.has(dm.season)) {
      roster = ARTMS_ROSTER;
    }

    if (!roster) continue;
    for (const memberName of roster) {
      const apolloSlug = toApolloSlug(dm.season, memberName, dm.collectionNo);
      if (bySlug.has(apolloSlug)) continue;
      bySlug.set(apolloSlug, {
        apolloSlug,
        dropKey,
        artistId: dm.artistId,
        season: dm.season,
        memberName,
        collectionNo: dm.collectionNo,
        objektClass: dm.objektClass,
        onOffline: dm.onOffline,
        fromExpansion: true,
      });
    }
  }

  // Prioritize known catalog cards first, then Polygon missing-member expansions
  const targets = Array.from(bySlug.values()).sort(
    (a, b) => Number(a.fromExpansion) - Number(b.fromExpansion) || a.apolloSlug.localeCompare(b.apolloSlug),
  );

  return {
    targets,
    knownCount,
    expandedCount: targets.length - knownCount,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const emitOnly = args.has("--emit-only");
  const forceRefresh = args.has("--force");

  const repoRoot = resolve(process.cwd(), "../..");
  const sqlitePath = existsSync(resolve(process.cwd(), "data/raw/indexer.sqlite"))
    ? resolve(process.cwd(), "data/raw/indexer.sqlite")
    : resolve(repoRoot, "data/raw/indexer.sqlite");
  const rootDir = sqlitePath.replace(/[\\/]data[\\/]raw[\\/]indexer\.sqlite$/, "");
  const dropsCachePath = resolve(rootDir, "data/apollo-drops-cache.json");
  const fullCachePath = resolve(rootDir, "data/apollo-collections-cache.json");
  const generatedDir = resolve(rootDir, "packages/db/generated");

  const { targets, knownCount, expandedCount } = loadAllCollectionTargets(sqlitePath);
  console.log(
    `Built ${targets.length.toLocaleString()} total Apollo collection targets (${knownCount.toLocaleString()} from indexer.sqlite + ${expandedCount.toLocaleString()} Polygon-era roster expansions).`,
  );

  let fullCache: Record<string, CachedEntry> = {};
  if (existsSync(fullCachePath)) {
    fullCache = JSON.parse(readFileSync(fullCachePath, "utf8")) as Record<
      string,
      CachedEntry
    >;
    console.log(
      `Loaded ${Object.keys(fullCache).length.toLocaleString()} entries from ${fullCachePath}`,
    );
  }

  // Seed from existing drop backfill cache so we never re-fetch those 1,305 representative slugs
  let dropsCache: Record<string, LegacyDropCacheEntry> = {};
  if (existsSync(dropsCachePath)) {
    dropsCache = JSON.parse(readFileSync(dropsCachePath, "utf8")) as Record<
      string,
      LegacyDropCacheEntry
    >;
    let seeded = 0;
    for (const entry of Object.values(dropsCache)) {
      const c = entry.sampleCollection;
      if (c && c.apolloSlug && !fullCache[c.apolloSlug]) {
        fullCache[c.apolloSlug] = {
          kind: "ok",
          col: c,
          checkedAt: c.fetchedAt ?? new Date().toISOString(),
        };
        seeded++;
      }
    }
    if (seeded > 0) {
      console.log(`Seeded ${seeded.toLocaleString()} already-fetched slugs from apollo-drops-cache.json`);
    }
  }

  const targetBySlug = new Map(targets.map((t) => [t.apolloSlug, t]));

  if (!emitOnly) {
    const todo = forceRefresh
      ? targets
      : targets.filter((t) => !fullCache[t.apolloSlug]);

    console.log(
      `Fetching ${todo.length.toLocaleString()} uncached collections from ${APOLLO_BASE_URL} (4 concurrent, 140ms wave spacing)...`,
    );

    const startMs = Date.now();
    let done = 0;
    let foundCount = 0;
    let emptyCount = 0;
    let errorCount = 0;
    let withPrices = 0;
    const concurrency = 4;

    for (let i = 0; i < todo.length; i += concurrency) {
      const wave = todo.slice(i, i + concurrency);
      const results = await Promise.all(
        wave.map(async (t) => ({
          target: t,
          res: await fetchApolloMetadata(t.apolloSlug),
        })),
      );

      const now = new Date().toISOString();
      for (const { target, res } of results) {
        done++;
        if (res.status === "error") {
          errorCount++;
          continue; // Leave uncached so a resume will retry cleanly
        }
        if (
          res.status === "not_found" ||
          (res.data.total === 0 && !res.data.data)
        ) {
          emptyCount++;
          fullCache[target.apolloSlug] = { kind: "empty", checkedAt: now };
          continue;
        }

        const payload = res.data;
        const ev = payload.data?.event ?? null;
        const desc = payload.data?.description?.trim() || null;
        const era = ev?.era ?? null;

        const col: ApolloCollectionStats = {
          apolloSlug: target.apolloSlug,
          dropKey: target.dropKey,
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

        foundCount++;
        if (col.medianPriceUsd !== null && col.medianPriceUsd > 0) withPrices++;
        fullCache[target.apolloSlug] = { kind: "ok", col, checkedAt: now };

        // Also enrich dropsCache for any newly discovered dropKey
        if ((desc || ev) && !dropsCache[target.dropKey]) {
          const classified = classifyApolloProvenance({
            artistId: target.artistId,
            season: target.season,
            collectionNo: target.collectionNo,
            objektClass: target.objektClass,
            onOffline: target.onOffline,
            description: desc,
            eventSlug: ev?.slug ?? null,
            eventName: ev?.name ?? null,
            eventType: ev?.eventType ?? null,
            eventDescription: ev?.description?.trim() || null,
          });
          dropsCache[target.dropKey] = {
            drop: {
              dropKey: target.dropKey,
              sampleApolloSlug: target.apolloSlug,
              artistId: target.artistId,
              season: target.season,
              collectionNo: target.collectionNo,
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
            },
            sampleCollection: col,
          };
        }
      }

      if (done % 250 === 0 || done === todo.length) {
        writeFileSync(fullCachePath, JSON.stringify(fullCache));
        writeFileSync(dropsCachePath, JSON.stringify(dropsCache, null, 2));
        const elapsedSec = Math.max(1, (Date.now() - startMs) / 1000);
        const rate = done / elapsedSec;
        const etaSec = Math.round((todo.length - done) / Math.max(0.1, rate));
        console.log(
          `  [${done.toLocaleString()}/${todo.length.toLocaleString()}] found=${foundCount.toLocaleString()} empty=${emptyCount.toLocaleString()} priced=${withPrices.toLocaleString()} err=${errorCount} | ${rate.toFixed(1)} req/s | ETA ${Math.floor(etaSec / 60)}m ${etaSec % 60}s`,
        );
      }

      if (i + concurrency < todo.length) {
        await new Promise((r) => setTimeout(r, 140));
      }
    }
  }

  // Emit clean, chunked SQL files (<= 1.6 MB each so D1 remote upload is fast & rock-solid)
  mkdirSync(generatedDir, { recursive: true });
  for (const fname of readdirSync(generatedDir)) {
    if (/^sync-apollo-full-\d+\.sql$/.test(fname)) {
      unlinkSync(resolve(generatedDir, fname));
    }
  }

  const now = new Date().toISOString();
  const validCols: ApolloCollectionStats[] = [];
  let totalCopiesSum = 0;
  let transferableSum = 0;
  let pricedColsCount = 0;
  let expandedHits = 0;

  for (const entry of Object.values(fullCache)) {
    if (entry.kind !== "ok") continue;
    const c = entry.col;
    if (c.totalCopies <= 0 && !c.description && !c.eventSlug) continue;
    validCols.push(c);
    totalCopiesSum += c.totalCopies;
    transferableSum += c.transferableCopies;
    if (c.medianPriceUsd !== null && c.medianPriceUsd > 0) pricedColsCount++;
    if (targetBySlug.get(c.apolloSlug)?.fromExpansion) expandedHits++;
  }

  // Build drop_metadata tuples (all drops including newly discovered ones)
  const dropTuples: string[] = [];
  for (const entry of Object.values(dropsCache)) {
    const d = entry.drop;
    dropTuples.push(
      `(${sqlStr(d.dropKey)}, ${sqlStr(d.sampleApolloSlug)}, ${sqlStr(d.artistId)}, ${sqlStr(d.season)}, ${sqlStr(d.collectionNo)}, ${sqlStr(d.description)}, ${sqlStr(d.eventSlug)}, ${sqlStr(d.eventName)}, ${sqlStr(d.eventType)}, ${sqlStr(d.eventDescription)}, ${sqlStr(d.twitterUrl)}, ${sqlStr(d.eraSlug)}, ${sqlStr(d.eraName)}, ${sqlStr(d.eraImageUrl)}, ${sqlStr(d.provenanceClass)}, ${sqlStr(d.passBillingMonth)}, ${sqlStr(d.passBillingLabel)}, ${sqlBool(d.isFreeDistribution)}, ${sqlStr(d.fetchedAt ?? now)})`,
    );
  }

  const colTuples: string[] = validCols.map(
    (c) =>
      `(${sqlStr(c.apolloSlug)}, ${sqlStr(c.dropKey)}, ${c.totalCopies}, ${c.transferableCopies}, ${c.transferablePct}, ${sqlBool(c.unobtainable)}, ${sqlStr(c.description)}, ${sqlStr(c.eventSlug)}, ${sqlStr(c.eventName)}, ${sqlStr(c.eventType)}, ${sqlStr(c.eventDescription)}, ${sqlStr(c.twitterUrl)}, ${sqlStr(c.eraSlug)}, ${sqlStr(c.eraName)}, ${sqlStr(c.eraImageUrl)}, ${sqlNum(c.medianPriceUsd)}, ${sqlNum(c.minPriceUsd)}, ${sqlNum(c.maxPriceUsd)}, ${sqlNum(c.listingCount)}, ${sqlStr(c.priceUpdatedAt)}, ${sqlStr(c.fetchedAt ?? now)})`,
  );

  // Split statements across ~1.6 MB SQL chunk files
  const allStatements: string[] = [];
  pushBatchedInserts(
    allStatements,
    "INSERT OR REPLACE INTO apollo_drop_metadata (drop_key, sample_apollo_slug, artist_id, season, collection_no, description, event_slug, event_name, event_type, event_description, twitter_url, era_slug, era_name, era_image_url, provenance_class, pass_billing_month, pass_billing_label, is_free_distribution, fetched_at)",
    dropTuples,
    25,
  );
  pushBatchedInserts(
    allStatements,
    "INSERT OR REPLACE INTO apollo_collection_cache (apollo_slug, drop_key, total_copies, transferable_copies, transferable_pct, unobtainable, description, event_slug, event_name, event_type, event_description, twitter_url, era_slug, era_name, era_image_url, median_price_usd, min_price_usd, max_price_usd, listing_count, price_updated_at, fetched_at)",
    colTuples,
    25,
  );

  const MAX_CHUNK_BYTES = 1_600_000;
  let chunkIdx = 1;
  let currentLines: string[] = [
    `-- Apollo full collection cache chunk ${chunkIdx} (${now})`,
  ];
  let currentBytes = 0;
  const writtenFiles: string[] = [];

  const flushChunk = () => {
    const fileName = `sync-apollo-full-${String(chunkIdx).padStart(2, "0")}.sql`;
    const filePath = resolve(generatedDir, fileName);
    writeFileSync(filePath, currentLines.join("\n") + "\n", "utf8");
    writtenFiles.push(fileName);
    chunkIdx++;
    currentLines = [`-- Apollo full collection cache chunk ${chunkIdx} (${now})`];
    currentBytes = 0;
  };

  for (const stmt of allStatements) {
    const stmtBytes = Buffer.byteLength(stmt, "utf8") + 1;
    if (currentBytes > 0 && currentBytes + stmtBytes > MAX_CHUNK_BYTES) {
      flushChunk();
    }
    currentLines.push(stmt);
    currentBytes += stmtBytes;
  }
  if (currentLines.length > 1) {
    flushChunk();
  }

  console.log("\n=== FULL APOLLO BACKFILL SUMMARY ===");
  console.log(`Total valid collections cached: ${validCols.length.toLocaleString()} (incl. ${expandedHits.toLocaleString()} Polygon-only expansions!)`);
  console.log(`Total drops cached: ${Object.keys(dropsCache).length.toLocaleString()}`);
  console.log(`Collections with live priceStats: ${pricedColsCount.toLocaleString()}`);
  console.log(
    `Combined supply tracked: ${totalCopiesSum.toLocaleString()} copies (${transferableSum.toLocaleString()} tradeable, ${totalCopiesSum > 0 ? ((transferableSum / totalCopiesSum) * 100).toFixed(1) : "0"}%)`,
  );
  console.log(`Wrote ${writtenFiles.length} SQL chunk files: ${writtenFiles.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
