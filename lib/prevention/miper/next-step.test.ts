import { describe, expect, it } from "vitest"
import { nextStepFor, nextStepInView, type NextStep, type NextStepInput } from "./next-step"
import type { MiperEntrySnapshot } from "./snapshot"

const rows = [
  { id: "a", rowNumber: 1, classification: "moderate" },
  { id: "b", rowNumber: 2, classification: "important" },
] as MiperEntrySnapshot[]
const mode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canRespond: false, isSubmitter: false, readOnlyReason: null }
const input = (overrides: Partial<NextStepInput> = {}): NextStepInput => ({
  mode, status: "draft", reviewState: "none", hasOpenRound: false, hasPendingChanges: false, versionLabel: "sin versión aprobada",
  issues: [], openObservations: 0, rows, ...overrides,
})
const entryIssue = (entryId: string) => ({ scope: "entry" as const, entryId, field: "controls", message: "m", severity: "error" as const })

describe("nextStepFor", () => {
  it("1. solo lectura muestra el motivo, en todas las vistas", () => {
    expect(nextStepFor(input({ mode: { ...mode, canEdit: false, readOnlyReason: "Reemplazada por 2027" } }))).toMatchObject({ tone: "info", title: "Reemplazada por 2027", action: null, scope: "everywhere" })
  })
  it("2. quien envió la ronda espera la revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, isSubmitter: true }, hasOpenRound: true }))).toMatchObject({ title: "Enviaste esta ronda: la revisa otra persona.", scope: "root" })
  })
  it("3. el revisor parte por el riesgo más grave", () => {
    const step = nextStepFor(input({ mode: { ...mode, canEdit: false, canReviewTechnical: true }, hasOpenRound: true }))
    expect(step).toMatchObject({ title: "Revisa la versión enviada", action: { kind: "riesgo", entryId: "b", purpose: "review" }, scope: "root" })
    expect(step?.description).toBe("2 riesgos · 1 Importante o Intolerable")
  })
  it("3b. sin ronda abierta no hay nada que revisar: la regla del revisor no aplica", () => {
    expect(nextStepFor(input({ mode: { ...mode, canEdit: false, canReviewTechnical: true }, hasOpenRound: false }))).toBeNull()
  })
  it("4. con observaciones por responder lleva a Revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, canRespond: true }, reviewState: "observed", openObservations: 3 }))).toMatchObject({ title: "Responde 3 observaciones", action: { kind: "tab", tab: "revision" } })
    expect(nextStepFor(input({ mode: { ...mode, canRespond: true }, reviewState: "observed", openObservations: 1 }))?.title).toBe("Responde 1 observación")
  })
  it("5. los datos de cabecera van antes que los riesgos", () => {
    const step = nextStepFor(input({ issues: [{ scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" }, entryIssue("a")] }))
    expect(step).toMatchObject({ title: "Completa la ficha del documento (1 dato)", description: "Falta la fecha de elaboración.", action: { kind: "ficha" } })
  })
  it("5b. una matriz sin riesgos no manda a la ficha ni dice «lista para enviar»: no hay tarjeta (el estado vacío trae «Nueva tarea»)", () => {
    const empty = { scope: "header" as const, field: "entries", message: "La matriz no tiene registros de evaluación.", severity: "error" as const }
    expect(nextStepFor(input({ rows: [], issues: [empty] }))).toBeNull()
    const withHeader = nextStepFor(input({ rows: [], issues: [empty, { scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" }] }))
    expect(withHeader).toMatchObject({ title: "Completa la ficha del documento (1 dato)", action: { kind: "ficha" } })
  })
  it("6. faltan datos: al pendiente más grave, con el filtro como alternativa", () => {
    const step = nextStepFor(input({ issues: [entryIssue("a"), entryIssue("b"), entryIssue("b")] }))
    expect(step).toMatchObject({ tone: "warning", title: "Faltan datos en 2 riesgos", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: { kind: "filtro" } })
    expect(nextStepFor(input({ issues: [entryIssue("a")] }))?.title).toBe("Faltan datos en 1 riesgo")
  })
  it("7. sin errores en borrador: lista para enviar", () => {
    expect(nextStepFor(input())).toMatchObject({ tone: "success", title: "Lista para enviar a revisión", action: null })
  })
  it("8. vigente con cambios sin revisar", () => {
    expect(nextStepFor(input({ status: "published", hasPendingChanges: true, versionLabel: "v1", mode: { ...mode, canEdit: false } }))?.title).toBe("Hay cambios sin revisar desde v1")
  })
  it("9. sin nada que hacer no hay tarjeta", () => {
    expect(nextStepFor(input({ status: "published", mode: { ...mode, canEdit: false } }))).toBeNull()
  })
})

describe("nextStepInView", () => {
  const readOnly: NextStep = { tone: "info", title: "Reemplazada por 2027", description: "", action: null, secondary: null, scope: "everywhere" }
  const respond: NextStep = { tone: "warning", title: "Responde 3 observaciones", description: "d", action: { kind: "tab", tab: "revision" }, secondary: null, scope: "root" }
  const pending: NextStep = { tone: "warning", title: "Faltan datos en 2 riesgos", description: "d", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: { kind: "filtro", completitud: "pendientes" }, scope: "root" }

  it("un paso de alcance «everywhere» (el motivo de sólo lectura) se ve también en la tarea y en el editor", () => {
    expect(nextStepInView(readOnly, { atRoot: false, tab: "matriz" })).toBe(readOnly)
    expect(nextStepInView(readOnly, { atRoot: true, tab: "matriz" })).toBe(readOnly)
  })
  it("los de alcance «root», sólo en la raíz", () => {
    expect(nextStepInView(pending, { atRoot: false, tab: "matriz" })).toBeNull()
    expect(nextStepInView(pending, { atRoot: true, tab: "matriz" })).toBe(pending)
    expect(nextStepInView(null, { atRoot: true, tab: "matriz" })).toBeNull()
  })
  it("en Revisión no ofrece «Ir a Revisión», pero conserva el texto y las otras acciones", () => {
    expect(nextStepInView(respond, { atRoot: true, tab: "revision" })).toMatchObject({ title: "Responde 3 observaciones", action: null, secondary: null })
    expect(nextStepInView(respond, { atRoot: true, tab: "programa" })?.action).toEqual({ kind: "tab", tab: "revision" })
    expect(nextStepInView(pending, { atRoot: true, tab: "revision" })).toEqual(pending)
  })
  it("en Resumen no ofrece «Ver los pendientes»: la cifra «Riesgos completos» es su única representación (A1/A5)", () => {
    // El filtro del paso conserva `buscar`/`clasificacion`/…; la cifra del Resumen los limpia. Dos caminos al mismo subconjunto que llegan a listas distintas.
    expect(nextStepInView(pending, { atRoot: true, tab: "resumen" })).toMatchObject({ title: "Faltan datos en 2 riesgos", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: null })
    expect(nextStepInView(pending, { atRoot: true, tab: "matriz" })?.secondary).toEqual({ kind: "filtro", completitud: "pendientes" })
  })
})
