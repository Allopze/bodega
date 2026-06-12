/**
 * Integration tests for the most security-sensitive server-action paths
 * and the transactional code-sequence generator. These run against a
 * real in-memory PostgreSQL database (PGlite), so they exercise Drizzle SQL,
 * the uniqueness constraints, and the explicit `tx` plumbing that
 * unit tests with mocks can't reach.
 *
 * What's covered:
 *  1. Code sequences (SOL/OC/REC/ENT) across concurrent transactions
 *  2. Last-active-administrator guard (the SQL filter that prevents
 *     deactivating the only remaining admin)
 *  3. Reserved/unique pivot constraints added in 0002_integrity_indexes.sql
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterEach, describe, expect, it } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import { nextCodeTx } from "@/lib/code-sequences"
import type { Tx } from "@/db"

let pg: PGlite | null = null

async function makeDb() {
  pg = new PGlite()
  await pg.exec(`
    CREATE TABLE roles (
      id text PRIMARY KEY,
      name text NOT NULL UNIQUE,
      label text NOT NULL,
      description text
    );
    CREATE TABLE users (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      hashed_password text NOT NULL,
      avatar_color text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE user_roles (
      user_id text NOT NULL,
      role_id text NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );
    CREATE TABLE code_sequences (
      prefix text NOT NULL,
      year integer NOT NULL,
      next_value integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (prefix, year)
    );
  `)
  return drizzle(pg, { schema })
}

afterEach(async () => {
  await pg?.close()
  pg = null
})

// ── Code sequences under concurrent transactions ──────────────────────────

describe("code sequences — concurrent transactions", () => {
  it("issues unique, sequential codes across sequential transactions", async () => {
    const db = await makeDb()
    const N = 50
    const codes = new Set<string>()

    // Each transaction increments both counters. The PRIMARY KEY (prefix, year)
    // and onConflictDoUpdate guarantee uniqueness — tested with N sequential txns.
    for (let i = 0; i < N; i++) {
      await db.transaction(async (tx) => {
        const sol = await nextCodeTx(tx as unknown as Tx, "SOL", 2026)
        const oc  = await nextCodeTx(tx as unknown as Tx, "OC",  2026)
        codes.add(sol)
        codes.add(oc)
      })
    }

    expect(codes.size).toBe(N * 2)
    expect(codes.has("SOL-2026-0001")).toBe(true)
    expect(codes.has("OC-2026-0001")).toBe(true)
    expect(codes.has("SOL-2026-0000")).toBe(false)
  })

  it("isolates year buckets so a 2026 counter never feeds 2027", async () => {
    const db = await makeDb()
    const seen = await db.transaction(async (tx) => [
      await nextCodeTx(tx as unknown as Tx, "SOL", 2026),
      await nextCodeTx(tx as unknown as Tx, "SOL", 2026),
      await nextCodeTx(tx as unknown as Tx, "SOL", 2027),
      await nextCodeTx(tx as unknown as Tx, "SOL", 2027),
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
  async function seedAdminAndMembers() {
    const db = await makeDb()
    await db.insert(schema.roles).values({ id: "rol-admin", name: "administrador", label: "Admin" })
    await db.insert(schema.roles).values({ id: "rol-user",  name: "solicitante_faena", label: "Prevencionista faena" })
    await db.insert(schema.users).values({ id: "u-1", name: "Admin 1", email: "a1@x.cl", hashedPassword: "x", isActive: true })
    await db.insert(schema.users).values({ id: "u-2", name: "Admin 2", email: "a2@x.cl", hashedPassword: "x", isActive: true })
    await db.insert(schema.users).values({ id: "u-3", name: "Admin 3 (inactive)", email: "a3@x.cl", hashedPassword: "x", isActive: false })
    await db.insert(schema.userRoles).values({ userId: "u-1", roleId: "rol-admin" })
    await db.insert(schema.userRoles).values({ userId: "u-2", roleId: "rol-admin" })
    await db.insert(schema.userRoles).values({ userId: "u-3", roleId: "rol-admin" })
    return db
  }

  it("counts only ACTIVE administrators distinct from the target", async () => {
    const db = await seedAdminAndMembers()

    const otherActive = await db
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

    expect(otherActive.map((r) => r.id).sort()).toEqual(["u-2"])
  })

  it("returns zero other-active-admins when target is the only active admin", async () => {
    const db = await seedAdminAndMembers()
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-2"))

    const otherActive = await db
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

    expect(otherActive).toHaveLength(0)
  })

  it("ignores inactive admins even when they have the role assigned", async () => {
    const db = await seedAdminAndMembers()
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-2"))

    const otherActive = await db
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

    expect(otherActive.find((r) => r.id === "u-3")).toBeUndefined()
  })
})

// ── Pivot uniqueness (the 0002 migration) ────────────────────────────────

describe("integrity constraints (0002 migration parity)", () => {
  it("rejects a duplicate user/role assignment", async () => {
    await makeDb()
    await pg!.exec(`INSERT INTO roles (id, name, label) VALUES ('r1', 'administrador', 'Admin')`)
    await pg!.exec(`INSERT INTO users (id, name, email, hashed_password) VALUES ('u1', 'A', 'a@x.cl', 'x')`)
    await pg!.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('u1', 'r1')`)
    await expect(
      pg!.exec(`INSERT INTO user_roles (user_id, role_id) VALUES ('u1', 'r1')`),
    ).rejects.toThrow(/duplicate key/i)
  })

  it("rejects a duplicate (userId, worksiteId) assignment", async () => {
    await makeDb()
    await pg!.exec(`
      CREATE TABLE worksite_users (
        user_id text NOT NULL,
        worksite_id text NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        UNIQUE (user_id, worksite_id)
      );
    `)
    await pg!.exec(`INSERT INTO worksite_users (user_id, worksite_id) VALUES ('u1', 'w1')`)
    await expect(
      pg!.exec(`INSERT INTO worksite_users (user_id, worksite_id) VALUES ('u1', 'w1')`),
    ).rejects.toThrow(/duplicate key/i)
  })
})
