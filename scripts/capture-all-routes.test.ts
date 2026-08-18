import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  cleanOutputDir,
  getAllowedCapturePaths,
  getCaptureRoutes,
  getCaptureSeedCoverage,
  isCaptureInteractionUrlAllowed,
  isCaptureUrlAllowed,
  pruneRedundantInteractionCaptures,
  reconcileCaptureArtifacts,
  requireCaptureDatabaseUrl,
  resolveServerLaunch,
  shouldUseProductionCaptureServer,
} from "./capture-all-routes"

const root = process.cwd()

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

  /*
   * Antes esto comparaba contra once rutas escritas a mano y por eso no vio
   * nada cuando el script se quedó 27 pantallas atrás (Facturación entera,
   * las GDI, el mapa de riesgos, los equipos de servicio…). El inventario se
   * deriva de `app/`: una pantalla nueva sin captura rompe la prueba, que es
   * el único momento en que alguien se acuerda de esta lista.
   */
  it("declara una captura para cada page.tsx del App Router", () => {
    const declared = declaredPathnames()
    const uncovered = discoverRoutePatterns().filter(
      (pattern) => !declared.some((pathname) => routePatternMatches(pattern, pathname)),
    )

    expect(uncovered).toEqual([])
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
        && !patterns.some((pattern) => routePatternMatches(pattern, pathname)),
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
      expect.objectContaining({ slug: "prevencion-pdtp-ejecucion", path: "/prevencion/pdtp/prog-audit-1/ejecucion/exec-audit-1" }),
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

/** Patrones de ruta de todo `app/`, con los segmentos dinámicos sin resolver. */
function discoverRoutePatterns() {
  return [...new Set(
    findPageFiles(path.join(root, "app"))
      .map((file) => pageFileToRoutePattern(file))
      .filter((route): route is string => route !== null),
  )].sort()
}

/** Pathnames declarados en el script, ya sin querystring. */
function declaredPathnames() {
  return getCaptureRoutes().map((route) => new URL(route.path, "http://localhost").pathname)
}

/**
 * ¿Este pathname concreto es una instancia del patrón? Compara segmento a
 * segmento y deja que `[algo]` haga de comodín, que es lo que evita mantener a
 * mano un ID de ejemplo por cada ruta dinámica.
 */
function routePatternMatches(pattern: string, pathname: string) {
  const expected = pattern.split("/")
  const actual = pathname.split("/")
  if (expected.length !== actual.length) return false
  return expected.every((segment, index) =>
    segment.startsWith("[") ? actual[index]!.length > 0 : segment === actual[index])
}

function findPageFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findPageFiles(fullPath)
    return entry.isFile() && entry.name === "page.tsx" ? [fullPath] : []
  })
}

function pageFileToRoutePattern(file: string) {
  const relative = path.relative(path.join(root, "app"), path.dirname(file))
  const segments = relative.split(path.sep).filter(Boolean)

  if (segments.some((segment) => segment === "api")) return null
  if (segments.some((segment) => segment.startsWith("[..."))) return null

  const urlSegments = segments.filter((segment) => !segment.startsWith("("))
  const route = `/${urlSegments.join("/")}`
  return route === "/" ? "/" : route.replace(/\/$/, "")
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
