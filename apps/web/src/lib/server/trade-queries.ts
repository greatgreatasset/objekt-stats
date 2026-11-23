import { createServerFn } from "@tanstack/react-start";
import { asc, desc, eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import {
  artists,
  collectionTradeStats,
  collections,
  createDb,
  dailyTradeStats,
  memberTradeStats,
  members,
  recentTrades,
  saleRoundMemberStats,
  saleRounds,
} from "@objekt-stats/db";
import type { ArtistSlug } from "./queries";

function normalizeArtist(input?: string): ArtistSlug {
  return input === "artms" ? "artms" : "triples";
}

export interface TradeLegSummary {
  slug: string;
  collectionId: string;
  artistId: string;
  memberId: string | null;
  memberName: string;
  hexColor: string;
  imageUrl: string | null;
  count: number;
}

function safeParseLegSummary(raw: string): TradeLegSummary[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TradeLegSummary[]) : [];
  } catch {
    return [];
  }
}

export const getTradesDashboard = createServerFn({ method: "GET" })
  .validator((artistId?: string) => normalizeArtist(artistId))
  .handler(async ({ data: artistId }) => {
    const db = createDb(env.DB);

    const [artist] = await db
      .select()
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1);

    const memberList = await db
      .select()
      .from(members)
      .where(eq(members.artistId, artistId))
      .orderBy(asc(members.memberOrder));
    const memberById = new Map(memberList.map((m) => [m.id, m]));

    // Primary popularity-round ranking for comparison (Trade Rank vs Primary Sales Rank)
    const primaryTotalsRows = await db
      .select({
        memberId: saleRoundMemberStats.memberId,
        avgRelativeIndex: sql<number>`avg(${saleRoundMemberStats.relativeIndex})`,
        totalMints: sql<number>`coalesce(sum(${saleRoundMemberStats.mintCount}), 0)`,
      })
      .from(saleRoundMemberStats)
      .innerJoin(
        saleRounds,
        eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
      )
      .where(
        sql`${saleRounds.artistId} = ${artistId} AND ${saleRounds.includeInPopularity} = 1`,
      )
      .groupBy(saleRoundMemberStats.memberId);

    const sortedPrimary = [...primaryTotalsRows].sort(
      (a, b) =>
        Number(b.avgRelativeIndex ?? 0) - Number(a.avgRelativeIndex ?? 0) ||
        Number(b.totalMints ?? 0) - Number(a.totalMints ?? 0),
    );
    const primaryRankByMember = new Map<
      string,
      { rank: number; avgRelativeIndex: number; totalMints: number }
    >();
    sortedPrimary.forEach((row, idx) => {
      primaryRankByMember.set(row.memberId, {
        rank: idx + 1,
        avgRelativeIndex: Number(Number(row.avgRelativeIndex ?? 1).toFixed(3)),
        totalMints: Number(row.totalMints ?? 0),
      });
    });

    // Gracefully handle empty/unmigrated trade tables
    const memberTradeRows = await db
      .select()
      .from(memberTradeStats)
      .where(eq(memberTradeStats.artistId, artistId))
      .orderBy(asc(memberTradeStats.tradeRank), desc(memberTradeStats.tradedCount))
      .catch(() => []);

    const collectionTradeRows = await db
      .select({
        collectionSlug: collectionTradeStats.collectionSlug,
        collectionId: collectionTradeStats.collectionId,
        artistId: collectionTradeStats.artistId,
        memberId: collectionTradeStats.memberId,
        rawMemberName: collectionTradeStats.rawMemberName,
        season: collectionTradeStats.season,
        objektClass: collectionTradeStats.objektClass,
        collectionNo: collectionTradeStats.collectionNo,
        onOffline: collectionTradeStats.onOffline,
        frontImageUrl: collectionTradeStats.frontImageUrl,
        backgroundColor: collectionTradeStats.backgroundColor,
        tradedCount: collectionTradeStats.tradedCount,
        tradeSessions: collectionTradeStats.tradeSessions,
        directTransferCount: collectionTradeStats.directTransferCount,
        uniqueTraders: collectionTradeStats.uniqueTraders,
        premiumCount: collectionTradeStats.premiumCount,
        bulkCount: collectionTradeStats.bulkCount,
        premium2xCount: collectionTradeStats.premium2xCount,
        premium3xCount: collectionTradeStats.premium3xCount,
        avgExchangeRate: collectionTradeStats.avgExchangeRate,
        maxExchangeRate: collectionTradeStats.maxExchangeRate,
        sameClassLegs: collectionTradeStats.sameClassLegs,
        sameClassPremiumCount: collectionTradeStats.sameClassPremiumCount,
        sameClassBulkCount: collectionTradeStats.sameClassBulkCount,
        sameClass2xCount: collectionTradeStats.sameClass2xCount,
        sameClass3xCount: collectionTradeStats.sameClass3xCount,
        sameClassAvgRate: collectionTradeStats.sameClassAvgRate,
        cleanSolo2xCount: collectionTradeStats.cleanSolo2xCount,
        cleanSolo3xCount: collectionTradeStats.cleanSolo3xCount,
        uniqueOverpayers: collectionTradeStats.uniqueOverpayers,
        firstTradeAt: collectionTradeStats.firstTradeAt,
        lastTradeAt: collectionTradeStats.lastTradeAt,
        primaryMints: collections.totalMints,
      })
      .from(collectionTradeStats)
      .leftJoin(
        collections,
        eq(collections.slug, collectionTradeStats.collectionSlug),
      )
      .where(eq(collectionTradeStats.artistId, artistId))
      .orderBy(
        desc(collectionTradeStats.tradedCount),
        desc(collectionTradeStats.premium2xCount),
        desc(collectionTradeStats.directTransferCount),
      )
      .limit(400)
      .catch(() => []);

    const dailyRows = await db
      .select()
      .from(dailyTradeStats)
      .where(eq(dailyTradeStats.artistId, artistId))
      .orderBy(asc(dailyTradeStats.tradeDate))
      .catch(() => []);

    const recentRows = await db
      .select()
      .from(recentTrades)
      .where(eq(recentTrades.artistId, artistId))
      .orderBy(desc(recentTrades.tradedAt))
      .limit(160)
      .catch(() => []);

    const [totalsRow] = await db
      .select({
        trackedCollections: sql<number>`count(*)`,
        tradedObjekts: sql<number>`coalesce(sum(${collectionTradeStats.tradedCount}), 0)`,
        directTransfers: sql<number>`coalesce(sum(${collectionTradeStats.directTransferCount}), 0)`,
        windowStart: sql<string | null>`min(${collectionTradeStats.firstTradeAt})`,
        windowEnd: sql<string | null>`max(${collectionTradeStats.lastTradeAt})`,
      })
      .from(collectionTradeStats)
      .where(eq(collectionTradeStats.artistId, artistId))
      .catch(() => [
        {
          trackedCollections: 0,
          tradedObjekts: 0,
          directTransfers: 0,
          windowStart: null,
          windowEnd: null,
        },
      ]);

    const confirmedTradeSessions = dailyRows.reduce(
      (sum, d) => sum + d.tradeSessions,
      0,
    );
    const asymmetricSessions = dailyRows.reduce(
      (sum, d) => sum + (d.asymmetricSessions ?? 0),
      0,
    );
    const ratio2xSessions = dailyRows.reduce(
      (sum, d) => sum + (d.ratio2xSessions ?? 0),
      0,
    );
    const ratio3xSessions = dailyRows.reduce(
      (sum, d) => sum + (d.ratio3xSessions ?? 0),
      0,
    );
    const sameClassAsymmetricSessions = dailyRows.reduce(
      (sum, d) => sum + (d.sameClassAsymmetricSessions ?? 0),
      0,
    );
    const tradedObjekts = Number(totalsRow?.tradedObjekts ?? 0);
    const directTransfers = Number(totalsRow?.directTransfers ?? 0);
    const maxDailyUniqueTraders = dailyRows.reduce(
      (max, d) => Math.max(max, d.uniqueTraders),
      0,
    );

    return {
      artist: artist ?? null,
      members: memberList,
      memberLeaderboard: memberTradeRows.map((row) => {
        const m = memberById.get(row.memberId);
        const primary = primaryRankByMember.get(row.memberId) ?? null;
        const cleanDenom = row.cleanSolo2xCount + row.cleanSoloBulkCount;
        const cleanFavorablePct =
          cleanDenom > 0
            ? Number(((row.cleanSolo2xCount / cleanDenom) * 100).toFixed(1))
            : null;
        return {
          ...row,
          memberCode: m?.code ?? "",
          memberName: m?.name ?? row.memberId,
          memberFullName: m?.fullName ?? "",
          hexColor: m?.hexColor ?? "#22AEFF",
          primarySalesRank: primary?.rank ?? null,
          primaryRelativeIndex: primary?.avgRelativeIndex ?? null,
          rankVsPrimary:
            primary !== null && row.tradedCount > 0
              ? primary.rank - row.tradeRank
              : null,
          cleanFavorablePct,
        };
      }),
      collections: collectionTradeRows.map((c) => {
        const m = c.memberId ? memberById.get(c.memberId) : null;
        const primaryMints =
          c.primaryMints !== null && c.primaryMints !== undefined
            ? Number(c.primaryMints)
            : null;
        const turnoverPct =
          primaryMints && primaryMints > 0
            ? Number(((c.tradedCount / primaryMints) * 100).toFixed(1))
            : null;
        return {
          ...c,
          memberCode: m?.code ?? "",
          memberName: m?.name ?? c.rawMemberName,
          hexColor: m?.hexColor ?? c.backgroundColor ?? "#71717a",
          primaryMints,
          turnoverPct,
        };
      }),
      dailyActivity: dailyRows,
      recentTrades: recentRows.map((rt) => ({
        tradeId: rt.tradeId,
        chain: rt.chain,
        tradedAt: rt.tradedAt,
        durationSeconds: rt.durationSeconds,
        sideACount: rt.sideACount,
        sideBCount: rt.sideBCount,
        isAsymmetric: Boolean(rt.isAsymmetric),
        isSameClass: Boolean(rt.isSameClass),
        isCleanSolo: Boolean(rt.isCleanSolo),
        ratioMultiple: Number(rt.ratioMultiple ?? 1),
        walletAShort: rt.walletAShort,
        walletBShort: rt.walletBShort,
        sideASummary: safeParseLegSummary(rt.sideASummary),
        sideBSummary: safeParseLegSummary(rt.sideBSummary),
      })),
      totals: {
        confirmedTradeSessions,
        asymmetricSessions,
        asymmetricSharePct:
          confirmedTradeSessions > 0
            ? Number(((asymmetricSessions / confirmedTradeSessions) * 100).toFixed(1))
            : 0,
        ratio2xSessions,
        ratio3xSessions,
        sameClassAsymmetricSessions,
        tradedObjekts,
        directTransfers,
        trackedCollections: Number(totalsRow?.trackedCollections ?? 0),
        peakDailyTraders: maxDailyUniqueTraders,
        avgObjektsPerTrade:
          confirmedTradeSessions > 0
            ? Number((tradedObjekts / confirmedTradeSessions).toFixed(2))
            : 0,
        confirmedSwapSharePct:
          directTransfers > 0
            ? Number(((tradedObjekts / directTransfers) * 100).toFixed(1))
            : 0,
        windowStart: totalsRow?.windowStart ?? null,
        windowEnd: totalsRow?.windowEnd ?? null,
      },
    };
  });
