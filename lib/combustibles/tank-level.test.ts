/**
 * Nivel de cada estanque en el tiempo (CHART-020, P-5). La serie es pura: aquí se verifica la
 * aritmética del nivel (apertura + entradas − salidas), la escala por tramo, el período en curso y
 * que las frases sigan siendo verdaderas en los estados parciales.
 */
import { describe, expect, it } from "vitest"
import {
  buildTankLevelView,
  idleTanksNote,
  summarizeTankLevels,
  tankLevelGranularityNote,
  tankLevelTable,
  type TankDailyFlow,
  type TankLevelInput,
} from "./tank-level"

const TANK_A: TankLevelInput = { storageLocationId: "a", name: "Estanque A", capacityLiters: 20_000, openingLiters: 5_000 }
const TANK_B: TankLevelInput = { storageLocationId: "b", name: "Estanque B", capacityLiters: null, openingLiters: 1_200 }

const flow = (storageLocationId: string, day: string, inLiters: number, outLiters: number): TankDailyFlow => ({ storageLocationId, day, inLiters, outLiters })

const OCTOBER = { from: "2026-10-01", to: "2026-10-31", today: "2026-11-15" }

describe("buildTankLevelView", () => {
  it("el nivel es la apertura más lo que entró menos lo que salió, y el cierre es el de la tabla", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 10_000, 0), flow("a", "2026-10-05", 0, 3_000), flow("a", "2026-10-05", 500, 0)], OCTOBER)
    const [tank] = view.tanks
    expect(view.granularity).toBe("day")
    expect(view.partial).toBe(false)
    expect(tank!.openingLiters).toBe(5_000)
    expect(tank!.inLiters).toBe(10_500)
    expect(tank!.outLiters).toBe(3_000)
    expect(tank!.closingLiters).toBe(5_000 + 10_500 - 3_000)
    const byDay = Object.fromEntries(tank!.buckets.map((bucket) => [bucket.start, bucket.level]))
    expect(byDay["2026-10-01"]).toBe(5_000)
    expect(byDay["2026-10-02"]).toBe(15_000)
    // Un día sin movimientos conserva el nivel: no vuelve a cero.
    expect(byDay["2026-10-03"]).toBe(15_000)
    expect(byDay["2026-10-05"]).toBe(12_500)
    expect(byDay["2026-10-31"]).toBe(12_500)
    expect(tank!.buckets).toHaveLength(31)
  })

  it("un estanque sin movimientos no tiene curva: va aparte con su nivel de apertura", () => {
    const view = buildTankLevelView([TANK_A, TANK_B], [flow("a", "2026-10-02", 100, 0)], OCTOBER)
    expect(view.tanks.map((tank) => tank.storageLocationId)).toEqual(["a"])
    expect(view.idle).toEqual([{ storageLocationId: "b", name: "Estanque B", levelLiters: 1_200 }])
  })

  it("ignora lo que cae fuera del período o de un estanque desconocido", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-09-30", 999, 0), flow("a", "2026-11-01", 999, 0), flow("otro", "2026-10-10", 999, 0), flow("a", "2026-10-10", 10, 0)], OCTOBER)
    expect(view.tanks[0]!.inLiters).toBe(10)
    expect(view.tanks[0]!.closingLiters).toBe(5_010)
  })

  it("un período en curso llega hasta hoy: lo que falta no tiene nivel (no es una caída a cero)", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 1_000, 0)], { from: "2026-10-01", to: "2026-10-31", today: "2026-10-10" })
    expect(view.partial).toBe(true)
    expect(view.observedUntil).toBe("2026-10-10")
    const buckets = view.tanks[0]!.buckets
    expect(buckets.find((bucket) => bucket.start === "2026-10-10")).toMatchObject({ future: false, level: 6_000 })
    expect(buckets.find((bucket) => bucket.start === "2026-10-11")).toMatchObject({ future: true, level: null, inLiters: 0, outLiters: 0 })
    expect(buckets.at(-1)).toMatchObject({ start: "2026-10-31", future: true, level: null })
    expect(view.tanks[0]!.closingLiters).toBe(6_000)
  })

  it("un movimiento fechado después de hoy se respeta: el cierre sigue cuadrando con la tabla", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-20", 700, 0)], { from: "2026-10-01", to: "2026-10-31", today: "2026-10-10" })
    expect(view.observedUntil).toBe("2026-10-20")
    expect(view.tanks[0]!.closingLiters).toBe(5_700)
  })

  it("un período que todavía no empieza no tiene nada que mostrar", () => {
    const view = buildTankLevelView([TANK_A], [], { from: "2026-12-01", to: "2026-12-31", today: "2026-11-15" })
    expect(view).toMatchObject({ notStarted: true, tanks: [], idle: [], observedUntil: null })
  })

  it("fechas inválidas no dibujan nada", () => {
    expect(buildTankLevelView([TANK_A], [], { from: "2026-10-31", to: "2026-10-01", today: "2026-11-15" }).notStarted).toBe(true)
  })

  it("el nivel puede quedar negativo (más salidas que entradas registradas) y se conserva", () => {
    const view = buildTankLevelView([{ ...TANK_A, openingLiters: 0 }], [flow("a", "2026-10-03", 0, 400)], OCTOBER)
    expect(view.tanks[0]!.closingLiters).toBe(-400)
    expect(view.tanks[0]!.buckets.find((bucket) => bucket.start === "2026-10-03")!.level).toBe(-400)
  })

  it("sobre 92 días agrupa por semana (de lunes a domingo) y marca la semana en curso como parcial", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-03-04", 100, 0), flow("a", "2026-03-05", 50, 0)], { from: "2026-01-01", to: "2026-06-30", today: "2026-03-05" })
    expect(view.granularity).toBe("week")
    const week = view.tanks[0]!.buckets.find((bucket) => bucket.start === "2026-03-02")
    // Miércoles y jueves caen en la semana del lunes 2 de marzo; hoy es jueves, así que la semana sigue en curso.
    expect(week).toMatchObject({ inLiters: 150, level: 5_150, partial: true, future: false, label: "Sem. 2 mar", title: "Semana del 02-03-2026" })
    expect(view.tanks[0]!.buckets.find((bucket) => bucket.start === "2026-03-09")).toMatchObject({ future: true, level: null })
    expect(tankLevelGranularityNote(view)).toBe("Cada barra es una semana (de lunes a domingo); la última sigue en curso.")
  })

  it("sobre 400 días agrupa por mes", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-02-10", 1_000, 0)], { from: "2025-01-01", to: "2026-12-31", today: "2027-01-05" })
    expect(view.granularity).toBe("month")
    expect(view.tanks[0]!.buckets).toHaveLength(24)
    expect(view.tanks[0]!.buckets.find((bucket) => bucket.start === "2026-02-01")).toMatchObject({ label: "feb 2026", inLiters: 1_000, level: 6_000 })
  })
})

describe("summarizeTankLevels", () => {
  it("con un estanque dice de dónde a dónde fue y cuál fue su nivel más bajo", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 0, 4_000), flow("a", "2026-10-09", 9_000, 0)], OCTOBER)
    expect(summarizeTankLevels(view, { periodPhrase: "en octubre" })).toBe(
      "El nivel de «Estanque A» pasó de 5.000 L a 10.000 L en octubre. El nivel más bajo fue 1.000 L (el 2 oct).",
    )
  })

  it("con varios cuenta cuántos se movieron del total y nombra el estanque del mínimo", () => {
    const view = buildTankLevelView([TANK_A, TANK_B], [flow("a", "2026-10-02", 100, 0), flow("b", "2026-10-03", 0, 200)], OCTOBER)
    expect(summarizeTankLevels(view, { periodPhrase: "en octubre" })).toBe("2 de 2 estanques tuvieron movimientos en octubre. El nivel más bajo fue 1.000 L en «Estanque B» (el 3 oct).")
  })

  it("no dice que «pasó» de un nivel a otro cuando terminó igual que empezó", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 1_000, 0), flow("a", "2026-10-03", 0, 1_000)], OCTOBER)
    expect(summarizeTankLevels(view, { periodPhrase: "en octubre" })).toContain("«Estanque A» terminó con el mismo nivel con que empezó (5.000 L) en octubre.")
  })

  it("con el período en curso lo dice y no promete más allá de hoy", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 1_000, 0)], { from: "2026-10-01", to: "2026-10-31", today: "2026-10-10" })
    expect(summarizeTankLevels(view, { periodPhrase: "en octubre" })).toMatch(/El período sigue en curso: el dibujo llega hasta el 10 oct\.$/)
  })

  it("un nivel negativo se explica en vez de mostrarse como si fuera un dato normal", () => {
    const view = buildTankLevelView([{ ...TANK_A, openingLiters: 0 }], [flow("a", "2026-10-03", 0, 400)], OCTOBER)
    expect(summarizeTankLevels(view, { periodPhrase: "en octubre" })).toContain("negativo, hay más salidas que entradas registradas")
  })

  it("sin ningún estanque con movimientos no hay frase: el gráfico explica el vacío", () => {
    expect(summarizeTankLevels(buildTankLevelView([TANK_A], [], OCTOBER), { periodPhrase: "en octubre" })).toBeNull()
  })

  it("con empate el mínimo es el día en que se llegó a él, no el último día de un nivel que queda plano", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 0, 1_000), flow("a", "2026-10-03", 1_000, 0), flow("a", "2026-10-04", 0, 1_000)], OCTOBER)
    expect(summarizeTankLevels(view, { periodPhrase: "en octubre" })).toContain("El nivel más bajo fue 4.000 L (el 2 oct)")
  })
})

describe("idleTanksNote", () => {
  it("nombra los estanques quietos con su nivel y no inventa uno si no hay", () => {
    const view = buildTankLevelView([TANK_A, TANK_B], [flow("a", "2026-10-02", 100, 0)], OCTOBER)
    expect(idleTanksNote(view, "en octubre")).toBe("Sin movimientos en octubre, su nivel no cambió: «Estanque B» (1.200 L).")
    expect(idleTanksNote(buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 100, 0)], OCTOBER), "en octubre")).toBeNull()
  })
})

describe("tankLevelTable", () => {
  it("«Ver datos»: al inicio, cada día con movimientos y el total, que es el nivel de la tabla del estanque", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 10_000, 0), flow("a", "2026-10-05", 0, 3_000)], OCTOBER)
    const table = tankLevelTable(view)
    expect(table.headers).toEqual(["Estanque", "Período", "Entradas (L)", "Salidas (L)", "Nivel al cierre (L)"])
    expect(table.rows).toEqual([
      ["Estanque A", "Al inicio del período", "—", "—", "5.000"],
      ["Estanque A", "02-10-2026", "10.000", "0", "15.000"],
      ["Estanque A", "05-10-2026", "0", "3.000", "12.000"],
      ["Estanque A", "Total del período", "10.000", "3.000", "12.000"],
    ])
  })

  it("con el período en curso el total dice «hasta hoy»", () => {
    const view = buildTankLevelView([TANK_A], [flow("a", "2026-10-02", 1, 0)], { from: "2026-10-01", to: "2026-10-31", today: "2026-10-10" })
    expect(tankLevelTable(view).rows.at(-1)![1]).toBe("Total hasta hoy")
  })
})
