CREATE TABLE `artist_all_time_stats` (
	`artist_id` text PRIMARY KEY NOT NULL,
	`unique_paid_buyers` integer DEFAULT 0 NOT NULL,
	`unique_all_minters` integer DEFAULT 0 NOT NULL,
	`snapshot_block` integer DEFAULT 0 NOT NULL,
	`snapshot_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `member_all_time_stats` (
	`member_id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`unique_paid_buyers` integer DEFAULT 0 NOT NULL,
	`unique_all_minters` integer DEFAULT 0 NOT NULL,
	`snapshot_block` integer DEFAULT 0 NOT NULL,
	`snapshot_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mats_artist` ON `member_all_time_stats` (`artist_id`);