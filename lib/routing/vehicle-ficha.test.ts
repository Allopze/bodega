import { describe, expect, it } from "vitest"
import { isVehicleFichaTab, vehicleFichaHref, withSearchParams } from "./vehicle-ficha"

describe("vehicleFichaHref: una sola dirección por vehículo, una pestaña por área", () => {
  it("el Resumen es la raíz y cada área un segmento", () => {
    expect(vehicleFichaHref("veh-1")).toBe("/flota/veh-1")
    expect(vehicleFichaHref("veh-1", "resumen")).toBe("/flota/veh-1")
    expect(vehicleFichaHref("veh-1", "flota")).toBe("/flota/veh-1/flota")
    expect(vehicleFichaHref("veh-1", "mantencion")).toBe("/flota/veh-1/mantencion")
    expect(vehicleFichaHref("veh-1", "combustible")).toBe("/flota/veh-1/combustible")
  })

  it("codifica el id: un id raro no rompe la ruta", () => {
    expect(vehicleFichaHref("a/b c", "mantencion")).toBe("/flota/a%2Fb%20c/mantencion")
  })

  it("reconoce sólo las pestañas que existen", () => {
    expect(isVehicleFichaTab("combustible")).toBe(true)
    expect(isVehicleFichaTab("gps")).toBe(false)
  })
})

describe("withSearchParams: las redirecciones no pierden la query", () => {
  it("conserva cada parámetro, también los repetidos, y omite los vacíos de Next", () => {
    expect(withSearchParams("/flota/v1/mantencion", { creado: "1", vida: "40" })).toBe("/flota/v1/mantencion?creado=1&vida=40")
    expect(withSearchParams("/flota/v1/combustible", { periodo: "2026-10", faena: ["a", "b"], vacio: undefined })).toBe("/flota/v1/combustible?periodo=2026-10&faena=a&faena=b")
  })

  it("sin query, la ruta tal cual", () => {
    expect(withSearchParams("/flota/v1", {})).toBe("/flota/v1")
  })
})

/**
 * Las fichas viejas redirigen en el borde (`next.config.ts`), no desde una página: con el `loading.tsx` de
 * Equipos, la página respondía 200 con el esqueleto de la lista y redirigía en el cliente (crítica 2026-11-15).
 * Se calzan con el mismo `path-to-regexp` que usa Next.
 */
type PathMatcher = { match: (source: string, options?: { decode?: (value: string) => string }) => (path: string) => false | { params: Record<string, string> } }

describe("direcciones viejas de las fichas, en el borde", () => {
  async function destinationOf(pathname: string): Promise<string | null> {
    const { default: config } = await import("../../next.config")
    const { match } = (await import(
      // @ts-expect-error -- el path-to-regexp compilado de Next no trae tipos; es el matcher de `redirects()`.
      "next/dist/compiled/path-to-regexp"
    )) as PathMatcher
    for (const rule of (await config.redirects?.()) ?? []) {
      const found = match(rule.source, { decode: decodeURIComponent })(pathname)
      if (found) return rule.destination.replace(/:(\w+)/g, (_, key: string) => found.params[key] ?? "")
    }
    return null
  }

  it("la ficha de Mantención y la de Combustible llevan a su pestaña de /flota/[id]", async () => {
    expect(await destinationOf("/mantencion/equipos/veh-1")).toBe("/flota/veh-1/mantencion")
    expect(await destinationOf("/combustibles/consumo/equipos/veh-1")).toBe("/flota/veh-1/combustible")
  })

  it("las rutas hermanas de Equipos no se redirigen", async () => {
    for (const sibling of ["nuevo", "importar", "incorporar"]) expect(await destinationOf(`/mantencion/equipos/${sibling}`)).toBeNull()
    expect(await destinationOf("/mantencion/equipos")).toBeNull()
  })
})
