import { describe, expect, it } from "vitest"
import {
  assessRunCompletion,
  assessRunReview,
  capaPriorityForCriticality,
  criticalityFromDanoPotencial,
  deriveFindings,
  summarizeCompliance,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"

const item = (over: Partial<InspectionItemSpec> = {}): InspectionItemSpec => ({
  sectionId: "s1",
  itemId: "i1",
  label: "Extintor con carga vigente",
  required: true,
  countsForCompliance: true,
  danoPotencial: "grave",
  ...over,
})

const answer = (over: Partial<InspectionAnswerInput> = {}): InspectionAnswerInput => ({
  sectionId: "s1",
  itemId: "i1",
  result: "conforming",
  ...over,
})

describe("criticidad derivada del daño potencial", () => {
  it("mapea el daño potencial de la plantilla, no el criterio del ejecutante", () => {
    expect(criticalityFromDanoPotencial("fatal")).toBe("critical")
    expect(criticalityFromDanoPotencial("grave")).toBe("high")
    expect(criticalityFromDanoPotencial("moderado")).toBe("medium")
    expect(criticalityFromDanoPotencial("leve")).toBe("low")
  })

  it("un ítem sin daño potencial cae a media, como el default histórico del PDTP", () => {
    expect(criticalityFromDanoPotencial(null)).toBe("medium")
    expect(criticalityFromDanoPotencial(undefined)).toBe("medium")
  })

  it("la prioridad y el plazo de la CAPA siguen a la criticidad", () => {
    expect(capaPriorityForCriticality("critical")).toEqual({ priority: "critical", dueInDays: 3 })
    expect(capaPriorityForCriticality("low")).toEqual({ priority: "low", dueInDays: 30 })
  })
})

describe("cálculo de cumplimiento", () => {
  it("cuenta cumple, no cumple y no aplica por separado", () => {
    const summary = summarizeCompliance(
      [item(), item({ itemId: "i2" }), item({ itemId: "i3" })],
      [answer(), answer({ itemId: "i2", result: "non_conforming" }), answer({ itemId: "i3", result: "not_applicable", comment: "No hay equipo en el sector." })],
    )
    expect(summary).toMatchObject({ conforming: 1, nonConforming: 1, notApplicable: 1 })
  })

  it("excluye los 'no aplica' del denominador", () => {
    const summary = summarizeCompliance(
      [item(), item({ itemId: "i2" })],
      [answer(), answer({ itemId: "i2", result: "not_applicable", comment: "No corresponde." })],
    )
    // 1 de 1 evaluable, no 1 de 2.
    expect(summary.compliancePercent).toBe(100)
  })

  it("ignora los ítems que no cuentan para cumplimiento", () => {
    const summary = summarizeCompliance(
      [item(), item({ itemId: "i2", countsForCompliance: false })],
      [answer(), answer({ itemId: "i2", result: "non_conforming" })],
    )
    expect(summary.compliancePercent).toBe(100)
    expect(summary.nonConforming).toBe(1)
  })

  it("sin ítems evaluables devuelve null, no cero", () => {
    const summary = summarizeCompliance(
      [item({ countsForCompliance: false })],
      [answer({ result: "non_conforming" })],
    )
    expect(summary.compliancePercent).toBeNull()
  })

  it("calcula el porcentaje redondeado", () => {
    const items = [item(), item({ itemId: "i2" }), item({ itemId: "i3" })]
    const answers = [answer(), answer({ itemId: "i2" }), answer({ itemId: "i3", result: "non_conforming" })]
    expect(summarizeCompliance(items, answers).compliancePercent).toBe(67)
  })
})

describe("derivación de hallazgos", () => {
  it("genera un hallazgo por cada respuesta no conforme", () => {
    const findings = deriveFindings(
      [item(), item({ itemId: "i2", label: "Señalización visible", danoPotencial: "leve" })],
      [answer({ result: "non_conforming" }), answer({ itemId: "i2", result: "non_conforming" })],
    )
    expect(findings).toHaveLength(2)
    expect(findings[0]?.criticality).toBe("high")
    expect(findings[1]?.criticality).toBe("low")
  })

  it("no genera hallazgos por respuestas conformes o no aplicables", () => {
    const findings = deriveFindings(
      [item(), item({ itemId: "i2" })],
      [answer(), answer({ itemId: "i2", result: "not_applicable", comment: "No corresponde." })],
    )
    expect(findings).toEqual([])
  })

  it("incorpora el comentario del ejecutante a la descripción", () => {
    const findings = deriveFindings([item()], [answer({ result: "non_conforming", comment: "Manómetro en zona roja" })])
    expect(findings[0]?.description).toBe("Extintor con carga vigente: Manómetro en zona roja")
  })
})

describe("cierre de la ejecución", () => {
  it("bloquea declarar ejecutada con un ítem obligatorio sin responder", () => {
    const result = assessRunCompletion([item(), item({ itemId: "i2", label: "Acceso despejado" })], [answer()])
    expect(result.allowed).toBe(false)
    expect(result.blockers[0]).toMatchObject({ kind: "missing_required", detail: "Acceso despejado" })
  })

  it("un ítem opcional sin responder no bloquea cuando la plantilla sí declara obligatorios", () => {
    const result = assessRunCompletion(
      [item(), item({ itemId: "i2", required: false, countsForCompliance: false })],
      [answer()],
    )
    expect(result.allowed).toBe(true)
  })

  // El catálogo SST heredado no marca `required` en ningún ítem. Sin este piso
  // el gate quedaría inerte y una inspección vacía contaría como ejecutada.
  it("sin obligatorios declarados exige responder todo lo que cuenta para cumplimiento", () => {
    const items = [item({ required: false }), item({ itemId: "i2", required: false })]
    expect(assessRunCompletion(items, [answer()]).allowed).toBe(false)
    expect(assessRunCompletion(items, [answer(), answer({ itemId: "i2" })]).allowed).toBe(true)
  })

  it("sin obligatorios declarados, un ítem que no cuenta para cumplimiento sigue siendo opcional", () => {
    const items = [item({ required: false }), item({ itemId: "i2", required: false, countsForCompliance: false })]
    expect(assessRunCompletion(items, [answer()]).allowed).toBe(true)
  })

  it("un 'no aplica' sin motivo bloquea", () => {
    const result = assessRunCompletion([item()], [answer({ result: "not_applicable" })])
    expect(result.blockers[0]?.kind).toBe("missing_na_reason")
  })

  it("un 'no aplica' con motivo pasa", () => {
    const result = assessRunCompletion([item()], [answer({ result: "not_applicable", comment: "Equipo retirado de servicio." })])
    expect(result.allowed).toBe(true)
  })
})

describe("revisión independiente", () => {
  const finding = (over: Partial<{ id: string; description: string; criticality: string; capaActionId: string | null }> = {}) => ({
    id: "f1", description: "Extintor sin carga", criticality: "high", capaActionId: null, ...over,
  })

  it("bloquea que quien ejecutó revise su propia inspección", () => {
    const result = assessRunReview({ executedByUserId: "u1", reviewerUserId: "u1", findings: [] })
    expect(result.blockers[0]?.kind).toBe("executor_is_reviewer")
  })

  it("bloquea el cierre con un hallazgo alto o crítico sin CAPA", () => {
    const result = assessRunReview({ executedByUserId: "u1", reviewerUserId: "u2", findings: [finding()] })
    expect(result.allowed).toBe(false)
    expect(result.blockers[0]?.kind).toBe("critical_finding_without_capa")
  })

  it("permite cerrar cuando el hallazgo grave ya tiene CAPA", () => {
    const result = assessRunReview({ executedByUserId: "u1", reviewerUserId: "u2", findings: [finding({ capaActionId: "capa-1" })] })
    expect(result.allowed).toBe(true)
  })

  it("un hallazgo medio o bajo sin CAPA no bloquea el cierre", () => {
    const result = assessRunReview({
      executedByUserId: "u1", reviewerUserId: "u2",
      findings: [finding({ criticality: "medium" }), finding({ id: "f2", criticality: "low" })],
    })
    expect(result.allowed).toBe(true)
  })

  it("reporta todos los hallazgos graves sin CAPA, no sólo el primero", () => {
    const result = assessRunReview({
      executedByUserId: "u1", reviewerUserId: "u2",
      findings: [finding(), finding({ id: "f2", criticality: "critical", description: "Salida bloqueada" })],
    })
    expect(result.blockers).toHaveLength(2)
  })
})
