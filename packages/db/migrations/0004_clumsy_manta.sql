CREATE TABLE `token_metadata_cache` (
	`token_id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`collection_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`raw_artist` text NOT NULL,
	`member_name` text NOT NULL,
	`season` text NOT NULL,
	`objekt_class` text NOT NULL,
	`collection_no` text NOT NULL,
	`on_offline` text NOT NULL,
	`image_url` text,
	`background_color` text,
	`is_missing` integer DEFAULT false NOT NULL,
	`cached_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tmc_slug` ON `token_metadata_cache` (`slug`);--> statement-breakpoint
CREATE TABLE `wallet_polygon_cache` (
	`polygon_address` text PRIMARY KEY NOT NULL,
	`logs_json` text NOT NULL,
	`tx_count` integer DEFAULT 0 NOT NULL,
	`cached_at` text NOT NULL
);
