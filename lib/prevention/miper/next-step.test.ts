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
  it("1. solo lectura muestra el motivo", () => {
    expect(nextStepFor(input({ mode: { ...mode, canEdit: false, readOnlyReason: "Reemplazada por 2027" } }))).toMatchObject({ tone: "info", title: "Reemplazada por 2027", action: null })
  })
  it("2. quien envió la ronda espera la revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, isSubmitter: true }, hasOpenRound: true }))?.title).toBe("Enviaste esta ronda: la revisa otra persona.")
  })
  it("3. el revisor parte por el riesgo más grave", () => {
    const step = nextStepFor(input({ mode: { ...mode, canEdit: false, canReviewTechnical: true }, hasOpenRound: true }))
    expect(step).toMatchObject({ title: "Revisa la versión enviada", action: { kind: "riesgo", entryId: "b", purpose: "review" } })
    expect(step?.description).toBe("2 riesgos · 1 Importantes o Intolerables")
  })
  it("4. con observaciones por responder lleva a Revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, canRespond: true }, reviewState: "observed", openObservations: 3 }))).toMatchObject({ title: "Responde 3 observación(es)", action: { kind: "tab", tab: "revision" } })
  })
  it("5. los datos de cabecera van antes que los riesgos", () => {
    const step = nextStepFor(input({ issues: [{ scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" }, entryIssue("a")] }))
    expect(step).toMatchObject({ title: "Completa la ficha del documento (1 dato(s))", description: "Falta la fecha de elaboración.", action: { kind: "ficha" } })
  })
  it("5b. una matriz sin riesgos no manda a la ficha ni dice «lista para enviar»: no hay tarjeta (el estado vacío trae «Nueva tarea»)", () => {
    const empty = { scope: "header" as const, field: "entries", message: "La matriz no tiene registros de evaluación.", severity: "error" as const }
    expect(nextStepFor(input({ rows: [], issues: [empty] }))).toBeNull()
    // Con datos de cabecera pendientes, la ficha sigue primero, y sin contar «no tiene registros».
    const withHeader = nextStepFor(input({ rows: [], issues: [empty, { scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" }] }))
    expect(withHeader).toMatchObject({ title: "Completa la ficha del documento (1 dato(s))", action: { kind: "ficha" } })
  })
  it("6. faltan datos: al pendiente más grave, con el filtro como alternativa", () => {
    const step = nextStepFor(input({ issues: [entryIssue("a"), entryIssue("b"), entryIssue("b")] }))
    expect(step).toMatchObject({ tone: "warning", title: "Faltan datos en 2 riesgo(s)", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: { kind: "filtro" } })
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
  const readOnly: NextStep = { tone: "info", title: "Reemplazada por 2027", description: "", action: null, secondary: null }
  const respond: NextStep = { tone: "warning", title: "Responde 3 observación(es)", description: "d", action: { kind: "tab", tab: "revision" }, secondary: null }
  const pending: NextStep = { tone: "warning", title: "Faltan datos en 2 riesgo(s)", description: "d", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: { kind: "filtro", completitud: "pendientes" } }

  it("el motivo de sólo lectura se ve también en la tarea y en el editor", () => {
    expect(nextStepInView(readOnly, { atRoot: false, tab: "matriz", readOnly: true })).toBe(readOnly)
    expect(nextStepInView(readOnly, { atRoot: true, tab: "matriz", readOnly: true })).toBe(readOnly)
  })
  it("los demás pasos sólo en la raíz", () => {
    expect(nextStepInView(pending, { atRoot: false, tab: "matriz", readOnly: false })).toBeNull()
    expect(nextStepInView(pending, { atRoot: true, tab: "matriz", readOnly: false })).toBe(pending)
    expect(nextStepInView(null, { atRoot: true, tab: "matriz", readOnly: false })).toBeNull()
  })
  it("en Revisión no ofrece «Ir a Revisión», pero conserva el texto y las otras acciones", () => {
    expect(nextStepInView(respond, { atRoot: true, tab: "revision", readOnly: false })).toMatchObject({ title: "Responde 3 observación(es)", action: null, secondary: null })
    expect(nextStepInView(respond, { atRoot: true, tab: "programa", readOnly: false })?.action).toEqual({ kind: "tab", tab: "revision" })
    expect(nextStepInView(pending, { atRoot: true, tab: "revision", readOnly: false })).toEqual(pending)
  })
})
