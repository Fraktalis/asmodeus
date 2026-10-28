CREATE TABLE `attention_items` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`entity_key` text NOT NULL,
	`collector_id` text NOT NULL,
	`origin` text NOT NULL,
	`state` text NOT NULL,
	`severity` text NOT NULL,
	`attention_reason` text NOT NULL,
	`decision_needed` text,
	`revisit_at` text,
	`flap_count` integer NOT NULL,
	`evidence` text NOT NULL,
	`source_url` text,
	`opened_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `attention_rule_entity_idx` ON `attention_items` (`rule_id`,`entity_key`,`opened_at`);--> statement-breakpoint
CREATE INDEX `attention_state_idx` ON `attention_items` (`state`);--> statement-breakpoint
CREATE TABLE `collector_states` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`last_attempt_at` text,
	`last_success_at` text,
	`failing_since` text
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`entity_key` text PRIMARY KEY NOT NULL,
	`collector_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`attributes` text NOT NULL,
	`source_url` text,
	`observed_at` text NOT NULL,
	`status_since` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `observations_collector_idx` ON `observations` (`collector_id`);--> statement-breakpoint
CREATE TABLE `transitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_key` text NOT NULL,
	`collector_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transitions_at_idx` ON `transitions` (`at`);