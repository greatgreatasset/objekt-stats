import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import {
  artists,
  collectionTradeStats,
  collections,
  createDb,
  events,
  members,
  processedLiveMints,
  recentTrades,
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
        const [liveDedupeRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(processedLiveMints);
        const [tradeColRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(collectionTradeStats)
          .catch(() => [{ count: 0 }]);
        const [recentTradeRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(recentTrades)
          .catch(() => [{ count: 0 }]);
        const chains = await db.select().from(syncState);

        return Response.json({
          status: "ok",
          service: "objekt-stats",
          domain: "objektstats.com",
          timestamp: new Date().toISOString(),
          liveSync: {
            cronSchedule: "*/5 * * * *",
            maxTokensPerTick: Number(env.SYNC_MAX_TOKENS || "35"),
            liveMintsDedupeTracked: Number(liveDedupeRow?.count ?? 0),
          },
          counts: {
            artists: Number(artistRow?.count ?? 0),
            members: Number(memberRow?.count ?? 0),
            events: Number(eventRow?.count ?? 0),
            saleRounds: Number(roundRow?.count ?? 0),
            collections: Number(collectionRow?.count ?? 0),
            tradedCollections: Number(tradeColRow?.count ?? 0),
            recentDetectedTrades: Number(recentTradeRow?.count ?? 0),
          },
          syncState: chains,
        });
      },
    },
  },
});
