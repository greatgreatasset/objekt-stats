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
    const resolved = (
      this.db.prepare("SELECT COUNT(*) as c FROM token_metadata").get() as { c: number }
    ).c;
    const missing = (
      this.db.prepare("SELECT COUNT(*) as c FROM missing_metadata").get() as { c: number }
    ).c;
    return { mints, spins, resolved, missing };
  }

  close(): void {
    this.db.close();
  }
}
