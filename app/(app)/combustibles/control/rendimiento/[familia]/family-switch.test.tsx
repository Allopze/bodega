import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// `lib/auth/can` arrastra NextAuth, `next/headers` y la base; estas pruebas solo
// necesitan las constantes de `section-nav`, así que se lo reemplaza por un doble.
vi.mock("@/lib/auth/can", () => ({ can: () => false, isGlobalRole: () => false }))

import { FamilySwitch, familySwitchHref } from "./family-switch"

describe("selector de familia del rendimiento", () => {
  it("conserva período, faena, mandante, rango y medio, y descarta equipo, unidad y páginas", () => {
    const href = familySwitchHref(
      { anio: "2026", meses: "1,2", faena: "w1", mandante: "m1", desde: "2026-01-01", hasta: "2026-02-28", medio: "fsm-tct", equipo: "AA1111", unidad: "km_per_liter", pagina: "3", cargas: "2" },
      "maquinaria",
    )
    const params = new URL(href, "http://x").searchParams
    expect(href.startsWith("/combustibles/control/rendimiento/maquinaria?")).toBe(true)
    expect(Object.fromEntries(params)).toEqual({
      anio: "2026", meses: "1,2", faena: "w1", mandante: "m1", desde: "2026-01-01", hasta: "2026-02-28", medio: "fsm-tct",
    })
  })

  it("sin filtros el enlace es la ruta pelada, con el slug de cada familia", () => {
    expect(familySwitchHref({}, "camiones")).toBe("/combustibles/control/rendimiento/camiones")
    expect(familySwitchHref({}, "cargadores_camionetas")).toBe("/combustibles/control/rendimiento/cargadores-camionetas")
  })

  it("toma el primer valor de un parámetro repetido y ignora los vacíos", () => {
    expect(familySwitchHref({ faena: ["w1", "w2"], mandante: "  " }, "camiones")).toBe("/combustibles/control/rendimiento/camiones?faena=w1")
  })

  it("marca solo la familia activa con aria-current", () => {
    const html = renderToStaticMarkup(<FamilySwitch active="cargadores_camionetas" searchParams={{ faena: "w1" }} />)
    expect(html).toContain('aria-label="Familia de equipos"')
    const anchors = html.match(/<a [^>]*>[^<]*<\/a>/g) ?? []
    expect(anchors).toHaveLength(3)
    const current = anchors.filter((anchor) => anchor.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('href="/combustibles/control/rendimiento/cargadores-camionetas?faena=w1"')
    expect(current[0]).toContain(">Cargadores y camionetas<")
    expect(html).toContain(">Camiones<")
    expect(html).toContain(">Maquinaria<")
  })
})
