ALTER TABLE `collection_trade_stats` ADD `clean_solo_2x_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_trade_stats` ADD `clean_solo_3x_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_trade_stats` ADD `unique_overpayers` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `clean_solo_2x_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `clean_solo_3x_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `clean_solo_bulk_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `unique_overpayers` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_trade_stats` ADD `top_overpayer_share_pct` real;--> statement-breakpoint
ALTER TABLE `recent_trades` ADD `is_clean_solo` integer DEFAULT false NOT NULL;