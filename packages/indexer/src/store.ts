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

export interface BlockRange {
  fromBlock: number;
  toBlock: number;
}

/**
 * Resumable local SQLite checkpoint store powered by Node 24's built-in `node:sqlite`.
 *
 * Normalized for 31M+ full-history COSMO scale:
 * - `collection_catalog` (~15k rows) stores metadata strings ONCE per collection.
 * - `token_collections` (token_id -> col_id) stores only 2 integers per token (~16 bytes/token).
 * - `token_metadata` VIEW provides backwards-compatible SQL access over the normalized tables.
 * - `synced_ranges` tracks exact block intervals per chain so full historical syncs are 100% gap-free.
 */
export class IndexerStore {
  public readonly db: DatabaseSync;
  public readonly dbPath: string;
  private readonly slugToColId = new Map<string, number>();

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
      PRAGMA cache_size = -131072;
      PRAGMA temp_store = MEMORY;
      PRAGMA mmap_size = 536870912;

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

      CREATE TABLE IF NOT EXISTS collection_catalog (
        col_id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
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

      CREATE INDEX IF NOT EXISTS idx_cc_artist_season
        ON collection_catalog (artist_id, season, objekt_class);

      CREATE TABLE IF NOT EXISTS token_collections (
        token_id INTEGER PRIMARY KEY,
        col_id INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tc_col_id
        ON token_collections (col_id);

      CREATE TABLE IF NOT EXISTS missing_metadata (
        token_id INTEGER PRIMARY KEY,
        checked_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cursors (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS synced_ranges (
        chain TEXT NOT NULL,
        kind TEXT NOT NULL,
        from_block INTEGER NOT NULL,
        to_block INTEGER NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (chain, kind, from_block, to_block)
      );
    `);

    // One-time lossless migration from legacy wide `token_metadata` table -> normalized tables + VIEW
    const metaObj = this.db
      .prepare(
        "SELECT type FROM sqlite_master WHERE name = 'token_metadata'",
      )
      .get() as { type: string } | undefined;

    if (metaObj?.type === "table") {
      this.db.exec("BEGIN");
      try {
        this.db.exec(`
          INSERT OR IGNORE INTO collection_catalog (
            slug, collection_id, artist_id, raw_artist, raw_member,
            season, objekt_class, collection_no, on_offline, image_url, background_color, fetched_at
          )
          SELECT
            slug,
            MAX(collection_id),
            MAX(artist_id),
            MAX(raw_artist),
            MAX(raw_member),
            MAX(season),
            MAX(objekt_class),
            MAX(collection_no),
            MAX(on_offline),
            MAX(image_url),
            MAX(background_color),
            MAX(fetched_at)
          FROM token_metadata
          GROUP BY slug;

          INSERT OR REPLACE INTO token_collections (token_id, col_id)
          SELECT tm.token_id, cc.col_id
          FROM token_metadata tm
          JOIN collection_catalog cc ON cc.slug = tm.slug;

          DROP TABLE token_metadata;
        `);
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }

    // Backwards-compatible VIEW over normalized collection_catalog + token_collections
    this.db.exec(`
      CREATE VIEW IF NOT EXISTS token_metadata AS
      SELECT
        tc.token_id,
        cc.slug,
        cc.collection_id,
        cc.artist_id,
        cc.raw_artist,
        cc.raw_member,
        cc.season,
        cc.objekt_class,
        cc.collection_no,
        cc.on_offline,
        cc.image_url,
        cc.background_color,
        cc.fetched_at
      FROM token_collections tc
      JOIN collection_catalog cc ON cc.col_id = tc.col_id;
    `);

    // Hydrate in-memory slug -> col_id lookup cache (~15k rows max)
    const catalogRows = this.db
      .prepare("SELECT col_id, slug FROM collection_catalog")
      .all() as Array<{ col_id: number; slug: string }>;
    for (const r of catalogRows) {
      this.slugToColId.set(r.slug, r.col_id);
    }

    // Seed initial synced_ranges for previously synced contiguous Abstract block span if empty
    const hasAbstractRanges = (
      this.db
        .prepare("SELECT COUNT(*) AS c FROM synced_ranges WHERE chain = 'abstract' AND kind = 'mints'")
        .get() as { c: number }
    ).c;
    if (hasAbstractRanges === 0) {
      const existingAbs = this.db
        .prepare(
          "SELECT MIN(block_number) AS min_b, MAX(block_number) AS max_b, COUNT(*) AS cnt FROM raw_mints WHERE chain = 'abstract'",
        )
        .get() as { min_b: number | null; max_b: number | null; cnt: number };
      if (existingAbs.cnt > 10_000 && existingAbs.min_b && existingAbs.max_b) {
        this.recordSyncedRange("abstract", "mints", existingAbs.min_b, existingAbs.max_b);
      }
    }
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

  recordSyncedRange(
    chain: "polygon" | "abstract",
    kind: "mints" | "transfers",
    fromBlock: number,
    toBlock: number,
  ): void {
    if (toBlock < fromBlock) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO synced_ranges (chain, kind, from_block, to_block, synced_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(chain, kind, fromBlock, toBlock, new Date().toISOString());
  }

  getMergedSyncedRanges(
    chain: "polygon" | "abstract",
    kind: "mints" | "transfers",
  ): BlockRange[] {
    const rows = this.db
      .prepare(
        `SELECT from_block, to_block
         FROM synced_ranges
         WHERE chain = ? AND kind = ?
         ORDER BY from_block ASC, to_block ASC`,
      )
      .all(chain, kind) as Array<{ from_block: number; to_block: number }>;

    const merged: BlockRange[] = [];
    for (const r of rows) {
      const last = merged[merged.length - 1];
      if (!last || r.from_block > last.toBlock + 1) {
        merged.push({ fromBlock: r.from_block, toBlock: r.to_block });
      } else if (r.to_block > last.toBlock) {
        last.toBlock = r.to_block;
      }
    }
    return merged;
  }

  getMissingRanges(
    chain: "polygon" | "abstract",
    kind: "mints" | "transfers",
    targetFrom: number,
    targetTo: number,
  ): BlockRange[] {
    if (targetTo < targetFrom) return [];
    const merged = this.getMergedSyncedRanges(chain, kind);
    const missing: BlockRange[] = [];
    let cursor = targetFrom;

    for (const r of merged) {
      if (r.toBlock < cursor) continue;
      if (r.fromBlock > targetTo) break;
      if (r.fromBlock > cursor) {
        missing.push({
          fromBlock: cursor,
          toBlock: Math.min(r.fromBlock - 1, targetTo),
        });
      }
      cursor = Math.max(cursor, r.toBlock + 1);
      if (cursor > targetTo) break;
    }

    if (cursor <= targetTo) {
      missing.push({ fromBlock: cursor, toBlock: targetTo });
    }
    return missing;
  }

  compactSyncedRanges(
    chain: "polygon" | "abstract",
    kind: "mints" | "transfers",
  ): BlockRange[] {
    const merged = this.getMergedSyncedRanges(chain, kind);
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("DELETE FROM synced_ranges WHERE chain = ? AND kind = ?")
        .run(chain, kind);
      const ins = this.db.prepare(
        "INSERT INTO synced_ranges (chain, kind, from_block, to_block, synced_at) VALUES (?, ?, ?, ?, ?)",
      );
      for (const r of merged) {
        ins.run(chain, kind, r.fromBlock, r.toBlock, now);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return merged;
  }

  /**
   * Inserts primary mint logs (`from = 0x0`).
   * On duplicate `token_id` (e.g. Polygon original mint vs April 18, 2025 Abstract migration re-mint),
   * ALWAYS keeps the earliest `(chain, block_number, minted_at, minter, tx_hash)` so historical
   * Polygon purchase timestamps and original buyer wallets are 100% preserved!
   */
  insertMints(mints: RawMintRow[]): number {
    if (mints.length === 0) return 0;
    const stmt = this.db.prepare(`
      INSERT INTO raw_mints (token_id, chain, block_number, minted_at, minter, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_id) DO UPDATE SET
        chain        = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.chain        ELSE raw_mints.chain END,
        block_number = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.block_number ELSE raw_mints.block_number END,
        minted_at    = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.minted_at    ELSE raw_mints.minted_at END,
        minter       = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.minter       ELSE raw_mints.minter END,
        tx_hash      = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.tx_hash      ELSE raw_mints.tx_hash END
    `);

    this.db.exec("BEGIN");
    try {
      for (const m of mints) {
        stmt.run(
          m.tokenId,
          m.chain,
          m.blockNumber,
          m.mintedAt,
          m.minter.toLowerCase(),
          m.txHash.toLowerCase(),
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return mints.length;
  }

  insertMintsSpinsAndRange(
    chain: "polygon" | "abstract",
    fromBlock: number,
    toBlock: number,
    mints: RawMintRow[],
    spins: RawSpinRow[],
  ): void {
    const mintStmt = this.db.prepare(`
      INSERT INTO raw_mints (token_id, chain, block_number, minted_at, minter, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_id) DO UPDATE SET
        chain        = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.chain        ELSE raw_mints.chain END,
        block_number = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.block_number ELSE raw_mints.block_number END,
        minted_at    = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.minted_at    ELSE raw_mints.minted_at END,
        minter       = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.minter       ELSE raw_mints.minter END,
        tx_hash      = CASE WHEN excluded.minted_at < raw_mints.minted_at THEN excluded.tx_hash      ELSE raw_mints.tx_hash END
    `);
    const spinStmt = this.db.prepare(`
      INSERT OR IGNORE INTO raw_spins (tx_hash, log_index, token_id, chain, block_number, spun_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const rangeStmt = this.db.prepare(`
      INSERT OR REPLACE INTO synced_ranges (chain, kind, from_block, to_block, synced_at)
      VALUES (?, 'mints', ?, ?, ?)
    `);
    const now = new Date().toISOString();

    this.db.exec("BEGIN");
    try {
      for (const m of mints) {
        mintStmt.run(
          m.tokenId,
          m.chain,
          m.blockNumber,
          m.mintedAt,
          m.minter.toLowerCase(),
          m.txHash.toLowerCase(),
        );
      }
      for (const s of spins) {
        spinStmt.run(s.txHash, s.logIndex, s.tokenId, s.chain, s.blockNumber, s.spunAt);
      }
      rangeStmt.run(chain, fromBlock, toBlock, now);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
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

  getUnresolvedTokenIdsFromList(tokenIds: number[], limit = 50_000): number[] {
    if (tokenIds.length === 0) return [];
    const unique = Array.from(new Set(tokenIds));
    const resolvedSet = new Set<number>();

    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const slice = unique.slice(i, i + chunkSize);
      const placeholders = slice.map(() => "?").join(",");
      const metaRows = this.db
        .prepare(`SELECT token_id FROM token_collections WHERE token_id IN (${placeholders})`)
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
         LEFT JOIN token_collections tc ON tc.token_id = rt.token_id
         LEFT JOIN missing_metadata mm ON mm.token_id = rt.token_id
         WHERE tc.token_id IS NULL AND mm.token_id IS NULL
         ORDER BY rt.transferred_at ${dir}, rt.token_id ${dir}
         LIMIT ?`,
      )
      .all(limit) as Array<{ token_id: number }>;
    return rows.map((r) => r.token_id);
  }

  upsertMetadataBatch(items: NormalizedTokenMetadata[]): void {
    if (items.length === 0) return;
    const now = new Date().toISOString();

    const insertCatalogStmt = this.db.prepare(`
      INSERT INTO collection_catalog (
        slug, collection_id, artist_id, raw_artist, raw_member,
        season, objekt_class, collection_no, on_offline, image_url, background_color, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        image_url = CASE WHEN excluded.image_url != '' THEN excluded.image_url ELSE collection_catalog.image_url END,
        background_color = CASE WHEN excluded.background_color != '' THEN excluded.background_color ELSE collection_catalog.background_color END,
        fetched_at = excluded.fetched_at
    `);
    const selectColIdStmt = this.db.prepare(
      "SELECT col_id FROM collection_catalog WHERE slug = ?",
    );
    const upsertTokenStmt = this.db.prepare(
      "INSERT OR REPLACE INTO token_collections (token_id, col_id) VALUES (?, ?)",
    );

    this.db.exec("BEGIN");
    try {
      for (const item of items) {
        let colId = this.slugToColId.get(item.slug);
        if (colId === undefined) {
          insertCatalogStmt.run(
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
          const row = selectColIdStmt.get(item.slug) as { col_id: number };
          colId = row.col_id;
          this.slugToColId.set(item.slug, colId);
        }
        upsertTokenStmt.run(item.tokenId, colId);
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

  getUnresolvedTokenIds(
    limit: number,
    order: "newest" | "oldest" = "newest",
    chainFilter?: "polygon" | "abstract",
    cursorTokenId?: number,
  ): number[] {
    const dir = order === "newest" ? "DESC" : "ASC";
    const conditions: string[] = [
      "tc.token_id IS NULL",
      "mm.token_id IS NULL",
    ];
    const params: Array<string | number> = [];
    if (chainFilter) {
      conditions.push("rm.chain = ?");
      params.push(chainFilter);
    }
    if (cursorTokenId !== undefined) {
      conditions.push(order === "newest" ? "rm.token_id < ?" : "rm.token_id > ?");
      params.push(cursorTokenId);
    }
    params.push(limit);
    const sql = `
      SELECT rm.token_id
      FROM raw_mints rm
      LEFT JOIN token_collections tc ON tc.token_id = rm.token_id
      LEFT JOIN missing_metadata mm ON mm.token_id = rm.token_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY rm.token_id ${dir}
      LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params) as Array<{
      token_id: number;
    }>;
    return rows.map((r) => r.token_id);
  }

  countUnresolvedMints(chainFilter?: "polygon" | "abstract"): number {
    const chainClause = chainFilter ? "AND rm.chain = ?" : "";
    const sql = `
      SELECT COUNT(*) AS c
      FROM raw_mints rm
      LEFT JOIN token_collections tc ON tc.token_id = rm.token_id
      LEFT JOIN missing_metadata mm ON mm.token_id = rm.token_id
      WHERE tc.token_id IS NULL AND mm.token_id IS NULL ${chainClause}`;
    const row = (
      chainFilter ? this.db.prepare(sql).get(chainFilter) : this.db.prepare(sql).get()
    ) as { c: number };
    return row.c;
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
      this.db.prepare("SELECT COUNT(*) as c FROM token_collections").get() as { c: number }
    ).c;
    const catalogCollections = (
      this.db.prepare("SELECT COUNT(*) as c FROM collection_catalog").get() as { c: number }
    ).c;
    const missing = (
      this.db.prepare("SELECT COUNT(*) as c FROM missing_metadata").get() as { c: number }
    ).c;
    return { mints, spins, transfers, resolved, catalogCollections, missing };
  }

  close(): void {
    this.db.close();
  }
}
