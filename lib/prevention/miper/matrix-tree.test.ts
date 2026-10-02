import { describe, expect, it } from "vitest"
import { buildMatrixTree, findTask, mostFrequent, taskKeyOf, type TreeContext } from "./matrix-tree"
import type { MiperEntrySnapshot } from "./snapshot"

const base: MiperEntrySnapshot = {
  id: "e", rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta",
  exposedFemale: 0, exposedMale: 2, exposedOther: 0, riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true,
  hazard: "H", risk: "R", probableDamage: "D", probability: 2, consequence: 4, magnitude: 8,
  classification: "important", controlledStatus: "no", controls: [],
}
const e = (overrides: Partial<MiperEntrySnapshot>): MiperEntrySnapshot => ({ ...base, ...overrides })
const ctx = (overrides: Partial<TreeContext> = {}): TreeContext => ({ incomplete: new Set(), observed: new Set(), modified: new Set(), matching: null, ...overrides })

describe("buildMatrixTree", () => {
  it("ordena actividades y tareas por el primer N° (orden RE-04), no alfabético", () => {
    const tree = buildMatrixTree([
      e({ id: "c", rowNumber: 3, activity: "Zeta", task: "T1" }),
      e({ id: "a", rowNumber: 1, activity: "Zeta", task: "T1" }),
      e({ id: "b", rowNumber: 2, activity: "Alfa", task: "T2" }),
    ], ctx())
    expect(tree.map((activity) => activity.label)).toEqual(["Zeta", "Alfa"])
    expect(tree[0]!.tasks[0]!.entries.map((entry) => entry.id)).toEqual(["a", "c"])
    expect(tree[0]!.tasks[0]!.lastRowNumber).toBe(3)
  })

  it("agrupa los nulos en «Sin actividad › Sin tarea» y la tarea se encuentra por su clave", () => {
    const tree = buildMatrixTree([e({ id: "x", activity: null, task: null })], ctx())
    expect(tree[0]!.label).toBe("Sin actividad")
    expect(tree[0]!.tasks[0]!.label).toBe("Sin tarea")
    expect(findTask(tree, taskKeyOf({ activity: null, task: null }))?.entries[0]!.id).toBe("x")
  })

  it("cuenta por clasificación, completos, observados y modificados; puestos sin repetir; máximo de expuestos", () => {
    const tree = buildMatrixTree([
      e({ id: "a", rowNumber: 1, classification: "important", position: "Conductor", exposedMale: 2 }),
      e({ id: "b", rowNumber: 2, classification: "tolerable", position: "conductor ", exposedMale: 5, exposedFemale: 1 }),
      e({ id: "c", rowNumber: 3, classification: "important", position: "Peoneta", exposedMale: 1 }),
    ], ctx({ incomplete: new Set(["a"]), observed: new Set(["b"]), modified: new Set(["b", "c"]) }))
    const task = tree[0]!.tasks[0]!
    expect(task.counts).toEqual({ tolerable: 1, moderate: 0, important: 2, intolerable: 0 })
    expect(task.complete).toBe(2)
    expect(task.observed).toBe(1)
    expect(task.modified).toBe(2)
    expect(task.positions).toEqual(["Conductor", "Peoneta"])
    expect(task.maxExposed).toBe(6)
    expect(tree[0]!.counts.important).toBe(2)
  })

  it("con filtro deja sólo tareas y actividades con coincidencias, sin perder los totales", () => {
    const tree = buildMatrixTree([
      e({ id: "a", rowNumber: 1, activity: "A1", task: "T1" }),
      e({ id: "b", rowNumber: 2, activity: "A1", task: "T2" }),
      e({ id: "c", rowNumber: 3, activity: "A2", task: "T3" }),
    ], ctx({ matching: new Set(["b"]) }))
    expect(tree).toHaveLength(1)
    expect(tree[0]!.tasks.map((task) => task.label)).toEqual(["T2"])
    expect(tree[0]!.entryCount).toBe(2)
    expect(tree[0]!.matchingCount).toBe(1)
    expect(tree[0]!.tasks[0]!.matching.map((entry) => entry.id)).toEqual(["b"])
  })
})

describe("taskKeyOf", () => {
  it("es estable ante mayúsculas, tildes y espacios, y separa actividad de tarea", () => {
    expect(taskKeyOf({ activity: "Gestión  Documental", task: "Trabajo" })).toBe(taskKeyOf({ activity: "gestion documental ", task: "TRABAJO" }))
    expect(taskKeyOf({ activity: "gestion", task: "documental trabajo" })).not.toBe(taskKeyOf({ activity: "gestion documental", task: "trabajo" }))
    expect(taskKeyOf({ activity: "A", task: "B" })).toMatch(/^[0-9a-z]+$/)
  })
})

describe("mostFrequent", () => {
  it("devuelve el más repetido, el primero en empate, e ignora nulos", () => {
    expect(mostFrequent(["a", "b", "b", null])).toBe("b")
    expect(mostFrequent(["a", "b"])).toBe("a")
    expect(mostFrequent([null])).toBeNull()
  })
})
