/**
 * «Nivel en el tiempo» de Estanques (CHART-020, P-5): lo que decide la sección antes de dibujar.
 * El dibujo (recharts) tiene su propia prueba; aquí, la frase que responde, «Ver datos», el aviso de
 * los estanques quietos y los estados vacíos, que siempre llevan una salida real (A4).
 */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { buildTankLevelView, type TankDailyFlow, type TankLevelInput } from "@/lib/combustibles/tank-level"
import { StorageLevelTrend } from "./estanques-sections"

const TANKS: TankLevelInput[] = [
  { storageLocationId: "a", name: "Estanque A", capacityLiters: 20_000, openingLiters: 5_000 },
  { storageLocationId: "b", name: "Estanque B", capacityLiters: null, openingLiters: 1_200 },
]
const FLOWS: TankDailyFlow[] = [
  { storageLocationId: "a", day: "2026-10-02", inLiters: 10_000, outLiters: 0 },
  { storageLocationId: "a", day: "2026-10-05", inLiters: 0, outLiters: 3_000 },
]
const OCTOBER = { from: "2026-10-01", to: "2026-10-31", today: "2026-11-15" }
const PREVIOUS = "/combustibles/cuadratura/estanques?periodo=2026-09"

const html = (view: ReturnType<typeof buildTankLevelView>, overrides: { previousPeriodHref?: string | null; canCreate?: boolean } = {}) =>
  renderToStaticMarkup(
    <StorageLevelTrend view={view} periodPhrase="en octubre" previousPeriodHref={overrides.previousPeriodHref === undefined ? PREVIOUS : overrides.previousPeriodHref} canCreate={overrides.canCreate ?? false} />,
  )

describe("StorageLevelTrend", () => {
  it("con movimientos abre con la frase que responde, trae «Ver datos» y nombra los estanques que no se movieron", () => {
    const markup = html(buildTankLevelView(TANKS, FLOWS, OCTOBER))

    expect(markup).toContain("Nivel en el tiempo")
    expect(markup).toContain("El nivel de «Estanque A» pasó de 5.000 L a 12.000 L en octubre.")
    expect(markup).toContain("Ver datos")
    expect(markup).toContain("Total del período")
    expect(markup).toContain("Sin movimientos en octubre, su nivel no cambió: «Estanque B» (1.200 L).")
    // Con movimientos no hay estado vacío ni CTA al período anterior.
    expect(markup).not.toContain("Ver el período anterior")
  })

  it("sin ningún movimiento explica el vacío y ofrece ir al período anterior; con permiso, apunta a «Registrar movimiento»", () => {
    const empty = buildTankLevelView(TANKS, [], OCTOBER)

    const readOnly = html(empty)
    expect(readOnly).toContain("No hubo movimientos en los estanques en octubre")
    expect(readOnly).toContain("Cuando haya recepciones, traspasos o entregas desde un estanque")
    expect(readOnly).toContain(`href="${PREVIOUS}"`)
    expect(readOnly).toContain("Ver el período anterior")
    expect(readOnly).not.toContain("Registrar movimiento")

    const writer = html(empty, { canCreate: true })
    expect(writer).toContain("Con «Registrar movimiento», arriba")
    expect(writer).toContain(`href="${PREVIOUS}"`)
  })

  it("sin período anterior al que ir no inventa un enlace", () => {
    const markup = html(buildTankLevelView(TANKS, [], OCTOBER), { previousPeriodHref: null })

    expect(markup).toContain("No hubo movimientos en los estanques en octubre")
    expect(markup).not.toContain("Ver el período anterior")
  })

  it("un período que todavía no empieza lo dice en vez de dibujar ejes vacíos", () => {
    const markup = html(buildTankLevelView(TANKS, [], { from: "2026-12-01", to: "2026-12-31", today: "2026-11-15" }))

    expect(markup).toContain("Este período todavía no empieza")
    expect(markup).not.toContain("No hubo movimientos")
    expect(markup).toContain("Ver el período anterior")
  })

  it("con el período en curso la frase y «Ver datos» dicen «hasta hoy»", () => {
    const markup = html(buildTankLevelView(TANKS, FLOWS, { from: "2026-10-01", to: "2026-10-31", today: "2026-10-10" }))

    expect(markup).toContain("El período sigue en curso: el dibujo llega hasta el 10 oct.")
    expect(markup).toContain("Total hasta hoy")
  })
})
