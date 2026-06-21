-- Migration: remove local users table, replace FK references with plain text (username)
-- Users are now managed by auth-service (enterprise.db). Audit columns store username strings.

PRAGMA foreign_keys = OFF;

-- ── audit_items: remove FK reviewed_by → users ──────────────────────────────
CREATE TABLE `audit_items_new` (
    `id`                text PRIMARY KEY NOT NULL,
    `vault_id`          text NOT NULL,
    `source_file_name`  text NOT NULL,
    `source_text`       text NOT NULL,
    `generated_content` text NOT NULL,
    `generated_title`   text NOT NULL,
    `area`              text,
    `tags`              text,
    `curator_score`     real,
    `status`            text DEFAULT 'pending' NOT NULL,
    `feedback`          text,
    `reviewed_by`       text,
    `reviewed_at`       integer,
    `created_at`        integer NOT NULL,
    FOREIGN KEY (`vault_id`) REFERENCES `vault_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `audit_items_new` SELECT * FROM `audit_items`;
DROP TABLE `audit_items`;
ALTER TABLE `audit_items_new` RENAME TO `audit_items`;

--> statement-breakpoint

-- ── vault_history: remove FK changed_by → users ─────────────────────────────
CREATE TABLE `vault_history_new` (
    `id`               text PRIMARY KEY NOT NULL,
    `vault_id`         text NOT NULL,
    `note_path`        text NOT NULL,
    `previous_content` text,
    `new_content`      text NOT NULL,
    `changed_by`       text,
    `change_type`      text NOT NULL,
    `created_at`       integer NOT NULL,
    FOREIGN KEY (`vault_id`) REFERENCES `vault_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `vault_history_new` SELECT * FROM `vault_history`;
DROP TABLE `vault_history`;
ALTER TABLE `vault_history_new` RENAME TO `vault_history`;

--> statement-breakpoint

-- ── ingest_jobs: remove FK created_by → users ───────────────────────────────
CREATE TABLE `ingest_jobs_new` (
    `id`            text PRIMARY KEY NOT NULL,
    `vault_id`      text NOT NULL,
    `file_name`     text NOT NULL,
    `file_size`     integer,
    `area_hint`     text,
    `status`        text DEFAULT 'queued' NOT NULL,
    `error`         text,
    `audit_item_id` text,
    `created_by`    text,
    `created_at`    integer NOT NULL,
    `finished_at`   integer,
    FOREIGN KEY (`vault_id`)      REFERENCES `vault_definitions`(`id`) ON UPDATE no action ON DELETE no action,
    FOREIGN KEY (`audit_item_id`) REFERENCES `audit_items`(`id`)       ON UPDATE no action ON DELETE no action
);
INSERT INTO `ingest_jobs_new` SELECT * FROM `ingest_jobs`;
DROP TABLE `ingest_jobs`;
ALTER TABLE `ingest_jobs_new` RENAME TO `ingest_jobs`;

--> statement-breakpoint

-- ── improve_sessions: remove FK user_id → users ─────────────────────────────
CREATE TABLE `improve_sessions_new` (
    `id`              text PRIMARY KEY NOT NULL,
    `audit_item_id`   text NOT NULL,
    `user_id`         text NOT NULL,
    `messages`        text DEFAULT '[]' NOT NULL,
    `applied_content` text,
    `status`          text DEFAULT 'open' NOT NULL,
    `created_at`      integer NOT NULL,
    `updated_at`      integer NOT NULL,
    FOREIGN KEY (`audit_item_id`) REFERENCES `audit_items`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `improve_sessions_new` SELECT * FROM `improve_sessions`;
DROP TABLE `improve_sessions`;
ALTER TABLE `improve_sessions_new` RENAME TO `improve_sessions`;

--> statement-breakpoint

-- ── Drop users table (users now live in auth-service enterprise.db) ──────────
DROP TABLE IF EXISTS `users`;

PRAGMA foreign_keys = ON;
