/**
 * Member Objekt Revenue & Settlement Estimation Engine
 *
 * Pure, deterministic analytics model translating on-chain COSMO Objekt mints,
 * COSMO Spin outflows, and Apollo provenance into estimated gross fan spend,
 * platform/store fees, Modhaus revenue share, and individual member earnings.
 *
 * Because Modhaus has NOT publicly disclosed exact contractual member payout
 * percentages, all split & channel assumptions are explicitly parameterized
 * and interactive in the UI.
 */

export type EarningsCollectionBucket =
  | "fco"
  | "dco"
  | "mco"
  | "unit"
  | "pass_plus"
  | "physical"
  | "free";

export type SeasonCoverageTier =
  | "full"
  | "partial_abstract"
  | "partial_polygon";

export type EarningsSplitPresetId =
  | "conservative_20"
  | "standard_30"
  | "split_50"
  | "custom";

export interface EarningsUnitRates {
  /** Blended online First Class Objekt (FCO) price across singles & web multi-packs */
  fcoUsd: number;
  /** Blended online paid Double Class Objekt (DCO) price */
  dcoUsd: number;
  /** Blended online paid Motion Class Objekt (MCO) price */
  mcoUsd: number;
  /** Blended online paid Unit Objekt price */
  unitUsd: number;
  /** Blended COSMO Talk Pass+ monthly subscription per member-month (1–24 member tiers) */
  passPlusUsd: number;
  /** Conservative net wholesale/attributable value per physical QR-scanned Objekt (when toggled on) */
  physicalNetUsd: number;
}

export interface EarningsModelConfig {
  preset: EarningsSplitPresetId;
  /** Member's percentage share of net revenue after app-store/payment fees (0..100) */
  memberSplitPct: number;
  /** Share of post-Sep 2024 digital Objekt purchases via shop.cosmo.fans vs mobile IAP (0..100) */
  webShopSharePct: number;
  /** Apple App Store / Google Play in-app purchase commission % (standard 30%) */
  appStoreFeePct: number;
  /** Web Shop payment processor / PG fee % (Stripe / PayPal / Korean PG ~4%) */
  webPaymentFeePct: number;
  /** Subtract free COSMO Spin replacement FCO mints (90.63% Binary02+, 87.50% earlier) */
  deductSpinMints: boolean;
  /** Include COSMO Talk Pass+ monthly subscription drops */
  includePassPlus: boolean;
  /** Include physical album/OMA QR-scanned A-series Objekts (off by default) */
  includePhysicalScans: boolean;
  /** Display conversion rate for KRW toggle */
  krwPerUsd: number;
  rates: EarningsUnitRates;
}

export const DEFAULT_EARNINGS_RATES: EarningsUnitRates = {
  fcoUsd: 2.25, // Blended across $1.88 (24-pack web) .. $2.49 (4-pack) .. $3.29 (app single)
  dcoUsd: 3.05, // Blended across $2.99 web / $3.29 app
  mcoUsd: 5.15, // Blended across $4.99 web / $5.99 app
  unitUsd: 2.99,
  passPlusUsd: 4.25, // Blended across $4.89 (1-member) .. $3.75 (24-member All-Pass+)
  physicalNetUsd: 1.5, // Conservative net album-attributable value per scanned physical card
};

export const DEFAULT_EARNINGS_CONFIG: EarningsModelConfig = {
  preset: "standard_30",
  memberSplitPct: 30,
  webShopSharePct: 65,
  appStoreFeePct: 30,
  webPaymentFeePct: 4,
  deductSpinMints: true,
  includePassPlus: true,
  includePhysicalScans: false,
  krwPerUsd: 1380,
  rates: { ...DEFAULT_EARNINGS_RATES },
};

export interface EarningsSplitPresetMeta {
  id: Exclude<EarningsSplitPresetId, "custom">;
  label: string;
  shortLabel: string;
  memberSplitPct: number;
  description: string;
}

export const EARNINGS_SPLIT_PRESETS: readonly EarningsSplitPresetMeta[] = [
  {
    id: "conservative_20",
    label: "20% Member / 80% Modhaus",
    shortLabel: "20% Conservative",
    memberSplitPct: 20,
    description:
      "Conservative rookie-style net royalty where Modhaus retains 80% to fund 24-member operations, COSMO dev, and comebacks.",
  },
  {
    id: "standard_30",
    label: "30% Member / 70% Modhaus",
    shortLabel: "30% Mid Estimate",
    memberSplitPct: 30,
    description:
      "Balanced mid-range industry benchmark (70:30 agency/artist split of post-fee net revenue).",
  },
  {
    id: "split_50",
    label: "50% Member / 50% Modhaus",
    shortLabel: "50% Net Split",
    memberSplitPct: 50,
    description:
      "Artist-favorable 50/50 split of net digital proceeds after store and payment processing fees.",
  },
];

export const MODHAUS_PUBLIC_BENCHMARKS = {
  auditedRevenueKrw: [
    { year: 2022, krwBillions: 0.84, approxUsdMillions: 0.6 },
    { year: 2023, krwBillions: 5.95, approxUsdMillions: 4.5 },
    { year: 2024, krwBillions: 20.36, approxUsdMillions: 14.8 },
    { year: 2025, krwBillions: 32.37, approxUsdMillions: 23.5 },
  ],
  yooyeonDisclosure: {
    date: "2024-07-13",
    source: "MBC Omniscient Interfering View (전지적 참견 시점 Ep. 307)",
    summary:
      "Kim YooYeon stated her early settlement matched an assistant manager/manager's annual salary at a major Korean conglomerate (~₩85M–₩100M KRW / ~$60K–$75K USD).",
    lowKrw: 85_000_000,
    highKrw: 100_000_000,
  },
} as const;

export interface EarningsMemberInfo {
  id: string;
  code: string;
  memberOrder: number;
  name: string;
  fullName: string;
  hexColor: string;
  revealDate: string;
}

export interface EarningsSeasonInput {
  season: string;
  artistId: string;
  firstMintAt: string | null;
  lastMintAt: string | null;
  /** Total tokens sent to COSMO_SPIN_ADDRESS across ALL classes (incl. physical & unlinked group cards) in this season */
  allClassSpins: number;
  /** Number of distinct members with online FCO mints in this season */
  fcoMemberCount: number;
  /** Total online FCO mints in this season (for display / sanity check) */
  totalRawFcoMints: number;
}

export interface EarningsMemberSeasonRow {
  season: string;
  memberId: string;
  rawFcoMints: number;
  paidDcoMints: number;
  paidMcoMints: number;
  paidUnitMints: number;
  passPlusMints: number;
  physicalMints: number;
  freeExcludedMints: number;
}

export interface SeasonCoverageInfo {
  season: string;
  coverage: SeasonCoverageTier;
  coverageLabel: string;
  /** 0 = pre-web-shop (100% App Store 30% fee), 0.3 = transition season, 1.0 = full web-shop era */
  webShopShareFactor: number;
  /** Published COSMO Spin FCO return rate for this season */
  spinFcoReturnRate: number;
  dateLabel: string;
}

export interface SeasonEarningsSummary extends SeasonCoverageInfo {
  firstMintAt: string | null;
  lastMintAt: string | null;
  allClassSpins: number;
  estSpinFcoMints: number;
  spinFcoPerMember: number;
  fcoMemberCount: number;
  rawFcoMints: number;
  paidFcoMints: number;
  paidDcoMints: number;
  paidMcoMints: number;
  passPlusMints: number;
  physicalMints: number;
  freeExcludedMints: number;
  totalGrossUsd: number;
  netRevenueUsd: number;
  memberEarningsUsd: number;
}

export interface MemberSeasonEarningsDetail {
  season: string;
  coverage: SeasonCoverageTier;
  rawFcoMints: number;
  estSpinFcoMints: number;
  paidFcoMints: number;
  paidDcoMints: number;
  paidMcoMints: number;
  paidUnitMints: number;
  passPlusMints: number;
  physicalMints: number;
  freeExcludedMints: number;
  totalGrossUsd: number;
  netRevenueUsd: number;
  memberEarningsUsd: number;
}

export interface MemberEarningsRow {
  member: EarningsMemberInfo;
  rank: number;
  rawFcoMints: number;
  estSpinFcoMints: number;
  paidFcoMints: number;
  paidDcoMints: number;
  paidMcoMints: number;
  paidUnitMints: number;
  passPlusMints: number;
  physicalMints: number;
  freeExcludedMints: number;
  totalPaidObjekts: number;

  fcoGrossUsd: number;
  dcoGrossUsd: number;
  mcoGrossUsd: number;
  unitGrossUsd: number;
  passPlusGrossUsd: number;
  physicalGrossUsd: number;
  totalGrossUsd: number;
  lowGrossUsd: number;
  highGrossUsd: number;

  platformFeesUsd: number;
  effectiveFeePct: number;
  netRevenueUsd: number;
  memberEarningsUsd: number;
  memberEarningsLowUsd: number;
  memberEarningsHighUsd: number;
  modhausEarningsUsd: number;
  annualizedMemberEarningsUsd: number | null;

  shareOfGroupPct: number;
  relativeToAvg: number;
  bySeason: MemberSeasonEarningsDetail[];
}

export interface EarningsAnalysisResult {
  selectedSeasons: string[];
  hasPartialCoverageSeason: boolean;
  spanDays: number | null;
  earliestMintAt: string | null;
  latestMintAt: string | null;
  totals: {
    rawFcoMints: number;
    estSpinFcoMints: number;
    paidFcoMints: number;
    paidDcoMints: number;
    paidMcoMints: number;
    paidUnitMints: number;
    passPlusMints: number;
    physicalMints: number;
    freeExcludedMints: number;
    totalPaidObjekts: number;

    fcoGrossUsd: number;
    dcoGrossUsd: number;
    mcoGrossUsd: number;
    unitGrossUsd: number;
    passPlusGrossUsd: number;
    physicalGrossUsd: number;
    totalGrossUsd: number;
    lowGrossUsd: number;
    highGrossUsd: number;

    platformFeesUsd: number;
    effectiveFeePct: number;
    netRevenueUsd: number;
    totalMemberEarningsUsd: number;
    totalMemberEarningsLowUsd: number;
    totalMemberEarningsHighUsd: number;
    totalModhausEarningsUsd: number;

    avgMemberEarningsUsd: number;
    medianMemberEarningsUsd: number;
  };
  seasons: SeasonEarningsSummary[];
  members: MemberEarningsRow[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Classifies an individual collection row into its economic revenue bucket.
 * Guarantees free native classes (Welcome 100Z, Grid SCO 2xxZ, Spin PCO 4xxZ,
 * Zero) and Apollo-verified promotional/bonus rewards are strictly $0.
 */
export function classifyCollectionForEarnings(input: {
  objektClass: string;
  onOffline: string;
  collectionNo: string;
  apolloProvenanceClass?: string | null;
  roundSaleMechanic?: string | null;
}): EarningsCollectionBucket {
  const cls = input.objektClass.trim().toLowerCase();
  const fmt = input.onOffline.trim().toLowerCase();
  const colNo = input.collectionNo.trim().toUpperCase();
  const prov = (input.apolloProvenanceClass ?? "").trim().toLowerCase();
  const mech = (input.roundSaleMechanic ?? "").trim().toLowerCase();

  // 1. Physical QR-scanned Objekts (A-series)
  if (fmt === "offline" || colNo.endsWith("A") || mech === "physical_scan") {
    return "physical";
  }

  // 2. Always-free online native classes:
  //    Welcome (100Z), Grid Special (2xxZ), Zero, and Spin-jackpot/reward Premier (4xxZ)
  if (
    cls === "welcome" ||
    colNo === "100Z" ||
    cls === "special" ||
    cls === "zero" ||
    cls === "premier"
  ) {
    return "free";
  }

  // 3. COSMO Talk Pass+ monthly subscription drops
  if (prov === "pass_plus" || mech === "subscription") {
    return "pass_plus";
  }

  // 4. Apollo-verified free promotional/voting/bonus drops or reward rounds
  if (prov === "free_reward" || mech === "reward") {
    return "free";
  }

  // 5. Paid digital primary classes
  if (cls === "first") return "fco";
  if (cls === "motion") return "mco";
  if (cls === "unit") return "unit";
  return "dco";
}

/**
 * Determines on-chain coverage tier, web-shop availability factor, and
 * published COSMO Spin FCO return odds for a given `(artistId, season)`.
 */
export function getSeasonCoverageInfo(
  artistId: string,
  season: string,
  firstMintAt?: string | null,
  lastMintAt?: string | null,
): SeasonCoverageInfo {
  const artist = artistId.toLowerCase();
  const sn = season.trim();
  const snLower = sn.toLowerCase();

  const fmtMonth = (iso?: string | null) => {
    if (!iso || iso.length < 7) return "";
    const [yr, mo] = iso.slice(0, 7).split("-");
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const mIdx = Number(mo) - 1;
    return mIdx >= 0 && mIdx < 12 ? `${months[mIdx]} ${yr}` : iso.slice(0, 7);
  };
  const dateLabel =
    firstMintAt && lastMintAt
      ? `${fmtMonth(firstMintAt)} – ${fmtMonth(lastMintAt)}`
      : firstMintAt
        ? `${fmtMonth(firstMintAt)}+`
        : sn;

  if (artist === "triples") {
    if (snLower === "atom01" || snLower === "binary01" || snLower === "cream01") {
      return {
        season: sn,
        coverage: "partial_polygon",
        coverageLabel: "Polygon Era (Partial)",
        webShopShareFactor: 0, // Entirely before Sep 2024 shop.cosmo.fans launch
        spinFcoReturnRate: 0.875,
        dateLabel,
      };
    }
    if (snLower === "divine01") {
      return {
        season: sn,
        coverage: "partial_polygon",
        coverageLabel: "Polygon Era (Partial)",
        webShopShareFactor: 0.3, // May–Nov 2024 straddled Sep 2024 Web Shop launch
        spinFcoReturnRate: 0.875,
        dateLabel,
      };
    }
    if (snLower === "ever01") {
      return {
        season: sn,
        coverage: "partial_polygon",
        coverageLabel: "Polygon Era (Partial)",
        webShopShareFactor: 1.0,
        spinFcoReturnRate: 0.875,
        dateLabel,
      };
    }
    if (snLower === "atom02") {
      return {
        season: sn,
        coverage: "partial_abstract",
        coverageLabel: "Partial (~30–50%)",
        webShopShareFactor: 1.0,
        spinFcoReturnRate: 0.875,
        dateLabel,
      };
    }
    // Binary02, Cream02, and all future seasons (Nov 2025+)
    return {
      season: sn,
      coverage: "full",
      coverageLabel: "100% On-Chain",
      webShopShareFactor: 1.0,
      spinFcoReturnRate: 0.9063, // SCOs removed from spin pool in Binary02+
      dateLabel,
    };
  }

  // ARTMS
  if (snLower === "atom01" || snLower === "binary01") {
    return {
      season: sn,
      coverage: "partial_polygon",
      coverageLabel: "Polygon Era (Partial)",
      webShopShareFactor: snLower === "atom01" ? 0 : 0.4,
      spinFcoReturnRate: 0.875,
      dateLabel,
    };
  }
  if (snLower === "cream01") {
    return {
      season: sn,
      coverage: "partial_polygon",
      coverageLabel: "Polygon Era (Partial)",
      webShopShareFactor: 1.0,
      spinFcoReturnRate: 0.875,
      dateLabel,
    };
  }
  if (snLower === "divine01") {
    return {
      season: sn,
      coverage: "partial_abstract",
      coverageLabel: "Partial (~55–90%)",
      webShopShareFactor: 1.0,
      spinFcoReturnRate: 0.875,
      dateLabel,
    };
  }
  // Ever01, Atom02, and all future ARTMS seasons (Dec 2025+)
  return {
    season: sn,
    coverage: "full",
    coverageLabel: "100% On-Chain",
    webShopShareFactor: 1.0,
    spinFcoReturnRate: 0.9063,
    dateLabel,
  };
}

/**
 * Computes the complete member-by-member and season-by-season earnings model.
 */
export function computeMemberEarnings(params: {
  artistId: string;
  members: readonly EarningsMemberInfo[];
  seasons: readonly EarningsSeasonInput[];
  rows: readonly EarningsMemberSeasonRow[];
  selectedSeasons?: readonly string[];
  config?: Partial<EarningsModelConfig>;
}): EarningsAnalysisResult {
  const cfg: EarningsModelConfig = {
    ...DEFAULT_EARNINGS_CONFIG,
    ...params.config,
    memberSplitPct: clamp(
      params.config?.memberSplitPct ?? DEFAULT_EARNINGS_CONFIG.memberSplitPct,
      0,
      100,
    ),
    webShopSharePct: clamp(
      params.config?.webShopSharePct ?? DEFAULT_EARNINGS_CONFIG.webShopSharePct,
      0,
      100,
    ),
    appStoreFeePct: clamp(
      params.config?.appStoreFeePct ?? DEFAULT_EARNINGS_CONFIG.appStoreFeePct,
      0,
      50,
    ),
    webPaymentFeePct: clamp(
      params.config?.webPaymentFeePct ?? DEFAULT_EARNINGS_CONFIG.webPaymentFeePct,
      0,
      30,
    ),
    rates: {
      ...DEFAULT_EARNINGS_RATES,
      ...(params.config?.rates ?? {}),
    },
  };

  // Enrich all available seasons with coverage info and sort chronologically (newest first)
  const seasonMetaList = params.seasons
    .map((s) => ({
      input: s,
      info: getSeasonCoverageInfo(
        params.artistId,
        s.season,
        s.firstMintAt,
        s.lastMintAt,
      ),
    }))
    .sort((a, b) =>
      (b.input.firstMintAt ?? "").localeCompare(a.input.firstMintAt ?? "") ||
      b.input.season.localeCompare(a.input.season),
    );

  const fullCoverageSeasons = seasonMetaList
    .filter((s) => s.info.coverage === "full")
    .map((s) => s.input.season);

  const selectedSeasonSet = new Set(
    params.selectedSeasons && params.selectedSeasons.length > 0
      ? params.selectedSeasons
      : fullCoverageSeasons.length > 0
        ? fullCoverageSeasons
        : seasonMetaList.map((s) => s.input.season),
  );

  // Index rows by (season, memberId)
  const rowBySeasonMember = new Map<string, EarningsMemberSeasonRow>();
  for (const r of params.rows) {
    const key = `${r.season}|${r.memberId}`;
    const prev = rowBySeasonMember.get(key);
    if (!prev) {
      rowBySeasonMember.set(key, { ...r });
    } else {
      prev.rawFcoMints += r.rawFcoMints;
      prev.paidDcoMints += r.paidDcoMints;
      prev.paidMcoMints += r.paidMcoMints;
      prev.paidUnitMints += r.paidUnitMints;
      prev.passPlusMints += r.passPlusMints;
      prev.physicalMints += r.physicalMints;
      prev.freeExcludedMints += r.freeExcludedMints;
    }
  }

  // Unit price sensitivity multipliers relative to DEFAULT_EARNINGS_RATES
  const fcoScale =
    DEFAULT_EARNINGS_RATES.fcoUsd > 0
      ? cfg.rates.fcoUsd / DEFAULT_EARNINGS_RATES.fcoUsd
      : 1;
  const fcoLowUnit = 1.88 * fcoScale; // Web 24-pack floor
  const fcoHighUnit = 3.12 * fcoScale; // App Store 4-pack/single ceiling

  const dcoScale =
    DEFAULT_EARNINGS_RATES.dcoUsd > 0
      ? cfg.rates.dcoUsd / DEFAULT_EARNINGS_RATES.dcoUsd
      : 1;
  const dcoLowUnit = 2.49 * dcoScale;
  const dcoHighUnit = 3.29 * dcoScale;

  const mcoScale =
    DEFAULT_EARNINGS_RATES.mcoUsd > 0
      ? cfg.rates.mcoUsd / DEFAULT_EARNINGS_RATES.mcoUsd
      : 1;
  const mcoLowUnit = 4.99 * mcoScale;
  const mcoHighUnit = 5.99 * mcoScale;

  const passScale =
    DEFAULT_EARNINGS_RATES.passPlusUsd > 0
      ? cfg.rates.passPlusUsd / DEFAULT_EARNINGS_RATES.passPlusUsd
      : 1;
  const passLowUnit = 3.75 * passScale; // 24-member All-Pass+ per-member rate
  const passHighUnit = 4.89 * passScale; // 1-member Pass+ rate

  const physScale =
    DEFAULT_EARNINGS_RATES.physicalNetUsd > 0
      ? cfg.rates.physicalNetUsd / DEFAULT_EARNINGS_RATES.physicalNetUsd
      : 1;
  const physLowUnit = 0.75 * physScale;
  const physHighUnit = 2.5 * physScale;

  const memberSplitRate = cfg.memberSplitPct / 100;
  const appFeeRate = cfg.appStoreFeePct / 100;
  const webFeeRate = cfg.webPaymentFeePct / 100;

  // Prepare per-member accumulators
  const memberAccMap = new Map<
    string,
    {
      member: EarningsMemberInfo;
      rawFcoMints: number;
      estSpinFcoMints: number;
      paidFcoMints: number;
      paidDcoMints: number;
      paidMcoMints: number;
      paidUnitMints: number;
      passPlusMints: number;
      physicalMints: number;
      freeExcludedMints: number;
      fcoGrossUsd: number;
      dcoGrossUsd: number;
      mcoGrossUsd: number;
      unitGrossUsd: number;
      passPlusGrossUsd: number;
      physicalGrossUsd: number;
      totalGrossUsd: number;
      lowGrossUsd: number;
      highGrossUsd: number;
      platformFeesUsd: number;
      netRevenueUsd: number;
      memberEarningsUsd: number;
      memberEarningsLowUsd: number;
      memberEarningsHighUsd: number;
      modhausEarningsUsd: number;
      bySeason: MemberSeasonEarningsDetail[];
    }
  >();

  for (const m of params.members) {
    memberAccMap.set(m.id, {
      member: m,
      rawFcoMints: 0,
      estSpinFcoMints: 0,
      paidFcoMints: 0,
      paidDcoMints: 0,
      paidMcoMints: 0,
      paidUnitMints: 0,
      passPlusMints: 0,
      physicalMints: 0,
      freeExcludedMints: 0,
      fcoGrossUsd: 0,
      dcoGrossUsd: 0,
      mcoGrossUsd: 0,
      unitGrossUsd: 0,
      passPlusGrossUsd: 0,
      physicalGrossUsd: 0,
      totalGrossUsd: 0,
      lowGrossUsd: 0,
      highGrossUsd: 0,
      platformFeesUsd: 0,
      netRevenueUsd: 0,
      memberEarningsUsd: 0,
      memberEarningsLowUsd: 0,
      memberEarningsHighUsd: 0,
      modhausEarningsUsd: 0,
      bySeason: [],
    });
  }

  const seasonSummaries: SeasonEarningsSummary[] = [];
  let earliestMintAt: string | null = null;
  let latestMintAt: string | null = null;
  let hasPartialCoverageSeason = false;

  for (const { input: sInput, info: sInfo } of seasonMetaList) {
    const isSelected = selectedSeasonSet.has(sInput.season);
    const effectiveWebPct = clamp(
      cfg.webShopSharePct * sInfo.webShopShareFactor,
      0,
      100,
    );
    const digitalFeeRate =
      (effectiveWebPct / 100) * webFeeRate +
      ((100 - effectiveWebPct) / 100) * appFeeRate;

    // Spin FCO replacements are drawn uniformly across participating members in the same season
    const fcoMembersInSeason = Math.max(
      1,
      sInput.fcoMemberCount || params.members.length,
    );
    const seasonEstSpinFco = Math.round(
      sInput.allClassSpins * sInfo.spinFcoReturnRate,
    );
    const spinPerMember = seasonEstSpinFco / fcoMembersInSeason;

    let sRawFco = 0;
    let sPaidFco = 0;
    let sPaidDco = 0;
    let sPaidMco = 0;
    let sPassPlus = 0;
    let sPhysical = 0;
    let sFree = 0;
    let sGross = 0;
    let sNet = 0;
    let sMemberEarn = 0;

    if (isSelected) {
      if (sInfo.coverage !== "full") hasPartialCoverageSeason = true;
      if (sInput.firstMintAt && (!earliestMintAt || sInput.firstMintAt < earliestMintAt)) {
        earliestMintAt = sInput.firstMintAt;
      }
      if (sInput.lastMintAt && (!latestMintAt || sInput.lastMintAt > latestMintAt)) {
        latestMintAt = sInput.lastMintAt;
      }
    }

    for (const m of params.members) {
      const r = rowBySeasonMember.get(`${sInput.season}|${m.id}`);
      if (!r) continue;

      const rawFco = Math.max(0, r.rawFcoMints);
      const spinDeduct =
        cfg.deductSpinMints && rawFco > 0
          ? Math.min(rawFco, Math.round(spinPerMember))
          : 0;
      const paidFco = Math.max(0, rawFco - spinDeduct);
      const paidDco = Math.max(0, r.paidDcoMints);
      const paidMco = Math.max(0, r.paidMcoMints);
      const paidUnit = Math.max(0, r.paidUnitMints);
      const passPlus = Math.max(0, r.passPlusMints);
      const physical = Math.max(0, r.physicalMints);
      const freeExcl = Math.max(0, r.freeExcludedMints);

      const fcoGross = paidFco * cfg.rates.fcoUsd;
      const dcoGross = paidDco * cfg.rates.dcoUsd;
      const mcoGross = paidMco * cfg.rates.mcoUsd;
      const unitGross = paidUnit * cfg.rates.unitUsd;
      const digitalObjektGross = fcoGross + dcoGross + mcoGross + unitGross;

      const passGross = cfg.includePassPlus ? passPlus * cfg.rates.passPlusUsd : 0;
      const physGross = cfg.includePhysicalScans
        ? physical * cfg.rates.physicalNetUsd
        : 0;
      const totalGross = digitalObjektGross + passGross + physGross;

      const lowDigitalGross =
        paidFco * fcoLowUnit +
        paidDco * dcoLowUnit +
        paidMco * mcoLowUnit +
        paidUnit * Math.min(cfg.rates.unitUsd, 2.49);
      const highDigitalGross =
        paidFco * fcoHighUnit +
        paidDco * dcoHighUnit +
        paidMco * mcoHighUnit +
        paidUnit * Math.max(cfg.rates.unitUsd, 3.29);

      const lowPassGross = cfg.includePassPlus ? passPlus * passLowUnit : 0;
      const highPassGross = cfg.includePassPlus ? passPlus * passHighUnit : 0;
      const lowPhysGross = cfg.includePhysicalScans ? physical * physLowUnit : 0;
      const highPhysGross = cfg.includePhysicalScans ? physical * physHighUnit : 0;

      const lowGross = lowDigitalGross + lowPassGross + lowPhysGross;
      const highGross = highDigitalGross + highPassGross + highPhysGross;

      // Digital Objekts incur Web/App blended store fees; COSMO Talk Pass+ is mobile IAP;
      // Physical QR net attribution already nets out manufacturing/retail distributor cuts.
      const fees = digitalObjektGross * digitalFeeRate + passGross * appFeeRate;
      const lowFees = lowDigitalGross * digitalFeeRate + lowPassGross * appFeeRate;
      const highFees = highDigitalGross * digitalFeeRate + highPassGross * appFeeRate;

      const net = Math.max(0, totalGross - fees);
      const lowNet = Math.max(0, lowGross - lowFees);
      const highNet = Math.max(0, highGross - highFees);

      const memberEarn = net * memberSplitRate;
      const memberEarnLow = lowNet * memberSplitRate;
      const memberEarnHigh = highNet * memberSplitRate;
      const modhausEarn = net - memberEarn;

      sRawFco += rawFco;
      sPaidFco += paidFco;
      sPaidDco += paidDco;
      sPaidMco += paidMco;
      sPassPlus += passPlus;
      sPhysical += physical;
      sFree += freeExcl;
      sGross += totalGross;
      sNet += net;
      sMemberEarn += memberEarn;

      if (isSelected) {
        const acc = memberAccMap.get(m.id)!;
        acc.rawFcoMints += rawFco;
        acc.estSpinFcoMints += spinDeduct;
        acc.paidFcoMints += paidFco;
        acc.paidDcoMints += paidDco;
        acc.paidMcoMints += paidMco;
        acc.paidUnitMints += paidUnit;
        acc.passPlusMints += passPlus;
        acc.physicalMints += physical;
        acc.freeExcludedMints += freeExcl;
        acc.fcoGrossUsd += fcoGross;
        acc.dcoGrossUsd += dcoGross;
        acc.mcoGrossUsd += mcoGross;
        acc.unitGrossUsd += unitGross;
        acc.passPlusGrossUsd += passGross;
        acc.physicalGrossUsd += physGross;
        acc.totalGrossUsd += totalGross;
        acc.lowGrossUsd += lowGross;
        acc.highGrossUsd += highGross;
        acc.platformFeesUsd += fees;
        acc.netRevenueUsd += net;
        acc.memberEarningsUsd += memberEarn;
        acc.memberEarningsLowUsd += memberEarnLow;
        acc.memberEarningsHighUsd += memberEarnHigh;
        acc.modhausEarningsUsd += modhausEarn;
        acc.bySeason.push({
          season: sInput.season,
          coverage: sInfo.coverage,
          rawFcoMints: rawFco,
          estSpinFcoMints: spinDeduct,
          paidFcoMints: paidFco,
          paidDcoMints: paidDco,
          paidMcoMints: paidMco,
          paidUnitMints: paidUnit,
          passPlusMints: passPlus,
          physicalMints: physical,
          freeExcludedMints: freeExcl,
          totalGrossUsd: round2(totalGross),
          netRevenueUsd: round2(net),
          memberEarningsUsd: round2(memberEarn),
        });
      }
    }

    seasonSummaries.push({
      ...sInfo,
      firstMintAt: sInput.firstMintAt,
      lastMintAt: sInput.lastMintAt,
      allClassSpins: sInput.allClassSpins,
      estSpinFcoMints: cfg.deductSpinMints ? seasonEstSpinFco : 0,
      spinFcoPerMember: cfg.deductSpinMints ? Math.round(spinPerMember) : 0,
      fcoMemberCount: fcoMembersInSeason,
      rawFcoMints: sRawFco,
      paidFcoMints: sPaidFco,
      paidDcoMints: sPaidDco,
      paidMcoMints: sPaidMco,
      passPlusMints: sPassPlus,
      physicalMints: sPhysical,
      freeExcludedMints: sFree,
      totalGrossUsd: round2(sGross),
      netRevenueUsd: round2(sNet),
      memberEarningsUsd: round2(sMemberEarn),
    });
  }

  // Span days for optional annualization (only shown when all selected seasons have full coverage & span >= 60 days)
  let spanDays: number | null = null;
  if (earliestMintAt && latestMintAt) {
    const ms = Date.parse(latestMintAt) - Date.parse(earliestMintAt);
    if (!Number.isNaN(ms) && ms > 0) {
      spanDays = Math.max(1, Math.round(ms / 86_400_000));
    }
  }
  const canAnnualize =
    !hasPartialCoverageSeason && spanDays !== null && spanDays >= 60;

  // Build ranked member rows
  const rawList = Array.from(memberAccMap.values());
  const totalGroupGross = rawList.reduce((s, r) => s + r.totalGrossUsd, 0);
  const totalGroupMemberEarnings = rawList.reduce(
    (s, r) => s + r.memberEarningsUsd,
    0,
  );
  const activeCount = Math.max(
    1,
    rawList.filter((r) => r.totalGrossUsd > 0).length || rawList.length,
  );
  const avgMemberEarnings = totalGroupMemberEarnings / activeCount;

  const sortedByEarnings = [...rawList].sort(
    (a, b) =>
      b.memberEarningsUsd - a.memberEarningsUsd ||
      b.totalGrossUsd - a.totalGrossUsd ||
      a.member.memberOrder - b.member.memberOrder,
  );

  const memberRows: MemberEarningsRow[] = sortedByEarnings.map((acc, idx) => {
    const totalPaidObjekts =
      acc.paidFcoMints +
      acc.paidDcoMints +
      acc.paidMcoMints +
      acc.paidUnitMints +
      (cfg.includePassPlus ? acc.passPlusMints : 0) +
      (cfg.includePhysicalScans ? acc.physicalMints : 0);

    return {
      member: acc.member,
      rank: idx + 1,
      rawFcoMints: acc.rawFcoMints,
      estSpinFcoMints: acc.estSpinFcoMints,
      paidFcoMints: acc.paidFcoMints,
      paidDcoMints: acc.paidDcoMints,
      paidMcoMints: acc.paidMcoMints,
      paidUnitMints: acc.paidUnitMints,
      passPlusMints: acc.passPlusMints,
      physicalMints: acc.physicalMints,
      freeExcludedMints: acc.freeExcludedMints,
      totalPaidObjekts,

      fcoGrossUsd: round2(acc.fcoGrossUsd),
      dcoGrossUsd: round2(acc.dcoGrossUsd),
      mcoGrossUsd: round2(acc.mcoGrossUsd),
      unitGrossUsd: round2(acc.unitGrossUsd),
      passPlusGrossUsd: round2(acc.passPlusGrossUsd),
      physicalGrossUsd: round2(acc.physicalGrossUsd),
      totalGrossUsd: round2(acc.totalGrossUsd),
      lowGrossUsd: round2(acc.lowGrossUsd),
      highGrossUsd: round2(acc.highGrossUsd),

      platformFeesUsd: round2(acc.platformFeesUsd),
      effectiveFeePct:
        acc.totalGrossUsd > 0
          ? round2((acc.platformFeesUsd / acc.totalGrossUsd) * 100)
          : 0,
      netRevenueUsd: round2(acc.netRevenueUsd),
      memberEarningsUsd: round2(acc.memberEarningsUsd),
      memberEarningsLowUsd: round2(acc.memberEarningsLowUsd),
      memberEarningsHighUsd: round2(acc.memberEarningsHighUsd),
      modhausEarningsUsd: round2(acc.modhausEarningsUsd),
      annualizedMemberEarningsUsd:
        canAnnualize && spanDays
          ? round2((acc.memberEarningsUsd / spanDays) * 365)
          : null,

      shareOfGroupPct:
        totalGroupGross > 0
          ? round2((acc.totalGrossUsd / totalGroupGross) * 100)
          : 0,
      relativeToAvg:
        avgMemberEarnings > 0
          ? Math.round((acc.memberEarningsUsd / avgMemberEarnings) * 100) / 100
          : 1,
      bySeason: acc.bySeason,
    };
  });

  // Median member earnings
  const earningsVals = memberRows
    .map((m) => m.memberEarningsUsd)
    .sort((a, b) => a - b);
  const mid = Math.floor(earningsVals.length / 2);
  const medianMemberEarningsUsd =
    earningsVals.length === 0
      ? 0
      : earningsVals.length % 2 === 1
        ? earningsVals[mid]!
        : round2((earningsVals[mid - 1]! + earningsVals[mid]!) / 2);

  const totalPlatformFees = rawList.reduce((s, r) => s + r.platformFeesUsd, 0);
  const totalNet = rawList.reduce((s, r) => s + r.netRevenueUsd, 0);

  return {
    selectedSeasons: Array.from(selectedSeasonSet),
    hasPartialCoverageSeason,
    spanDays,
    earliestMintAt,
    latestMintAt,
    totals: {
      rawFcoMints: rawList.reduce((s, r) => s + r.rawFcoMints, 0),
      estSpinFcoMints: rawList.reduce((s, r) => s + r.estSpinFcoMints, 0),
      paidFcoMints: rawList.reduce((s, r) => s + r.paidFcoMints, 0),
      paidDcoMints: rawList.reduce((s, r) => s + r.paidDcoMints, 0),
      paidMcoMints: rawList.reduce((s, r) => s + r.paidMcoMints, 0),
      paidUnitMints: rawList.reduce((s, r) => s + r.paidUnitMints, 0),
      passPlusMints: rawList.reduce((s, r) => s + r.passPlusMints, 0),
      physicalMints: rawList.reduce((s, r) => s + r.physicalMints, 0),
      freeExcludedMints: rawList.reduce((s, r) => s + r.freeExcludedMints, 0),
      totalPaidObjekts: memberRows.reduce((s, r) => s + r.totalPaidObjekts, 0),

      fcoGrossUsd: round2(rawList.reduce((s, r) => s + r.fcoGrossUsd, 0)),
      dcoGrossUsd: round2(rawList.reduce((s, r) => s + r.dcoGrossUsd, 0)),
      mcoGrossUsd: round2(rawList.reduce((s, r) => s + r.mcoGrossUsd, 0)),
      unitGrossUsd: round2(rawList.reduce((s, r) => s + r.unitGrossUsd, 0)),
      passPlusGrossUsd: round2(rawList.reduce((s, r) => s + r.passPlusGrossUsd, 0)),
      physicalGrossUsd: round2(rawList.reduce((s, r) => s + r.physicalGrossUsd, 0)),
      totalGrossUsd: round2(totalGroupGross),
      lowGrossUsd: round2(rawList.reduce((s, r) => s + r.lowGrossUsd, 0)),
      highGrossUsd: round2(rawList.reduce((s, r) => s + r.highGrossUsd, 0)),

      platformFeesUsd: round2(totalPlatformFees),
      effectiveFeePct:
        totalGroupGross > 0
          ? round2((totalPlatformFees / totalGroupGross) * 100)
          : 0,
      netRevenueUsd: round2(totalNet),
      totalMemberEarningsUsd: round2(totalGroupMemberEarnings),
      totalMemberEarningsLowUsd: round2(
        rawList.reduce((s, r) => s + r.memberEarningsLowUsd, 0),
      ),
      totalMemberEarningsHighUsd: round2(
        rawList.reduce((s, r) => s + r.memberEarningsHighUsd, 0),
      ),
      totalModhausEarningsUsd: round2(
        rawList.reduce((s, r) => s + r.modhausEarningsUsd, 0),
      ),
      avgMemberEarningsUsd: round2(avgMemberEarnings),
      medianMemberEarningsUsd,
    },
    seasons: seasonSummaries,
    members: memberRows,
  };
}
