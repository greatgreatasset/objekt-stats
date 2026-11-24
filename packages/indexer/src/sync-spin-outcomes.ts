import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadCurationData } from "@objekt-stats/db/curation-loader";
import {
  classifySpinOutputClass,
  pairSpinOutcomes,
  shortenAddress,
  type RawSpinMintEvent,
  type RawSpinOutEvent,
} from "@objekt-stats/stats";
import { normalizeMemberLookupKey } from "./aggregate.js";
import {
  ABSTRACT_ADDRESSES,
  DEFAULT_ENDPOINTS,
  ERC721_TRANSFER_TOPIC,
  ZERO_TOPIC,
  addressToTopic,
  topicToAddress,
} from "./constants.js";
import { fetchCosmoTokenMetadataFast } from "./cosmo-metadata.js";

interface RpcLog {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  blockTimestamp?: string;
}

interface TokenMetaInfo {
  artistId: string;
  collectionId: string;
  rawMember: string;
  season: string;
  objektClass: string;
  collectionNo: string;
  imageUrl: string | null;
  supply: number | null;
}

function sqlStr(val: string | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  return `'${val.replace(/'/g, "''")}'`;
}

function sqlNum(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "NULL";
  return String(val);
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          result?: T;
          error?: { code?: number; message?: string };
        };
        if (json.error) {
          throw new Error(`RPC ${method} error: ${json.error.message}`);
        }
        return json.result as T;
      }
    } catch (err) {
      if (attempt === 6) throw err;
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw new Error(`RPC ${method} failed`);
}

async function getLogsSplit(
  rpcUrl: string,
  fromBlock: number,
  toBlock: number,
  topics: Array<string | null>,
): Promise<RpcLog[]> {
  try {
    return await rpcCall<RpcLog[]>(rpcUrl, "eth_getLogs", [
      {
        address: ABSTRACT_ADDRESSES.OBJEKT,
        topics,
        fromBlock: "0x" + fromBlock.toString(16),
        toBlock: "0x" + toBlock.toString(16),
      },
    ]);
  } catch (err) {
    if (toBlock - fromBlock <= 2) throw err;
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogsSplit(rpcUrl, fromBlock, mid, topics);
    const right = await getLogsSplit(rpcUrl, mid + 1, toBlock, topics);
    return [...left, ...right];
  }
}

function parseArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return fallback;
}

/**
 * Fetches Abstract COSMO Spin (`Transfer(wallet -> SPIN)`) and primary Mint (`Transfer(0x0 -> wallet)`)
 * logs over a block window, pairs each spin with its exact on-chain reward mint (or Blank/Nothing),
 * resolves token metadata via local `indexer.sqlite` + COSMO v3 API fallback, and emits
 * `packages/db/generated/sync-spins.sql` for D1.
 */
async function main() {
  const blocks = Number(parseArg("blocks", "150000")); // ~41 hours (~25k+ real spins!)
  const chunkSize = Number(parseArg("chunk", "5000"));
  const rpcUrl = DEFAULT_ENDPOINTS.abstractRpc;

  const repoRoot = resolve(import.meta.dirname, "../../..");
  const sqlitePath = resolve(repoRoot, "data/raw/indexer.sqlite");
  const outPath = resolve(repoRoot, "packages/db/generated/sync-spins.sql");
  const curation = loadCurationData(resolve(repoRoot, "data"));

  const memberLookup = new Map<string, string>();
  for (const artist of curation.artists) {
    for (const m of artist.members) {
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.name)}`, m.id);
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.cosmoName)}`, m.id);
      memberLookup.set(`${artist.id}:${normalizeMemberLookupKey(m.fullName)}`, m.id);
    }
  }

  const head = Number(BigInt(await rpcCall<string>(rpcUrl, "eth_blockNumber", [])));
  const toBlock = head - 300; // 5-min settlement tail so trailing spins are settled
  const fromBlock = Math.max(6_363_806, toBlock - blocks);
  const spinTopic = addressToTopic(ABSTRACT_ADDRESSES.SPIN);

  console.log(
    `Syncing paired Abstract spin outcomes: blocks ${fromBlock.toLocaleString()} → ${toBlock.toLocaleString()} (${blocks.toLocaleString()} blocks)...`,
  );

  const rawSpinLogs: RpcLog[] = [];
  const rawMintLogs: RpcLog[] = [];
  for (let b = fromBlock; b <= head; b += chunkSize) {
    const end = Math.min(b + chunkSize - 1, head);
    const [sLogs, mLogs] = await Promise.all([
      b <= toBlock
        ? getLogsSplit(rpcUrl, b, Math.min(end, toBlock), [
            ERC721_TRANSFER_TOPIC,
            null,
            spinTopic,
          ])
        : Promise.resolve([]),
      getLogsSplit(rpcUrl, b, end, [ERC721_TRANSFER_TOPIC, ZERO_TOPIC]),
    ]);
    for (const l of sLogs) rawSpinLogs.push(l);
    for (const l of mLogs) rawMintLogs.push(l);
    if ((b - fromBlock) % (chunkSize * 5) === 0 || end >= head) {
      console.log(
        `  fetched through block ${end.toLocaleString()} | spins=${rawSpinLogs.length.toLocaleString()} mints=${rawMintLogs.length.toLocaleString()}`,
      );
    }
  }

  // Count mints per (txHash, recipient) so Modhaus multi-wallet relayer batches still pair cleanly!
  const walletMintCountByTx = new Map<string, number>();
  for (const l of rawMintLogs) {
    if (l.topics.length < 4) continue;
    const key = `${l.transactionHash.toLowerCase()}|${topicToAddress(l.topics[2]!)}`;
    walletMintCountByTx.set(key, (walletMintCountByTx.get(key) ?? 0) + 1);
  }

  const spinEvents: RawSpinOutEvent[] = [];
  for (const l of rawSpinLogs) {
    if (l.topics.length < 4) continue;
    const bn = Number(BigInt(l.blockNumber));
    const tsIso = l.blockTimestamp
      ? new Date(Number(BigInt(l.blockTimestamp)) * 1000).toISOString()
      : new Date().toISOString();
    spinEvents.push({
      txHash: l.transactionHash.toLowerCase(),
      logIndex: Number(BigInt(l.logIndex)),
      chain: "abstract",
      blockNumber: bn,
      timestampIso: tsIso,
      spinner: topicToAddress(l.topics[1]!),
      tokenId: Number(BigInt(l.topics[3]!)),
    });
  }

  const mintEvents: RawSpinMintEvent[] = [];
  for (const l of rawMintLogs) {
    if (l.topics.length < 4) continue;
    const bn = Number(BigInt(l.blockNumber));
    const txHash = l.transactionHash.toLowerCase();
    const recipient = topicToAddress(l.topics[2]!);
    const tsIso = l.blockTimestamp
      ? new Date(Number(BigInt(l.blockTimestamp)) * 1000).toISOString()
      : new Date().toISOString();
    mintEvents.push({
      txHash,
      logIndex: Number(BigInt(l.logIndex)),
      chain: "abstract",
      blockNumber: bn,
      timestampIso: tsIso,
      recipient,
      tokenId: Number(BigInt(l.topics[3]!)),
      walletMintCountInTx: walletMintCountByTx.get(`${txHash}|${recipient}`) ?? 1,
    });
  }

  const paired = pairSpinOutcomes(spinEvents, mintEvents, 240);
  console.log(`Paired ${paired.length.toLocaleString()} spin events.`);

  // Collect all unique token IDs (both spun inputs and matched outputs)
  const neededIds = new Set<number>();
  for (const p of paired) {
    neededIds.add(p.spin.tokenId);
    if (p.rewardMint) neededIds.add(p.rewardMint.tokenId);
  }
  const allIds = Array.from(neededIds);
  const metaMap = new Map<number, TokenMetaInfo>();

  // 1. Hydrate instantly from local indexer.sqlite cache where available
  if (existsSync(sqlitePath)) {
    const roDb = new DatabaseSync(sqlitePath, { open: true, readOnly: true });
    // Preload collection supply map
    const supplyByColId = new Map<number, number>();
    const supplyRows = roDb
      .prepare("SELECT col_id, COUNT(*) AS cnt FROM token_collections GROUP BY col_id")
      .all() as Array<{ col_id: number; cnt: number }>;
    for (const r of supplyRows) supplyByColId.set(r.col_id, r.cnt);

    for (let i = 0; i < allIds.length; i += 500) {
      const slice = allIds.slice(i, i + 500);
      const placeholders = slice.map(() => "?").join(",");
      const rows = roDb
        .prepare(
          `SELECT tc.token_id, tc.col_id, cc.artist_id, cc.collection_id, cc.raw_member,
                  cc.season, cc.objekt_class, cc.collection_no, cc.image_url
           FROM token_collections tc
           JOIN collection_catalog cc ON cc.col_id = tc.col_id
           WHERE tc.token_id IN (${placeholders})`,
        )
        .all(...slice) as Array<{
        token_id: number;
        col_id: number;
        artist_id: string;
        collection_id: string;
        raw_member: string;
        season: string;
        objekt_class: string;
        collection_no: string;
        image_url: string;
      }>;
      for (const r of rows) {
        metaMap.set(r.token_id, {
          artistId: r.artist_id,
          collectionId: r.collection_id,
          rawMember: r.raw_member,
          season: r.season,
          objektClass: r.objekt_class,
          collectionNo: r.collection_no,
          imageUrl: r.image_url || null,
          supply: supplyByColId.get(r.col_id) ?? null,
        });
      }
    }
    roDb.close();
  }

  const missingIds = allIds.filter((id) => !metaMap.has(id));
  console.log(
    `Metadata cache hits: ${metaMap.size.toLocaleString()}/${allIds.length.toLocaleString()} (${missingIds.length.toLocaleString()} to fetch from COSMO v3)...`,
  );

  // 2. Resolve remaining newer tokens politely from COSMO v3 API
  let idx = 0;
  const conc = 40;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (idx < missingIds.length) {
        const id = missingIds[idx++]!;
        const res = await fetchCosmoTokenMetadataFast(id);
        if (res.kind === "ok") {
          metaMap.set(id, {
            artistId: res.meta.artistId,
            collectionId: res.meta.collectionId,
            rawMember: res.meta.rawMember,
            season: res.meta.season,
            objektClass: res.meta.objektClass,
            collectionNo: res.meta.collectionNo,
            imageUrl: res.meta.imageUrl || null,
            supply: null,
          });
        }
      }
    }),
  );

  // Aggregate by artist ("triples" | "artms")
  const artistStats = new Map<
    string,
    {
      totalPaired: number;
      blank: number;
      fco: number;
      sco: number;
      premier: number;
      other: number;
      spinners: Set<string>;
      startAt: string | null;
      endAt: string | null;
    }
  >();

  const memberStats = new Map<
    string,
    {
      memberId: string;
      artistId: string;
      sent: number;
      pulled: number;
      blankFrom: number;
      rarePulled: number;
    }
  >();

  interface NotableSpinCandidate {
    priority: number;
    spinKey: string;
    artistId: string;
    chain: string;
    spunAt: string;
    walletShort: string;
    inputTokenId: number;
    inputMeta: TokenMetaInfo;
    outcomeKind: "blank" | "fco" | "sco" | "premier" | "other";
    outputTokenId: number | null;
    outputMeta: TokenMetaInfo | null;
    delaySeconds: number | null;
  }

  const notableByArtist = new Map<string, NotableSpinCandidate[]>();

  for (const p of paired) {
    const inMeta = metaMap.get(p.spin.tokenId);
    if (!inMeta || (inMeta.artistId !== "triples" && inMeta.artistId !== "artms")) {
      continue;
    }
    const artistId = inMeta.artistId;
    const outMeta = p.rewardMint ? (metaMap.get(p.rewardMint.tokenId) ?? null) : null;

    // If matched mint belongs to a different artist (user simultaneously spun idntt / bought another artist),
    // treat as unmatched unless same artist
    const validOutMeta =
      outMeta && outMeta.artistId === artistId ? outMeta : null;
    const outcomeKind: "blank" | "fco" | "sco" | "premier" | "other" =
      validOutMeta
        ? classifySpinOutputClass(
            validOutMeta.objektClass,
            validOutMeta.collectionNo,
          )
        : "blank";

    let aAcc = artistStats.get(artistId);
    if (!aAcc) {
      aAcc = {
        totalPaired: 0,
        blank: 0,
        fco: 0,
        sco: 0,
        premier: 0,
        other: 0,
        spinners: new Set(),
        startAt: p.spin.timestampIso,
        endAt: p.spin.timestampIso,
      };
      artistStats.set(artistId, aAcc);
    }
    aAcc.totalPaired++;
    aAcc.spinners.add(p.spin.spinner);
    if (outcomeKind === "blank") aAcc.blank++;
    else if (outcomeKind === "fco") aAcc.fco++;
    else if (outcomeKind === "sco") aAcc.sco++;
    else if (outcomeKind === "premier") aAcc.premier++;
    else aAcc.other++;
    if (!aAcc.startAt || p.spin.timestampIso < aAcc.startAt) {
      aAcc.startAt = p.spin.timestampIso;
    }
    if (!aAcc.endAt || p.spin.timestampIso > aAcc.endAt) {
      aAcc.endAt = p.spin.timestampIso;
    }

    const inMemberId =
      memberLookup.get(
        `${artistId}:${normalizeMemberLookupKey(inMeta.rawMember)}`,
      ) ?? null;
    if (inMemberId) {
      let mAcc = memberStats.get(inMemberId);
      if (!mAcc) {
        mAcc = {
          memberId: inMemberId,
          artistId,
          sent: 0,
          pulled: 0,
          blankFrom: 0,
          rarePulled: 0,
        };
        memberStats.set(inMemberId, mAcc);
      }
      mAcc.sent++;
      if (outcomeKind === "blank") mAcc.blankFrom++;
    }

    if (validOutMeta) {
      const outMemberId =
        memberLookup.get(
          `${artistId}:${normalizeMemberLookupKey(validOutMeta.rawMember)}`,
        ) ?? null;
      if (outMemberId) {
        let mAcc = memberStats.get(outMemberId);
        if (!mAcc) {
          mAcc = {
            memberId: outMemberId,
            artistId,
            sent: 0,
            pulled: 0,
            blankFrom: 0,
            rarePulled: 0,
          };
          memberStats.set(outMemberId, mAcc);
        }
        mAcc.pulled++;
        if (outcomeKind === "premier" || outcomeKind === "sco") {
          mAcc.rarePulled++;
        }
      }
    }

    // Score notability for the live feed: Premier jackpots > SCO pulls > Rare inputs spun to Blank > recent Blanks & DCO inputs
    let priority = 0;
    if (outcomeKind === "premier") priority = 100;
    else if (outcomeKind === "sco") priority = 80;
    else if (
      inMeta.objektClass === "Premier" ||
      inMeta.objektClass === "Motion" ||
      (inMeta.supply !== null && inMeta.supply < 500)
    ) {
      priority = outcomeKind === "blank" ? 95 : 70;
    } else if (outcomeKind === "blank" && inMeta.objektClass === "Double") {
      priority = 50;
    } else if (outcomeKind === "blank") {
      priority = 30;
    } else if (inMeta.objektClass === "Double") {
      priority = 20;
    }

    if (priority > 0) {
      const arr = notableByArtist.get(artistId) ?? [];
      arr.push({
        priority,
        spinKey: `${p.spin.txHash}:${p.spin.logIndex}`,
        artistId,
        chain: p.spin.chain,
        spunAt: p.spin.timestampIso,
        walletShort: shortenAddress(p.spin.spinner),
        inputTokenId: p.spin.tokenId,
        inputMeta: inMeta,
        outcomeKind,
        outputTokenId: validOutMeta && p.rewardMint ? p.rewardMint.tokenId : null,
        outputMeta: validOutMeta,
        delaySeconds: validOutMeta ? p.delaySeconds : null,
      });
      notableByArtist.set(artistId, arr);
    }
  }

  // Emit SQL
  const now = new Date().toISOString();
  const lines: string[] = [
    `-- Verified on-chain COSMO Spin outcome stats (${now})`,
    "DELETE FROM recent_notable_spins;",
    "",
  ];

  for (const [artistId, s] of artistStats.entries()) {
    console.log(
      `=== ${artistId.toUpperCase()} PAIRED SPINS === total=${s.totalPaired.toLocaleString()} blank=${s.blank.toLocaleString()} (${((s.blank / Math.max(1, s.totalPaired)) * 100).toFixed(2)}%) fco=${s.fco.toLocaleString()} (${((s.fco / Math.max(1, s.totalPaired)) * 100).toFixed(2)}%) sco=${s.sco} premier=${s.premier} other=${s.other} spinners=${s.spinners.size.toLocaleString()}`,
    );
    lines.push(
      `INSERT OR REPLACE INTO spin_outcome_stats (artist_id, total_paired_spins, blank_count, fco_count, sco_count, premier_count, other_count, unique_spinners, sample_start_at, sample_end_at, updated_at) VALUES (${sqlStr(artistId)}, ${s.totalPaired}, ${s.blank}, ${s.fco}, ${s.sco}, ${s.premier}, ${s.other}, ${s.spinners.size}, ${sqlStr(s.startAt)}, ${sqlStr(s.endAt)}, ${sqlStr(now)});`,
    );
  }

  lines.push("");
  for (const m of memberStats.values()) {
    lines.push(
      `INSERT OR REPLACE INTO spin_member_outcome_stats (member_id, artist_id, paired_sent_count, paired_pulled_count, paired_blank_from_count, paired_rare_pulled_count, updated_at) VALUES (${sqlStr(m.memberId)}, ${sqlStr(m.artistId)}, ${m.sent}, ${m.pulled}, ${m.blankFrom}, ${m.rarePulled}, ${sqlStr(now)});`,
    );
  }

  lines.push("");
  for (const [, candidates] of notableByArtist.entries()) {
    candidates.sort(
      (a, b) => b.priority - a.priority || b.spunAt.localeCompare(a.spunAt),
    );
    const chosen = candidates.slice(0, 40);
    for (const c of chosen) {
      lines.push(
        `INSERT OR REPLACE INTO recent_notable_spins (spin_key, artist_id, chain, spun_at, wallet_short, input_token_id, input_collection_id, input_member_name, input_class, input_season, input_collection_no, input_image_url, input_supply, outcome_kind, output_token_id, output_collection_id, output_member_name, output_class, output_season, output_collection_no, output_image_url, delay_seconds) VALUES (${sqlStr(c.spinKey)}, ${sqlStr(c.artistId)}, ${sqlStr(c.chain)}, ${sqlStr(c.spunAt)}, ${sqlStr(c.walletShort)}, ${c.inputTokenId}, ${sqlStr(c.inputMeta.collectionId)}, ${sqlStr(c.inputMeta.rawMember)}, ${sqlStr(c.inputMeta.objektClass)}, ${sqlStr(c.inputMeta.season)}, ${sqlStr(c.inputMeta.collectionNo)}, ${sqlStr(c.inputMeta.imageUrl)}, ${sqlNum(c.inputMeta.supply)}, ${sqlStr(c.outcomeKind)}, ${sqlNum(c.outputTokenId)}, ${sqlStr(c.outputMeta?.collectionId ?? null)}, ${sqlStr(c.outputMeta?.rawMember ?? null)}, ${sqlStr(c.outputMeta?.objektClass ?? null)}, ${sqlStr(c.outputMeta?.season ?? null)}, ${sqlStr(c.outputMeta?.collectionNo ?? null)}, ${sqlStr(c.outputMeta?.imageUrl ?? null)}, ${sqlNum(c.delaySeconds)});`,
      );
    }
  }

  mkdirSync(resolve(repoRoot, "packages/db/generated"), { recursive: true });
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`✓ Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
