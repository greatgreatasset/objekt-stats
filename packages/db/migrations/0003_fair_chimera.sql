ALTER TABLE `sale_round_member_stats` ADD `unique_buyers` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_round_member_stats` ADD `mints_per_buyer` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_round_member_stats` ADD `top_buyer_share_pct` real;--> statement-breakpoint
ALTER TABLE `sale_round_member_stats` ADD `unique_buyers_rank` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_round_member_stats` ADD `unique_buyers_share_pct` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_round_member_stats` ADD `unique_buyers_relative_index` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_rounds` ADD `unique_buyers` integer DEFAULT 0 NOT NULL;