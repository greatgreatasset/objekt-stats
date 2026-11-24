import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { createWalletDb } from "../../../lib/server/wallet-service";
import {
  enrichApolloCollectionsWithCache,
  type ApolloEnrichTarget,
} from "../../../lib/server/apollo-service";

export const Route = createFileRoute("/api/wallet/apollo-enrich")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            targets?: unknown;
          };

          if (!Array.isArray(body.targets)) {
            return Response.json(
              { error: "Expected JSON body `{ targets: ApolloEnrichTarget[] }`." },
              { status: 400 },
            );
          }

          const targets: ApolloEnrichTarget[] = [];
          for (const raw of body.targets.slice(0, 45)) {
            if (!raw || typeof raw !== "object") continue;
            const r = raw as Record<string, unknown>;
            const apolloSlug =
              typeof r.apolloSlug === "string" ? r.apolloSlug.trim().toLowerCase() : "";
            const dropKey = typeof r.dropKey === "string" ? r.dropKey.trim() : "";
            const artistId =
              typeof r.artistId === "string" ? r.artistId.trim().toLowerCase() : "";
            const season = typeof r.season === "string" ? r.season.trim() : "";
            const collectionNo =
              typeof r.collectionNo === "string" ? r.collectionNo.trim().toUpperCase() : "";
            if (!apolloSlug || !season || !collectionNo) continue;
            targets.push({
              apolloSlug,
              dropKey,
              artistId: artistId || "triples",
              season,
              collectionNo,
              objektClass:
                typeof r.objektClass === "string" ? r.objektClass : undefined,
              onOffline: r.onOffline === "offline" ? "offline" : "online",
            });
          }

          if (targets.length === 0) {
            return Response.json({
              collections: {},
              newDrops: {},
              remainingSlugs: [],
            });
          }

          const db = createWalletDb(env.DB);
          const result = await enrichApolloCollectionsWithCache(
            db,
            env.DB,
            targets,
            15,
          );

          return Response.json(result);
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to enrich Apollo collection metadata";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
