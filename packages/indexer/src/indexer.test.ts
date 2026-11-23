import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateAndEmitSql,
  inferAutoRoundGroup,
  normalizeMemberLookupKey,
} from "./aggregate.js";
import { normalizeMetadataV3 } from "./cosmo-metadata.js";
import { IndexerStore } from "./store.js";

describe("normalizeMetadataV3", () => {
  it("parses live COSMO v3 payload into normalized collection metadata", () => {
    const parsed = normalizeMetadataV3(9419276, {
      name: "Ever01 SeoYeon 116Z #9419276",
      description: "tripleS objekt",
      image: "https://imagedelivery.net/example/original",
      background_color: "#33ECFD",
      attributes: [
        { trait_type: "Artist", value: "tripleS" },
        { trait_type: "Class", value: "First" },
        { trait_type: "Member", value: "SeoYeon" },
        { trait_type: "Season", value: "Ever01" },
        { trait_type: "Collection", value: "116Z" },
      ],
    });

    expect(parsed).toMatchObject({
      tokenId: 9419276,
      artistId: "triples",
      rawMember: "SeoYeon",
      season: "Ever01",
      objektClass: "First",
      collectionNo: "116Z",
      onOffline: "online",
      slug: "triples-ever01-seoyeon-116z",
    });
  });
});

describe("inferAutoRoundGroup", () => {
  it("buckets FCO editions cleanly and excludes Welcome/Special/Physical from popularity", () => {
    const fcoEd1 = inferAutoRoundGroup("triples", "Cream02", "First", "105Z", "online");
    expect(fcoEd1.slug).toBe("triples-cream02-fco-ed1-digital");
    expect(fcoEd1.includeInPopularity).toBe(true);

    const fcoEd2 = inferAutoRoundGroup("triples", "Cream02", "First", "112Z", "online");
    expect(fcoEd2.slug).toBe("triples-cream02-fco-ed2-digital");
    expect(fcoEd2.includeInPopularity).toBe(true);

    const dcoPhys = inferAutoRoundGroup("triples", "Cream02", "Double", "301A", "offline");
    expect(dcoPhys.saleMechanic).toBe("physical_scan");
    expect(dcoPhys.includeInPopularity).toBe(false);

    const welcome = inferAutoRoundGroup("artms", "Atom02", "Welcome", "100Z", "online");
    expect(welcome.saleMechanic).toBe("reward");
    expect(welcome.includeInPopularity).toBe(false);
  });

  it("normalizes member names across spacing and casing", () => {
    expect(normalizeMemberLookupKey("Kim Lip")).toBe("kimlip");
    expect(normalizeMemberLookupKey("KimLip")).toBe("kimlip");
    expect(normalizeMemberLookupKey("YooYeon")).toBe("yooyeon");
  });
});

describe("aggregateAndEmitSql trade isolation", () => {
  it("keeps user-to-user trades strictly out of newly minted primary sales while emitting accurate trade stats", () => {
    const workDir = mkdtempSync(join(tmpdir(), "objekt-stats-test-"));
    const store = new IndexerStore(join(workDir, "test.sqlite"));
    const dataRoot = resolve(import.meta.dirname, "../../../data");

    try {
      // 2 primary mints (SeoYeon + YooYeon)
      store.insertMints([
        {
          tokenId: 1001,
          chain: "abstract",
          blockNumber: 89_600_001,
          mintedAt: "2026-11-23T09:00:00.000Z",
          minter: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          txHash: "0x" + "1".repeat(64),
        },
        {
          tokenId: 1002,
          chain: "abstract",
          blockNumber: 89_600_002,
          mintedAt: "2026-11-23T09:01:00.000Z",
          minter: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          txHash: "0x" + "2".repeat(64),
        },
      ]);

      // Metadata for the 2 newly minted tokens + 1 older token (500) that was NEVER in raw_mints
      store.upsertMetadataBatch([
        {
          tokenId: 1001,
          slug: "triples-ever01-seoyeon-101z",
          collectionId: "Ever01 SeoYeon 101Z",
          artistId: "triples",
          rawArtist: "tripleS",
          rawMember: "SeoYeon",
          season: "Ever01",
          objektClass: "First",
          collectionNo: "101Z",
          onOffline: "online",
          imageUrl: "https://example.com/1001.png",
          backgroundColor: "#22AEFF",
        },
        {
          tokenId: 1002,
          slug: "triples-ever01-yooyeon-101z",
          collectionId: "Ever01 YooYeon 101Z",
          artistId: "triples",
          rawArtist: "tripleS",
          rawMember: "YooYeon",
          season: "Ever01",
          objektClass: "First",
          collectionNo: "101Z",
          onOffline: "online",
          imageUrl: "https://example.com/1002.png",
          backgroundColor: "#CC097E",
        },
        {
          tokenId: 500,
          slug: "triples-atom01-nakyoung-101z",
          collectionId: "Atom01 NaKyoung 101Z",
          artistId: "triples",
          rawArtist: "tripleS",
          rawMember: "NaKyoung",
          season: "Atom01",
          objektClass: "First",
          collectionNo: "101Z",
          onOffline: "online",
          imageUrl: "https://example.com/500.png",
          backgroundColor: "#6799A0",
        },
      ]);

      // 1 confirmed reciprocal trade (Alice sends 1001 & 500, Bob sends 1002 within 2 min)
      // + 1 one-way direct transfer (Bob sends 1001 to Carol)
      store.insertTransfers([
        {
          txHash: "0x" + "a".repeat(64),
          logIndex: 1,
          tokenId: 1001,
          chain: "abstract",
          blockNumber: 89_600_100,
          transferredAt: "2026-11-23T10:00:00.000Z",
          fromAddr: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          toAddr: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        {
          txHash: "0x" + "b".repeat(64),
          logIndex: 1,
          tokenId: 500,
          chain: "abstract",
          blockNumber: 89_600_110,
          transferredAt: "2026-11-23T10:00:30.000Z",
          fromAddr: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          toAddr: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        {
          txHash: "0x" + "c".repeat(64),
          logIndex: 1,
          tokenId: 1002,
          chain: "abstract",
          blockNumber: 89_600_160,
          transferredAt: "2026-11-23T10:02:00.000Z",
          fromAddr: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          toAddr: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        {
          txHash: "0x" + "d".repeat(64),
          logIndex: 1,
          tokenId: 1001,
          chain: "abstract",
          blockNumber: 89_600_500,
          transferredAt: "2026-11-23T11:30:00.000Z",
          fromAddr: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          toAddr: "0xcccccccccccccccccccccccccccccccccccccccc",
        },
      ]);

      const outFile = join(workDir, "sync-onchain.sql");
      const tradesOutFile = join(workDir, "sync-trades.sql");
      const snapshotFile = join(workDir, "snapshot.json");

      const summary = aggregateAndEmitSql(store, {
        dataRoot,
        outFile,
        tradesOutFile,
        snapshotFile,
      });

      // Primary sales: strictly 2 collections (NOT 3 — older traded token 500 is NOT in raw_mints!)
      expect(summary.collectionsCount).toBe(2);
      expect(summary.roundsCount).toBe(1);

      // Secondary trades: 1 confirmed trade (3 objekts traded), 4 direct P2P transfers across 3 collections
      expect(summary.confirmedTradesCount).toBe(1);
      expect(summary.confirmedTradedObjekts).toBe(3);
      expect(summary.directP2PTransfersCount).toBe(4);
      expect(summary.tradeCollectionsCount).toBe(3);

      const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8")) as {
        rounds: Array<{ slug: string; totalMints: number }>;
      };
      // Round total mints MUST be exactly 2 (never inflated by the 4 P2P transfers!)
      expect(snapshot.rounds[0]!.totalMints).toBe(2);

      const tradesSql = readFileSync(tradesOutFile, "utf8");
      expect(tradesSql).toContain("triples-atom01-nakyoung-101z");
      expect(tradesSql).toContain("INSERT OR REPLACE INTO recent_trades");
      expect(tradesSql).toContain("INSERT OR REPLACE INTO member_trade_stats");
    } finally {
      store.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
