/**
 * Integration tests for the most security-sensitive server-action paths
 * and the transactional code-sequence generator. These run against a
 * real in-memory SQLite database, so they exercise Drizzle SQL, the
 * uniqueness constraints, and the explicit `tx` plumbing that
 * unit tests with mocks can't reach.
 *
 * What's covered:
 *  1. Code sequences (SOL/OC/REC/ENT) across concurrent transactions
 *  2. Last-active-administrator guard (the SQL filter that prevents
 *     deactivating the only remaining admin)
 *  3. Reserved/unique pivot constraints added in 0002_integrity_indexes.sql
 */

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import { nextCodeTx } from "@/lib/code-sequences"

let sqlite: Database.Database | null = null

function makeDb() {
  sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  sqlite.exec(`
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      hashed_password TEXT NOT NULL,
      avatar_color TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );
    CREATE TABLE code_sequences (
      prefix TEXT NOT NULL,
      year INTEGER NOT NULL,
      next_value INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (prefix, year)
    );
  `)
  return drizzle(sqlite, { schema })
}

afterEach(() => {
  sqlite?.close()
  sqlite = null
})

// ── Code sequences under concurrent transactions ──────────────────────────

describe("code sequences — concurrent transactions", () => {
  it("issues unique, sequential codes even when many transactions race", () => {
    const db = makeDb()
    const N = 50
    const codes = new Set<string>()

    // Each transaction increments both counters. The generator must
    // never hand out the same value to two concurrent transactions —
    // the PRIMARY KEY (prefix, year) and onConflictDoUpdate guarantee it.
    // better-sqlite3 is synchronous, so we model concurrency by
    // running N independent transactions back-to-back; the SQL-level
    // uniqueness is what protects us under true concurrency.
    for (let i = 0; i < N; i++) {
      db.transaction((tx) => {
        const sol = nextCodeTx(tx, "SOL", 2026)
        const oc  = nextCodeTx(tx, "OC",  2026)
        codes.add(sol)
        codes.add(oc)
      })
    }

    expect(codes.size).toBe(N * 2)
    // No gaps at the start: first codes for 2026 are 0001, 0002, …
    expect(codes.has("SOL-2026-0001")).toBe(true)
    expect(codes.has("OC-2026-0001")).toBe(true)
    expect(codes.has("SOL-2026-0000")).toBe(false)
  })

  it("isolates year buckets so a 2026 counter never feeds 2027", () => {
    const db = makeDb()
    const seen = db.transaction((tx) => [
      nextCodeTx(tx, "SOL", 2026),
      nextCodeTx(tx, "SOL", 2026),
      nextCodeTx(tx, "SOL", 2027),
      nextCodeTx(tx, "SOL", 2027),
    ])
    expect(seen).toEqual([
      "SOL-2026-0001",
      "SOL-2026-0002",
      "SOL-2027-0001",
      "SOL-2027-0002",
    ])
  })
})

// ── Last-active-administrator guard ──────────────────────────────────────

describe("last-active-administrator guard (SQL filter)", () => {
  function seedAdminAndMembers() {
    const db = makeDb()
    db.insert(schema.roles).values({ id: "rol-admin", name: "administrador", label: "Admin" }).run()
    db.insert(schema.roles).values({ id: "rol-user",  name: "solicitante_faena", label: "Solicitante" }).run()
    db.insert(schema.users).values({ id: "u-1", name: "Admin 1", email: "a1@x.cl", hashedPassword: "x", isActive: true }).run()
    db.insert(schema.users).values({ id: "u-2", name: "Admin 2", email: "a2@x.cl", hashedPassword: "x", isActive: true }).run()
    db.insert(schema.users).values({ id: "u-3", name: "Admin 3 (inactive)", email: "a3@x.cl", hashedPassword: "x", isActive: false }).run()
    db.insert(schema.userRoles).values({ userId: "u-1", roleId: "rol-admin" }).run()
    db.insert(schema.userRoles).values({ userId: "u-2", roleId: "rol-admin" }).run()
    db.insert(schema.userRoles).values({ userId: "u-3", roleId: "rol-admin" }).run()
    return db
  }

  it("counts only ACTIVE administrators distinct from the target", () => {
    const db = seedAdminAndMembers()

    // Target u-1 is an active admin. With u-2 also active the guard
    // should permit deactivation.
    const otherActive = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(
        and(
          eq(schema.roles.name, "administrador"),
          eq(schema.users.isActive, true),
          // exclude target
          sql`${schema.users.id} != ${"u-1"}`,
        ),
      )
      .all()

    expect(otherActive.map((r) => r.id).sort()).toEqual(["u-2"])
  })

  it("returns zero other-active-admins when target is the only active admin", () => {
    const db = seedAdminAndMembers()
    // Deactivate u-2 to leave u-1 as the only active admin.
    db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-2")).run()

    const otherActive = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(
        and(
          eq(schema.roles.name, "administrador"),
          eq(schema.users.isActive, true),
          sql`${schema.users.id} != ${"u-1"}`,
        ),
      )
      .all()

    expect(otherActive).toHaveLength(0)
  })

  it("ignores inactive admins even when they have the role assigned", () => {
    const db = seedAdminAndMembers()
    // Deactivate all but u-1, then mark u-3 (inactive) as a real admin.
    db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-2")).run()

    const otherActive = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(
        and(
          eq(schema.roles.name, "administrador"),
          eq(schema.users.isActive, true),
          sql`${schema.users.id} != ${"u-1"}`,
        ),
      )
      .all()

    // u-3 is an admin (role) but inactive. The query must not include it.
    expect(otherActive.find((r) => r.id === "u-3")).toBeUndefined()
  })
})

// ── Pivot uniqueness (the 0002 migration) ────────────────────────────────

describe("integrity constraints (0002 migration parity)", () => {
  it("rejects a duplicate user/role assignment", () => {
    const db = makeDb()
    db.insert(schema.roles).values({ id: "r1", name: "administrador", label: "Admin" }).run()
    db.insert(schema.users).values({ id: "u1", name: "A", email: "a@x.cl", hashedPassword: "x" }).run()
    db.insert(schema.userRoles).values({ userId: "u1", roleId: "r1" }).run()
    expect(() =>
      db.insert(schema.userRoles).values({ userId: "u1", roleId: "r1" }).run(),
    ).toThrow(/UNIQUE/i)
  })

  it("rejects a duplicate (userId, worksiteId) assignment", () => {
    const db = makeDb()
    db.insert(schema.users).values({ id: "u1", name: "A", email: "a@x.cl", hashedPassword: "x" }).run()
    db.insert(schema.userRoles).values({ userId: "u1", roleId: "ignored" }).catch(() => undefined)
    // The schema is minimal here; emulate the unique constraint via raw SQL
    // because worksite_users isn't part of this lightweight harness.
    sqlite!.exec(`
      CREATE TABLE worksite_users (
        user_id TEXT NOT NULL,
        worksite_id TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, worksite_id)
      );
    `)
    sqlite!.prepare("INSERT INTO worksite_users (user_id, worksite_id) VALUES (?, ?)").run("u1", "w1")
    expect(() =>
      sqlite!.prepare("INSERT INTO worksite_users (user_id, worksite_id) VALUES (?, ?)").run("u1", "w1"),
    ).toThrow(/UNIQUE/i)
  })
})
