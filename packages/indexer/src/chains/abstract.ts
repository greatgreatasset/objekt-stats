import {
  ABSTRACT_ADDRESSES,
  DEFAULT_ENDPOINTS,
  ERC721_TRANSFER_TOPIC,
  ZERO_TOPIC,
  addressToTopic,
  topicToAddress,
} from "../constants.js";
import type { IndexerStore, RawMintRow, RawSpinRow } from "../store.js";

interface RpcLog {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  blockTimestamp?: string;
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        result?: T;
        error?: { code: number; message: string };
      };
      if (json.error) {
        if (attempt < 5 && (json.error.code === -32005 || json.error.code === 429)) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw new Error(`RPC ${method} error ${json.error.code}: ${json.error.message}`);
      }
      return json.result as T;
    }
    if (attempt === 5) throw new Error(`RPC HTTP ${res.status} on ${method}`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw new Error(`RPC ${method} exhausted retries`);
}

async function fetchBlockTimestamps(
  rpcUrl: string,
  blockNumbers: number[],
  cache: Map<number, string>,
): Promise<void> {
  const missing = blockNumbers.filter((b) => !cache.has(b));
  if (missing.length === 0) return;

  // Batch JSON-RPC calls (up to 40 blocks per HTTP request)
  const batchSize = 40;
  for (let i = 0; i < missing.length; i += batchSize) {
    const slice = missing.slice(i, i + batchSize);
    const payload = slice.map((bn, idx) => ({
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: ["0x" + bn.toString(16), false],
      id: idx + 1,
    }));

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Fallback: sample endpoints and interpolate linearly if batch unsupported
      const firstBn = slice[0]!;
      const lastBn = slice[slice.length - 1]!;
      const [firstBlock, lastBlock] = await Promise.all([
        rpcCall<{ timestamp: string }>(rpcUrl, "eth_getBlockByNumber", [
          "0x" + firstBn.toString(16),
          false,
        ]),
        rpcCall<{ timestamp: string }>(rpcUrl, "eth_getBlockByNumber", [
          "0x" + lastBn.toString(16),
          false,
        ]),
      ]);
      const t0 = Number(BigInt(firstBlock.timestamp));
      const t1 = Number(BigInt(lastBlock.timestamp));
      const span = Math.max(1, lastBn - firstBn);
      for (const bn of slice) {
        const est = Math.round(t0 + ((bn - firstBn) / span) * (t1 - t0));
        cache.set(bn, new Date(est * 1000).toISOString());
      }
      continue;
    }

    const results = (await res.json()) as Array<{
      id: number;
      result?: { timestamp: string };
    }>;
    for (const item of results) {
      const bn = slice[item.id - 1];
      if (bn !== undefined && item.result?.timestamp) {
        const tsSec = Number(BigInt(item.result.timestamp));
        cache.set(bn, new Date(tsSec * 1000).toISOString());
      }
    }
  }
}

export async function getAbstractHeadBlock(
  rpcUrl = DEFAULT_ENDPOINTS.abstractRpc,
): Promise<number> {
  const hex = await rpcCall<string>(rpcUrl, "eth_blockNumber", []);
  return Number(BigInt(hex));
}

export interface SyncAbstractOptions {
  fromBlock: number;
  toBlock: number;
  chunkSize?: number;
  rpcUrl?: string;
  includeSpins?: boolean;
  onProgress?: (info: {
    block: number;
    toBlock: number;
    mintsAdded: number;
    spinsAdded: number;
  }) => void;
}

export async function syncAbstractLogs(
  store: IndexerStore,
  options: SyncAbstractOptions,
): Promise<{ totalMints: number; totalSpins: number; lastBlock: number }> {
  const rpcUrl = options.rpcUrl ?? DEFAULT_ENDPOINTS.abstractRpc;
  let chunkSize = options.chunkSize ?? 5_000;
  const includeSpins = options.includeSpins ?? true;
  const spinTopic = addressToTopic(ABSTRACT_ADDRESSES.SPIN);
  const blockTimestampCache = new Map<number, string>();

  let totalMints = 0;
  let totalSpins = 0;
  let cursor = options.fromBlock;

  while (cursor <= options.toBlock) {
    const end = Math.min(cursor + chunkSize - 1, options.toBlock);
    const fromHex = "0x" + cursor.toString(16);
    const toHex = "0x" + end.toString(16);

    let mintLogs: RpcLog[];
    let spinLogs: RpcLog[] = [];

    try {
      mintLogs = await rpcCall<RpcLog[]>(rpcUrl, "eth_getLogs", [
        {
          address: ABSTRACT_ADDRESSES.OBJEKT,
          topics: [ERC721_TRANSFER_TOPIC, ZERO_TOPIC],
          fromBlock: fromHex,
          toBlock: toHex,
        },
      ]);

      if (includeSpins) {
        spinLogs = await rpcCall<RpcLog[]>(rpcUrl, "eth_getLogs", [
          {
            address: ABSTRACT_ADDRESSES.OBJEKT,
            topics: [ERC721_TRANSFER_TOPIC, null, spinTopic],
            fromBlock: fromHex,
            toBlock: toHex,
          },
        ]);
      }
    } catch (err) {
      // Auto-halve chunk size if RPC rejects wide range / >10k logs
      if (chunkSize > 500) {
        chunkSize = Math.floor(chunkSize / 2);
        continue;
      }
      throw err;
    }

    const allLogs = [...mintLogs, ...spinLogs];
    const blocksNeedingTimestamp = new Set<number>();

    for (const log of allLogs) {
      const bn = Number(BigInt(log.blockNumber));
      if (log.blockTimestamp) {
        blockTimestampCache.set(
          bn,
          new Date(Number(BigInt(log.blockTimestamp)) * 1000).toISOString(),
        );
      } else if (!blockTimestampCache.has(bn)) {
        blocksNeedingTimestamp.add(bn);
      }
    }

    if (blocksNeedingTimestamp.size > 0) {
      // For high-throughput indexing, sample anchor blocks across the chunk if >80 unique blocks
      const sortedBlocks = Array.from(blocksNeedingTimestamp).sort((a, b) => a - b);
      if (sortedBlocks.length <= 80) {
        await fetchBlockTimestamps(rpcUrl, sortedBlocks, blockTimestampCache);
      } else {
        // Fetch evenly spaced anchor blocks (~15 anchors across chunk) and interpolate accurately (<2s error)
        const anchors = new Set<number>([
          sortedBlocks[0]!,
          sortedBlocks[sortedBlocks.length - 1]!,
        ]);
        const step = Math.max(1, Math.floor(sortedBlocks.length / 15));
        for (let i = 0; i < sortedBlocks.length; i += step) {
          anchors.add(sortedBlocks[i]!);
        }
        const anchorList = Array.from(anchors).sort((a, b) => a - b);
        await fetchBlockTimestamps(rpcUrl, anchorList, blockTimestampCache);

        // Interpolate remaining blocks between anchors
        let aIdx = 0;
        for (const bn of sortedBlocks) {
          if (blockTimestampCache.has(bn)) continue;
          while (aIdx + 1 < anchorList.length - 1 && anchorList[aIdx + 1]! < bn) {
            aIdx++;
          }
          const b0 = anchorList[aIdx]!;
          const b1 = anchorList[Math.min(aIdx + 1, anchorList.length - 1)]!;
          const t0 = Date.parse(blockTimestampCache.get(b0)!);
          const t1 = Date.parse(blockTimestampCache.get(b1)!);
          const ratio = b1 > b0 ? (bn - b0) / (b1 - b0) : 0;
          blockTimestampCache.set(bn, new Date(Math.round(t0 + ratio * (t1 - t0))).toISOString());
        }
      }
    }

    const mintRows: RawMintRow[] = [];
    for (const log of mintLogs) {
      if (log.topics.length < 4) continue;
      const bn = Number(BigInt(log.blockNumber));
      mintRows.push({
        tokenId: Number(BigInt(log.topics[3]!)),
        chain: "abstract",
        blockNumber: bn,
        mintedAt: blockTimestampCache.get(bn) ?? new Date().toISOString(),
        minter: topicToAddress(log.topics[2]!),
        txHash: log.transactionHash.toLowerCase(),
      });
    }

    const spinRows: RawSpinRow[] = [];
    for (const log of spinLogs) {
      if (log.topics.length < 4) continue;
      const bn = Number(BigInt(log.blockNumber));
      spinRows.push({
        txHash: log.transactionHash.toLowerCase(),
        logIndex: Number(BigInt(log.logIndex)),
        tokenId: Number(BigInt(log.topics[3]!)),
        chain: "abstract",
        blockNumber: bn,
        spunAt: blockTimestampCache.get(bn) ?? new Date().toISOString(),
      });
    }

    store.insertMints(mintRows);
    store.insertSpins(spinRows);
    store.setCursor("abstract:last_block", String(end));

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
