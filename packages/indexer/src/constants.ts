/**
 * Verified Modhaus COSMO blockchain constants.
 *
 * Modhaus migrated COSMO from Polygon to Abstract on 2025-04-18T11:24:00Z.
 * Pre-migration sales timestamps and Polygon-era spun counts come from Polygon;
 * post-migration mints and live updates come from Abstract Mainnet (Chain ID 2741).
 */

export const ABSTRACT_CHAIN_ID = 2741;
export const POLYGON_CHAIN_ID = 137;

export const ABSTRACT_MIGRATION_ISO = "2025-04-18T11:24:00Z";
export const ABSTRACT_START_BLOCK = 6_363_806;
export const ABSTRACT_FIRST_NATIVE_TOKEN_ID = 9_419_276;

export const POLYGON_START_BLOCK = 28_000_000; // May 2022 (Atom01 launch)

export const ABSTRACT_ADDRESSES = {
  NULL: "0x0000000000000000000000000000000000000000",
  OBJEKT: "0x99bb83ae9bb0c0a6be865cacf67760947f91cb70",
  COMO: "0xd0ee3ba23a384a8eefd43f33a957ded60ed12706",
  GRAVITY: "0xf1a787da84af2a6e8227ad87112a21181b7b9b39",
  SPIN: "0xd3d5f29881ad87bb10c1100e2c709c9596de345f",
} as const;

export const POLYGON_ADDRESSES = {
  NULL: "0x0000000000000000000000000000000000000000",
  OBJEKT: "0xa4b37be40f7b231ee9574c4b16b7ddb7eacdc99b",
  SPIN: "0xd3d5f29881ad87bb10c1100e2c709c9596de345f",
} as const;

export const DEFAULT_ENDPOINTS = {
  cosmoApi: "https://api.cosmo.fans",
  abstractRpc: process.env.ABSTRACT_RPC_URL ?? "https://api.mainnet.abs.xyz",
  sqdPolygonArchive:
    process.env.SQD_POLYGON_ARCHIVE_URL ??
    "https://portal.sqd.dev/datasets/polygon-mainnet/stream",
} as const;

export const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const ZERO_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function addressToTopic(address: string): string {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function topicToAddress(topic: string): string {
  return "0x" + topic.slice(-40).toLowerCase();
}

export function slugifyCollection(collectionId: string): string {
  return collectionId
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function inferOnOffline(collectionNo: string): "online" | "offline" {
  return collectionNo.toUpperCase().includes("Z") ? "online" : "offline";
}

export function normalizeArtistId(rawArtist: string): string {
  const lower = rawArtist.trim().toLowerCase();
  if (lower === "triples") return "triples";
  if (lower === "artms") return "artms";
  return lower;
}
