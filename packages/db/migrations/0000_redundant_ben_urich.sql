CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cosmo_artist_name` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`accent_color` text NOT NULL,
	`debut_date` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_daily_mints` (
	`collection_slug` text NOT NULL,
	`mint_date` text NOT NULL,
	`mint_count` integer DEFAULT 0 NOT NULL,
	`unique_minters` integer DEFAULT 0 NOT NULL,
	`spin_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`collection_slug`, `mint_date`),
	FOREIGN KEY (`collection_slug`) REFERENCES `collections`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_daily_mints_date` ON `collection_daily_mints` (`mint_date`);--> statement-breakpoint
CREATE TABLE `collections` (
	`slug` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`member_id` text,
	`raw_member_name` text NOT NULL,
	`season` text NOT NULL,
	`objekt_class` text NOT NULL,
	`collection_no` text NOT NULL,
	`on_offline` text NOT NULL,
	`como_amount` integer DEFAULT 1 NOT NULL,
	`total_mints` integer DEFAULT 0 NOT NULL,
	`max_serial` integer DEFAULT 0 NOT NULL,
	`spun_count` integer DEFAULT 0 NOT NULL,
	`unique_minters` integer DEFAULT 0 NOT NULL,
	`first_mint_at` text,
	`last_mint_at` text,
	`front_image_url` text,
	`thumbnail_image_url` text,
	`accent_color` text,
	`background_color` text,
	`text_color` text,
	`is_unobtainable` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_collections_artist_season` ON `collections` (`artist_id`,`season`,`objekt_class`);--> statement-breakpoint
CREATE INDEX `idx_collections_member` ON `collections` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_collections_first_mint` ON `collections` (`artist_id`,`first_mint_at`);--> statement-breakpoint
CREATE TABLE `event_members` (
	`event_id` text NOT NULL,
	`member_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `member_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_members_member` ON `event_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`event_date` text NOT NULL,
	`end_date` text,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`source_url` text,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_events_artist_date` ON `events` (`artist_id`,`event_date`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`code` text NOT NULL,
	`member_order` integer NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`cosmo_name` text NOT NULL,
	`hex_color` text NOT NULL,
	`reveal_date` text NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_members_artist_order` ON `members` (`artist_id`,`member_order`);--> statement-breakpoint
CREATE TABLE `sale_round_collections` (
	`round_slug` text NOT NULL,
	`collection_slug` text NOT NULL,
	PRIMARY KEY(`round_slug`, `collection_slug`),
	FOREIGN KEY (`round_slug`) REFERENCES `sale_rounds`(`slug`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_slug`) REFERENCES `collections`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_src_collection` ON `sale_round_collections` (`collection_slug`);--> statement-breakpoint
CREATE TABLE `sale_round_member_stats` (
	`round_slug` text NOT NULL,
	`member_id` text NOT NULL,
	`mint_count` integer DEFAULT 0 NOT NULL,
	`rank` integer NOT NULL,
	`share_pct` real NOT NULL,
	`relative_index` real NOT NULL,
	`z_score` real NOT NULL,
	`rank_delta_prev` integer,
	`rolling5_rank` real,
	`rolling10_rank` real,
	`rolling5_relative_index` real,
	`rolling10_relative_index` real,
	`is_anomaly` integer DEFAULT false NOT NULL,
	`anomaly_direction` text,
	`anomaly_reason` text,
	PRIMARY KEY(`round_slug`, `member_id`),
	FOREIGN KEY (`round_slug`) REFERENCES `sale_rounds`(`slug`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_srms_member` ON `sale_round_member_stats` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_srms_round_rank` ON `sale_round_member_stats` (`round_slug`,`rank`);--> statement-breakpoint
CREATE TABLE `sale_rounds` (
	`slug` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`title` text NOT NULL,
	`season` text NOT NULL,
	`objekt_class` text NOT NULL,
	`on_offline` text DEFAULT 'online' NOT NULL,
	`sale_mechanic` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text,
	`unit_price_usd` real,
	`total_mints` integer DEFAULT 0 NOT NULL,
	`participating_members` integer DEFAULT 0 NOT NULL,
	`include_in_popularity` integer DEFAULT true NOT NULL,
	`is_auto_detected` integer DEFAULT false NOT NULL,
	`notes` text,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sale_rounds_artist_start` ON `sale_rounds` (`artist_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `idx_sale_rounds_popularity` ON `sale_rounds` (`artist_id`,`include_in_popularity`,`start_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`chain` text PRIMARY KEY NOT NULL,
	`last_indexed_block` integer DEFAULT 0 NOT NULL,
	`last_indexed_timestamp` text,
	`total_tokens_indexed` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
