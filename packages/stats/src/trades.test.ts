import { describe, expect, it } from "vitest";
import {
  COSMO_SPIN_ADDRESS,
  DEAD_ADDRESS,
  ZERO_ADDRESS,
  classifyTradeSymmetry,
  computeMemberTradeRankings,
  detectTradesFromTransfers,
  isEligibleP2PTransfer,
  isSameClassSwap,
  type P2PTransferEvent,
} from "./trades.js";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const CAROL = "0x3333333333333333333333333333333333333333";

function makeTx(
  overrides: Partial<P2PTransferEvent> & {
    from: string;
    to: string;
    tokenId: number;
    transferredAt: string;
  },
): P2PTransferEvent {
  return {
    txHash: `0x${overrides.tokenId.toString(16).padStart(64, "0")}`,
    logIndex: 0,
    chain: "abstract",
    blockNumber: 89_600_000,
    ...overrides,
  };
}

describe("detectTradesFromTransfers", () => {
  it("detects a classic 1-for-1 reciprocal swap within 30 minutes", () => {
    const res = detectTradesFromTransfers([
      makeTx({
        from: ALICE,
        to: BOB,
        tokenId: 1001,
        transferredAt: "2026-11-23T10:00:00.000Z",
      }),
      makeTx({
        from: BOB,
        to: ALICE,
        tokenId: 2002,
        transferredAt: "2026-11-23T10:02:30.000Z",
      }),
    ]);

    expect(res.eligibleTransfers).toHaveLength(2);
    expect(res.trades).toHaveLength(1);
    expect(res.nonTradeTransfers).toHaveLength(0);
    expect(res.trades[0]!.sideALegs).toHaveLength(1);
    expect(res.trades[0]!.sideBLegs).toHaveLength(1);
    expect(res.trades[0]!.durationSeconds).toBe(150);
    expect(res.trades[0]!.responseGapSeconds).toBe(150);
  });

  it("detects multi-card asymmetric trades (e.g. 3-for-1 rare swap)", () => {
    const res = detectTradesFromTransfers([
      makeTx({ from: ALICE, to: BOB, tokenId: 101, transferredAt: "2026-11-23T10:00:00.000Z" }),
      makeTx({ from: ALICE, to: BOB, tokenId: 102, transferredAt: "2026-11-23T10:00:30.000Z" }),
      makeTx({ from: ALICE, to: BOB, tokenId: 103, transferredAt: "2026-11-23T10:01:00.000Z" }),
      makeTx({ from: BOB, to: ALICE, tokenId: 999, transferredAt: "2026-11-23T10:05:00.000Z" }),
    ]);

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0]!.allLegs).toHaveLength(4);
    expect(res.trades[0]!.sideALegs).toHaveLength(3);
    expect(res.trades[0]!.sideBLegs).toHaveLength(1);
    expect(res.trades[0]!.durationSeconds).toBe(300);
  });

  it("excludes mints (0x0), burns, COSMO spins, and self-transfers completely", () => {
    expect(isEligibleP2PTransfer(ZERO_ADDRESS, ALICE)).toBe(false);
    expect(isEligibleP2PTransfer(ALICE, ZERO_ADDRESS)).toBe(false);
    expect(isEligibleP2PTransfer(ALICE, DEAD_ADDRESS)).toBe(false);
    expect(isEligibleP2PTransfer(ALICE, COSMO_SPIN_ADDRESS)).toBe(false);
    expect(isEligibleP2PTransfer(COSMO_SPIN_ADDRESS, ALICE)).toBe(false);
    expect(isEligibleP2PTransfer(ALICE, ALICE)).toBe(false);

    const res = detectTradesFromTransfers([
      // Mint + burn look-alike
      makeTx({ from: ZERO_ADDRESS, to: ALICE, tokenId: 1, transferredAt: "2026-11-23T10:00:00.000Z" }),
      makeTx({ from: ALICE, to: ZERO_ADDRESS, tokenId: 2, transferredAt: "2026-11-23T10:00:10.000Z" }),
      // Spin look-alike
      makeTx({ from: ALICE, to: COSMO_SPIN_ADDRESS, tokenId: 3, transferredAt: "2026-11-23T10:00:20.000Z" }),
      makeTx({ from: COSMO_SPIN_ADDRESS, to: ALICE, tokenId: 4, transferredAt: "2026-11-23T10:00:25.000Z" }),
      // Self transfer
      makeTx({ from: ALICE, to: ALICE, tokenId: 5, transferredAt: "2026-11-23T10:00:30.000Z" }),
    ]);

    expect(res.eligibleTransfers).toHaveLength(0);
    expect(res.trades).toHaveLength(0);
    expect(res.nonTradeTransfers).toHaveLength(0);
  });

  it("does NOT classify one-way transfers (gifts / alt moves / OTC sales) as trades", () => {
    const res = detectTradesFromTransfers([
      makeTx({ from: ALICE, to: BOB, tokenId: 11, transferredAt: "2026-11-23T10:00:00.000Z" }),
      makeTx({ from: ALICE, to: BOB, tokenId: 12, transferredAt: "2026-11-23T10:00:20.000Z" }),
      makeTx({ from: ALICE, to: BOB, tokenId: 13, transferredAt: "2026-11-23T10:00:40.000Z" }),
    ]);

    expect(res.eligibleTransfers).toHaveLength(3);
    expect(res.trades).toHaveLength(0);
    expect(res.nonTradeTransfers).toHaveLength(3);
  });

  it("rejects bounce-backs where the same tokenId is simply returned", () => {
    const res = detectTradesFromTransfers([
      makeTx({ from: ALICE, to: BOB, tokenId: 42, transferredAt: "2026-11-23T10:00:00.000Z" }),
      makeTx({
        from: BOB,
        to: ALICE,
        tokenId: 42,
        txHash: "0x" + "b".repeat(64),
        transferredAt: "2026-11-23T10:01:00.000Z",
      }),
    ]);

    expect(res.eligibleTransfers).toHaveLength(2);
    expect(res.trades).toHaveLength(0);
    expect(res.nonTradeTransfers).toHaveLength(2);
  });

  it("splits separate sessions when transfers occur further apart than maxGapSeconds", () => {
    const res = detectTradesFromTransfers([
      // Session 1: 10:00 -> 10:02 (confirmed trade)
      makeTx({ from: ALICE, to: BOB, tokenId: 10, transferredAt: "2026-11-23T10:00:00.000Z" }),
      makeTx({ from: BOB, to: ALICE, tokenId: 20, transferredAt: "2026-11-23T10:02:00.000Z" }),
      // Session 2: 2 hours later, only one-way transfer
      makeTx({ from: ALICE, to: BOB, tokenId: 30, transferredAt: "2026-11-23T12:05:00.000Z" }),
      // Session 3: 4 hours later, opposite direction only (>30 min after Session 2)
      makeTx({ from: BOB, to: ALICE, tokenId: 40, transferredAt: "2026-11-23T14:05:00.000Z" }),
      // Unrelated pair Alice <-> Carol at 10:01
      makeTx({ from: ALICE, to: CAROL, tokenId: 50, transferredAt: "2026-11-23T10:01:00.000Z" }),
      makeTx({ from: CAROL, to: ALICE, tokenId: 60, transferredAt: "2026-11-23T10:03:00.000Z" }),
    ]);

    expect(res.trades).toHaveLength(2);
    expect(res.nonTradeTransfers).toHaveLength(2);
  });

  it("deduplicates overlapping (txHash, logIndex) entries cleanly", () => {
    const tx1 = makeTx({ from: ALICE, to: BOB, tokenId: 100, transferredAt: "2026-11-23T10:00:00.000Z" });
    const tx2 = makeTx({ from: BOB, to: ALICE, tokenId: 200, transferredAt: "2026-11-23T10:01:00.000Z" });
    const res = detectTradesFromTransfers([tx1, tx1, tx2, tx2]);

    expect(res.eligibleTransfers).toHaveLength(2);
    expect(res.trades).toHaveLength(1);
    expect(res.trades[0]!.allLegs).toHaveLength(2);
  });
});

describe("computeMemberTradeRankings", () => {
  it("computes competition rank, sharePct, and relativeIndex accurately", () => {
    const ranked = computeMemberTradeRankings([
      { memberId: "triples-yooyeon", tradedCount: 300 },
      { memberId: "triples-seoyeon", tradedCount: 200 },
      { memberId: "triples-nakyoung", tradedCount: 100 },
    ]);

    expect(ranked[0]).toMatchObject({
      memberId: "triples-yooyeon",
      tradeRank: 1,
      tradeSharePct: 50,
      tradeRelativeIndex: 1.5,
    });
    expect(ranked[1]).toMatchObject({
      memberId: "triples-seoyeon",
      tradeRank: 2,
      tradeRelativeIndex: 1,
    });
    expect(ranked[2]).toMatchObject({
      memberId: "triples-nakyoung",
      tradeRank: 3,
      tradeRelativeIndex: 0.5,
    });
  });
});

describe("classifyTradeSymmetry & isSameClassSwap", () => {
  it("identifies equal vs 2:1 / 3:1 / 3:2 asymmetric swaps and preserves 1.00 market parity", () => {
    const eq = classifyTradeSymmetry(1, 1);
    expect(eq.isAsymmetric).toBe(false);
    expect(eq.premiumSide).toBeNull();
    expect(eq.ratioMultiple).toBe(1);
    expect(eq.ratioLabel).toBe("1:1");

    const swap3to1 = classifyTradeSymmetry(1, 3);
    expect(swap3to1.isAsymmetric).toBe(true);
    expect(swap3to1.premiumSide).toBe("A");
    expect(swap3to1.sideAExchangeRate).toBe(3);
    expect(swap3to1.sideBExchangeRate).toBeCloseTo(0.3333, 3);
    expect(swap3to1.is2to1Plus).toBe(true);
    expect(swap3to1.is3to1Plus).toBe(true);
    expect(swap3to1.ratioLabel).toBe("3:1");

    // Market-wide leg-weighted mean exchange rate equals 1.00
    const legSum = 1 * swap3to1.sideAExchangeRate + 3 * swap3to1.sideBExchangeRate;
    expect(legSum / 4).toBeCloseTo(1.0, 3);

    const swap3to2 = classifyTradeSymmetry(3, 2);
    expect(swap3to2.isAsymmetric).toBe(true);
    expect(swap3to2.premiumSide).toBe("B");
    expect(swap3to2.ratioMultiple).toBe(1.5);
    expect(swap3to2.is2to1Plus).toBe(false);
    expect(swap3to2.ratioLabel).toBe("3:2");
  });

  it("distinguishes same-class swaps from cross-class rarity upgrades", () => {
    expect(isSameClassSwap(["First"], ["First", "First", "First"])).toBe(true);
    expect(isSameClassSwap(["Special"], ["First", "First", "First"])).toBe(false);
    expect(isSameClassSwap(["First", "Double"], ["First"])).toBe(false);
    expect(isSameClassSwap([], ["First"])).toBe(false);
  });
});
