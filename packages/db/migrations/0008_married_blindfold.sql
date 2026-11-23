CREATE TABLE `round_daily_mints` (
	`round_slug` text NOT NULL,
	`mint_date` text NOT NULL,
	`mint_count` integer DEFAULT 0 NOT NULL,
	`unique_buyers` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`round_slug`, `mint_date`),
	FOREIGN KEY (`round_slug`) REFERENCES `sale_rounds`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_round_daily_date` ON `round_daily_mints` (`mint_date`);