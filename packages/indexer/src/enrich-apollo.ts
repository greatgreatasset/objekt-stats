import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  APOLLO_BASE_URL,
  applyApolloToRoundMeta,
  buildEnrichedRoundTitle,
  classifyApolloProvenance,
  computeArtistSeriesStats,
  makeApolloDropKey,
  toApolloSlug,
  type ApolloCollectionStats,
  type ApolloDropProvenance,
  type ApolloMetadataApiResponse,
  type SaleRoundInput,
} from "@objekt-stats/stats";

interface LocalDropCandidate {
  dropKey: string;
  artistId: string;
  season: string;
  collectionNo: string;
  objektClass: string;
  onOffline: "online" | "offline";
  candidateMembers: string[];
}

interface CachedApolloDropEntry {
  drop: ApolloDropProvenance;
  sampleCollection: ApolloCollectionStats;
}

interface SnapshotRoundStat {
  roundSlug: string;
  memberId: string;
  mintCount: number;
  uniqueBuyers: number;
  topBuyerSharePct: number | null;
}

interface SnapshotRound {
  slug: string;
  artistId: string;
  title: string;
  season: string;
  objektClass: string;
  saleMechanic: string;
  startAt: string;
  endAt: string;
  totalMints: number;
  uniqueBuyers: number;
  participatingMembers: number;
  includeInPopularity: boolean;
  stats: SnapshotRoundStat[];
}

interface SnapshotSummary {
  rounds: SnapshotRound[];
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
  batchSize = 30,
): void {
  for (let i = 0; i < tuples.length; i += batchSize) {
    lines.push(`${prefix} VALUES ${tuples.slice(i, i + batchSize).join(", ")};`);
  }
}

async function fetchApolloMetadata(
  apolloSlug: string,
): Promise<ApolloMetadataApiResponse | null> {
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
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as ApolloMetadataApiResponse;
    } catch {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 750 * attempt));
      }
    }
  }
  return null;
}

function loadDropsFromIndexer(sqlitePath: string): LocalDropCandidate[] {
  const db = new DatabaseSync(sqlitePath, { open: true, readOnly: true });
  const rows = db
    .prepare(
      `SELECT artist_id, season, collection_no, objekt_class, on_offline, raw_member
       FROM collection_catalog
       WHERE artist_id IN ('triples', 'artms', 'idntt')
       ORDER BY artist_id, season, collection_no, raw_member`,
    )
    .all() as Array<{
    artist_id: string;
    season: string;
    collection_no: string;
    objekt_class: string;
    on_offline: string;
    raw_member: string;
  }>;
  db.close();

  const byDrop = new Map<string, LocalDropCandidate>();
  for (const r of rows) {
    const dropKey = makeApolloDropKey(r.artist_id, r.season, r.collection_no);
    let cand = byDrop.get(dropKey);
    if (!cand) {
      cand = {
        dropKey,
        artistId: r.artist_id,
        season: r.season,
        collectionNo: r.collection_no.toUpperCase(),
        objektClass: r.objekt_class,
        onOffline: r.on_offline === "offline" ? "offline" : "online",
        candidateMembers: [],
      };
      byDrop.set(dropKey, cand);
    }
    if (
      r.raw_member &&
      cand.candidateMembers.length < 3 &&
      !cand.candidateMembers.includes(r.raw_member)
    ) {
      cand.candidateMembers.push(r.raw_member);
    }
  }

  return Array.from(byDrop.values());
}

/**
 * Maps a `sale_rounds.slug` back to a representative `dropKey` in `apollo_drop_metadata`.
 * Handles both single-collection rounds (`triples-cream02-dco-373z`) and multi-collection
 * seasonal FCO edition rounds (`triples-divine01-fco-ed1-digital` -> `101Z`).
 */
function findDropKeyForRound(
  round: SnapshotRound,
  cache: Record<string, CachedApolloDropEntry>,
): string | null {
  const artist = round.artistId.toLowerCase();
  const season = round.season.toLowerCase();

  // Direct collection number in slug: e.g. `triples-cream02-dco-373z` or `artms-atom02-dco-371z`
  const directMatch = /-(\d{3}[az])$/i.exec(round.slug);
  if (directMatch) {
    const key = `${artist}|${season}|${directMatch[1]!.toUpperCase()}`;
    if (cache[key]) return key;
  }

  // Seasonal FCO edition rounds: try canonical first number of edition
  if (round.slug.includes("-fco-ed1-")) {
    const suffix = round.slug.endsWith("-physical") ? "A" : "Z";
    for (let n = 101; n <= 108; n++) {
      const key = `${artist}|${season}|${n}${suffix}`;
      if (cache[key]) return key;
    }
  } else if (round.slug.includes("-fco-ed2-")) {
    const suffix = round.slug.endsWith("-physical") ? "A" : "Z";
    for (let n = 109; n <= 116; n++) {
      const key = `${artist}|${season}|${n}${suffix}`;
      if (cache[key]) return key;
    }
  } else if (round.slug.includes("-fco-ed3-")) {
    const suffix = round.slug.endsWith("-physical") ? "A" : "Z";
    for (let n = 117; n <= 120; n++) {
      const key = `${artist}|${season}|${n}${suffix}`;
      if (cache[key]) return key;
    }
  }

  return null;
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
  const cachePath = resolve(rootDir, "data/apollo-drops-cache.json");
  const snapshotPath = resolve(rootDir, "packages/db/generated/snapshot-summary.json");
  const outSqlPath = resolve(rootDir, "packages/db/generated/sync-apollo.sql");

  const drops = loadDropsFromIndexer(sqlitePath);
  console.log(`Loaded ${drops.length} distinct drops from ${sqlitePath}`);

  let cache: Record<string, CachedApolloDropEntry> = {};
  if (existsSync(cachePath)) {
    cache = JSON.parse(readFileSync(cachePath, "utf8")) as Record<
      string,
      CachedApolloDropEntry
    >;
    console.log(`Loaded ${Object.keys(cache).length} existing cached drops from ${cachePath}`);
  }

  if (!emitOnly) {
    const todo = forceRefresh
      ? drops
      : drops.filter((d) => !cache[d.dropKey]);
    console.log(
      `Fetching ${todo.length} uncached drops politely from ${APOLLO_BASE_URL} (4 concurrent, 140ms wave spacing)...`,
    );

    let done = 0;
    let foundMeta = 0;
    const concurrency = 4;
    for (let i = 0; i < todo.length; i += concurrency) {
      const wave = todo.slice(i, i + concurrency);
      const results = await Promise.all(
        wave.map(async (cand) => {
          let chosenSlug = "";
          let payload: ApolloMetadataApiResponse | null = null;
          for (const member of cand.candidateMembers) {
            const slug = toApolloSlug(cand.season, member, cand.collectionNo);
            const res = await fetchApolloMetadata(slug);
            chosenSlug = slug;
            if (res && (res.total > 0 || res.data)) {
              payload = res;
              break;
            }
          }
          return { cand, chosenSlug, payload };
        }),
      );

      const now = new Date().toISOString();
      for (const { cand, chosenSlug, payload } of results) {
        done++;
        if (!payload || !chosenSlug) continue;
        const ev = payload.data?.event ?? null;
        const desc = payload.data?.description?.trim() || null;
        const era = ev?.era ?? null;
        const classified = classifyApolloProvenance({
          artistId: cand.artistId,
          season: cand.season,
          collectionNo: cand.collectionNo,
          objektClass: cand.objektClass,
          onOffline: cand.onOffline,
          description: desc,
          eventSlug: ev?.slug ?? null,
          eventName: ev?.name ?? null,
          eventType: ev?.eventType ?? null,
          eventDescription: ev?.description?.trim() || null,
        });
        if (desc || ev) foundMeta++;

        cache[cand.dropKey] = {
          drop: {
            dropKey: cand.dropKey,
            sampleApolloSlug: chosenSlug,
            artistId: cand.artistId,
            season: cand.season,
            collectionNo: cand.collectionNo,
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
          sampleCollection: {
            apolloSlug: chosenSlug,
            dropKey: cand.dropKey,
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
          },
        };
      }

      if (done % 100 === 0 || done === todo.length) {
        writeFileSync(cachePath, JSON.stringify(cache, null, 2));
        console.log(`  Progress: ${done}/${todo.length} (${foundMeta} with event/description)`);
      }

      if (i + concurrency < todo.length) {
        await new Promise((r) => setTimeout(r, 140));
      }
    }
  }

  // Re-run latest classifier rules over cached entries so classifier refinements apply cleanly with --emit-only
  const dropByKey = new Map(drops.map((d) => [d.dropKey, d]));
  const classCounts: Record<string, number> = {};
  for (const [key, entry] of Object.entries(cache)) {
    const local = dropByKey.get(key);
    const classified = classifyApolloProvenance({
      artistId: entry.drop.artistId,
      season: entry.drop.season,
      collectionNo: entry.drop.collectionNo,
      objektClass: local?.objektClass ?? null,
      onOffline: local?.onOffline ?? (entry.drop.collectionNo.endsWith("A") ? "offline" : "online"),
      description: entry.drop.description,
      eventSlug: entry.drop.eventSlug,
      eventName: entry.drop.eventName,
      eventType: entry.drop.eventType,
      eventDescription: entry.drop.eventDescription,
    });
    entry.drop.provenanceClass = classified.provenanceClass;
    entry.drop.isFreeDistribution = classified.isFreeDistribution;
    entry.drop.passBillingMonth = classified.passBillingMonth;
    entry.drop.passBillingLabel = classified.passBillingLabel;
    classCounts[classified.provenanceClass] = (classCounts[classified.provenanceClass] ?? 0) + 1;
  }
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  console.log("\n=== APOLLO PROVENANCE DISTRIBUTION ===");
  console.log(classCounts);

  // Print detected Pass+ drops
  const passDrops = Object.values(cache)
    .filter((e) => e.drop.provenanceClass === "pass_plus")
    .map((e) => `${e.drop.dropKey} -> ${e.drop.passBillingLabel} (${e.drop.eventName})`);
  console.log(`\nDetected Pass+ drops (${passDrops.length}):`);
  for (const p of passDrops) console.log("  " + p);

  // Apply to snapshot-summary.json rounds and recompute popularity stats cleanly
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as SnapshotSummary;
  const now = new Date().toISOString();
  const sqlLines: string[] = [
    `-- Apollo (https://apollo.cafe) provenance enrichment & cleaned popularity stats (${now})`,
    "",
  ];

  // 1. Upsert apollo_drop_metadata
  const dropTuples: string[] = [];
  const colTuples: string[] = [];
  for (const entry of Object.values(cache)) {
    const d = entry.drop;
    dropTuples.push(
      `(${sqlStr(d.dropKey)}, ${sqlStr(d.sampleApolloSlug)}, ${sqlStr(d.artistId)}, ${sqlStr(d.season)}, ${sqlStr(d.collectionNo)}, ${sqlStr(d.description)}, ${sqlStr(d.eventSlug)}, ${sqlStr(d.eventName)}, ${sqlStr(d.eventType)}, ${sqlStr(d.eventDescription)}, ${sqlStr(d.twitterUrl)}, ${sqlStr(d.eraSlug)}, ${sqlStr(d.eraName)}, ${sqlStr(d.eraImageUrl)}, ${sqlStr(d.provenanceClass)}, ${sqlStr(d.passBillingMonth)}, ${sqlStr(d.passBillingLabel)}, ${sqlBool(d.isFreeDistribution)}, ${sqlStr(d.fetchedAt ?? now)})`,
    );

    const c = entry.sampleCollection;
    if (c.totalCopies > 0 || c.description || c.eventSlug) {
      colTuples.push(
        `(${sqlStr(c.apolloSlug)}, ${sqlStr(c.dropKey)}, ${c.totalCopies}, ${c.transferableCopies}, ${c.transferablePct}, ${sqlBool(c.unobtainable)}, ${sqlStr(c.description)}, ${sqlStr(c.eventSlug)}, ${sqlStr(c.eventName)}, ${sqlStr(c.eventType)}, ${sqlStr(c.eventDescription)}, ${sqlStr(c.twitterUrl)}, ${sqlStr(c.eraSlug)}, ${sqlStr(c.eraName)}, ${sqlStr(c.eraImageUrl)}, ${sqlNum(c.medianPriceUsd)}, ${sqlNum(c.minPriceUsd)}, ${sqlNum(c.maxPriceUsd)}, ${sqlNum(c.listingCount)}, ${sqlStr(c.priceUpdatedAt)}, ${sqlStr(c.fetchedAt ?? now)})`,
      );
    }
  }

  pushBatchedInserts(
    sqlLines,
    "INSERT OR REPLACE INTO apollo_drop_metadata (drop_key, sample_apollo_slug, artist_id, season, collection_no, description, event_slug, event_name, event_type, event_description, twitter_url, era_slug, era_name, era_image_url, provenance_class, pass_billing_month, pass_billing_label, is_free_distribution, fetched_at)",
    dropTuples,
    25,
  );
  sqlLines.push("");
  pushBatchedInserts(
    sqlLines,
    "INSERT OR REPLACE INTO apollo_collection_cache (apollo_slug, drop_key, total_copies, transferable_copies, transferable_pct, unobtainable, description, event_slug, event_name, event_type, event_description, twitter_url, era_slug, era_name, era_image_url, median_price_usd, min_price_usd, max_price_usd, listing_count, price_updated_at, fetched_at)",
    colTuples,
    25,
  );
  sqlLines.push("");

  // 2. Enrich sale_rounds & track reclassifications
  const reclassified: string[] = [];
  let enrichedRounds = 0;
  const updatedRounds: SnapshotRound[] = [];

  for (const r of snapshot.rounds) {
    const dropKey = findDropKeyForRound(r, cache);
    const prov = dropKey ? cache[dropKey]!.drop : null;
    if (!prov) {
      updatedRounds.push(r);
      continue;
    }

    const onOffline: "online" | "offline" =
      r.saleMechanic === "physical_scan" || r.slug.endsWith("-physical") || /a$/i.test(r.slug)
        ? "offline"
        : "online";
    const colNoMatch = /-(\d{3}[az])$/i.exec(r.slug);
    const colNo = colNoMatch ? colNoMatch[1]!.toUpperCase() : prov.collectionNo;

    const newTitle = buildEnrichedRoundTitle({
      fallbackTitle: r.title,
      season: r.season,
      objektClass: r.objektClass,
      collectionNo: colNo,
      apolloEventName: prov.eventName,
      apolloDescription: prov.description,
      provenanceClass: prov.provenanceClass,
    });

    const isNativeFreeClass =
      r.objektClass === "Welcome" ||
      r.objektClass === "Special" ||
      r.objektClass === "Zero" ||
      r.objektClass === "Premier";
    const baseUnitPriceUsd =
      onOffline === "offline"
        ? null
        : isNativeFreeClass
          ? 0
          : r.objektClass === "Motion"
            ? 4.99
            : 3.29;

    const adjusted = applyApolloToRoundMeta({
      objektClass: r.objektClass,
      onOffline,
      baseSaleMechanic: r.saleMechanic,
      baseIncludeInPopularity: r.includeInPopularity,
      baseUnitPriceUsd,
      provenance: prov,
    });

    if (
      adjusted.includeInPopularity !== r.includeInPopularity ||
      adjusted.saleMechanic !== r.saleMechanic
    ) {
      reclassified.push(
        `  ${r.slug}: ${r.saleMechanic}(pop=${r.includeInPopularity}) -> ${adjusted.saleMechanic}(pop=${adjusted.includeInPopularity}) | "${newTitle}" | ${prov.eventType} | ${prov.description ?? ""}`,
      );
    }

    enrichedRounds++;
    sqlLines.push(
      `UPDATE sale_rounds SET title = ${sqlStr(newTitle)}, sale_mechanic = ${sqlStr(adjusted.saleMechanic)}, include_in_popularity = ${sqlBool(adjusted.includeInPopularity)}, unit_price_usd = ${sqlNum(adjusted.unitPriceUsd)}, notes = COALESCE(notes, ${sqlStr(prov.description)}), apollo_event_slug = ${sqlStr(prov.eventSlug)}, apollo_event_name = ${sqlStr(prov.eventName)}, apollo_event_type = ${sqlStr(prov.eventType)}, apollo_era_name = ${sqlStr(prov.eraName)}, apollo_twitter_url = ${sqlStr(prov.twitterUrl)}, apollo_description = ${sqlStr(prov.description)} WHERE slug = ${sqlStr(r.slug)};`,
    );

    updatedRounds.push({
      ...r,
      title: newTitle,
      saleMechanic: adjusted.saleMechanic,
      includeInPopularity: adjusted.includeInPopularity,
    });
  }

  console.log(`\nEnriched ${enrichedRounds}/${snapshot.rounds.length} sale rounds.`);
  console.log(`Reclassified ${reclassified.length} rounds out of/into popularity trends:`);
  for (const line of reclassified.slice(0, 60)) console.log(line);
  if (reclassified.length > 60) {
    console.log(`  ... and ${reclassified.length - 60} more`);
  }

  // 3. Recompute sale_round_member_stats rolling ranks/deltas/anomalies cleanly with updated includeInPopularity flags.
  // Use targeted UPDATE statements so we never violate FKs or overwrite newer live-cron mint_count / unique_buyers!
  let statUpdateCount = 0;
  sqlLines.push("");
  for (const artistId of ["triples", "artms"] as const) {
    const seriesInput: SaleRoundInput[] = updatedRounds
      .filter((r) => r.artistId === artistId)
      .map((r) => ({
        slug: r.slug,
        artistId: r.artistId,
        startAt: r.startAt,
        includeInPopularity: r.includeInPopularity,
        memberMints: r.stats.map((s) => ({
          memberId: s.memberId,
          mintCount: s.mintCount,
          uniqueBuyers: s.uniqueBuyers,
          topBuyerMints:
            s.topBuyerSharePct !== null
              ? Math.round((s.topBuyerSharePct / 100) * s.mintCount)
              : undefined,
        })),
      }));

    const computed = computeArtistSeriesStats(seriesInput);
    for (const rows of computed.values()) {
      for (const s of rows) {
        statUpdateCount++;
        sqlLines.push(
          `UPDATE sale_round_member_stats SET rank_delta_prev = ${sqlNum(s.rankDeltaPrev)}, rolling5_rank = ${sqlNum(s.rolling5Rank)}, rolling10_rank = ${sqlNum(s.rolling10Rank)}, rolling5_relative_index = ${sqlNum(s.rolling5RelativeIndex)}, rolling10_relative_index = ${sqlNum(s.rolling10RelativeIndex)}, is_anomaly = ${sqlBool(s.isAnomaly)}, anomaly_direction = ${sqlStr(s.anomalyDirection)}, anomaly_reason = ${sqlStr(s.anomalyReason)} WHERE round_slug = ${sqlStr(s.roundSlug)} AND member_id = ${sqlStr(s.memberId)};`,
        );
      }
    }
  }

  mkdirSync(resolve(rootDir, "packages/db/generated"), { recursive: true });
  writeFileSync(outSqlPath, sqlLines.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${outSqlPath} (${statUpdateCount} safe round-member stat UPDATE statements)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
