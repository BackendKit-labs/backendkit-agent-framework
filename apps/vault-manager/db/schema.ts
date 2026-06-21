import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// NOTE: La tabla `users` fue eliminada en la migración 0001.
// Los usuarios se gestionan en auth-service (enterprise.db).
// Las columnas de auditoría (reviewedBy, changedBy, etc.) almacenan el username como texto.

// ── Vault definitions ─────────────────────────────────────────────────────────

export const vaultDefinitions = sqliteTable('vault_definitions', {
    id:          text('id').primaryKey(),
    label:       text('label').notNull(),
    path:        text('path').notNull(),
    ownerRole:   text('owner_role', { enum: ['admin', 'technical', 'business'] }).notNull(),
    description: text('description'),
    icon:        text('icon').default('Database'),
    active:      integer('active', { mode: 'boolean' }).notNull().default(true),
    noteCount:   integer('note_count').notNull().default(0),
    createdAt:   integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt:   integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ── Audit items ───────────────────────────────────────────────────────────────

export const auditItems = sqliteTable('audit_items', {
    id:               text('id').primaryKey(),
    vaultId:          text('vault_id').notNull().references(() => vaultDefinitions.id),
    sourceFileName:   text('source_file_name').notNull(),
    sourceText:       text('source_text').notNull(),
    generatedContent: text('generated_content').notNull(),
    generatedTitle:   text('generated_title').notNull(),
    area:             text('area'),
    tags:             text('tags'),
    curatorScore:     real('curator_score'),
    status:           text('status', {
        enum: ['pending', 'approved', 'rejected', 'improved', 'processing'],
    }).notNull().default('pending'),
    feedback:         text('feedback'),
    reviewedBy:       text('reviewed_by'),   // username del revisor (auth-service)
    reviewedAt:       integer('reviewed_at', { mode: 'timestamp' }),
    createdAt:        integer('created_at',  { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ── Vault history ─────────────────────────────────────────────────────────────

export const vaultHistory = sqliteTable('vault_history', {
    id:              text('id').primaryKey(),
    vaultId:         text('vault_id').notNull().references(() => vaultDefinitions.id),
    notePath:        text('note_path').notNull(),
    previousContent: text('previous_content'),
    newContent:      text('new_content').notNull(),
    changedBy:       text('changed_by'),     // username del editor (auth-service)
    changeType:      text('change_type', {
        enum: ['ingest', 'edit', 'ai_improve', 'approve', 'reject'],
    }).notNull(),
    createdAt:       integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ── Ingest jobs ───────────────────────────────────────────────────────────────

export const ingestJobs = sqliteTable('ingest_jobs', {
    id:          text('id').primaryKey(),
    vaultId:     text('vault_id').notNull().references(() => vaultDefinitions.id),
    fileName:    text('file_name').notNull(),
    fileSize:    integer('file_size'),
    areaHint:    text('area_hint'),
    status:      text('status', {
        enum: ['queued', 'processing', 'done', 'failed'],
    }).notNull().default('queued'),
    error:       text('error'),
    auditItemId: text('audit_item_id').references(() => auditItems.id),
    createdBy:   text('created_by'),         // username del uploader (auth-service)
    createdAt:   integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    finishedAt:  integer('finished_at', { mode: 'timestamp' }),
});

// ── AI improvement sessions ───────────────────────────────────────────────────

export const improveSessions = sqliteTable('improve_sessions', {
    id:             text('id').primaryKey(),
    auditItemId:    text('audit_item_id').notNull().references(() => auditItems.id),
    userId:         text('user_id').notNull(),  // username del usuario (auth-service)
    messages:       text('messages').notNull().default('[]'),
    appliedContent: text('applied_content'),
    status:         text('status', { enum: ['open', 'applied', 'discarded'] }).notNull().default('open'),
    createdAt:      integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt:      integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type VaultDefinition = typeof vaultDefinitions.$inferSelect;
export type AuditItem       = typeof auditItems.$inferSelect;
export type VaultHistory    = typeof vaultHistory.$inferSelect;
export type IngestJob       = typeof ingestJobs.$inferSelect;
export type ImproveSession  = typeof improveSessions.$inferSelect;

export type AuditStatus  = 'pending' | 'approved' | 'rejected' | 'improved' | 'processing';
export type IngestStatus = 'queued' | 'processing' | 'done' | 'failed';

// Roles del vault-manager (para compatibilidad con vaultDefinitions.ownerRole)
export type VaultRole = 'admin' | 'technical' | 'business';
