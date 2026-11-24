import { describe, expect, it } from "vitest";
import {
  DEFAULT_EARNINGS_CONFIG,
  classifyCollectionForEarnings,
  computeMemberEarnings,
  getSeasonCoverageInfo,
  type EarningsMemberInfo,
  type EarningsMemberSeasonRow,
  type EarningsSeasonInput,
} from "./earnings.js";

const MEMBERS: EarningsMemberInfo[] = [
  {
    id: "triples-seoyeon",
    code: "S1",
    memberOrder: 1,
    name: "SeoYeon",
    fullName: "Yoon SeoYeon",
    hexColor: "#22AEFF",
    revealDate: "2022-05-01",
  },
  {
    id: "triples-sullin",
    code: "S22",
    memberOrder: 22,
    name: "Sullin",
    fullName: "Pirada Bunraksa",
    hexColor: "#7BBA8D",
    revealDate: "2024-04-02",
  },
];

describe("classifyCollectionForEarnings", () => {
  it("excludes native free classes (Welcome, online Special SCO, Zero, online Premier PCO)", () => {
    expect(
      classifyCollectionForEarnings({
        objektClass: "Welcome",
        onOffline: "online",
        collectionNo: "100Z",
      }),
    ).toBe("free");
    expect(
      classifyCollectionForEarnings({
        objektClass: "Special",
        onOffline: "online",
        collectionNo: "201Z",
      }),
    ).toBe("free");
    expect(
      classifyCollectionForEarnings({
        objektClass: "Premier",
        onOffline: "online",
        collectionNo: "401Z",
        apolloProvenanceClass: "shop_paid",
      }),
    ).toBe("free");
    expect(
      classifyCollectionForEarnings({
        objektClass: "Zero",
        onOffline: "online",
        collectionNo: "001Z",
      }),
    ).toBe("free");
  });

  it("classifies Pass+ subscriptions, Apollo free rewards, physical scans, and paid classes", () => {
    expect(
      classifyCollectionForEarnings({
        objektClass: "Double",
        onOffline: "online",
        collectionNo: "358Z",
        apolloProvenanceClass: "pass_plus",
      }),
    ).toBe("pass_plus");
    expect(
      classifyCollectionForEarnings({
        objektClass: "Double",
        onOffline: "online",
        collectionNo: "320Z",
        apolloProvenanceClass: "free_reward",
      }),
    ).toBe("free");
    expect(
      classifyCollectionForEarnings({
        objektClass: "Double",
        onOffline: "offline",
        collectionNo: "301A",
      }),
    ).toBe("physical");
    expect(
      classifyCollectionForEarnings({
        objektClass: "First",
        onOffline: "online",
        collectionNo: "101Z",
      }),
    ).toBe("fco");
    expect(
      classifyCollectionForEarnings({
        objektClass: "Motion",
        onOffline: "online",
        collectionNo: "501Z",
        apolloProvenanceClass: "shop_paid",
      }),
    ).toBe("mco");
  });
});

describe("getSeasonCoverageInfo", () => {
  it("marks Binary02/Cream02 (tripleS) and Ever01/Atom02 (ARTMS) as full coverage with 90.63% spin FCO rate", () => {
    const b2 = getSeasonCoverageInfo("triples", "Binary02");
    expect(b2.coverage).toBe("full");
    expect(b2.spinFcoReturnRate).toBe(0.9063);
    expect(b2.webShopShareFactor).toBe(1);

    const a1 = getSeasonCoverageInfo("triples", "Atom01");
    expect(a1.coverage).toBe("partial_polygon");
    expect(a1.webShopShareFactor).toBe(0);
    expect(a1.spinFcoReturnRate).toBe(0.875);

    const artmsEver = getSeasonCoverageInfo("artms", "Ever01");
    expect(artmsEver.coverage).toBe("full");
    expect(artmsEver.spinFcoReturnRate).toBe(0.9063);
  });
});

describe("computeMemberEarnings", () => {
  const seasons: EarningsSeasonInput[] = [
    {
      season: "Binary02",
      artistId: "triples",
      firstMintAt: "2025-11-13T01:00:00Z",
      lastMintAt: "2026-05-15T01:00:00Z",
      allClassSpins: 1000, // 1000 * 0.9063 = 906.3 spin FCOs -> 453 per member (2 members)
      fcoMemberCount: 2,
      totalRawFcoMints: 2500,
    },
    {
      season: "Atom01",
      artistId: "triples",
      firstMintAt: "2022-10-18T15:00:00Z",
      lastMintAt: "2023-05-01T00:00:00Z",
      allClassSpins: 100,
      fcoMemberCount: 2,
      totalRawFcoMints: 400,
    },
  ];

  const rows: EarningsMemberSeasonRow[] = [
    {
      season: "Binary02",
      memberId: "triples-seoyeon",
      rawFcoMints: 1500,
      paidDcoMints: 400,
      paidMcoMints: 100,
      paidUnitMints: 0,
      passPlusMints: 50,
      physicalMints: 200,
      freeExcludedMints: 300,
    },
    {
      season: "Binary02",
      memberId: "triples-sullin",
      rawFcoMints: 1000,
      paidDcoMints: 200,
      paidMcoMints: 50,
      paidUnitMints: 0,
      passPlusMints: 20,
      physicalMints: 200,
      freeExcludedMints: 300,
    },
    {
      season: "Atom01",
      memberId: "triples-seoyeon",
      rawFcoMints: 250,
      paidDcoMints: 10,
      paidMcoMints: 0,
      paidUnitMints: 0,
      passPlusMints: 0,
      physicalMints: 0,
      freeExcludedMints: 0,
    },
    {
      season: "Atom01",
      memberId: "triples-sullin",
      rawFcoMints: 150,
      paidDcoMints: 10,
      paidMcoMints: 0,
      paidUnitMints: 0,
      passPlusMints: 0,
      physicalMints: 0,
      freeExcludedMints: 0,
    },
  ];

  it("defaults to full-coverage seasons only and deducts uniform COSMO Spin FCO mints", () => {
    const res = computeMemberEarnings({
      artistId: "triples",
      members: MEMBERS,
      seasons,
      rows,
    });

    expect(res.selectedSeasons).toEqual(["Binary02"]);
    expect(res.hasPartialCoverageSeason).toBe(false);
    expect(res.members[0]!.member.id).toBe("triples-seoyeon");
    expect(res.members[0]!.estSpinFcoMints).toBe(453);
    expect(res.members[0]!.paidFcoMints).toBe(1047);
    expect(res.members[1]!.estSpinFcoMints).toBe(453);
    expect(res.members[1]!.paidFcoMints).toBe(547);

    // Verify waterfall conservation: gross = platformFees + modhaus + member
    const t = res.totals;
    expect(t.platformFeesUsd + t.totalModhausEarningsUsd + t.totalMemberEarningsUsd).toBeCloseTo(
      t.totalGrossUsd,
      1,
    );
  });

  it("respects toggling spin deduction, Pass+, physical scans, and member split %", () => {
    const withSpins = computeMemberEarnings({
      artistId: "triples",
      members: MEMBERS,
      seasons,
      rows,
      selectedSeasons: ["Binary02"],
      config: { ...DEFAULT_EARNINGS_CONFIG, memberSplitPct: 50 },
    });
    const withoutSpinDeduct = computeMemberEarnings({
      artistId: "triples",
      members: MEMBERS,
      seasons,
      rows,
      selectedSeasons: ["Binary02"],
      config: {
        ...DEFAULT_EARNINGS_CONFIG,
        memberSplitPct: 50,
        deductSpinMints: false,
        includePassPlus: false,
        includePhysicalScans: true,
      },
    });

    expect(withoutSpinDeduct.members[0]!.paidFcoMints).toBe(1500);
    expect(withoutSpinDeduct.members[0]!.passPlusGrossUsd).toBe(0);
    expect(withoutSpinDeduct.members[0]!.physicalGrossUsd).toBe(300);
    expect(withSpins.members[0]!.physicalGrossUsd).toBe(0);
    expect(withSpins.members[0]!.passPlusGrossUsd).toBeCloseTo(50 * 4.25, 2);
    // 50/50 net split -> member === modhaus
    expect(withSpins.totals.totalMemberEarningsUsd).toBeCloseTo(
      withSpins.totals.totalModhausEarningsUsd,
      1,
    );
  });

  it("enforces 100% App Store 30% fee on pre-Sep 2024 Polygon seasons", () => {
    const preWeb = computeMemberEarnings({
      artistId: "triples",
      members: MEMBERS,
      seasons,
      rows,
      selectedSeasons: ["Atom01"],
      config: {
        ...DEFAULT_EARNINGS_CONFIG,
        webShopSharePct: 100, // even if user sets 100% web shop, Atom01 predates shop.cosmo.fans!
        appStoreFeePct: 30,
        webPaymentFeePct: 4,
      },
    });

    expect(preWeb.hasPartialCoverageSeason).toBe(true);
    expect(preWeb.totals.effectiveFeePct).toBeCloseTo(30, 1);
  });

  it("never produces negative paidFcoMints when spins exceed a member's raw FCOs", () => {
    const res = computeMemberEarnings({
      artistId: "triples",
      members: MEMBERS,
      seasons: [
        {
          season: "Binary02",
          artistId: "triples",
          firstMintAt: "2025-11-13T01:00:00Z",
          lastMintAt: "2026-05-15T01:00:00Z",
          allClassSpins: 100_000,
          fcoMemberCount: 2,
          totalRawFcoMints: 200,
        },
      ],
      rows: [
        {
          season: "Binary02",
          memberId: "triples-seoyeon",
          rawFcoMints: 100,
          paidDcoMints: 10,
          paidMcoMints: 0,
          paidUnitMints: 0,
          passPlusMints: 0,
          physicalMints: 0,
          freeExcludedMints: 0,
        },
      ],
    });
    expect(res.members[0]!.paidFcoMints).toBe(0);
    expect(res.members[0]!.estSpinFcoMints).toBe(100);
  });
});
