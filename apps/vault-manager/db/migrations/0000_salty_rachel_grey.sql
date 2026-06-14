CREATE TABLE `audit_items` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`source_file_name` text NOT NULL,
	`source_text` text NOT NULL,
	`generated_content` text NOT NULL,
	`generated_title` text NOT NULL,
	`area` text,
	`tags` text,
	`curator_score` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`feedback` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vault_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `improve_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`applied_content` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`audit_item_id`) REFERENCES `audit_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ingest_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer,
	`area_hint` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`audit_item_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`vault_id`) REFERENCES `vault_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`audit_item_id`) REFERENCES `audit_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`avatar` text,
	`active` integer DEFAULT true NOT NULL,
	`last_active_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vault_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`path` text NOT NULL,
	`owner_role` text NOT NULL,
	`description` text,
	`icon` text DEFAULT 'Database',
	`active` integer DEFAULT true NOT NULL,
	`note_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_history` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`note_path` text NOT NULL,
	`previous_content` text,
	`new_content` text NOT NULL,
	`changed_by` text,
	`change_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vault_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
