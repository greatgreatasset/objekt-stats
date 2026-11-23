import { classifyGridRewardSco, type GridEditionId } from "./grids.js";
import {
  COSMO_SPIN_ADDRESS,
  DEAD_ADDRESS,
  ZERO_ADDRESS,
  detectTradesFromTransfers,
  isEligibleP2PTransfer,
  shortenAddress,
  type P2PTransferEvent,
} from "./trades.js";

export const ABSTRACT_FIRST_NATIVE_TOKEN_ID = 9_419_276;
export const WEB_SHOP_LAUNCH_ISO = "2024-09-01T00:00:00Z";
export const COSMO_TALK_PAID_LAUNCH_ISO = "2026-08-01T00:00:00Z";
export const ABSTRACT_MIGRATION_DATE = "2025-04-18";
export const DEFAULT_SPIN_PAIR_MAX_SECONDS = 180;

export interface CuratedTalkPassCollection {
  artistId: string;
  season: string;
  collectionNo: string;
  billingMonth: string; // e.g. "2026-08"
  label: string; // e.g. "Aug 2026 tripleS Pass+"
}

/**
 * Verified COSMO Talk / Pass+ monthly subscriber-exclusive Double Class Objekt
 * collections (distributed on the 15th of the following month starting at 17:00 KST).
 * Enables exact tier deduction for 1, 2, 4, 8, and All-Member (24) Pass+ plans.
 */
export const KNOWN_COSMO_TALK_PASS_COLLECTIONS: readonly CuratedTalkPassCollection[] =
  [
    {
      artistId: "triples",
      season: "Cream02",
      collectionNo: "358Z",
      billingMonth: "2026-08",
      label: "Aug 2026 tripleS Pass+",
    },
    {
      artistId: "triples",
      season: "Cream02",
      collectionNo: "362Z",
      billingMonth: "2026-09",
      label: "Sep 2026 tripleS Pass+",
    },
    {
      artistId: "triples",
      season: "Cream02",
      collectionNo: "376Z",
      billingMonth: "2026-10",
      label: "Oct 2026 tripleS Pass+",
    },
  ];

const KNOWN_TALK_PASS_BY_KEY = new Map<string, CuratedTalkPassCollection>(
  KNOWN_COSMO_TALK_PASS_COLLECTIONS.map((c) => [
    `${c.artistId.toLowerCase()}|${c.season.toLowerCase()}|${c.collectionNo.toUpperCase()}`,
    c,
  ]),
);

export type ChainId = "polygon" | "abstract";

export interface WalletTransferLog {
  chain: ChainId;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: string; // ISO UTC
  from: string;
  to: string;
  tokenId: number;
}

export interface WalletTokenMetadata {
  tokenId: number;
  slug: string;
  collectionId: string;
  artistId: string; // "triples" | "artms" | "idntt" | ...
  rawArtist: string;
  memberName: string;
  season: string;
  objektClass: string; // "First" | "Double" | "Special" | "Premier" | "Motion" | "Unit" | "Welcome" | "Zero" | ...
  collectionNo: string; // e.g. "101Z", "301A"
  onOffline: "online" | "offline";
  imageUrl: string | null;
  backgroundColor: string | null;
}

export type PricingPresetId = "blended" | "web_shop" | "app_store" | "custom";

export interface PricingRates {
  // COSMO Mobile App (iOS/Android IAP; also used for all pre-Sep 2024 digital mints)
  appFcoSingle: number;
  appFcoPack4: number;
  appFcoPack8Plus: number;
  appDcoOnline: number;
  appMcoOnline: number;
  appUnitOnline: number;

  // COSMO Web Shop (shop.cosmo.fans, launched Sep 2024 — avoids 30% app store fee + bulk tiers)
  webFcoSingle: number;
  webFcoPack4: number;
  webFcoPack8: number;
  webFcoPack12: number;
  webFcoPack24: number;
  webDcoOnline: number;
  webMcoOnline: number;
  webUnitOnline: number;

  // Physical QR-scanned Objekts (A-suffix)
  physicalFco: number;
  physicalDcoOma: number;
  physicalOther: number;

  // COSMO Talk / Pass+ monthly subscription tiers (deduced from Pass+ DCO mints)
  passPlus1: number;
  passPlus2: number;
  passPlus4: number;
  passPlus8: number;
  passPlusAll24: number;
  passPlusArtmsAll5: number;

  // Optional 1-way P2P OTC purchase estimate
  otcP2pReceived: number;
}

export interface PricingConfig {
  preset: PricingPresetId;
  includeSubscriptions: boolean;
  includePhysicalScans: boolean;
  includeOtcP2pReceived: boolean;
  includeUnverifiedMigrations: boolean;
  rates: PricingRates;
}

export const DEFAULT_PRICING_RATES: PricingRates = {
  appFcoSingle: 3.29,
  appFcoPack4: 3.12, // $12.49 / 4-pack
  appFcoPack8Plus: 2.99,
  appDcoOnline: 3.29,
  appMcoOnline: 5.99, // Motion Class (3 COMO animated video)
  appUnitOnline: 3.29,

  webFcoSingle: 2.99,
  webFcoPack4: 2.49,
  webFcoPack8: 2.25,
  webFcoPack12: 1.99,
  webFcoPack24: 1.88, // $44.99 / 24-pack on shop.cosmo.fans
  webDcoOnline: 2.99,
  webMcoOnline: 4.99,
  webUnitOnline: 2.99,

  physicalFco: 4.0, // Standalone physical FCO pack
  physicalDcoOma: 5.5, // OMA / physical album inclusion estimate
  physicalOther: 5.5, // Physical SCO / Unit / event merch QR

  passPlus1: 4.89, // 1-Member Pass+ ($4.89 US App Store / ₩6,900 KR = $4.89/member)
  passPlus2: 9.19, // 2-Member Pass+ (₩12,900 KR ≈ $9.19 = $4.60/member, -6% vs 1-Member)
  passPlus4: 17.49, // 4-Member Pass+ (₩24,900 KR ≈ $17.49 = $4.37/member, -11% vs 1-Member)
  passPlus8: 32.99, // 8-Member Pass+ (₩46,900 KR ≈ $32.99 = $4.12/member, -16% vs 1-Member)
  passPlusAll24: 90.0, // tripleS All-Member Pass+ ($90.00 US Google Play pre-tax = $3.75/member, -23% vs 1-Member; ~$98.78 post-tax)
  passPlusArtmsAll5: 19.99, // ARTMS All-Member Pass+ (5 members = $4.00/member, -18% vs 1-Member)

  otcP2pReceived: 2.5,
};

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  preset: "blended",
  includeSubscriptions: true,
  includePhysicalScans: true,
  includeOtcP2pReceived: false,
  includeUnverifiedMigrations: false,
  rates: { ...DEFAULT_PRICING_RATES },
};

export type ActivityCategory =
  | "shop_mint"
  | "cosmo_talk_pass"
  | "physical_scan"
  | "free_reward"
  | "spin"
  | "trade_swap"
  | "p2p_received"
  | "p2p_sent"
  | "burn"
  | "migration_bridge";

export interface ActivityTokenItem {
  tokenId: number;
  slug: string | null;
  collectionId: string;
  artistId: string;
  memberName: string;
  season: string;
  objektClass: string;
  collectionNo: string;
  onOffline: "online" | "offline";
  imageUrl: string | null;
  backgroundColor: string | null;
  estimatedUsd: number;
  lowUsd: number;
  highUsd: number;
  pricingBasis: string;
  isResolved: boolean;
}

export interface WalletActivityItem {
  id: string;
  category: ActivityCategory;
  chain: ChainId;
  timestamp: string;
  blockNumber: number;
  txHash: string;
  title: string;
  subtitle: string;
  count: number;
  cashCostUsd: number;
  lowUsd: number;
  highUsd: number;
  pricingBasis: string;
  items: ActivityTokenItem[];
  // For confirmed reciprocal trades or spins
  counterparty?: string;
  counterpartyShort?: string;
  durationSeconds?: number;
  gaveItems?: ActivityTokenItem[];
  receivedItems?: ActivityTokenItem[];
  retailValueGaveUsd?: number;
  retailValueReceivedUsd?: number;
  // For COSMO Grid completion rewards (201Z-206Z / idntt 301Z-302Z)
  isGridReward?: boolean;
  gridEditionLabel?: string;
  gridFcosLocked?: number;
}

export interface MonthlySpendPoint {
  month: string; // YYYY-MM
  digitalUsd: number;
  subscriptionsUsd: number;
  physicalUsd: number;
  otcUsd: number;
  totalUsd: number;
  paidMintCount: number;
  subscriptionCount: number;
  physicalScanCount: number;
  tradeCount: number;
  spinCount: number;
  gridsCompleted: number;
}

export interface ClassBreakdownRow {
  key: string;
  label: string;
  objektClass: string;
  onOffline: "online" | "offline";
  paidCount: number;
  freeOrSpinCount: number;
  totalAcquired: number;
  estimatedUsd: number;
  lowUsd: number;
  highUsd: number;
}

export interface MemberSpendRow {
  artistId: string;
  memberName: string;
  paidMintCount: number;
  subscriptionCount: number;
  physicalScanCount: number;
  freeRewardCount: number;
  gridsCompleted: number;
  tradedInCount: number;
  p2pInCount: number;
  currentlyHeldCount: number;
  estimatedUsd: number;
}

export interface ArtistSpendRow {
  artistId: string;
  label: string;
  paidMintCount: number;
  subscriptionCount: number;
  physicalScanCount: number;
  gridsCompleted: number;
  totalAcquired: number;
  currentlyHeldCount: number;
  estimatedUsd: number;
}

export interface CompletedGridGroup {
  key: string;
  artistId: string;
  artistLabel: string;
  season: string;
  editionId: GridEditionId;
  editionLabel: string;
  shortLabel: string;
  gridSize: 4 | 8;
  gridsCompleted: number;
  fcosLocked: number;
  uniqueMembers: number;
  latestCompletedAt: string;
}

export interface DetectedSubscriptionMonth {
  id: string;
  artistId: string;
  season: string;
  collectionNo: string;
  billingLabel: string;
  claimedAt: string;
  tierLabel: string;
  memberCount: number;
  estimatedUsd: number;
  perMemberUsd: number;
  lowUsd: number;
  highUsd: number;
  isInferred: boolean;
}

export interface WalletCostSummary {
  estimatedTotalUsd: number;
  lowEstimateUsd: number;
  highEstimateUsd: number;
  digitalShopUsd: number;
  digitalShopLowUsd: number;
  digitalShopHighUsd: number;
  subscriptionsUsd: number;
  subscriptionsLowUsd: number;
  subscriptionsHighUsd: number;
  physicalScansUsd: number;
  physicalScansLowUsd: number;
  physicalScansHighUsd: number;
  otcP2pUsd: number;
  unverifiedMigrationUsd: number;

  currentlyHeld: number;
  totalTransactions: number;
  paidDigitalMints: number;
  paidMintTransactions: number;
  subscriptionMonths: number;
  subscriptionObjekts: number;
  detectedSubscriptionTier: string | null;
  physicalScans: number;
  freeRewards: number;
  gridsCompleted: number;
  gridsCompletedAbstract: number;
  gridsCompletedPolygon: number;
  migratedGridScosCount: number;
  gridFcosLocked: number;
  gridsEd1Count: number;
  gridsEd2Count: number;
  gridsEd3Count: number;
  heldScoCount: number;
  spinsSent: number;
  spinsReceived: number;
  confirmedTradeSwaps: number;
  tradedOutCount: number;
  tradedInCount: number;
  p2pReceivedCount: number;
  p2pSentCount: number;
  burnedCount: number;
  migratedCount: number;
  unresolvedTokenCount: number;

  polygonLogCount: number;
  abstractLogCount: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
}

export interface WalletCostAnalysis {
  summary: WalletCostSummary;
  subscriptions: DetectedSubscriptionMonth[];
  gridBreakdown: CompletedGridGroup[];
  monthlyTimeline: MonthlySpendPoint[];
  classBreakdown: ClassBreakdownRow[];
  memberBreakdown: MemberSpendRow[];
  artistBreakdown: ArtistSpendRow[];
  activities: WalletActivityItem[];
}

export interface AnalyzeWalletCostInput {
  userAddresses: readonly string[];
  logs: readonly WalletTransferLog[];
  metadataByTokenId: ReadonlyMap<number, WalletTokenMetadata>;
  polygonLoaded: boolean;
  config?: Partial<PricingConfig>;
  curatedPriceBySlug?: ReadonlyMap<string, number>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatUsdInline(n: number): string {
  return `$${n.toFixed(2)}`;
}

function isFreeClass(meta: WalletTokenMetadata): {
  isFree: boolean;
  reason: string;
} {
  const cls = meta.objektClass.toLowerCase();
  const colNo = meta.collectionNo.toUpperCase();
  if (cls === "welcome" || colNo === "100Z") {
    return { isFree: true, reason: "Free Welcome Objekt (100Z)" };
  }
  if (cls === "zero") {
    return { isFree: true, reason: "Free Zero Class Event Reward" };
  }
  if (cls === "special" && meta.onOffline === "online") {
    return { isFree: true, reason: "Free Grid Completion Reward (SCO)" };
  }
  if (cls === "premier" && meta.onOffline === "online") {
    return { isFree: true, reason: "Premier Class Reward (PCO)" };
  }
  return { isFree: false, reason: "" };
}

function getWebFcoTierPrice(batchSize: number, rates: PricingRates): {
  price: number;
  tierLabel: string;
} {
  if (batchSize >= 20) return { price: rates.webFcoPack24, tierLabel: "24-pack tier" };
  if (batchSize >= 10) return { price: rates.webFcoPack12, tierLabel: "12-pack tier" };
  if (batchSize >= 6) return { price: rates.webFcoPack8, tierLabel: "8-pack tier" };
  if (batchSize >= 3) return { price: rates.webFcoPack4, tierLabel: "4-pack tier" };
  return { price: rates.webFcoSingle, tierLabel: "single" };
}

function getAppFcoTierPrice(batchSize: number, rates: PricingRates): {
  price: number;
  tierLabel: string;
} {
  if (batchSize >= 8) return { price: rates.appFcoPack8Plus, tierLabel: "multi-pack" };
  if (batchSize >= 3) return { price: rates.appFcoPack4, tierLabel: "4-pack" };
  return { price: rates.appFcoSingle, tierLabel: "single" };
}

export function estimateMintUnitPrice(
  meta: WalletTokenMetadata | null,
  mintedAtIso: string,
  txBatchSize: number,
  config: PricingConfig,
  curatedPrice?: number,
): {
  category: "shop_mint" | "physical_scan" | "free_reward";
  usd: number;
  lowUsd: number;
  highUsd: number;
  basis: string;
} {
  const { rates, preset } = config;

  if (!meta) {
    // Provisional estimate while metadata is still resolving
    const isPreWebShop = mintedAtIso < WEB_SHOP_LAUNCH_ISO;
    const low = isPreWebShop ? rates.appFcoPack8Plus : rates.webFcoSingle;
    const high = rates.appFcoSingle;
    const usd =
      preset === "app_store"
        ? high
        : preset === "web_shop" && !isPreWebShop
          ? low
          : round2((low + high) / 2);
    return {
      category: "shop_mint",
      usd,
      lowUsd: low,
      highUsd: high,
      basis: "Provisional (resolving metadata)",
    };
  }

  const freeCheck = isFreeClass(meta);
  if (freeCheck.isFree) {
    return {
      category: "free_reward",
      usd: 0,
      lowUsd: 0,
      highUsd: 0,
      basis: freeCheck.reason,
    };
  }

  if (meta.onOffline === "offline") {
    const cls = meta.objektClass.toLowerCase();
    const base =
      cls === "first"
        ? rates.physicalFco
        : cls === "double"
          ? rates.physicalDcoOma
          : rates.physicalOther;
    const label =
      cls === "first"
        ? "Physical FCO QR pack est."
        : cls === "double"
          ? "Physical DCO / OMA album est."
          : `Physical ${meta.objektClass} QR est.`;
    return {
      category: "physical_scan",
      usd: round2(base),
      lowUsd: round2(base * 0.8),
      highUsd: round2(base * 1.45),
      basis: label,
    };
  }

  // Online paid digital Objekt
  const cls = meta.objektClass.toLowerCase();
  const isPreWebShop = mintedAtIso < WEB_SHOP_LAUNCH_ISO;

  // Curated exact round price override if explicitly set to 0 (known free event drop)
  if (curatedPrice === 0) {
    return {
      category: "free_reward",
      usd: 0,
      lowUsd: 0,
      highUsd: 0,
      basis: "Curated free digital event drop",
    };
  }

  let appPrice: number;
  let webPrice: number;
  let tierHint: string;

  if (cls === "motion") {
    appPrice = rates.appMcoOnline;
    webPrice = rates.webMcoOnline;
    tierHint = "Motion Class";
  } else if (cls === "double") {
    appPrice = rates.appDcoOnline;
    webPrice =
      txBatchSize >= 4
        ? Math.min(rates.webDcoOnline, getWebFcoTierPrice(txBatchSize, rates).price)
        : rates.webDcoOnline;
    tierHint = txBatchSize >= 4 ? `DCO ${txBatchSize}× bundle` : "Digital DCO";
  } else if (cls === "unit") {
    appPrice = rates.appUnitOnline;
    webPrice = rates.webUnitOnline;
    tierHint = "Digital Unit";
  } else {
    const appTier = getAppFcoTierPrice(txBatchSize, rates);
    const webTier = getWebFcoTierPrice(txBatchSize, rates);
    appPrice = appTier.price;
    webPrice = webTier.price;
    tierHint = webTier.tierLabel;
  }

  if (isPreWebShop && preset !== "custom") {
    // Web shop (shop.cosmo.fans) did not exist before Sep 2024
    const low = round2(Math.min(appPrice, cls === "motion" ? rates.webMcoOnline : 2.99));
    const high = round2(appPrice);
    const usd =
      preset === "app_store"
        ? high
        : round2(txBatchSize >= 4 ? appPrice : (low + high) / 2);
    return {
      category: "shop_mint",
      usd,
      lowUsd: low,
      highUsd: high,
      basis: `Pre-Web Shop App Store (${tierHint})`,
    };
  }

  const low = round2(Math.min(webPrice, appPrice));
  const high = round2(Math.max(webPrice, appPrice));

  let usd: number;
  let basis: string;
  if (preset === "app_store") {
    usd = round2(appPrice);
    basis = `COSMO App Store (${tierHint})`;
  } else if (preset === "web_shop") {
    usd = round2(webPrice);
    basis = `COSMO Web Shop (${tierHint})`;
  } else if (preset === "custom") {
    usd = round2(txBatchSize >= 4 ? webPrice : (webPrice + appPrice) / 2);
    basis = `Custom rate (${tierHint})`;
  } else {
    // Blended: multi-packs (>= 4 in one tx) strongly indicate Web Shop; singles split Web/App
    if (txBatchSize >= 4) {
      usd = round2(webPrice);
      basis = `Web Shop ${tierHint} (${txBatchSize}× tx)`;
    } else {
      usd = round2((webPrice + appPrice) / 2);
      basis = `Blended Web/App (${tierHint})`;
    }
  }

  return {
    category: "shop_mint",
    usd,
    lowUsd: low,
    highUsd: high,
    basis,
  };
}

function estimateRetailReferenceUsd(
  meta: WalletTokenMetadata | null,
  rates: PricingRates,
): number {
  if (!meta) return rates.webFcoSingle;
  if (isFreeClass(meta).isFree) return 0;
  if (meta.onOffline === "offline") {
    return meta.objektClass.toLowerCase() === "first"
      ? rates.physicalFco
      : rates.physicalDcoOma;
  }
  const cls = meta.objektClass.toLowerCase();
  if (cls === "motion") return rates.webMcoOnline;
  if (cls === "double") return rates.webDcoOnline;
  return rates.webFcoSingle;
}

function buildTokenItem(
  tokenId: number,
  meta: WalletTokenMetadata | null,
  estimatedUsd: number,
  lowUsd: number,
  highUsd: number,
  pricingBasis: string,
): ActivityTokenItem {
  return {
    tokenId,
    slug: meta?.slug ?? null,
    collectionId: meta?.collectionId ?? `Objekt #${tokenId}`,
    artistId: meta?.artistId ?? "unknown",
    memberName: meta?.memberName ?? "Resolving...",
    season: meta?.season ?? "",
    objektClass: meta?.objektClass ?? "Unknown",
    collectionNo: meta?.collectionNo ?? "",
    onOffline: meta?.onOffline ?? "online",
    imageUrl: meta?.imageUrl ?? null,
    backgroundColor: meta?.backgroundColor ?? null,
    estimatedUsd: round2(estimatedUsd),
    lowUsd: round2(lowUsd),
    highUsd: round2(highUsd),
    pricingBasis,
    isResolved: meta !== null,
  };
}

function formatArtistLabel(artistId: string): string {
  if (artistId === "triples") return "tripleS";
  if (artistId === "artms") return "ARTMS";
  if (artistId === "idntt") return "idntt";
  return artistId.charAt(0).toUpperCase() + artistId.slice(1);
}

function deduceTalkPassTier(
  artistId: string,
  uniqueMemberCount: number,
  rates: PricingRates,
): {
  tierLabel: string;
  usd: number;
  perMemberUsd: number;
  lowUsd: number;
  highUsd: number;
} {
  const count = Math.max(1, uniqueMemberCount);

  if (artistId === "artms" && count >= 5) {
    const usd = round2(rates.passPlusArtmsAll5);
    return {
      tierLabel: "ARTMS All-Member Pass+ (5)",
      usd,
      perMemberUsd: round2(usd / count),
      lowUsd: round2(Math.min(usd, 16.99)),
      highUsd: round2(Math.max(usd, 22.99)),
    };
  }

  const all24Usd = round2(rates.passPlusAll24);
  const all24Low = round2(Math.min(all24Usd, 79.99));
  const all24High = round2(Math.max(all24Usd, 98.78));

  // Hiatus-safe All-Member (20..24 members)
  if (count >= 20) {
    return {
      tierLabel: "All-Member Pass+ (24)",
      usd: all24Usd,
      perMemberUsd: round2(all24Usd / count),
      lowUsd: all24Low,
      highUsd: all24High,
    };
  }

  // Exact single-tier options (monotonically more economical per member as tier grows)
  const baseTiers: Array<{
    size: number;
    label: string;
    usd: number;
    low: number;
    high: number;
  }> = [
    {
      size: 1,
      label: "1-Member Pass+",
      usd: round2(rates.passPlus1),
      low: round2(Math.min(rates.passPlus1, 3.99)),
      high: round2(Math.max(rates.passPlus1, 5.49)),
    },
    {
      size: 2,
      label: "2-Member Pass+",
      usd: round2(rates.passPlus2),
      low: round2(Math.min(rates.passPlus2, 7.99)),
      high: round2(Math.max(rates.passPlus2, 10.19)),
    },
    {
      size: 4,
      label: "4-Member Pass+",
      usd: round2(rates.passPlus4),
      low: round2(Math.min(rates.passPlus4, 14.99)),
      high: round2(Math.max(rates.passPlus4, 19.49)),
    },
    {
      size: 8,
      label: "8-Member Pass+",
      usd: round2(rates.passPlus8),
      low: round2(Math.min(rates.passPlus8, 29.99)),
      high: round2(Math.max(rates.passPlus8, 36.99)),
    },
  ];

  const exactSingle = baseTiers.find((t) => t.size === count);
  if (exactSingle) {
    return {
      tierLabel: exactSingle.label,
      usd: exactSingle.usd,
      perMemberUsd: round2(exactSingle.usd / count),
      lowUsd: exactSingle.low,
      highUsd: exactSingle.high,
    };
  }

  // Minimum-cost stacked tier combination for intermediate counts (e.g. 3 = 2+1, 6 = 4+2, 12 = 8+4)
  interface DpState {
    usd: number;
    low: number;
    high: number;
    parts: number[];
  }
  const dp: Array<DpState | null> = Array.from({ length: count + 1 }, () => null);
  dp[0] = { usd: 0, low: 0, high: 0, parts: [] };

  for (let n = 1; n <= count; n++) {
    let best: DpState | null = null;
    for (const t of baseTiers) {
      if (t.size <= n && dp[n - t.size]) {
        const prev = dp[n - t.size]!;
        const candUsd = round2(prev.usd + t.usd);
        if (!best || candUsd < best.usd) {
          best = {
            usd: candUsd,
            low: round2(prev.low + t.low),
            high: round2(prev.high + t.high),
            parts: [...prev.parts, t.size],
          };
        }
      }
    }
    dp[n] = best;
  }

  const bestStack = dp[count];
  if (!bestStack || bestStack.usd >= all24Usd) {
    return {
      tierLabel: "All-Member Pass+ (24)",
      usd: all24Usd,
      perMemberUsd: round2(all24Usd / count),
      lowUsd: all24Low,
      highUsd: all24High,
    };
  }

  const sortedParts = [...bestStack.parts].sort((a, b) => b - a);
  return {
    tierLabel: `${count}-Member Pass+ (${sortedParts.join("+")})`,
    usd: bestStack.usd,
    perMemberUsd: round2(bestStack.usd / count),
    lowUsd: bestStack.low,
    highUsd: bestStack.high,
  };
}

/**
 * Full dual-chain (Polygon + Abstract) forensic wallet transaction classifier
 * and historical cost estimator.
 *
 * Guarantees:
 * - Zero double-counting of Polygon -> Abstract migration re-mints (`tokenId < 9,419,276`)
 * - COSMO Spin results (`to === SPIN` followed within 180s by a single online mint) priced at $0
 * - Welcome (100Z), Grid Special Class (2xxZ), Zero, and Premier rewards priced at $0
 * - Reciprocal user-to-user swaps clustered via `detectTradesFromTransfers()` at $0 cash spend
 * - Date-aware pricing (App Store before Sep 2024 Web Shop launch; batch-size aware bulk tiers after)
 */
export function analyzeWalletCost(
  input: AnalyzeWalletCostInput,
): WalletCostAnalysis {
  const config: PricingConfig = {
    ...DEFAULT_PRICING_CONFIG,
    ...input.config,
    rates: {
      ...DEFAULT_PRICING_RATES,
      ...(input.config?.rates ?? {}),
    },
  };

  const userSet = new Set(input.userAddresses.map((a) => a.toLowerCase()));
  const metaMap = input.metadataByTokenId;
  const curatedPrices = input.curatedPriceBySlug ?? new Map<string, number>();

  // 1. Deduplicate and sort chronologically (Polygon era before Abstract era)
  const dedupeKeys = new Set<string>();
  const logs: WalletTransferLog[] = [];
  let polygonLogCount = 0;
  let abstractLogCount = 0;

  for (const raw of input.logs) {
    const from = raw.from.toLowerCase();
    const to = raw.to.toLowerCase();
    if (!userSet.has(from) && !userSet.has(to)) continue;
    // Ignore self-transfers (no net change or cost)
    if (from === to) continue;

    const txHash = raw.txHash.toLowerCase();
    const key = `${raw.chain}:${txHash}:${raw.logIndex}`;
    if (dedupeKeys.has(key)) continue;
    dedupeKeys.add(key);

    if (raw.chain === "polygon") polygonLogCount++;
    else abstractLogCount++;

    logs.push({
      ...raw,
      txHash,
      from,
      to,
    });
  }

  logs.sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) ||
      (a.chain === b.chain ? a.blockNumber - b.blockNumber : a.chain === "polygon" ? -1 : 1) ||
      a.logIndex - b.logIndex,
  );

  // Track unique unresolved tokens
  const allTokenIds = new Set<number>();
  for (const l of logs) allTokenIds.add(l.tokenId);
  let unresolvedTokenCount = 0;
  for (const id of allTokenIds) {
    if (!metaMap.has(id)) unresolvedTokenCount++;
  }

  // 2. Identify migration bridge logs (`chain === "abstract" && from === 0x0 && tokenId < ABSTRACT_FIRST_NATIVE_TOKEN_ID`)
  const migrationKeys = new Set<string>();
  const polygonSeenTokens = new Set<number>();
  for (const l of logs) {
    if (l.chain === "polygon") {
      polygonSeenTokens.add(l.tokenId);
    }
  }

  for (const l of logs) {
    if (
      l.chain === "abstract" &&
      l.from === ZERO_ADDRESS &&
      userSet.has(l.to) &&
      l.tokenId < ABSTRACT_FIRST_NATIVE_TOKEN_ID
    ) {
      migrationKeys.add(`${l.chain}:${l.txHash}:${l.logIndex}`);
    }
  }

  // 3. Track currently held tokens accurately across Polygon -> Abstract
  const heldTokens = new Set<number>();
  for (const l of logs) {
    const key = `${l.chain}:${l.txHash}:${l.logIndex}`;
    if (userSet.has(l.to)) {
      // Migration bridge confirms ownership on Abstract without creating a duplicate tokenId
      heldTokens.add(l.tokenId);
    }
    if (userSet.has(l.from) && !migrationKeys.has(key)) {
      heldTokens.delete(l.tokenId);
    }
  }

  // 4. Count paid-candidate mint batch size per (chain, txHash)
  const mintCountByTx = new Map<string, number>();
  for (const l of logs) {
    const key = `${l.chain}:${l.txHash}:${l.logIndex}`;
    if (l.from === ZERO_ADDRESS && userSet.has(l.to) && !migrationKeys.has(key)) {
      const txKey = `${l.chain}:${l.txHash}`;
      mintCountByTx.set(txKey, (mintCountByTx.get(txKey) ?? 0) + 1);
    }
  }

  // 5. Pair COSMO Spin outflows (`to === SPIN`) with subsequent single-token online mints (`from === 0x0`)
  const spinOutLogs = logs.filter(
    (l) => userSet.has(l.from) && l.to === COSMO_SPIN_ADDRESS,
  );
  const spinInCandidateLogs = logs.filter((l) => {
    const key = `${l.chain}:${l.txHash}:${l.logIndex}`;
    if (l.from !== ZERO_ADDRESS || !userSet.has(l.to) || migrationKeys.has(key)) {
      return false;
    }
    const txBatchSize = mintCountByTx.get(`${l.chain}:${l.txHash}`) ?? 1;
    if (txBatchSize !== 1) return false;
    const meta = metaMap.get(l.tokenId) ?? null;
    if (meta && (meta.onOffline === "offline" || isFreeClass(meta).isFree)) {
      return false;
    }
    return true;
  });

  const spinMintKeyToOutLog = new Map<string, WalletTransferLog>();
  const spinOutKeyToMintLog = new Map<string, WalletTransferLog>();
  const usedSpinMintKeys = new Set<string>();

  for (const outLog of spinOutLogs) {
    const outMs = Date.parse(outLog.timestamp);
    if (Number.isNaN(outMs)) continue;

    let bestMatch: WalletTransferLog | null = null;
    let bestDelta = Infinity;

    for (const cand of spinInCandidateLogs) {
      if (cand.chain !== outLog.chain) continue;
      const candKey = `${cand.chain}:${cand.txHash}:${cand.logIndex}`;
      if (usedSpinMintKeys.has(candKey)) continue;
      if (cand.blockNumber < outLog.blockNumber) continue;

      const candMs = Date.parse(cand.timestamp);
      const deltaSec = (candMs - outMs) / 1000;
      const blockDelta = cand.blockNumber - outLog.blockNumber;

      // Abstract ~1s/block; Polygon ~2.1s/block (allow blockDelta fallback for interpolated Polygon timestamps)
      const withinWindow =
        (deltaSec >= -5 && deltaSec <= DEFAULT_SPIN_PAIR_MAX_SECONDS) ||
        (cand.chain === "polygon" && blockDelta >= 0 && blockDelta <= 120);

      if (withinWindow && Math.abs(deltaSec) < bestDelta) {
        bestDelta = Math.abs(deltaSec);
        bestMatch = cand;
      }
    }

    if (bestMatch) {
      const outKey = `${outLog.chain}:${outLog.txHash}:${outLog.logIndex}`;
      const mintKey = `${bestMatch.chain}:${bestMatch.txHash}:${bestMatch.logIndex}`;
      usedSpinMintKeys.add(mintKey);
      spinMintKeyToOutLog.set(mintKey, outLog);
      spinOutKeyToMintLog.set(outKey, bestMatch);
    }
  }

  // 6. Detect Confirmed Reciprocal P2P Trades via shared @objekt-stats/stats engine
  const p2pEvents: P2PTransferEvent[] = [];
  for (const l of logs) {
    if (isEligibleP2PTransfer(l.from, l.to)) {
      p2pEvents.push({
        txHash: l.txHash,
        logIndex: l.logIndex,
        chain: l.chain,
        blockNumber: l.blockNumber,
        transferredAt: l.timestamp,
        from: l.from,
        to: l.to,
        tokenId: l.tokenId,
      });
    }
  }
  const tradeResult = detectTradesFromTransfers(p2pEvents);

  // Build lookup of traded keys scoped by chain
  const tradedKeysByChain = new Set<string>();
  for (const tr of tradeResult.trades) {
    for (const leg of tr.allLegs) {
      tradedKeysByChain.add(`${tr.chain}:${leg.txHash.toLowerCase()}:${leg.logIndex}`);
    }
  }

  // 7. Build unified activities + aggregate stats
  const activities: WalletActivityItem[] = [];
  const subscriptions: DetectedSubscriptionMonth[] = [];

  let digitalShopUsd = 0;
  let digitalShopLowUsd = 0;
  let digitalShopHighUsd = 0;
  let subscriptionsUsd = 0;
  let subscriptionsLowUsd = 0;
  let subscriptionsHighUsd = 0;
  let physicalScansUsd = 0;
  let physicalScansLowUsd = 0;
  let physicalScansHighUsd = 0;
  let otcP2pUsd = 0;
  let unverifiedMigrationUsd = 0;

  let paidDigitalMints = 0;
  let paidMintTransactions = 0;
  let subscriptionMonths = 0;
  let subscriptionObjekts = 0;
  let physicalScans = 0;
  let freeRewards = 0;
  let gridsCompleted = 0;
  let gridsCompletedAbstract = 0;
  let gridsCompletedPolygon = 0;
  let migratedGridScosCount = 0;
  let gridFcosLocked = 0;
  let gridsEd1Count = 0;
  let gridsEd2Count = 0;
  let gridsEd3Count = 0;
  let heldScoCount = 0;
  let spinsSent = 0;
  let spinsReceived = 0;
  let confirmedTradeSwaps = 0;
  let tradedOutCount = 0;
  let tradedInCount = 0;
  let p2pReceivedCount = 0;
  let p2pSentCount = 0;
  let burnedCount = 0;
  let migratedCount = 0;

  const monthlyMap = new Map<string, MonthlySpendPoint>();
  const classMap = new Map<string, ClassBreakdownRow>();
  const memberMap = new Map<string, MemberSpendRow>();
  const artistMap = new Map<string, ArtistSpendRow>();
  const gridGroupMap = new Map<
    string,
    {
      key: string;
      artistId: string;
      artistLabel: string;
      season: string;
      editionId: GridEditionId;
      editionLabel: string;
      shortLabel: string;
      gridSize: 4 | 8;
      gridsCompleted: number;
      fcosLocked: number;
      members: Set<string>;
      latestCompletedAt: string;
    }
  >();

  const getMonth = (iso: string): MonthlySpendPoint => {
    const month = iso.slice(0, 7);
    let m = monthlyMap.get(month);
    if (!m) {
      m = {
        month,
        digitalUsd: 0,
        subscriptionsUsd: 0,
        physicalUsd: 0,
        otcUsd: 0,
        totalUsd: 0,
        paidMintCount: 0,
        subscriptionCount: 0,
        physicalScanCount: 0,
        tradeCount: 0,
        spinCount: 0,
        gridsCompleted: 0,
      };
      monthlyMap.set(month, m);
    }
    return m;
  };

  const recordClassAndArtist = (
    meta: WalletTokenMetadata | null,
    kind: "paid" | "subscription" | "physical" | "free_or_spin" | "trade_in" | "p2p_in",
    usd: number,
    lowUsd: number,
    highUsd: number,
  ) => {
    const artistId = meta?.artistId ?? "unknown";
    const memberName = meta?.memberName ?? "Unknown";
    const objektClass = meta?.objektClass ?? "Unknown";
    const onOffline = meta?.onOffline ?? "online";

    const cKey =
      kind === "subscription"
        ? "TalkPass|online"
        : `${objektClass}|${onOffline}`;
    let cRow = classMap.get(cKey);
    if (!cRow) {
      cRow = {
        key: cKey,
        label:
          kind === "subscription"
            ? "COSMO Talk Pass+ (Monthly DCO)"
            : onOffline === "offline"
              ? `${objektClass} (Physical A)`
              : `${objektClass} (Digital Z)`,
        objektClass: kind === "subscription" ? "Pass+" : objektClass,
        onOffline,
        paidCount: 0,
        freeOrSpinCount: 0,
        totalAcquired: 0,
        estimatedUsd: 0,
        lowUsd: 0,
        highUsd: 0,
      };
      classMap.set(cKey, cRow);
    }
    cRow.totalAcquired++;
    if (kind === "paid" || kind === "physical" || kind === "subscription") {
      cRow.paidCount++;
      cRow.estimatedUsd = round2(cRow.estimatedUsd + usd);
      cRow.lowUsd = round2(cRow.lowUsd + lowUsd);
      cRow.highUsd = round2(cRow.highUsd + highUsd);
    } else if (kind === "free_or_spin") {
      cRow.freeOrSpinCount++;
    } else if (kind === "p2p_in" && config.includeOtcP2pReceived) {
      cRow.estimatedUsd = round2(cRow.estimatedUsd + usd);
      cRow.lowUsd = round2(cRow.lowUsd + lowUsd);
      cRow.highUsd = round2(cRow.highUsd + highUsd);
    }

    let aRow = artistMap.get(artistId);
    if (!aRow) {
      aRow = {
        artistId,
        label: formatArtistLabel(artistId),
        paidMintCount: 0,
        subscriptionCount: 0,
        physicalScanCount: 0,
        gridsCompleted: 0,
        totalAcquired: 0,
        currentlyHeldCount: 0,
        estimatedUsd: 0,
      };
      artistMap.set(artistId, aRow);
    }
    aRow.totalAcquired++;
    if (kind === "paid") {
      aRow.paidMintCount++;
      aRow.estimatedUsd = round2(aRow.estimatedUsd + usd);
    } else if (kind === "subscription") {
      aRow.subscriptionCount++;
      if (config.includeSubscriptions) {
        aRow.estimatedUsd = round2(aRow.estimatedUsd + usd);
      }
    } else if (kind === "physical") {
      aRow.physicalScanCount++;
      if (config.includePhysicalScans) {
        aRow.estimatedUsd = round2(aRow.estimatedUsd + usd);
      }
    } else if (kind === "p2p_in" && config.includeOtcP2pReceived) {
      aRow.estimatedUsd = round2(aRow.estimatedUsd + usd);
    }

    if (memberName && memberName !== "Unknown") {
      const mKey = `${artistId}|${memberName}`;
      let mRow = memberMap.get(mKey);
      if (!mRow) {
        mRow = {
          artistId,
          memberName,
          paidMintCount: 0,
          subscriptionCount: 0,
          physicalScanCount: 0,
          freeRewardCount: 0,
          gridsCompleted: 0,
          tradedInCount: 0,
          p2pInCount: 0,
          currentlyHeldCount: 0,
          estimatedUsd: 0,
        };
        memberMap.set(mKey, mRow);
      }
      if (kind === "paid") {
        mRow.paidMintCount++;
        mRow.estimatedUsd = round2(mRow.estimatedUsd + usd);
      } else if (kind === "subscription") {
        mRow.subscriptionCount++;
        if (config.includeSubscriptions) {
          mRow.estimatedUsd = round2(mRow.estimatedUsd + usd);
        }
      } else if (kind === "physical") {
        mRow.physicalScanCount++;
        if (config.includePhysicalScans) {
          mRow.estimatedUsd = round2(mRow.estimatedUsd + usd);
        }
      } else if (kind === "free_or_spin") {
        mRow.freeRewardCount++;
      } else if (kind === "trade_in") {
        mRow.tradedInCount++;
      } else if (kind === "p2p_in") {
        mRow.p2pInCount++;
        if (config.includeOtcP2pReceived) {
          mRow.estimatedUsd = round2(mRow.estimatedUsd + usd);
        }
      }
    }
  };

  // Count currently held per member and artist (plus held digital SCOs for monthly COMO)
  for (const tid of heldTokens) {
    const meta = metaMap.get(tid);
    if (!meta) continue;
    if (
      meta.objektClass.toLowerCase() === "special" &&
      meta.onOffline === "online"
    ) {
      heldScoCount++;
    }
    const artistId = meta.artistId;
    let aRow = artistMap.get(artistId);
    if (!aRow) {
      aRow = {
        artistId,
        label: formatArtistLabel(artistId),
        paidMintCount: 0,
        subscriptionCount: 0,
        physicalScanCount: 0,
        gridsCompleted: 0,
        totalAcquired: 0,
        currentlyHeldCount: 0,
        estimatedUsd: 0,
      };
      artistMap.set(artistId, aRow);
    }
    aRow.currentlyHeldCount++;

    if (meta.memberName) {
      const mKey = `${artistId}|${meta.memberName}`;
      let mRow = memberMap.get(mKey);
      if (!mRow) {
        mRow = {
          artistId,
          memberName: meta.memberName,
          paidMintCount: 0,
          subscriptionCount: 0,
          physicalScanCount: 0,
          freeRewardCount: 0,
          gridsCompleted: 0,
          tradedInCount: 0,
          p2pInCount: 0,
          currentlyHeldCount: 0,
          estimatedUsd: 0,
        };
        memberMap.set(mKey, mRow);
      }
      mRow.currentlyHeldCount++;
    }
  }

  // 7a. Emit Confirmed Trade Swaps
  for (const tr of tradeResult.trades) {
    const userIsA = userSet.has(tr.walletA);
    const userIsB = userSet.has(tr.walletB);
    if (!userIsA && !userIsB) continue;

    confirmedTradeSwaps++;
    const gaveLegs = userIsA ? tr.sideALegs : tr.sideBLegs;
    const recvLegs = userIsA ? tr.sideBLegs : tr.sideALegs;
    const counterparty = userIsA ? tr.walletB : tr.walletA;

    tradedOutCount += gaveLegs.length;
    tradedInCount += recvLegs.length;

    let retailGave = 0;
    let retailRecv = 0;

    const gaveItems = gaveLegs.map((leg) => {
      const meta = metaMap.get(leg.tokenId) ?? null;
      const refUsd = estimateRetailReferenceUsd(meta, config.rates);
      retailGave += refUsd;
      return buildTokenItem(leg.tokenId, meta, 0, 0, 0, "Traded out");
    });

    const receivedItems = recvLegs.map((leg) => {
      const meta = metaMap.get(leg.tokenId) ?? null;
      const refUsd = estimateRetailReferenceUsd(meta, config.rates);
      retailRecv += refUsd;
      recordClassAndArtist(meta, "trade_in", 0, 0, 0);
      return buildTokenItem(leg.tokenId, meta, 0, 0, 0, "Traded in");
    });

    getMonth(tr.completedAt).tradeCount++;

    const primaryLeg = tr.allLegs[0]!;
    activities.push({
      id: `trade:${tr.tradeId}`,
      category: "trade_swap",
      chain: tr.chain,
      timestamp: tr.completedAt,
      blockNumber: primaryLeg.blockNumber,
      txHash: primaryLeg.txHash,
      title: `Confirmed Trade (${gaveItems.length} ↔ ${receivedItems.length})`,
      subtitle: `Swapped with ${shortenAddress(counterparty)}`,
      count: gaveItems.length + receivedItems.length,
      cashCostUsd: 0,
      lowUsd: 0,
      highUsd: 0,
      pricingBasis: "Reciprocal P2P swap ($0 cash)",
      items: [...receivedItems, ...gaveItems],
      counterparty,
      counterpartyShort: shortenAddress(counterparty),
      durationSeconds: tr.durationSeconds,
      gaveItems,
      receivedItems,
      retailValueGaveUsd: round2(retailGave),
      retailValueReceivedUsd: round2(retailRecv),
    });
  }

  // 7b. Emit Spins (paired burn + replacement mint, plus unpaired spins)
  for (const outLog of spinOutLogs) {
    spinsSent++;
    const outKey = `${outLog.chain}:${outLog.txHash}:${outLog.logIndex}`;
    const pairedMint = spinOutKeyToMintLog.get(outKey) ?? null;
    const outMeta = metaMap.get(outLog.tokenId) ?? null;
    const gaveItem = buildTokenItem(
      outLog.tokenId,
      outMeta,
      0,
      0,
      0,
      "Sent to COSMO Spin",
    );

    const receivedItems: ActivityTokenItem[] = [];
    if (pairedMint) {
      spinsReceived++;
      const inMeta = metaMap.get(pairedMint.tokenId) ?? null;
      recordClassAndArtist(inMeta, "free_or_spin", 0, 0, 0);
      receivedItems.push(
        buildTokenItem(
          pairedMint.tokenId,
          inMeta,
          0,
          0,
          0,
          "COSMO Spin prize ($0 new cash)",
        ),
      );
    }

    getMonth(outLog.timestamp).spinCount++;

    activities.push({
      id: `spin:${outKey}`,
      category: "spin",
      chain: outLog.chain,
      timestamp: outLog.timestamp,
      blockNumber: outLog.blockNumber,
      txHash: outLog.txHash,
      title: pairedMint ? "COSMO Spin (Paired)" : "COSMO Spin (Sent)",
      subtitle: pairedMint
        ? `${gaveItem.collectionId} → ${receivedItems[0]!.collectionId}`
        : `Sent ${gaveItem.collectionId} to COSMO Spin`,
      count: 1,
      cashCostUsd: 0,
      lowUsd: 0,
      highUsd: 0,
      pricingBasis: "COSMO Spin replacement ($0 additional cash)",
      items: [...receivedItems, gaveItem],
      gaveItems: [gaveItem],
      receivedItems,
    });
  }

  // 7b-2. Detect COSMO Talk / Pass+ monthly subscription DCO mints (NEVER double-counted as shop mints!)
  // Group eligible primary online Double Class mints by (artistId|season|collectionNo)
  const talkCandidateGroups = new Map<
    string,
    {
      artistId: string;
      season: string;
      collectionNo: string;
      logs: WalletTransferLog[];
      members: Set<string>;
      curated: CuratedTalkPassCollection | null;
    }
  >();

  for (const l of logs) {
    const logKey = `${l.chain}:${l.txHash}:${l.logIndex}`;
    if (l.from !== ZERO_ADDRESS || !userSet.has(l.to)) continue;
    if (migrationKeys.has(logKey) || spinMintKeyToOutLog.has(logKey)) continue;

    const meta = metaMap.get(l.tokenId);
    if (!meta) continue;
    if (meta.onOffline !== "online" || meta.objektClass.toLowerCase() !== "double") {
      continue;
    }

    const colKey = `${meta.artistId.toLowerCase()}|${meta.season.toLowerCase()}|${meta.collectionNo.toUpperCase()}`;
    const curated = KNOWN_TALK_PASS_BY_KEY.get(colKey) ?? null;

    // Only track known Pass+ collections OR future post-Nov 2026 online DCOs for heuristic All-Member detection
    if (!curated && l.timestamp < "2026-12-01T00:00:00Z") continue;

    let grp = talkCandidateGroups.get(colKey);
    if (!grp) {
      grp = {
        artistId: meta.artistId.toLowerCase(),
        season: meta.season,
        collectionNo: meta.collectionNo.toUpperCase(),
        logs: [],
        members: new Set(),
        curated,
      };
      talkCandidateGroups.set(colKey, grp);
    }
    grp.logs.push(l);
    if (meta.memberName) grp.members.add(meta.memberName);
  }

  const talkPassLogKeys = new Set<string>();

  for (const [colKey, grp] of talkCandidateGroups.entries()) {
    let isTalkPass = false;
    let isInferred = false;

    if (grp.curated) {
      // Verified Pass+ collection: matches 1, 2, 4, 8, and 24-member tiers
      isTalkPass = grp.logs.length > 0;
    } else {
      // Future-proof heuristic for unseen post-Nov 2026 All-Member Pass+ distributions:
      // Exact full roster (24 unique tripleS members or 5 unique ARTMS members), zero duplicates,
      // claimed within a tight 24h window on/after day 14 of the month.
      const firstMs = Date.parse(grp.logs[0]!.timestamp);
      const lastMs = Date.parse(grp.logs[grp.logs.length - 1]!.timestamp);
      const spanHours = (lastMs - firstMs) / 3_600_000;
      const dayOfMonth = new Date(firstMs).getUTCDate();
      const isFullTriples =
        grp.artistId === "triples" &&
        grp.logs.length === 24 &&
        grp.members.size === 24 &&
        dayOfMonth >= 14 &&
        spanHours <= 24;
      const isFullArtms =
        grp.artistId === "artms" &&
        grp.logs.length === 5 &&
        grp.members.size === 5 &&
        dayOfMonth >= 14 &&
        dayOfMonth <= 17 &&
        spanHours <= 1;

      if (isFullTriples || isFullArtms) {
        isTalkPass = true;
        isInferred = true;
      }
    }

    if (!isTalkPass) continue;

    for (const l of grp.logs) {
      talkPassLogKeys.add(`${l.chain}:${l.txHash}:${l.logIndex}`);
    }

    const tier = deduceTalkPassTier(
      grp.artistId,
      grp.members.size || grp.logs.length,
      config.rates,
    );
    const firstLog = grp.logs[0]!;
    const billingLabel =
      grp.curated?.label ??
      `${firstLog.timestamp.slice(0, 7)} ${formatArtistLabel(grp.artistId)} Pass+ (Inferred)`;
    const perCardShare = grp.logs.length > 0 ? tier.usd / grp.logs.length : tier.usd;
    const perCardLow = grp.logs.length > 0 ? tier.lowUsd / grp.logs.length : tier.lowUsd;
    const perCardHigh = grp.logs.length > 0 ? tier.highUsd / grp.logs.length : tier.highUsd;

    subscriptionMonths++;
    subscriptionObjekts += grp.logs.length;
    subscriptionsUsd = round2(subscriptionsUsd + tier.usd);
    subscriptionsLowUsd = round2(subscriptionsLowUsd + tier.lowUsd);
    subscriptionsHighUsd = round2(subscriptionsHighUsd + tier.highUsd);

    const monthPoint = getMonth(firstLog.timestamp);
    monthPoint.subscriptionsUsd = round2(monthPoint.subscriptionsUsd + tier.usd);
    monthPoint.subscriptionCount += grp.logs.length;

    const passItems: ActivityTokenItem[] = grp.logs.map((l) => {
      const meta = metaMap.get(l.tokenId) ?? null;
      recordClassAndArtist(
        meta,
        "subscription",
        perCardShare,
        perCardLow,
        perCardHigh,
      );
      return buildTokenItem(
        l.tokenId,
        meta,
        config.includeSubscriptions ? perCardShare : 0,
        config.includeSubscriptions ? perCardLow : 0,
        config.includeSubscriptions ? perCardHigh : 0,
        `COSMO Talk ${tier.tierLabel} (${formatUsdInline(tier.usd)}/mo ÷ ${grp.logs.length})`,
      );
    });

    subscriptions.push({
      id: `talk:${colKey}`,
      artistId: grp.artistId,
      season: grp.season,
      collectionNo: grp.collectionNo,
      billingLabel,
      claimedAt: firstLog.timestamp,
      tierLabel: tier.tierLabel,
      memberCount: grp.members.size || grp.logs.length,
      estimatedUsd: tier.usd,
      perMemberUsd: tier.perMemberUsd,
      lowUsd: tier.lowUsd,
      highUsd: tier.highUsd,
      isInferred,
    });

    const effectiveSubUsd = config.includeSubscriptions ? tier.usd : 0;
    activities.push({
      id: `talk:${colKey}`,
      category: "cosmo_talk_pass",
      chain: firstLog.chain,
      timestamp: firstLog.timestamp,
      blockNumber: firstLog.blockNumber,
      txHash: firstLog.txHash,
      title: `COSMO Talk ${tier.tierLabel} (${grp.season} ${grp.collectionNo})`,
      subtitle: `${billingLabel} · ${grp.logs.length} monthly Objekt${grp.logs.length === 1 ? "" : "s"} (${formatUsdInline(tier.perMemberUsd)}/member)`,
      count: grp.logs.length,
      cashCostUsd: round2(effectiveSubUsd),
      lowUsd: config.includeSubscriptions ? tier.lowUsd : 0,
      highUsd: config.includeSubscriptions ? tier.highUsd : 0,
      pricingBasis: `${tier.tierLabel} monthly subscription (${isInferred ? "inferred from 24-member drop" : "verified Pass+ drop"})`,
      items: passItems,
    });
  }

  subscriptions.sort((a, b) => b.claimedAt.localeCompare(a.claimedAt));

  // 7c. Group remaining native mints by (chain, txHash, category) so pack purchases render as 1 crisp row!
  interface MintTxBucket {
    chain: ChainId;
    txHash: string;
    blockNumber: number;
    timestamp: string;
    category: "shop_mint" | "physical_scan" | "free_reward";
    items: ActivityTokenItem[];
    totalUsd: number;
    lowUsd: number;
    highUsd: number;
    basis: string;
    isGridReward: boolean;
    gridEditionLabel: string | null;
    gridFcosLocked: number;
  }

  const mintBuckets = new Map<string, MintTxBucket>();
  const migrationLogs: WalletTransferLog[] = [];

  for (const l of logs) {
    const logKey = `${l.chain}:${l.txHash}:${l.logIndex}`;

    // Already handled as confirmed trade, spin, or COSMO Talk Pass+ subscription
    if (tradedKeysByChain.has(logKey)) continue;
    if (l.to === COSMO_SPIN_ADDRESS && userSet.has(l.from)) continue;
    if (spinMintKeyToOutLog.has(logKey)) continue;
    if (talkPassLogKeys.has(logKey)) continue;

    // Migration bridge re-mint on Abstract (Apr 2025)
    if (migrationKeys.has(logKey)) {
      migratedCount++;
      migrationLogs.push(l);
      continue;
    }

    // Primary Mint (`from === 0x0`)
    if (l.from === ZERO_ADDRESS && userSet.has(l.to)) {
      const meta = metaMap.get(l.tokenId) ?? null;
      const txBatchSize = mintCountByTx.get(`${l.chain}:${l.txHash}`) ?? 1;
      const curated = meta ? curatedPrices.get(meta.slug) : undefined;
      const est = estimateMintUnitPrice(
        meta,
        l.timestamp,
        txBatchSize,
        config,
        curated,
      );

      const item = buildTokenItem(
        l.tokenId,
        meta,
        est.usd,
        est.lowUsd,
        est.highUsd,
        est.basis,
      );

      const monthPoint = getMonth(l.timestamp);

      const gridInfo =
        est.category === "free_reward" && meta
          ? classifyGridRewardSco(
              meta.artistId,
              meta.season,
              meta.objektClass,
              meta.collectionNo,
              meta.onOffline,
            )
          : null;

      if (est.category === "shop_mint") {
        paidDigitalMints++;
        digitalShopUsd = round2(digitalShopUsd + est.usd);
        digitalShopLowUsd = round2(digitalShopLowUsd + est.lowUsd);
        digitalShopHighUsd = round2(digitalShopHighUsd + est.highUsd);
        monthPoint.digitalUsd = round2(monthPoint.digitalUsd + est.usd);
        monthPoint.paidMintCount++;
        recordClassAndArtist(meta, "paid", est.usd, est.lowUsd, est.highUsd);
      } else if (est.category === "physical_scan") {
        physicalScans++;
        physicalScansUsd = round2(physicalScansUsd + est.usd);
        physicalScansLowUsd = round2(physicalScansLowUsd + est.lowUsd);
        physicalScansHighUsd = round2(physicalScansHighUsd + est.highUsd);
        monthPoint.physicalUsd = round2(monthPoint.physicalUsd + est.usd);
        monthPoint.physicalScanCount++;
        recordClassAndArtist(meta, "physical", est.usd, est.lowUsd, est.highUsd);
      } else {
        freeRewards++;
        recordClassAndArtist(meta, "free_or_spin", 0, 0, 0);

        if (gridInfo && meta) {
          gridsCompleted++;
          if (l.chain === "abstract") gridsCompletedAbstract++;
          else gridsCompletedPolygon++;
          gridFcosLocked += gridInfo.gridSize;
          if (gridInfo.editionId === "ed1") gridsEd1Count++;
          else if (gridInfo.editionId === "ed2") gridsEd2Count++;
          else gridsEd3Count++;
          monthPoint.gridsCompleted++;

          const aRow = artistMap.get(meta.artistId);
          if (aRow) aRow.gridsCompleted++;
          if (meta.memberName && meta.memberName !== "Unknown") {
            const mRow = memberMap.get(`${meta.artistId}|${meta.memberName}`);
            if (mRow) mRow.gridsCompleted++;
          }

          const gKey = `${meta.artistId}|${meta.season}|${gridInfo.editionId}`;
          let gRow = gridGroupMap.get(gKey);
          if (!gRow) {
            gRow = {
              key: gKey,
              artistId: meta.artistId,
              artistLabel: formatArtistLabel(meta.artistId),
              season: meta.season,
              editionId: gridInfo.editionId,
              editionLabel: gridInfo.editionLabel,
              shortLabel: gridInfo.shortLabel,
              gridSize: gridInfo.gridSize,
              gridsCompleted: 0,
              fcosLocked: 0,
              members: new Set(),
              latestCompletedAt: l.timestamp,
            };
            gridGroupMap.set(gKey, gRow);
          }
          gRow.gridsCompleted++;
          gRow.fcosLocked += gridInfo.gridSize;
          if (meta.memberName) gRow.members.add(meta.memberName);
          if (l.timestamp > gRow.latestCompletedAt) {
            gRow.latestCompletedAt = l.timestamp;
          }
        }
      }

      const bucketKey = `${l.chain}:${l.txHash}:${est.category}${gridInfo ? ":grid" : ""}`;
      let bucket = mintBuckets.get(bucketKey);
      if (!bucket) {
        bucket = {
          chain: l.chain,
          txHash: l.txHash,
          blockNumber: l.blockNumber,
          timestamp: l.timestamp,
          category: est.category,
          items: [],
          totalUsd: 0,
          lowUsd: 0,
          highUsd: 0,
          basis: gridInfo
            ? `COSMO Grid Completed (${gridInfo.editionLabel} • locks ${gridInfo.gridSize} FCOs)`
            : est.basis,
          isGridReward: gridInfo !== null,
          gridEditionLabel: gridInfo?.editionLabel ?? null,
          gridFcosLocked: 0,
        };
        mintBuckets.set(bucketKey, bucket);
      }
      bucket.items.push(item);
      bucket.totalUsd = round2(bucket.totalUsd + est.usd);
      bucket.lowUsd = round2(bucket.lowUsd + est.lowUsd);
      bucket.highUsd = round2(bucket.highUsd + est.highUsd);
      if (gridInfo) {
        bucket.gridFcosLocked += gridInfo.gridSize;
      }
      continue;
    }

    // Burn (`to === 0x0` or `0xdead`)
    if (
      userSet.has(l.from) &&
      (l.to === ZERO_ADDRESS || l.to === DEAD_ADDRESS)
    ) {
      burnedCount++;
      const meta = metaMap.get(l.tokenId) ?? null;
      const item = buildTokenItem(l.tokenId, meta, 0, 0, 0, "Burned");
      activities.push({
        id: `burn:${logKey}`,
        category: "burn",
        chain: l.chain,
        timestamp: l.timestamp,
        blockNumber: l.blockNumber,
        txHash: l.txHash,
        title: `Burned ${item.collectionId}`,
        subtitle: "Sent to burn address",
        count: 1,
        cashCostUsd: 0,
        lowUsd: 0,
        highUsd: 0,
        pricingBasis: "Burn ($0)",
        items: [item],
      });
      continue;
    }

    // Remaining One-Way P2P Received
    if (userSet.has(l.to)) {
      p2pReceivedCount++;
      const meta = metaMap.get(l.tokenId) ?? null;
      const otcRate = config.includeOtcP2pReceived ? config.rates.otcP2pReceived : 0;
      const otcLow = config.includeOtcP2pReceived ? round2(otcRate * 0.7) : 0;
      const otcHigh = config.includeOtcP2pReceived ? round2(otcRate * 1.4) : 0;

      if (config.includeOtcP2pReceived) {
        otcP2pUsd = round2(otcP2pUsd + otcRate);
        getMonth(l.timestamp).otcUsd = round2(
          getMonth(l.timestamp).otcUsd + otcRate,
        );
      }
      recordClassAndArtist(meta, "p2p_in", otcRate, otcLow, otcHigh);

      const item = buildTokenItem(
        l.tokenId,
        meta,
        otcRate,
        otcLow,
        otcHigh,
        config.includeOtcP2pReceived
          ? `1-way P2P OTC est. ($${otcRate.toFixed(2)})`
          : "1-way P2P transfer (gift / alt / OTC)",
      );
      activities.push({
        id: `p2p-in:${logKey}`,
        category: "p2p_received",
        chain: l.chain,
        timestamp: l.timestamp,
        blockNumber: l.blockNumber,
        txHash: l.txHash,
        title: `Received ${item.collectionId}`,
        subtitle: `1-way transfer from ${shortenAddress(l.from)}`,
        count: 1,
        cashCostUsd: otcRate,
        lowUsd: otcLow,
        highUsd: otcHigh,
        pricingBasis: item.pricingBasis,
        items: [item],
        counterparty: l.from,
        counterpartyShort: shortenAddress(l.from),
      });
      continue;
    }

    // Remaining One-Way P2P Sent
    if (userSet.has(l.from)) {
      p2pSentCount++;
      const meta = metaMap.get(l.tokenId) ?? null;
      const item = buildTokenItem(
        l.tokenId,
        meta,
        0,
        0,
        0,
        "1-way P2P sent (gift / alt / OTC sale)",
      );
      activities.push({
        id: `p2p-out:${logKey}`,
        category: "p2p_sent",
        chain: l.chain,
        timestamp: l.timestamp,
        blockNumber: l.blockNumber,
        txHash: l.txHash,
        title: `Sent ${item.collectionId}`,
        subtitle: `1-way transfer to ${shortenAddress(l.to)}`,
        count: 1,
        cashCostUsd: 0,
        lowUsd: 0,
        highUsd: 0,
        pricingBasis: "1-way transfer out ($0)",
        items: [item],
        counterparty: l.to,
        counterpartyShort: shortenAddress(l.to),
      });
    }
  }

  // Finalize grouped Mint TX buckets
  for (const bucket of mintBuckets.values()) {
    if (bucket.category === "shop_mint") {
      paidMintTransactions++;
    }
    const first = bucket.items[0]!;
    const uniqueMembers = Array.from(
      new Set(bucket.items.map((i) => i.memberName).filter((m) => m && m !== "Resolving...")),
    );
    const uniqueSeasons = Array.from(
      new Set(bucket.items.map((i) => i.season).filter(Boolean)),
    );

    let title: string;
    let subtitle: string;
    if (bucket.items.length === 1) {
      title =
        bucket.category === "physical_scan"
          ? `Scanned ${first.collectionId}`
          : bucket.isGridReward
            ? `Completed Grid · ${first.collectionId}`
            : bucket.category === "free_reward"
              ? `Claimed ${first.collectionId}`
              : `Minted ${first.collectionId}`;
      subtitle = bucket.basis;
    } else {
      const memberSummary =
        uniqueMembers.length === 1
          ? uniqueMembers[0]
          : uniqueMembers.length > 1
            ? `${uniqueMembers.slice(0, 2).join(", ")}${uniqueMembers.length > 2 ? ` +${uniqueMembers.length - 2}` : ""}`
            : "Objekts";
      const seasonPrefix = uniqueSeasons.length === 1 ? `${uniqueSeasons[0]} ` : "";
      title =
        bucket.category === "physical_scan"
          ? `Scanned ${bucket.items.length}× ${seasonPrefix}${memberSummary} Physical`
          : bucket.isGridReward
            ? `Completed ${bucket.items.length}× ${seasonPrefix}${memberSummary} Grids`
            : bucket.category === "free_reward"
              ? `Claimed ${bucket.items.length}× ${seasonPrefix}${memberSummary} Rewards`
              : `Bought ${bucket.items.length}-Pack ${seasonPrefix}${memberSummary}`;
      subtitle = bucket.isGridReward
        ? `${bucket.gridEditionLabel ?? "COSMO Grid"} • locks ${bucket.gridFcosLocked} FCOs ($0)`
        : `${bucket.basis} • $${(bucket.totalUsd / bucket.items.length).toFixed(2)}/ea`;
    }

    const effectiveCost =
      bucket.category === "physical_scan" && !config.includePhysicalScans
        ? 0
        : bucket.totalUsd;

    activities.push({
      id: `mint:${bucket.chain}:${bucket.txHash}:${bucket.category}${bucket.isGridReward ? ":grid" : ""}`,
      category: bucket.category,
      chain: bucket.chain,
      timestamp: bucket.timestamp,
      blockNumber: bucket.blockNumber,
      txHash: bucket.txHash,
      title,
      subtitle,
      count: bucket.items.length,
      cashCostUsd: round2(effectiveCost),
      lowUsd:
        bucket.category === "physical_scan" && !config.includePhysicalScans
          ? 0
          : bucket.lowUsd,
      highUsd:
        bucket.category === "physical_scan" && !config.includePhysicalScans
          ? 0
          : bucket.highUsd,
      pricingBasis: bucket.basis,
      items: bucket.items,
      isGridReward: bucket.isGridReward || undefined,
      gridEditionLabel: bucket.gridEditionLabel ?? undefined,
      gridFcosLocked: bucket.gridFcosLocked > 0 ? bucket.gridFcosLocked : undefined,
    });
  }

  // Group migration bridge logs into 1 clean summary activity (plus optional unverified fallback cost)
  if (migrationLogs.length > 0) {
    const migItems: ActivityTokenItem[] = [];
    let unverifiedSum = 0;
    let unverifiedLow = 0;
    let unverifiedHigh = 0;

    for (const ml of migrationLogs) {
      const meta = metaMap.get(ml.tokenId) ?? null;
      if (
        meta &&
        !polygonSeenTokens.has(ml.tokenId) &&
        classifyGridRewardSco(
          meta.artistId,
          meta.season,
          meta.objektClass,
          meta.collectionNo,
          meta.onOffline,
        ) !== null
      ) {
        migratedGridScosCount++;
      }
      let uUsd = 0;
      let uLow = 0;
      let uHigh = 0;
      let basis = input.polygonLoaded
        ? "Polygon → Abstract migration bridge ($0 — original tx tracked on Polygon)"
        : "Migrated from Polygon (load Polygon history for exact origin)";

      if (!input.polygonLoaded && config.includeUnverifiedMigrations && !polygonSeenTokens.has(ml.tokenId)) {
        const est = estimateMintUnitPrice(
          meta,
          "2024-06-01T00:00:00Z", // Conservative Polygon-era date
          1,
          config,
        );
        if (est.category === "shop_mint" || (est.category === "physical_scan" && config.includePhysicalScans)) {
          uUsd = est.usd;
          uLow = est.lowUsd;
          uHigh = est.highUsd;
          unverifiedSum = round2(unverifiedSum + uUsd);
          unverifiedLow = round2(unverifiedLow + uLow);
          unverifiedHigh = round2(unverifiedHigh + uHigh);
          basis = `Unverified pre-migration est. (${est.basis})`;
        }
      }
      migItems.push(buildTokenItem(ml.tokenId, meta, uUsd, uLow, uHigh, basis));
    }

    unverifiedMigrationUsd = unverifiedSum;
    const firstMig = migrationLogs[0]!;
    activities.push({
      id: `migration:abstract:${firstMig.blockNumber}`,
      category: "migration_bridge",
      chain: "abstract",
      timestamp: firstMig.timestamp,
      blockNumber: firstMig.blockNumber,
      txHash: firstMig.txHash,
      title: `Polygon → Abstract Migration (${migrationLogs.length.toLocaleString()} Objekts)`,
      subtitle: input.polygonLoaded
        ? "Re-minted on Abstract during Apr 2025 migration — counted $0 here so Polygon history isn't double-counted"
        : "Pre-Apr 2025 Polygon Objekts migrated to Abstract",
      count: migrationLogs.length,
      cashCostUsd: unverifiedSum,
      lowUsd: unverifiedLow,
      highUsd: unverifiedHigh,
      pricingBasis: input.polygonLoaded
        ? "Chain migration bridge ($0)"
        : "Pending Polygon archive verification",
      items: migItems,
    });
  }

  // Compute totals cleanly
  const subsIncluded = config.includeSubscriptions ? subscriptionsUsd : 0;
  const subsLowIncluded = config.includeSubscriptions ? subscriptionsLowUsd : 0;
  const subsHighIncluded = config.includeSubscriptions ? subscriptionsHighUsd : 0;

  const physIncluded = config.includePhysicalScans ? physicalScansUsd : 0;
  const physLowIncluded = config.includePhysicalScans ? physicalScansLowUsd : 0;
  const physHighIncluded = config.includePhysicalScans ? physicalScansHighUsd : 0;

  const otcLow = config.includeOtcP2pReceived ? round2(otcP2pUsd * 0.7) : 0;
  const otcHigh = config.includeOtcP2pReceived ? round2(otcP2pUsd * 1.4) : 0;

  const estimatedTotalUsd = round2(
    digitalShopUsd + subsIncluded + physIncluded + otcP2pUsd + unverifiedMigrationUsd,
  );
  const lowEstimateUsd = round2(
    digitalShopLowUsd +
      subsLowIncluded +
      physLowIncluded +
      otcLow +
      round2(unverifiedMigrationUsd * 0.85),
  );
  const highEstimateUsd = round2(
    digitalShopHighUsd +
      subsHighIncluded +
      physHighIncluded +
      otcHigh +
      round2(unverifiedMigrationUsd * 1.15),
  );

  // Finalize monthly timeline totals
  const monthlyTimeline = Array.from(monthlyMap.values())
    .map((m) => ({
      ...m,
      totalUsd: round2(
        m.digitalUsd +
          (config.includeSubscriptions ? m.subscriptionsUsd : 0) +
          (config.includePhysicalScans ? m.physicalUsd : 0) +
          m.otcUsd,
      ),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Sort breakdowns descending by spend then count
  const classBreakdown = Array.from(classMap.values()).sort(
    (a, b) => b.estimatedUsd - a.estimatedUsd || b.totalAcquired - a.totalAcquired,
  );
  const memberBreakdown = Array.from(memberMap.values()).sort(
    (a, b) =>
      b.estimatedUsd - a.estimatedUsd ||
      b.currentlyHeldCount - a.currentlyHeldCount ||
      b.paidMintCount - a.paidMintCount,
  );
  const artistBreakdown = Array.from(artistMap.values()).sort(
    (a, b) => b.estimatedUsd - a.estimatedUsd || b.currentlyHeldCount - a.currentlyHeldCount,
  );

  // Sort activities newest first
  activities.sort(
    (a, b) =>
      b.timestamp.localeCompare(a.timestamp) || b.blockNumber - a.blockNumber,
  );

  // First & last non-migration activity timestamps
  const nonMigLogs = logs.filter(
    (l) => !migrationKeys.has(`${l.chain}:${l.txHash}:${l.logIndex}`),
  );
  const firstActivityAt = nonMigLogs[0]?.timestamp ?? logs[0]?.timestamp ?? null;
  const lastActivityAt =
    nonMigLogs[nonMigLogs.length - 1]?.timestamp ??
    logs[logs.length - 1]?.timestamp ??
    null;

  const gridBreakdown: CompletedGridGroup[] = Array.from(gridGroupMap.values())
    .map((g) => ({
      key: g.key,
      artistId: g.artistId,
      artistLabel: g.artistLabel,
      season: g.season,
      editionId: g.editionId,
      editionLabel: g.editionLabel,
      shortLabel: g.shortLabel,
      gridSize: g.gridSize,
      gridsCompleted: g.gridsCompleted,
      fcosLocked: g.fcosLocked,
      uniqueMembers: g.members.size,
      latestCompletedAt: g.latestCompletedAt,
    }))
    .sort(
      (a, b) =>
        b.latestCompletedAt.localeCompare(a.latestCompletedAt) ||
        b.gridsCompleted - a.gridsCompleted,
    );

  return {
    summary: {
      estimatedTotalUsd,
      lowEstimateUsd,
      highEstimateUsd,
      digitalShopUsd: round2(digitalShopUsd),
      digitalShopLowUsd: round2(digitalShopLowUsd),
      digitalShopHighUsd: round2(digitalShopHighUsd),
      subscriptionsUsd: round2(subscriptionsUsd),
      subscriptionsLowUsd: round2(subscriptionsLowUsd),
      subscriptionsHighUsd: round2(subscriptionsHighUsd),
      physicalScansUsd: round2(physicalScansUsd),
      physicalScansLowUsd: round2(physicalScansLowUsd),
      physicalScansHighUsd: round2(physicalScansHighUsd),
      otcP2pUsd: round2(otcP2pUsd),
      unverifiedMigrationUsd: round2(unverifiedMigrationUsd),

      currentlyHeld: heldTokens.size,
      totalTransactions: activities.filter((a) => a.category !== "migration_bridge").length,
      paidDigitalMints,
      paidMintTransactions,
      subscriptionMonths,
      subscriptionObjekts,
      detectedSubscriptionTier: subscriptions[0]?.tierLabel ?? null,
      physicalScans,
      freeRewards,
      gridsCompleted,
      gridsCompletedAbstract,
      gridsCompletedPolygon,
      migratedGridScosCount,
      gridFcosLocked,
      gridsEd1Count,
      gridsEd2Count,
      gridsEd3Count,
      heldScoCount,
      spinsSent,
      spinsReceived,
      confirmedTradeSwaps,
      tradedOutCount,
      tradedInCount,
      p2pReceivedCount,
      p2pSentCount,
      burnedCount,
      migratedCount,
      unresolvedTokenCount,

      polygonLogCount,
      abstractLogCount,
      firstActivityAt,
      lastActivityAt,
    },
    subscriptions,
    gridBreakdown,
    monthlyTimeline,
    classBreakdown,
    memberBreakdown,
    artistBreakdown,
    activities,
  };
}
