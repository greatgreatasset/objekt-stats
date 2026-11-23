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
import {
  classifyFcoGridEdition,
  classifyGridRewardSco,
  computeCardGridSupply,
  computeEditionGridSupply,
  type GridEditionId,
} from "@objekt-stats/stats";
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

export interface EditionGridMonitorRow {
  key: string;
  season: string;
  editionId: GridEditionId;
  editionLabel: string;
  shortLabel: string;
  gridSize: 4 | 8;
  fcoMints: number;
  gridsCompleted: number;
  lockedFcos: number;
  spunCount: number;
  gridLockPct: number;
  estTradableFloat: number;
  estTradableFloatPerMemberSlot: number;
  activeMembers: number;
  latestMintAt: string;
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

    // Live COSMO Grid Supply & Lock computation directly from indexed digital First + Special collections
    const gridSourceRows = await db
      .select({
        memberId: collections.memberId,
        season: collections.season,
        objektClass: collections.objektClass,
        collectionNo: collections.collectionNo,
        onOffline: collections.onOffline,
        totalMints: collections.totalMints,
        spunCount: collections.spunCount,
        lastMintAt: collections.lastMintAt,
      })
      .from(collections)
      .where(
        sql`${collections.artistId} = ${artistId} AND ${collections.onOffline} = 'online' AND ${collections.objektClass} IN ('First', 'Special')`,
      )
      .catch(() => []);

    const scoMintsByMemberSeasonEd = new Map<string, number>();
    const totalGridsByMember = new Map<string, number>();
    const editionAccMap = new Map<
      string,
      {
        season: string;
        editionId: GridEditionId;
        editionLabel: string;
        shortLabel: string;
        gridSize: 4 | 8;
        fcoMints: number;
        scoMints: number;
        spunCount: number;
        members: Set<string>;
        latestMintAt: string;
      }
    >();

    for (const row of gridSourceRows) {
      if (row.totalMints <= 0) continue;
      if (row.objektClass === "Special") {
        const scoInfo = classifyGridRewardSco(
          artistId,
          row.season,
          row.objektClass,
          row.collectionNo,
          row.onOffline,
        );
        if (!scoInfo) continue;

        if (row.memberId) {
          const msKey = `${row.memberId}|${row.season}|${scoInfo.editionId}`;
          scoMintsByMemberSeasonEd.set(
            msKey,
            (scoMintsByMemberSeasonEd.get(msKey) ?? 0) + row.totalMints,
          );
          totalGridsByMember.set(
            row.memberId,
            (totalGridsByMember.get(row.memberId) ?? 0) + row.totalMints,
          );
        }

        const edKey = `${row.season}|${scoInfo.editionId}`;
        let acc = editionAccMap.get(edKey);
        if (!acc) {
          acc = {
            season: row.season,
            editionId: scoInfo.editionId,
            editionLabel: scoInfo.editionLabel,
            shortLabel: scoInfo.shortLabel,
            gridSize: scoInfo.gridSize,
            fcoMints: 0,
            scoMints: 0,
            spunCount: 0,
            members: new Set(),
            latestMintAt: row.lastMintAt ?? "",
          };
          editionAccMap.set(edKey, acc);
        }
        acc.scoMints += row.totalMints;
        if (row.lastMintAt && row.lastMintAt > acc.latestMintAt) {
          acc.latestMintAt = row.lastMintAt;
        }
      } else if (row.objektClass === "First") {
        const fcoInfo = classifyFcoGridEdition(
          artistId,
          row.season,
          row.objektClass,
          row.collectionNo,
          row.onOffline,
        );
        if (!fcoInfo) continue;

        const edKey = `${row.season}|${fcoInfo.editionId}`;
        let acc = editionAccMap.get(edKey);
        if (!acc) {
          acc = {
            season: row.season,
            editionId: fcoInfo.editionId,
            editionLabel: fcoInfo.editionLabel,
            shortLabel: fcoInfo.shortLabel,
            gridSize: fcoInfo.gridSize,
            fcoMints: 0,
            scoMints: 0,
            spunCount: 0,
            members: new Set(),
            latestMintAt: row.lastMintAt ?? "",
          };
          editionAccMap.set(edKey, acc);
        }
        acc.fcoMints += row.totalMints;
        acc.spunCount += row.spunCount ?? 0;
        if (row.memberId) acc.members.add(row.memberId);
        if (row.lastMintAt && row.lastMintAt > acc.latestMintAt) {
          acc.latestMintAt = row.lastMintAt;
        }
      }
    }

    const editionGridSummary: EditionGridMonitorRow[] = Array.from(
      editionAccMap.entries(),
    )
      .filter(([, a]) => a.fcoMints > 0)
      .map(([key, a]) => {
        const metrics = computeEditionGridSupply({
          fcoMints: a.fcoMints,
          scoMints: a.scoMints,
          spunCount: a.spunCount,
          gridSize: a.gridSize,
          slotCount: a.gridSize * Math.max(1, a.members.size),
        });
        return {
          key,
          season: a.season,
          editionId: a.editionId,
          editionLabel: a.editionLabel,
          shortLabel: a.shortLabel,
          gridSize: a.gridSize,
          fcoMints: a.fcoMints,
          gridsCompleted: metrics.gridsCompleted,
          lockedFcos: metrics.lockedFcos,
          spunCount: a.spunCount,
          gridLockPct: metrics.gridLockPct,
          estTradableFloat: metrics.estTradableFloat,
          estTradableFloatPerMemberSlot: metrics.estTradableFloatPerSlot,
          activeMembers: a.members.size,
          latestMintAt: a.latestMintAt,
        };
      })
      .sort(
        (a, b) =>
          b.latestMintAt.localeCompare(a.latestMintAt) ||
          b.fcoMints - a.fcoMints,
      );

    const totalGridsCompleted = editionGridSummary.reduce(
      (sum, e) => sum + e.gridsCompleted,
      0,
    );

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
        sameEdition2xCount: collectionTradeStats.sameEdition2xCount,
        sameEdition3xCount: collectionTradeStats.sameEdition3xCount,
        sameEditionOverpayers: collectionTradeStats.sameEditionOverpayers,
        firstTradeAt: collectionTradeStats.firstTradeAt,
        lastTradeAt: collectionTradeStats.lastTradeAt,
        primaryMints: collections.totalMints,
        spunCount: collections.spunCount,
      })
      .from(collectionTradeStats)
      .leftJoin(
        collections,
        eq(collections.slug, collectionTradeStats.collectionSlug),
      )
      .where(eq(collectionTradeStats.artistId, artistId))
      .orderBy(
        desc(collectionTradeStats.tradedCount),
        desc(collectionTradeStats.cleanSolo2xCount),
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
      editionGridSummary,
      memberLeaderboard: memberTradeRows.map((row) => {
        const m = memberById.get(row.memberId);
        const primary = primaryRankByMember.get(row.memberId) ?? null;
        const cleanDenom = row.cleanSolo2xCount + row.cleanSoloBulkCount;
        const cleanFavorablePct =
          cleanDenom > 0
            ? Number(((row.cleanSolo2xCount / cleanDenom) * 100).toFixed(1))
            : null;
        const sameEdDenom = row.sameEdition2xCount + row.sameEditionBulkCount;
        const sameEditionFavorablePct =
          sameEdDenom > 0
            ? Number(((row.sameEdition2xCount / sameEdDenom) * 100).toFixed(1))
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
          sameEditionFavorablePct,
          totalGridsCompleted: totalGridsByMember.get(row.memberId) ?? 0,
        };
      }),
      collections: collectionTradeRows.map((c) => {
        const m = c.memberId ? memberById.get(c.memberId) : null;
        const primaryMints =
          c.primaryMints !== null && c.primaryMints !== undefined
            ? Number(c.primaryMints)
            : null;
        const spunCount = Number(c.spunCount ?? 0);
        const turnoverPct =
          primaryMints && primaryMints > 0
            ? Number(((c.tradedCount / primaryMints) * 100).toFixed(1))
            : null;

        const fcoGrid = classifyFcoGridEdition(
          c.artistId,
          c.season,
          c.objektClass,
          c.collectionNo,
          c.onOffline,
        );
        let gridSize: 4 | 8 | null = null;
        let gridEditionLabel: string | null = null;
        let gridsCompleted: number | null = null;
        let gridLockPct: number | null = null;
        let estTradableFloat: number | null = null;
        let floatTurnoverPct: number | null = null;

        if (fcoGrid && c.memberId && primaryMints !== null && primaryMints > 0) {
          const matchingScos =
            scoMintsByMemberSeasonEd.get(
              `${c.memberId}|${c.season}|${fcoGrid.editionId}`,
            ) ?? 0;
          const supply = computeCardGridSupply(primaryMints, matchingScos, spunCount);
          gridSize = fcoGrid.gridSize;
          gridEditionLabel = fcoGrid.shortLabel;
          gridsCompleted = supply.gridsCompleted;
          gridLockPct = supply.gridLockPct;
          estTradableFloat = supply.estTradableFloat;
          floatTurnoverPct =
            supply.estTradableFloat > 0
              ? Number(((c.tradedCount / supply.estTradableFloat) * 100).toFixed(1))
              : null;
        }

        return {
          ...c,
          memberCode: m?.code ?? "",
          memberName: m?.name ?? c.rawMemberName,
          hexColor: m?.hexColor ?? c.backgroundColor ?? "#71717a",
          primaryMints,
          spunCount,
          turnoverPct,
          gridSize,
          gridEditionLabel,
          gridsCompleted,
          gridLockPct,
          estTradableFloat,
          floatTurnoverPct,
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
        isSameEdition: Boolean(rt.isSameEdition),
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
        totalGridsCompleted,
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
