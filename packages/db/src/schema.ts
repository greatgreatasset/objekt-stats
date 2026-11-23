import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const artists = sqliteTable("artists", {
  id: text("id").primaryKey(), // "triples" | "artms"
  name: text("name").notNull(),
  cosmoArtistName: text("cosmo_artist_name").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  accentColor: text("accent_color").notNull(),
  debutDate: text("debut_date").notNull(),
});

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(), // e.g. "triples-yooyeon"
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // "S1".."S24", "A1".."A5"
    memberOrder: integer("member_order").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    cosmoName: text("cosmo_name").notNull(),
    hexColor: text("hex_color").notNull(),
    revealDate: text("reveal_date").notNull(),
  },
  (t) => [
    index("idx_members_artist_order").on(t.artistId, t.memberOrder),
  ],
);

export const collections = sqliteTable(
  "collections",
  {
    slug: text("slug").primaryKey(), // e.g. "ever01-yooyeon-301z"
    collectionId: text("collection_id").notNull(), // raw COSMO collectionId
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    rawMemberName: text("raw_member_name").notNull(),
    season: text("season").notNull(), // e.g. "Atom01", "Ever01"
    objektClass: text("objekt_class").notNull(), // "First" | "Double" | "Special" | "Premier" | "Motion" | "Welcome" | "Zero"
    collectionNo: text("collection_no").notNull(), // e.g. "101Z", "301Z", "401A"
    onOffline: text("on_offline").notNull(), // "online" | "offline"
    comoAmount: integer("como_amount").notNull().default(1),
    totalMints: integer("total_mints").notNull().default(0),
    maxSerial: integer("max_serial").notNull().default(0),
    spunCount: integer("spun_count").notNull().default(0),
    uniqueMinters: integer("unique_minters").notNull().default(0),
    firstMintAt: text("first_mint_at"),
    lastMintAt: text("last_mint_at"),
    frontImageUrl: text("front_image_url"),
    thumbnailImageUrl: text("thumbnail_image_url"),
    accentColor: text("accent_color"),
    backgroundColor: text("background_color"),
    textColor: text("text_color"),
    isUnobtainable: integer("is_unobtainable", { mode: "boolean" })
      .notNull()
      .default(false),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_collections_artist_season").on(t.artistId, t.season, t.objektClass),
    index("idx_collections_member").on(t.memberId),
    index("idx_collections_first_mint").on(t.artistId, t.firstMintAt),
  ],
);

export const collectionDailyMints = sqliteTable(
  "collection_daily_mints",
  {
    collectionSlug: text("collection_slug")
      .notNull()
      .references(() => collections.slug, { onDelete: "cascade" }),
    mintDate: text("mint_date").notNull(), // YYYY-MM-DD (UTC)
    mintCount: integer("mint_count").notNull().default(0),
    uniqueMinters: integer("unique_minters").notNull().default(0),
    spinCount: integer("spin_count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.collectionSlug, t.mintDate] }),
    index("idx_daily_mints_date").on(t.mintDate),
  ],
);

export const roundDailyMints = sqliteTable(
  "round_daily_mints",
  {
    roundSlug: text("round_slug")
      .notNull()
      .references(() => saleRounds.slug, { onDelete: "cascade" }),
    mintDate: text("mint_date").notNull(), // YYYY-MM-DD (UTC)
    mintCount: integer("mint_count").notNull().default(0),
    uniqueBuyers: integer("unique_buyers").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.roundSlug, t.mintDate] }),
    index("idx_round_daily_date").on(t.mintDate),
  ],
);

export const saleRounds = sqliteTable(
  "sale_rounds",
  {
    slug: text("slug").primaryKey(), // e.g. "triples-divine01-dco-301z"
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    season: text("season").notNull(),
    objektClass: text("objekt_class").notNull(), // "First" | "Double" | "Premier" | "Motion" | "Mixed"
    onOffline: text("on_offline").notNull().default("online"),
    saleMechanic: text("sale_mechanic").notNull(), // "member_select" | "random_pack" | "unit_select" | "unit_random" | "physical_scan" | "reward"
    startAt: text("start_at").notNull(),
    endAt: text("end_at"),
    unitPriceUsd: real("unit_price_usd"),
    totalMints: integer("total_mints").notNull().default(0),
    uniqueBuyers: integer("unique_buyers").notNull().default(0),
    participatingMembers: integer("participating_members").notNull().default(0),
    includeInPopularity: integer("include_in_popularity", { mode: "boolean" })
      .notNull()
      .default(true),
    isAutoDetected: integer("is_auto_detected", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
  },
  (t) => [
    index("idx_sale_rounds_artist_start").on(t.artistId, t.startAt),
    index("idx_sale_rounds_popularity").on(t.artistId, t.includeInPopularity, t.startAt),
  ],
);

export const saleRoundCollections = sqliteTable(
  "sale_round_collections",
  {
    roundSlug: text("round_slug")
      .notNull()
      .references(() => saleRounds.slug, { onDelete: "cascade" }),
    collectionSlug: text("collection_slug")
      .notNull()
      .references(() => collections.slug, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.roundSlug, t.collectionSlug] }),
    index("idx_src_collection").on(t.collectionSlug),
  ],
);

export const saleRoundMemberStats = sqliteTable(
  "sale_round_member_stats",
  {
    roundSlug: text("round_slug")
      .notNull()
      .references(() => saleRounds.slug, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    mintCount: integer("mint_count").notNull().default(0),
    uniqueBuyers: integer("unique_buyers").notNull().default(0),
    mintsPerBuyer: real("mints_per_buyer").notNull().default(1),
    topBuyerSharePct: real("top_buyer_share_pct"),
    rank: integer("rank").notNull(),
    uniqueBuyersRank: integer("unique_buyers_rank").notNull().default(1),
    sharePct: real("share_pct").notNull(), // 0..100
    uniqueBuyersSharePct: real("unique_buyers_share_pct").notNull().default(0),
    relativeIndex: real("relative_index").notNull(), // 1.0 = exact round mean
    uniqueBuyersRelativeIndex: real("unique_buyers_relative_index")
      .notNull()
      .default(1),
    zScore: real("z_score").notNull(),
    rankDeltaPrev: integer("rank_delta_prev"), // positive = improved (e.g. #4 -> #2 = +2)
    rolling5Rank: real("rolling5_rank"),
    rolling10Rank: real("rolling10_rank"),
    rolling5RelativeIndex: real("rolling5_relative_index"),
    rolling10RelativeIndex: real("rolling10_relative_index"),
    isAnomaly: integer("is_anomaly", { mode: "boolean" }).notNull().default(false),
    anomalyDirection: text("anomaly_direction"), // "surge" | "drop" | null
    anomalyReason: text("anomaly_reason"),
  },
  (t) => [
    primaryKey({ columns: [t.roundSlug, t.memberId] }),
    index("idx_srms_member").on(t.memberId),
    index("idx_srms_round_rank").on(t.roundSlug, t.rank),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    eventDate: text("event_date").notNull(), // YYYY-MM-DD
    endDate: text("end_date"),
    category: text("category").notNull(), // "comeback" | "gravity" | "subunit" | "variety" | "viral" | "tour" | "hiatus" | "controversy" | "reveal"
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    sourceUrl: text("source_url"),
  },
  (t) => [
    index("idx_events_artist_date").on(t.artistId, t.eventDate),
  ],
);

export const eventMembers = sqliteTable(
  "event_members",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.memberId] }),
    index("idx_event_members_member").on(t.memberId),
  ],
);

export const syncState = sqliteTable("sync_state", {
  chain: text("chain").primaryKey(), // "polygon" | "abstract"
  lastIndexedBlock: integer("last_indexed_block").notNull().default(0),
  lastIndexedTimestamp: text("last_indexed_timestamp"),
  totalTokensIndexed: integer("total_tokens_indexed").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const processedLiveMints = sqliteTable(
  "processed_live_mints",
  {
    tokenId: integer("token_id").primaryKey(),
    syncedAt: text("synced_at").notNull(),
  },
  (t) => [index("idx_processed_live_mints_synced").on(t.syncedAt)],
);

/**
 * Secondary user-to-user trade analytics tables.
 * Strictly isolated from primary newly-minted sales (`collections`, `sale_rounds`).
 */
export const collectionTradeStats = sqliteTable(
  "collection_trade_stats",
  {
    collectionSlug: text("collection_slug").primaryKey(),
    collectionId: text("collection_id").notNull(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    rawMemberName: text("raw_member_name").notNull(),
    season: text("season").notNull(),
    objektClass: text("objekt_class").notNull(),
    collectionNo: text("collection_no").notNull(),
    onOffline: text("on_offline").notNull(),
    frontImageUrl: text("front_image_url"),
    backgroundColor: text("background_color"),
    tradedCount: integer("traded_count").notNull().default(0),
    tradeSessions: integer("trade_sessions").notNull().default(0),
    directTransferCount: integer("direct_transfer_count").notNull().default(0),
    uniqueTraders: integer("unique_traders").notNull().default(0),
    premiumCount: integer("premium_count").notNull().default(0),
    bulkCount: integer("bulk_count").notNull().default(0),
    premium2xCount: integer("premium_2x_count").notNull().default(0),
    premium3xCount: integer("premium_3x_count").notNull().default(0),
    avgExchangeRate: real("avg_exchange_rate").notNull().default(1),
    maxExchangeRate: real("max_exchange_rate").notNull().default(1),
    sameClassLegs: integer("same_class_legs").notNull().default(0),
    sameClassPremiumCount: integer("same_class_premium_count").notNull().default(0),
    sameClassBulkCount: integer("same_class_bulk_count").notNull().default(0),
    sameClass2xCount: integer("same_class_2x_count").notNull().default(0),
    sameClass3xCount: integer("same_class_3x_count").notNull().default(0),
    sameClassAvgRate: real("same_class_avg_rate").notNull().default(1),
    cleanSolo2xCount: integer("clean_solo_2x_count").notNull().default(0),
    cleanSolo3xCount: integer("clean_solo_3x_count").notNull().default(0),
    uniqueOverpayers: integer("unique_overpayers").notNull().default(0),
    sameEdition2xCount: integer("same_edition_2x_count").notNull().default(0),
    sameEdition3xCount: integer("same_edition_3x_count").notNull().default(0),
    sameEditionOverpayers: integer("same_edition_overpayers").notNull().default(0),
    firstTradeAt: text("first_trade_at"),
    lastTradeAt: text("last_trade_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_cts_artist_traded").on(t.artistId, t.tradedCount),
    index("idx_cts_member").on(t.memberId),
    index("idx_cts_artist_season").on(t.artistId, t.season, t.objektClass),
  ],
);

export const memberTradeStats = sqliteTable(
  "member_trade_stats",
  {
    memberId: text("member_id")
      .primaryKey()
      .references(() => members.id, { onDelete: "cascade" }),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    tradedCount: integer("traded_count").notNull().default(0),
    tradeSessions: integer("trade_sessions").notNull().default(0),
    directTransferCount: integer("direct_transfer_count").notNull().default(0),
    uniqueTraders: integer("unique_traders").notNull().default(0),
    collectionsTraded: integer("collections_traded").notNull().default(0),
    tradeRank: integer("trade_rank").notNull(),
    tradeSharePct: real("trade_share_pct").notNull(),
    tradeRelativeIndex: real("trade_relative_index").notNull(),
    premiumCount: integer("premium_count").notNull().default(0),
    bulkCount: integer("bulk_count").notNull().default(0),
    premium2xCount: integer("premium_2x_count").notNull().default(0),
    premium3xCount: integer("premium_3x_count").notNull().default(0),
    avgExchangeRate: real("avg_exchange_rate").notNull().default(1),
    maxExchangeRate: real("max_exchange_rate").notNull().default(1),
    sameClassLegs: integer("same_class_legs").notNull().default(0),
    sameClassPremiumCount: integer("same_class_premium_count").notNull().default(0),
    sameClassBulkCount: integer("same_class_bulk_count").notNull().default(0),
    sameClass2xCount: integer("same_class_2x_count").notNull().default(0),
    sameClass3xCount: integer("same_class_3x_count").notNull().default(0),
    sameClassAvgRate: real("same_class_avg_rate").notNull().default(1),
    cleanSolo2xCount: integer("clean_solo_2x_count").notNull().default(0),
    cleanSolo3xCount: integer("clean_solo_3x_count").notNull().default(0),
    cleanSoloBulkCount: integer("clean_solo_bulk_count").notNull().default(0),
    uniqueOverpayers: integer("unique_overpayers").notNull().default(0),
    topOverpayerSharePct: real("top_overpayer_share_pct"),
    sameEdition2xCount: integer("same_edition_2x_count").notNull().default(0),
    sameEdition3xCount: integer("same_edition_3x_count").notNull().default(0),
    sameEditionBulkCount: integer("same_edition_bulk_count").notNull().default(0),
    sameEditionOverpayers: integer("same_edition_overpayers").notNull().default(0),
    sameEditionTopSharePct: real("same_edition_top_share_pct"),
    lastTradeAt: text("last_trade_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_mts_artist_rank").on(t.artistId, t.tradeRank)],
);

export const dailyTradeStats = sqliteTable(
  "daily_trade_stats",
  {
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    tradeDate: text("trade_date").notNull(), // YYYY-MM-DD (UTC)
    tradeSessions: integer("trade_sessions").notNull().default(0),
    asymmetricSessions: integer("asymmetric_sessions").notNull().default(0),
    ratio2xSessions: integer("ratio_2x_sessions").notNull().default(0),
    ratio3xSessions: integer("ratio_3x_sessions").notNull().default(0),
    sameClassAsymmetricSessions: integer("same_class_asymmetric_sessions")
      .notNull()
      .default(0),
    tradedObjekts: integer("traded_objekts").notNull().default(0),
    directTransfers: integer("direct_transfers").notNull().default(0),
    uniqueTraders: integer("unique_traders").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.artistId, t.tradeDate] }),
    index("idx_dts_date").on(t.tradeDate),
  ],
);

export const recentTrades = sqliteTable(
  "recent_trades",
  {
    tradeId: text("trade_id").notNull(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(), // "abstract" | "polygon"
    tradedAt: text("traded_at").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    sideACount: integer("side_a_count").notNull(),
    sideBCount: integer("side_b_count").notNull(),
    isAsymmetric: integer("is_asymmetric", { mode: "boolean" })
      .notNull()
      .default(false),
    isSameClass: integer("is_same_class", { mode: "boolean" })
      .notNull()
      .default(false),
    isCleanSolo: integer("is_clean_solo", { mode: "boolean" })
      .notNull()
      .default(false),
    isSameEdition: integer("is_same_edition", { mode: "boolean" })
      .notNull()
      .default(false),
    ratioMultiple: real("ratio_multiple").notNull().default(1),
    walletAShort: text("wallet_a_short").notNull(),
    walletBShort: text("wallet_b_short").notNull(),
    sideASummary: text("side_a_summary").notNull(), // JSON array of traded legs
    sideBSummary: text("side_b_summary").notNull(), // JSON array of traded legs
  },
  (t) => [
    primaryKey({ columns: [t.tradeId, t.artistId] }),
    index("idx_recent_trades_artist_time").on(t.artistId, t.tradedAt),
  ],
);

export const pendingP2pTransfers = sqliteTable(
  "pending_p2p_transfers",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    chain: text("chain").notNull(),
    blockNumber: integer("block_number").notNull(),
    transferredAt: text("transferred_at").notNull(),
    fromAddr: text("from_addr").notNull(),
    toAddr: text("to_addr").notNull(),
    pairKey: text("pair_key").notNull(),
    tokenId: integer("token_id").notNull(),
    status: text("status").notNull().default("open"), // "open" | "traded" | "expired"
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.logIndex] }),
    index("idx_ppt_status_pair").on(t.status, t.pairKey),
    index("idx_ppt_time").on(t.transferredAt),
  ],
);

/**
 * Immutable per-token COSMO v3 metadata cache & frozen pre-migration Polygon wallet
 * history cache used by the User Cost Estimator (`/wallet`).
 * Strictly read/write cache tables — never alters primary sales or round rankings.
 */
export const tokenMetadataCache = sqliteTable(
  "token_metadata_cache",
  {
    tokenId: integer("token_id").primaryKey(),
    slug: text("slug").notNull(),
    collectionId: text("collection_id").notNull(),
    artistId: text("artist_id").notNull(),
    rawArtist: text("raw_artist").notNull(),
    memberName: text("member_name").notNull(),
    season: text("season").notNull(),
    objektClass: text("objekt_class").notNull(),
    collectionNo: text("collection_no").notNull(),
    onOffline: text("on_offline").notNull(),
    imageUrl: text("image_url"),
    backgroundColor: text("background_color"),
    isMissing: integer("is_missing", { mode: "boolean" }).notNull().default(false),
    cachedAt: text("cached_at").notNull(),
  },
  (t) => [index("idx_tmc_slug").on(t.slug)],
);

export const walletPolygonCache = sqliteTable("wallet_polygon_cache", {
  polygonAddress: text("polygon_address").primaryKey(),
  logsJson: text("logs_json").notNull(),
  txCount: integer("tx_count").notNull().default(0),
  cachedAt: text("cached_at").notNull(),
});

export type ArtistRow = typeof artists.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type CollectionRow = typeof collections.$inferSelect;
export type SaleRoundRow = typeof saleRounds.$inferSelect;
export type SaleRoundMemberStatRow = typeof saleRoundMemberStats.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type CollectionTradeStatRow = typeof collectionTradeStats.$inferSelect;
export type MemberTradeStatRow = typeof memberTradeStats.$inferSelect;
export type DailyTradeStatRow = typeof dailyTradeStats.$inferSelect;
export type RecentTradeRow = typeof recentTrades.$inferSelect;
export type TokenMetadataCacheRow = typeof tokenMetadataCache.$inferSelect;
export type WalletPolygonCacheRow = typeof walletPolygonCache.$inferSelect;
