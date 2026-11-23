import { createServerFn } from "@tanstack/react-start";
import { asc, desc, eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import {
  artists,
  collectionDailyMints,
  collections,
  createDb,
  eventMembers,
  events,
  members,
  saleRoundCollections,
  saleRoundMemberStats,
  saleRounds,
  syncState,
} from "@objekt-stats/db";
import { correlateEventsForMemberRound } from "@objekt-stats/stats";

export type ArtistSlug = "triples" | "artms";

function normalizeArtist(input?: string): ArtistSlug {
  return input === "artms" ? "artms" : "triples";
}

export const getArtistOverview = createServerFn({ method: "GET" })
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

    const roundList = await db
      .select()
      .from(saleRounds)
      .where(eq(saleRounds.artistId, artistId))
      .orderBy(desc(saleRounds.startAt), desc(saleRounds.totalMints))
      .limit(50);

    const roundTopSellers = new Map<
      string,
      { memberId: string; mintCount: number; sharePct: number }
    >();

    if (roundList.length > 0) {
      const rank1Rows = await db
        .select({
          roundSlug: saleRoundMemberStats.roundSlug,
          memberId: saleRoundMemberStats.memberId,
          mintCount: saleRoundMemberStats.mintCount,
          sharePct: saleRoundMemberStats.sharePct,
        })
        .from(saleRoundMemberStats)
        .innerJoin(
          saleRounds,
          eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
        )
        .where(
          sql`${saleRounds.artistId} = ${artistId} AND ${saleRoundMemberStats.rank} = 1`,
        );

      for (const row of rank1Rows) {
        if (!roundTopSellers.has(row.roundSlug)) {
          roundTopSellers.set(row.roundSlug, {
            memberId: row.memberId,
            mintCount: row.mintCount,
            sharePct: row.sharePct,
          });
        }
      }
    }

    // Member aggregate mints across popularity rounds (or all rounds fallback)
    const memberTotalsRows = await db
      .select({
        memberId: saleRoundMemberStats.memberId,
        totalMints: sql<number>`coalesce(sum(${saleRoundMemberStats.mintCount}), 0)`,
        roundsCount: sql<number>`count(*)`,
        avgRank: sql<number>`avg(${saleRoundMemberStats.rank})`,
        avgRelativeIndex: sql<number>`avg(${saleRoundMemberStats.relativeIndex})`,
        bestRank: sql<number>`min(${saleRoundMemberStats.rank})`,
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

    const memberStatsMap = new Map(
      memberTotalsRows.map((r) => [
        r.memberId,
        {
          totalMints: Number(r.totalMints),
          roundsCount: Number(r.roundsCount),
          avgRank: r.avgRank !== null ? Number(r.avgRank.toFixed(2)) : null,
          avgRelativeIndex:
            r.avgRelativeIndex !== null
              ? Number(r.avgRelativeIndex.toFixed(3))
              : null,
          bestRank: r.bestRank !== null ? Number(r.bestRank) : null,
        },
      ]),
    );

    const eventList = await db
      .select()
      .from(events)
      .where(eq(events.artistId, artistId))
      .orderBy(desc(events.eventDate));

    const eventMemberLinks = await db.select().from(eventMembers);
    const membersByEvent = new Map<string, string[]>();
    for (const link of eventMemberLinks) {
      const arr = membersByEvent.get(link.eventId) ?? [];
      arr.push(link.memberId);
      membersByEvent.set(link.eventId, arr);
    }

    const syncRows = await db.select().from(syncState);

    const [roundTotals] = await db
      .select({
        roundCount: sql<number>`count(*)`,
        popularityRoundCount: sql<number>`sum(case when ${saleRounds.includeInPopularity} = 1 then 1 else 0 end)`,
      })
      .from(saleRounds)
      .where(eq(saleRounds.artistId, artistId));

    const [collectionTotals] = await db
      .select({
        collectionCount: sql<number>`count(*)`,
        totalMints: sql<number>`coalesce(sum(${collections.totalMints}), 0)`,
      })
      .from(collections)
      .where(eq(collections.artistId, artistId));

    return {
      artist: artist ?? null,
      members: memberList.map((m) => ({
        ...m,
        stats: memberStatsMap.get(m.id) ?? null,
      })),
      rounds: roundList.map((r) => ({
        ...r,
        topSeller: roundTopSellers.get(r.slug) ?? null,
      })),
      events: eventList.map((ev) => ({
        ...ev,
        memberIds: membersByEvent.get(ev.id) ?? [],
      })),
      syncState: syncRows,
      totals: {
        roundCount: Number(roundTotals?.roundCount ?? 0),
        popularityRoundCount: Number(roundTotals?.popularityRoundCount ?? 0),
        collectionCount: Number(collectionTotals?.collectionCount ?? 0),
        totalMints: Number(collectionTotals?.totalMints ?? 0),
      },
    };
  });

export const getRoundDetail = createServerFn({ method: "GET" })
  .validator((slug: string) => slug.trim())
  .handler(async ({ data: slug }) => {
    const db = createDb(env.DB);

    const [round] = await db
      .select()
      .from(saleRounds)
      .where(eq(saleRounds.slug, slug))
      .limit(1);

    if (!round) return null;

    const memberRows = await db
      .select()
      .from(members)
      .where(eq(members.artistId, round.artistId))
      .orderBy(asc(members.memberOrder));
    const memberById = new Map(memberRows.map((m) => [m.id, m]));

    const statRows = await db
      .select()
      .from(saleRoundMemberStats)
      .where(eq(saleRoundMemberStats.roundSlug, slug))
      .orderBy(asc(saleRoundMemberStats.rank), desc(saleRoundMemberStats.mintCount));

    const linkedCols = await db
      .select({
        slug: collections.slug,
        collectionId: collections.collectionId,
        memberId: collections.memberId,
        collectionNo: collections.collectionNo,
        totalMints: collections.totalMints,
        spunCount: collections.spunCount,
        frontImageUrl: collections.frontImageUrl,
        backgroundColor: collections.backgroundColor,
      })
      .from(saleRoundCollections)
      .innerJoin(
        collections,
        eq(collections.slug, saleRoundCollections.collectionSlug),
      )
      .where(eq(saleRoundCollections.roundSlug, slug))
      .orderBy(desc(collections.totalMints));

    const dailyRows = await db
      .select({
        mintDate: collectionDailyMints.mintDate,
        mintCount: sql<number>`sum(${collectionDailyMints.mintCount})`,
      })
      .from(collectionDailyMints)
      .innerJoin(
        saleRoundCollections,
        eq(
          saleRoundCollections.collectionSlug,
          collectionDailyMints.collectionSlug,
        ),
      )
      .where(eq(saleRoundCollections.roundSlug, slug))
      .groupBy(collectionDailyMints.mintDate)
      .orderBy(asc(collectionDailyMints.mintDate));

    const dailyCurve = dailyRows.map((d) => ({
      mintDate: d.mintDate,
      mintCount: Number(d.mintCount),
    }));

    // Correlated events near this round
    const artistEvents = await db
      .select()
      .from(events)
      .where(eq(events.artistId, round.artistId));
    const evLinks = await db.select().from(eventMembers);
    const evMemberMap = new Map<string, string[]>();
    for (const l of evLinks) {
      const arr = evMemberMap.get(l.eventId) ?? [];
      arr.push(l.memberId);
      evMemberMap.set(l.eventId, arr);
    }

    const correlated = correlateEventsForMemberRound(
      round.startAt,
      round.artistId,
      null,
      artistEvents.map((e) => ({
        ...e,
        members: evMemberMap.get(e.id) ?? [],
      })),
      14,
      7,
    );

    // Pick one representative preview image per member
    const previewByMember = new Map<string, string>();
    for (const c of linkedCols) {
      if (c.memberId && c.frontImageUrl && !previewByMember.has(c.memberId)) {
        previewByMember.set(c.memberId, c.frontImageUrl);
      }
    }

    return {
      round,
      leaderboard: statRows.map((s) => {
        const m = memberById.get(s.memberId);
        return {
          ...s,
          memberCode: m?.code ?? "",
          memberName: m?.name ?? s.memberId,
          memberFullName: m?.fullName ?? "",
          hexColor: m?.hexColor ?? "#22AEFF",
          previewImageUrl: previewByMember.get(s.memberId) ?? null,
        };
      }),
      collections: linkedCols.slice(0, 48),
      dailyCurve,
      correlatedEvents: correlated,
    };
  });

export const getMembersMatrix = createServerFn({ method: "GET" })
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

    const popRounds = await db
      .select()
      .from(saleRounds)
      .where(
        sql`${saleRounds.artistId} = ${artistId} AND ${saleRounds.includeInPopularity} = 1`,
      )
      .orderBy(asc(saleRounds.startAt));

    const statRows =
      popRounds.length > 0
        ? await db
            .select({
              roundSlug: saleRoundMemberStats.roundSlug,
              memberId: saleRoundMemberStats.memberId,
              mintCount: saleRoundMemberStats.mintCount,
              rank: saleRoundMemberStats.rank,
              sharePct: saleRoundMemberStats.sharePct,
              relativeIndex: saleRoundMemberStats.relativeIndex,
              zScore: saleRoundMemberStats.zScore,
              rankDeltaPrev: saleRoundMemberStats.rankDeltaPrev,
              rolling5Rank: saleRoundMemberStats.rolling5Rank,
              rolling10Rank: saleRoundMemberStats.rolling10Rank,
              rolling5RelativeIndex: saleRoundMemberStats.rolling5RelativeIndex,
              rolling10RelativeIndex:
                saleRoundMemberStats.rolling10RelativeIndex,
              isAnomaly: saleRoundMemberStats.isAnomaly,
              anomalyDirection: saleRoundMemberStats.anomalyDirection,
              anomalyReason: saleRoundMemberStats.anomalyReason,
            })
            .from(saleRoundMemberStats)
            .innerJoin(
              saleRounds,
              eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
            )
            .where(
              sql`${saleRounds.artistId} = ${artistId} AND ${saleRounds.includeInPopularity} = 1`,
            )
        : [];

    const statsByMember = new Map<string, typeof statRows>();
    for (const s of statRows) {
      const arr = statsByMember.get(s.memberId) ?? [];
      arr.push(s);
      statsByMember.set(s.memberId, arr);
    }

    const roundOrderMap = new Map(popRounds.map((r, i) => [r.slug, i]));

    const matrix = memberList.map((m) => {
      const rows = (statsByMember.get(m.id) ?? []).sort(
        (a, b) =>
          (roundOrderMap.get(a.roundSlug) ?? 0) -
          (roundOrderMap.get(b.roundSlug) ?? 0),
      );
      const latest = rows[rows.length - 1];
      const totalMints = rows.reduce((acc, r) => acc + r.mintCount, 0);
      const avgRank =
        rows.length > 0
          ? Number(
              (
                rows.reduce((acc, r) => acc + r.rank, 0) / rows.length
              ).toFixed(2),
            )
          : null;
      const avgRelativeIndex =
        rows.length > 0
          ? Number(
              (
                rows.reduce((acc, r) => acc + r.relativeIndex, 0) / rows.length
              ).toFixed(3),
            )
          : null;
      const bestRank =
        rows.length > 0 ? Math.min(...rows.map((r) => r.rank)) : null;

      return {
        ...m,
        roundsCount: rows.length,
        totalMints,
        latestRank: latest?.rank ?? null,
        latestRankDelta: latest?.rankDeltaPrev ?? null,
        rolling5Rank: latest?.rolling5Rank ?? avgRank,
        avgRank,
        avgRelativeIndex,
        bestRank,
        anomaliesCount: rows.filter((r) => r.isAnomaly).length,
        history: rows.map((r) => ({
          roundSlug: r.roundSlug,
          rank: r.rank,
          relativeIndex: r.relativeIndex,
          mintCount: r.mintCount,
          sharePct: r.sharePct,
        })),
      };
    });

    return {
      artist: artist ?? null,
      rounds: popRounds.map((r) => ({
        slug: r.slug,
        title: r.title,
        season: r.season,
        startAt: r.startAt,
        totalMints: r.totalMints,
      })),
      members: matrix,
    };
  });

export const getMemberDetail = createServerFn({ method: "GET" })
  .validator((memberId: string) => memberId.trim())
  .handler(async ({ data: memberId }) => {
    const db = createDb(env.DB);

    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!member) return null;

    const roundHistory = await db
      .select({
        roundSlug: saleRounds.slug,
        title: saleRounds.title,
        season: saleRounds.season,
        objektClass: saleRounds.objektClass,
        saleMechanic: saleRounds.saleMechanic,
        startAt: saleRounds.startAt,
        includeInPopularity: saleRounds.includeInPopularity,
        participatingMembers: saleRounds.participatingMembers,
        roundTotalMints: saleRounds.totalMints,
        mintCount: saleRoundMemberStats.mintCount,
        rank: saleRoundMemberStats.rank,
        sharePct: saleRoundMemberStats.sharePct,
        relativeIndex: saleRoundMemberStats.relativeIndex,
        zScore: saleRoundMemberStats.zScore,
        rankDeltaPrev: saleRoundMemberStats.rankDeltaPrev,
        rolling5Rank: saleRoundMemberStats.rolling5Rank,
        isAnomaly: saleRoundMemberStats.isAnomaly,
        anomalyDirection: saleRoundMemberStats.anomalyDirection,
        anomalyReason: saleRoundMemberStats.anomalyReason,
      })
      .from(saleRoundMemberStats)
      .innerJoin(
        saleRounds,
        eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
      )
      .where(eq(saleRoundMemberStats.memberId, memberId))
      .orderBy(desc(saleRounds.startAt));

    const memberCollections = await db
      .select()
      .from(collections)
      .where(eq(collections.memberId, memberId))
      .orderBy(desc(collections.totalMints))
      .limit(24);

    const artistEvents = await db
      .select()
      .from(events)
      .where(eq(events.artistId, member.artistId))
      .orderBy(desc(events.eventDate));

    const evLinks = await db
      .select()
      .from(eventMembers)
      .where(eq(eventMembers.memberId, memberId));
    const directEventIds = new Set(evLinks.map((l) => l.eventId));

    const relatedEvents = artistEvents.filter((e) => directEventIds.has(e.id));

    return {
      member,
      roundHistory,
      collections: memberCollections,
      events: relatedEvents,
    };
  });
