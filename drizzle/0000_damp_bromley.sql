CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `comments_entry_id` ON `comments` (`entry_id`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`mood` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`meeting_id` text,
	`status` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE INDEX `entries_kind_created` ON `entries` (`kind`,`created`);--> statement-breakpoint
CREATE TABLE `hearts` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`author` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hearts_entry_author` ON `hearts` (`entry_id`,`author`);--> statement-breakpoint
CREATE TABLE `markers` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entry_id` text,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_entry_id` ON `media` (`entry_id`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`title` text NOT NULL,
	`place` text DEFAULT '' NOT NULL,
	`story` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`slot` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_id` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `misses` (
	`id` text PRIMARY KEY NOT NULL,
	`author` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`slot` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
