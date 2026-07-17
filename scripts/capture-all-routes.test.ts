import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { getCaptureRoutes, getCaptureSeedCoverage } from "./capture-all-routes"

const root = process.cwd()

const dynamicSamples: Record<string, string> = {
  "/admin/productos/[id]": "/admin/productos/prod-audit-1",
  "/admin/productos/importar/[batchId]": "/admin/productos/importar/batch-audit-1",
  "/compras/[id]": "/compras/po-audit-1",
  "/compras/[id]/print": "/compras/po-audit-1/print",
  "/prevencion/[id]": "/prevencion/sst-audit-1",
  "/prevencion/trabajador/[workerId]": "/prevencion/trabajador/worker-audit-1",
  "/prevencion/ppa/[id]": "/prevencion/ppa/ppa-audit-1",
  "/prevencion/documentacion/[id]": "/prevencion/documentacion/doc-audit-1",
  "/prevencion/incidentes/[id]": "/prevencion/incidentes/inc-audit-1",
  "/prevencion/incidentes/[id]/procedimiento": "/prevencion/incidentes/inc-audit-1/procedimiento",
  "/prevencion/inspecciones/[id]": "/prevencion/inspecciones/insp-audit-1",
  "/recepcion/[id]": "/recepcion/rec-audit-1",
  "/recuperar/[token]": "/recuperar/capture-reset-token",
  "/repuestos/[id]": "/repuestos/rep-audit-1",
  "/servicios/[id]": "/servicios/srv-audit-1",
  "/solicitudes/[id]": "/solicitudes/req-audit-1",
  "/sst/[id]/print": "/sst/sst-audit-1/print",
  "/ppa/result/[token]": "/ppa/result/capture-ppa-token",
  "/soporte/[id]": "/soporte/sop-audit-1",
  "/trazabilidad/[itemId]": "/trazabilidad/req-item-audit-1",
  "/combustibles/[id]": "/combustibles/fuel-audit-1",
  "/combustibles/cuenta-corriente/[id]": "/combustibles/cuenta-corriente/cc-audit-1",
  "/combustibles/importar/[id]": "/combustibles/importar/fuel-import-audit-1",
  "/combustibles/importar/operaciones/[id]": "/combustibles/importar/operaciones/fuel-op-audit-1",
  "/combustibles/tae/[id]": "/combustibles/tae/tae-audit-1",
  "/combustibles/tae/importar/[id]": "/combustibles/tae/importar/tae-import-audit-1",
  "/tae/access/[accessToken]": "/tae/access/capture-tae-token",
  "/tae/resultado/[token]": "/tae/resultado/capture-tae-result-token",
  "/entregas/[id]/print": "/entregas/del-audit-1/print",
  "/flota/[id]": "/flota/fuel-veh-audit-1",
  "/prevencion/pdtp/[programId]": "/prevencion/pdtp/prog-audit-1",
  "/prevencion/pdtp/[programId]/editar": "/prevencion/pdtp/prog-audit-1/editar",
  "/prevencion/pdtp/[programId]/ejecucion/[executionId]": "/prevencion/pdtp/prog-audit-1/ejecucion/exec-audit-1",
  "/prevencion/pdtp/nuevo": "/prevencion/pdtp/nuevo",
  "/combustibles/bitacora/historial/[entityType]/[entityId]": "/combustibles/bitacora/historial/sst/entity-audit-1",
}

describe("capture-all-routes route inventory", () => {
  it("covers every concrete App Router page with a capture target", () => {
    const actualPaths = getCaptureRoutes().map((route) => new URL(route.path, "http://localhost").pathname)

    expect(actualPaths).toEqual(expect.arrayContaining(discoverConcretePagePaths()))
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
})

function discoverConcretePagePaths() {
  return findPageFiles(path.join(root, "app"))
    .map((file) => pageFileToRoutePattern(file))
    .filter((route): route is string => route !== null)
    .map((route) => dynamicSamples[route] ?? route)
    .sort()
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
