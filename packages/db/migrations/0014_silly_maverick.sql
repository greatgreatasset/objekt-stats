CREATE TABLE `live_round_buyers` (
	`round_slug` text NOT NULL,
	`member_id` text NOT NULL,
	`wallet` text NOT NULL,
	`mint_count` integer DEFAULT 1 NOT NULL,
	`last_mint_at` text NOT NULL,
	PRIMARY KEY(`round_slug`, `member_id`, `wallet`)
);
--> statement-breakpoint
CREATE INDEX `idx_lrb_round_wallet` ON `live_round_buyers` (`round_slug`,`wallet`);--> statement-breakpoint
CREATE INDEX `idx_lrb_last_mint` ON `live_round_buyers` (`last_mint_at`);