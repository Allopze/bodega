import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { chileDateParts } from "@/lib/utils"
import {
  cleanOutputDir,
  createDiscoveredCaptureRoutes,
  declareUncoveredRoutes,
  getAllowedCapturePaths,
  getCaptureRoutes,
  getCaptureRouteInventory,
  getCaptureSeedCoverage,
  isCaptureInteractionUrlAllowed,
  isCaptureUrlAllowed,
  normalizeInternalNavigationPath,
  pruneRedundantInteractionCaptures,
  reconcileCaptureArtifacts,
  requireCaptureDatabaseUrl,
  resolveCaptureStoragePath,
  resolveServerLaunch,
  shouldUseProductionCaptureServer,
  shiftCaptureDateMonths,
  uniqueInteractionSlug,
  type CaptureResult,
  type RouteTarget,
} from "./capture-all-routes"
import {
  discoverRoutePatterns,
  pageFileToRoutePattern,
  routePatternMatches,
} from "./capture-route-inventory"

const root = process.cwd()

describe("shiftCaptureDateMonths", () => {
  /**
   * Los fixtures de vigencias (garantías TI, licencias, comité GRD) usan
   * fechas relativas a HOY: una fecha absoluta envejece y la captura deja de
   * mostrar los estados que dice documentar. HOY es el día de Chile — una
   * captura corrida a las 22:00 de un domingo chileno no puede sembrar fechas
   * de un martes por preguntarle a UTC.
   */
  it("resuelve HOY en hora de Chile y acota el día al último del mes desplazado", () => {
    const { day: dayInChile, month: monthInChile, year: yearInChile } = chileDateParts()

    // Sin día fijo conserva el día corriente (o el último disponible si el mes
    // destino es más corto, p. ej. 31 → 30/feb).
    const result = shiftCaptureDateMonths(1)
    const expectedMonth = monthInChile === 12 ? 1 : monthInChile + 1
    const expectedYear = monthInChile === 12 ? yearInChile + 1 : yearInChile
    // El día se acota al último real del mes destino (p. ej. 31-mar → 30-abr).
    const lastDayOfTarget = new Date(Date.UTC(expectedYear, expectedMonth, 0)).getUTCDate()
    expect(result.startsWith(`${expectedYear}-`)).toBe(true)
    expect(Number(result.slice(5, 7))).toBe(expectedMonth)
    expect(Number(result.slice(8, 10))).toBe(Math.min(dayInChile, lastDayOfTarget))

    // Un día fijo mayor que la longitud del mes destino cae al último día real:
    // cualquier mes + 1 con día 31 nunca apunta a un día 31 de un mes de 30.
    const clamped = shiftCaptureDateMonths(1, 31)
    expect(Number(clamped.slice(8, 10))).toBeGreaterThanOrEqual(28)
    expect(Number(clamped.slice(8, 10))).toBeLessThanOrEqual(31)

    // Cruce de año hacia atrás y hacia delante: aritmética de meses, no de días.
    expect(shiftCaptureDateMonths(-14, 10)).toMatch(/^\d{4}-\d{2}-10$/)
    expect(shiftCaptureDateMonths(16, 1)).toMatch(/^\d{4}-\d{2}-01$/)
  })
})

describe("uniqueInteractionSlug", () => {
  it("preserva capturas distintas cuando sus etiquetas producen el mismo slug", () => {
    const used = new Set<string>()

    expect(uniqueInteractionSlug(used, "filtrar-programaciones-po")).toBe("filtrar-programaciones-po")
    expect(uniqueInteractionSlug(used, "filtrar-programaciones-po")).toBe("filtrar-programaciones-po-2")
    expect(uniqueInteractionSlug(used, "filtrar-programaciones-po")).toBe("filtrar-programaciones-po-3")
  })
})

/**
 * Directorio desechable para las pruebas de artefactos.
 *
 * Estaba bajo `audit/screenshots/`, que está en .gitignore: en un checkout
 * limpio —o sea, en CI— el directorio padre no existe y `mkdtempSync` muere con
 * ENOENT antes de ejecutar una sola aserción. Sólo pasaba en una máquina que ya
 * hubiera corrido `npm run screenshots`. Ninguna de las funciones bajo prueba
 * ata la ruta a ese directorio: reciben el destino por parámetro.
 */
function tempCaptureDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe("capture-all-routes route inventory", () => {
  it("requires an explicit isolated database and destructive-reset consent", () => {
    expect(() => requireCaptureDatabaseUrl({})).toThrow(/CAPTURE_DATABASE_URL is required/)
    expect(() => requireCaptureDatabaseUrl({
      CAPTURE_DATABASE_URL: "postgres:///bodega_capture",
    })).toThrow(/CAPTURE_ALLOW_DESTRUCTIVE_RESET=true/)
    expect(requireCaptureDatabaseUrl({
      CAPTURE_DATABASE_URL: "postgres:///bodega_capture",
      CAPTURE_ALLOW_DESTRUCTIVE_RESET: "true",
    })).toBe("postgres:///bodega_capture")
  })

  it("never derives a capture database from DATABASE_URL", () => {
    expect(() => requireCaptureDatabaseUrl({
      DATABASE_URL: "postgres:///bodega",
      CAPTURE_ALLOW_DESTRUCTIVE_RESET: "true",
    })).toThrow(/DATABASE_URL is never used as a fallback/)
  })

  it("never inherits the application storage volume for capture fixtures", () => {
    expect(resolveCaptureStoragePath({ STORAGE_PATH: "/srv/production-storage" }))
      .toBe(path.join(root, "storage", "capture"))
    expect(resolveCaptureStoragePath({ CAPTURE_STORAGE_PATH: "/tmp/chome-capture-storage" }))
      .toBe("/tmp/chome-capture-storage")
  })

  /*
   * Antes esto comparaba contra once rutas escritas a mano y por eso no vio
   * nada cuando el script se quedó 27 pantallas atrás (Facturación entera,
   * las GDI, el mapa de riesgos, los equipos de servicio…). El inventario se
   * deriva de `app/`: las páginas estáticas nuevas se agregan solas y las
   * dinámicas sin un fixture resoluble rompen la prueba.
   */
  it("declara una captura para cada página del App Router", () => {
    const inventory = getCaptureRouteInventory()
    const uncoveredStatic = inventory.discovered.filter((pattern) =>
      !pattern.dynamic
      && !inventory.routes.some((route) => routePatternMatches(
        pattern.pattern,
        new URL(route.path, "http://localhost").pathname,
      )),
    )

    expect(uncoveredStatic).toEqual([])
    expect(inventory.unresolvedDynamicPatterns).toEqual([])
  })

  it("auto-descubre páginas estáticas y deja dinámicas sin fixture explícito", () => {
    const appDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "capture-route-inventory-"))
    const staticPage = path.join(appDirectory, "(app)", "inventario", "nueva", "page.tsx")
    const dynamicPage = path.join(appDirectory, "(app)", "inventario", "[id]", "page.tsx")
    const catchAllPage = path.join(appDirectory, "(app)", "[[...slug]]", "page.tsx")

    try {
      fs.mkdirSync(path.dirname(staticPage), { recursive: true })
      fs.mkdirSync(path.dirname(dynamicPage), { recursive: true })
      fs.mkdirSync(path.dirname(catchAllPage), { recursive: true })
      fs.writeFileSync(staticPage, "export default function Page() { return null }")
      fs.writeFileSync(dynamicPage, "export default function Page() { return null }")
      fs.writeFileSync(catchAllPage, "export default function Page() { return null }")

      const discovered = discoverRoutePatterns(appDirectory)
      expect(discovered).toEqual([
        expect.objectContaining({ pattern: "/inventario/[id]", dynamic: true, auth: true }),
        expect.objectContaining({ pattern: "/inventario/nueva", dynamic: false, auth: true }),
      ])
      expect(pageFileToRoutePattern(staticPage, appDirectory)).toBe("/inventario/nueva")
      expect(routePatternMatches("/inventario/[id]", "/inventario/record-1")).toBe(true)
      expect(routePatternMatches("/inventario/[id]", "/inventario")).toBe(false)

      const autoRoutes = createDiscoveredCaptureRoutes(discovered, [
        { slug: "inventario", path: "/inventario", auth: true },
      ])
      expect(autoRoutes).toEqual([
        expect.objectContaining({
          slug: "inventario-nueva",
          path: "/inventario/nueva",
          auth: true,
          source: "filesystem",
        }),
      ])
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true })
    }
  })

  /*
   * El otro lado del inventario: una entrada que ya no corresponde a ninguna
   * página captura un 404 y lo reporta como evidencia válida. Las excepciones
   * son deliberadas y se enumeran acá, no en un comentario.
   */
  it("no conserva capturas de rutas que ya no existen", () => {
    const patterns = discoverRoutePatterns()
    // `/repuestos` y `/servicios` viven en los redirects de next.config.ts, no
    // en `app/`; la ruta inexistente y el subpath de investigación se declaran
    // a propósito con su estado esperado.
    const intentional = [
      "/app-ruta-inexistente-auditoria",
      "/prevencion/incidentes/inc-audit-1/procedimiento",
      "/repuestos", "/repuestos/nueva", "/repuestos/rep-audit-1",
      "/servicios", "/servicios/nueva", "/servicios/srv-audit-1",
    ]
    const orphans = declaredPathnames().filter(
      (pathname) => !intentional.includes(pathname)
        && !patterns.some((pattern) => routePatternMatches(pattern.pattern, pathname)),
    )

    expect(orphans).toEqual([])
  })

  it("declares representative mock data for every operational section", () => {
    const sections = getCaptureSeedCoverage().map((area) => area.section)

    expect(sections).toEqual(expect.arrayContaining([
      "dashboard",
      "solicitudes",
      "aprobaciones",
      "compras",
      "recepcion",
      "bodega",
      "entregas",
      "trazabilidad",
      "reportes",
      "flota",
      "mantenciones",
      "combustibles",
      "repuestos",
      "servicios",
      "prevencion",
      "admin-faenas",
      "admin-productos",
      "admin-proveedores",
      "admin-trabajadores",
      "admin-usuarios",
      "admin-auditoria",
      "admin-configuracion",
      "notificaciones",
      "soporte",
    ]))
    expect(getCaptureSeedCoverage().every((area) => area.fixtures.length > 0)).toBe(true)
  })

  it("descubre sólo enlaces internos navegables y elimina su estado de vista", () => {
    const base = "http://127.0.0.1:3127"

    expect(normalizeInternalNavigationPath("/compras?tab=avance#items", base)).toBe("/compras")
    expect(normalizeInternalNavigationPath(`${base}/dashboard?vista=trabajo`, base)).toBe("/dashboard")
    expect(normalizeInternalNavigationPath("https://example.com/compras", base)).toBeNull()
    expect(normalizeInternalNavigationPath("mailto:qa@example.com", base)).toBeNull()
    expect(normalizeInternalNavigationPath(`${base}/_next/static/chunk.js`, base)).toBeNull()
    expect(normalizeInternalNavigationPath(`${base}/api/health`, base)).toBeNull()
  })

  it("keeps a public TAE result backed by a named capture fixture", () => {
    expect(getCaptureRoutes()).toContainEqual(expect.objectContaining({
      slug: "tae-resultado",
      path: "/tae/resultado/capture-tae-result-token",
      auth: false,
    }))
    expect(getCaptureSeedCoverage().find((area) => area.section === "combustibles")?.fixtures)
      .toContain("carga TAE con resultado público")
  })

  it("names the persisted detail fixtures that back the previously missing P0 routes", () => {
    const routes = getCaptureRoutes()
    const combustibleFixtures = getCaptureSeedCoverage().find((area) => area.section === "combustibles")?.fixtures
    const productFixtures = getCaptureSeedCoverage().find((area) => area.section === "admin-productos")?.fixtures
    const supportFixtures = getCaptureSeedCoverage().find((area) => area.section === "soporte")?.fixtures
    const preventionFixtures = getCaptureSeedCoverage().find((area) => area.section === "prevencion")?.fixtures
    const tiFixtures = getCaptureSeedCoverage().find((area) => area.section === "ti")?.fixtures

    expect(routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "combustibles-importar-detalle", path: "/combustibles/importar/fuel-import-audit-1" }),
      expect.objectContaining({ slug: "combustibles-importar-operaciones-detalle", path: "/combustibles/importar/operaciones/fuel-op-audit-1" }),
      expect.objectContaining({ slug: "combustibles-tae-importar-detalle", path: "/combustibles/tae/importar/tae-import-audit-1" }),
      expect.objectContaining({ slug: "admin-productos-importar", path: "/admin/productos/importar/batch-audit-1" }),
      expect.objectContaining({ slug: "soporte-detalle", path: "/soporte/sop-audit-1" }),
      expect.objectContaining({ slug: "prevencion-capa-detalle", path: "/prevencion/capa/capa-audit-1" }),
      expect.objectContaining({ slug: "prevencion-requisito-legal", path: "/prevencion/requisitos-legales/legal-requirement-audit-1" }),
      expect.objectContaining({ slug: "prevencion-privacidad-solicitud", path: "/prevencion/privacidad/solicitudes/privacy-request-audit-1" }),
      expect.objectContaining({ slug: "prevencion-capacitacion-sesion", path: "/prevencion/capacitacion/trsess-audit-1" }),
      expect.objectContaining({ slug: "prevencion-gestion-cambio-detalle", path: "/prevencion/gestion-cambio/cambio-audit-1" }),
      expect.objectContaining({ slug: "prevencion-emergencias-plan-detalle", path: "/prevencion/emergencias/plan-audit-1" }),
      expect.objectContaining({ slug: "prevencion-permiso-detalle", path: "/prevencion/permisos/permit-audit-1" }),
      expect.objectContaining({ slug: "prevencion-cphs-comite-detalle", path: "/prevencion/cphs/comite-audit-1" }),
      expect.objectContaining({ slug: "prevencion-higiene-grupo-detalle", path: "/prevencion/higiene/grupos/grupo-audit-1" }),
      expect.objectContaining({ slug: "prevencion-higiene-programa-detalle", path: "/prevencion/higiene/programas/programa-audit-1" }),
      expect.objectContaining({ slug: "prevencion-documentacion-detalle", path: "/prevencion/documentacion/doc-audit-1" }),
      expect.objectContaining({ slug: "prevencion-miper-control", path: "/prevencion/miper/controles/risk-control-audit-1" }),
      expect.objectContaining({ slug: "prevencion-incidentes-detalle", path: "/prevencion/incidentes/inc-audit-1" }),
      expect.objectContaining({ slug: "prevencion-incidentes-procedimiento", expectedStatus: 404, captureView: false }),
      expect.objectContaining({ slug: "prevencion-inspeccion-detalle", path: "/prevencion/inspecciones/insp-audit-1" }),
      expect.objectContaining({ slug: "prevencion-inspeccion-en-curso", path: "/prevencion/inspecciones/insp-audit-progress" }),
      expect.objectContaining({ slug: "prevencion-inspeccion-reporte-equipos", path: "/prevencion/inspecciones/insp-audit-equipment-report" }),
      expect.objectContaining({ slug: "prevencion-pdtp-ejecucion", path: "/prevencion/pdtp/prog-audit-1/ejecucion/exec-audit-1" }),
      expect.objectContaining({ slug: "admin-inventario-faena-detalle", path: "/admin/inventario-faena/inventory-audit-1" }),
      expect.objectContaining({ slug: "flota-monitoreo", path: "/flota/monitoreo" }),
      // Submódulos TI del ciclo de vida (septiembre 2026): explícitos, no
      // delegados al auto-descubrimiento, porque dependen de fixtures propios.
      expect.objectContaining({ slug: "ti-accesos", path: "/ti/accesos" }),
      expect.objectContaining({ slug: "ti-bajas", path: "/ti/bajas" }),
      expect.objectContaining({ slug: "ti-garantias", path: "/ti/garantias" }),
      expect.objectContaining({ slug: "ti-licencias", path: "/ti/licencias" }),
      expect.objectContaining({ slug: "ti-mantenciones", path: "/ti/mantenciones" }),
      expect.objectContaining({ slug: "ti-reportes", path: "/ti/reportes" }),
      // G14/G15/G17 de Prevención (septiembre 2026), igual criterio.
      expect.objectContaining({ slug: "prevencion-alcotest", path: "/prevencion/alcotest" }),
      expect.objectContaining({ slug: "prevencion-cgrd", path: "/prevencion/cgrd" }),
      expect.objectContaining({ slug: "prevencion-constancias", path: "/prevencion/constancias" }),
    ]))
    expect(preventionFixtures).toEqual(expect.arrayContaining([
      "control de alcotest negativo con equipo y envío mensual del lote DO-48",
      "coordinador GRD en faena chica y comité GRD con matriz publicada y acta cerrada",
      "actividad de constancia PDTP planificada sin ejecución (deuda abierta)",
    ]))
    expect(tiFixtures).toEqual(expect.arrayContaining([
      "activo disponible con garantía vigente",
      "activo con garantía vencida y reparación costosa",
      "baja de activo autorizada",
      "licencia con asignaciones a trabajador y equipo",
      "sistemas de acceso con trabajador activo y suspendido",
    ]))
    expect(combustibleFixtures).toEqual(expect.arrayContaining([
      "lote de consumos con registros asociados y sin asociar",
      "lote de log operacional con faena pendiente de asociar",
      "lote TAE histórico con carga observada y rechazo",
    ]))
    expect(productFixtures).toContain("lote EPP pendiente de revisión")
    expect(supportFixtures).toContain("reporte de soporte abierto con nota de gestión")
    expect(preventionFixtures).toContain("acción CAPA en progreso con evidencia y seguimiento")
    expect(preventionFixtures).toContain("requisito legal publicado con aplicabilidad por faena")
    expect(preventionFixtures).toContain("solicitud de privacidad con identidad verificada")
    expect(preventionFixtures).toContain("sesión de capacitación cerrada con asistencia")
    expect(preventionFixtures).toContain("gestión de cambio evaluada con CAPA")
    expect(preventionFixtures).toContain("plan de emergencia con simulacro y roles")
    expect(preventionFixtures).toContain("permiso activo con AST, medición y aislamiento")
    expect(preventionFixtures).toContain("comité CPHS paritario con acta")
    expect(preventionFixtures).toContain("grupo de exposición con medición")
    expect(preventionFixtures).toContain("programa de vigilancia con matrículas")
    expect(preventionFixtures).toContain("documento vigente distribuido con acuse")
    expect(preventionFixtures).toContain("control MIPER crítico verificado")
    expect(preventionFixtures).toContain("incidente en investigación con evidencia y difusión RE-20")
    expect(preventionFixtures).toContain("inspección revisada con hallazgo CAPA")
    expect(preventionFixtures).toContain("inspección en curso con respuestas parciales")
    expect(preventionFixtures).toContain("Reporte de Equipos en transcripción con planilla física")
    expect(preventionFixtures).toContain("ejecución PDTP aprobada con checklist y plan de acción")
  })

  it("declares canonical redirects and rejects navigation outside each route allowlist", () => {
    const repuestosNueva = getCaptureRoutes().find((route) => route.slug === "repuestos-nueva")
    const serviciosNueva = getCaptureRoutes().find((route) => route.slug === "servicios-nueva")
    const legacyVehicles = getCaptureRoutes().find((route) => route.slug === "combustibles-vehiculos-legacy")
    const rootRoute = getCaptureRoutes().find((route) => route.slug === "root")

    expect(repuestosNueva).toBeDefined()
    expect(serviciosNueva).toBeDefined()
    expect(legacyVehicles).toBeDefined()
    expect(rootRoute).toBeDefined()
    expect(getAllowedCapturePaths(repuestosNueva!)).toEqual(["/solicitudes/nueva?tipo=repuestos"])
    expect(getAllowedCapturePaths(serviciosNueva!)).toEqual(["/solicitudes/nueva?tipo=servicios"])
    expect(getAllowedCapturePaths(legacyVehicles!)).toEqual(["/admin/flota-catalogos/vehiculos"])
    // El redirect conserva el destino en `callbackUrl`: la allowlist declara la
    // URL real, no una versión truncada que nunca ocurre.
    expect(getAllowedCapturePaths(rootRoute!)).toEqual(["/login?callbackUrl=%2F"])
    expect(rootRoute?.captureView).toBe(false)
    expect(legacyVehicles?.captureView).toBe(false)
    expect(repuestosNueva?.captureView).not.toBe(false)
    expect(isCaptureUrlAllowed(repuestosNueva!, "http://127.0.0.1:3127/solicitudes/nueva?tipo=repuestos")).toBe(true)
    expect(isCaptureUrlAllowed(repuestosNueva!, "http://127.0.0.1:3127/compras/po-audit-1")).toBe(false)
  })

  it("permite que una interacción cambie la query pero no la ruta", () => {
    const compras = getCaptureRoutes().find((route) => route.slug === "compras-detalle")
    expect(compras).toBeDefined()
    const base = "http://127.0.0.1:3127/compras/po-audit-1"
    // Las pestañas persisten su estado en la URL a propósito: eso no es salir
    // de la ruta y no debe invalidar la captura.
    expect(isCaptureInteractionUrlAllowed(compras!, `${base}?tab=facturacion`)).toBe(true)
    expect(isCaptureUrlAllowed(compras!, `${base}?tab=facturacion`)).toBe(false)
    // Cambiar de pathname sí sigue siendo abandonar la ruta declarada.
    expect(isCaptureInteractionUrlAllowed(compras!, "http://127.0.0.1:3127/compras")).toBe(false)
  })
})

describe("capture-all-routes server launch (C1/C2)", () => {
  const baseInput = {
    standaloneServer: path.join(root, ".next", "standalone", "server.js"),
    nextBin: path.join(root, "node_modules", ".bin", "next"),
    nodeExecPath: process.execPath,
  }

  it("uses the standalone server when available", () => {
    const launch = resolveServerLaunch({
      ...baseInput,
      useStandalone: true,
      hasProductionBuild: true,
      serverPort: 3128,
    })
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toEqual([baseInput.standaloneServer])
  })

  it("reserves the standalone production server for parallel viewport runs", () => {
    expect(shouldUseProductionCaptureServer(false)).toBe(false)
    expect(shouldUseProductionCaptureServer(true)).toBe(true)
    expect(shouldUseProductionCaptureServer(false, true)).toBe(true)
  })

  it("passes the per-server port (not the base port) to `next start`", () => {
    const launch = resolveServerLaunch({
      ...baseInput,
      useStandalone: false,
      hasProductionBuild: true,
      serverPort: 3128,
    })
    expect(launch.args).toContain("start")
    const portIndex = launch.args.indexOf("--port")
    expect(portIndex).toBeGreaterThan(-1)
    expect(launch.args[portIndex + 1]).toBe("3128")
    // El bug histórico usaba el puerto base (3127) para ambos servidores,
    // condenando al segundo a EADDRINUSE apenas existiera un build.
    expect(launch.args[portIndex + 1]).not.toBe("3127")
  })

  it("passes the per-server port to `next dev` when no build exists", () => {
    const launch = resolveServerLaunch({
      ...baseInput,
      useStandalone: false,
      hasProductionBuild: false,
      serverPort: 3128,
    })
    expect(launch.args).toContain("dev")
    const portIndex = launch.args.indexOf("--port")
    expect(portIndex).toBeGreaterThan(-1)
    expect(launch.args[portIndex + 1]).toBe("3128")
  })
})

describe("capture-all-routes artifact reconciliation (C3/F4)", () => {
  it("flags PNGs older than the run start as stale, not as orphans", () => {
    const dir = tempCaptureDir("reconcile-test-")
    try {
      const fresh = path.join(dir, "desktop-something.png")
      const stale = path.join(dir, "desktop-old.png")
      fs.writeFileSync(fresh, "fresh")
      fs.writeFileSync(stale, "stale")
      const past = new Date(Date.now() - 60_000)
      fs.utimesSync(stale, past, past)

      const results: Parameters<typeof reconcileCaptureArtifacts>[1] = [
        {
          viewport: "desktop",
          slug: "something",
          path: "/something",
          requestedUrl: "http://127.0.0.1:3127/something",
          finalUrl: "http://127.0.0.1:3127/something",
          status: 200,
          ok: true,
          state: "capture-ok",
          screenshot: path.relative(root, fresh),
        },
      ]

      const reconciliation = reconcileCaptureArtifacts(dir, results, { runStartedAt: Date.now() })
      expect(reconciliation.orphanFiles).toEqual([])
      expect(reconciliation.staleFiles).toEqual([path.relative(root, stale)])
      expect(reconciliation.missingFiles).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("cleanOutputDir removes pngs and manifests but keeps other files", () => {
    const dir = tempCaptureDir("clean-test-")
    try {
      fs.writeFileSync(path.join(dir, "desktop-x.png"), "png")
      fs.writeFileSync(path.join(dir, "mobile-x.png"), "png")
      fs.writeFileSync(path.join(dir, "manifest.json"), "{}")
      fs.writeFileSync(path.join(dir, "keep.txt"), "keep")

      cleanOutputDir(dir)

      expect(fs.existsSync(path.join(dir, "desktop-x.png"))).toBe(false)
      expect(fs.existsSync(path.join(dir, "mobile-x.png"))).toBe(false)
      expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(false)
      expect(fs.existsSync(path.join(dir, "keep.txt"))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** Pathnames declarados en el script, ya sin querystring. */
function declaredPathnames() {
  return getCaptureRoutes().map((route) => new URL(route.path, "http://localhost").pathname)
}

describe("poda de interacciones redundantes", () => {
  function captura(slug: string, hash: string, type: "view" | "tab"): Parameters<typeof pruneRedundantInteractionCaptures>[1][number] {
    return {
      viewport: "mobile",
      slug,
      path: "/compras/po-1",
      requestedUrl: "http://127.0.0.1:3127/compras/po-1",
      finalUrl: "http://127.0.0.1:3127/compras/po-1",
      status: 200,
      ok: true,
      state: "capture-ok",
      screenshot: `${slug}.png`,
      screenshotHash: hash,
      type,
    }
  }

  it("retira la interacción idéntica a una ruta y conserva la ruta", () => {
    const dir = tempCaptureDir("prune-test-")
    try {
      fs.writeFileSync(path.join(dir, "detalle-avance.png"), "x")
      fs.writeFileSync(path.join(dir, "detalle-tab-avance.png"), "x")
      const results = [
        captura("detalle-avance", "hash-a", "view"),
        captura("detalle-tab-avance", "hash-a", "tab"),
      ]

      expect(pruneRedundantInteractionCaptures(dir, results)).toEqual(["detalle-tab-avance"])
      expect(results.map((r) => r.slug)).toEqual(["detalle-avance"])
      // El archivo redundante desaparece: si quedara, la reconciliación lo
      // contaría como huérfano y el gate seguiría rojo por otra razón.
      expect(fs.existsSync(path.join(dir, "detalle-tab-avance.png"))).toBe(false)
      expect(fs.existsSync(path.join(dir, "detalle-avance.png"))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("no toca dos vistas idénticas: eso sigue siendo un defecto", () => {
    const dir = tempCaptureDir("prune-test-")
    try {
      fs.writeFileSync(path.join(dir, "a.png"), "x")
      fs.writeFileSync(path.join(dir, "b.png"), "x")
      const results = [captura("a", "hash-b", "view"), captura("b", "hash-b", "view")]

      expect(pruneRedundantInteractionCaptures(dir, results)).toEqual([])
      expect(results).toHaveLength(2)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("conserva una interacción que no coincide con ninguna ruta", () => {
    const dir = tempCaptureDir("prune-test-")
    try {
      fs.writeFileSync(path.join(dir, "detalle.png"), "x")
      fs.writeFileSync(path.join(dir, "detalle-tab-otra.png"), "y")
      const results = [captura("detalle", "hash-c", "view"), captura("detalle-tab-otra", "hash-d", "tab")]

      expect(pruneRedundantInteractionCaptures(dir, results)).toEqual([])
      expect(results).toHaveLength(2)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("declareUncoveredRoutes", () => {
  /**
   * Cuando el navegador se cae a mitad de la corrida, las rutas que se quedaron
   * sin resultado tienen que aparecer en el manifest como fallo declarado: el
   * 2026-09-16 Chromium murió en la ruta 11 de 242 y, sin esto, la corrida
   * moría sin manifest —ni capturas ni hueco de cobertura escrito—, así que el
   * único final aceptable es una corrida que cierra y dice qué no cubrió.
   */
  const motivo = "el navegador se cerró durante la corrida"
  const ruta = (slug: string): RouteTarget => ({ slug, path: `/${slug}`, auth: true })
  const capturada = (viewport: string, slug: string): CaptureResult => ({
    viewport,
    slug,
    path: `/${slug}`,
    requestedUrl: `http://127.0.0.1:3127/${slug}`,
    finalUrl: `http://127.0.0.1:3127/${slug}`,
    status: 200,
    ok: true,
    state: "capture-ok",
    screenshot: `/tmp/${viewport}-${slug}.png`,
  })

  it("declara solo las rutas sin resultado y no pisa las ya capturadas", () => {
    const capturadaOk = capturada("desktop", "ti")
    const results: CaptureResult[] = [capturadaOk]

    const declaradas = declareUncoveredRoutes(
      results,
      "desktop",
      [ruta("ti"), ruta("ti-activos"), ruta("ti-bajas")],
      "http://127.0.0.1:3127",
      motivo,
    )

    expect(declaradas.map((r) => r.slug)).toEqual(["ti-activos", "ti-bajas"])
    expect(declaradas[0]).toMatchObject({
      ok: false,
      state: "capture-invalid",
      status: null,
      error: `Sin capturar: ${motivo}`,
    })
    // El manifest no puede declarar fallo lo que sí tiene PNG.
    expect(results[0]).toEqual(capturadaOk)
    expect(results).toHaveLength(3)
  })

  it("no declara nada cuando todas las rutas del viewport tienen resultado", () => {
    const results: CaptureResult[] = [capturada("mobile", "ti")]

    expect(declareUncoveredRoutes(results, "mobile", [ruta("ti")], "http://127.0.0.1:3128", motivo)).toEqual([])
    expect(results).toHaveLength(1)
  })

  it("no confunde la captura de un viewport con la del otro", () => {
    // Las dos vistas capturan los mismos slugs: si la clave no incluyera el
    // viewport, la corrida de desktop daría por cubiertas rutas que sólo se
    // capturaron en mobile y el hueco desaparecería del manifest.
    const results: CaptureResult[] = [capturada("mobile", "ti")]

    const declaradas = declareUncoveredRoutes(results, "desktop", [ruta("ti")], "http://127.0.0.1:3127", motivo)

    expect(declaradas.map((r) => r.slug)).toEqual(["ti"])
    expect(declaradas[0]!.viewport).toBe("desktop")
  })
})
