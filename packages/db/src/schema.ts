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
    rank: integer("rank").notNull(),
    sharePct: real("share_pct").notNull(), // 0..100
    relativeIndex: real("relative_index").notNull(), // 1.0 = exact round mean
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

export type ArtistRow = typeof artists.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type CollectionRow = typeof collections.$inferSelect;
export type SaleRoundRow = typeof saleRounds.$inferSelect;
export type SaleRoundMemberStatRow = typeof saleRoundMemberStats.$inferSelect;
export type EventRow = typeof events.$inferSelect;
