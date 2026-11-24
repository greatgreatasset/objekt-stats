import { describe, expect, it } from "vitest";
import {
  classifySpinOutputClass,
  classifySpinRarityTier,
  computeSpinAnalytics,
  getSpinOddsEraForSeason,
  pairSpinOutcomes,
  type RawSpinMintEvent,
  type RawSpinOutEvent,
  type SpinCollectionInput,
  type SpinMemberInfo,
} from "./spins.js";

const MEMBERS: SpinMemberInfo[] = [
  {
    id: "triples-yooyeon",
    code: "S5",
    memberOrder: 5,
    name: "YooYeon",
    fullName: "Kim YooYeon",
    hexColor: "#CE4D88",
  },
  {
    id: "triples-sullin",
    code: "S22",
    memberOrder: 22,
    name: "Sullin",
    fullName: "Pirada Bunraksa",
    hexColor: "#7BBA8D",
  },
];

describe("COSMO Spin analytics helpers", () => {
  it("classifies supply rarity tiers cleanly", () => {
    expect(classifySpinRarityTier(49)).toBe("ultra_rare");
    expect(classifySpinRarityTier(99)).toBe("ultra_rare");
    expect(classifySpinRarityTier(100)).toBe("very_rare");
    expect(classifySpinRarityTier(499)).toBe("very_rare");
    expect(classifySpinRarityTier(1500)).toBe("rare");
    expect(classifySpinRarityTier(5000)).toBe("uncommon");
    expect(classifySpinRarityTier(25000)).toBe("common");
  });

  it("maps legacy vs modern COSMO spin odds eras accurately", () => {
    expect(getSpinOddsEraForSeason("triples", "Atom02")).toBe("legacy_with_sco");
    expect(getSpinOddsEraForSeason("triples", "Binary02")).toBe("modern_no_sco");
    expect(getSpinOddsEraForSeason("triples", "Cream02")).toBe("modern_no_sco");
    expect(getSpinOddsEraForSeason("artms", "Divine01")).toBe("legacy_with_sco");
    expect(getSpinOddsEraForSeason("artms", "Ever01")).toBe("modern_no_sco");
    expect(getSpinOddsEraForSeason("artms", "Atom02")).toBe("modern_no_sco");
  });

  it("classifies spin output classes cleanly", () => {
    expect(classifySpinOutputClass("First", "101Z")).toBe("fco");
    expect(classifySpinOutputClass("Special", "201Z")).toBe("sco");
    expect(classifySpinOutputClass("Premier", "402Z")).toBe("premier");
    expect(classifySpinOutputClass("Double", "301Z")).toBe("other");
  });

  it("computes member spin rates, rarity buckets, and rarest spun cards", () => {
    const collections: SpinCollectionInput[] = [
      {
        slug: "triples-cream02-yooyeon-101z",
        collectionId: "Cream02 YooYeon 101Z",
        artistId: "triples",
        memberId: "triples-yooyeon",
        rawMemberName: "YooYeon",
        season: "Cream02",
        objektClass: "First",
        collectionNo: "101Z",
        onOffline: "online",
        totalMints: 20000,
        spunCount: 5000, // 25%
        frontImageUrl: "https://example.com/1.png",
        apolloTotalCopies: 20000,
        apolloMedianPriceUsd: 1.5,
        apolloListingCount: 10,
      },
      {
        slug: "triples-cream02-sullin-101z",
        collectionId: "Cream02 Sullin 101Z",
        artistId: "triples",
        memberId: "triples-sullin",
        rawMemberName: "Sullin",
        season: "Cream02",
        objektClass: "First",
        collectionNo: "101Z",
        onOffline: "online",
        totalMints: 10000,
        spunCount: 5000, // 50%
        frontImageUrl: "https://example.com/2.png",
        apolloTotalCopies: 10000,
        apolloMedianPriceUsd: 1.0,
        apolloListingCount: 5,
      },
      {
        slug: "triples-cream02-sullin-402z",
        collectionId: "Cream02 Sullin 402Z",
        artistId: "triples",
        memberId: "triples-sullin",
        rawMemberName: "Sullin",
        season: "Cream02",
        objektClass: "Premier",
        collectionNo: "402Z",
        onOffline: "online",
        totalMints: 60,
        spunCount: 2,
        frontImageUrl: "https://example.com/3.png",
        apolloTotalCopies: 60,
        apolloMedianPriceUsd: 85.0,
        apolloListingCount: 1,
      },
    ];

    const res = computeSpinAnalytics({
      artistId: "triples",
      members: MEMBERS,
      collections,
    });

    expect(res.totals.totalMints).toBe(30060);
    expect(res.totals.totalSpins).toBe(10002);
    expect(res.totals.premierSpun).toBe(2);
    expect(res.totals.rareUnder500Spun).toBe(2);
    expect(res.totals.estBlanks).toBe(Math.round(10002 * 0.0931));
    expect(res.totals.estScoPulls).toBe(0); // Cream02 is modern_no_sco

    // Sullin should rank #1 by spin rate (~49.7%) vs YooYeon (25%)
    expect(res.members[0]!.member.id).toBe("triples-sullin");
    expect(res.members[0]!.spinRatePct).toBeCloseTo(49.72, 1);
    expect(res.members[1]!.member.id).toBe("triples-yooyeon");
    expect(res.members[1]!.spinRatePct).toBe(25);

    // Ultra rare tier captures the 2 Premier 402Z sacrifices
    const ultraRare = res.rarityTiers.find((t) => t.tier.id === "ultra_rare")!;
    expect(ultraRare.spunCount).toBe(2);
    expect(ultraRare.estMarketValueBurnedUsd).toBe(170);

    // Premier card appears in rarestSpunCards & premierMotionSpunCards & highestValueSpunCards
    expect(res.rarestSpunCards[0]!.slug).toBe("triples-cream02-sullin-402z");
    expect(res.premierMotionSpunCards[0]!.slug).toBe("triples-cream02-sullin-402z");
    expect(res.highestValueSpunCards[0]!.slug).toBe("triples-cream02-sullin-402z");
  });

  it("pairs on-chain spin outflows with single-per-wallet reward mints and detects blanks", () => {
    const spins: RawSpinOutEvent[] = [
      {
        txHash: "0xspin1",
        logIndex: 0,
        chain: "abstract",
        blockNumber: 1000,
        timestampIso: "2026-11-24T10:00:00.000Z",
        spinner: "0xaaa",
        tokenId: 101,
      },
      {
        txHash: "0xspin2",
        logIndex: 0,
        chain: "abstract",
        blockNumber: 1005,
        timestampIso: "2026-11-24T10:00:05.000Z",
        spinner: "0xbbb",
        tokenId: 102,
      },
      {
        txHash: "0xspin3",
        logIndex: 0,
        chain: "abstract",
        blockNumber: 1010,
        timestampIso: "2026-11-24T10:00:10.000Z",
        spinner: "0xccc",
        tokenId: 103,
      },
    ];

    const mints: RawSpinMintEvent[] = [
      // Multi-wallet Modhaus relayer tx giving 1 mint to 0xaaa (valid spin match!)
      {
        txHash: "0xrelayer_batch",
        logIndex: 2,
        chain: "abstract",
        blockNumber: 1018,
        timestampIso: "2026-11-24T10:00:18.000Z",
        recipient: "0xaaa",
        tokenId: 5001,
        walletMintCountInTx: 1,
      },
      // Shop 4-pack for 0xbbb (walletMintCountInTx = 4 -> MUST NOT match as spin reward!)
      {
        txHash: "0xshop_pack",
        logIndex: 0,
        chain: "abstract",
        blockNumber: 1020,
        timestampIso: "2026-11-24T10:00:20.000Z",
        recipient: "0xbbb",
        tokenId: 5002,
        walletMintCountInTx: 4,
      },
      // 0xccc receives NO mint -> Blank (Nothing)!
    ];

    const paired = pairSpinOutcomes(spins, mints, 240);
    expect(paired).toHaveLength(3);
    expect(paired[0]!.rewardMint?.tokenId).toBe(5001);
    expect(paired[0]!.delaySeconds).toBe(18);
    expect(paired[1]!.rewardMint).toBeNull(); // 4-pack ignored -> Blank
    expect(paired[2]!.rewardMint).toBeNull(); // No mint -> Blank
  });
});
