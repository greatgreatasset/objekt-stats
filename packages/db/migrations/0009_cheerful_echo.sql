CREATE TABLE `apollo_collection_cache` (
	`apollo_slug` text PRIMARY KEY NOT NULL,
	`drop_key` text NOT NULL,
	`total_copies` integer DEFAULT 0 NOT NULL,
	`transferable_copies` integer DEFAULT 0 NOT NULL,
	`transferable_pct` real DEFAULT 0 NOT NULL,
	`unobtainable` integer DEFAULT false NOT NULL,
	`description` text,
	`event_slug` text,
	`event_name` text,
	`event_type` text,
	`event_description` text,
	`twitter_url` text,
	`era_slug` text,
	`era_name` text,
	`era_image_url` text,
	`median_price_usd` real,
	`min_price_usd` real,
	`max_price_usd` real,
	`listing_count` integer,
	`price_updated_at` text,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_acc_drop_key` ON `apollo_collection_cache` (`drop_key`);--> statement-breakpoint
CREATE TABLE `apollo_drop_metadata` (
	`drop_key` text PRIMARY KEY NOT NULL,
	`sample_apollo_slug` text NOT NULL,
	`artist_id` text NOT NULL,
	`season` text NOT NULL,
	`collection_no` text NOT NULL,
	`description` text,
	`event_slug` text,
	`event_name` text,
	`event_type` text,
	`event_description` text,
	`twitter_url` text,
	`era_slug` text,
	`era_name` text,
	`era_image_url` text,
	`provenance_class` text DEFAULT 'unknown' NOT NULL,
	`pass_billing_month` text,
	`pass_billing_label` text,
	`is_free_distribution` integer DEFAULT false NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_adm_artist_class` ON `apollo_drop_metadata` (`artist_id`,`provenance_class`);--> statement-breakpoint
CREATE INDEX `idx_adm_event_slug` ON `apollo_drop_metadata` (`event_slug`);--> statement-breakpoint
ALTER TABLE `sale_rounds` ADD `apollo_event_slug` text;--> statement-breakpoint
ALTER TABLE `sale_rounds` ADD `apollo_event_name` text;--> statement-breakpoint
ALTER TABLE `sale_rounds` ADD `apollo_event_type` text;--> statement-breakpoint
ALTER TABLE `sale_rounds` ADD `apollo_era_name` text;--> statement-breakpoint
ALTER TABLE `sale_rounds` ADD `apollo_twitter_url` text;--> statement-breakpoint
ALTER TABLE `sale_rounds` ADD `apollo_description` text;