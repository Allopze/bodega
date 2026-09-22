/**
 * Integration tests for lib/services/module-toggles.ts
 *
 * Uses PGlite in-memory Postgres (same pattern as feedback.test.ts).
 * Tests the feature toggle lifecycle: create, read, update, and nav integration.
 */

import path from "node:path"
import { readdirSync } from "node:fs"
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
  getNavigationToggleState,
  routeIsEnabled,
  resolveModuleRoute,
  assertPermissionModuleEnabled,
  setSubmoduleToggle,
} from "@/lib/services/module-toggles"

const NOW = new Date().toISOString()
const ACTOR = { userId: "test-user", userEmail: "test@chome.cl" }

const ROUTE_FILE = /^(?:route|page)\.(?:tsx?|jsx?|mjs)$/

function routeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) return routeFiles(absolute)
    return ROUTE_FILE.test(entry.name) ? [absolute] : []
  })
}

/**
 * Pathname público de un archivo de ruta. Los grupos `(app)`, `(print)` y
 * `(public)` no aparecen en la URL, así que se eliminan del segmento: sin esto
 * el inventario no veía `app/(print)/...` ni `app/(public)/...`, que fue por
 * donde entraron la PWA de PPA y la orden de compra imprimible.
 */
function routeSample(file: string, root: string) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/")
  return `/${relative.replace(ROUTE_FILE_SUFFIX, "").replace(/\[[^\]]+\]/g, "sample")}`
    .split("/").filter((segment) => segment && !segment.startsWith("("))
    .join("/").replace(/^/, "/") || "/"
}

const ROUTE_FILE_SUFFIX = /(?:^|\/)(?:route|page)\.(?:tsx?|jsx?|mjs)$/

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
    it("rechaza rutas que no pertenecen al manifiesto", async () => {
      const result = await setSubmoduleToggle("flota", "/combustibles", false, ACTOR)
      expect(result).toEqual({ ok: false, message: "Submódulo no registrado" })
      expect(await db.query.systemSettings.findFirst({
        where: eq(systemSettings.key, "submodule.enabled:flota:/combustibles"),
      })).toBeUndefined()
    })

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
    it("niega rutas y permisos del módulo, y sólo la ruta del submódulo apagado", async () => {
      await setSubmoduleToggle("combustibles", "/combustibles/tae", false, ACTOR)
      let state = await getNavigationToggleState()
      expect(resolveModuleRoute("/combustibles/tae/importar/historial")).toEqual({
        moduleId: "combustibles",
        submoduleHref: "/combustibles/tae",
      })
      expect(routeIsEnabled("/combustibles/tae/importar", state)).toBe(false)
      expect(routeIsEnabled("/combustibles/bitacora", state)).toBe(true)

      await setModuleToggle("combustibles", false, ACTOR)
      state = await getNavigationToggleState()
      expect(routeIsEnabled("/combustibles/bitacora", state)).toBe(false)
      await expect(assertPermissionModuleEnabled("combustibles:view")).rejects.toThrow(/módulo inactivo/i)
      await expect(assertPermissionModuleEnabled("admin:module_management")).resolves.toBeUndefined()
    })

    it("resuelve aliases, endpoints y jobs con un owner canónico", () => {
      expect(resolveModuleRoute("/admin/auditoria")).toEqual({ moduleId: "admin", submoduleHref: "/admin" })
      expect(resolveModuleRoute("/prevencion/nueva")).toEqual({ moduleId: "sst", submoduleHref: "/prevencion/evaluaciones" })
      expect(resolveModuleRoute("/prevencion/trabajador/worker-1")).toEqual({ moduleId: "sst", submoduleHref: "/prevencion/evaluaciones" })
      expect(resolveModuleRoute("/prevencion/evaluation-1")).toEqual({ moduleId: "sst", submoduleHref: "/prevencion/evaluaciones" })
      expect(resolveModuleRoute("/api/bodega/stock/export")).toEqual({ moduleId: "warehouse", submoduleHref: "/bodega" })
      expect(resolveModuleRoute("/api/prevencion/epp/export")).toEqual({ moduleId: "prevention", submoduleHref: "/prevencion/epp-preventivo" })
      // El mapa se trasladó a CGRD (2026-09-22) y conserva toggle propio: la ruta
      // del plano debe resolver al submódulo del mapa, no al del CGRD que lo
      // contiene por prefijo. Lo garantiza el sort por longitud de prefijo, que
      // no es evidente al leer el array.
      expect(resolveModuleRoute("/api/prevencion/cgrd/mapa/plano-1")).toEqual({ moduleId: "prevention", submoduleHref: "/prevencion/cgrd/mapa" })
      expect(resolveModuleRoute("/api/prevencion/cgrd/evidence/acta-1")).toEqual({ moduleId: "prevention", submoduleHref: "/prevencion/cgrd" })
      expect(resolveModuleRoute("/api/cron/billing-sales-sync")).toEqual({ moduleId: "billing", submoduleHref: "/facturacion/sincronizacion" })
      expect(resolveModuleRoute("/api/facturacion/facturas/export")).toEqual({ moduleId: "billing", submoduleHref: "/facturacion/facturas" })
      expect(resolveModuleRoute("/api/prevencion/inspecciones/export")).toEqual({ moduleId: "prevention", submoduleHref: undefined })
      expect(resolveModuleRoute("/api/prevencion/superficie-futura")).toBeNull()
    })

    it("cubre las superficies fuera de (app): PWA pública e impresiones", () => {
      // La PWA anónima de PPA escribía registros firmados con el módulo apagado.
      expect(resolveModuleRoute("/ppa")).toEqual({ moduleId: "ppa", submoduleHref: "/prevencion/ppa" })
      expect(resolveModuleRoute("/ppa/result/token-1")).toEqual({ moduleId: "ppa", submoduleHref: "/prevencion/ppa" })
      // …y las impresiones son otro grupo de rutas con su propio layout.
      expect(resolveModuleRoute("/sst/eval-1/print")).toEqual({ moduleId: "sst", submoduleHref: "/prevencion/evaluaciones" })
      expect(resolveModuleRoute("/compras/oc-1/print/pdf")).toEqual({ moduleId: "purchasing", submoduleHref: "/compras" })
      // Casos reservados es Privacidad, igual que su override de permiso.
      expect(resolveModuleRoute("/api/prevencion/casos-reservados/c-1"))
        .toEqual({ moduleId: "prevention", submoduleHref: "/prevencion/privacidad" })
      expect(resolveModuleRoute("/api/attachments/a-1")).toEqual({ moduleId: "deliveries", submoduleHref: "/entregas" })
    })

    it("bloquea el submódulo aunque la ruta canónica del permiso apunte a otro", async () => {
      // El permiso resuelve a /combustibles; la operación se despachó desde el
      // submódulo Bitácora. Apagar cualquiera de los dos debe cerrar la acción.
      await setSubmoduleToggle("combustibles", "/combustibles/bitacora", false, ACTOR)
      await expect(assertPermissionModuleEnabled(
        "combustibles:review_anomalies",
        "/combustibles/bitacora",
      )).rejects.toThrow(/submódulo inactivo/i)
    })

    it("mantiene inventariadas todas las páginas autenticadas y Route Handlers operativos", () => {
      // `(print)` y `(public)` tienen su propio layout y no atraviesan el de
      // `(app)`: quedaron fuera del inventario original y por ahí entraron dos
      // huecos reales (la PWA pública de PPA y la OC imprimible).
      const appRoot = path.resolve(process.cwd(), "app")
      const pageAllowlist = new Set([
        "/dashboard", "/forbidden", "/modulo-inactivo", "/perfil", "/prevencion", "/sample",
        "/login", "/registro", "/recuperar", "/recuperar/sample", "/restablecer", "/pendientes", "/", "/offline",
      ])
      const missingPages = routeFiles(appRoot)
        .filter((file) => /page\.(?:tsx?|jsx?)$/.test(file) && !file.includes(`${path.sep}api${path.sep}`))
        .map((file) => routeSample(file, appRoot))
        .filter((route) => !pageAllowlist.has(route) && !resolveModuleRoute(route))
      expect(missingPages).toEqual([])

      const apiRoot = path.resolve(process.cwd(), "app/api")
      const apiAllowPrefixes = ["/auth", "/health", "/attachments", "/notifications"]
      const missingApis = routeFiles(apiRoot)
        .filter((file) => file.endsWith("route.ts"))
        .map((file) => routeSample(file, apiRoot))
        .filter((route) => !apiAllowPrefixes.some((prefix) => routeMatchesTest(route, prefix)) && !resolveModuleRoute(`/api${route}`))
      expect(missingApis).toEqual([])
    })

    it("no permite despachar una Server Action TAE desde un submódulo hermano", async () => {
      await setSubmoduleToggle("combustibles", "/combustibles/tae", false, ACTOR)
      await expect(assertPermissionModuleEnabled(
        "combustibles:tae_manage_config",
        "/combustibles/bitacora",
      )).rejects.toThrow(/submódulo inactivo/i)
    })

    it("respeta el destino explícito de una Server Action con permiso ambiguo", async () => {
      await setSubmoduleToggle("combustibles", "/combustibles", false, ACTOR)
      await expect(assertPermissionModuleEnabled(
        "combustibles:review_anomalies",
        "/combustibles/bitacora",
        "/combustibles",
      )).rejects.toThrow(/submódulo inactivo/i)
    })

    it("falla cerrado si no puede leer system_settings", async () => {
      vi.spyOn(db.query.systemSettings, "findMany").mockRejectedValueOnce(new Error("database unavailable"))
      await expect(getNavigationToggleState()).rejects.toThrow("No se pudo verificar el estado de los módulos")
    })

    it("keeps the module toggle recovery route reachable when Admin is off", () => {
      expect(routeIsEnabled("/admin/modulos", {
        enabledModuleIds: new Set(["combustibles"]),
        disabledSubmoduleHrefs: new Set(["/admin"]),
      })).toBe(true)
    })

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

function routeMatchesTest(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}
