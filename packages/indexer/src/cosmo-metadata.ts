import { z } from "zod";
import {
  DEFAULT_ENDPOINTS,
  inferOnOffline,
  normalizeArtistId,
  slugifyCollection,
} from "./constants.js";

export const CosmoMetadataV3Schema = z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  image: z.string().optional().default(""),
  background_color: z.string().optional().default("#09090b"),
  attributes: z.array(
    z.object({
      trait_type: z.string(),
      value: z.union([z.string(), z.number()]).transform(String),
    }),
  ),
});

export type CosmoMetadataV3 = z.infer<typeof CosmoMetadataV3Schema>;

export interface NormalizedTokenMetadata {
  tokenId: number;
  slug: string;
  collectionId: string;
  artistId: string;
  rawArtist: string;
  rawMember: string;
  season: string;
  objektClass: string;
  collectionNo: string;
  onOffline: "online" | "offline";
  imageUrl: string;
  backgroundColor: string;
}

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export interface FetchMetadataOptions {
  baseUrl?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

export function normalizeMetadataV3(
  tokenId: number,
  raw: CosmoMetadataV3,
): NormalizedTokenMetadata | null {
  const attr = new Map<string, string>();
  for (const a of raw.attributes) {
    attr.set(a.trait_type.toLowerCase(), a.value.trim());
  }

  const rawArtist = attr.get("artist") ?? "";
  const rawMember = attr.get("member") ?? "";
  const season = attr.get("season") ?? "";
  const objektClass = attr.get("class") ?? "";
  const collectionNo = attr.get("collection") ?? "";

  if (!rawArtist || !season || !collectionNo) {
    return null;
  }

  const artistId = normalizeArtistId(rawArtist);
  const collectionId = `${season} ${rawMember || rawArtist} ${collectionNo}`.trim();
  const slug = slugifyCollection(`${artistId}-${collectionId}`);

  return {
    tokenId,
    slug,
    collectionId,
    artistId,
    rawArtist,
    rawMember: rawMember || rawArtist,
    season,
    objektClass: objektClass || inferClassFromNo(collectionNo),
    collectionNo,
    onOffline: inferOnOffline(collectionNo),
    imageUrl: raw.image,
    backgroundColor: raw.background_color,
  };
}

function inferClassFromNo(collectionNo: string): string {
  const clean = collectionNo.toUpperCase();
  if (clean === "100Z") return "Welcome";
  if (clean.startsWith("1")) return "First";
  if (clean.startsWith("2")) return "Special";
  if (clean.startsWith("3")) return "Double";
  if (clean.startsWith("4")) return "Premier";
  if (clean.startsWith("5")) return "Motion";
  return "Unknown";
}

/**
 * Fetches COSMO v3 NFT metadata (unauthenticated, verified live endpoint).
 * Returns null if the token returns HTTP 404 (burned/non-existent/unprovisioned).
 */
export async function fetchCosmoTokenMetadata(
  tokenId: number,
  options: FetchMetadataOptions = {},
): Promise<NormalizedTokenMetadata | null> {
  const baseUrl = options.baseUrl ?? DEFAULT_ENDPOINTS.cosmoApi;
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const url = `${baseUrl}/bff/v3/objekts/nft-metadata/${tokenId}`;

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

      if (res.status === 404) {
        return null;
      }

      if (res.ok) {
        const json: unknown = await res.json();
        const parsed = CosmoMetadataV3Schema.parse(json);
        return normalizeMetadataV3(tokenId, parsed);
      }

      if (!RETRYABLE_STATUSES.has(res.status) || attempt === maxAttempts) {
        throw new Error(`COSMO v3 metadata HTTP ${res.status} for token ${tokenId}`);
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof z.ZodError || attempt === maxAttempts) {
        throw err;
      }
      lastError = err;
    }

    const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 10_000);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw lastError;
}
