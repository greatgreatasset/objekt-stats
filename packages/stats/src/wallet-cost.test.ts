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
    expect(res.summary.subscriptionsUsd).toBe(96);
    expect(res.summary.paidDigitalMints).toBe(0); // Never double-counted in Digital Shop!
    expect(res.summary.digitalShopUsd).toBe(0);
    expect(res.summary.estimatedTotalUsd).toBe(96);
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
    expect(res.summary.subscriptionsUsd).toBe(112.99); // $16.99 (4-Member) + $96.00 (All-Member 24)
    expect(res.subscriptions.find((s) => s.collectionNo === "376Z")?.tierLabel).toBe(
      "4-Member Pass+",
    );
    expect(res.subscriptions.find((s) => s.collectionNo === "399Z")?.isInferred).toBe(
      true,
    );
  });
});
