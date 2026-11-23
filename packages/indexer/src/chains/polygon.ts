import { isEligibleP2PTransfer } from "@objekt-stats/stats";
import {
  DEFAULT_ENDPOINTS,
  ERC721_TRANSFER_TOPIC,
  POLYGON_ADDRESSES,
  ZERO_TOPIC,
  addressToTopic,
  topicToAddress,
} from "../constants.js";
import type {
  IndexerStore,
  RawMintRow,
  RawSpinRow,
  RawTransferRow,
} from "../store.js";

interface SqdBlock {
  header: {
    number: number;
    timestamp: number; // unix seconds
  };
  logs?: Array<{
    logIndex: number;
    transactionHash: string;
    topics: string[];
  }>;
}

export interface SyncPolygonOptions {
  fromBlock: number;
  toBlock: number;
  chunkSize?: number;
  portalUrl?: string;
  includeTransfers?: boolean;
  transfersOnly?: boolean;
  onProgress?: (info: {
    block: number;
    toBlock: number;
    mintsAdded: number;
    spinsAdded: number;
    transfersAdded: number;
  }) => void;
}

/**
 * Streams historical Polygon COSMO Objekt mints, spins, and P2P transfers from
 * SQD Portal's free public NDJSON stream (May 2022 – April 18, 2025).
 *
 * Strictly separates primary mints (`from === 0x0`) from P2P transfers so
 * secondary trades can never contaminate primary newly-minted sales data.
 */
export async function syncPolygonArchive(
  store: IndexerStore,
  options: SyncPolygonOptions,
): Promise<{
  totalMints: number;
  totalSpins: number;
  totalTransfers: number;
  lastBlock: number;
}> {
  const portalUrl = options.portalUrl ?? DEFAULT_ENDPOINTS.sqdPolygonArchive;
  const spinTopic = addressToTopic(POLYGON_ADDRESSES.SPIN);
  const includeTransfers = options.includeTransfers ?? true;
  const transfersOnly = options.transfersOnly ?? false;
  let chunkSize = options.chunkSize ?? 100_000;

  let cursor = options.fromBlock;
  let totalMints = 0;
  let totalSpins = 0;
  let totalTransfers = 0;

  while (cursor <= options.toBlock) {
    const end = Math.min(cursor + chunkSize - 1, options.toBlock);

    const polygonContracts = [
      POLYGON_ADDRESSES.OBJEKT,
      POLYGON_ADDRESSES.OBJEKT_ARTMS,
    ];
    const logFilters =
      includeTransfers || transfersOnly
        ? [
            {
              address: polygonContracts,
              topic0: [ERC721_TRANSFER_TOPIC],
            },
          ]
        : [
            {
              address: polygonContracts,
              topic0: [ERC721_TRANSFER_TOPIC],
              topic1: [ZERO_TOPIC],
            },
            {
              address: polygonContracts,
              topic0: [ERC721_TRANSFER_TOPIC],
              topic2: [spinTopic],
            },
          ];

    let res: Response | null = null;
    for (let attempt = 1; attempt <= 12; attempt++) {
      res = await fetch(portalUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "evm",
          fromBlock: cursor,
          toBlock: end,
          fields: {
            block: { number: true, timestamp: true },
            log: { logIndex: true, transactionHash: true, topics: true },
          },
          logs: logFilters,
        }),
      });

      if (res.ok) break;
      if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 12) {
        if (res.status === 529 && chunkSize > 25_000) {
          chunkSize = Math.floor(chunkSize / 2);
          await new Promise((r) => setTimeout(r, 1500));
          break;
        }
        const waitMs = Math.min(15_000, 1_000 * attempt * attempt);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`SQD Polygon Portal error (${res.status}): ${await res.text()}`);
    }

    if (!res || !res.ok) continue;

    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);

    const mintRows: RawMintRow[] = [];
    const spinRows: RawSpinRow[] = [];
    const transferRows: RawTransferRow[] = [];
    let maxBlockInBatch = end;

    for (const line of lines) {
      const block = JSON.parse(line) as SqdBlock;
      const bn = block.header.number;
      if (bn > maxBlockInBatch) maxBlockInBatch = bn;
      const iso = new Date(block.header.timestamp * 1000).toISOString();

      for (const log of block.logs ?? []) {
        if (log.topics.length < 4) continue;
        const fromTopic = log.topics[1]!.toLowerCase();
        const toTopic = log.topics[2]!.toLowerCase();
        const tokenId = Number(BigInt(log.topics[3]!));
        const txHash = log.transactionHash.toLowerCase();

        if (fromTopic === ZERO_TOPIC) {
          if (!transfersOnly) {
            mintRows.push({
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              mintedAt: iso,
              minter: topicToAddress(toTopic),
              txHash,
            });
          }
        } else if (toTopic === spinTopic) {
          if (!transfersOnly) {
            spinRows.push({
              txHash,
              logIndex: log.logIndex,
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              spunAt: iso,
            });
          }
        } else if (includeTransfers || transfersOnly) {
          const fromAddr = topicToAddress(fromTopic);
          const toAddr = topicToAddress(toTopic);
          if (isEligibleP2PTransfer(fromAddr, toAddr)) {
            transferRows.push({
              txHash,
              logIndex: log.logIndex,
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              transferredAt: iso,
              fromAddr,
              toAddr,
            });
          }
        }
      }
    }

    if (!transfersOnly) {
      store.insertMints(mintRows);
      store.insertSpins(spinRows);
      store.setCursor("polygon:last_block", String(end));
    }
    if (transferRows.length > 0) {
      store.insertTransfers(transferRows);
    }
    if (includeTransfers || transfersOnly) {
      store.setCursor("polygon:transfers_last_block", String(end));
    }

    totalMints += mintRows.length;
    totalSpins += spinRows.length;
    totalTransfers += transferRows.length;

    options.onProgress?.({
      block: end,
      toBlock: options.toBlock,
      mintsAdded: mintRows.length,
      spinsAdded: spinRows.length,
      transfersAdded: transferRows.length,
    });

    cursor = end + 1;
  }

  return { totalMints, totalSpins, totalTransfers, lastBlock: options.toBlock };
}

export interface TurboSyncPolygonOptions {
  fromBlock: number;
  toBlock: number;
  chunkSize?: number;
  portalUrl?: string;
  includeSpins?: boolean;
  onProgress?: (info: {
    block: number;
    toBlock: number;
    blocksSynced: number;
    totalBlocks: number;
    mintsAdded: number;
    spinsAdded: number;
    chunkSize: number;
  }) => void;
}

/**
 * Gap-free, crash-resumable full-history Polygon SQD archive syncer covering BOTH
 * tripleS (`0xa4b37be4...`) and ARTMS (`0x0fb69f54...`) contracts from genesis to
 * April 18, 2025 Abstract migration.
 */
export async function turboSyncPolygonArchive(
  store: IndexerStore,
  options: TurboSyncPolygonOptions,
): Promise<{
  totalMints: number;
  totalSpins: number;
  blocksSynced: number;
}> {
  const portalUrl = options.portalUrl ?? DEFAULT_ENDPOINTS.sqdPolygonArchive;
  const spinTopic = addressToTopic(POLYGON_ADDRESSES.SPIN);
  const includeSpins = options.includeSpins ?? true;
  const maxChunkSize = options.chunkSize ?? 100_000;
  let chunkSize = maxChunkSize;

  const missingRanges = store.getMissingRanges(
    "polygon",
    "mints",
    options.fromBlock,
    options.toBlock,
  );
  const totalBlocks = missingRanges.reduce(
    (s, r) => s + (r.toBlock - r.fromBlock + 1),
    0,
  );
  if (totalBlocks === 0) {
    return { totalMints: 0, totalSpins: 0, blocksSynced: 0 };
  }

  const polygonContracts = [
    POLYGON_ADDRESSES.OBJEKT,
    POLYGON_ADDRESSES.OBJEKT_ARTMS,
  ];
  const logFilters = includeSpins
    ? [
        {
          address: polygonContracts,
          topic0: [ERC721_TRANSFER_TOPIC],
          topic1: [ZERO_TOPIC],
        },
        {
          address: polygonContracts,
          topic0: [ERC721_TRANSFER_TOPIC],
          topic2: [spinTopic],
        },
      ]
    : [
        {
          address: polygonContracts,
          topic0: [ERC721_TRANSFER_TOPIC],
          topic1: [ZERO_TOPIC],
        },
      ];

  let totalMints = 0;
  let totalSpins = 0;
  let blocksSynced = 0;
  let cleanStreak = 0;

  for (const range of missingRanges) {
    let cursor = range.fromBlock;
    while (cursor <= range.toBlock) {
      const end = Math.min(cursor + chunkSize - 1, range.toBlock);

      let res: Response | null = null;
      let shrinkRetry = false;
      for (let attempt = 1; attempt <= 20; attempt++) {
        try {
          res = await fetch(portalUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "evm",
              fromBlock: cursor,
              toBlock: end,
              fields: {
                block: { number: true, timestamp: true },
                log: { logIndex: true, transactionHash: true, topics: true },
              },
              logs: logFilters,
            }),
          });
        } catch (err) {
          const waitMs = Math.min(20_000, 1_500 * attempt);
          if (attempt === 20) throw err;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        if (res.ok) break;
        const status = res.status;
        const body = await res.text().catch(() => "");
        if (status === 429 || status === 529 || status >= 500) {
          cleanStreak = 0;
          if (status === 529 && chunkSize > 15_000) {
            chunkSize = Math.max(15_000, Math.floor(chunkSize / 2));
            await new Promise((r) => setTimeout(r, 2_000 + Math.random() * 1_500));
            shrinkRetry = true;
            break;
          }
          const waitMs = Math.min(30_000, 1_500 * Math.min(attempt, 6) * 2 + Math.random() * 1_000);
          if (attempt === 20) {
            throw new Error(`SQD Polygon Portal error (${status}): ${body}`);
          }
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`SQD Polygon Portal error (${status}): ${body}`);
      }

      if (shrinkRetry || !res || !res.ok) continue;

      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);

      const mintRows: RawMintRow[] = [];
      const spinRows: RawSpinRow[] = [];

      for (const line of lines) {
        const block = JSON.parse(line) as SqdBlock;
        const bn = block.header.number;
        const iso = new Date(block.header.timestamp * 1000).toISOString();

        for (const log of block.logs ?? []) {
          if (log.topics.length < 4) continue;
          const fromTopic = log.topics[1]!.toLowerCase();
          const toTopic = log.topics[2]!.toLowerCase();
          const tokenId = Number(BigInt(log.topics[3]!));
          const txHash = log.transactionHash.toLowerCase();

          if (fromTopic === ZERO_TOPIC) {
            mintRows.push({
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              mintedAt: iso,
              minter: topicToAddress(toTopic),
              txHash,
            });
          } else if (includeSpins && toTopic === spinTopic) {
            spinRows.push({
              txHash,
              logIndex: log.logIndex,
              tokenId,
              chain: "polygon",
              blockNumber: bn,
              spunAt: iso,
            });
          }
        }
      }

      store.insertMintsSpinsAndRange("polygon", cursor, end, mintRows, spinRows);
      store.setCursor("polygon:last_block", String(end));

      totalMints += mintRows.length;
      totalSpins += spinRows.length;
      blocksSynced += end - cursor + 1;
      cleanStreak++;

      options.onProgress?.({
        block: end,
        toBlock: options.toBlock,
        blocksSynced,
        totalBlocks,
        mintsAdded: totalMints,
        spinsAdded: totalSpins,
        chunkSize,
      });

      cursor = end + 1;
      // Gently recover chunk size after consecutive healthy chunks
      if (cleanStreak >= 5 && chunkSize < maxChunkSize) {
        chunkSize = Math.min(maxChunkSize, Math.floor(chunkSize * 1.5));
        cleanStreak = 0;
      }
    }
  }

  store.compactSyncedRanges("polygon", "mints");
  return { totalMints, totalSpins, blocksSynced };
}
