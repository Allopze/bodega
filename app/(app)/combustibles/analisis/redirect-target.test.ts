import { describe, expect, it, vi } from "vitest"

// `lib/auth/can` arrastra NextAuth, `next/headers` y la base; estas pruebas solo
// necesitan las constantes de `section-nav`, así que se lo reemplaza por un doble.
vi.mock("@/lib/auth/can", () => ({ can: () => false, isGlobalRole: () => false }))

import { FIRST_PERFORMANCE_HREF } from "@/lib/combustibles/section-nav"
import { legacyAnalysisTarget } from "./redirect-target"

describe("redirección de /combustibles/analisis", () => {
  it("sin parámetros va a la primera familia, la misma que era el preset por defecto", () => {
    expect(legacyAnalysisTarget({})).toBe(FIRST_PERFORMANCE_HREF)
  })

  it("cada preset cae en su familia", () => {
    expect(legacyAnalysisTarget({ preset: "truck" })).toBe("/combustibles/control/rendimiento/camiones")
    expect(legacyAnalysisTarget({ preset: "loaders_pickups" })).toBe("/combustibles/control/rendimiento/cargadores-camionetas")
    expect(legacyAnalysisTarget({ preset: "heavy" })).toBe("/combustibles/control/rendimiento/maquinaria")
  })

  it("un preset desconocido no rompe: cae en la primera familia", () => {
    expect(legacyAnalysisTarget({ preset: "otro" })).toBe(FIRST_PERFORMANCE_HREF)
  })

  it("conserva faena y rango de fechas, y descarta lo que la vista nueva no entiende", () => {
    const target = legacyAnalysisTarget({ preset: "heavy", agrupar: "vehicle", faena: "w1", desde: "2026-06-17", hasta: "2026-09-15" })
    const [path, query] = target.split("?")
    expect(path).toBe("/combustibles/control/rendimiento/maquinaria")
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ faena: "w1", desde: "2026-06-17", hasta: "2026-09-15" })
  })

  it("ignora fechas mal formadas y faena vacía", () => {
    expect(legacyAnalysisTarget({ faena: " ", desde: "ayer", hasta: "2026-13" })).toBe(FIRST_PERFORMANCE_HREF)
  })
})
