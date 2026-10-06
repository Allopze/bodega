import { describe, expect, it } from "vitest"
import { registry } from "@/modules/registry"

/**
 * TRV-01 (auditoría 2026-10-05): el ítem que declara `badge: "count"` y la
 * clave que calcula `app/(app)/layout.tsx` tienen que coincidir. Antes Bodega
 * declaraba un badge que nadie calculaba y Compras/Recepción lo calculaban sin
 * declararlo.
 */
const BADGE_KEYS_COMPUTED_BY_LAYOUT = [
  "/solicitudes", "/aprobaciones", "/compras", "/recepcion", "/bodega/guias", "/pendientes",
]

describe("badges del sidebar", () => {
  // `items` es una unión de tuplas literales por manifest: se ensancha a la
  // forma que el test lee para que `flatMap` no tenga que unificarlas.
  const items: ReadonlyArray<{ href: string; badge?: string }> = registry
    .flatMap((module) => module.nav.flatMap((area): ReadonlyArray<{ href: string; badge?: string }> => area.items))
  const declared = items
    .filter((item) => item.badge === "count")
    .map((item) => item.href)
    .sort()

  it("cada ítem con badge tiene un conteo calculado en el layout y viceversa", () => {
    expect(declared).toEqual([...BADGE_KEYS_COMPUTED_BY_LAYOUT].sort())
  })

  it("el badge de bodega cuelga de Guías de despacho, no de Bodega", () => {
    expect(declared).toContain("/bodega/guias")
    expect(declared).not.toContain("/bodega")
  })
})
