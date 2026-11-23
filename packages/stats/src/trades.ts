import { getSwapEditionKey, getSwapGridTier } from "./grids.js";

/**
 * Pure TypeScript secondary trade detection engine for COSMO ERC-721 Objekt transfers.
 *
 * On-chain (Polygon & Abstract), COSMO only emits ERC-721 `Transfer(from, to, tokenId)`
 * events — there is no swap escrow smart contract. Users coordinate trades off-chain
 * and send Objekts directly to each other inside COSMO.
 *
 * Detection rules:
 * 1. Strictly excludes primary mints (`from === 0x0`), burns (`to === 0x0` / `0xdead`),
 *    COSMO Spin transfers (`from/to === SPIN`), contract addresses, and self-transfers.
 * 2. Groups eligible user-to-user (P2P) transfers by unordered wallet pair `{A, B}` on
 *    the same chain and sessionizes consecutive legs separated by <= `maxGapSeconds`
 *    (default 30 min) within a max session span of `maxSessionSpanSeconds` (default 60 min).
 * 3. Removes bounce-back tokens (same `tokenId` sent A -> B and immediately returned B -> A
 *    within the same session) so accidental sends/refunds are never misclassified as trades.
 * 4. A session is classified as a **Confirmed Trade** if and only if BOTH wallets sent at
 *    least 1 net distinct Objekt to the other (`netAtoB >= 1 && netBtoA >= 1`, meaning
 *    >= 2 distinct Objekts exchanged reciprocally in a short time window).
 * 5. One-way transfers (gifts, alt-wallet consolidation, OTC cash sales) are never counted
 *    as confirmed trades, though they are preserved separately as `directTransfers`.
 */

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
export const COSMO_SPIN_ADDRESS = "0xd3d5f29881ad87bb10c1100e2c709c9596de345f";
export const ABSTRACT_OBJEKT_CONTRACT = "0x99bb83ae9bb0c0a6be865cacf67760947f91cb70";
export const POLYGON_OBJEKT_CONTRACT = "0xa4b37be40f7b231ee9574c4b16b7ddb7eacdc99b";
export const POLYGON_ARTMS_OBJEKT_CONTRACT = "0x0fb69f54ba90f17578a59823e09e5a1f8f3fa200";

export const DEFAULT_EXCLUDED_TRADE_ADDRESSES = new Set<string>([
  ZERO_ADDRESS,
  DEAD_ADDRESS,
  COSMO_SPIN_ADDRESS,
  ABSTRACT_OBJEKT_CONTRACT,
  POLYGON_OBJEKT_CONTRACT,
  POLYGON_ARTMS_OBJEKT_CONTRACT,
]);

export const DEFAULT_TRADE_MAX_GAP_SECONDS = 1_800; // 30 minutes between consecutive legs
export const DEFAULT_TRADE_MAX_SPAN_SECONDS = 3_600; // 60 minutes max total session duration

/**
 * Guardrails against alt-wallet consolidations / OTC cash bulk moves masquerading
 * as extreme asymmetric trades (e.g. 66 cards sent one way, 1 random card sent back).
 */
export const MAX_ASYMMETRIC_PREMIUM_RATIO = 6;
export const MAX_ASYMMETRIC_SIDE_SIZE = 10;

export interface P2PTransferEvent {
  txHash: string;
  logIndex: number;
  chain: "polygon" | "abstract";
  blockNumber: number;
  transferredAt: string; // ISO UTC
  from: string;
  to: string;
  tokenId: number;
}

export interface TradeDetectionOptions {
  maxGapSeconds?: number;
  maxSessionSpanSeconds?: number;
  excludedAddresses?: Iterable<string>;
}

export interface DetectedTrade {
  tradeId: string;
  chain: "polygon" | "abstract";
  walletA: string;
  walletB: string;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  responseGapSeconds: number;
  sideALegs: P2PTransferEvent[]; // walletA -> walletB
  sideBLegs: P2PTransferEvent[]; // walletB -> walletA
  allLegs: P2PTransferEvent[];
}

export interface TradeDetectionResult {
  /** All eligible user-to-user P2P transfers (excludes mints, burns, spins, self-transfers). */
  eligibleTransfers: P2PTransferEvent[];
  /** Confirmed reciprocal trades (>= 1 net Objekt each way within window). */
  trades: DetectedTrade[];
  /** Eligible P2P transfers that did NOT qualify as a confirmed reciprocal trade. */
  nonTradeTransfers: P2PTransferEvent[];
  /** Set of transfer keys (`${txHash}:${logIndex}`) belonging to confirmed trades. */
  tradedTransferKeys: Set<string>;
}

export function makeTransferKey(txHash: string, logIndex: number): string {
  return `${txHash.toLowerCase()}:${logIndex}`;
}

export function makeWalletPairKey(
  chain: "polygon" | "abstract",
  addr1: string,
  addr2: string,
): { pairKey: string; walletA: string; walletB: string } {
  const a = addr1.toLowerCase();
  const b = addr2.toLowerCase();
  const [walletA, walletB] = a <= b ? [a, b] : [b, a];
  return { pairKey: `${chain}:${walletA}|${walletB}`, walletA, walletB };
}

export function isEligibleP2PTransfer(
  from: string,
  to: string,
  excluded: ReadonlySet<string> = DEFAULT_EXCLUDED_TRADE_ADDRESSES,
): boolean {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (!f || !t || f === t) return false;
  if (excluded.has(f) || excluded.has(t)) return false;
  return true;
}

export function shortenAddress(address: string): string {
  const clean = address.toLowerCase();
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`;
}

interface InternalTransfer {
  raw: P2PTransferEvent;
  ms: number;
  from: string;
  to: string;
  txHash: string;
}

function classifyPairSessions(
  chain: "polygon" | "abstract",
  walletA: string,
  walletB: string,
  items: InternalTransfer[],
  maxGapSeconds: number,
  maxSessionSpanSeconds: number,
  outTrades: DetectedTrade[],
  outNonTrade: P2PTransferEvent[],
  tradedKeys: Set<string>,
): void {
  items.sort(
    (x, y) =>
      x.ms - y.ms ||
      x.raw.blockNumber - y.raw.blockNumber ||
      x.raw.logIndex - y.raw.logIndex ||
      x.txHash.localeCompare(y.txHash),
  );

  // Split into contiguous time-window sessions
  const sessions: InternalTransfer[][] = [];
  let current: InternalTransfer[] = [];

  for (const item of items) {
    if (current.length === 0) {
      current.push(item);
      continue;
    }
    const prev = current[current.length - 1]!;
    const first = current[0]!;
    const gapSec = (item.ms - prev.ms) / 1000;
    const spanSec = (item.ms - first.ms) / 1000;

    if (gapSec <= maxGapSeconds && spanSec <= maxSessionSpanSeconds) {
      current.push(item);
    } else {
      sessions.push(current);
      current = [item];
    }
  }
  if (current.length > 0) {
    sessions.push(current);
  }

  for (const session of sessions) {
    const aToB: InternalTransfer[] = [];
    const bToA: InternalTransfer[] = [];
    for (const item of session) {
      if (item.from === walletA && item.to === walletB) {
        aToB.push(item);
      } else if (item.from === walletB && item.to === walletA) {
        bToA.push(item);
      }
    }

    if (aToB.length === 0 || bToA.length === 0) {
      for (const item of session) outNonTrade.push(item.raw);
      continue;
    }

    // Filter out bounce-back tokens (same tokenId sent A->B and B->A in the same session)
    const tokensAtoB = new Set(aToB.map((x) => x.raw.tokenId));
    const tokensBtoA = new Set(bToA.map((x) => x.raw.tokenId));
    const bouncedTokens = new Set<number>();
    for (const tokenId of tokensAtoB) {
      if (tokensBtoA.has(tokenId)) {
        bouncedTokens.add(tokenId);
      }
    }

    const netAtoB = aToB.filter((x) => !bouncedTokens.has(x.raw.tokenId));
    const netBtoA = bToA.filter((x) => !bouncedTokens.has(x.raw.tokenId));

    if (netAtoB.length === 0 || netBtoA.length === 0) {
      for (const item of session) outNonTrade.push(item.raw);
      continue;
    }

    // Record any bounced legs in this session as non-trade transfers
    for (const item of session) {
      if (bouncedTokens.has(item.raw.tokenId)) {
        outNonTrade.push(item.raw);
      }
    }

    const netAll = [...netAtoB, ...netBtoA].sort(
      (x, y) =>
        x.ms - y.ms ||
        x.raw.blockNumber - y.raw.blockNumber ||
        x.raw.logIndex - y.raw.logIndex ||
        x.txHash.localeCompare(y.txHash),
    );

    const first = netAll[0]!;
    const last = netAll[netAll.length - 1]!;
    const firstOpposite = netAll.find(
      (x) => x.from === first.to && x.to === first.from,
    );

    const tradeId = `${chain}:${first.raw.blockNumber}:${first.txHash.slice(0, 14)}:${first.raw.logIndex}`;
    const durationSeconds = Math.max(0, Math.round((last.ms - first.ms) / 1000));
    const responseGapSeconds = firstOpposite
      ? Math.max(0, Math.round((firstOpposite.ms - first.ms) / 1000))
      : durationSeconds;

    for (const leg of netAll) {
      tradedKeys.add(makeTransferKey(leg.txHash, leg.raw.logIndex));
    }

    outTrades.push({
      tradeId,
      chain,
      walletA,
      walletB,
      startedAt: first.raw.transferredAt,
      completedAt: last.raw.transferredAt,
      durationSeconds,
      responseGapSeconds,
      sideALegs: netAtoB.map((x) => x.raw),
      sideBLegs: netBtoA.map((x) => x.raw),
      allLegs: netAll.map((x) => x.raw),
    });
  }
}

/**
 * Detects confirmed reciprocal user-to-user trades from a stream of ERC-721 transfer events.
 * Safely filters out mints (`0x0`), burns, COSMO Spin transfers, self-transfers, one-way sends,
 * and bounce-backs.
 */
export function detectTradesFromTransfers(
  transfers: readonly P2PTransferEvent[],
  options: TradeDetectionOptions = {},
): TradeDetectionResult {
  const maxGapSeconds = options.maxGapSeconds ?? DEFAULT_TRADE_MAX_GAP_SECONDS;
  const maxSessionSpanSeconds =
    options.maxSessionSpanSeconds ?? DEFAULT_TRADE_MAX_SPAN_SECONDS;

  const excluded = new Set<string>(DEFAULT_EXCLUDED_TRADE_ADDRESSES);
  if (options.excludedAddresses) {
    for (const addr of options.excludedAddresses) {
      excluded.add(addr.toLowerCase());
    }
  }

  const eligibleTransfers: P2PTransferEvent[] = [];
  const byPair = new Map<
    string,
    {
      chain: "polygon" | "abstract";
      walletA: string;
      walletB: string;
      items: InternalTransfer[];
    }
  >();

  // Deduplicate exact (txHash, logIndex) in case input contains overlapping windows
  const seenKeys = new Set<string>();

  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (!isEligibleP2PTransfer(from, to, excluded)) continue;

    const txHash = t.txHash.toLowerCase();
    const key = makeTransferKey(txHash, t.logIndex);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const ms = Date.parse(t.transferredAt);
    if (Number.isNaN(ms)) continue;

    const normalized: P2PTransferEvent = {
      ...t,
      from,
      to,
      txHash,
    };
    eligibleTransfers.push(normalized);

    const { pairKey, walletA, walletB } = makeWalletPairKey(t.chain, from, to);
    let bucket = byPair.get(pairKey);
    if (!bucket) {
      bucket = { chain: t.chain, walletA, walletB, items: [] };
      byPair.set(pairKey, bucket);
    }
    bucket.items.push({ raw: normalized, ms, from, to, txHash });
  }

  const trades: DetectedTrade[] = [];
  const nonTradeTransfers: P2PTransferEvent[] = [];
  const tradedTransferKeys = new Set<string>();

  for (const bucket of byPair.values()) {
    classifyPairSessions(
      bucket.chain,
      bucket.walletA,
      bucket.walletB,
      bucket.items,
      maxGapSeconds,
      maxSessionSpanSeconds,
      trades,
      nonTradeTransfers,
      tradedTransferKeys,
    );
  }

  trades.sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  return {
    eligibleTransfers,
    trades,
    nonTradeTransfers,
    tradedTransferKeys,
  };
}

export interface TradeSymmetryInfo {
  isAsymmetric: boolean;
  /** Which side gave FEWER Objekts (i.e. commanded a multi-card premium), or null if equal. */
  premiumSide: "A" | "B" | null;
  /** Counterparty Objekts received per 1 Side-A Objekt (`sideBCount / sideACount`). */
  sideAExchangeRate: number;
  /** Counterparty Objekts received per 1 Side-B Objekt (`sideACount / sideBCount`). */
  sideBExchangeRate: number;
  /** Ratio >= 1.0 of the larger side to the smaller side (e.g. 2.0 for 2:1, 1.5 for 3:2). */
  ratioMultiple: number;
  is2to1Plus: boolean;
  is3to1Plus: boolean;
  /** Human-readable higher-first ratio label (e.g. "1:1", "2:1", "3:1", "3:2"). */
  ratioLabel: string;
}

/**
 * Classifies whether a confirmed reciprocal swap is equal (`1:1`, `N:N`) or asymmetric
 * (`2:1`, `3:1`, `3:2`, etc.) and computes exact per-leg exchange rates.
 *
 * Mathematical property: across any swap of `a` vs `b` Objekts,
 * `a * (b/a) + b * (a/b) = a + b`, so the market-wide leg-weighted mean exchange rate
 * is always exactly `1.00`. Values > 1.00 indicate a net secondary market premium.
 */
export function classifyTradeSymmetry(
  sideACount: number,
  sideBCount: number,
): TradeSymmetryInfo {
  const a = Math.max(1, sideACount);
  const b = Math.max(1, sideBCount);
  const isAsymmetric = a !== b;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const ratioMultiple = Math.round((hi / lo) * 10000) / 10000;
  const sideAExchangeRate = Math.round((b / a) * 10000) / 10000;
  const sideBExchangeRate = Math.round((a / b) * 10000) / 10000;
  const premiumSide: "A" | "B" | null = a < b ? "A" : b < a ? "B" : null;
  const ratioLabel = isAsymmetric ? `${hi}:${lo}` : `${a}:${b}`;

  return {
    isAsymmetric,
    premiumSide,
    sideAExchangeRate,
    sideBExchangeRate,
    ratioMultiple,
    is2to1Plus: ratioMultiple >= 2,
    is3to1Plus: ratioMultiple >= 3,
    ratioLabel,
  };
}

/**
 * Returns true when both sides of a swap consist exclusively of the same Objekt class
 * (e.g. First <-> First, Double <-> Double), isolating member/edition demand premiums
 * from cross-class rarity upgrades (such as 4 First -> 1 Special).
 */
export function isSameClassSwap(
  sideAClasses: Iterable<string | null | undefined>,
  sideBClasses: Iterable<string | null | undefined>,
): boolean {
  const setA = new Set<string>();
  for (const c of sideAClasses) {
    if (c) setA.add(c);
  }
  const setB = new Set<string>();
  for (const c of sideBClasses) {
    if (c) setB.add(c);
  }
  if (setA.size !== 1 || setB.size !== 1) return false;
  const [classA] = setA;
  const [classB] = setB;
  return classA === classB;
}

/**
 * Returns true if an asymmetric swap falls within realistic P2P trade bounds
 * (`ratio <= 6:1` and neither side exceeds 10 cards), excluding alt-wallet batch
 * consolidations like 66:1 or 39:3 from skewing exchange-rate averages.
 */
export function isRealisticAsymmetricSwap(
  sideACount: number,
  sideBCount: number,
): boolean {
  const sym = classifyTradeSymmetry(sideACount, sideBCount);
  if (!sym.isAsymmetric) return false;
  const hi = Math.max(sideACount, sideBCount);
  return (
    sym.ratioMultiple <= MAX_ASYMMETRIC_PREMIUM_RATIO &&
    hi <= MAX_ASYMMETRIC_SIDE_SIZE
  );
}

export interface CleanSoloLegMeta {
  objektClass?: string | null;
  onOffline?: string | null;
  memberId?: string | null;
  season?: string | null;
  collectionNo?: string | null;
}

/**
 * Evaluates whether a trade is a clean, unambiguous apples-to-apples **Solo `N:1`**
 * member-premium swap:
 * - Exactly 1 Objekt on the favorable (scarcer) side and 2..6 Objekts on the bulk side
 * - Both sides share the exact same Objekt Class (e.g. First <-> First)
 * - Both sides share the exact same format (Digital `Z` <-> Digital `Z`, or Physical `A` <-> `A`)
 * - Grid-tier aware: when `collectionNo` is provided, Digital First Class **8-card grid**
 *   cards (`101–116Z`) and **4-card grid** cards (`117–120Z`) are treated as distinct tiers
 *   so fair 2× 1st/2nd-Ed -> 1× 3rd-Ed grid utility swaps are NOT miscounted as member overpays
 * - Not all bulk cards belong to the exact same member as the scarce card (cross-member demand)
 */
export function isCleanSoloPremiumSwap(
  premiumSideMetas: readonly (CleanSoloLegMeta | null | undefined)[],
  bulkSideMetas: readonly (CleanSoloLegMeta | null | undefined)[],
): boolean {
  if (premiumSideMetas.length !== 1) return false;
  if (
    bulkSideMetas.length < 2 ||
    bulkSideMetas.length > MAX_ASYMMETRIC_PREMIUM_RATIO
  ) {
    return false;
  }

  const prem = premiumSideMetas[0];
  if (!prem?.objektClass || !prem.onOffline) return false;

  const premGridTier = prem.collectionNo
    ? getSwapGridTier(prem.objektClass, prem.collectionNo, prem.onOffline)
    : null;

  let hasOtherMember = false;
  for (const b of bulkSideMetas) {
    if (!b?.objektClass || !b.onOffline) return false;
    if (b.objektClass !== prem.objektClass) return false;
    if (b.onOffline !== prem.onOffline) return false;
    if (premGridTier && b.collectionNo) {
      const bulkGridTier = getSwapGridTier(b.objektClass, b.collectionNo, b.onOffline);
      if (bulkGridTier !== premGridTier) return false;
    }
    if (!prem.memberId || !b.memberId || b.memberId !== prem.memberId) {
      hasOtherMember = true;
    }
  }

  return hasOtherMember;
}

/**
 * Ultra-strict variant of `isCleanSoloPremiumSwap` requiring every card on both sides
 * to belong to the **exact same season and edition bucket** (e.g., Cream02 3rd Ed FCO
 * for Cream02 3rd Ed FCO, or Cream02 DCO 353Z for Cream02 DCO 353Z).
 */
export function isSameEditionSoloSwap(
  premiumSideMetas: readonly (CleanSoloLegMeta | null | undefined)[],
  bulkSideMetas: readonly (CleanSoloLegMeta | null | undefined)[],
): boolean {
  if (!isCleanSoloPremiumSwap(premiumSideMetas, bulkSideMetas)) return false;
  const prem = premiumSideMetas[0];
  if (!prem?.season || !prem.objektClass || !prem.collectionNo || !prem.onOffline) {
    return false;
  }
  const premEd = getSwapEditionKey(
    prem.season,
    prem.objektClass,
    prem.collectionNo,
    prem.onOffline,
  );
  for (const b of bulkSideMetas) {
    if (!b?.season || !b.objektClass || !b.collectionNo || !b.onOffline) {
      return false;
    }
    const bulkEd = getSwapEditionKey(
      b.season,
      b.objektClass,
      b.collectionNo,
      b.onOffline,
    );
    if (bulkEd !== premEd) return false;
  }
  return true;
}

export interface MemberTradeMetricInput {
  memberId: string;
  tradedCount: number;
}

export interface ComputedMemberTradeMetric {
  memberId: string;
  tradedCount: number;
  tradeRank: number;
  tradeSharePct: number;
  tradeRelativeIndex: number;
}

/**
 * Computes roster-normalized secondary trade rankings (`tradeRank`, `tradeSharePct`,
 * `tradeRelativeIndex` where 1.00 = artist average) matching primary-sales stat conventions.
 */
export function computeMemberTradeRankings(
  inputs: readonly MemberTradeMetricInput[],
): ComputedMemberTradeMetric[] {
  const entries = [...inputs];
  const n = entries.length;
  if (n === 0) return [];

  const total = entries.reduce((sum, e) => sum + e.tradedCount, 0);
  const mean = total / n;

  entries.sort((a, b) =>
    b.tradedCount !== a.tradedCount
      ? b.tradedCount - a.tradedCount
      : a.memberId.localeCompare(b.memberId),
  );

  let currentRank = 1;
  return entries.map((entry, idx) => {
    if (idx > 0 && entry.tradedCount < entries[idx - 1]!.tradedCount) {
      currentRank = idx + 1;
    }
    const sharePct = total > 0 ? (entry.tradedCount / total) * 100 : 0;
    const relativeIndex = mean > 0 ? entry.tradedCount / mean : 1;
    return {
      memberId: entry.memberId,
      tradedCount: entry.tradedCount,
      tradeRank: currentRank,
      tradeSharePct: Math.round(sharePct * 10000) / 10000,
      tradeRelativeIndex: Math.round(relativeIndex * 10000) / 10000,
    };
  });
}
