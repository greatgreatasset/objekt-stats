CREATE TABLE `drop_schedule` (
	`slug` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`event_type` text NOT NULL,
	`start_at` text,
	`end_at` text,
	`twitter_url` text,
	`image_url` text,
	`source` text DEFAULT 'apollo' NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_drop_schedule_artist_start` ON `drop_schedule` (`artist_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `idx_drop_schedule_artist_end` ON `drop_schedule` (`artist_id`,`end_at`);