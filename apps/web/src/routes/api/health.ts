import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import {
  artists,
  collections,
  createDb,
  events,
  members,
  saleRounds,
  syncState,
} from "@objekt-stats/db";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const db = createDb(env.DB);
        const [artistRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(artists);
        const [memberRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(members);
        const [eventRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(events);
        const [roundRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(saleRounds);
        const [collectionRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(collections);
        const chains = await db.select().from(syncState);

        return Response.json({
          status: "ok",
          service: "objekt-stats",
          domain: "objektstats.com",
          timestamp: new Date().toISOString(),
          counts: {
            artists: Number(artistRow?.count ?? 0),
            members: Number(memberRow?.count ?? 0),
            events: Number(eventRow?.count ?? 0),
            saleRounds: Number(roundRow?.count ?? 0),
            collections: Number(collectionRow?.count ?? 0),
          },
          syncState: chains,
        });
      },
    },
  },
});
