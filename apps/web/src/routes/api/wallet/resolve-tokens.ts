import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import {
  createWalletDb,
  resolveTokensBatchWithCache,
} from "../../../lib/server/wallet-service";

export const Route = createFileRoute("/api/wallet/resolve-tokens")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { tokenIds?: unknown };
          if (!Array.isArray(body.tokenIds)) {
            return Response.json(
              { error: "Expected JSON body `{ tokenIds: number[] }`." },
              { status: 400 },
            );
          }

          const tokenIds = body.tokenIds
            .map((v) => Number(v))
            .filter((n) => Number.isInteger(n) && n > 0)
            .slice(0, 60);

          if (tokenIds.length === 0) {
            return Response.json({
              resolved: {},
              missingIds: [],
              failedIds: [],
              remainingIds: [],
            });
          }

          const db = createWalletDb(env.DB);
          const result = await resolveTokensBatchWithCache(
            db,
            env.DB,
            tokenIds,
            30,
          );

          return Response.json(result);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to resolve tokens";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
