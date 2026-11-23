import { createServerFn } from "@tanstack/react-start";
import { asc, desc, eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import {
  artists,
  createDb,
  eventMembers,
  events,
  members,
  saleRounds,
  syncState,
} from "@objekt-stats/db";

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
      .orderBy(desc(saleRounds.startAt))
      .limit(20);

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

    const [totals] = await db
      .select({
        roundCount: sql<number>`count(*)`,
        totalMints: sql<number>`coalesce(sum(${saleRounds.totalMints}), 0)`,
      })
      .from(saleRounds)
      .where(eq(saleRounds.artistId, artistId));

    return {
      artist: artist ?? null,
      members: memberList,
      rounds: roundList,
      events: eventList.map((ev) => ({
        ...ev,
        memberIds: membersByEvent.get(ev.id) ?? [],
      })),
      syncState: syncRows,
      totals: {
        roundCount: Number(totals?.roundCount ?? 0),
        totalMints: Number(totals?.totalMints ?? 0),
      },
    };
  });
