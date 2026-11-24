import { describe, expect, it } from "vitest";
import { COSMO_SPIN_ADDRESS, ZERO_ADDRESS } from "./trades.js";
import {
  DEFAULT_PRICING_CONFIG,
  analyzeWalletCost,
  type WalletTokenMetadata,
  type WalletTransferLog,
} from "./wallet-cost.js";

const USER_ABS = "0x05eba008e1e60c6ae373e0b3e0fcd0657b49140b";
const USER_POLY = "0x2db85f6b6a697c96185a12cf9841bb067ef12c67";
const FRIEND = "0x75530431f0c904cfacfd829a297d55f95480fdb7";

function mkMeta(
  tokenId: number,
  overrides: Partial<WalletTokenMetadata> = {},
): WalletTokenMetadata {
  const season = overrides.season ?? "Cream02";
  const memberName = overrides.memberName ?? "Kotone";
  const collectionNo = overrides.collectionNo ?? "101Z";
  const artistId = overrides.artistId ?? "triples";
  const onOffline =
    overrides.onOffline ?? (collectionNo.endsWith("Z") ? "online" : "offline");
  return {
    tokenId,
    slug: `${artistId}-${season.toLowerCase()}-${memberName.toLowerCase()}-${collectionNo.toLowerCase()}`,
    collectionId: `${season} ${memberName} ${collectionNo}`,
    artistId,
    rawArtist: artistId === "artms" ? "ARTMS" : "tripleS",
    memberName,
    season,
    objektClass: overrides.objektClass ?? "First",
    collectionNo,
    onOffline,
    imageUrl: null,
    backgroundColor: "#FFDE00",
    ...overrides,
  };
}

describe("analyzeWalletCost", () => {
  it("prevents double-counting Polygon -> Abstract migrated tokens when Polygon history is loaded", () => {
    const logs: WalletTransferLog[] = [
      // Originally minted on Polygon in 2024 (pre-Web Shop -> App Store pricing)
      {
        chain: "polygon",
        txHash: "0xpoly1",
        logIndex: 0,
        blockNumber: 55_000_000,
        timestamp: "2024-04-01T10:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_POLY,
        tokenId: 442278,
      },
      // Re-minted on Abstract during Apr 2025 migration (tokenId < 9_419_276)
      {
        chain: "abstract",
        txHash: "0xmig1",
        logIndex: 0,
        blockNumber: 6_881_148,
        timestamp: "2025-04-16T12:09:34Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 442278,
      },
    ];

    const meta = new Map<number, WalletTokenMetadata>([
      [442278, mkMeta(442278, { season: "Binary01", collectionNo: "101Z" })],
    ]);

    const res = analyzeWalletCost({
      userAddresses: [USER_ABS, USER_POLY],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
      config: { ...DEFAULT_PRICING_CONFIG, preset: "app_store" },
    });

    expect(res.summary.paidDigitalMints).toBe(1);
    expect(res.summary.migratedCount).toBe(1);
    expect(res.summary.currentlyHeld).toBe(1);
    expect(res.summary.digitalShopUsd).toBe(3.29);
    expect(res.summary.estimatedTotalUsd).toBe(3.29);
  });

  it("pairs COSMO Spin outflows with replacement mints at $0 additional cash", () => {
    const logs: WalletTransferLog[] = [
      // Original card bought in 2025
      {
        chain: "abstract",
        txHash: "0xbuy",
        logIndex: 0,
        blockNumber: 10_000_000,
        timestamp: "2025-06-01T10:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 10_000_001,
      },
      // User sends card to COSMO Spin
      {
        chain: "abstract",
        txHash: "0xspinout",
        logIndex: 0,
        blockNumber: 13_811_926,
        timestamp: "2025-07-08T18:46:33Z",
        from: USER_ABS,
        to: COSMO_SPIN_ADDRESS,
        tokenId: 10_000_001,
      },
      // Modhaus mints spin prize 11 seconds later
      {
        chain: "abstract",
        txHash: "0xspinin",
        logIndex: 0,
        blockNumber: 13_811_937,
        timestamp: "2025-07-08T18:46:44Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 12_040_939,
      },
    ];

    const meta = new Map<number, WalletTokenMetadata>([
      [10_000_001, mkMeta(10_000_001)],
      [12_040_939, mkMeta(12_040_939, { memberName: "YooYeon", collectionNo: "105Z" })],
    ]);

    const res = analyzeWalletCost({
      userAddresses: [USER_ABS],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
      config: { ...DEFAULT_PRICING_CONFIG, preset: "app_store" },
    });

    expect(res.summary.paidDigitalMints).toBe(1);
    expect(res.summary.spinsSent).toBe(1);
    expect(res.summary.spinsReceived).toBe(1);
    expect(res.summary.currentlyHeld).toBe(1);
    expect(res.summary.digitalShopUsd).toBe(3.29);
    expect(res.activities.some((a) => a.category === "spin")).toBe(true);
  });

  it("applies Web Shop bulk tier pricing for multi-card pack transactions post-Sep 2024", () => {
    // 8-pack minted in a single Abstract tx
    const logs: WalletTransferLog[] = Array.from({ length: 8 }, (_, idx) => ({
      chain: "abstract" as const,
      txHash: "0xpack8",
      logIndex: idx,
      blockNumber: 89_500_000,
      timestamp: "2026-11-21T18:42:15Z",
      from: ZERO_ADDRESS,
      to: USER_ABS,
      tokenId: 31_184_874 + idx,
    }));

    const meta = new Map<number, WalletTokenMetadata>(
      logs.map((l, idx) => [
        l.tokenId,
        mkMeta(l.tokenId, { collectionNo: `10${idx + 1}Z` }),
      ]),
    );

    const blended = analyzeWalletCost({
      userAddresses: [USER_ABS],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
      config: { ...DEFAULT_PRICING_CONFIG, preset: "blended" },
    });

    // 8-pack in blended mode uses Web Shop 8-pack rate ($2.25 * 8 = $18.00)
    expect(blended.summary.paidDigitalMints).toBe(8);
    expect(blended.summary.paidMintTransactions).toBe(1);
    expect(blended.summary.digitalShopUsd).toBe(18);
    expect(blended.summary.digitalShopLowUsd).toBe(18);
    expect(blended.summary.digitalShopHighUsd).toBe(23.92); // $2.99 * 8 App Store multi-pack
  });

  it("prices Welcome (100Z), online Grid Special Class (2xxZ), and reciprocal trades at $0 cash", () => {
    const logs: WalletTransferLog[] = [
      // Free Welcome
      {
        chain: "abstract",
        txHash: "0xwelcome",
        logIndex: 0,
        blockNumber: 10_000_000,
        timestamp: "2025-05-01T10:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 10_000_010,
      },
      // Free Grid SCO
      {
        chain: "abstract",
        txHash: "0xgrid",
        logIndex: 0,
        blockNumber: 10_000_010,
        timestamp: "2025-05-01T10:01:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 10_000_011,
      },
      // Physical DCO QR Scan (OMA)
      {
        chain: "abstract",
        txHash: "0xoma",
        logIndex: 0,
        blockNumber: 10_000_020,
        timestamp: "2025-05-01T10:02:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 10_000_012,
      },
      // Reciprocal Trade (USER_ABS sends 10_000_012, FRIEND sends 10_000_099 2 min later)
      {
        chain: "abstract",
        txHash: "0xtrade1",
        logIndex: 0,
        blockNumber: 10_000_100,
        timestamp: "2025-05-01T11:00:00Z",
        from: USER_ABS,
        to: FRIEND,
        tokenId: 10_000_012,
      },
      {
        chain: "abstract",
        txHash: "0xtrade2",
        logIndex: 0,
        blockNumber: 10_000_220,
        timestamp: "2025-05-01T11:02:00Z",
        from: FRIEND,
        to: USER_ABS,
        tokenId: 10_000_099,
      },
    ];

    const meta = new Map<number, WalletTokenMetadata>([
      [10_000_010, mkMeta(10_000_010, { objektClass: "Welcome", collectionNo: "100Z" })],
      [10_000_011, mkMeta(10_000_011, { objektClass: "Special", collectionNo: "201Z" })],
      [10_000_012, mkMeta(10_000_012, { objektClass: "Double", collectionNo: "301A", onOffline: "offline" })],
      [10_000_099, mkMeta(10_000_099, { objektClass: "Double", collectionNo: "302A", onOffline: "offline", memberName: "SeoYeon" })],
    ]);

    const withPhysical = analyzeWalletCost({
      userAddresses: [USER_ABS],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
      config: { ...DEFAULT_PRICING_CONFIG, includePhysicalScans: true },
    });

    expect(withPhysical.summary.freeRewards).toBe(2);
    expect(withPhysical.summary.physicalScans).toBe(1);
    expect(withPhysical.summary.confirmedTradeSwaps).toBe(1);
    expect(withPhysical.summary.digitalShopUsd).toBe(0);
    expect(withPhysical.summary.physicalScansUsd).toBe(5.5);
    expect(withPhysical.summary.estimatedTotalUsd).toBe(5.5);
    expect(withPhysical.summary.currentlyHeld).toBe(3);

    const digitalOnly = analyzeWalletCost({
      userAddresses: [USER_ABS],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
      config: { ...DEFAULT_PRICING_CONFIG, includePhysicalScans: false },
    });
    expect(digitalOnly.summary.estimatedTotalUsd).toBe(0);
  });

  it("detects COSMO Talk All-Member Pass+ across split claim txs and prices subscription without double-counting", () => {
    const members24 = Array.from({ length: 24 }, (_, i) => `Member${i + 1}`);

    // Simulate Kirky's Oct 15, 2026 Cream02 362Z drop split across 2 txs (4 + 20 = 24)
    const logs: WalletTransferLog[] = members24.map((_, i) => ({
      chain: "abstract",
      txHash: i < 4 ? "0xpass_tx_1" : "0xpass_tx_2",
      logIndex: i,
      blockNumber: 80_000_000 + (i < 4 ? 0 : 1),
      timestamp: "2026-10-15T08:37:49Z",
      from: ZERO_ADDRESS,
      to: USER_ABS,
      tokenId: 30_267_500 + i,
    }));

    // Plus 1 traded-in 376Z card from a friend (should NOT trigger a second subscription!)
    logs.push({
      chain: "abstract",
      txHash: "0xp2p_376",
      logIndex: 0,
      blockNumber: 88_000_000,
      timestamp: "2026-11-16T10:00:00Z",
      from: FRIEND,
      to: USER_ABS,
      tokenId: 31_028_999,
    });

    const meta = new Map<number, WalletTokenMetadata>(
      members24.map((name, i) => [
        30_267_500 + i,
        mkMeta(30_267_500 + i, {
          season: "Cream02",
          objektClass: "Double",
          collectionNo: "362Z",
          memberName: name,
        }),
      ]),
    );
    meta.set(
      31_028_999,
      mkMeta(31_028_999, {
        season: "Cream02",
        objektClass: "Double",
        collectionNo: "376Z",
        memberName: "Kotone",
      }),
    );

    const res = analyzeWalletCost({
      userAddresses: [USER_ABS],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
      config: { ...DEFAULT_PRICING_CONFIG, includeSubscriptions: true },
    });

    expect(res.summary.subscriptionMonths).toBe(1);
    expect(res.summary.subscriptionObjekts).toBe(24);
    expect(res.summary.detectedSubscriptionTier).toBe("All-Member Pass+ (24)");
    expect(res.summary.subscriptionsUsd).toBe(90);
    expect(res.subscriptions[0]?.perMemberUsd).toBe(3.75);
    expect(res.summary.paidDigitalMints).toBe(0); // Never double-counted in Digital Shop!
    expect(res.summary.digitalShopUsd).toBe(0);
    expect(res.summary.estimatedTotalUsd).toBe(90);
    expect(res.subscriptions).toHaveLength(1);
    expect(res.activities.some((a) => a.category === "cosmo_talk_pass")).toBe(true);

    // Toggling off subscriptions removes it cleanly from estimatedTotalUsd
    const excluded = analyzeWalletCost({
      userAddresses: [USER_ABS],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
      config: { ...DEFAULT_PRICING_CONFIG, includeSubscriptions: false },
    });
    expect(excluded.summary.estimatedTotalUsd).toBe(0);
  });

  it("deduces 4-Member Pass+ on curated collections and auto-infers future post-Nov 2026 All-Member Pass+ months", () => {
    // 4-Member Pass+ on curated Cream02 376Z
    const logs: WalletTransferLog[] = ["SeoYeon", "YooYeon", "Kotone", "SoHyun"].map(
      (_, idx) => ({
        chain: "abstract",
        txHash: "0xpass4",
        logIndex: idx,
        blockNumber: 89_000_000,
        timestamp: "2026-11-15T09:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 31_000_000 + idx,
      }),
    );

    // Future Dec 15, 2026 unknown collection 399Z with 24 distinct members -> auto-inferred All-Member Pass+
    const futureMembers = Array.from({ length: 24 }, (_, i) => `S${i + 1}`);
    for (let i = 0; i < 24; i++) {
      logs.push({
        chain: "abstract",
        txHash: "0xfuture24",
        logIndex: i,
        blockNumber: 92_000_000,
        timestamp: "2026-12-15T08:05:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 35_000_000 + i,
      });
    }

    const meta = new Map<number, WalletTokenMetadata>();
    ["SeoYeon", "YooYeon", "Kotone", "SoHyun"].forEach((name, idx) => {
      meta.set(
        31_000_000 + idx,
        mkMeta(31_000_000 + idx, {
          season: "Cream02",
          objektClass: "Double",
          collectionNo: "376Z",
          memberName: name,
        }),
      );
    });
    futureMembers.forEach((name, idx) => {
      meta.set(
        35_000_000 + idx,
        mkMeta(35_000_000 + idx, {
          season: "Cream02",
          objektClass: "Double",
          collectionNo: "399Z",
          memberName: name,
        }),
      );
    });

    const res = analyzeWalletCost({
      userAddresses: [USER_ABS],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
    });

    expect(res.summary.subscriptionMonths).toBe(2);
    expect(res.summary.subscriptionsUsd).toBe(107.49); // $17.49 (4-Member @ $4.37/ea) + $90.00 (All-Member 24 @ $3.75/ea)
    expect(res.subscriptions.find((s) => s.collectionNo === "376Z")?.tierLabel).toBe(
      "4-Member Pass+",
    );
    expect(res.subscriptions.find((s) => s.collectionNo === "376Z")?.perMemberUsd).toBe(4.37);
    expect(res.subscriptions.find((s) => s.collectionNo === "399Z")?.isInferred).toBe(
      true,
    );
  });

  it("models strictly decreasing per-member Pass+ tier economics and stacked tiers (e.g. 6=4+2, 12=8+4)", () => {
    const runTier = (count: number) => {
      const logs: WalletTransferLog[] = Array.from({ length: count }, (_, i) => ({
        chain: "abstract",
        txHash: `0xpass_${count}`,
        logIndex: i,
        blockNumber: 89_000_000,
        timestamp: "2026-11-15T09:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 31_100_000 + i,
      }));
      const meta = new Map<number, WalletTokenMetadata>(
        logs.map((l, i) => [
          l.tokenId,
          mkMeta(l.tokenId, {
            season: "Cream02",
            objektClass: "Double",
            collectionNo: "376Z",
            memberName: `S${i + 1}`,
          }),
        ]),
      );
      return analyzeWalletCost({
        userAddresses: [USER_ABS],
        logs,
        metadataByTokenId: meta,
        polygonLoaded: true,
      }).subscriptions[0]!;
    };

    const t1 = runTier(1);
    const t2 = runTier(2);
    const t4 = runTier(4);
    const t8 = runTier(8);
    const t24 = runTier(24);
    const t6 = runTier(6);
    const t12 = runTier(12);

    // Strictly more economical per member at every larger official tier
    expect(t1.perMemberUsd).toBeGreaterThan(t2.perMemberUsd);
    expect(t2.perMemberUsd).toBeGreaterThan(t4.perMemberUsd);
    expect(t4.perMemberUsd).toBeGreaterThan(t8.perMemberUsd);
    expect(t8.perMemberUsd).toBeGreaterThan(t24.perMemberUsd);

    expect(t1.estimatedUsd).toBe(4.89);
    expect(t2.estimatedUsd).toBe(9.19);
    expect(t4.estimatedUsd).toBe(17.49);
    expect(t8.estimatedUsd).toBe(32.99);
    expect(t24.estimatedUsd).toBe(90);

    // Stacked intermediate counts use minimum-cost tier combinations
    expect(t6.tierLabel).toBe("6-Member Pass+ (4+2)");
    expect(t6.estimatedUsd).toBe(26.68);
    expect(t12.tierLabel).toBe("12-Member Pass+ (8+4)");
    expect(t12.estimatedUsd).toBe(50.48);
  });

  it("tracks Grids Completed across Polygon + Abstract, locks FCOs per edition, and excludes traded-in SCOs", () => {
    const logs: WalletTransferLog[] = [
      // Polygon-era 1st Ed grid SCO (8 FCOs locked), migrated to Abstract
      {
        chain: "polygon",
        txHash: "0xpoly_grid",
        logIndex: 0,
        blockNumber: 60_000_000,
        timestamp: "2024-09-10T10:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_POLY,
        tokenId: 5_000_001,
      },
      {
        chain: "abstract",
        txHash: "0xmig_grid",
        logIndex: 0,
        blockNumber: 6_881_200,
        timestamp: "2025-04-16T12:10:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 5_000_001,
      },
      // Abstract-era 3rd Ed grid SCO (4 FCOs locked)
      {
        chain: "abstract",
        txHash: "0xabs_grid_ed3",
        logIndex: 0,
        blockNumber: 89_100_000,
        timestamp: "2026-11-18T14:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 31_000_501,
      },
      // Traded-in / P2P SCO (should NOT count as a grid completed by this user!)
      {
        chain: "abstract",
        txHash: "0xp2p_sco",
        logIndex: 0,
        blockNumber: 89_200_000,
        timestamp: "2026-11-19T14:00:00Z",
        from: FRIEND,
        to: USER_ABS,
        tokenId: 31_000_502,
      },
      // Non-grid promo SCO 207Z (should NOT count as a standard grid completion)
      {
        chain: "abstract",
        txHash: "0xpromo_sco",
        logIndex: 0,
        blockNumber: 89_300_000,
        timestamp: "2026-11-20T14:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 31_000_503,
      },
    ];

    const meta = new Map<number, WalletTokenMetadata>([
      [
        5_000_001,
        mkMeta(5_000_001, {
          season: "Divine01",
          objektClass: "Special",
          collectionNo: "201Z",
          memberName: "SeoYeon",
        }),
      ],
      [
        31_000_501,
        mkMeta(31_000_501, {
          season: "Cream02",
          objektClass: "Special",
          collectionNo: "205Z",
          memberName: "YooYeon",
        }),
      ],
      [
        31_000_502,
        mkMeta(31_000_502, {
          season: "Cream02",
          objektClass: "Special",
          collectionNo: "206Z",
          memberName: "YooYeon",
        }),
      ],
      [
        31_000_503,
        mkMeta(31_000_503, {
          season: "Divine01",
          objektClass: "Special",
          collectionNo: "207Z",
          memberName: "Kotone",
        }),
      ],
    ]);

    const res = analyzeWalletCost({
      userAddresses: [USER_ABS, USER_POLY],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
    });

    expect(res.summary.gridsCompleted).toBe(2);
    expect(res.summary.gridsCompletedPolygon).toBe(1);
    expect(res.summary.gridsCompletedAbstract).toBe(1);
    expect(res.summary.gridsEd1Count).toBe(1);
    expect(res.summary.gridsEd3Count).toBe(1);
    expect(res.summary.gridFcosLocked).toBe(12); // 8 + 4
    expect(res.summary.heldScoCount).toBe(4);
    expect(res.gridBreakdown).toHaveLength(2);
    expect(res.activities.filter((a) => a.isGridReward)).toHaveLength(2);
    expect(res.memberBreakdown.find((m) => m.memberName === "YooYeon")?.gridsCompleted).toBe(1);
  });

  it("uses Apollo provenance to auto-detect unseen Pass+ drops, price free promotional/bonus DCOs at $0, and compute market value", () => {
    const logs: WalletTransferLog[] = [
      // 1. Free promotional 1st-win gift (Atom02 320Z)
      {
        chain: "abstract",
        txHash: "0xwin1",
        logIndex: 0,
        blockNumber: 12_000_000,
        timestamp: "2025-05-22T09:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 12_000_001,
      },
      // 2. Unlisted future Pass+ drop (2 members -> 2-Member Pass+ = $9.19, NOT in KNOWN_COSMO_TALK_PASS_COLLECTIONS!)
      {
        chain: "abstract",
        txHash: "0xpass_nov",
        logIndex: 0,
        blockNumber: 92_000_000,
        timestamp: "2026-12-15T08:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 35_000_001,
      },
      {
        chain: "abstract",
        txHash: "0xpass_nov",
        logIndex: 1,
        blockNumber: 92_000_000,
        timestamp: "2026-12-15T08:00:00Z",
        from: ZERO_ADDRESS,
        to: USER_ABS,
        tokenId: 35_000_002,
      },
    ];

    const meta = new Map<number, WalletTokenMetadata>([
      [
        12_000_001,
        mkMeta(12_000_001, {
          season: "Atom02",
          objektClass: "Double",
          collectionNo: "320Z",
          memberName: "Lynn",
        }),
      ],
      [
        35_000_001,
        mkMeta(35_000_001, {
          season: "Cream02",
          objektClass: "Double",
          collectionNo: "399Z",
          memberName: "YooYeon",
        }),
      ],
      [
        35_000_002,
        mkMeta(35_000_002, {
          season: "Cream02",
          objektClass: "Double",
          collectionNo: "399Z",
          memberName: "NaKyoung",
        }),
      ],
    ]);

    const apolloDrops = new Map([
      [
        "triples|atom02|320Z",
        {
          dropKey: "triples|atom02|320Z",
          sampleApolloSlug: "atom02-lynn-320z",
          artistId: "triples",
          season: "Atom02",
          collectionNo: "320Z",
          description:
            "Gifted on May 22, 2025 to everyone who participated in THE SHOW Pre-voting or Live Voting.",
          eventSlug: "triples-are-you-alive-1st-win",
          eventName: "Are You Alive 1st Win",
          eventType: "promotional",
          eventDescription: null,
          twitterUrl: "https://x.com/triplescosmos/status/1924797263680835893",
          eraSlug: "assemble25",
          eraName: "<ASSEMBLE25>",
          eraImageUrl: null,
          provenanceClass: "free_reward" as const,
          passBillingMonth: null,
          passBillingLabel: null,
          isFreeDistribution: true,
        },
      ],
      [
        "triples|cream02|399Z",
        {
          dropKey: "triples|cream02|399Z",
          sampleApolloSlug: "cream02-yooyeon-399z",
          artistId: "triples",
          season: "Cream02",
          collectionNo: "399Z",
          description: "Gifted to tripleS Pass+ subscribers for November 2026.",
          eventSlug: "triples-pass-november-2026",
          eventName: "tripleS Pass+ November 2026",
          eventType: "merch",
          eventDescription: "Part of the tripleS Pass+ subscription",
          twitterUrl: null,
          eraSlug: "lovepop-pt2",
          eraName: "<LOVE&POP> pt.2",
          eraImageUrl: null,
          provenanceClass: "pass_plus" as const,
          passBillingMonth: "2026-11",
          passBillingLabel: "Nov 2026 tripleS Pass+",
          isFreeDistribution: false,
        },
      ],
    ]);

    const apolloCols = new Map([
      [
        "atom02-lynn-320z",
        {
          apolloSlug: "atom02-lynn-320z",
          dropKey: "triples|atom02|320Z",
          totalCopies: 527,
          transferableCopies: 281,
          transferablePct: 53.32,
          unobtainable: false,
          description: "Gifted on May 22, 2025...",
          eventSlug: "triples-are-you-alive-1st-win",
          eventName: "Are You Alive 1st Win",
          eventType: "promotional",
          eventDescription: null,
          twitterUrl: null,
          eraSlug: "assemble25",
          eraName: "<ASSEMBLE25>",
          eraImageUrl: null,
          medianPriceUsd: 9.13,
          minPriceUsd: 5.5,
          maxPriceUsd: 12.76,
          listingCount: 2,
          priceUpdatedAt: "2026-11-23T16:00:00Z",
        },
      ],
    ]);

    const res = analyzeWalletCost({
      userAddresses: [USER_ABS],
      logs,
      metadataByTokenId: meta,
      polygonLoaded: true,
      apolloDropByKey: apolloDrops,
      apolloCollectionBySlug: apolloCols,
    });

    expect(res.summary.paidDigitalMints).toBe(0);
    expect(res.summary.digitalShopUsd).toBe(0);
    expect(res.summary.freeRewards).toBe(1);
    expect(res.summary.apolloFreeRewardsCount).toBe(1);
    expect(res.summary.subscriptionMonths).toBe(1);
    expect(res.summary.subscriptionsUsd).toBe(9.19);
    expect(res.subscriptions[0]?.billingLabel).toBe("Nov 2026 tripleS Pass+");
    expect(res.subscriptions[0]?.isInferred).toBe(false);
    expect(res.summary.estimatedMarketValueUsd).toBe(9.13);
    expect(res.summary.marketPricedHeldCount).toBe(1);
    expect(res.activities.find((a) => a.category === "free_reward")?.apolloEventName).toBe(
      "Are You Alive 1st Win",
    );
  });
});
