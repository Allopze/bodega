import { describe, expect, it } from "vitest"
import { baseInterval, checkItemResults, checklistFor, groupChecklist, inheritedIntervalFor, suggestInterval } from "../schedule"
import type { MantChecklistItem, MantScheduleSnapshot } from "../types"

const KM = [10_000, 20_000, 40_000, 80_000, 160_000]
const HORAS = [300, 600, 900, 1_200]

describe("regla 4 · pauta sugerida", () => {
  it("5.400 h en maquinaria sugiere la de 900 h", () => {
    expect(suggestInterval(HORAS, 5_400)).toEqual({ index: 2, intervalValue: 900, point: 5_400 })
  })

  it("redondea la lectura al intervalo base y elige el MAYOR intervalo que divide el punto", () => {
    expect(suggestInterval(KM, 40_312)).toEqual({ index: 2, intervalValue: 40_000, point: 40_000 })
    expect(suggestInterval(KM, 160_000)).toMatchObject({ intervalValue: 160_000, point: 160_000 })
    expect(suggestInterval(KM, 100_000)).toMatchObject({ intervalValue: 20_000, point: 100_000 })
    expect(suggestInterval(KM, 90_000)).toMatchObject({ intervalValue: 10_000, point: 90_000 })
    expect(suggestInterval(KM, 80_000)).toMatchObject({ intervalValue: 80_000 })
  })

  it("el punto nunca baja de la base", () => {
    expect(suggestInterval(KM, 0)).toMatchObject({ intervalValue: 10_000, point: 10_000 })
    expect(suggestInterval(KM, 3_000)).toMatchObject({ intervalValue: 10_000, point: 10_000 })
    expect(suggestInterval(KM, 4_999)).toMatchObject({ point: 10_000 })
  })

  it("la mitad exacta sube (Math.round) y justo debajo baja", () => {
    expect(suggestInterval(KM, 15_000)).toMatchObject({ point: 20_000, intervalValue: 20_000 })
    expect(suggestInterval(KM, 14_999)).toMatchObject({ point: 10_000, intervalValue: 10_000 })
  })

  it("no depende del orden en que vengan los intervalos; el índice es sobre la lista ordenada", () => {
    expect(suggestInterval([40_000, 10_000, 20_000], 40_000)).toEqual({ index: 2, intervalValue: 40_000, point: 40_000 })
  })

  it("si ningún intervalo mayor divide el punto, queda la base", () => {
    expect(suggestInterval([300, 700], 900)).toMatchObject({ intervalValue: 300, point: 900 })
    expect(suggestInterval([300, 700], 2_100)).toMatchObject({ intervalValue: 700 })
  })

  it("una pauta sin intervalos es un error de programación, no un resultado", () => {
    expect(() => suggestInterval([], 100)).toThrow("La pauta no tiene intervalos")
  })

  it("baseInterval es el menor", () => {
    expect(baseInterval([20_000, 10_000, 40_000])).toBe(10_000)
  })
})

function snapshot(): MantScheduleSnapshot {
  return {
    id: "s1",
    name: "Camiones",
    unit: "km",
    version: 1,
    intervals: [10_000, 20_000],
    groups: [
      { name: "Motor", items: [
        { key: "a", name: "Inspección general", applies: [true, true] },
        { key: "b", name: "Cambio de aceite", applies: [false, true] },
      ] },
      { name: "Frenos", items: [{ key: "c", name: "Revisión de pastillas", applies: [true, true] }] },
    ],
    brandRules: [
      { itemKey: "a", brandId: "scania", value: "X" },
      { itemKey: "b", brandId: "scania", value: "W" },
      { itemKey: "c", brandId: "man", value: "W" },
    ],
  }
}

describe("regla 5 · ítems de una preventiva", () => {
  it("muestra sólo los ítems que aplican en el intervalo elegido", () => {
    expect(checklistFor(snapshot(), 10_000, null).map((item) => item.key)).toEqual(["a", "c"])
    expect(checklistFor(snapshot(), 20_000, null).map((item) => item.key)).toEqual(["a", "b", "c"])
  })

  it("un intervalo que la pauta no tiene no produce ítems", () => {
    expect(checklistFor(snapshot(), 30_000, null)).toEqual([])
  })

  it("la regla X oculta el ítem para esa marca", () => {
    expect(checklistFor(snapshot(), 20_000, "scania").map((item) => item.key)).toEqual(["b", "c"])
  })

  it("la regla W lo muestra con el aviso «Confirmar con pauta del fabricante»", () => {
    const items = checklistFor(snapshot(), 20_000, "scania")
    expect(items.find((item) => item.key === "b")?.manufacturerWarning).toBe(true)
    expect(items.find((item) => item.key === "c")?.manufacturerWarning).toBe(false)
  })

  it("una marca fuera de la tabla, o sin marca, aplica todo sin avisos", () => {
    for (const brand of ["volvo", null]) {
      const items = checklistFor(snapshot(), 20_000, brand)
      expect(items.map((item) => item.key)).toEqual(["a", "b", "c"])
      expect(items.every((item) => !item.manufacturerWarning)).toBe(true)
    }
  })

  it("una regla sobre un ítem que no aplica en el intervalo no lo hace aparecer", () => {
    expect(checklistFor(snapshot(), 10_000, "scania").map((item) => item.key)).toEqual(["c"])
  })

  it("cada ítem lleva su sistema, en el orden de la pauta", () => {
    expect(checklistFor(snapshot(), 20_000, null).map((item) => item.group)).toEqual(["Motor", "Motor", "Frenos"])
  })

  it("groupChecklist agrupa por sistema conservando el orden de aparición", () => {
    const grouped = groupChecklist(checklistFor(snapshot(), 20_000, null))
    expect(grouped.map((entry) => [entry.group, entry.items.length])).toEqual([["Motor", 2], ["Frenos", 1]])
  })
})

describe("regla 15 · intervalo nuevo hereda la columna", () => {
  it("hereda la del MAYOR intervalo existente que lo divide", () => {
    expect(inheritedIntervalFor(KM, 30_000)).toBe(10_000)
    expect(inheritedIntervalFor(KM, 60_000)).toBe(20_000)
    expect(inheritedIntervalFor(KM, 120_000)).toBe(40_000)
    expect(inheritedIntervalFor(HORAS, 1_800)).toBe(900)
  })

  it("si ninguno lo divide, hereda la del intervalo base", () => {
    expect(inheritedIntervalFor(KM, 25_000)).toBe(10_000)
    expect(inheritedIntervalFor(KM, 5_000)).toBe(10_000)
    expect(inheritedIntervalFor(HORAS, 1_500)).toBe(300)
  })

  it("un valor que ya existe no se hereda a sí mismo", () => {
    expect(inheritedIntervalFor(KM, 40_000)).toBe(20_000)
    expect(inheritedIntervalFor([10_000], 10_000)).toBe(10_000)
  })

  it("no depende del orden de entrada", () => {
    expect(inheritedIntervalFor([160_000, 10_000, 40_000, 20_000, 80_000], 60_000)).toBe(20_000)
  })

  it("sin intervalos de los que heredar es un error de programación", () => {
    expect(() => inheritedIntervalFor([], 10_000)).toThrow()
  })
})

describe("checkItemResults", () => {
  const checklist: MantChecklistItem[] = [
    { key: "a", name: "Inspección general", group: "Motor", manufacturerWarning: false },
    { key: "b", name: "Cambio de aceite", group: "Motor", manufacturerWarning: true },
  ]

  it("acepta un valor por ítem; Realizado y No aplica no piden motivo", () => {
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "R" }, { itemKey: "b", value: "NA" }])).toEqual({ ok: true })
  })

  it("No realizado exige un motivo de 3 o más caracteres (sin contar espacios de los bordes)", () => {
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "R" }, { itemKey: "b", value: "NR", reason: "  " }]))
      .toEqual({ ok: false, message: "Falta el motivo de «Cambio de aceite» (no realizado)." })
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "R" }, { itemKey: "b", value: "NR", reason: "ab" }]).ok).toBe(false)
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "R" }, { itemKey: "b", value: "NR", reason: "Sin herramienta" }]).ok).toBe(true)
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "R" }, { itemKey: "b", value: "NR", reason: null }]).ok).toBe(false)
  })

  it("avisa qué ítem falta, con su sistema", () => {
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "R" }]))
      .toEqual({ ok: false, message: "Falta marcar «Cambio de aceite» (Motor)." })
  })

  it("rechaza ítems repetidos, valores inválidos e ítems de otra versión de la pauta", () => {
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "R" }, { itemKey: "a", value: "R" }]))
      .toEqual({ ok: false, message: "Hay ítems repetidos en la pauta." })
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "SI" }, { itemKey: "b", value: "R" }]))
      .toEqual({ ok: false, message: "Valor inválido en «Inspección general»." })
    expect(checkItemResults(checklist, [{ itemKey: "a", value: "R" }, { itemKey: "b", value: "R" }, { itemKey: "zzz", value: "R" }]))
      .toEqual({ ok: false, message: "La pauta enviada no corresponde a la versión usada." })
  })
})
