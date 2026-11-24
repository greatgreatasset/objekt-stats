CREATE TABLE `processed_live_spins` (
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`wallet` text NOT NULL,
	`token_id` integer NOT NULL,
	`spun_at` text NOT NULL,
	`input_artist_id` text,
	`input_member_id` text,
	`input_collection_id` text,
	`input_member_name` text,
	`input_class` text,
	`input_season` text,
	`input_collection_no` text,
	`input_image_url` text,
	`input_supply` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`synced_at` text NOT NULL,
	PRIMARY KEY(`tx_hash`, `log_index`)
);
--> statement-breakpoint
CREATE INDEX `idx_pls_wallet_time` ON `processed_live_spins` (`wallet`,`spun_at`);--> statement-breakpoint
CREATE INDEX `idx_pls_status_time` ON `processed_live_spins` (`status`,`spun_at`);--> statement-breakpoint
CREATE TABLE `seasonal_wallet_leaderboard` (
	`artist_id` text NOT NULL,
	`season` text NOT NULL,
	`member_id` text NOT NULL,
	`wallet` text NOT NULL,
	`objekt_count` integer DEFAULT 0 NOT NULL,
	`grid_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`artist_id`, `season`, `member_id`, `wallet`)
);
--> statement-breakpoint
CREATE INDEX `idx_swl_obj` ON `seasonal_wallet_leaderboard` (`artist_id`,`season`,`member_id`,`objekt_count`);--> statement-breakpoint
CREATE INDEX `idx_swl_grd` ON `seasonal_wallet_leaderboard` (`artist_id`,`season`,`member_id`,`grid_count`);