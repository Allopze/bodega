import { describe, expect, it } from "vitest"
import { nextStepFor, type NextStepInput } from "./next-step"
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
    expect(step).toMatchObject({ title: "Revisa la versión enviada", action: { kind: "riesgo", entryId: "b" } })
    expect(step?.description).toBe("2 riesgos · 1 Importantes o Intolerables")
  })
  it("4. con observaciones por responder lleva a Revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, canRespond: true }, reviewState: "observed", openObservations: 3 }))).toMatchObject({ title: "Responde 3 observación(es)", action: { kind: "tab", tab: "revision" } })
  })
  it("5. los datos de cabecera van antes que los riesgos", () => {
    const step = nextStepFor(input({ issues: [{ scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" }, entryIssue("a")] }))
    expect(step).toMatchObject({ title: "Completa la ficha del documento (1 dato(s))", description: "Falta la fecha de elaboración.", action: { kind: "ficha" } })
  })
  it("6. faltan datos: al pendiente más grave, con el filtro como alternativa", () => {
    const step = nextStepFor(input({ issues: [entryIssue("a"), entryIssue("b"), entryIssue("b")] }))
    expect(step).toMatchObject({ tone: "warning", title: "Faltan datos en 2 riesgo(s)", action: { kind: "riesgo", entryId: "b" }, secondary: { kind: "filtro" } })
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
