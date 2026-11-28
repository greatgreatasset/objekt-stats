/**
 * Shared Apollo (https://apollo.cafe) metadata types, slug helpers,
 * and provenance classification rules for both Sale Rounds and the
 * User Cost & Transaction Estimator.
 */

export const APOLLO_BASE_URL = "https://apollo.cafe";

export type ApolloEventType =
  | "seasonal"
  | "album"
  | "merch"
  | "offline"
  | "shop"
  | "collaboration"
  | "promotional"
  | "tour";

export type ProvenanceClass =
  | "shop_paid"
  | "pass_plus"
  | "free_reward"
  | "physical_merch"
  | "dual_distribution"
  | "unknown";

export interface ApolloEraPayload {
  id: string;
  slug: string;
  name: string;
  spotifyAlbumArt?: string | null;
  imageUrl?: string | null;
}

export interface ApolloEventPayload {
  id: string;
  slug: string;
  name: string;
  eventType: ApolloEventType | string;
  twitterUrl?: string | null;
  description?: string | null;
  era?: ApolloEraPayload | null;
}

export interface ApolloPriceStatsPayload {
  medianPriceUsd: number;
  listingCount: number;
  minPriceUsd: number;
  maxPriceUsd: number;
  updatedAt: string;
}

export interface ApolloMetadataApiResponse {
  total: number;
  transferable: number;
  percentage: number;
  unobtainable: boolean;
  data?: {
    id: number;
    collectionId: string;
    description?: string | null;
    event?: ApolloEventPayload | null;
  } | null;
  priceStats?: ApolloPriceStatsPayload | null;
}

export interface ApolloDropProvenance {
  dropKey: string;
  sampleApolloSlug: string;
  artistId: string;
  season: string;
  collectionNo: string;
  description: string | null;
  eventSlug: string | null;
  eventName: string | null;
  eventType: string | null;
  eventDescription: string | null;
  twitterUrl: string | null;
  eraSlug: string | null;
  eraName: string | null;
  eraImageUrl: string | null;
  provenanceClass: ProvenanceClass;
  passBillingMonth: string | null;
  passBillingLabel: string | null;
  isFreeDistribution: boolean;
  fetchedAt?: string;
}

export interface ApolloCollectionStats {
  apolloSlug: string;
  dropKey: string;
  totalCopies: number;
  transferableCopies: number;
  transferablePct: number;
  unobtainable: boolean;
  description: string | null;
  eventSlug: string | null;
  eventName: string | null;
  eventType: string | null;
  eventDescription: string | null;
  twitterUrl: string | null;
  eraSlug: string | null;
  eraName: string | null;
  eraImageUrl: string | null;
  medianPriceUsd: number | null;
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  listingCount: number | null;
  priceUpdatedAt: string | null;
  fetchedAt?: string;
}

/**
 * Builds the canonical Apollo collection slug (omits artist prefix and removes spaces/punctuation
 * inside each segment, e.g. ("Atom01", "Kim Lip", "101Z") -> "atom01-kimlip-101z").
 */
export function toApolloSlug(
  season: string,
  memberName: string,
  collectionNo: string,
): string {
  const cleanSeg = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  return `${cleanSeg(season)}-${cleanSeg(memberName)}-${cleanSeg(collectionNo)}`;
}

/**
 * Builds the drop-level lookup key shared across all members of a release.
 * Example: ("triples", "Divine01", "338Z") -> "triples|divine01|338Z"
 */
export function makeApolloDropKey(
  artistId: string,
  season: string,
  collectionNo: string,
): string {
  return `${artistId.trim().toLowerCase()}|${season.trim().toLowerCase()}|${collectionNo.trim().toUpperCase()}`;
}

export function apolloCollectionUrl(
  season: string,
  memberName: string,
  collectionNo: string,
): string {
  const slug = toApolloSlug(season, memberName, collectionNo);
  const params = new URLSearchParams({
    season,
    collectionNo,
    member: memberName,
    id: slug,
  });
  return `${APOLLO_BASE_URL}/?${params.toString()}`;
}

export function apolloEventUrl(eventSlug: string): string {
  return `${APOLLO_BASE_URL}/events/${encodeURIComponent(eventSlug)}`;
}

const MONTH_MAP: Record<string, { num: string; short: string }> = {
  january: { num: "01", short: "Jan" },
  jan: { num: "01", short: "Jan" },
  february: { num: "02", short: "Feb" },
  feb: { num: "02", short: "Feb" },
  march: { num: "03", short: "Mar" },
  mar: { num: "03", short: "Mar" },
  april: { num: "04", short: "Apr" },
  apr: { num: "04", short: "Apr" },
  may: { num: "05", short: "May" },
  june: { num: "06", short: "Jun" },
  jun: { num: "06", short: "Jun" },
  july: { num: "07", short: "Jul" },
  jul: { num: "07", short: "Jul" },
  august: { num: "08", short: "Aug" },
  aug: { num: "08", short: "Aug" },
  september: { num: "09", short: "Sep" },
  sep: { num: "09", short: "Sep" },
  sept: { num: "09", short: "Sep" },
  october: { num: "10", short: "Oct" },
  oct: { num: "10", short: "Oct" },
  november: { num: "11", short: "Nov" },
  nov: { num: "11", short: "Nov" },
  december: { num: "12", short: "Dec" },
  dec: { num: "12", short: "Dec" },
};

function formatArtistShort(artistId: string): string {
  const lower = artistId.toLowerCase();
  if (lower === "triples") return "tripleS";
  if (lower === "artms") return "ARTMS";
  if (lower === "idntt") return "idntt";
  return artistId;
}

export function extractPassBillingInfo(
  artistId: string,
  eventName: string | null,
  eventSlug: string | null,
  description: string | null,
): { billingMonth: string | null; billingLabel: string | null } {
  const hay = [eventName ?? "", eventSlug ?? "", description ?? ""].join(" ");
  const m =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[- ]+(20\d{2})\b/i.exec(
      hay,
    );
  if (m) {
    const monthMeta = MONTH_MAP[m[1]!.toLowerCase()];
    const year = m[2]!;
    if (monthMeta) {
      return {
        billingMonth: `${year}-${monthMeta.num}`,
        billingLabel: `${monthMeta.short} ${year} ${formatArtistShort(artistId)} Pass+`,
      };
    }
  }
  if (eventName && /pass\+/i.test(eventName)) {
    return { billingMonth: null, billingLabel: eventName.trim() };
  }
  return { billingMonth: null, billingLabel: null };
}

export interface ClassifyApolloInput {
  artistId: string;
  season: string;
  collectionNo: string;
  objektClass?: string | null;
  onOffline: "online" | "offline";
  description: string | null;
  eventSlug: string | null;
  eventName: string | null;
  eventType: string | null;
  eventDescription: string | null;
}

export interface ClassifiedApolloProvenance {
  provenanceClass: ProvenanceClass;
  isFreeDistribution: boolean;
  passBillingMonth: string | null;
  passBillingLabel: string | null;
}

/**
 * Deterministic provenance classifier translating Apollo's structured `event` +
 * community-curated `description` into clean economic categories for both
 * `/rounds` popularity filtering and `/wallet` cost estimation.
 */
export function classifyApolloProvenance(
  input: ClassifyApolloInput,
): ClassifiedApolloProvenance {
  const desc = (input.description ?? "").trim();
  const evName = (input.eventName ?? "").trim();
  const evSlug = (input.eventSlug ?? "").trim();
  const evDesc = (input.eventDescription ?? "").trim();
  const evType = (input.eventType ?? "").trim().toLowerCase();
  const cls = (input.objektClass ?? "").trim().toLowerCase();
  const colNo = input.collectionNo.trim().toUpperCase();

  // 1. Physical QR-scanned Objekts (A-suffix)
  if (input.onOffline === "offline" || colNo.endsWith("A")) {
    return {
      provenanceClass: "physical_merch",
      isFreeDistribution: false,
      passBillingMonth: null,
      passBillingLabel: null,
    };
  }

  // 2. COSMO Talk Pass+ monthly subscriber DCOs (auto-detects all past & future months!)
  const combinedEventText = `${evSlug} ${evName} ${evDesc} ${desc}`;
  const isPassPlus =
    /\bpass\+/i.test(combinedEventText) ||
    /(?:^|-)pass-(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)-\d{4}/i.test(
      evSlug,
    ) ||
    /cosmo\s+talk\s+pass/i.test(combinedEventText);

  if (isPassPlus) {
    const { billingMonth, billingLabel } = extractPassBillingInfo(
      input.artistId,
      evName || null,
      evSlug || null,
      desc || null,
    );
    return {
      provenanceClass: "pass_plus",
      isFreeDistribution: false,
      passBillingMonth: billingMonth,
      passBillingLabel: billingLabel,
    };
  }

  // 3. Always-free native COSMO classes (Welcome 100Z, Zero, online Grid SCO)
  if (
    cls === "welcome" ||
    colNo === "100Z" ||
    cls === "zero" ||
    cls === "special"
  ) {
    return {
      provenanceClass: "free_reward",
      isFreeDistribution: true,
      passBillingMonth: null,
      passBillingLabel: null,
    };
  }

  // 4. Explicit shop-sale signals vs. gift/bonus/reward signals in collection description
  const descLower = desc.toLowerCase();
  const hasExplicitCosmoSale =
    /(?:sold|purchased|available\s+for\s+purchase|bought)\s+(?:on|in|through|via)\s+(?:the\s+)?(?:cosmo|web\s*shop|shop\.cosmo)/i.test(
      desc,
    ) ||
    /(?:later|also)\s+sold\s+(?:on|in)\s+(?:the\s+)?cosmo/i.test(desc) ||
    (/cosmo\s+(?:app\s+)?shop/i.test(desc) &&
      !/\b(?:not|never)\s+sold\b/i.test(desc) &&
      !/^gifted\b/i.test(descLower) &&
      !/randomly\s+obtained\s+from/i.test(desc));

  const hasGiftOrBonusVerb =
    /^(?:gifted|dropped|awarded|rewarded|given|distributed|airdropped)\b/i.test(
      desc,
    ) ||
    /\b(?:set\s+owners?|set\s+completion|completion\s+(?:bonus|reward)|for\s+completing|grid\s+reward|full\s+set\s+bonus|participat(?:ed|ing)\s+in|pre-?voting|live\s+voting|1st\s+win|music\s+show|attend(?:ing|ed|ees|ance)|check-?in|lucky\s+draw\s+winner|giveaway|raffle|discord\s+event|mission\s+reward|free\s+(?:objekt|drop|gift|reward)|ranking\s+top\s+\d+)\b/i.test(
      desc,
    );

  // Dual distribution: initially dropped to fanclub/event holders AND later sold in COSMO shop
  // (e.g., Divine01 338Z: "WAV 1st fanclub, dropped on October 31st 2024 and later sold in the COSMO app shop.")
  const isDualFanclubOrEventAndShop =
    /(?:later|also)\s+sold\s+(?:on|in)\s+(?:the\s+)?cosmo/i.test(desc) ||
    (/\bfanclub\b/i.test(desc) && hasExplicitCosmoSale);

  if (isDualFanclubOrEventAndShop) {
    return {
      provenanceClass: "dual_distribution",
      isFreeDistribution: false,
      passBillingMonth: null,
      passBillingLabel: null,
    };
  }

  // Pure shop-event set-completion bonuses AND seasonal leaderboard/pack rewards
  // (e.g., ARTMS Autumn Breeze 371Z, Divine02 305Z top-100 reward, 401Z/402Z Premier ranking/FCO-pack pulls)
  const isSetCompletionOrRankingReward =
    /^gifted\b/i.test(desc) &&
    !hasExplicitCosmoSale &&
    (/\b(?:set\s+owners?|owners?\s+of|completing|completion|collecting|all\s+\d+|bonus|participat|voting|attend|winner|subscribers?|members?|holders?|purchasing|buyers?|ranking\s+top\s+\d+|randomly\s+obtained)\b/i.test(
      desc,
    ) ||
      evType === "shop" ||
      evType === "promotional" ||
      evType === "tour" ||
      evType === "collaboration");

  if (isSetCompletionOrRankingReward) {
    return {
      provenanceClass: "free_reward",
      isFreeDistribution: true,
      passBillingMonth: null,
      passBillingLabel: null,
    };
  }

  // Seasonal FCO / Motion / Standard shop sales
  if (evType === "seasonal") {
    return {
      provenanceClass: "shop_paid",
      isFreeDistribution: false,
      passBillingMonth: null,
      passBillingLabel: null,
    };
  }

  if (evType === "shop") {
    if (hasGiftOrBonusVerb && !hasExplicitCosmoSale) {
      return {
        provenanceClass: "free_reward",
        isFreeDistribution: true,
        passBillingMonth: null,
        passBillingLabel: null,
      };
    }
    return {
      provenanceClass: "shop_paid",
      isFreeDistribution: false,
      passBillingMonth: null,
      passBillingLabel: null,
    };
  }

  // Promotional campaigns (voting gifts, milestones, livestreams, giveaways)
  if (evType === "promotional") {
    if (hasExplicitCosmoSale) {
      return {
        provenanceClass: "shop_paid",
        isFreeDistribution: false,
        passBillingMonth: null,
        passBillingLabel: null,
      };
    }
    return {
      provenanceClass: "free_reward",
      isFreeDistribution: true,
      passBillingMonth: null,
      passBillingLabel: null,
    };
  }

  // Tour / Offline / Collaboration / Album / Merch digital Z-suffix Objekts:
  // If explicitly sold in COSMO shop -> shop_paid; otherwise bundled/attendance/collab perk ($0 COSMO shop cash)
  if (
    evType === "tour" ||
    evType === "offline" ||
    evType === "collaboration" ||
    evType === "album" ||
    evType === "merch"
  ) {
    if (hasExplicitCosmoSale) {
      return {
        provenanceClass: "shop_paid",
        isFreeDistribution: false,
        passBillingMonth: null,
        passBillingLabel: null,
      };
    }
    return {
      provenanceClass: "free_reward",
      isFreeDistribution: true,
      passBillingMonth: null,
      passBillingLabel: null,
    };
  }

  // Fallback when eventType is missing but description clearly describes origin
  if (desc) {
    if (hasExplicitCosmoSale) {
      return {
        provenanceClass: "shop_paid",
        isFreeDistribution: false,
        passBillingMonth: null,
        passBillingLabel: null,
      };
    }
    if (hasGiftOrBonusVerb) {
      return {
        provenanceClass: "free_reward",
        isFreeDistribution: true,
        passBillingMonth: null,
        passBillingLabel: null,
      };
    }
  }

  return {
    provenanceClass: "unknown",
    isFreeDistribution: false,
    passBillingMonth: null,
    passBillingLabel: null,
  };
}

/**
 * Formats a clean, informative Sale Round title using Apollo's curated event name
 * while preserving standardized edition titles for seasonal FCOs and Welcome drops.
 */
export function buildEnrichedRoundTitle(params: {
  fallbackTitle: string;
  season: string;
  objektClass: string;
  collectionNo: string;
  apolloEventName: string | null;
  apolloDescription: string | null;
  provenanceClass: ProvenanceClass;
}): string {
  const {
    fallbackTitle,
    season,
    objektClass,
    collectionNo,
    apolloEventName,
    apolloDescription,
    provenanceClass,
  } = params;

  // Keep standardized FCO edition & Welcome titles ("Divine01 1st Edition FCO (101–108Z)")
  if (
    objektClass === "First" ||
    objektClass === "Welcome" ||
    objektClass === "Special"
  ) {
    return fallbackTitle;
  }

  const cleanEvent = (apolloEventName ?? "").trim();
  if (!cleanEvent) return fallbackTitle;

  const colTag = `${season} ${collectionNo}`;
  // Distinguish set-completion bonus cards within a multi-drop shop event (e.g. Autumn Breeze 371Z)
  const isBonusCard =
    provenanceClass === "free_reward" &&
    apolloDescription &&
    /\b(?:set\s+owners?|completion|bonus|for\s+completing)\b/i.test(
      apolloDescription,
    );

  const suffix = isBonusCard ? ` Bonus (${colTag})` : ` (${colTag})`;
  if (cleanEvent.toLowerCase().includes(collectionNo.toLowerCase())) {
    return cleanEvent;
  }
  return `${cleanEvent}${suffix}`;
}

/**
 * Maps Apollo provenance onto Sale Round classification (`saleMechanic`,
 * `includeInPopularity`, `unitPriceUsd`) so free promotional drops, set bonuses,
 * tour perks, and monthly Pass+ subscriptions never pollute paid popularity rankings.
 */
export function applyApolloToRoundMeta(params: {
  objektClass: string;
  onOffline: "online" | "offline";
  baseSaleMechanic: string;
  baseIncludeInPopularity: boolean;
  baseUnitPriceUsd: number | null;
  provenance: ApolloDropProvenance | null;
}): {
  saleMechanic: string;
  includeInPopularity: boolean;
  unitPriceUsd: number | null;
} {
  const {
    objektClass,
    onOffline,
    baseSaleMechanic,
    baseIncludeInPopularity,
    baseUnitPriceUsd,
    provenance,
  } = params;

  if (!provenance || onOffline === "offline") {
    return {
      saleMechanic: baseSaleMechanic,
      includeInPopularity: baseIncludeInPopularity,
      unitPriceUsd: baseUnitPriceUsd,
    };
  }

  // Never override First / Welcome / Special native rules
  if (
    objektClass === "First" ||
    objektClass === "Welcome" ||
    objektClass === "Special" ||
    objektClass === "Zero"
  ) {
    return {
      saleMechanic: baseSaleMechanic,
      includeInPopularity: baseIncludeInPopularity,
      unitPriceUsd: baseUnitPriceUsd,
    };
  }

  if (provenance.provenanceClass === "pass_plus") {
    return {
      saleMechanic: "subscription",
      includeInPopularity: false,
      unitPriceUsd: null,
    };
  }

  if (provenance.provenanceClass === "free_reward") {
    return {
      saleMechanic: "reward",
      includeInPopularity: false,
      unitPriceUsd: 0,
    };
  }

  // Detect explicit random/blind pack descriptions in shop drops
  const combined = `${provenance.description ?? ""} ${provenance.eventDescription ?? ""}`;
  if (
    /\b(?:random(?:ly)?\s+(?:drawn|distributed|given|pack|objekt)|blind\s+pack|gacha)\b/i.test(
      combined,
    )
  ) {
    return {
      saleMechanic: "random_pack",
      includeInPopularity: false,
      unitPriceUsd: baseUnitPriceUsd,
    };
  }

  // Motion class accurate default retail ($4.99 web / $5.99 app vs $3.29)
  const unitPrice =
    objektClass === "Motion" && (baseUnitPriceUsd === null || baseUnitPriceUsd === 3.29)
      ? 4.99
      : baseUnitPriceUsd;

  return {
    saleMechanic: baseSaleMechanic,
    includeInPopularity: baseIncludeInPopularity,
    unitPriceUsd: unitPrice,
  };
}
