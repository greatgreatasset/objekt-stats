ALTER TABLE `collection_trade_stats` ADD `same_edition_2x_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_trade_stats` ADD `same_edition_3x_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_trade_stats` ADD `same_edition_overpayers` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `same_edition_2x_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `same_edition_3x_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `same_edition_bulk_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `same_edition_overpayers` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `same_edition_top_share_pct` real;--> statement-breakpoint
ALTER TABLE `recent_trades` ADD `is_same_edition` integer DEFAULT false NOT NULL;