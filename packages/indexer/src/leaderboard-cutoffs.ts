import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadCurationData } from "@objekt-stats/db/curation-loader";
import { normalizeMemberLookupKey } from "./aggregate.js";

export interface ApolloProvenanceEntry {
  artist_id: string;
  season: string;
  collection_no: string;
  provenance_class: string;
  event_type: string | null;
  is_free_distribution: number;
  event_name?: string | null;
}

export interface ComputedLeaderboardCutoffRow {
  artistId: "triples" | "artms";
  season: string;
  seasonOrder: number;
  memberId: string;
  seasonStartAt: string;
  seasonEndAt: string;
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
  objektCutoffRank: number;
  objektBuyersRank: number;
  gridTop1: number;
  gridTop3: number;
  gridTop10: number;
  gridTop25: number;
  gridTop50: number;
  gridTotalCompleted: number;
  gridUniqueGridders: number;
  gridTop10SharePct: number;
  gridCutoffRank: number;
}

export interface AggregateLeaderboardsSummary {
  seasonsCount: number;
  rowsCount: number;
  outFile: string;
  rows: ComputedLeaderboardCutoffRow[];
  walletSeedFiles?: string[];
  walletSeedRows?: number;
}

const COSMO_SPIN_LAUNCH_ISO = "2025-02-26T00:00:00.000Z";
const DEFAULT_UNIT_PRICE_USD = 3.29;
const SPIN_REWARD_MATCH_WINDOW_MS = 90_000;

function sqlStr(val: string | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  return `'${val.replace(/'/g, "''")}'`;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Loads Apollo drop provenance exported from D1 (`wrangler d1 execute --json` or raw array).
 */
export function loadApolloProvenanceMap(
  apolloMetadataPath?: string,
): Map<string, ApolloProvenanceEntry> {
  const map = new Map<string, ApolloProvenanceEntry>();
  if (!apolloMetadataPath || !existsSync(apolloMetadataPath)) return map;

  const raw = readFileSync(apolloMetadataPath, "utf8").replace(/^\uFEFF/, "").trim();
  const startIdx = raw.indexOf("[");
  if (startIdx < 0) return map;
  const parsed = JSON.parse(raw.slice(startIdx)) as
    | Array<{ results?: ApolloProvenanceEntry[] }>
    | ApolloProvenanceEntry[];

  let entries: ApolloProvenanceEntry[] = [];
  if (Array.isArray(parsed) && parsed.length > 0 && "results" in (parsed[0] as object)) {
    entries = (parsed as Array<{ results?: ApolloProvenanceEntry[] }>)[0]?.results ?? [];
  } else if (Array.isArray(parsed)) {
    entries = parsed as ApolloProvenanceEntry[];
  }

  for (const e of entries) {
    if (!e?.artist_id || !e.season || !e.collection_no) continue;
    const key = `${e.artist_id.toLowerCase()}|${e.season.toLowerCase()}|${e.collection_no.toUpperCase()}`;
    map.set(key, e);
  }
  return map;
}

/**
 * Resolves a collection's `raw_member` into 1 or 2 tracked member IDs.
 * Supports both solo member names and paired Unit collections (`S13 X S22`, `A1 X A2`).
 */
export function resolveCollectionMemberIds(
  artistId: string,
  rawMember: string,
  memberLookup: ReadonlyMap<string, string>,
  codeLookup: ReadonlyMap<string, string>,
): string[] {
  const direct = memberLookup.get(`${artistId}:${normalizeMemberLookupKey(rawMember)}`);
  if (direct) return [direct];

  // Match paired unit codes like "S13 X S22" or "S5 x S20"
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

/**
 * Standard COSMO season chronological ordering:
 * Cycle number (`01`, `02`, `03`...) first, then Atom -> Binary -> Cream -> Divine -> Ever.
 */
export function getSeasonSortKey(season: string, fallbackFirstMint: string): string {
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

function hasSpinBefore(sortedSpinTimesMs: readonly number[], mintMs: number): boolean {
  if (sortedSpinTimesMs.length === 0) return false;
  let lo = 0;
  let hi = sortedSpinTimesMs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedSpinTimesMs[mid]! <= mintMs) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 && mintMs - sortedSpinTimesMs[hi]! <= SPIN_REWARD_MATCH_WINDOW_MS;
}

/**
 * Computes exact per-season COSMO Leaderboard Cutoffs (Objekts & Grids) across all seasons
 * for tripleS and ARTMS and emits `packages/db/generated/sync-leaderboards.sql`.
 */
export function aggregateLeaderboardCutoffsAndEmitSql(
  db: DatabaseSync,
  options: {
    dataRoot?: string;
    apolloMetadataPath?: string;
    tradesDbPath?: string;
    outFile?: string;
    onlySeasons?: string[]; // e.g. ["triples:Cream02", "artms:Atom02"]
    walletSeedDir?: string; // emits chunked seasonal_wallet_leaderboard SQL seed files
    skipCutoffsSql?: boolean;
    now?: string;
    onProgress?: (msg: string) => void;
  } = {},
): AggregateLeaderboardsSummary {
  const dataRoot = options.dataRoot ?? resolve(process.cwd(), "data");
  const outFile =
    options.outFile ??
    resolve(process.cwd(), "packages/db/generated/sync-leaderboards.sql");
  const now = options.now ?? new Date().toISOString();

  const curation = loadCurationData(dataRoot);
  const memberLookup = new Map<string, string>();
  const codeLookup = new Map<string, string>();
  const artistMembers = new Map<"triples" | "artms", string[]>();

  for (const artist of curation.artists) {
    const aid = artist.id as "triples" | "artms";
    artistMembers.set(
      aid,
      artist.members.map((m) => m.id),
    );
    for (const m of artist.members) {
      memberLookup.set(`${aid}:${normalizeMemberLookupKey(m.name)}`, m.id);
      memberLookup.set(`${aid}:${normalizeMemberLookupKey(m.cosmoName)}`, m.id);
      memberLookup.set(`${aid}:${normalizeMemberLookupKey(m.fullName)}`, m.id);
      codeLookup.set(`${aid}:${m.code.toUpperCase()}`, m.id);
    }
  }

  const apolloMap = loadApolloProvenanceMap(options.apolloMetadataPath);
  const log = options.onProgress ?? (() => {});

  // Load all collection_catalog rows for tripleS & ARTMS
  const allCatalog = db
    .prepare(
      `SELECT col_id, artist_id, raw_member, season, objekt_class, collection_no, on_offline
       FROM collection_catalog
       WHERE artist_id IN ('triples', 'artms')`,
    )
    .all() as unknown as Array<{
    col_id: number;
    artist_id: "triples" | "artms";
    raw_member: string;
    season: string;
    objekt_class: string;
    collection_no: string;
    on_offline: "online" | "offline";
  }>;

  // Group collections by (artist_id, season)
  interface MappedCol {
    colId: number;
    memberIds: string[];
    objektClass: string;
    collectionNo: string;
    onOffline: "online" | "offline";
    isEligibleObjekt: boolean;
    isGridRewardSco: boolean;
  }

  const onlySeasonFilter =
    options.onlySeasons && options.onlySeasons.length > 0
      ? new Set(
          options.onlySeasons.map((s) =>
            s.trim().toLowerCase().replace(":", "|"),
          ),
        )
      : null;

  const colsByArtistSeason = new Map<string, MappedCol[]>();
  for (const c of allCatalog) {
    if (
      onlySeasonFilter &&
      !onlySeasonFilter.has(`${c.artist_id.toLowerCase()}|${c.season.toLowerCase()}`)
    ) {
      continue;
    }
    const memberIds = resolveCollectionMemberIds(
      c.artist_id,
      c.raw_member,
      memberLookup,
      codeLookup,
    );
    if (memberIds.length === 0) continue;

    const apKey = `${c.artist_id}|${c.season.toLowerCase()}|${c.collection_no.toUpperCase()}`;
    const ap = apolloMap.get(apKey);
    const isFree =
      ap?.is_free_distribution === 1 || ap?.provenance_class === "free_reward";
    const isPassPlus = ap?.provenance_class === "pass_plus";
    const colNoUpper = c.collection_no.toUpperCase();

    const isGridRewardSco =
      c.objekt_class === "Special" && c.on_offline === "online" && memberIds.length === 1;

    // Verified COSMO Season Objekt Leaderboard eligibility:
    // Includes paid shop FCO/DCO/MCO/physical album DCO/PCO/Unit (`601A`),
    // excludes Special (grid rewards), Welcome (`100Z`), Zero, Spin/Leaderboard Premiers (`402Z`),
    // Leaderboard Units (`602Z`), and Apollo-verified free_reward / pass_plus distributions.
    const isExcludedClass =
      c.objekt_class === "Special" ||
      c.objekt_class === "Welcome" ||
      c.objekt_class === "Zero";
    const isRewardNo = colNoUpper === "402Z" || colNoUpper === "602Z";
    const isEligibleObjekt = !isExcludedClass && !isRewardNo && !isFree && !isPassPlus;

    if (!isEligibleObjekt && !isGridRewardSco) continue;

    const key = `${c.artist_id}|${c.season}`;
    let list = colsByArtistSeason.get(key);
    if (!list) {
      list = [];
      colsByArtistSeason.set(key, list);
    }
    list.push({
      colId: c.col_id,
      memberIds,
      objektClass: c.objekt_class,
      collectionNo: colNoUpper,
      onOffline: c.on_offline,
      isEligibleObjekt,
      isGridRewardSco,
    });
  }

  // Track candidate whale wallets across Spin-era seasons so we only query exact wallet spins once!
  interface SingleFirstMint {
    mintedMs: number;
  }
  interface SeasonDraft {
    artistId: "triples" | "artms";
    season: string;
    firstMintAt: string;
    lastMintAt: string;
    memberObjekts: Map<string, Map<string, number>>;
    memberSingleFirsts: Map<string, Map<string, SingleFirstMint[]>>;
    memberGrids: Map<string, Map<string, number>>;
  }

  const drafts: SeasonDraft[] = [];
  const candidateSpinWallets = new Set<string>();

  for (const [key, mappedCols] of colsByArtistSeason.entries()) {
    const [artistId, season] = key.split("|") as ["triples" | "artms", string];
    const colInfoById = new Map<number, MappedCol>(
      mappedCols.map((c) => [c.colId, c]),
    );

    const colIds = mappedCols.map((c) => c.colId);
    const mints: Array<{
      minter: string;
      tx_hash: string;
      minted_at: string;
      col_id: number;
    }> = [];

    // Fetch season mints in chunked IN clauses (fast indexed lookup on token_collections.col_id)
    for (let i = 0; i < colIds.length; i += 400) {
      const slice = colIds.slice(i, i + 400);
      const placeholders = slice.map(() => "?").join(",");
      const chunkRows = db
        .prepare(
          `SELECT rm.minter, rm.tx_hash, rm.minted_at, tc.col_id
           FROM token_collections tc
           JOIN raw_mints rm ON rm.token_id = tc.token_id
           WHERE tc.col_id IN (${placeholders})`,
        )
        .all(...slice) as unknown as Array<{
        minter: string;
        tx_hash: string;
        minted_at: string;
        col_id: number;
      }>;
      for (const r of chunkRows) mints.push(r);
    }

    if (mints.length === 0) continue;

    // Count total mints per tx_hash in this season (identifies 1-token transactions for Spin pairing)
    const txCounts = new Map<string, number>();
    let firstMintAt = mints[0]!.minted_at;
    let lastMintAt = mints[0]!.minted_at;
    for (const r of mints) {
      txCounts.set(r.tx_hash, (txCounts.get(r.tx_hash) ?? 0) + 1);
      if (r.minted_at < firstMintAt) firstMintAt = r.minted_at;
      if (r.minted_at > lastMintAt) lastMintAt = r.minted_at;
    }

    const memberObjekts = new Map<string, Map<string, number>>();
    const memberSingleFirsts = new Map<string, Map<string, SingleFirstMint[]>>();
    const memberGrids = new Map<string, Map<string, number>>();

    for (const r of mints) {
      const c = colInfoById.get(r.col_id);
      if (!c) continue;
      const wallet = r.minter.toLowerCase();

      if (c.isGridRewardSco) {
        const memId = c.memberIds[0]!;
        let gm = memberGrids.get(memId);
        if (!gm) {
          gm = new Map();
          memberGrids.set(memId, gm);
        }
        gm.set(wallet, (gm.get(wallet) ?? 0) + 1);
      }

      if (c.isEligibleObjekt) {
        const isSpinEraSingleFirst =
          c.objektClass === "First" &&
          r.minted_at >= COSMO_SPIN_LAUNCH_ISO &&
          txCounts.get(r.tx_hash) === 1;

        for (const memId of c.memberIds) {
          let om = memberObjekts.get(memId);
          if (!om) {
            om = new Map();
            memberObjekts.set(memId, om);
          }
          om.set(wallet, (om.get(wallet) ?? 0) + 1);

          if (isSpinEraSingleFirst) {
            let sm = memberSingleFirsts.get(memId);
            if (!sm) {
              sm = new Map();
              memberSingleFirsts.set(memId, sm);
            }
            let list = sm.get(wallet);
            if (!list) {
              list = [];
              sm.set(wallet, list);
            }
            list.push({ mintedMs: Date.parse(r.minted_at) });
          }
        }
      }
    }

    // Collect top 80 candidate wallets per member that have at least one Spin-era 1-tx First mint
    for (const [memId, om] of memberObjekts.entries()) {
      const sm = memberSingleFirsts.get(memId);
      if (!sm || sm.size === 0) continue;
      const top80 = Array.from(om.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 80);
      for (const [w] of top80) {
        if (sm.has(w)) candidateSpinWallets.add(w);
      }
    }

    drafts.push({
      artistId,
      season,
      firstMintAt,
      lastMintAt,
      memberObjekts,
      memberSingleFirsts,
      memberGrids,
    });
    log(
      `  [leaderboards] scanned ${artistId} ${season}: ${mints.length.toLocaleString()} mints across ${memberObjekts.size} members`,
    );
  }

  // Pass 2: Build exact wallet -> sorted spin timestamps ONLY for candidate top-80 wallets!
  // A wallet's spins = spins on tokens originally minted by wallet (never transferred out before spin)
  // OR transferred into wallet via tradesDb before the spin block.
  const walletSpinTimesMs = new Map<string, number[]>();
  if (candidateSpinWallets.size > 0) {
    const spinCountRow = db
      .prepare("SELECT COUNT(*) AS c FROM raw_spins WHERE spun_at >= ?")
      .get(COSMO_SPIN_LAUNCH_ISO) as { c: number };

    if (spinCountRow.c > 0) {
      log(
        `  [leaderboards] pairing exact Spin timestamps for ${candidateSpinWallets.size.toLocaleString()} top-80 candidate wallets...`,
      );
      const spinMap = new Map<string, Set<number>>();
      const addSpin = (w: string, iso: string) => {
        const ms = Date.parse(iso);
        if (Number.isNaN(ms)) return;
        let s = spinMap.get(w);
        if (!s) {
          s = new Set();
          spinMap.set(w, s);
        }
        s.add(ms);
      };

      // Attach trades DB if provided so we also capture spins of tokens received via P2P transfer
      let attachedTr = false;
      if (options.tradesDbPath && existsSync(options.tradesDbPath)) {
        const escaped = resolve(options.tradesDbPath).replace(/'/g, "''");
        db.exec(`ATTACH DATABASE '${escaped}' AS tr_lb;`);
        attachedTr = true;
      }

      try {
        // Build temp table of candidate wallets for fast indexed joins
        db.exec(`
          DROP TABLE IF EXISTS temp._lb_wallets;
          CREATE TEMP TABLE _lb_wallets (wallet TEXT PRIMARY KEY);
        `);
        const insW = db.prepare("INSERT OR IGNORE INTO temp._lb_wallets VALUES (?)");
        db.exec("BEGIN");
        for (const w of candidateSpinWallets) insW.run(w);
        db.exec("COMMIT");

        // 2a. Tokens minted by candidate wallets and later spun
        const mintedSpins = db
          .prepare(
            `SELECT rm.minter AS wallet, rs.spun_at AS spun_at
             FROM raw_spins rs
             JOIN raw_mints rm ON rm.token_id = rs.token_id
             JOIN temp._lb_wallets lw ON lw.wallet = rm.minter
             WHERE rs.spun_at >= ?`,
          )
          .all(COSMO_SPIN_LAUNCH_ISO) as unknown as Array<{
          wallet: string;
          spun_at: string;
        }>;
        for (const r of mintedSpins) addSpin(r.wallet.toLowerCase(), r.spun_at);

        // 2b. Tokens transferred TO candidate wallets before being spun
        if (attachedTr) {
          const xferSpins = db
            .prepare(
              `SELECT rt.to_addr AS wallet, rs.spun_at AS spun_at
               FROM raw_spins rs
               JOIN tr_lb.raw_transfers rt ON rt.token_id = rs.token_id
               JOIN temp._lb_wallets lw ON lw.wallet = rt.to_addr
               WHERE rs.spun_at >= ? AND rt.transferred_at <= rs.spun_at`,
            )
            .all(COSMO_SPIN_LAUNCH_ISO) as unknown as Array<{
            wallet: string;
            spun_at: string;
          }>;
          for (const r of xferSpins) addSpin(r.wallet.toLowerCase(), r.spun_at);
        } else {
          // Fallback for single-DB unit tests where raw_transfers lives in the same SQLite DB
          const localXferSpins = db
            .prepare(
              `SELECT rt.to_addr AS wallet, rs.spun_at AS spun_at
               FROM raw_spins rs
               JOIN raw_transfers rt ON rt.token_id = rs.token_id
               JOIN temp._lb_wallets lw ON lw.wallet = rt.to_addr
               WHERE rs.spun_at >= ? AND rt.transferred_at <= rs.spun_at`,
            )
            .all(COSMO_SPIN_LAUNCH_ISO) as unknown as Array<{
            wallet: string;
            spun_at: string;
          }>;
          for (const r of localXferSpins) addSpin(r.wallet.toLowerCase(), r.spun_at);
        }

        db.exec("DROP TABLE IF EXISTS temp._lb_wallets;");
      } finally {
        if (attachedTr) {
          db.exec("DETACH DATABASE tr_lb;");
        }
      }

      for (const [w, set] of spinMap.entries()) {
        walletSpinTimesMs.set(
          w,
          Array.from(set).sort((a, b) => a - b),
        );
      }
      log(
        `  [leaderboards] paired Spin timelines for ${walletSpinTimesMs.size.toLocaleString()} active spinner wallets`,
      );
    }
  }

  // Sort seasons chronologically per artist and compute final ranked cutoff rows
  const draftsByArtist = new Map<"triples" | "artms", SeasonDraft[]>();
  for (const d of drafts) {
    const arr = draftsByArtist.get(d.artistId) ?? [];
    arr.push(d);
    draftsByArtist.set(d.artistId, arr);
  }

  const finalRows: ComputedLeaderboardCutoffRow[] = [];
  let seasonsCount = 0;
  const walletSeedFiles: string[] = [];
  let walletSeedRows = 0;
  let walletSeedChunkIdx = 0;
  let walletSeedStmts: string[] = [];

  const flushWalletSeedChunk = (force = false) => {
    if (!options.walletSeedDir) return;
    if (!force && walletSeedStmts.length < 1_200) return;
    if (walletSeedStmts.length === 0) return;
    walletSeedChunkIdx++;
    mkdirSync(options.walletSeedDir, { recursive: true });
    const filePath = resolve(
      options.walletSeedDir,
      `wallet-seed-${String(walletSeedChunkIdx).padStart(3, "0")}.sql`,
    );
    writeFileSync(
      filePath,
      `-- Active seasonal wallet leaderboard seed part ${walletSeedChunkIdx} (${now})\n` +
        walletSeedStmts.join("\n") +
        "\n",
      "utf8",
    );
    walletSeedFiles.push(filePath);
    walletSeedStmts = [];
  };

  for (const [artistId, artistDrafts] of draftsByArtist.entries()) {
    artistDrafts.sort((a, b) =>
      getSeasonSortKey(a.season, a.firstMintAt).localeCompare(
        getSeasonSortKey(b.season, b.firstMintAt),
      ),
    );
    const orderedMemberIds = artistMembers.get(artistId) ?? [];

    artistDrafts.forEach((draft, idx) => {
      const seasonOrder = idx + 1;
      seasonsCount++;

      const seasonMemberRows: ComputedLeaderboardCutoffRow[] = [];
      if (options.walletSeedDir) {
        walletSeedStmts.push(
          `DELETE FROM seasonal_wallet_leaderboard WHERE artist_id = ${sqlStr(artistId)} AND season = ${sqlStr(draft.season)};`,
        );
      }

      for (const memberId of orderedMemberIds) {
        const om = draft.memberObjekts.get(memberId);
        const gm = draft.memberGrids.get(memberId);
        if ((!om || om.size === 0) && (!gm || gm.size === 0)) continue;

        // Subtract verified Spin-reward 1-tx FCO mints for candidate wallets
        const adjustedObjekts = new Map<string, number>(om ? om.entries() : []);
        const sm = draft.memberSingleFirsts.get(memberId);
        if (sm) {
          for (const [w, singles] of sm.entries()) {
            const spins = walletSpinTimesMs.get(w);
            if (!spins || spins.length === 0) continue;
            let spinRewards = 0;
            for (const s of singles) {
              if (hasSpinBefore(spins, s.mintedMs)) spinRewards++;
            }
            if (spinRewards > 0) {
              const nextVal = Math.max(0, (adjustedObjekts.get(w) ?? 0) - spinRewards);
              if (nextVal > 0) adjustedObjekts.set(w, nextVal);
              else adjustedObjekts.delete(w);
            }
          }
        }

        if (options.walletSeedDir) {
          const allWallets = new Set<string>(adjustedObjekts.keys());
          if (gm) {
            for (const w of gm.keys()) allWallets.add(w);
          }
          const batchTuples: string[] = [];
          for (const w of allWallets) {
            const oc = adjustedObjekts.get(w) ?? 0;
            const gc = gm?.get(w) ?? 0;
            if (oc <= 0 && gc <= 0) continue;
            batchTuples.push(
              `(${sqlStr(artistId)}, ${sqlStr(draft.season)}, ${sqlStr(memberId)}, ${sqlStr(w)}, ${oc}, ${gc}, ${sqlStr(now)})`,
            );
            walletSeedRows++;
            if (batchTuples.length >= 60) {
              walletSeedStmts.push(
                `INSERT OR REPLACE INTO seasonal_wallet_leaderboard (artist_id, season, member_id, wallet, objekt_count, grid_count, updated_at) VALUES ${batchTuples.join(",")};`,
              );
              batchTuples.length = 0;
              flushWalletSeedChunk(false);
            }
          }
          if (batchTuples.length > 0) {
            walletSeedStmts.push(
              `INSERT OR REPLACE INTO seasonal_wallet_leaderboard (artist_id, season, member_id, wallet, objekt_count, grid_count, updated_at) VALUES ${batchTuples.join(",")};`,
            );
            flushWalletSeedChunk(false);
          }
        }

        const objVals = Array.from(adjustedObjekts.values()).sort((a, b) => b - a);
        const objTotal = objVals.reduce((s, v) => s + v, 0);
        const objTop10Sum = objVals.slice(0, 10).reduce((s, v) => s + v, 0);
        const objTop10 = objVals[9] ?? 0;

        const grdVals = Array.from(gm?.values() ?? []).sort((a, b) => b - a);
        const grdTotal = grdVals.reduce((s, v) => s + v, 0);
        const grdTop10Sum = grdVals.slice(0, 10).reduce((s, v) => s + v, 0);

        seasonMemberRows.push({
          artistId,
          season: draft.season,
          seasonOrder,
          memberId,
          seasonStartAt: draft.firstMintAt,
          seasonEndAt: draft.lastMintAt,
          objektTop1: objVals[0] ?? 0,
          objektTop3: objVals[2] ?? 0,
          objektTop10: objTop10,
          objektTop25: objVals[24] ?? 0,
          objektTop50: objVals[49] ?? 0,
          objektTop10Sum: objTop10Sum,
          objektTotalEligible: objTotal,
          objektUniqueCollectors: objVals.length,
          objektTop10SharePct:
            objTotal > 0 ? round2((objTop10Sum / objTotal) * 100) : 0,
          objektTop10EstUsd: round2(objTop10 * DEFAULT_UNIT_PRICE_USD),
          objektCutoffRank: 1,
          objektBuyersRank: 1,
          gridTop1: grdVals[0] ?? 0,
          gridTop3: grdVals[2] ?? 0,
          gridTop10: grdVals[9] ?? 0,
          gridTop25: grdVals[24] ?? 0,
          gridTop50: grdVals[49] ?? 0,
          gridTotalCompleted: grdTotal,
          gridUniqueGridders: grdVals.length,
          gridTop10SharePct:
            grdTotal > 0 ? round2((grdTop10Sum / grdTotal) * 100) : 0,
          gridCutoffRank: 1,
        });
      }

      // Compute within-season competition ranks (1 = hardest cutoff / most buyers)
      const objCutoffRanks = assignCompetitionRanks(
        seasonMemberRows,
        (r) => r.objektTop10,
      );
      const objBuyersRanks = assignCompetitionRanks(
        seasonMemberRows,
        (r) => r.objektUniqueCollectors,
      );
      const grdCutoffRanks = assignCompetitionRanks(
        seasonMemberRows,
        (r) => r.gridTop10,
      );

      for (const row of seasonMemberRows) {
        row.objektCutoffRank = objCutoffRanks.get(row.memberId) ?? 1;
        row.objektBuyersRank = objBuyersRanks.get(row.memberId) ?? 1;
        row.gridCutoffRank = grdCutoffRanks.get(row.memberId) ?? 1;
        finalRows.push(row);
      }
    });
  }

  flushWalletSeedChunk(true);

  if (!options.skipCutoffsSql) {
    // Emit compact batched SQL
    const lines: string[] = [
      `-- Auto-generated verified seasonal COSMO leaderboard cutoffs (${now})`,
      "",
      "DELETE FROM seasonal_leaderboard_cutoffs;",
      "",
    ];

    const tuples = finalRows.map(
      (r) =>
        `(${sqlStr(r.artistId)}, ${sqlStr(r.season)}, ${r.seasonOrder}, ${sqlStr(r.memberId)}, ${sqlStr(r.seasonStartAt)}, ${sqlStr(r.seasonEndAt)}, ${r.objektTop1}, ${r.objektTop3}, ${r.objektTop10}, ${r.objektTop25}, ${r.objektTop50}, ${r.objektTop10Sum}, ${r.objektTotalEligible}, ${r.objektUniqueCollectors}, ${r.objektTop10SharePct}, ${r.objektTop10EstUsd}, ${r.objektCutoffRank}, ${r.objektBuyersRank}, ${r.gridTop1}, ${r.gridTop3}, ${r.gridTop10}, ${r.gridTop25}, ${r.gridTop50}, ${r.gridTotalCompleted}, ${r.gridUniqueGridders}, ${r.gridTop10SharePct}, ${r.gridCutoffRank}, ${sqlStr(now)})`,
    );

    for (let i = 0; i < tuples.length; i += 25) {
      lines.push(
        `INSERT OR REPLACE INTO seasonal_leaderboard_cutoffs (artist_id, season, season_order, member_id, season_start_at, season_end_at, objekt_top1, objekt_top3, objekt_top10, objekt_top25, objekt_top50, objekt_top10_sum, objekt_total_eligible, objekt_unique_collectors, objekt_top10_share_pct, objekt_top10_est_usd, objekt_cutoff_rank, objekt_buyers_rank, grid_top1, grid_top3, grid_top10, grid_top25, grid_top50, grid_total_completed, grid_unique_gridders, grid_top10_share_pct, grid_cutoff_rank, updated_at) VALUES ${tuples.slice(i, i + 25).join(", ")};`,
      );
    }

    mkdirSync(resolve(outFile, ".."), { recursive: true });
    writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
  }

  return {
    seasonsCount,
    rowsCount: finalRows.length,
    outFile,
    rows: finalRows,
    walletSeedFiles: options.walletSeedDir ? walletSeedFiles : undefined,
    walletSeedRows: options.walletSeedDir ? walletSeedRows : undefined,
  };
}
