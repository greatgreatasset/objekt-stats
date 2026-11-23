import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import {
  POLYGON_ERAS,
  createWalletDb,
  detectLegacyPolygonAddress,
  fetchAbstractWalletLogs,
  getCachedPolygonLogs,
  loadWalletReferenceData,
  readCachedTokenMetadata,
  resolveCosmoIdentity,
} from "../../../lib/server/wallet-service";

export const Route = createFileRoute("/api/wallet/lookup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q) {
          return Response.json(
            { error: "Missing query parameter `q` (COSMO nickname or 0x wallet address)." },
            { status: 400 },
          );
        }

        try {
          const identity = await resolveCosmoIdentity(q);
          if (!identity) {
            return Response.json(
              {
                error: `No COSMO user found for "${q}". Check spelling (COSMO nicknames are exact) or paste a 0x wallet address.`,
              },
              { status: 404 },
            );
          }

          const db = createWalletDb(env.DB);
          const abstractRpc = env.ABSTRACT_RPC_URL || "https://api.mainnet.abs.xyz";

          const [abstractResult, refData] = await Promise.all([
            fetchAbstractWalletLogs(identity.address, abstractRpc),
            loadWalletReferenceData(db),
          ]);

          // Auto-discover pre-migration Polygon legacy address via ownerOf(migratedTokenId)
          let polygonAddress: string | null = null;
          if (abstractResult.migratedTokenIds.length > 0) {
            polygonAddress = await detectLegacyPolygonAddress(
              abstractResult.migratedTokenIds,
            );
          } else if (
            identity.inputType === "address" &&
            abstractResult.logs.length === 0
          ) {
            // User may have pasted their old Polygon Ramper address directly
            polygonAddress = identity.address;
          }

          let polygonLogs = null;
          let polygonFromCache = false;
          if (polygonAddress) {
            polygonLogs = await getCachedPolygonLogs(db, polygonAddress);
            if (polygonLogs !== null) {
              polygonFromCache = true;
            }
          }

          // Gather all unique tokenIds known so far and read D1 metadata cache immediately
          const tokenIdSet = new Set<number>();
          for (const l of abstractResult.logs) tokenIdSet.add(l.tokenId);
          for (const l of polygonLogs ?? []) tokenIdSet.add(l.tokenId);

          const metaCache = await readCachedTokenMetadata(
            db,
            Array.from(tokenIdSet),
          );

          return Response.json({
            identity,
            abstract: {
              address: identity.address,
              headBlock: abstractResult.headBlock,
              logs: abstractResult.logs,
              migratedTokenCount: abstractResult.migratedTokenIds.length,
            },
            polygon: {
              address: polygonAddress,
              linkedAutomatically:
                polygonAddress !== null && polygonAddress !== identity.address,
              loaded: polygonFromCache || polygonAddress === null,
              fromCache: polygonFromCache,
              logs: polygonLogs ?? [],
              eras: POLYGON_ERAS.map((e) => ({ index: e.index, label: e.label })),
            },
            metadata: metaCache.found,
            missingTokenIds: metaCache.missingIds,
            unresolvedTokenIds: metaCache.uncachedIds,
            members: refData.members,
            curatedPrices: refData.curatedPrices,
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to load wallet history";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
