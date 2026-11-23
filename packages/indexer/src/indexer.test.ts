import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateAndEmitSql,
  aggregateTradesAndEmitSql,
  inferAutoRoundGroup,
  normalizeMemberLookupKey,
} from "./aggregate.js";
import {
  turboSyncPolygonArchive,
  turboSyncPolygonRpc,
} from "./chains/polygon.js";
import { ERC721_TRANSFER_TOPIC, ZERO_TOPIC } from "./constants.js";
import { normalizeMetadataV3 } from "./cosmo-metadata.js";
import { IndexerStore } from "./store.js";
import { aggregateTradesStreaming } from "./trades-backfill.js";

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
      // Verify 2:1 asymmetric grid-tier clean solo N:1 attribution:
      // YooYeon received 2:1 (rate=2, cleanSolo2x=1, uniqueOverpayers=1, topOverpayerSharePct=100, sameEdition=0 because Atom01 + Ever01)
      // SeoYeon & NaKyoung paid bulk (rate=0.5, cleanSoloBulk=1)
      expect(tradesSql).toMatch(
        /'triples-yooyeon', 'triples', 1, 1, 1, 2, 1, \d+, [\d.]+, [\d.]+, 1, 0, 1, 0, 2, 2, 1, 1, 0, 1, 0, 2, 1, 0, 0, 1, 100, 0, 0, 0, 0, NULL/,
      );
      expect(tradesSql).toMatch(
        /'triples-seoyeon', 'triples', 1, 1, 2, 2, 1, \d+, [\d.]+, [\d.]+, 0, 1, 0, 0, 0\.5, 1, 1, 0, 1, 0, 0, 0\.5, 0, 0, 1, 0, NULL, 0, 0, 0, 0, NULL/,
      );
    } finally {
      store.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("preserves original Polygon minter wallet and timestamp when Abstract migration re-mint arrives first", () => {
    const workDir = mkdtempSync(join(tmpdir(), "objekt-stats-mig-"));
    const store = new IndexerStore(join(workDir, "test.sqlite"));
    try {
      store.insertMints([
        {
          tokenId: 500_000,
          chain: "abstract",
          blockNumber: 6_400_000,
          mintedAt: "2025-04-18T12:00:00.000Z",
          minter: "0x2222222222222222222222222222222222222222",
          txHash: "0x" + "2".repeat(64),
        },
      ]);
      store.insertMints([
        {
          tokenId: 500_000,
          chain: "polygon",
          blockNumber: 43_000_000,
          mintedAt: "2023-06-01T09:00:00.000Z",
          minter: "0x1111111111111111111111111111111111111111",
          txHash: "0x" + "1".repeat(64),
        },
      ]);

      const row = store.db
        .prepare(
          "SELECT chain, block_number, minted_at, minter, tx_hash FROM raw_mints WHERE token_id = 500000",
        )
        .get() as {
        chain: string;
        block_number: number;
        minted_at: string;
        minter: string;
        tx_hash: string;
      };
      expect(row.chain).toBe("polygon");
      expect(row.block_number).toBe(43_000_000);
      expect(row.minted_at).toBe("2023-06-01T09:00:00.000Z");
      expect(row.minter).toBe("0x1111111111111111111111111111111111111111");
      expect(row.tx_hash).toBe("0x" + "1".repeat(64));

      store.recordSyncedRange("polygon", "mints", 100, 200);
      store.recordSyncedRange("polygon", "mints", 201, 300);
      store.recordSyncedRange("polygon", "mints", 400, 500);
      expect(store.getMissingRanges("polygon", "mints", 50, 600)).toEqual([
        { fromBlock: 50, toBlock: 99 },
        { fromBlock: 301, toBlock: 399 },
        { fromBlock: 501, toBlock: 600 },
      ]);
    } finally {
      store.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("paginates SQD Polygon Portal responses strictly by lastReturnedBlock + 1 without skipping blocks", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "objekt-stats-sqd-"));
    const store = new IndexerStore(join(workDir, "test.sqlite"));
    try {
      const requestedFromBlocks: number[] = [];
      const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { fromBlock: number; toBlock: number };
        requestedFromBlocks.push(body.fromBlock);

        if (body.fromBlock === 1000) {
          // SQD Portal caps response at block 1199 even though toBlock was 1500
          const ndjson = [
            JSON.stringify({
              header: { number: 1050, timestamp: 1700000000 },
              logs: [
                {
                  logIndex: 0,
                  transactionHash: "0x" + "a".repeat(64),
                  topics: [
                    ERC721_TRANSFER_TOPIC,
                    ZERO_TOPIC,
                    "0x0000000000000000000000001111111111111111111111111111111111111111",
                    "0x0000000000000000000000000000000000000000000000000000000000000001",
                  ],
                },
              ],
            }),
            JSON.stringify({ header: { number: 1199, timestamp: 1700000300 } }),
          ].join("\n");
          return new Response(ndjson, { status: 200 });
        }

        const ndjson = [
          JSON.stringify({
            header: { number: 1350, timestamp: 1700000600 },
            logs: [
              {
                logIndex: 1,
                transactionHash: "0x" + "b".repeat(64),
                topics: [
                  ERC721_TRANSFER_TOPIC,
                  ZERO_TOPIC,
                  "0x0000000000000000000000002222222222222222222222222222222222222222",
                  "0x0000000000000000000000000000000000000000000000000000000000000002",
                ],
              },
            ],
          }),
          JSON.stringify({ header: { number: 1500, timestamp: 1700000900 } }),
        ].join("\n");
        return new Response(ndjson, { status: 200 });
      }) as typeof fetch;

      const res = await turboSyncPolygonArchive(store, {
        fromBlock: 1000,
        toBlock: 1500,
        chunkSize: 100_000,
        includeSpins: false,
        fetchImpl: mockFetch,
      });

      expect(requestedFromBlocks).toEqual([1000, 1200]);
      expect(res.totalMints).toBe(2);
      expect(res.blocksSynced).toBe(501);
      expect(store.getMergedSyncedRanges("polygon", "mints")).toEqual([
        { fromBlock: 1000, toBlock: 1500 },
      ]);
      expect(store.getSummaryCounts().mints).toBe(2);
    } finally {
      store.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("binary-splits dense Polygon RPC ranges on >20000 results error and retries 429 cleanly", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "objekt-stats-polyrpc-"));
    const store = new IndexerStore(join(workDir, "test.sqlite"));
    try {
      let saw429Once = false;
      const seenRanges: Array<[number, number]> = [];
      const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: Array<{ fromBlock: string; toBlock: string }>;
        };
        const from = Number(BigInt(body.params[0]!.fromBlock));
        const to = Number(BigInt(body.params[0]!.toBlock));
        seenRanges.push([from, to]);

        if (!saw429Once) {
          saw429Once = true;
          return new Response("rate limited", { status: 429 });
        }

        if (to - from + 1 > 5) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: {
                code: -32602,
                message: "invalid params",
                data: "Query returned more than 20000 results.",
              },
            }),
            { status: 200 },
          );
        }

        const tokenId = from === 1000 ? 10 : 20;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: [
              {
                blockNumber: "0x" + from.toString(16),
                blockTimestamp: "0x661d1416",
                transactionHash: "0x" + String(tokenId).padStart(64, "0"),
                logIndex: "0x0",
                topics: [
                  ERC721_TRANSFER_TOPIC,
                  ZERO_TOPIC,
                  "0x0000000000000000000000003333333333333333333333333333333333333333",
                  "0x" + tokenId.toString(16).padStart(64, "0"),
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      const res = await turboSyncPolygonRpc(store, {
        fromBlock: 1000,
        toBlock: 1009,
        chunkSize: 10,
        parallelism: 1,
        includeSpins: false,
        fetchImpl: mockFetch,
        retryDelayMs: 5,
      });

      expect(seenRanges).toEqual([
        [1000, 1009], // 429
        [1000, 1009], // -32602 -> split!
        [1000, 1004], // left half
        [1005, 1009], // right half
      ]);
      expect(res.totalMints).toBe(2);
      expect(res.blocksSynced).toBe(10);
      expect(store.getMergedSyncedRanges("polygon", "mints")).toEqual([
        { fromBlock: 1000, toBlock: 1009 },
      ]);
    } finally {
      store.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("streaming trade aggregator produces 100% identical counts to global in-memory aggregation across window boundaries", () => {
    const workDir = mkdtempSync(join(tmpdir(), "objekt-stats-streamtrades-"));
    const metaStore = new IndexerStore(join(workDir, "meta.sqlite"));
    const tradesStore = new IndexerStore(join(workDir, "trades.sqlite"));
    const dataRoot = resolve(import.meta.dirname, "../../../data");
    try {
      const metaBatch = [
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
          onOffline: "online" as const,
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
          onOffline: "online" as const,
          imageUrl: "https://example.com/1002.png",
          backgroundColor: "#CC097E",
        },
        {
          tokenId: 1003,
          slug: "triples-ever01-sohyun-101z",
          collectionId: "Ever01 SoHyun 101Z",
          artistId: "triples",
          rawArtist: "tripleS",
          rawMember: "SoHyun",
          season: "Ever01",
          objektClass: "First",
          collectionNo: "101Z",
          onOffline: "online" as const,
          imageUrl: "https://example.com/1003.png",
          backgroundColor: "#1222B5",
        },
      ];
      metaStore.upsertMetadataBatch(metaBatch);
      tradesStore.upsertMetadataBatch(metaBatch);

      // Trade 1 straddles a 1-hour window boundary (starts 09:50, finishes 10:05!)
      // Trade 2 happens cleanly inside a later window (14:00 -> 14:02)
      const transfers = [
        {
          txHash: "0x" + "1".repeat(64),
          logIndex: 0,
          tokenId: 1001,
          chain: "abstract" as const,
          blockNumber: 100,
          transferredAt: "2026-11-23T09:50:00.000Z",
          fromAddr: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          toAddr: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        {
          txHash: "0x" + "2".repeat(64),
          logIndex: 0,
          tokenId: 1003,
          chain: "abstract" as const,
          blockNumber: 105,
          transferredAt: "2026-11-23T09:55:00.000Z",
          fromAddr: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          toAddr: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        {
          txHash: "0x" + "3".repeat(64),
          logIndex: 0,
          tokenId: 1002,
          chain: "abstract" as const,
          blockNumber: 120,
          transferredAt: "2026-11-23T10:05:00.000Z",
          fromAddr: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          toAddr: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        {
          txHash: "0x" + "4".repeat(64),
          logIndex: 0,
          tokenId: 1001,
          chain: "polygon" as const,
          blockNumber: 500,
          transferredAt: "2026-11-23T14:00:00.000Z",
          fromAddr: "0xcccccccccccccccccccccccccccccccccccccccc",
          toAddr: "0xdddddddddddddddddddddddddddddddddddddddd",
        },
        {
          txHash: "0x" + "5".repeat(64),
          logIndex: 0,
          tokenId: 1003,
          chain: "polygon" as const,
          blockNumber: 510,
          transferredAt: "2026-11-23T14:02:00.000Z",
          fromAddr: "0xdddddddddddddddddddddddddddddddddddddddd",
          toAddr: "0xcccccccccccccccccccccccccccccccccccccccc",
        },
      ];
      tradesStore.insertTransfers(transfers);

      const globalOut = join(workDir, "global.sql");
      const streamOut = join(workDir, "stream.sql");
      const now = "2026-11-23T18:00:00.000Z";

      const globalSum = aggregateTradesAndEmitSql(tradesStore.db, {
        dataRoot,
        tradesOutFile: globalOut,
        now,
      });

      // Force tiny 1-hour windows with 2-hour padding so Trade 1 straddles window boundary
      const streamSum = aggregateTradesStreaming(tradesStore.db, {
        dataRoot,
        metadataDbPath: metaStore.dbPath,
        tradesOutFile: streamOut,
        now,
        windowMs: 3600 * 1000,
        padMs: 2 * 3600 * 1000,
      });

      expect(streamSum.confirmedTradesCount).toBe(globalSum.confirmedTradesCount);
      expect(streamSum.asymmetricTradesCount).toBe(globalSum.asymmetricTradesCount);
      expect(streamSum.confirmedTradedObjekts).toBe(globalSum.confirmedTradedObjekts);
      expect(streamSum.directP2PTransfersCount).toBe(globalSum.directP2PTransfersCount);
      expect(streamSum.tradeCollectionsCount).toBe(globalSum.tradeCollectionsCount);
      expect(streamSum.confirmedTradesCount).toBe(2);
      expect(streamSum.confirmedTradedObjekts).toBe(5);

      const streamSql = readFileSync(streamOut, "utf8");
      expect(streamSql).toContain("'triples-yooyeon', 'triples', 1, 1, 1, 2, 1");
      expect(streamSql).toContain("'triples-sohyun', 'triples', 2, 2, 2, 4, 1");
    } finally {
      metaStore.close();
      tradesStore.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
