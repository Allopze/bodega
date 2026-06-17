import { pgTable, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { worksites, workers } from "./worksites"

/* ── Users ──────────────────────────────────────────────────────────────── */
export const users = pgTable("users", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull(),
  email:          text("email").notNull().unique(),
  hashedPassword: text("hashed_password").notNull(),
  avatarColor:    text("avatar_color"),   // OKLCH hue number as string
  workerId:       text("worker_id").references(() => workers.id, { onDelete: "set null" }),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── User invitations ─────────────────────────────────────────────────────── */
export const userInvitations = pgTable("user_invitations", {
  id:                  text("id").primaryKey(),
  email:               text("email").notNull(),
  name:                text("name"),
  tokenHash:           text("token_hash").notNull().unique(),
  roleIdsJson:         text("role_ids_json").notNull().default("[]"),
  worksiteAssignmentsJson: text("worksite_assignments_json").notNull().default("[]"),
  invitedByUserId:     text("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt:           text("expires_at").notNull(),
  acceptedAt:          text("accepted_at"),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Roles ───────────────────────────────────────────────────────────────── */
export const roles = pgTable("roles", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull().unique(), // slug: 'administrador', 'jefa_chome', etc.
  label:       text("label").notNull(),         // human-readable: 'Administrador'
  description: text("description"),
})

/* ── Permissions ─────────────────────────────────────────────────────────── */
export const permissions = pgTable("permissions", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull().unique(), // 'requests:create', 'orders:approve', etc.
  description: text("description"),
  module:      text("module").notNull(),        // 'requests', 'purchasing', 'admin', etc.
})

/* ── Role ↔ Permission ───────────────────────────────────────────────────── */
export const rolePermissions = pgTable("role_permissions", {
  roleId:       text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: text("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("role_permissions_role_permission_unique").on(table.roleId, table.permissionId),
])

/* ── User ↔ Permission (direct grants) ───────────────────────────────────── */
export const userPermissions = pgTable("user_permissions", {
  userId:       text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissionId: text("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("user_permissions_user_permission_unique").on(table.userId, table.permissionId),
])

/* ── User ↔ Role ─────────────────────────────────────────────────────────── */
export const userRoles = pgTable("user_roles", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("user_roles_user_role_unique").on(table.userId, table.roleId),
])

/* ── User ↔ Faena (worksite scoping) ────────────────────────────────────── */
export const worksiteUsers = pgTable("worksite_users", {
  userId:     text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  isPrimary:  boolean("is_primary").notNull().default(false),
}, (table) => [
  uniqueIndex("worksite_users_user_worksite_unique").on(table.userId, table.worksiteId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const usersRelations = relations(users, ({ one, many }) => ({
  userRoles:       many(userRoles),
  userPermissions: many(userPermissions),
  worksiteUsers:   many(worksiteUsers),
  invitations:     many(userInvitations),
  worker:          one(workers, { fields: [users.workerId], references: [workers.id] }),
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles:       many(userRoles),
  rolePermissions: many(rolePermissions),
}))

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  userPermissions: many(userPermissions),
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}))

export const userPermissionsRelations = relations(userPermissions, ({ one }) => ({
  user: one(users, { fields: [userPermissions.userId], references: [users.id] }),
  permission: one(permissions, { fields: [userPermissions.permissionId], references: [permissions.id] }),
}))

export const userInvitationsRelations = relations(userInvitations, ({ one }) => ({
  invitedBy: one(users, { fields: [userInvitations.invitedByUserId], references: [users.id] }),
}))
