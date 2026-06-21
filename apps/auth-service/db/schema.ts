import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const roles = sqliteTable('roles', {
    id:          text('id').primaryKey(),
    name:        text('name').notNull().unique(),   // clave técnica: admin, hr, sales…
    label:       text('label').notNull(),            // nombre legible: Administrador, RR.HH.
    description: text('description'),
    tools:       text('tools').notNull().default('[]'), // JSON: string[] de tool names
    active:      integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt:   text('created_at').notNull(),
    updatedAt:   text('updated_at').notNull(),
});

export type Role       = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;

export const departments = sqliteTable('departments', {
    id:          text('id').primaryKey(),
    name:        text('name').notNull().unique(),
    description: text('description'),
    active:      integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt:   text('created_at').notNull(),
});

export type Department       = typeof departments.$inferSelect;
export type InsertDepartment = typeof departments.$inferInsert;

export const users = sqliteTable('users', {
    id:              text('id').primaryKey(),
    username:        text('username').notNull().unique(),
    name:            text('name'),
    email:           text('email'),
    role:            text('role').notNull().default('viewer'),
    department:      text('department'),
    passwordHash:    text('password_hash').notNull(),
    active:          integer('active',          { mode: 'boolean' }).notNull().default(true),
    failedAttempts:  integer('failed_attempts').notNull().default(0),
    lockedUntil:     text('locked_until'),
    // Workspace del Director — JSON array o null (null = usar defaults del rol)
    directorTools:   text('director_tools'),
    // Namespaces del vault — JSON array o null (null = usar defaults del rol)
    vaultNamespaces: text('vault_namespaces'),
    // Acceso a apps
    canUseDirector:  integer('can_use_director', { mode: 'boolean' }).notNull().default(true),
    canUseVault:     integer('can_use_vault',    { mode: 'boolean' }).notNull().default(false),
    createdAt:       text('created_at').notNull(),
    updatedAt:       text('updated_at').notNull(),
});

export type User        = typeof users.$inferSelect;
export type InsertUser  = typeof users.$inferInsert;

export type EnterpriseRole = 'admin' | 'development' | 'devops' | 'hr' | 'sales' | 'finance' | 'viewer';

export const ROLES: EnterpriseRole[] = ['admin', 'development', 'devops', 'hr', 'sales', 'finance', 'viewer'];
