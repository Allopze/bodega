import { describe, expect, it } from "vitest"
import {
  assessEnrichmentCoverage,
  assessRunCompletion,
  assessRunReview,
  capaPriorityForCriticality,
  criticalityFromDanoPotencial,
  deriveFindings,
  fieldKindAcceptsPartial,
  resultBadgeVariant,
  summarizeCompliance,
  validateAnswerRow,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import { calculateCompliance } from "@/lib/sst/compliance"

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
    expect(capaPriorityForCriticality("critical")).toEqual({ priority: "critical", dueInDays: 3, requiresImmediateStop: true })
    expect(capaPriorityForCriticality("low")).toEqual({ priority: "low", dueInDays: 30, requiresImmediateStop: false })
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

  describe("'partial' (Regular, escala B/R/M) — H-04, AUDITORIA_BUGS_2026-08-05.md", () => {
    it("puntúa 0,5, no 0 ni 1: 8 buenos y 2 regulares de 10 dan 90%, no 80% ni 100%", () => {
      const items = Array.from({ length: 10 }, (_, i) => item({ itemId: `i${i}` }))
      const answers = [
        ...Array.from({ length: 8 }, (_, i) => answer({ itemId: `i${i}`, result: "conforming" as const })),
        ...Array.from({ length: 2 }, (_, i) => answer({ itemId: `i${i + 8}`, result: "partial" as const, comment: "Desgaste menor." })),
      ]
      const summary = summarizeCompliance(items, answers)
      expect(summary.partial).toBe(2)
      expect(summary.compliancePercent).toBe(90)
    })

    it("puntúa exactamente igual que el motor SST (lib/sst/compliance.ts) para el mismo Anexo B/R/M", () => {
      const items = Array.from({ length: 10 }, (_, i) => item({ itemId: `i${i}` }))
      const answers = [
        ...Array.from({ length: 8 }, (_, i) => answer({ itemId: `i${i}`, result: "conforming" as const })),
        ...Array.from({ length: 2 }, (_, i) => answer({ itemId: `i${i + 8}`, result: "partial" as const, comment: "Desgaste menor." })),
      ]
      const transversal = summarizeCompliance(items, answers).compliancePercent

      // Mismo checklist, evaluado por el motor SST con su propio vocabulario
      // (cumple/regular/no_cumple en vez de conforming/partial/non_conforming).
      const sstRespuestas = [
        ...Array.from({ length: 8 }, () => ({ estado: "cumple" as const })),
        ...Array.from({ length: 2 }, () => ({ estado: "regular" as const })),
      ]
      const sst = Math.round(calculateCompliance(sstRespuestas).percentage)

      expect(transversal).toBe(sst)
    })

    it("cuenta 'partial' aparte de cumple y no cumple", () => {
      const summary = summarizeCompliance(
        [item(), item({ itemId: "i2" }), item({ itemId: "i3" })],
        [answer(), answer({ itemId: "i2", result: "partial", comment: "Observación." }), answer({ itemId: "i3", result: "non_conforming" })],
      )
      expect(summary).toMatchObject({ conforming: 1, partial: 1, nonConforming: 1 })
    })
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

  it("un 'partial' (Regular) sin motivo bloquea, igual que 'no aplica'", () => {
    const result = assessRunCompletion([item()], [answer({ result: "partial" })])
    expect(result.blockers[0]?.kind).toBe("missing_partial_reason")
  })

  it("un 'partial' con motivo pasa", () => {
    const result = assessRunCompletion([item()], [answer({ result: "partial", comment: "Desgaste menor, aún operativo." })])
    expect(result.allowed).toBe(true)
  })
})

describe("estado 'partial' — qué ítems lo admiten y cómo se muestra", () => {
  it("sólo los tres tipos B/R/M admiten 'partial'", () => {
    expect(fieldKindAcceptsPartial("bueno_regular_malo_obs")).toBe(true)
    expect(fieldKindAcceptsPartial("bueno_regular_malo_na_obs")).toBe(true)
    expect(fieldKindAcceptsPartial("bueno_regular_malo_na_nt_obs")).toBe(true)
    expect(fieldKindAcceptsPartial("cumple_nocumple_obs")).toBe(false)
    expect(fieldKindAcceptsPartial(undefined)).toBe(false)
  })

  it("'partial' tiene su propia variante de badge, no cae al 'success' por defecto", () => {
    // H-04: antes de agregar 'partial' al mapeo, un estado no reconocido caía
    // al `else` de "success" (verde) por accidente — el bug de UI que el
    // hallazgo señala explícitamente.
    expect(resultBadgeVariant("partial")).not.toBe("success")
    expect(resultBadgeVariant("conforming")).toBe("success")
    expect(resultBadgeVariant("non_conforming")).toBe("danger")
    expect(resultBadgeVariant("not_applicable")).toBe("outline")
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

  /**
   * Medio y bajo NO bloquean, por decisión de Prevención: se evaluó exigirles
   * CAPA y se descartó al ver que la mayoría de lo que levanta una caminata cae
   * en moderado. El criterio vive en `CAPA_REQUIRED_CRITICALITIES`.
   */
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

describe("calibración de la plantilla", () => {
  it("marca como inerte una plantilla sin daño potencial declarado", () => {
    const coverage = assessEnrichmentCoverage([
      item({ danoPotencial: null }),
      item({ itemId: "i2", danoPotencial: null }),
    ])
    expect(coverage).toMatchObject({ totalItems: 2, withDanoPotencial: 0, criticalityInert: true })
  })

  it("no la marca inerte si al menos un ítem declara daño potencial", () => {
    const coverage = assessEnrichmentCoverage([item(), item({ itemId: "i2", danoPotencial: null })])
    expect(coverage).toMatchObject({ withDanoPotencial: 1, criticalityInert: false })
  })

  it("una plantilla vacía no se reporta como inerte", () => {
    expect(assessEnrichmentCoverage([]).criticalityInert).toBe(false)
  })
})

describe("detención inmediata separada del plazo administrativo", () => {
  it("un hallazgo crítico exige detener la tarea, con plazo de cierre alcanzable", () => {
    const result = capaPriorityForCriticality("critical")
    expect(result).toMatchObject({ priority: "critical", requiresImmediateStop: true })
    // La urgencia viaja como bandera; el plazo sigue siendo cumplible.
    expect(result.dueInDays).toBeGreaterThan(0)
  })

  it("ninguna otra criticidad exige detención", () => {
    for (const criticality of ["high", "medium", "low"]) {
      expect(capaPriorityForCriticality(criticality).requiresImmediateStop).toBe(false)
    }
  })

  it("el plazo crece a medida que baja la criticidad", () => {
    const days = ["critical", "high", "medium", "low"].map((c) => capaPriorityForCriticality(c).dueInDays)
    expect(days).toEqual([...days].sort((a, b) => a - b))
  })
})

// B-03 (auditoría 2026-08-18): la misma regla la aplican el servicio antes de
// escribir y el formulario antes de enviar. Antes la única guarda era el CHECK
// de Postgres, que reventaba el lote entero con un mensaje crudo.
describe("validación de una respuesta contra su ítem", () => {
  it("acepta una respuesta conforme sin comentario", () => {
    expect(validateAnswerRow(item(), answer())).toBeNull()
  })

  it("acepta 'no cumple' sin comentario: el motor no lo exige", () => {
    expect(validateAnswerRow(item(), answer({ result: "non_conforming" }))).toBeNull()
  })

  it("rechaza 'no aplica' sin motivo y nombra el ítem", () => {
    const problem = validateAnswerRow(item(), answer({ result: "not_applicable" }))
    expect(problem).toMatch(/exige indicar el motivo/)
    expect(problem).toContain("Extintor con carga vigente")
  })

  it("acepta 'no aplica' con motivo", () => {
    expect(validateAnswerRow(item(), answer({ result: "not_applicable", comment: "Retirado de servicio." }))).toBeNull()
  })

  it("un motivo de menos de 3 caracteres no cuenta", () => {
    expect(validateAnswerRow(item(), answer({ result: "not_applicable", comment: "ok" }))).toMatch(/motivo/)
  })

  it("espacios en blanco no cuentan como motivo", () => {
    expect(validateAnswerRow(item(), answer({ result: "not_applicable", comment: "   " }))).toMatch(/motivo/)
  })

  it("rechaza 'Regular' en un ítem que no es de escala B/R/M", () => {
    const problem = validateAnswerRow(item({ kind: "cumple_nocumple_na_obs" }), answer({ result: "partial", comment: "Desgaste." }))
    expect(problem).toMatch(/no admite la respuesta "Regular"/)
  })

  it("acepta 'Regular' con justificación en un ítem B/R/M", () => {
    expect(validateAnswerRow(
      item({ kind: "bueno_regular_malo_obs" }),
      answer({ result: "partial", comment: "Desgaste menor, aún operativo." }),
    )).toBeNull()
  })

  it("rechaza 'Regular' sin justificación aunque el ítem sea B/R/M", () => {
    expect(validateAnswerRow(
      item({ kind: "bueno_regular_malo_obs" }),
      answer({ result: "partial" }),
    )).toMatch(/justificarse por escrito/)
  })

  it("la escala manda sobre la justificación: un ítem que no admite Regular se rechaza por eso, no por el comentario", () => {
    expect(validateAnswerRow(item({ kind: "cumple_nocumple_na_obs" }), answer({ result: "partial" })))
      .toMatch(/no admite la respuesta "Regular"/)
  })
})
