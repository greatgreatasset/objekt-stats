import { and, eq, inArray, lt } from "drizzle-orm";
import {
  apolloDropMetadata,
  collections,
  processedLiveSpins,
  seasonalLeaderboardCutoffs,
  seasonalWalletLeaderboard,
  tokenMetadataCache,
  type AppDatabase,
} from "@objekt-stats/db";
import {
  classifySpinOutputClass,
  makeApolloDropKey,
  shortenAddress,
  toApolloSlug,
  type ApolloDropProvenance,
  type ProvenanceClass,
} from "@objekt-stats/stats";
import { enrichApolloCollectionsWithCache } from "./apollo-service";

export const COSMO_SPIN_ADDRESS = "0xd3d5f29881ad87bb10c1100e2c709c9596de345f";
const SPIN_REWARD_MATCH_WINDOW_MS = 90_000;
const SPIN_BLANK_EXPIRE_MS = 180_000;
const DEFAULT_UNIT_PRICE_USD = 3.29;

export interface LiveParsedMeta {
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

export interface LiveSpinLog {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  spunAt: string;
  wallet: string;
  tokenId: number;
}

export interface LiveResolvedMint {
  tokenId: number;
  txHash: string;
  blockNumber: number;
  minter: string;
  timestampIso: string;
  meta: LiveParsedMeta;
}

export interface LiveMemberRecord {
  id: string;
  artistId: string;
  code: string;
  name: string;
  cosmoName: string;
  fullName: string;
}

function normalizeMemberKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Resolves a collection's `rawMember` into 1 or 2 tracked member IDs,
 * supporting both solo names and paired Unit cards (`S13 X S22`, `A1 X A2`).
 */
export function resolveLiveCollectionMemberIds(
  artistId: string,
  rawMember: string,
  memberLookup: ReadonlyMap<string, string>,
  codeLookup: ReadonlyMap<string, string>,
): string[] {
  const direct = memberLookup.get(`${artistId}:${normalizeMemberKey(rawMember)}`);
  if (direct) return [direct];

  const pairMatch = /^([SA]\d+)\s*[xX×]\s*([SA]\d+)$/.exec(rawMember.trim());
  if (pairMatch) {
    const m1 = codeLookup.get(`${artistId}:${pairMatch[1]!.toUpperCase()}`);
    const m2 = codeLookup.get(`${artistId}:${pairMatch[2]!.toUpperCase()}`);
    const out: string[] = [];
    if (m1) out.push(m1);
    if (m2 && m2 !== m1) out.push(m2);
    return out;
  }
  return [];
}

function getSeasonSortKey(season: string, fallbackFirstMint: string): string {
  const m = /^(Atom|Binary|Cream|Divine|Ever)(\d+)$/i.exec(season.trim());
  if (!m) return `99-9-${fallbackFirstMint}`;
  const phaseOrder: Record<string, number> = {
    atom: 1,
    binary: 2,
    cream: 3,
    divine: 4,
    ever: 5,
  };
  const cycle = Number(m[2]);
  const phase = phaseOrder[m[1]!.toLowerCase()] ?? 9;
  return `${String(cycle).padStart(2, "0")}-${phase}-${fallbackFirstMint}`;
}

function assignCompetitionRanks<T extends { memberId: string }>(
  items: readonly T[],
  valueOf: (item: T) => number,
): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    const diff = valueOf(b) - valueOf(a);
    return diff !== 0 ? diff : a.memberId.localeCompare(b.memberId);
  });
  const ranks = new Map<string, number>();
  let currentRank = 1;
  sorted.forEach((item, idx) => {
    if (idx > 0 && valueOf(item) < valueOf(sorted[idx - 1]!)) {
      currentRank = idx + 1;
    }
    ranks.set(item.memberId, currentRank);
  });
  return ranks;
}

/**
 * Automatically fetches & caches Apollo drop provenance in D1 for any newly
 * observed (artist, season, collectionNo) drops so new seasons like Divine02
 * classify free rewards & Pass+ drops within 60 seconds without manual syncs.
 */
export async function enrichMissingApolloDropsLive(
  db: AppDatabase,
  rawD1: D1Database,
  colDeltas: Iterable<{ meta: LiveParsedMeta }>,
  maxFetch = 5,
): Promise<Map<string, ApolloDropProvenance>> {
  const apolloDropMap = new Map<string, ApolloDropProvenance>();
  try {
    const dropRows = await db.select().from(apolloDropMetadata);
    for (const d of dropRows) {
      apolloDropMap.set(d.dropKey, {
        dropKey: d.dropKey,
        sampleApolloSlug: d.sampleApolloSlug,
        artistId: d.artistId,
        season: d.season,
        collectionNo: d.collectionNo,
        description: d.description ?? null,
        eventSlug: d.eventSlug ?? null,
        eventName: d.eventName ?? null,
        eventType: d.eventType ?? null,
        eventDescription: d.eventDescription ?? null,
        twitterUrl: d.twitterUrl ?? null,
        eraSlug: d.eraSlug ?? null,
        eraName: d.eraName ?? null,
        eraImageUrl: d.eraImageUrl ?? null,
        provenanceClass: (d.provenanceClass as ProvenanceClass) || "unknown",
        passBillingMonth: d.passBillingMonth ?? null,
        passBillingLabel: d.passBillingLabel ?? null,
        isFreeDistribution: Boolean(d.isFreeDistribution),
        fetchedAt: d.fetchedAt,
      });
    }
  } catch {
    return apolloDropMap;
  }

  const missingTargets: Array<{
    apolloSlug: string;
    dropKey: string;
    artistId: string;
    season: string;
    collectionNo: string;
    objektClass: string;
    onOffline: "online" | "offline";
  }> = [];
  const seenKeys = new Set<string>();

  for (const { meta } of colDeltas) {
    if (meta.artistId !== "triples" && meta.artistId !== "artms") continue;
    if (
      meta.objektClass === "Welcome" ||
      meta.objektClass === "Special" ||
      meta.objektClass === "Zero"
    ) {
      continue;
    }
    const dropKey = makeApolloDropKey(
      meta.artistId,
      meta.season,
      meta.collectionNo,
    );
    if (apolloDropMap.has(dropKey) || seenKeys.has(dropKey)) continue;
    seenKeys.add(dropKey);
    const apolloSlug = toApolloSlug(
      meta.season,
      meta.rawMember,
      meta.collectionNo,
    );
    if (!apolloSlug) continue;
    missingTargets.push({
      apolloSlug,
      dropKey,
      artistId: meta.artistId,
      season: meta.season,
      collectionNo: meta.collectionNo,
      objektClass: meta.objektClass,
      onOffline: meta.onOffline,
    });
  }

  if (missingTargets.length > 0 && maxFetch > 0) {
    const res = await enrichApolloCollectionsWithCache(
      db,
      rawD1,
      missingTargets,
      maxFetch,
    ).catch(() => ({ collections: {}, newDrops: {}, remainingSlugs: [] }));
    for (const [k, v] of Object.entries(res.newDrops)) {
      apolloDropMap.set(k, v);
    }
  }

  return apolloDropMap;
}

/**
 * Records newly observed live COSMO Spin transfers (`Transfer(wallet -> SPIN)`),
 * increments `collections.spun_count` & `collection_daily_mints.spin_count`,
 * pairs Spin -> Reward Mints within 90 seconds (updating `spin_outcome_stats`,
 * `spin_member_outcome_stats`, and `recent_notable_spins`), settles expired
 * spins (>180s) as Blanks, and returns the exact set of `tokenId`s that were
 * verified Spin reward mints so they are excluded from seasonal Objekt cutoffs.
 */
export async function processLiveSpinsAndPairMints(
  db: AppDatabase,
  rawD1: D1Database,
  options: {
    spinLogs: readonly LiveSpinLog[];
    resolvedMints: readonly LiveResolvedMint[];
    txWalletMintCounts: ReadonlyMap<string, number>;
    referenceIso: string;
    maxMetaBudget: number;
    memberLookup: ReadonlyMap<string, string>;
    fetchMeta: (tokenId: number) => Promise<LiveParsedMeta | null>;
  },
): Promise<{
  spinsProcessed: number;
  spinsPaired: number;
  pairedSpinRewardTokenIds: Set<number>;
}> {
  const {
    spinLogs,
    resolvedMints,
    txWalletMintCounts,
    referenceIso,
    maxMetaBudget,
    memberLookup,
    fetchMeta,
  } = options;
  const now = new Date().toISOString();
  const pairedSpinRewardTokenIds = new Set<number>();
  let spinsProcessed = 0;
  let spinsPaired = 0;

  try {
    // 1. Deduplicate incoming spin logs against processed_live_spins
    const newSpins: LiveSpinLog[] = [];
    if (spinLogs.length > 0) {
      const seenSpinKeys = new Set<string>();
      const uniqueTxHashes = Array.from(
        new Set(spinLogs.map((s) => s.txHash)),
      );
      for (let i = 0; i < uniqueTxHashes.length; i += 80) {
        const slice = uniqueTxHashes.slice(i, i + 80);
        const rows = await db
          .select({
            txHash: processedLiveSpins.txHash,
            logIndex: processedLiveSpins.logIndex,
          })
          .from(processedLiveSpins)
          .where(inArray(processedLiveSpins.txHash, slice));
        for (const r of rows) {
          seenSpinKeys.add(`${r.txHash}:${r.logIndex}`);
        }
      }
      for (const s of spinLogs) {
        const key = `${s.txHash}:${s.logIndex}`;
        if (!seenSpinKeys.has(key)) {
          seenSpinKeys.add(key);
          newSpins.push(s);
        }
      }
    }

    // 2. Resolve metadata for new spin input tokens (D1 cache first -> COSMO v3 up to budget)
    if (newSpins.length > 0) {
      const tokenIds = Array.from(new Set(newSpins.map((s) => s.tokenId)));
      const metaByToken = new Map<number, LiveParsedMeta | null>();

      for (let i = 0; i < tokenIds.length; i += 80) {
        const slice = tokenIds.slice(i, i + 80);
        const cached = await db
          .select()
          .from(tokenMetadataCache)
          .where(inArray(tokenMetadataCache.tokenId, slice))
          .catch(() => []);
        for (const c of cached) {
          if (c.isMissing) {
            metaByToken.set(c.tokenId, null);
          } else {
            metaByToken.set(c.tokenId, {
              slug: c.slug,
              collectionId: c.collectionId,
              artistId: c.artistId,
              rawMember: c.memberName,
              season: c.season,
              objektClass: c.objektClass,
              collectionNo: c.collectionNo,
              onOffline: c.onOffline === "offline" ? "offline" : "online",
              imageUrl: c.imageUrl ?? "",
              backgroundColor: c.backgroundColor ?? "#09090b",
            });
          }
        }
      }

      const toFetch = tokenIds
        .filter((id) => !metaByToken.has(id))
        .slice(0, Math.max(0, maxMetaBudget));

      for (let i = 0; i < toFetch.length; i += 10) {
        const wave = toFetch.slice(i, i + 10);
        const fetched = await Promise.all(
          wave.map(async (id) => ({
            id,
            meta: await fetchMeta(id).catch(() => null),
          })),
        );
        for (const f of fetched) {
          if (f.meta) metaByToken.set(f.id, f.meta);
        }
      }

      // Fetch current supply for resolved spin collections so notable rare sacrifices get accurate supply
      const spinSlugs = Array.from(
        new Set(
          Array.from(metaByToken.values())
            .filter((m): m is LiveParsedMeta => Boolean(m))
            .map((m) => m.slug),
        ),
      );
      const supplyBySlug = new Map<string, number>();
      for (let i = 0; i < spinSlugs.length; i += 80) {
        const slice = spinSlugs.slice(i, i + 80);
        const cols = await db
          .select({
            slug: collections.slug,
            totalMints: collections.totalMints,
          })
          .from(collections)
          .where(inArray(collections.slug, slice));
        for (const c of cols) supplyBySlug.set(c.slug, c.totalMints);
      }

      const colSpinInc = new Map<string, number>();
      const dailySpinInc = new Map<
        string,
        { slug: string; date: string; count: number }
      >();
      const stmts: D1PreparedStatement[] = [];
      const insertSpin = rawD1.prepare(
        `INSERT OR IGNORE INTO processed_live_spins
          (tx_hash, log_index, wallet, token_id, spun_at, input_artist_id, input_member_id, input_collection_id, input_member_name, input_class, input_season, input_collection_no, input_image_url, input_supply, status, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      );

      for (const s of newSpins) {
        const meta = metaByToken.get(s.tokenId);
        // Only record resolved or budget-skipped spins cleanly; skip unresolved tokens past budget so next tick isn't poisoned
        if (meta === undefined) continue;
        spinsProcessed++;

        const isTracked =
          meta !== null &&
          (meta.artistId === "triples" || meta.artistId === "artms");
        const memberId = isTracked
          ? (memberLookup.get(
              `${meta.artistId}:${normalizeMemberKey(meta.rawMember)}`,
            ) ?? null)
          : null;
        const supply = meta ? (supplyBySlug.get(meta.slug) ?? null) : null;

        stmts.push(
          insertSpin.bind(
            s.txHash,
            s.logIndex,
            s.wallet,
            s.tokenId,
            s.spunAt,
            isTracked ? meta.artistId : null,
            memberId,
            meta?.collectionId ?? null,
            meta?.rawMember ?? null,
            meta?.objektClass ?? null,
            meta?.season ?? null,
            meta?.collectionNo ?? null,
            meta?.imageUrl || null,
            supply,
            now,
          ),
        );

        if (isTracked && meta) {
          colSpinInc.set(meta.slug, (colSpinInc.get(meta.slug) ?? 0) + 1);
          const day = s.spunAt.slice(0, 10);
          const dKey = `${meta.slug}|${day}`;
          const prev = dailySpinInc.get(dKey);
          if (prev) prev.count++;
          else dailySpinInc.set(dKey, { slug: meta.slug, date: day, count: 1 });
        }
      }

      const incColSpin = rawD1.prepare(
        "UPDATE collections SET spun_count = spun_count + ?, updated_at = ? WHERE slug = ?",
      );
      for (const [slug, cnt] of colSpinInc.entries()) {
        stmts.push(incColSpin.bind(cnt, now, slug));
      }

      const incDailySpin = rawD1.prepare(
        `INSERT INTO collection_daily_mints (collection_slug, mint_date, mint_count, unique_minters, spin_count)
         VALUES (?, ?, 0, 0, ?)
         ON CONFLICT(collection_slug, mint_date) DO UPDATE SET
           spin_count = collection_daily_mints.spin_count + excluded.spin_count`,
      );
      for (const d of dailySpinInc.values()) {
        stmts.push(incDailySpin.bind(d.slug, d.date, d.count));
      }

      for (let i = 0; i < stmts.length; i += 80) {
        await rawD1.batch(stmts.slice(i, i + 80));
      }
    }

    // 3. Pair incoming 1-token-per-wallet mints with open spins within 90s
    const candidateMints = resolvedMints
      .filter((m) => {
        if (m.meta.artistId !== "triples" && m.meta.artistId !== "artms") {
          return false;
        }
        const cls = m.meta.objektClass;
        if (cls !== "First" && cls !== "Special" && cls !== "Premier") {
          return false;
        }
        const countInTx =
          txWalletMintCounts.get(`${m.txHash}|${m.minter}`) ?? 1;
        return countInTx === 1;
      })
      .sort((a, b) => a.timestampIso.localeCompare(b.timestampIso));

    const outcomeStmts: D1PreparedStatement[] = [];
    const artistOutcomeDeltas = new Map<
      string,
      {
        total: number;
        blank: number;
        fco: number;
        sco: number;
        premier: number;
        other: number;
        endAt: string;
      }
    >();
    const memberOutcomeDeltas = new Map<
      string,
      {
        artistId: string;
        sent: number;
        pulled: number;
        blankFrom: number;
        rarePulled: number;
      }
    >();

    const addArtistOutcome = (
      artistId: string,
      kind: "blank" | "fco" | "sco" | "premier" | "other",
      ts: string,
    ) => {
      let acc = artistOutcomeDeltas.get(artistId);
      if (!acc) {
        acc = {
          total: 0,
          blank: 0,
          fco: 0,
          sco: 0,
          premier: 0,
          other: 0,
          endAt: ts,
        };
        artistOutcomeDeltas.set(artistId, acc);
      }
      acc.total++;
      acc[kind]++;
      if (ts > acc.endAt) acc.endAt = ts;
    };

    const addMemberOutcome = (
      memberId: string,
      artistId: string,
      patch: Partial<{
        sent: number;
        pulled: number;
        blankFrom: number;
        rarePulled: number;
      }>,
    ) => {
      let acc = memberOutcomeDeltas.get(memberId);
      if (!acc) {
        acc = { artistId, sent: 0, pulled: 0, blankFrom: 0, rarePulled: 0 };
        memberOutcomeDeltas.set(memberId, acc);
      }
      acc.sent += patch.sent ?? 0;
      acc.pulled += patch.pulled ?? 0;
      acc.blankFrom += patch.blankFrom ?? 0;
      acc.rarePulled += patch.rarePulled ?? 0;
    };

    if (candidateMints.length > 0) {
      const candidateWallets = Array.from(
        new Set(candidateMints.map((m) => m.minter)),
      );
      const openByWallet = new Map<
        string,
        Array<typeof processedLiveSpins.$inferSelect>
      >();

      for (let i = 0; i < candidateWallets.length; i += 80) {
        const slice = candidateWallets.slice(i, i + 80);
        const rows = await db
          .select()
          .from(processedLiveSpins)
          .where(
            and(
              eq(processedLiveSpins.status, "open"),
              inArray(processedLiveSpins.wallet, slice),
            ),
          );
        for (const r of rows) {
          const arr = openByWallet.get(r.wallet) ?? [];
          arr.push(r);
          openByWallet.set(r.wallet, arr);
        }
      }

      for (const arr of openByWallet.values()) {
        arr.sort((a, b) => a.spunAt.localeCompare(b.spunAt));
      }

      const usedSpinKeys = new Set<string>();
      const markPaired = rawD1.prepare(
        "UPDATE processed_live_spins SET status = 'paired' WHERE tx_hash = ? AND log_index = ?",
      );
      const insertNotable = rawD1.prepare(
        `INSERT OR REPLACE INTO recent_notable_spins
          (spin_key, artist_id, chain, spun_at, wallet_short, input_token_id, input_collection_id, input_member_name, input_class, input_season, input_collection_no, input_image_url, input_supply, outcome_kind, output_token_id, output_collection_id, output_member_name, output_class, output_season, output_collection_no, output_image_url, delay_seconds)
         VALUES (?, ?, 'abstract', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const m of candidateMints) {
        const spins = openByWallet.get(m.minter);
        if (!spins || spins.length === 0) continue;
        const mintMs = Date.parse(m.timestampIso);
        if (Number.isNaN(mintMs)) continue;

        let matched: (typeof processedLiveSpins.$inferSelect) | null = null;
        for (const s of spins) {
          const sKey = `${s.txHash}:${s.logIndex}`;
          if (usedSpinKeys.has(sKey)) continue;
          const spinMs = Date.parse(s.spunAt);
          if (Number.isNaN(spinMs)) continue;
          const delta = mintMs - spinMs;
          if (delta >= 0 && delta <= SPIN_REWARD_MATCH_WINDOW_MS) {
            matched = s;
            usedSpinKeys.add(sKey);
            break;
          }
        }

        if (!matched) continue;
        spinsPaired++;
        pairedSpinRewardTokenIds.add(m.tokenId);
        outcomeStmts.push(markPaired.bind(matched.txHash, matched.logIndex));

        const outcomeKind = classifySpinOutputClass(
          m.meta.objektClass,
          m.meta.collectionNo,
        );
        const artistId = matched.inputArtistId ?? m.meta.artistId;
        if (artistId === "triples" || artistId === "artms") {
          addArtistOutcome(artistId, outcomeKind, m.timestampIso);
        }
        if (matched.inputMemberId && matched.inputArtistId) {
          addMemberOutcome(matched.inputMemberId, matched.inputArtistId, {
            sent: 1,
          });
        }
        const outMemberId =
          memberLookup.get(
            `${m.meta.artistId}:${normalizeMemberKey(m.meta.rawMember)}`,
          ) ?? null;
        if (outMemberId) {
          addMemberOutcome(outMemberId, m.meta.artistId, {
            pulled: 1,
            rarePulled:
              outcomeKind === "premier" || outcomeKind === "sco" ? 1 : 0,
          });
        }

        const isNotable =
          outcomeKind === "premier" ||
          outcomeKind === "sco" ||
          (matched.inputSupply !== null &&
            matched.inputSupply > 0 &&
            matched.inputSupply < 500) ||
          matched.inputClass === "Premier" ||
          matched.inputClass === "Motion";

        if (isNotable && (artistId === "triples" || artistId === "artms")) {
          const delaySec = Math.max(
            0,
            Math.round((mintMs - Date.parse(matched.spunAt)) / 1000),
          );
          outcomeStmts.push(
            insertNotable.bind(
              `${matched.txHash}:${matched.logIndex}`,
              artistId,
              matched.spunAt,
              shortenAddress(matched.wallet),
              matched.tokenId,
              matched.inputCollectionId ?? `Objekt #${matched.tokenId}`,
              matched.inputMemberName ?? "Unknown",
              matched.inputClass ?? "First",
              matched.inputSeason ?? m.meta.season,
              matched.inputCollectionNo ?? "",
              matched.inputImageUrl,
              matched.inputSupply,
              outcomeKind,
              m.tokenId,
              m.meta.collectionId,
              m.meta.rawMember,
              m.meta.objektClass,
              m.meta.season,
              m.meta.collectionNo,
              m.meta.imageUrl || null,
              delaySec,
            ),
          );
        }
      }
    }

    // 4. Settle expired open spins (> 180s old) as confirmed Blanks
    const refMs = Date.parse(referenceIso);
    if (!Number.isNaN(refMs)) {
      const blankCutoffIso = new Date(refMs - SPIN_BLANK_EXPIRE_MS).toISOString();
      const expired = await db
        .select()
        .from(processedLiveSpins)
        .where(
          and(
            eq(processedLiveSpins.status, "open"),
            lt(processedLiveSpins.spunAt, blankCutoffIso),
          ),
        )
        .limit(200);

      const markBlank = rawD1.prepare(
        "UPDATE processed_live_spins SET status = 'blank' WHERE tx_hash = ? AND log_index = ?",
      );
      for (const s of expired) {
        outcomeStmts.push(markBlank.bind(s.txHash, s.logIndex));
        if (s.inputArtistId === "triples" || s.inputArtistId === "artms") {
          addArtistOutcome(s.inputArtistId, "blank", s.spunAt);
        }
        if (s.inputMemberId && s.inputArtistId) {
          addMemberOutcome(s.inputMemberId, s.inputArtistId, {
            sent: 1,
            blankFrom: 1,
          });
        }
      }

      // Prune settled spin buffer older than 7 days
      const pruneIso = new Date(refMs - 7 * 86_400_000).toISOString();
      outcomeStmts.push(
        rawD1
          .prepare(
            "DELETE FROM processed_live_spins WHERE status != 'open' AND spun_at < ?",
          )
          .bind(pruneIso),
      );
    }

    // 5. Persist aggregated spin outcome deltas
    const upsertArtistOutcome = rawD1.prepare(
      `INSERT INTO spin_outcome_stats
        (artist_id, total_paired_spins, blank_count, fco_count, sco_count, premier_count, other_count, unique_spinners, sample_start_at, sample_end_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(artist_id) DO UPDATE SET
         total_paired_spins = spin_outcome_stats.total_paired_spins + excluded.total_paired_spins,
         blank_count = spin_outcome_stats.blank_count + excluded.blank_count,
         fco_count = spin_outcome_stats.fco_count + excluded.fco_count,
         sco_count = spin_outcome_stats.sco_count + excluded.sco_count,
         premier_count = spin_outcome_stats.premier_count + excluded.premier_count,
         other_count = spin_outcome_stats.other_count + excluded.other_count,
         sample_end_at = MAX(COALESCE(spin_outcome_stats.sample_end_at, excluded.sample_end_at), excluded.sample_end_at),
         updated_at = excluded.updated_at`,
    );
    for (const [artistId, d] of artistOutcomeDeltas.entries()) {
      outcomeStmts.push(
        upsertArtistOutcome.bind(
          artistId,
          d.total,
          d.blank,
          d.fco,
          d.sco,
          d.premier,
          d.other,
          d.endAt,
          d.endAt,
          now,
        ),
      );
    }

    const upsertMemberOutcome = rawD1.prepare(
      `INSERT INTO spin_member_outcome_stats
        (member_id, artist_id, paired_sent_count, paired_pulled_count, paired_blank_from_count, paired_rare_pulled_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET
         paired_sent_count = spin_member_outcome_stats.paired_sent_count + excluded.paired_sent_count,
         paired_pulled_count = spin_member_outcome_stats.paired_pulled_count + excluded.paired_pulled_count,
         paired_blank_from_count = spin_member_outcome_stats.paired_blank_from_count + excluded.paired_blank_from_count,
         paired_rare_pulled_count = spin_member_outcome_stats.paired_rare_pulled_count + excluded.paired_rare_pulled_count,
         updated_at = excluded.updated_at`,
    );
    for (const [memberId, d] of memberOutcomeDeltas.entries()) {
      outcomeStmts.push(
        upsertMemberOutcome.bind(
          memberId,
          d.artistId,
          d.sent,
          d.pulled,
          d.blankFrom,
          d.rarePulled,
          now,
        ),
      );
    }

    for (let i = 0; i < outcomeStmts.length; i += 80) {
      await rawD1.batch(outcomeStmts.slice(i, i + 80));
    }
  } catch {
    // Graceful before migration 0013 is applied
  }

  return { spinsProcessed, spinsPaired, pairedSpinRewardTokenIds };
}

/**
 * Incrementally updates `seasonal_wallet_leaderboard` and recomputes
 * `seasonal_leaderboard_cutoffs` in D1 for any active/seeded season OR any
 * brand-new season (e.g. Divine02) touched by live mints.
 *
 * Historical closed seasons (already in `seasonal_leaderboard_cutoffs` but not
 * tracked in `seasonal_wallet_leaderboard`) are strictly preserved untouched.
 */
export async function updateLiveSeasonalLeaderboards(
  db: AppDatabase,
  rawD1: D1Database,
  options: {
    resolvedMints: readonly LiveResolvedMint[];
    pairedSpinRewardTokenIds: ReadonlySet<number>;
    apolloDropMap: ReadonlyMap<string, ApolloDropProvenance>;
    allMembers: readonly LiveMemberRecord[];
    memberLookup: ReadonlyMap<string, string>;
    codeLookup: ReadonlyMap<string, string>;
  },
): Promise<{ leaderboardSeasonsUpdated: number }> {
  const {
    resolvedMints,
    pairedSpinRewardTokenIds,
    apolloDropMap,
    allMembers,
    memberLookup,
    codeLookup,
  } = options;

  if (resolvedMints.length === 0) return { leaderboardSeasonsUpdated: 0 };

  try {
    // Group incoming eligible mints by (artistId, season)
    const deltasByArtistSeason = new Map<
      string,
      {
        artistId: "triples" | "artms";
        season: string;
        minTs: string;
        maxTs: string;
        walletDeltas: Map<
          string,
          { memberId: string; wallet: string; objDelta: number; grdDelta: number }
        >;
      }
    >();

    for (const item of resolvedMints) {
      const m = item.meta;
      if (m.artistId !== "triples" && m.artistId !== "artms") continue;

      const memberIds = resolveLiveCollectionMemberIds(
        m.artistId,
        m.rawMember,
        memberLookup,
        codeLookup,
      );
      if (memberIds.length === 0) continue;

      const colNoUpper = m.collectionNo.toUpperCase();
      const dropKey = makeApolloDropKey(m.artistId, m.season, colNoUpper);
      const ap = apolloDropMap.get(dropKey);
      const isFree =
        ap?.isFreeDistribution === true || ap?.provenanceClass === "free_reward";
      const isPassPlus = ap?.provenanceClass === "pass_plus";

      const isGridRewardSco =
        m.objektClass === "Special" &&
        m.onOffline === "online" &&
        memberIds.length === 1;

      const isExcludedClass =
        m.objektClass === "Special" ||
        m.objektClass === "Welcome" ||
        m.objektClass === "Zero";
      const isRewardNo = colNoUpper === "402Z" || colNoUpper === "602Z";
      const isPairedSpinReward = pairedSpinRewardTokenIds.has(item.tokenId);
      const isEligibleObjekt =
        !isExcludedClass &&
        !isRewardNo &&
        !isFree &&
        !isPassPlus &&
        !isPairedSpinReward;

      if (!isEligibleObjekt && !isGridRewardSco) continue;

      const asKey = `${m.artistId}|${m.season}`;
      let bucket = deltasByArtistSeason.get(asKey);
      if (!bucket) {
        bucket = {
          artistId: m.artistId,
          season: m.season,
          minTs: item.timestampIso,
          maxTs: item.timestampIso,
          walletDeltas: new Map(),
        };
        deltasByArtistSeason.set(asKey, bucket);
      }
      if (item.timestampIso < bucket.minTs) bucket.minTs = item.timestampIso;
      if (item.timestampIso > bucket.maxTs) bucket.maxTs = item.timestampIso;

      const wallet = item.minter.toLowerCase();
      if (isGridRewardSco) {
        const memId = memberIds[0]!;
        const wk = `${memId}|${wallet}`;
        const prev = bucket.walletDeltas.get(wk);
        if (prev) prev.grdDelta += 1;
        else
          bucket.walletDeltas.set(wk, {
            memberId: memId,
            wallet,
            objDelta: 0,
            grdDelta: 1,
          });
      }
      if (isEligibleObjekt) {
        for (const memId of memberIds) {
          const wk = `${memId}|${wallet}`;
          const prev = bucket.walletDeltas.get(wk);
          if (prev) prev.objDelta += 1;
          else
            bucket.walletDeltas.set(wk, {
              memberId: memId,
              wallet,
              objDelta: 1,
              grdDelta: 0,
            });
        }
      }
    }

    if (deltasByArtistSeason.size === 0) {
      return { leaderboardSeasonsUpdated: 0 };
    }

    const now = new Date().toISOString();
    let leaderboardSeasonsUpdated = 0;

    const upsertWalletStmt = rawD1.prepare(
      `INSERT INTO seasonal_wallet_leaderboard
        (artist_id, season, member_id, wallet, objekt_count, grid_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(artist_id, season, member_id, wallet) DO UPDATE SET
         objekt_count = seasonal_wallet_leaderboard.objekt_count + excluded.objekt_count,
         grid_count = seasonal_wallet_leaderboard.grid_count + excluded.grid_count,
         updated_at = excluded.updated_at`,
    );

    for (const bucket of deltasByArtistSeason.values()) {
      // Check if season is live-tracked (already in seasonal_wallet_leaderboard OR brand-new season!)
      const [walletExists] = await db
        .select({ wallet: seasonalWalletLeaderboard.wallet })
        .from(seasonalWalletLeaderboard)
        .where(
          and(
            eq(seasonalWalletLeaderboard.artistId, bucket.artistId),
            eq(seasonalWalletLeaderboard.season, bucket.season),
          ),
        )
        .limit(1);

      const existingCutoffs = await db
        .select({
          season: seasonalLeaderboardCutoffs.season,
          seasonOrder: seasonalLeaderboardCutoffs.seasonOrder,
          seasonStartAt: seasonalLeaderboardCutoffs.seasonStartAt,
          seasonEndAt: seasonalLeaderboardCutoffs.seasonEndAt,
        })
        .from(seasonalLeaderboardCutoffs)
        .where(eq(seasonalLeaderboardCutoffs.artistId, bucket.artistId));

      const thisSeasonExisting = existingCutoffs.find(
        (c) => c.season === bucket.season,
      );

      // Preserve closed historical seasons that aren't wallet-tracked in D1
      if (!walletExists && thisSeasonExisting) {
        continue;
      }

      // 1. Upsert live per-wallet deltas
      const walletStmts: D1PreparedStatement[] = [];
      for (const wd of bucket.walletDeltas.values()) {
        walletStmts.push(
          upsertWalletStmt.bind(
            bucket.artistId,
            bucket.season,
            wd.memberId,
            wd.wallet,
            wd.objDelta,
            wd.grdDelta,
            now,
          ),
        );
      }
      for (let i = 0; i < walletStmts.length; i += 80) {
        await rawD1.batch(walletStmts.slice(i, i + 80));
      }

      // 2. Determine chronological season_order
      let seasonOrder = thisSeasonExisting?.seasonOrder ?? 0;
      if (seasonOrder <= 0) {
        const distinctSeasons = new Map<
          string,
          { season: string; firstMintAt: string }
        >();
        for (const r of existingCutoffs) {
          if (!distinctSeasons.has(r.season)) {
            distinctSeasons.set(r.season, {
              season: r.season,
              firstMintAt: r.seasonStartAt,
            });
          }
        }
        distinctSeasons.set(bucket.season, {
          season: bucket.season,
          firstMintAt: bucket.minTs,
        });
        const sorted = Array.from(distinctSeasons.values()).sort((a, b) =>
          getSeasonSortKey(a.season, a.firstMintAt).localeCompare(
            getSeasonSortKey(b.season, b.firstMintAt),
          ),
        );
        const foundIdx = sorted.findIndex((s) => s.season === bucket.season);
        seasonOrder = foundIdx >= 0 ? foundIdx + 1 : sorted.length;
      }

      const seasonStartAt =
        thisSeasonExisting && thisSeasonExisting.seasonStartAt < bucket.minTs
          ? thisSeasonExisting.seasonStartAt
          : bucket.minTs;
      const seasonEndAt =
        thisSeasonExisting && thisSeasonExisting.seasonEndAt > bucket.maxTs
          ? thisSeasonExisting.seasonEndAt
          : bucket.maxTs;

      // 3. Recompute exact cutoffs for every member of this artist in 2 fast batched index scans
      const artistMembers = allMembers.filter(
        (m) => m.artistId === bucket.artistId,
      );
      const qTopObj = rawD1.prepare(
        `SELECT objekt_count AS v FROM seasonal_wallet_leaderboard
         WHERE artist_id = ? AND season = ? AND member_id = ? AND objekt_count > 0
         ORDER BY objekt_count DESC LIMIT 50`,
      );
      const qAggObj = rawD1.prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(objekt_count), 0) AS total
         FROM seasonal_wallet_leaderboard
         WHERE artist_id = ? AND season = ? AND member_id = ? AND objekt_count > 0`,
      );
      const qTopGrd = rawD1.prepare(
        `SELECT grid_count AS v FROM seasonal_wallet_leaderboard
         WHERE artist_id = ? AND season = ? AND member_id = ? AND grid_count > 0
         ORDER BY grid_count DESC LIMIT 50`,
      );
      const qAggGrd = rawD1.prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(grid_count), 0) AS total
         FROM seasonal_wallet_leaderboard
         WHERE artist_id = ? AND season = ? AND member_id = ? AND grid_count > 0`,
      );

      const objBatchStmts: D1PreparedStatement[] = [];
      const grdBatchStmts: D1PreparedStatement[] = [];
      for (const m of artistMembers) {
        objBatchStmts.push(qTopObj.bind(bucket.artistId, bucket.season, m.id));
        objBatchStmts.push(qAggObj.bind(bucket.artistId, bucket.season, m.id));
        grdBatchStmts.push(qTopGrd.bind(bucket.artistId, bucket.season, m.id));
        grdBatchStmts.push(qAggGrd.bind(bucket.artistId, bucket.season, m.id));
      }

      const [objRes, grdRes] = await Promise.all([
        rawD1.batch(objBatchStmts),
        rawD1.batch(grdBatchStmts),
      ]);

      const computedRows: Array<{
        memberId: string;
        objektTop1: number;
        objektTop3: number;
        objektTop10: number;
        objektTop25: number;
        objektTop50: number;
        objektTop10Sum: number;
        objektTotalEligible: number;
        objektUniqueCollectors: number;
        objektTop10SharePct: number;
        objektTop10EstUsd: number;
        gridTop1: number;
        gridTop3: number;
        gridTop10: number;
        gridTop25: number;
        gridTop50: number;
        gridTotalCompleted: number;
        gridUniqueGridders: number;
        gridTop10SharePct: number;
      }> = [];

      artistMembers.forEach((m, idx) => {
        const topObjVals = (
          (objRes[idx * 2]?.results ?? []) as Array<{ v: number }>
        ).map((r) => Number(r.v));
        const aggObj = (
          (objRes[idx * 2 + 1]?.results ?? []) as Array<{
            cnt: number;
            total: number;
          }>
        )[0] ?? { cnt: 0, total: 0 };

        const topGrdVals = (
          (grdRes[idx * 2]?.results ?? []) as Array<{ v: number }>
        ).map((r) => Number(r.v));
        const aggGrd = (
          (grdRes[idx * 2 + 1]?.results ?? []) as Array<{
            cnt: number;
            total: number;
          }>
        )[0] ?? { cnt: 0, total: 0 };

        const objTotal = Number(aggObj.total ?? 0);
        const objCnt = Number(aggObj.cnt ?? 0);
        const grdTotal = Number(aggGrd.total ?? 0);
        const grdCnt = Number(aggGrd.cnt ?? 0);

        if (objCnt === 0 && grdCnt === 0) return;

        const objTop10Sum = topObjVals.slice(0, 10).reduce((s, v) => s + v, 0);
        const objTop10 = topObjVals[9] ?? 0;
        const grdTop10Sum = topGrdVals.slice(0, 10).reduce((s, v) => s + v, 0);

        computedRows.push({
          memberId: m.id,
          objektTop1: topObjVals[0] ?? 0,
          objektTop3: topObjVals[2] ?? 0,
          objektTop10: objTop10,
          objektTop25: topObjVals[24] ?? 0,
          objektTop50: topObjVals[49] ?? 0,
          objektTop10Sum: objTop10Sum,
          objektTotalEligible: objTotal,
          objektUniqueCollectors: objCnt,
          objektTop10SharePct:
            objTotal > 0 ? round2((objTop10Sum / objTotal) * 100) : 0,
          objektTop10EstUsd: round2(objTop10 * DEFAULT_UNIT_PRICE_USD),
          gridTop1: topGrdVals[0] ?? 0,
          gridTop3: topGrdVals[2] ?? 0,
          gridTop10: topGrdVals[9] ?? 0,
          gridTop25: topGrdVals[24] ?? 0,
          gridTop50: topGrdVals[49] ?? 0,
          gridTotalCompleted: grdTotal,
          gridUniqueGridders: grdCnt,
          gridTop10SharePct:
            grdTotal > 0 ? round2((grdTop10Sum / grdTotal) * 100) : 0,
        });
      });

      if (computedRows.length === 0) continue;

      const objCutoffRanks = assignCompetitionRanks(
        computedRows,
        (r) => r.objektTop10,
      );
      const objBuyersRanks = assignCompetitionRanks(
        computedRows,
        (r) => r.objektUniqueCollectors,
      );
      const grdCutoffRanks = assignCompetitionRanks(
        computedRows,
        (r) => r.gridTop10,
      );

      const upsertCutoff = rawD1.prepare(
        `INSERT INTO seasonal_leaderboard_cutoffs
          (artist_id, season, season_order, member_id, season_start_at, season_end_at, objekt_top1, objekt_top3, objekt_top10, objekt_top25, objekt_top50, objekt_top10_sum, objekt_total_eligible, objekt_unique_collectors, objekt_top10_share_pct, objekt_top10_est_usd, objekt_cutoff_rank, objekt_buyers_rank, grid_top1, grid_top3, grid_top10, grid_top25, grid_top50, grid_total_completed, grid_unique_gridders, grid_top10_share_pct, grid_cutoff_rank, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(artist_id, season, member_id) DO UPDATE SET
           season_order = excluded.season_order,
           season_start_at = MIN(seasonal_leaderboard_cutoffs.season_start_at, excluded.season_start_at),
           season_end_at = MAX(seasonal_leaderboard_cutoffs.season_end_at, excluded.season_end_at),
           objekt_top1 = excluded.objekt_top1,
           objekt_top3 = excluded.objekt_top3,
           objekt_top10 = excluded.objekt_top10,
           objekt_top25 = excluded.objekt_top25,
           objekt_top50 = excluded.objekt_top50,
           objekt_top10_sum = excluded.objekt_top10_sum,
           objekt_total_eligible = excluded.objekt_total_eligible,
           objekt_unique_collectors = excluded.objekt_unique_collectors,
           objekt_top10_share_pct = excluded.objekt_top10_share_pct,
           objekt_top10_est_usd = excluded.objekt_top10_est_usd,
           objekt_cutoff_rank = excluded.objekt_cutoff_rank,
           objekt_buyers_rank = excluded.objekt_buyers_rank,
           grid_top1 = excluded.grid_top1,
           grid_top3 = excluded.grid_top3,
           grid_top10 = excluded.grid_top10,
           grid_top25 = excluded.grid_top25,
           grid_top50 = excluded.grid_top50,
           grid_total_completed = excluded.grid_total_completed,
           grid_unique_gridders = excluded.grid_unique_gridders,
           grid_top10_share_pct = excluded.grid_top10_share_pct,
           grid_cutoff_rank = excluded.grid_cutoff_rank,
           updated_at = excluded.updated_at`,
      );

      const cutoffStmts = computedRows.map((r) =>
        upsertCutoff.bind(
          bucket.artistId,
          bucket.season,
          seasonOrder,
          r.memberId,
          seasonStartAt,
          seasonEndAt,
          r.objektTop1,
          r.objektTop3,
          r.objektTop10,
          r.objektTop25,
          r.objektTop50,
          r.objektTop10Sum,
          r.objektTotalEligible,
          r.objektUniqueCollectors,
          r.objektTop10SharePct,
          r.objektTop10EstUsd,
          objCutoffRanks.get(r.memberId) ?? 1,
          objBuyersRanks.get(r.memberId) ?? 1,
          r.gridTop1,
          r.gridTop3,
          r.gridTop10,
          r.gridTop25,
          r.gridTop50,
          r.gridTotalCompleted,
          r.gridUniqueGridders,
          r.gridTop10SharePct,
          grdCutoffRanks.get(r.memberId) ?? 1,
          now,
        ),
      );

      for (let i = 0; i < cutoffStmts.length; i += 80) {
        await rawD1.batch(cutoffStmts.slice(i, i + 80));
      }
      leaderboardSeasonsUpdated++;
    }

    return { leaderboardSeasonsUpdated };
  } catch {
    // Graceful before migration 0013 is applied
    return { leaderboardSeasonsUpdated: 0 };
  }
}
