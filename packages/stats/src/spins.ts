/**
 * COSMO Spin Analytics & On-Chain Outcome Pairing Engine
 *
 * Pure, deterministic analytics covering:
 * 1. Member spin volume & burn/spin rate (% of each member's supply sent to Spin)
 * 2. Supply rarity tiers & Objekt class/format breakdown of cards sacrificed to Spin
 * 3. Season-adjusted published COSMO Spin odds (Legacy w/ SCO vs Modern FCO+PCO)
 * 4. Exact on-chain Spin -> Reward Mint pairing (`Transfer(wallet -> SPIN)` matched
 *    against subsequent `Transfer(0x0 -> wallet)` where the wallet receives 1 mint
 *    in that transaction — accounting for Modhaus's multi-wallet relayer batching!)
 */

export type SpinRarityTierId =
  | "ultra_rare"
  | "very_rare"
  | "rare"
  | "uncommon"
  | "common";

export type SpinOutcomeKind = "fco" | "sco" | "premier" | "other" | "blank";

export type SpinOddsEra = "legacy_with_sco" | "modern_no_sco";

export interface SpinRarityTierMeta {
  id: SpinRarityTierId;
  label: string;
  rangeLabel: string;
  maxSupplyInclusive: number | null;
  minSupplyInclusive: number;
  accentHex: string;
}

export const SPIN_RARITY_TIERS: readonly SpinRarityTierMeta[] = [
  {
    id: "ultra_rare",
    label: "Ultra Rare",
    rangeLabel: "< 100 copies",
    minSupplyInclusive: 1,
    maxSupplyInclusive: 99,
    accentHex: "#f43f5e", // rose-500
  },
  {
    id: "very_rare",
    label: "Very Rare",
    rangeLabel: "100 – 499 copies",
    minSupplyInclusive: 100,
    maxSupplyInclusive: 499,
    accentHex: "#f59e0b", // amber-500
  },
  {
    id: "rare",
    label: "Rare",
    rangeLabel: "500 – 1,999 copies",
    minSupplyInclusive: 500,
    maxSupplyInclusive: 1999,
    accentHex: "#a855f7", // purple-500
  },
  {
    id: "uncommon",
    label: "Uncommon",
    rangeLabel: "2,000 – 9,999 copies",
    minSupplyInclusive: 2000,
    maxSupplyInclusive: 9999,
    accentHex: "#38bdf8", // sky-400
  },
  {
    id: "common",
    label: "Common",
    rangeLabel: "10,000+ copies",
    minSupplyInclusive: 10000,
    maxSupplyInclusive: null,
    accentHex: "#71717a", // zinc-500
  },
] as const;

/**
 * Published Modhaus COSMO Spin drop-rate tables by era:
 * - Legacy seasons (tripleS Atom02 / Ever01 & earlier; ARTMS Divine01 & earlier):
 *   14/16 FCO (87.50%), 0.5/16 SCO (3.125%), ~0.06% Premier (4xxZ), ~9.315% Blank (Nothing)
 * - Modern seasons (tripleS Binary02+ / Cream02+; ARTMS Ever01+ / Atom02+):
 *   SCOs removed from the Spin pool and folded into FCO -> 90.63% FCO, ~0.06% Premier, ~9.31% Blank
 */
export const COSMO_SPIN_PUBLISHED_ODDS = {
  legacy_with_sco: {
    era: "legacy_with_sco" as const,
    label: "Legacy Spin Pool (incl. SCO)",
    fcoRate: 0.875,
    scoRate: 0.03125,
    premierRate: 0.0006,
    blankRate: 0.09315,
  },
  modern_no_sco: {
    era: "modern_no_sco" as const,
    label: "Modern Spin Pool (FCO + Premier)",
    fcoRate: 0.9063,
    scoRate: 0,
    premierRate: 0.0006,
    blankRate: 0.0931,
  },
} as const;

export function getSpinOddsEraForSeason(
  artistId: string,
  season: string,
): SpinOddsEra {
  const artist = artistId.trim().toLowerCase();
  const s = season.trim().toLowerCase();
  if (artist === "triples") {
    if (
      s === "atom01" ||
      s === "binary01" ||
      s === "cream01" ||
      s === "divine01" ||
      s === "ever01" ||
      s === "atom02"
    ) {
      return "legacy_with_sco";
    }
    return "modern_no_sco";
  }
  // ARTMS: Ever01+ removed SCOs from Spin
  if (
    s === "atom01" ||
    s === "binary01" ||
    s === "cream01" ||
    s === "divine01"
  ) {
    return "legacy_with_sco";
  }
  return "modern_no_sco";
}

export function classifySpinRarityTier(totalSupply: number): SpinRarityTierId {
  const n = Math.max(0, totalSupply);
  if (n < 100) return "ultra_rare";
  if (n < 500) return "very_rare";
  if (n < 2000) return "rare";
  if (n < 10000) return "uncommon";
  return "common";
}

export function classifySpinOutputClass(
  objektClass: string,
  collectionNo: string,
): Exclude<SpinOutcomeKind, "blank"> {
  const cls = objektClass.trim().toLowerCase();
  const col = collectionNo.trim().toUpperCase();
  if (cls === "premier" || /^4\d\d/.test(col)) return "premier";
  if (cls === "special" || /^2\d\d/.test(col)) return "sco";
  if (cls === "first" || cls === "basic" || /^1\d\d/.test(col)) return "fco";
  return "other";
}

export interface SpinMemberInfo {
  id: string;
  code: string;
  memberOrder: number;
  name: string;
  fullName: string;
  hexColor: string;
}

export interface SpinCollectionInput {
  slug: string;
  collectionId: string;
  artistId: string;
  memberId: string | null;
  rawMemberName: string;
  season: string;
  objektClass: string;
  collectionNo: string;
  onOffline: string;
  totalMints: number;
  spunCount: number;
  frontImageUrl: string | null;
  apolloTotalCopies: number | null;
  apolloMedianPriceUsd: number | null;
  apolloListingCount: number | null;
}

export interface PairedSpinOutcomeSummary {
  totalPairedSpins: number;
  blankCount: number;
  fcoCount: number;
  scoCount: number;
  premierCount: number;
  otherCount: number;
  uniqueSpinners: number;
  sampleStartAt: string | null;
  sampleEndAt: string | null;
}

export interface PairedMemberSpinOutcome {
  memberId: string;
  pairedSentCount: number;
  pairedPulledCount: number;
  pairedBlankFromCount: number;
  pairedRarePulledCount: number;
}

export interface MemberSpinStatRow {
  member: SpinMemberInfo;
  totalMints: number;
  spunCount: number;
  remainingCount: number;
  spinRatePct: number;
  spinSharePct: number;
  spinRateRelativeIndex: number;
  fcoSpun: number;
  dcoSpun: number;
  physicalSpun: number;
  rareSupplySpun: number; // cards with total supply < 1,000
  premierMotionScoSpun: number;
  pairedSentCount: number;
  pairedPulledCount: number;
  pairedBlankFromCount: number;
  pairedRarePulledCount: number;
}

export interface SpinRarityBucketRow {
  tier: SpinRarityTierMeta;
  collectionsCount: number;
  totalSupply: number;
  spunCount: number;
  shareOfSpinsPct: number;
  tierSpinRatePct: number;
  estMarketValueBurnedUsd: number;
}

export interface SpinClassBreakdownRow {
  key: string;
  objektClass: string;
  onOffline: "online" | "offline";
  label: string;
  collectionsCount: number;
  totalMints: number;
  spunCount: number;
  shareOfSpinsPct: number;
  spinRatePct: number;
}

export interface SpinSeasonRow {
  season: string;
  era: SpinOddsEra;
  totalMints: number;
  spunCount: number;
  spinRatePct: number;
  premierMints: number;
  estBlanks: number;
  estFcoPulls: number;
  estScoPulls: number;
  estPremierPulls: number;
}

export interface RareSpunCardRow {
  slug: string;
  collectionId: string;
  season: string;
  rawMemberName: string;
  memberId: string | null;
  memberName: string;
  memberHexColor: string;
  objektClass: string;
  collectionNo: string;
  onOffline: "online" | "offline";
  frontImageUrl: string | null;
  effectiveSupply: number;
  spunCount: number;
  spinRatePct: number;
  rarityTier: SpinRarityTierId;
  apolloMedianPriceUsd: number | null;
  apolloListingCount: number | null;
  estBurnedValueUsd: number | null;
}

export interface SpinAnalyticsResult {
  totals: {
    totalMints: number;
    totalSpins: number;
    overallSpinRatePct: number;
    rareUnder500Spun: number;
    rareUnder1000Spun: number;
    premierSpun: number;
    motionSpun: number;
    specialSpun: number;
    physicalSpun: number;
    premierTotalMinted: number;
    estBlanks: number;
    estFcoPulls: number;
    estScoPulls: number;
    estPremierPulls: number;
    estBlankRatePct: number;
    estFcoRatePct: number;
    estScoRatePct: number;
    estPremierRatePct: number;
    estMarketValueBurnedUsd: number;
  };
  pairedSummary: PairedSpinOutcomeSummary | null;
  members: MemberSpinStatRow[];
  rarityTiers: SpinRarityBucketRow[];
  classBreakdown: SpinClassBreakdownRow[];
  seasons: SpinSeasonRow[];
  rarestSpunCards: RareSpunCardRow[];
  premierMotionSpunCards: RareSpunCardRow[];
  highestValueSpunCards: RareSpunCardRow[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes complete Spin Analytics for an artist (optionally filtered to a single season).
 */
export function computeSpinAnalytics(params: {
  artistId: string;
  members: readonly SpinMemberInfo[];
  collections: readonly SpinCollectionInput[];
  seasonFilter?: string;
  pairedSummary?: PairedSpinOutcomeSummary | null;
  pairedMemberOutcomes?: readonly PairedMemberSpinOutcome[];
}): SpinAnalyticsResult {
  const { artistId, members, seasonFilter } = params;
  const cols =
    seasonFilter && seasonFilter !== "all"
      ? params.collections.filter((c) => c.season === seasonFilter)
      : params.collections;

  const memberById = new Map(members.map((m) => [m.id, m]));
  const pairedMemberById = new Map(
    (params.pairedMemberOutcomes ?? []).map((p) => [p.memberId, p]),
  );

  // Per-member accumulators
  const memberAcc = new Map<
    string,
    {
      member: SpinMemberInfo;
      totalMints: number;
      spunCount: number;
      fcoSpun: number;
      dcoSpun: number;
      physicalSpun: number;
      rareSupplySpun: number;
      premierMotionScoSpun: number;
    }
  >();
  for (const m of members) {
    memberAcc.set(m.id, {
      member: m,
      totalMints: 0,
      spunCount: 0,
      fcoSpun: 0,
      dcoSpun: 0,
      physicalSpun: 0,
      rareSupplySpun: 0,
      premierMotionScoSpun: 0,
    });
  }

  // Rarity tier accumulators
  const rarityAcc = new Map<
    SpinRarityTierId,
    {
      tier: SpinRarityTierMeta;
      collectionsCount: number;
      totalSupply: number;
      spunCount: number;
      estMarketValueBurnedUsd: number;
    }
  >();
  for (const tier of SPIN_RARITY_TIERS) {
    rarityAcc.set(tier.id, {
      tier,
      collectionsCount: 0,
      totalSupply: 0,
      spunCount: 0,
      estMarketValueBurnedUsd: 0,
    });
  }

  // Class + format accumulators
  const classAcc = new Map<
    string,
    {
      key: string;
      objektClass: string;
      onOffline: "online" | "offline";
      label: string;
      collectionsCount: number;
      totalMints: number;
      spunCount: number;
    }
  >();

  // Season accumulators
  const seasonAcc = new Map<
    string,
    {
      season: string;
      era: SpinOddsEra;
      totalMints: number;
      spunCount: number;
      premierMints: number;
    }
  >();

  let totalMints = 0;
  let totalSpins = 0;
  let rareUnder500Spun = 0;
  let rareUnder1000Spun = 0;
  let premierSpun = 0;
  let motionSpun = 0;
  let specialSpun = 0;
  let physicalSpun = 0;
  let premierTotalMinted = 0;
  let estMarketValueBurnedUsd = 0;

  const spunCards: RareSpunCardRow[] = [];

  for (const c of cols) {
    const mints = Math.max(0, c.totalMints);
    const spun = Math.max(0, c.spunCount);
    const onOffline: "online" | "offline" =
      c.onOffline === "offline" || c.collectionNo.toUpperCase().endsWith("A")
        ? "offline"
        : "online";
    const effectiveSupply = Math.max(mints, c.apolloTotalCopies ?? 0);
    const tierId = classifySpinRarityTier(effectiveSupply);
    const clsLower = c.objektClass.toLowerCase();

    totalMints += mints;
    totalSpins += spun;

    if (clsLower === "premier") {
      premierTotalMinted += mints;
      premierSpun += spun;
    } else if (clsLower === "motion") {
      motionSpun += spun;
    } else if (clsLower === "special") {
      specialSpun += spun;
    }
    if (onOffline === "offline") {
      physicalSpun += spun;
    }
    if (effectiveSupply > 0 && effectiveSupply < 500) {
      rareUnder500Spun += spun;
    }
    if (effectiveSupply > 0 && effectiveSupply < 1000) {
      rareUnder1000Spun += spun;
    }

    const cardBurnedVal =
      spun > 0 && c.apolloMedianPriceUsd !== null && c.apolloMedianPriceUsd > 0
        ? spun * c.apolloMedianPriceUsd
        : null;
    if (cardBurnedVal !== null) {
      estMarketValueBurnedUsd += cardBurnedVal;
    }

    // Rarity tier bucket
    const rBucket = rarityAcc.get(tierId)!;
    if (spun > 0) rBucket.collectionsCount++;
    rBucket.totalSupply += effectiveSupply;
    rBucket.spunCount += spun;
    if (cardBurnedVal !== null) {
      rBucket.estMarketValueBurnedUsd += cardBurnedVal;
    }

    // Class + format bucket
    const classKey = `${c.objektClass}|${onOffline}`;
    let cBucket = classAcc.get(classKey);
    if (!cBucket) {
      cBucket = {
        key: classKey,
        objektClass: c.objektClass,
        onOffline,
        label: `${c.objektClass} (${onOffline === "offline" ? "Physical" : "Digital"})`,
        collectionsCount: 0,
        totalMints: 0,
        spunCount: 0,
      };
      classAcc.set(classKey, cBucket);
    }
    cBucket.collectionsCount++;
    cBucket.totalMints += mints;
    cBucket.spunCount += spun;

    // Season bucket
    let sBucket = seasonAcc.get(c.season);
    if (!sBucket) {
      sBucket = {
        season: c.season,
        era: getSpinOddsEraForSeason(artistId, c.season),
        totalMints: 0,
        spunCount: 0,
        premierMints: 0,
      };
      seasonAcc.set(c.season, sBucket);
    }
    sBucket.totalMints += mints;
    sBucket.spunCount += spun;
    if (clsLower === "premier") sBucket.premierMints += mints;

    // Member accumulator
    if (c.memberId) {
      const mAcc = memberAcc.get(c.memberId);
      if (mAcc) {
        mAcc.totalMints += mints;
        mAcc.spunCount += spun;
        if (onOffline === "offline") {
          mAcc.physicalSpun += spun;
        } else if (clsLower === "first") {
          mAcc.fcoSpun += spun;
        } else if (clsLower === "double") {
          mAcc.dcoSpun += spun;
        }
        if (effectiveSupply > 0 && effectiveSupply < 1000) {
          mAcc.rareSupplySpun += spun;
        }
        if (
          clsLower === "premier" ||
          clsLower === "motion" ||
          clsLower === "special"
        ) {
          mAcc.premierMotionScoSpun += spun;
        }
      }
    }

    // Track notable spun cards for Hall of Pain / Rarest Spun Cards
    if (spun > 0 && effectiveSupply > 0) {
      const mem = c.memberId ? memberById.get(c.memberId) : null;
      spunCards.push({
        slug: c.slug,
        collectionId: c.collectionId,
        season: c.season,
        rawMemberName: c.rawMemberName,
        memberId: c.memberId,
        memberName: mem?.name ?? c.rawMemberName,
        memberHexColor: mem?.hexColor ?? "#38bdf8",
        objektClass: c.objektClass,
        collectionNo: c.collectionNo,
        onOffline,
        frontImageUrl: c.frontImageUrl,
        effectiveSupply,
        spunCount: spun,
        spinRatePct: round2((spun / effectiveSupply) * 100),
        rarityTier: tierId,
        apolloMedianPriceUsd: c.apolloMedianPriceUsd,
        apolloListingCount: c.apolloListingCount,
        estBurnedValueUsd:
          cardBurnedVal !== null ? round2(cardBurnedVal) : null,
      });
    }
  }

  // Season rows + season-weighted published spin outcome totals
  let estBlanks = 0;
  let estFcoPulls = 0;
  let estScoPulls = 0;
  let estPremierPulls = 0;

  const seasons: SpinSeasonRow[] = Array.from(seasonAcc.values())
    .map((s) => {
      const odds = COSMO_SPIN_PUBLISHED_ODDS[s.era];
      const sBlanks = Math.round(s.spunCount * odds.blankRate);
      const sFco = Math.round(s.spunCount * odds.fcoRate);
      const sSco = Math.round(s.spunCount * odds.scoRate);
      const sPremier = Math.round(s.spunCount * odds.premierRate);
      estBlanks += sBlanks;
      estFcoPulls += sFco;
      estScoPulls += sSco;
      estPremierPulls += sPremier;
      return {
        season: s.season,
        era: s.era,
        totalMints: s.totalMints,
        spunCount: s.spunCount,
        spinRatePct:
          s.totalMints > 0 ? round2((s.spunCount / s.totalMints) * 100) : 0,
        premierMints: s.premierMints,
        estBlanks: sBlanks,
        estFcoPulls: sFco,
        estScoPulls: sSco,
        estPremierPulls: sPremier,
      };
    })
    .sort((a, b) => b.spunCount - a.spunCount);

  // Member leaderboard rows
  const activeMembers = Array.from(memberAcc.values()).filter(
    (m) => m.totalMints > 0 || m.spunCount > 0,
  );
  const memberTotalSpinsSum = activeMembers.reduce(
    (s, m) => s + m.spunCount,
    0,
  );
  const meanSpinRate =
    activeMembers.length > 0
      ? activeMembers.reduce(
          (s, m) =>
            s + (m.totalMints > 0 ? (m.spunCount / m.totalMints) * 100 : 0),
          0,
        ) / activeMembers.length
      : 0;

  const memberRows: MemberSpinStatRow[] = activeMembers
    .map((m) => {
      const spinRatePct =
        m.totalMints > 0 ? round2((m.spunCount / m.totalMints) * 100) : 0;
      const paired = pairedMemberById.get(m.member.id);
      return {
        member: m.member,
        totalMints: m.totalMints,
        spunCount: m.spunCount,
        remainingCount: Math.max(0, m.totalMints - m.spunCount),
        spinRatePct,
        spinSharePct:
          memberTotalSpinsSum > 0
            ? round2((m.spunCount / memberTotalSpinsSum) * 100)
            : 0,
        spinRateRelativeIndex:
          meanSpinRate > 0 ? round2(spinRatePct / meanSpinRate) : 1,
        fcoSpun: m.fcoSpun,
        dcoSpun: m.dcoSpun,
        physicalSpun: m.physicalSpun,
        rareSupplySpun: m.rareSupplySpun,
        premierMotionScoSpun: m.premierMotionScoSpun,
        pairedSentCount: paired?.pairedSentCount ?? 0,
        pairedPulledCount: paired?.pairedPulledCount ?? 0,
        pairedBlankFromCount: paired?.pairedBlankFromCount ?? 0,
        pairedRarePulledCount: paired?.pairedRarePulledCount ?? 0,
      };
    })
    .sort((a, b) => b.spinRatePct - a.spinRatePct || b.spunCount - a.spunCount);

  const rarityTiers: SpinRarityBucketRow[] = SPIN_RARITY_TIERS.map((meta) => {
    const b = rarityAcc.get(meta.id)!;
    return {
      tier: meta,
      collectionsCount: b.collectionsCount,
      totalSupply: b.totalSupply,
      spunCount: b.spunCount,
      shareOfSpinsPct:
        totalSpins > 0 ? round2((b.spunCount / totalSpins) * 100) : 0,
      tierSpinRatePct:
        b.totalSupply > 0 ? round2((b.spunCount / b.totalSupply) * 100) : 0,
      estMarketValueBurnedUsd: round2(b.estMarketValueBurnedUsd),
    };
  });

  const classBreakdown: SpinClassBreakdownRow[] = Array.from(classAcc.values())
    .filter((c) => c.spunCount > 0)
    .map((c) => ({
      ...c,
      shareOfSpinsPct:
        totalSpins > 0 ? round2((c.spunCount / totalSpins) * 100) : 0,
      spinRatePct:
        c.totalMints > 0 ? round2((c.spunCount / c.totalMints) * 100) : 0,
    }))
    .sort((a, b) => b.spunCount - a.spunCount);

  // Rarest spun cards: prioritize cards with verified supply >= 10 (avoid tiny 1-card test anomalies at the very top while still showing true rarities) — actually sort by lowest supply >= 5, then <5!
  const rarestSpunCards = [...spunCards]
    .filter((c) => c.effectiveSupply < 1000 && c.frontImageUrl)
    .sort(
      (a, b) =>
        a.effectiveSupply - b.effectiveSupply || b.spunCount - a.spunCount,
    )
    .slice(0, 24);

  const premierMotionSpunCards = [...spunCards]
    .filter(
      (c) =>
        c.objektClass.toLowerCase() === "premier" ||
        c.objektClass.toLowerCase() === "motion",
    )
    .sort(
      (a, b) =>
        (a.objektClass.toLowerCase() === "premier" ? 0 : 1) -
          (b.objektClass.toLowerCase() === "premier" ? 0 : 1) ||
        a.effectiveSupply - b.effectiveSupply ||
        b.spunCount - a.spunCount,
    )
    .slice(0, 24);

  const highestValueSpunCards = [...spunCards]
    .filter(
      (c) => c.apolloMedianPriceUsd !== null && c.apolloMedianPriceUsd > 0,
    )
    .sort(
      (a, b) =>
        (b.apolloMedianPriceUsd ?? 0) - (a.apolloMedianPriceUsd ?? 0) ||
        b.spunCount - a.spunCount,
    )
    .slice(0, 24);

  return {
    totals: {
      totalMints,
      totalSpins,
      overallSpinRatePct:
        totalMints > 0 ? round2((totalSpins / totalMints) * 100) : 0,
      rareUnder500Spun,
      rareUnder1000Spun,
      premierSpun,
      motionSpun,
      specialSpun,
      physicalSpun,
      premierTotalMinted,
      estBlanks,
      estFcoPulls,
      estScoPulls,
      estPremierPulls,
      estBlankRatePct:
        totalSpins > 0 ? round2((estBlanks / totalSpins) * 100) : 9.31,
      estFcoRatePct:
        totalSpins > 0 ? round2((estFcoPulls / totalSpins) * 100) : 90.63,
      estScoRatePct:
        totalSpins > 0 ? round2((estScoPulls / totalSpins) * 100) : 0,
      estPremierRatePct:
        totalSpins > 0 ? round2((estPremierPulls / totalSpins) * 100) : 0.06,
      estMarketValueBurnedUsd: round2(estMarketValueBurnedUsd),
    },
    pairedSummary:
      !seasonFilter || seasonFilter === "all"
        ? (params.pairedSummary ?? null)
        : null,
    members: memberRows,
    rarityTiers,
    classBreakdown,
    seasons,
    rarestSpunCards,
    premierMotionSpunCards,
    highestValueSpunCards,
  };
}

// ============================================================================
// Exact On-Chain Spin -> Reward Mint Pairing Engine
// ============================================================================

export interface RawSpinOutEvent {
  txHash: string;
  logIndex: number;
  chain: "polygon" | "abstract";
  blockNumber: number;
  timestampIso: string;
  spinner: string; // wallet that sent the card to COSMO_SPIN_ADDRESS
  tokenId: number;
}

export interface RawSpinMintEvent {
  txHash: string;
  logIndex: number;
  chain: "polygon" | "abstract";
  blockNumber: number;
  timestampIso: string;
  recipient: string;
  tokenId: number;
  /** Number of mints this specific recipient received inside this tx (must be 1 for Spin reward; other wallets may share the same Modhaus relayer tx!) */
  walletMintCountInTx: number;
}

export interface PairedSpinRecord {
  spin: RawSpinOutEvent;
  rewardMint: RawSpinMintEvent | null;
  delaySeconds: number | null;
}

export const DEFAULT_SPIN_OUTCOME_WINDOW_SEC = 240;

/**
 * Pairs outgoing COSMO Spin transfers (`wallet -> SPIN`) with the subsequent
 * single-token-per-wallet reward mint (`0x0 -> wallet`) within `maxWindowSec`.
 *
 * Crucially uses `walletMintCountInTx === 1` (NOT `txTotalMints === 1`), because
 * Modhaus's Abstract minter relayer frequently batches multiple users' 1-token
 * spin rewards into a single on-chain transaction!
 */
export function pairSpinOutcomes(
  spins: readonly RawSpinOutEvent[],
  mints: readonly RawSpinMintEvent[],
  maxWindowSec = DEFAULT_SPIN_OUTCOME_WINDOW_SEC,
): PairedSpinRecord[] {
  const mintsByWallet = new Map<
    string,
    Array<RawSpinMintEvent & { tsMs: number; used: boolean }>
  >();

  for (const m of mints) {
    if (m.walletMintCountInTx !== 1) continue;
    const w = m.recipient.toLowerCase();
    const tsMs = Date.parse(m.timestampIso);
    const arr = mintsByWallet.get(w) ?? [];
    arr.push({ ...m, tsMs: Number.isNaN(tsMs) ? 0 : tsMs, used: false });
    mintsByWallet.set(w, arr);
  }

  for (const arr of mintsByWallet.values()) {
    arr.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  const sortedSpins = [...spins].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
  );

  const results: PairedSpinRecord[] = [];
  for (const spin of sortedSpins) {
    const w = spin.spinner.toLowerCase();
    const cands = mintsByWallet.get(w);
    const spinMs = Date.parse(spin.timestampIso);
    let matched: (RawSpinMintEvent & { tsMs: number; used: boolean }) | null =
      null;
    let matchedDelaySec: number | null = null;

    if (cands && !Number.isNaN(spinMs)) {
      for (const c of cands) {
        if (c.used || c.chain !== spin.chain) continue;
        if (c.blockNumber < spin.blockNumber) continue;
        const deltaSec = Math.round((c.tsMs - spinMs) / 1000);
        if (deltaSec < -5) continue;
        if (deltaSec <= maxWindowSec) {
          matched = c;
          matchedDelaySec = Math.max(0, deltaSec);
          break;
        }
        // Sorted chronologically by block; once far past window we can stop scanning
        if (deltaSec > maxWindowSec + 30) break;
      }
    }

    if (matched) {
      matched.used = true;
    }

    results.push({
      spin,
      rewardMint: matched
        ? {
            txHash: matched.txHash,
            logIndex: matched.logIndex,
            chain: matched.chain,
            blockNumber: matched.blockNumber,
            timestampIso: matched.timestampIso,
            recipient: matched.recipient,
            tokenId: matched.tokenId,
            walletMintCountInTx: matched.walletMintCountInTx,
          }
        : null,
      delaySeconds: matchedDelaySec,
    });
  }

  return results;
}
