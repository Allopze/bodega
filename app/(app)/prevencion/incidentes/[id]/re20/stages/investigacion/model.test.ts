import { describe, expect, it } from "vitest"
import { normalizeRe20Data } from "../../workspace-data"
import { blockingIssues, investigationProgress } from "./checks"
import {
  addAntecedent, createFinalEvent, derivedRelationType, causalIndex, humanizeCausalIssue, layoutCausalTree,
  linkEvents, removeEvent, treeIssues, unlinkEvents, withDerivedTypes, wrapLabel, wouldCreateCycle, type Re20Tree,
} from "./model"

const empty: Re20Tree = { events: [], relations: [] }

function build(): Re20Tree {
  let tree = createFinalEvent(empty, "El operador sufrió un corte")
  tree = addAntecedent(tree, "H1", { description: "La mano quedó en la zona de corte" }).tree // H2
  tree = addAntecedent(tree, "H2", { description: "El resguardo estaba retirado" }).tree // H3
  return tree
}

describe("tipo de relación derivado de la topología", () => {
  it("una consecuencia con un solo antecedente es cadena", () => {
    const tree = build()
    expect(tree.relations.map((r) => r.type)).toEqual(["chain", "chain"])
  })

  it("dos antecedentes del mismo hecho pasan a conjunción, sin que nadie lo elija", () => {
    let tree = build()
    tree = addAntecedent(tree, "H2", { description: "No había bloqueo de energía" }).tree // H4 → H2
    const into = tree.relations.filter((r) => r.to === "H2")
    expect(into).toHaveLength(2)
    expect(into.every((r) => r.type === "conjunction")).toBe(true)
  })

  it("un hecho con dos consecuencias es independiente", () => {
    let tree = build()
    tree = addAntecedent(tree, "H1", { description: "El operador no tenía guantes" }).tree // H4 → H1
    tree = linkEvents(tree, "H3", "H4")
    const out = tree.relations.filter((r) => r.from === "H3")
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.type)).toContain("independent")
  })

  it("al quitar una relación el tipo vuelve a calcularse", () => {
    let tree = build()
    tree = addAntecedent(tree, "H2", { description: "Otro antecedente" }).tree
    tree = unlinkEvents(tree, "H4", "H2")
    expect(tree.relations.find((r) => r.from === "H3")?.type).toBe("chain")
  })

  it("nunca produce un tipo que el dominio rechace", () => {
    let tree = build()
    tree = addAntecedent(tree, "H2", { description: "x" }).tree
    tree = linkEvents(tree, "H3", "H1")
    const types = withDerivedTypes(tree)
    expect(treeIssues(types).some((issue) => /relación no es consistente/.test(issue.text))).toBe(false)
  })

  it("derivedRelationType da prioridad a la conjunción", () => {
    const index = { into: new Map([["B", ["A", "C"]]]), out: new Map([["A", ["B", "D"]]]) }
    expect(derivedRelationType(index, "A", "B")).toBe("conjunction")
  })
})

describe("construcción", () => {
  it("rechaza ciclos y duplicados", () => {
    const tree = build()
    expect(wouldCreateCycle(tree, "H1", "H3")).toBe(true)
    expect(linkEvents(tree, "H1", "H3")).toBe(tree)
    expect(linkEvents(tree, "H3", "H2")).toBe(tree)
  })

  it("quitar un hecho borra sus relaciones", () => {
    const tree = removeEvent(build(), "H2")
    expect(tree.relations).toHaveLength(0)
    expect(causalIndex(tree).ids.has("H2")).toBe(false)
  })

  it("llega a 20 hechos y no más", () => {
    let tree = createFinalEvent(empty, "Final")
    for (let i = 0; i < 25; i++) tree = addAntecedent(tree, "H1", { description: `Hecho ${i}` }).tree
    expect(tree.events).toHaveLength(20)
  })
})

describe("pendientes en lenguaje humano", () => {
  it("traduce los mensajes del dominio y enlaza al campo", () => {
    expect(humanizeCausalIssue("Falta el hecho final H1 (lesión o daño).").fieldId).toBe("re20-investigacion-hecho-final")
    const reach = humanizeCausalIssue("H4: el hecho causal no conduce al hecho final H1.")
    expect(reach.text).toContain("H4 no llega hasta H1")
    expect(reach.fieldId).toBe("re20-investigacion-hecho-H4-description")
  })

  it("un árbol vacío pide H1; uno armado sólo con H1 pide una causa raíz", () => {
    expect(treeIssues(empty).length).toBeGreaterThan(0)
    expect(treeIssues(createFinalEvent(empty, "x")).some((i) => /causa raíz/.test(i.text))).toBe(true)
    expect(treeIssues(build())).toEqual([])
  })
})

describe("diagrama", () => {
  it("pone las causas raíz a la izquierda y H1 a la derecha", () => {
    const layout = layoutCausalTree(build())
    const x = Object.fromEntries(layout.nodes.map((n) => [n.id, n.x]))
    expect(x.H3).toBeLessThan(x.H2!)
    expect(x.H2).toBeLessThan(x.H1!)
    expect(layout.nodes.find((n) => n.id === "H3")?.role).toBe("root")
  })

  it("dibuja una compuerta por cada conjunción", () => {
    let tree = build()
    tree = addAntecedent(tree, "H2", { description: "otro" }).tree
    expect(layoutCausalTree(tree).gates).toHaveLength(1)
  })

  it("separa los hechos sin conectar y sirve con 1 y con 20 hechos", () => {
    const solo = layoutCausalTree(createFinalEvent(empty, "x"))
    expect(solo.nodes).toHaveLength(1)
    let tree = createFinalEvent(empty, "Final")
    for (let i = 0; i < 19; i++) tree = addAntecedent(tree, i === 0 ? "H1" : `H${i + 1}`, { description: `Hecho ${i}` }).tree
    const deep = layoutCausalTree(tree)
    expect(deep.nodes).toHaveLength(20)
    expect(deep.width).toBeGreaterThan(solo.width)
    const loose = layoutCausalTree({ events: [...tree.events, { id: "H20x", description: "suelto", verified: false, causal: true, requiresVerification: false }], relations: tree.relations })
    expect(loose.looseTop).not.toBeNull()
  })

  it("recorta las etiquetas largas", () => {
    const lines = wrapLabel("a".repeat(200) + " fin", 25, 3)
    expect(lines.length).toBeLessThanOrEqual(3)
    expect(lines.every((l) => l.length <= 25)).toBe(true)
  })
})

describe("progreso de la etapa", () => {
  const base = (extra: Record<string, unknown> = {}) => normalizeRe20Data(extra)
  const source = (data: ReturnType<typeof base>, eventType = "work_accident") => ({ incident: { eventType }, data })

  it("con el expediente vacío falta casi todo y los ids siguen la convención", () => {
    const progress = investigationProgress(source(base()))
    expect(progress.done).toBe(0)
    expect(progress.total).toBeGreaterThan(8)
    expect(progress.missing.every((m) => m.fieldId.startsWith("re20-investigacion-"))).toBe(true)
    expect(progress.missing.map((m) => m.fieldId)).toContain("re20-investigacion-conclusion")
  })

  it("lo que el servidor exige bloquea; lo demás no", () => {
    const labels = blockingIssues(source(base())).map((c) => c.label)
    expect(labels.some((l) => /hecho final H1/.test(l))).toBe(true)
    expect(labels).toContain("Conclusión del equipo investigador")
    expect(labels).not.toContain("Relato del evento en tercera persona")
  })

  it("pide medida por cada causa raíz, y responsable y verificador distintos", () => {
    const tree = build()
    const data = base({ causalTree: tree })
    expect(blockingIssues(source(data)).map((c) => c.label)).toContain("Una medida para la causa raíz H3")
    const withMeasure = base({
      causalTree: tree,
      measures: [{ id: "m1", rootCauseId: "H3", description: "Instalar bloqueo", controlType: "Ingeniería", responsibleUserId: "u1", verifierUserId: "u2", dueAt: "2026-11-01T12:00:00.000Z", effectiveness: {} }],
    })
    const labels = blockingIssues(source(withMeasure)).map((c) => c.label)
    expect(labels).not.toContain("Una medida para la causa raíz H3")
    expect(labels).not.toContain("Verificador de la medida 1")
  })

  it("un cuasi accidente leve no exige el árbol", () => {
    const labels = blockingIssues(source(base({ nearMiss: { potential: "Bajo" } }), "dangerous_incident")).map((c) => c.label)
    expect(labels.some((l) => /hecho final H1/.test(l))).toBe(false)
  })

  it("el progreso sube al completar el árbol", () => {
    const before = investigationProgress(source(base()))
    const after = investigationProgress(source(base({ causalTree: build() })))
    expect(after.done).toBeGreaterThan(before.done)
  })
})
