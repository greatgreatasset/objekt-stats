import { z } from "zod";
import { DEFAULT_ENDPOINTS } from "./constants.js";

export const CosmoMetadataV1Schema = z.object({
  name: z.string(),
  description: z.string(),
  image: z.string(),
  background_color: z.string(),
  objekt: z.object({
    collectionId: z.string(),
    season: z.string(),
    member: z.string(),
    collectionNo: z.string(),
    class: z.string(),
    artists: z.array(z.string()),
    thumbnailImage: z.string(),
    frontImage: z.string(),
    backImage: z.string(),
    accentColor: z.string(),
    backgroundColor: z.string(),
    textColor: z.string(),
    comoAmount: z.number(),
    tokenId: z.string(),
    objektNo: z.number(),
    tokenAddress: z.string(),
    transferable: z.boolean(),
  }),
});

export type CosmoMetadataV1 = z.infer<typeof CosmoMetadataV1Schema>;

const RETRYABLE_STATUSES = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);

export interface FetchMetadataOptions {
  baseUrl?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Fetches full COSMO v1 token metadata with polite exponential backoff.
 * Newly minted tokens can take several seconds to propagate to api.cosmo.fans.
 */
export async function fetchCosmoTokenMetadata(
  tokenId: string | number,
  options: FetchMetadataOptions = {},
): Promise<CosmoMetadataV1> {
  const baseUrl = options.baseUrl ?? DEFAULT_ENDPOINTS.cosmoApi;
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const url = `${baseUrl}/objekt/v1/token/${tokenId}`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "objektstats.com (github.com/greatgreatasset/objekt-stats)",
          accept: "application/json",
        },
        signal: options.signal,
      });

      if (res.ok) {
        const json: unknown = await res.json();
        return CosmoMetadataV1Schema.parse(json);
      }

      if (!RETRYABLE_STATUSES.has(res.status) || attempt === maxAttempts) {
        throw new Error(`COSMO metadata HTTP ${res.status} for token ${tokenId}`);
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof z.ZodError || attempt === maxAttempts) {
        throw err;
      }
      lastError = err;
    }

    const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 15_000);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw lastError;
}
