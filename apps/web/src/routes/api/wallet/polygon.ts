import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import {
  POLYGON_ERAS,
  createWalletDb,
  fetchAndCachePolygonEra,
  readCachedTokenMetadata,
} from "../../../lib/server/wallet-service";

export const Route = createFileRoute("/api/wallet/polygon")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            polygonAddress?: string;
            eraIndex?: number;
          };

          const polygonAddress = (body.polygonAddress ?? "").trim().toLowerCase();
          if (!/^0x[a-f0-9]{40}$/.test(polygonAddress)) {
            return Response.json(
              { error: "Invalid polygonAddress (expected 0x EVM address)." },
              { status: 400 },
            );
          }

          const eraIndex = Number(body.eraIndex);
          if (
            !Number.isInteger(eraIndex) ||
            eraIndex < 0 ||
            eraIndex >= POLYGON_ERAS.length
          ) {
            return Response.json(
              { error: `Invalid eraIndex (expected 0..${POLYGON_ERAS.length - 1}).` },
              { status: 400 },
            );
          }

          const db = createWalletDb(env.DB);
          const eraResult = await fetchAndCachePolygonEra(
            db,
            env.DB,
            polygonAddress,
            eraIndex,
          );

          const tokenIds = Array.from(
            new Set(eraResult.logs.map((l) => l.tokenId)),
          );
          const metaCache =
            tokenIds.length > 0
              ? await readCachedTokenMetadata(db, tokenIds)
              : { found: {}, missingIds: [], uncachedIds: [] };

          return Response.json({
            eraIndex: eraResult.eraIndex,
            eraLabel: eraResult.eraLabel,
            fromCache: eraResult.fromCache,
            logs: eraResult.logs,
            metadata: metaCache.found,
            missingTokenIds: metaCache.missingIds,
            unresolvedTokenIds: metaCache.uncachedIds,
          });
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to fetch Polygon archive era";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
