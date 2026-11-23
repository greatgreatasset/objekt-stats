CREATE TABLE `collection_trade_stats` (
	`collection_slug` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`member_id` text,
	`raw_member_name` text NOT NULL,
	`season` text NOT NULL,
	`objekt_class` text NOT NULL,
	`collection_no` text NOT NULL,
	`on_offline` text NOT NULL,
	`front_image_url` text,
	`background_color` text,
	`traded_count` integer DEFAULT 0 NOT NULL,
	`trade_sessions` integer DEFAULT 0 NOT NULL,
	`direct_transfer_count` integer DEFAULT 0 NOT NULL,
	`unique_traders` integer DEFAULT 0 NOT NULL,
	`first_trade_at` text,
	`last_trade_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_cts_artist_traded` ON `collection_trade_stats` (`artist_id`,`traded_count`);--> statement-breakpoint
CREATE INDEX `idx_cts_member` ON `collection_trade_stats` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_cts_artist_season` ON `collection_trade_stats` (`artist_id`,`season`,`objekt_class`);--> statement-breakpoint
CREATE TABLE `daily_trade_stats` (
	`artist_id` text NOT NULL,
	`trade_date` text NOT NULL,
	`trade_sessions` integer DEFAULT 0 NOT NULL,
	`traded_objekts` integer DEFAULT 0 NOT NULL,
	`direct_transfers` integer DEFAULT 0 NOT NULL,
	`unique_traders` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`artist_id`, `trade_date`),
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dts_date` ON `daily_trade_stats` (`trade_date`);--> statement-breakpoint
CREATE TABLE `member_trade_stats` (
	`member_id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`traded_count` integer DEFAULT 0 NOT NULL,
	`trade_sessions` integer DEFAULT 0 NOT NULL,
	`direct_transfer_count` integer DEFAULT 0 NOT NULL,
	`unique_traders` integer DEFAULT 0 NOT NULL,
	`collections_traded` integer DEFAULT 0 NOT NULL,
	`trade_rank` integer NOT NULL,
	`trade_share_pct` real NOT NULL,
	`trade_relative_index` real NOT NULL,
	`last_trade_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mts_artist_rank` ON `member_trade_stats` (`artist_id`,`trade_rank`);--> statement-breakpoint
CREATE TABLE `pending_p2p_transfers` (
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`chain` text NOT NULL,
	`block_number` integer NOT NULL,
	`transferred_at` text NOT NULL,
	`from_addr` text NOT NULL,
	`to_addr` text NOT NULL,
	`pair_key` text NOT NULL,
	`token_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	PRIMARY KEY(`tx_hash`, `log_index`)
);
--> statement-breakpoint
CREATE INDEX `idx_ppt_status_pair` ON `pending_p2p_transfers` (`status`,`pair_key`);--> statement-breakpoint
CREATE INDEX `idx_ppt_time` ON `pending_p2p_transfers` (`transferred_at`);--> statement-breakpoint
CREATE TABLE `recent_trades` (
	`trade_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`chain` text NOT NULL,
	`traded_at` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`side_a_count` integer NOT NULL,
	`side_b_count` integer NOT NULL,
	`wallet_a_short` text NOT NULL,
	`wallet_b_short` text NOT NULL,
	`side_a_summary` text NOT NULL,
	`side_b_summary` text NOT NULL,
	PRIMARY KEY(`trade_id`, `artist_id`),
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_recent_trades_artist_time` ON `recent_trades` (`artist_id`,`traded_at`);