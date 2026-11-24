CREATE TABLE `recent_notable_spins` (
	`spin_key` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`chain` text NOT NULL,
	`spun_at` text NOT NULL,
	`wallet_short` text NOT NULL,
	`input_token_id` integer NOT NULL,
	`input_collection_id` text NOT NULL,
	`input_member_name` text NOT NULL,
	`input_class` text NOT NULL,
	`input_season` text NOT NULL,
	`input_collection_no` text NOT NULL,
	`input_image_url` text,
	`input_supply` integer,
	`outcome_kind` text NOT NULL,
	`output_token_id` integer,
	`output_collection_id` text,
	`output_member_name` text,
	`output_class` text,
	`output_season` text,
	`output_collection_no` text,
	`output_image_url` text,
	`delay_seconds` integer,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rns_artist_time` ON `recent_notable_spins` (`artist_id`,`spun_at`);--> statement-breakpoint
CREATE INDEX `idx_rns_artist_outcome` ON `recent_notable_spins` (`artist_id`,`outcome_kind`);--> statement-breakpoint
CREATE TABLE `spin_member_outcome_stats` (
	`member_id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`paired_sent_count` integer DEFAULT 0 NOT NULL,
	`paired_pulled_count` integer DEFAULT 0 NOT NULL,
	`paired_blank_from_count` integer DEFAULT 0 NOT NULL,
	`paired_rare_pulled_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_smos_artist` ON `spin_member_outcome_stats` (`artist_id`);--> statement-breakpoint
CREATE TABLE `spin_outcome_stats` (
	`artist_id` text PRIMARY KEY NOT NULL,
	`total_paired_spins` integer DEFAULT 0 NOT NULL,
	`blank_count` integer DEFAULT 0 NOT NULL,
	`fco_count` integer DEFAULT 0 NOT NULL,
	`sco_count` integer DEFAULT 0 NOT NULL,
	`premier_count` integer DEFAULT 0 NOT NULL,
	`other_count` integer DEFAULT 0 NOT NULL,
	`unique_spinners` integer DEFAULT 0 NOT NULL,
	`sample_start_at` text,
	`sample_end_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
