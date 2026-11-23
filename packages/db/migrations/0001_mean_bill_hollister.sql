CREATE TABLE `processed_live_mints` (
	`token_id` integer PRIMARY KEY NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_processed_live_mints_synced` ON `processed_live_mints` (`synced_at`);