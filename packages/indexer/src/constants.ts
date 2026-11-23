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

export const ABSTRACT_ADDRESSES = {
  NULL: "0x0000000000000000000000000000000000000000",
  OBJEKT: "0x99bb83ae9bb0c0a6be865cacf67760947f91cb70",
  COMO: "0xd0ee3ba23a384a8eefd43f33a957ded60ed12706",
  GRAVITY: "0xf1a787da84af2a6e8227ad87112a21181b7b9b39",
  SPIN: "0xd3d5f29881ad87bb10c1100e2c709c9596de345f",
} as const;

export const DEFAULT_ENDPOINTS = {
  cosmoApi: "https://api.cosmo.fans",
  abstractRpc: "https://api.mainnet.abs.xyz",
  sqdAbstractGateway: "https://v2.archive.subsquid.io/network/abstract-mainnet",
  sqdPolygonGateway: "https://v2.archive.subsquid.io/network/polygon-mainnet",
} as const;

export const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

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
