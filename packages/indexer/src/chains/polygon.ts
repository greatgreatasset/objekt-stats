import {
  DEFAULT_ENDPOINTS,
  ERC721_TRANSFER_TOPIC,
  POLYGON_ADDRESSES,
  ZERO_TOPIC,
  addressToTopic,
  topicToAddress,
} from "../constants.js";
import type { IndexerStore, RawMintRow, RawSpinRow } from "../store.js";

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
  onProgress?: (info: {
    block: number;
    toBlock: number;
    mintsAdded: number;
    spinsAdded: number;
  }) => void;
}

/**
 * Streams historical Polygon COSMO Objekt mints & spins from SQD Portal's
 * free public NDJSON stream (May 2022 – April 18, 2025).
 */
export async function syncPolygonArchive(
  store: IndexerStore,
  options: SyncPolygonOptions,
): Promise<{ totalMints: number; totalSpins: number; lastBlock: number }> {
  const portalUrl = options.portalUrl ?? DEFAULT_ENDPOINTS.sqdPolygonArchive;
  const spinTopic = addressToTopic(POLYGON_ADDRESSES.SPIN);
  let chunkSize = options.chunkSize ?? 100_000;

  let cursor = options.fromBlock;
  let totalMints = 0;
  let totalSpins = 0;

  while (cursor <= options.toBlock) {
    const end = Math.min(cursor + chunkSize - 1, options.toBlock);

    let res: Response | null = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
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
          logs: [
            {
              address: [POLYGON_ADDRESSES.OBJEKT],
              topic0: [ERC721_TRANSFER_TOPIC],
              topic1: [ZERO_TOPIC],
            },
            {
              address: [POLYGON_ADDRESSES.OBJEKT],
              topic0: [ERC721_TRANSFER_TOPIC],
              topic2: [spinTopic],
            },
          ],
        }),
      });

      if (res.ok) break;
      if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 5) {
        if (res.status === 529 && chunkSize > 25_000) {
          chunkSize = Math.floor(chunkSize / 2);
          break;
        }
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      throw new Error(`SQD Polygon Portal error (${res.status}): ${await res.text()}`);
    }

    if (!res || !res.ok) continue;

    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);

    const mintRows: RawMintRow[] = [];
    const spinRows: RawSpinRow[] = [];
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

        if (fromTopic === ZERO_TOPIC) {
          mintRows.push({
            tokenId,
            chain: "polygon",
            blockNumber: bn,
            mintedAt: iso,
            minter: topicToAddress(toTopic),
            txHash: log.transactionHash.toLowerCase(),
          });
        } else if (toTopic === spinTopic) {
          spinRows.push({
            txHash: log.transactionHash.toLowerCase(),
            logIndex: log.logIndex,
            tokenId,
            chain: "polygon",
            blockNumber: bn,
            spunAt: iso,
          });
        }
      }
    }

    store.insertMints(mintRows);
    store.insertSpins(spinRows);
    store.setCursor("polygon:last_block", String(end));

    totalMints += mintRows.length;
    totalSpins += spinRows.length;

    options.onProgress?.({
      block: end,
      toBlock: options.toBlock,
      mintsAdded: mintRows.length,
      spinsAdded: spinRows.length,
    });

    cursor = end + 1;
  }

  return { totalMints, totalSpins, lastBlock: options.toBlock };
}
