import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { getCaptureRoutes, getCaptureSeedCoverage } from "./capture-all-routes"

const root = process.cwd()

const dynamicSamples: Record<string, string> = {
  "/admin/productos/[id]": "/admin/productos/prod-audit-1",
  "/compras/[id]": "/compras/po-audit-1",
  "/compras/[id]/print": "/compras/po-audit-1/print",
  "/prevencion/[id]": "/prevencion/sst-audit-1",
  "/recepcion/[id]": "/recepcion/rec-audit-1",
  "/recuperar/[token]": "/recuperar/capture-reset-token",
  "/repuestos/[id]": "/repuestos/rep-audit-1",
  "/servicios/[id]": "/servicios/srv-audit-1",
  "/solicitudes/[id]": "/solicitudes/req-audit-1",
  "/sst/[id]/print": "/sst/sst-audit-1/print",
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
    ]))
    expect(getCaptureSeedCoverage().every((area) => area.fixtures.length > 0)).toBe(true)
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
