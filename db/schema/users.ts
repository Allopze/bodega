import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"

/* ── Users ──────────────────────────────────────────────────────────────── */
export const users = sqliteTable("users", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull(),
  email:          text("email").notNull().unique(),
  hashedPassword: text("hashed_password").notNull(),
  avatarColor:    text("avatar_color"),   // OKLCH hue number as string
  isActive:       integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt:      text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt:      text("updated_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Roles ───────────────────────────────────────────────────────────────── */
export const roles = sqliteTable("roles", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull().unique(), // slug: 'administrador', 'solicitante', etc.
  label:       text("label").notNull(),         // human-readable: 'Administrador'
  description: text("description"),
})

/* ── Permissions ─────────────────────────────────────────────────────────── */
export const permissions = sqliteTable("permissions", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull().unique(), // 'requests:create', 'orders:approve', etc.
  description: text("description"),
  module:      text("module").notNull(),        // 'requests', 'purchasing', 'admin', etc.
})

/* ── Role ↔ Permission ───────────────────────────────────────────────────── */
export const rolePermissions = sqliteTable("role_permissions", {
  roleId:       text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: text("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
})

/* ── User ↔ Role ─────────────────────────────────────────────────────────── */
export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
})

/* ── User ↔ Faena (worksite scoping) ────────────────────────────────────── */
export const worksiteUsers = sqliteTable("worksite_users", {
  userId:     text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  worksiteId: text("worksite_id").notNull(),  // fk to worksites.id — resolved in index.ts
  isPrimary:  integer("is_primary", { mode: "boolean" }).notNull().default(false),
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const usersRelations = relations(users, ({ many }) => ({
  userRoles:      many(userRoles),
  worksiteUsers:  many(worksiteUsers),
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles:       many(userRoles),
  rolePermissions: many(rolePermissions),
}))

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}))
