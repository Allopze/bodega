/* Certificación de Comités Paritarios de Mutual de Seguridad CChC.
 *
 * El catálogo de requisitos vive en código y no en base porque lo fija el
 * manual de Mutual, no el usuario: es el mismo criterio con que las
 * definiciones de checklist viven en `lib/sst/definitions/*.ts`. Cambiar un
 * requisito es un cambio de versión del manual, y como tal se revisa en un
 * diff, no en una pantalla de administración.
 *
 * Bronce verifica el cumplimiento base de constitución y funcionamiento. Plata
 * y Oro se agregan a este mismo arreglo cuando corresponda; la estructura ya
 * los admite y nada del motor asume un solo nivel.
 */

export type CertificationLevel = "bronce" | "plata" | "oro"

export const CERTIFICATION_LEVEL_LABELS: Record<CertificationLevel, string> = {
  bronce: "Bronce",
  plata: "Plata",
  oro: "Oro",
}

export const DOSSIER_STATUS_LABELS: Record<string, string> = {
  draft: "En preparación",
  submitted: "Presentado a auditoría",
  certified: "Certificado",
  rejected: "Rechazado",
}

export const EVALUATION_STATUS_LABELS: Record<string, string> = {
  met: "Cumple",
  not_met: "No cumple",
  not_applicable: "No aplica",
}

/** Plazo que da Mutual para cerrar brechas tras la auditoría. */
export const GAP_CLOSURE_DAYS = 60

export interface CertificationEvidence {
  /** Comité vigente y con mandato al día. */
  committeeActive: boolean
  /** Registro del acta ante la Dirección del Trabajo. */
  dtRegisteredOn: string | null
  /** Paridad de titulares y unicidad de cargos, desde `assessCommitteeParity`. */
  parityValid: boolean
  parityIssues: string[]
  hasPresident: boolean
  hasSecretary: boolean
  hasFuero: boolean
  activeMembers: number
  /** Meses del período con al menos un acta cerrada, y meses transcurridos. */
  monthsWithClosedMeeting: number
  monthsElapsed: number
  agreementsTotal: number
  agreementsWithCapa: number
  /** Programa de trabajo del año, aprobado y con actividades. */
  programActive: boolean
  programActivities: number
  /** Incidentes del período y cuántos tienen investigación cerrada. */
  incidentsTotal: number
  incidentsInvestigated: number
  /* ── Evidencia adicional de los niveles Plata y Oro ── */
  /** Meses del período con al menos una inspección completada en la faena. */
  monthsWithInspection: number
  /** Meses con inspección originada por el propio comité. */
  monthsWithCommitteeInspection: number
  /** Revisiones de la matriz MIPER del período y cuántas registran la sesión del comité. */
  iperRevisionsTotal: number
  iperRevisionsWithCommittee: number
  /** Sesiones del período y cuántas enviaron la tabla antes de sesionar. */
  meetingsInPeriod: number
  meetingsWithAgendaSent: number
  /** Meses del período con al menos un invitado no integrante. */
  monthsWithGuest: number
  /** Actas cerradas del período y cuántas se remitieron a la administración. */
  closedMeetingsInPeriod: number
  minutesSentToManagement: number
  /** Comisiones activas con al menos un integrante asignado. */
  activeCommissions: number
  /** Plano de riesgos vigente de la faena y cuántos marcadores tiene. */
  riskMapActive: boolean
  riskMapMarkerCount: number
}

export interface RequirementOutcome {
  met: boolean
  detail: string
}

export type RequirementCheck =
  | { kind: "auto"; evaluate: (evidence: CertificationEvidence) => RequirementOutcome }
  | { kind: "manual" }

export interface CertificationRequirement {
  code: string
  level: CertificationLevel
  title: string
  description: string
  check: RequirementCheck
}

const auto = (evaluate: (evidence: CertificationEvidence) => RequirementOutcome): RequirementCheck =>
  ({ kind: "auto", evaluate })

export const CERTIFICATION_REQUIREMENTS: readonly CertificationRequirement[] = [
  {
    code: "committee_constituted",
    level: "bronce",
    title: "Comité constituido y vigente",
    description: "Existe un Comité Paritario constituido, con mandato vigente, en el centro de trabajo.",
    check: auto((evidence) => evidence.committeeActive
      ? { met: true, detail: `Comité vigente con ${evidence.activeMembers} integrantes activos.` }
      : { met: false, detail: "El comité no está vigente o su mandato ya venció." }),
  },
  {
    code: "dt_registered",
    level: "bronce",
    title: "Acta de constitución registrada ante la Dirección del Trabajo",
    description: "El acta de constitución fue registrada y existe comprobante verificable.",
    check: auto((evidence) => evidence.dtRegisteredOn
      ? { met: true, detail: `Registrada el ${evidence.dtRegisteredOn}.` }
      : { met: false, detail: "No hay fecha ni folio de registro ante la Dirección del Trabajo." }),
  },
  {
    // El `code` se conserva por compatibilidad con los expedientes ya
    // presentados, pero el requisito evalúa la COMPOSICIÓN LEGAL completa del
    // DS 44 (3 titulares por parte + un suplente por titular), no sólo que los
    // dos lados tengan el mismo número: un comité de 1+1 era paritario y no
    // está legalmente constituido.
    code: "parity_valid",
    level: "bronce",
    title: "Composición legal del comité",
    description: "Tres titulares por representación y un suplente por titular, conforme al DS 44.",
    check: auto((evidence) => evidence.parityValid
      ? { met: true, detail: "La composición del comité cumple lo exigido por el DS 44." }
      : { met: false, detail: evidence.parityIssues.join(" ") || "El comité no cumple la composición exigida." }),
  },
  {
    code: "roles_assigned",
    level: "bronce",
    title: "Presidente y secretario designados",
    description: "El comité designó presidencia y secretaría entre sus integrantes.",
    check: auto((evidence) => {
      const missing = [
        evidence.hasPresident ? null : "presidente",
        evidence.hasSecretary ? null : "secretario",
      ].filter(Boolean)
      return missing.length === 0
        ? { met: true, detail: "Presidencia y secretaría designadas." }
        : { met: false, detail: `Falta designar ${missing.join(" y ")}.` }
    }),
  },
  {
    code: "fuero_declared",
    level: "bronce",
    title: "Representante con fuero identificado",
    description: "Está identificado el representante de las personas trabajadoras que goza de fuero.",
    check: auto((evidence) => evidence.hasFuero
      ? { met: true, detail: "Hay un integrante con fuero declarado." }
      : { met: false, detail: "Ningún integrante activo tiene fuero declarado." }),
  },
  {
    code: "monthly_meetings",
    level: "bronce",
    title: "Reuniones mensuales",
    description: "El comité sesiona al menos una vez al mes y cierra el acta correspondiente.",
    check: auto((evidence) => {
      if (evidence.monthsElapsed === 0) {
        return { met: false, detail: "El período auditado todavía no registra meses cumplidos." }
      }
      const met = evidence.monthsWithClosedMeeting >= evidence.monthsElapsed
      return {
        met,
        detail: `${evidence.monthsWithClosedMeeting} de ${evidence.monthsElapsed} meses del período con acta cerrada.`,
      }
    }),
  },
  {
    code: "agreements_tracked",
    level: "bronce",
    title: "Actas con acuerdos y seguimiento",
    description: "Los acuerdos quedan registrados con responsable, plazo y evidencia.",
    check: auto((evidence) => {
      if (evidence.agreementsTotal === 0) {
        return { met: false, detail: "El período no registra acuerdos en actas." }
      }
      const met = evidence.agreementsWithCapa === evidence.agreementsTotal
      return {
        met,
        detail: `${evidence.agreementsWithCapa} de ${evidence.agreementsTotal} acuerdos con acción trazable.`,
      }
    }),
  },
  {
    code: "orientation_training",
    level: "bronce",
    title: "Orientación en prevención de riesgos",
    description: "Los integrantes cuentan con la orientación en prevención de riesgos vigente.",
    /*
     * Manual desde el 2026-09-19. Se verificaba sola contra la competencia
     * vigente de cada integrante, y ese registro se retiró con el modelo de
     * capacitación por persona. El requisito de Mutual no cambió —la
     * orientación se sigue exigiendo—, lo que cambió es que la plataforma ya no
     * puede medirlo, y declararlo manual es preferible a fingir una medición
     * que no existe.
     */
    check: { kind: "manual" },
  },
  {
    code: "work_program",
    level: "bronce",
    title: "Programa de trabajo del comité",
    description: "El comité cuenta con un programa de trabajo aprobado, con actividades y plazos.",
    check: auto((evidence) => evidence.programActive && evidence.programActivities > 0
      ? { met: true, detail: `Programa aprobado con ${evidence.programActivities} actividades.` }
      : { met: false, detail: "No hay programa de trabajo aprobado con actividades para el período." }),
  },
  {
    code: "event_investigation",
    level: "bronce",
    title: "Investigación de accidentes e incidentes",
    description: "El comité participa en la investigación de los eventos ocurridos en el período.",
    check: auto((evidence) => {
      if (evidence.incidentsTotal === 0) {
        return { met: true, detail: "El período no registra eventos que investigar." }
      }
      const met = evidence.incidentsInvestigated >= evidence.incidentsTotal
      return {
        met,
        detail: `${evidence.incidentsInvestigated} de ${evidence.incidentsTotal} eventos con investigación cerrada.`,
      }
    }),
  },
  {
    code: "serious_risk_communication",
    level: "bronce",
    title: "Comunicación de riesgo grave e inminente",
    description: "Existe un procedimiento difundido para comunicar y actuar ante riesgo grave e inminente.",
    // Manual: el respaldo es un documento difundido, no un estado del sistema.
    check: { kind: "manual" },
  },

  /* ── Plata ────────────────────────────────────────────────────────────────
   * Buenas prácticas sobre el cumplimiento Bronce. Lo que la plataforma puede
   * verificar sola se declara `auto`; el resto queda manual en vez de fingir
   * una medición que no existe.
   */
  {
    code: "extended_training",
    level: "plata",
    title: "Capacitación ampliada de los integrantes",
    description: "Curso de 20 horas, Árbol de Causas e IPER declarados como exigibles y vigentes en los integrantes.",
    // Manual por el mismo motivo que `orientation_training`.
    check: { kind: "manual" },
  },
  {
    code: "monthly_inspections",
    level: "plata",
    title: "Inspecciones mensuales",
    description: "Se realizan inspecciones formales todos los meses del período y quedan registradas.",
    check: auto((evidence) => {
      if (evidence.monthsElapsed === 0) {
        return { met: false, detail: "El período auditado todavía no registra meses cumplidos." }
      }
      const met = evidence.monthsWithInspection >= evidence.monthsElapsed
      return {
        met,
        detail: `${evidence.monthsWithInspection} de ${evidence.monthsElapsed} meses con inspección registrada.`,
      }
    }),
  },
  {
    code: "committee_inspections",
    level: "plata",
    title: "Inspecciones del propio comité",
    description: "El comité realiza sus propias inspecciones, distintas de las del Departamento de Prevención.",
    check: auto((evidence) => evidence.monthsWithCommitteeInspection > 0
      ? { met: true, detail: `${evidence.monthsWithCommitteeInspection} mes(es) con inspección originada por el comité.` }
      : { met: false, detail: "El período no registra inspecciones con origen en el comité paritario." }),
  },
  {
    code: "agenda_sent_in_advance",
    level: "plata",
    title: "Tabla enviada antes de la sesión",
    description: "La tabla de cada sesión se envía a los integrantes con anticipación.",
    check: auto((evidence) => {
      if (evidence.meetingsInPeriod === 0) {
        return { met: false, detail: "El período no registra sesiones convocadas." }
      }
      const met = evidence.meetingsWithAgendaSent >= evidence.meetingsInPeriod
      return { met, detail: `${evidence.meetingsWithAgendaSent} de ${evidence.meetingsInPeriod} sesiones con tabla enviada previamente.` }
    }),
  },
  {
    code: "commissions",
    level: "plata",
    title: "Comisiones de trabajo",
    description: "El comité se organiza en comisiones con propósito e integrantes asignados.",
    check: auto((evidence) => evidence.activeCommissions > 0
      ? { met: true, detail: `${evidence.activeCommissions} comisión(es) activa(s) con integrantes asignados.` }
      : { met: false, detail: "El comité no tiene comisiones con integrantes asignados." }),
  },
  {
    code: "guest_participation",
    level: "plata",
    title: "Invitación mensual a una persona trabajadora",
    description: "Cada mes participa en la sesión una persona trabajadora que no integra el comité.",
    check: auto((evidence) => {
      if (evidence.monthsElapsed === 0) {
        return { met: false, detail: "El período auditado todavía no registra meses cumplidos." }
      }
      const met = evidence.monthsWithGuest >= evidence.monthsElapsed
      return { met, detail: `${evidence.monthsWithGuest} de ${evidence.monthsElapsed} meses con invitado no integrante.` }
    }),
  },
  {
    code: "shared_safety_action",
    level: "plata",
    title: "Acción de seguridad compartida trimestral",
    description: "Se realiza una acción de seguridad conjunta al menos una vez por trimestre.",
    check: { kind: "manual" },
  },

  /* ── Oro ──────────────────────────────────────────────────────────────── */
  {
    code: "iper_committee_participation",
    level: "oro",
    title: "Participación del comité en la IPER",
    description: "Las revisiones de la matriz de riesgos registran la sesión del comité que participó.",
    check: auto((evidence) => {
      if (evidence.iperRevisionsTotal === 0) {
        return { met: false, detail: "El período no registra revisiones de la matriz MIPER." }
      }
      const met = evidence.iperRevisionsWithCommittee > 0
      return {
        met,
        detail: `${evidence.iperRevisionsWithCommittee} de ${evidence.iperRevisionsTotal} revisiones con sesión del comité declarada.`,
      }
    }),
  },
  {
    code: "minutes_to_management",
    level: "oro",
    title: "Envío mensual de actas a la alta administración",
    description: "Las actas se remiten mensualmente a la administración superior y queda respaldo.",
    check: auto((evidence) => {
      if (evidence.closedMeetingsInPeriod === 0) {
        return { met: false, detail: "El período no registra actas cerradas." }
      }
      const met = evidence.minutesSentToManagement >= evidence.closedMeetingsInPeriod
      return { met, detail: `${evidence.minutesSentToManagement} de ${evidence.closedMeetingsInPeriod} actas remitidas a la administración.` }
    }),
  },
  {
    code: "risk_map",
    level: "oro",
    title: "Mapa de riesgos visible y actualizado",
    description: "Existe un mapa de riesgos por área, visible y mantenido al día.",
    check: auto((evidence) => evidence.riskMapActive && evidence.riskMapMarkerCount > 0
      ? { met: true, detail: `Plano vigente con ${evidence.riskMapMarkerCount} peligro(s) ubicado(s).` }
      : { met: false, detail: "La faena no tiene un plano de riesgos vigente con al menos un peligro ubicado." }),
  },
  {
    code: "road_safety",
    level: "oro",
    title: "Actividades de seguridad vial",
    description: "El comité impulsa actividades de seguridad vial acordes a la operación.",
    check: { kind: "manual" },
  },
  {
    code: "recognitions",
    level: "oro",
    title: "Reconocimiento anual de buenas prácticas",
    description: "Se realiza un reconocimiento anual a las buenas prácticas preventivas.",
    check: { kind: "manual" },
  },
]

export function requirementsForLevel(level: CertificationLevel): CertificationRequirement[] {
  return CERTIFICATION_REQUIREMENTS.filter((requirement) => requirement.level === level)
}

export function findRequirement(code: string): CertificationRequirement | undefined {
  return CERTIFICATION_REQUIREMENTS.find((requirement) => requirement.code === code)
}

export interface EvaluatedRequirement {
  code: string
  title: string
  description: string
  source: "auto" | "manual"
  status: "met" | "not_met" | "not_applicable"
  detail: string
  evidenceReference: string | null
}

/**
 * Evalúa el nivel completo. Los requisitos automáticos se resuelven contra la
 * evidencia del sistema; los manuales conservan lo que alguien haya declarado,
 * y sin declaración quedan como no cumplidos — que es la lectura honesta para
 * una auditoría, no un "cumple" por omisión.
 */
export function evaluateLevel(
  level: CertificationLevel,
  evidence: CertificationEvidence,
  manual: ReadonlyMap<string, {
    status: "met" | "not_met" | "not_applicable"
    detail: string
    evidenceReference?: string | null
  }>,
): EvaluatedRequirement[] {
  return requirementsForLevel(level).map((requirement) => {
    if (requirement.check.kind === "auto") {
      const outcome = requirement.check.evaluate(evidence)
      return {
        code: requirement.code,
        title: requirement.title,
        description: requirement.description,
        source: "auto" as const,
        status: outcome.met ? ("met" as const) : ("not_met" as const),
        detail: outcome.detail,
        evidenceReference: null,
      }
    }

    const declared = manual.get(requirement.code)
    return {
      code: requirement.code,
      title: requirement.title,
      description: requirement.description,
      source: "manual" as const,
      status: declared?.status ?? ("not_met" as const),
      detail: declared?.detail ?? "Sin evidencia declarada.",
      evidenceReference: declared?.evidenceReference ?? null,
    }
  })
}

export function summarizeEvaluation(requirements: EvaluatedRequirement[]) {
  const applicable = requirements.filter((item) => item.status !== "not_applicable")
  const met = applicable.filter((item) => item.status === "met").length
  return {
    total: requirements.length,
    applicable: applicable.length,
    met,
    gaps: applicable.length - met,
    readyToSubmit: applicable.length > 0 && met === applicable.length,
  }
}
