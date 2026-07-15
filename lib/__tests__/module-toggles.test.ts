/**
 * Integration tests for lib/services/module-toggles.ts
 *
 * Uses PGlite in-memory Postgres (same pattern as feedback.test.ts).
 * Tests the feature toggle lifecycle: create, read, update, and nav integration.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { eq } from "drizzle-orm"
import {
  getModuleToggle,
  setModuleToggle,
  getEnabledModuleIds,
  getAllModuleToggles,
  setSubmoduleToggle,
} from "@/lib/services/module-toggles"

const NOW = new Date().toISOString()
const ACTOR = { userId: "test-user", userEmail: "test@chome.cl" }

describe("module-toggles service", () => {
  beforeAll(async () => {
    // Need a user for audit log FK constraint
    await db.insert(schema.users).values({
      id: ACTOR.userId,
      name: "Test User",
      email: ACTOR.userEmail!,
      hashedPassword: "dummy",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  beforeEach(async () => {
    await db.delete(systemSettings)
  })



  // ── getModuleToggle ────────────────────────────────────────────────────

  describe("getModuleToggle", () => {
    it("returns true by default for an unset module", async () => {
      const enabled = await getModuleToggle("flota")
      expect(enabled).toBe(true)
    })

    it("returns false when the module was explicitly disabled", async () => {
      await db.insert(systemSettings).values({
        key: "module.enabled:flota",
        value: "false",
        updatedAt: new Date().toISOString(),
      })

      const enabled = await getModuleToggle("flota")
      expect(enabled).toBe(false)
    })

    it("returns true when the module was explicitly enabled", async () => {
      await db.insert(systemSettings).values({
        key: "module.enabled:flota",
        value: "true",
        updatedAt: new Date().toISOString(),
      })

      const enabled = await getModuleToggle("flota")
      expect(enabled).toBe(true)
    })

    it("returns true for unknown module IDs (safe default)", async () => {
      const enabled = await getModuleToggle("nonexistent-module")
      expect(enabled).toBe(true)
    })
  })

  // ── setModuleToggle ────────────────────────────────────────────────────

  describe("setModuleToggle", () => {
    it("disables a module and persists the state", async () => {
      const result = await setModuleToggle("flota", false, ACTOR)
      expect(result.ok).toBe(true)

      const row = await db.query.systemSettings.findFirst({
        where: eq(systemSettings.key, "module.enabled:flota"),
      })
      expect(row?.value).toBe("false")
    })

    it("re-enables a previously disabled module", async () => {
      await setModuleToggle("flota", false, ACTOR)
      await setModuleToggle("flota", true, ACTOR)

      const row = await db.query.systemSettings.findFirst({
        where: eq(systemSettings.key, "module.enabled:flota"),
      })
      expect(row?.value).toBe("true")
    })
  })

  // ── getEnabledModuleIds ────────────────────────────────────────────────

  describe("getEnabledModuleIds", () => {
    it("returns all module IDs when none are toggled", async () => {
      const ids = await getEnabledModuleIds()
      // Should include all registered modules (at least admin, requests, etc.)
      expect(ids.size).toBeGreaterThan(5)
      expect(ids.has("admin")).toBe(true)
      expect(ids.has("flota")).toBe(true)
      expect(ids.has("combustibles")).toBe(true)
    })

    it("excludes explicitly disabled modules", async () => {
      await db.insert(systemSettings).values([
        { key: "module.enabled:flota", value: "false", updatedAt: new Date().toISOString() },
        { key: "module.enabled:combustibles", value: "false", updatedAt: new Date().toISOString() },
      ])

      const ids = await getEnabledModuleIds()
      expect(ids.has("flota")).toBe(false)
      expect(ids.has("combustibles")).toBe(false)
      expect(ids.has("admin")).toBe(true) // Still enabled
    })

    it("includes all modules when every module is enabled", async () => {
      await db.insert(systemSettings).values([
        { key: "module.enabled:flota", value: "true", updatedAt: new Date().toISOString() },
        { key: "module.enabled:combustibles", value: "true", updatedAt: new Date().toISOString() },
      ])

      const ids = await getEnabledModuleIds()
      expect(ids.has("flota")).toBe(true)
    })
  })

  // ── getAllModuleToggles ────────────────────────────────────────────────

  describe("getAllModuleToggles", () => {
    it("returns all modules with defaults when none are stored", async () => {
      const toggles = await getAllModuleToggles()

      expect(toggles.length).toBeGreaterThan(5)
      const admin = toggles.find((t) => t.id === "admin")
      expect(admin).toBeDefined()
      expect(admin!.enabled).toBe(true)
      expect(admin!.label).toBe("Administración")
    })

    it("reflects disabled modules in the returned list", async () => {
      await db.insert(systemSettings).values({
        key: "module.enabled:flota", value: "false",
        updatedAt: new Date().toISOString(),
      })

      const toggles = await getAllModuleToggles()
      const flota = toggles.find((t) => t.id === "flota")
      expect(flota).toBeDefined()
      expect(flota!.enabled).toBe(false)
    })

    it("includes submodule toggles with correct enabled state", async () => {
      // Disable a specific submodule
      await db.insert(systemSettings).values({
        key: "submodule.enabled:flota:/flota", value: "false",
        updatedAt: new Date().toISOString(),
      })

      const toggles = await getAllModuleToggles()
      const flota = toggles.find((t) => t.id === "flota")
      expect(flota).toBeDefined()
      expect(flota!.submodules.length).toBeGreaterThanOrEqual(1)

      const flotaItem = flota!.submodules.find((s) => s.href === "/flota")
      expect(flotaItem).toBeDefined()
      expect(flotaItem!.enabled).toBe(false)
    })

    it("batches DB reads — only 2 queries for all modules", async () => {
      // Count findMany calls by wrapping
      let queryCount = 0
      const orig = db.query.systemSettings.findMany.bind(db.query.systemSettings)
      const spy = vi.fn(async (...a: unknown[]) => {
        queryCount++
        return orig(...(a as Parameters<typeof orig>))
      })
      // @ts-expect-error — mock for call-counting only
      db.query.systemSettings.findMany = spy

      try {
        await getAllModuleToggles()

        // Two queries: one for modules, one for submodules
        expect(queryCount).toBe(2)
      } finally {
        // Restore even if assertion fails (otherwise subsequent tests inherit the spy)
        db.query.systemSettings.findMany = orig
      }
    })
  })

  // ── setSubmoduleToggle ─────────────────────────────────────────────────

  describe("setSubmoduleToggle", () => {
    it("disables a submodule and persists the state", async () => {
      const result = await setSubmoduleToggle("flota", "/flota", false, ACTOR)
      expect(result.ok).toBe(true)

      const row = await db.query.systemSettings.findFirst({
        where: eq(systemSettings.key, "submodule.enabled:flota:/flota"),
      })
      expect(row?.value).toBe("false")
    })

    it("re-enables a previously disabled submodule", async () => {
      await setSubmoduleToggle("flota", "/flota", false, ACTOR)
      await setSubmoduleToggle("flota", "/flota", true, ACTOR)

      const row = await db.query.systemSettings.findFirst({
        where: eq(systemSettings.key, "submodule.enabled:flota:/flota"),
      })
      expect(row?.value).toBe("true")
    })
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Integration: toggle lifecycle ─────────────────────────────────────

  describe("toggle lifecycle", () => {
    it("full lifecycle: enable → disable → re-enable", async () => {
      // Start: enabled by default
      expect(await getModuleToggle("flota")).toBe(true)

      // Disable
      await setModuleToggle("flota", false, ACTOR)
      expect(await getModuleToggle("flota")).toBe(false)

      // Check that getEnabledModuleIds excludes it
      const idsAfterDisable = await getEnabledModuleIds()
      expect(idsAfterDisable.has("flota")).toBe(false)

      // Re-enable
      await setModuleToggle("flota", true, ACTOR)
      expect(await getModuleToggle("flota")).toBe(true)

      // Check that getEnabledModuleIds includes it again
      const idsAfterReEnable = await getEnabledModuleIds()
      expect(idsAfterReEnable.has("flota")).toBe(true)
    })

    it("module and submodule toggles are independent", async () => {
      // Disable only the submodule
      await setSubmoduleToggle("flota", "/flota", false, ACTOR)
      expect(await getModuleToggle("flota")).toBe(true) // Module still enabled

      const toggles = await getAllModuleToggles()
      const flota = toggles.find((t) => t.id === "flota")
      expect(flota!.enabled).toBe(true)

      const flotaItem = flota!.submodules.find((s) => s.href === "/flota")
      expect(flotaItem!.enabled).toBe(false)
    })
  })
})
