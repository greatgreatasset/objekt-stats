import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NormalizedTokenMetadata } from "./cosmo-metadata.js";

export interface RawMintRow {
  tokenId: number;
  chain: "polygon" | "abstract";
  blockNumber: number;
  mintedAt: string; // ISO UTC
  minter: string;
  txHash: string;
}

export interface RawSpinRow {
  txHash: string;
  logIndex: number;
  tokenId: number;
  chain: "polygon" | "abstract";
  blockNumber: number;
  spunAt: string;
}

export interface RawTransferRow {
  txHash: string;
  logIndex: number;
  tokenId: number;
  chain: "polygon" | "abstract";
  blockNumber: number;
  transferredAt: string; // ISO UTC
  fromAddr: string;
  toAddr: string;
}

/**
 * Resumable local SQLite checkpoint store powered by Node 24's built-in `node:sqlite`.
 * Keeps raw per-token chain logs & immutable metadata locally so Cloudflare D1 only
 * ever receives compact, pre-aggregated analytics tables.
 */
export class IndexerStore {
  public readonly db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dbPath = resolve(process.cwd(), "data/raw/indexer.sqlite")) {
    this.dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS raw_mints (
        token_id INTEGER PRIMARY KEY,
        chain TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        minted_at TEXT NOT NULL,
        minter TEXT NOT NULL,
        tx_hash TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_raw_mints_chain_block
        ON raw_mints (chain, block_number);
      CREATE INDEX IF NOT EXISTS idx_raw_mints_time
        ON raw_mints (minted_at);

      CREATE TABLE IF NOT EXISTS raw_spins (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        chain TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        spun_at TEXT NOT NULL,
        PRIMARY KEY (tx_hash, log_index)
      );

      CREATE INDEX IF NOT EXISTS idx_raw_spins_token
        ON raw_spins (token_id);

      CREATE TABLE IF NOT EXISTS raw_transfers (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        chain TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        transferred_at TEXT NOT NULL,
        from_addr TEXT NOT NULL,
        to_addr TEXT NOT NULL,
        PRIMARY KEY (tx_hash, log_index)
      );

      CREATE INDEX IF NOT EXISTS idx_raw_transfers_chain_block
        ON raw_transfers (chain, block_number);
      CREATE INDEX IF NOT EXISTS idx_raw_transfers_token
        ON raw_transfers (token_id);
      CREATE INDEX IF NOT EXISTS idx_raw_transfers_time
        ON raw_transfers (transferred_at);

      CREATE TABLE IF NOT EXISTS token_metadata (
        token_id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        artist_id TEXT NOT NULL,
        raw_artist TEXT NOT NULL,
        raw_member TEXT NOT NULL,
        season TEXT NOT NULL,
        objekt_class TEXT NOT NULL,
        collection_no TEXT NOT NULL,
        on_offline TEXT NOT NULL,
        image_url TEXT NOT NULL,
        background_color TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_token_metadata_slug
        ON token_metadata (slug);
      CREATE INDEX IF NOT EXISTS idx_token_metadata_artist
        ON token_metadata (artist_id, season, objekt_class);

      CREATE TABLE IF NOT EXISTS missing_metadata (
        token_id INTEGER PRIMARY KEY,
        checked_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cursors (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getCursor(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM cursors WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setCursor(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO cursors (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }

  insertMints(mints: RawMintRow[]): number {
    if (mints.length === 0) return 0;
    const stmt = this.db.prepare(`
      INSERT INTO raw_mints (token_id, chain, block_number, minted_at, minter, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_id) DO UPDATE SET
        chain = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.chain ELSE raw_mints.chain END,
        block_number = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.block_number ELSE raw_mints.block_number END,
        minted_at = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.minted_at ELSE raw_mints.minted_at END
    `);

    this.db.exec("BEGIN");
    try {
      for (const m of mints) {
        stmt.run(m.tokenId, m.chain, m.blockNumber, m.mintedAt, m.minter, m.txHash);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return mints.length;
  }

  insertSpins(spins: RawSpinRow[]): number {
    if (spins.length === 0) return 0;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO raw_spins (tx_hash, log_index, token_id, chain, block_number, spun_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");
    try {
      for (const s of spins) {
        stmt.run(s.txHash, s.logIndex, s.tokenId, s.chain, s.blockNumber, s.spunAt);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return spins.length;
  }

  insertTransfers(transfers: RawTransferRow[]): number {
    if (transfers.length === 0) return 0;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO raw_transfers
        (tx_hash, log_index, token_id, chain, block_number, transferred_at, from_addr, to_addr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");
    try {
      for (const t of transfers) {
        stmt.run(
          t.txHash,
          t.logIndex,
          t.tokenId,
          t.chain,
          t.blockNumber,
          t.transferredAt,
          t.fromAddr.toLowerCase(),
          t.toAddr.toLowerCase(),
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return transfers.length;
  }

  getAllTransfers(): RawTransferRow[] {
    const rows = this.db
      .prepare(
        `SELECT tx_hash, log_index, token_id, chain, block_number, transferred_at, from_addr, to_addr
         FROM raw_transfers
         ORDER BY transferred_at ASC, block_number ASC, log_index ASC`,
      )
      .all() as Array<{
      tx_hash: string;
      log_index: number;
      token_id: number;
      chain: "polygon" | "abstract";
      block_number: number;
      transferred_at: string;
      from_addr: string;
      to_addr: string;
    }>;

    return rows.map((r) => ({
      txHash: r.tx_hash,
      logIndex: r.log_index,
      tokenId: r.token_id,
      chain: r.chain,
      blockNumber: r.block_number,
      transferredAt: r.transferred_at,
      fromAddr: r.from_addr,
      toAddr: r.to_addr,
    }));
  }

  /**
   * Filters a candidate list of tokenIds down to those not yet in `token_metadata`
   * or `missing_metadata`, preserving input priority order.
   */
  getUnresolvedTokenIdsFromList(tokenIds: number[], limit = 50_000): number[] {
    if (tokenIds.length === 0) return [];
    const unique = Array.from(new Set(tokenIds));
    const resolvedSet = new Set<number>();

    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const slice = unique.slice(i, i + chunkSize);
      const placeholders = slice.map(() => "?").join(",");
      const metaRows = this.db
        .prepare(`SELECT token_id FROM token_metadata WHERE token_id IN (${placeholders})`)
        .all(...slice) as Array<{ token_id: number }>;
      for (const r of metaRows) resolvedSet.add(r.token_id);

      const missRows = this.db
        .prepare(`SELECT token_id FROM missing_metadata WHERE token_id IN (${placeholders})`)
        .all(...slice) as Array<{ token_id: number }>;
      for (const r of missRows) resolvedSet.add(r.token_id);
    }

    const out: number[] = [];
    for (const id of unique) {
      if (!resolvedSet.has(id)) {
        out.push(id);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  getUnresolvedTransferTokenIds(
    limit: number,
    order: "newest" | "oldest" = "newest",
  ): number[] {
    const dir = order === "newest" ? "DESC" : "ASC";
    const rows = this.db
      .prepare(
        `SELECT DISTINCT rt.token_id
         FROM raw_transfers rt
         LEFT JOIN token_metadata tm ON tm.token_id = rt.token_id
         LEFT JOIN missing_metadata mm ON mm.token_id = rt.token_id
         WHERE tm.token_id IS NULL AND mm.token_id IS NULL
         ORDER BY rt.transferred_at ${dir}, rt.token_id ${dir}
         LIMIT ?`,
      )
      .all(limit) as Array<{ token_id: number }>;
    return rows.map((r) => r.token_id);
  }

  upsertMetadataBatch(items: NormalizedTokenMetadata[]): void {
    if (items.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO token_metadata (
        token_id, slug, collection_id, artist_id, raw_artist, raw_member,
        season, objekt_class, collection_no, on_offline, image_url, background_color, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");
    try {
      for (const item of items) {
        stmt.run(
          item.tokenId,
          item.slug,
          item.collectionId,
          item.artistId,
          item.rawArtist,
          item.rawMember,
          item.season,
          item.objektClass,
          item.collectionNo,
          item.onOffline,
          item.imageUrl,
          item.backgroundColor,
          now,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  markMissingMetadata(tokenIds: number[]): void {
    if (tokenIds.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO missing_metadata (token_id, checked_at) VALUES (?, ?)",
    );
    this.db.exec("BEGIN");
    try {
      for (const id of tokenIds) stmt.run(id, now);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getUnresolvedTokenIds(limit: number, order: "newest" | "oldest" = "newest"): number[] {
    const dir = order === "newest" ? "DESC" : "ASC";
    const rows = this.db
      .prepare(
        `SELECT rm.token_id
         FROM raw_mints rm
         LEFT JOIN token_metadata tm ON tm.token_id = rm.token_id
         LEFT JOIN missing_metadata mm ON mm.token_id = rm.token_id
         WHERE tm.token_id IS NULL AND mm.token_id IS NULL
         ORDER BY rm.minted_at ${dir}, rm.token_id ${dir}
         LIMIT ?`,
      )
      .all(limit) as Array<{ token_id: number }>;
    return rows.map((r) => r.token_id);
  }

  getSummaryCounts() {
    const mints = (
      this.db.prepare("SELECT COUNT(*) as c FROM raw_mints").get() as { c: number }
    ).c;
    const spins = (
      this.db.prepare("SELECT COUNT(*) as c FROM raw_spins").get() as { c: number }
    ).c;
    const transfers = (
      this.db.prepare("SELECT COUNT(*) as c FROM raw_transfers").get() as { c: number }
    ).c;
    const resolved = (
      this.db.prepare("SELECT COUNT(*) as c FROM token_metadata").get() as { c: number }
    ).c;
    const missing = (
      this.db.prepare("SELECT COUNT(*) as c FROM missing_metadata").get() as { c: number }
    ).c;
    return { mints, spins, transfers, resolved, missing };
  }

  close(): void {
    this.db.close();
  }
}
