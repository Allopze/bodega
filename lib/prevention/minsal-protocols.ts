/**
 * Catálogo de protocolos de vigilancia del MINSAL.
 *
 * Es una constante, no una tabla: son ocho protocolos que cambian cuando
 * cambia una resolución del ministerio, o sea cuando alguien despliega. Darles
 * CRUD sería mantener una pantalla de administración para un catálogo que nadie
 * de la empresa puede modificar legítimamente.
 *
 * El protocolo es **ortogonal al tipo de agente** de `preventionExposureAgents`
 * (PREXOR es físico, sílice químico, psicosocial psicosocial), así que se
 * clasifica en paralelo sin tocar el check de `agentType`.
 *
 * Motivación: hoy el protocolo es texto libre en dos columnas y el hint de la
 * UI dice literalmente "Ej: PREXOR, CEAL-SM, vigilancia sílice". Con texto
 * libre no se puede responder la pregunta que hace el fiscalizador, que no es
 * "¿qué agentes mides?" sino "muéstreme su PREXOR".
 */

export interface MinsalProtocol {
  code: string
  name: string
  shortName: string
  legalBasis: string
  /** Periodicidad de reevaluación sugerida, en meses. */
  defaultPeriodicityMonths: number
  /** Tipo de agente con el que suele emparejarse, sólo como ayuda de la UI. */
  agentTypeHint: "chemical" | "physical" | "biological" | "ergonomic" | "psychosocial"
}

export const MINSAL_PROTOCOLS: readonly MinsalProtocol[] = [
  {
    code: "prexor",
    name: "Protocolo de exposición ocupacional a ruido",
    shortName: "PREXOR",
    legalBasis: "Res. Ex. 1433/2022 MINSAL · DS 594 art. 70",
    defaultPeriodicityMonths: 12,
    agentTypeHint: "physical",
  },
  {
    code: "psicosocial",
    name: "Protocolo de vigilancia de riesgos psicosociales en el trabajo",
    shortName: "CEAL-SM / SUSESO",
    legalBasis: "Res. Ex. 1448/2022 MINSAL · Circular SUSESO",
    defaultPeriodicityMonths: 24,
    agentTypeHint: "psychosocial",
  },
  {
    code: "silice",
    name: "Plan Nacional de Erradicación de la Silicosis (PLANESI)",
    shortName: "Sílice",
    legalBasis: "PLANESI · DS 594 art. 66",
    defaultPeriodicityMonths: 12,
    agentTypeHint: "chemical",
  },
  {
    code: "citostaticos",
    name: "Protocolo de vigilancia para trabajadores expuestos a citostáticos",
    shortName: "Citostáticos",
    legalBasis: "Norma técnica MINSAL",
    defaultPeriodicityMonths: 12,
    agentTypeHint: "chemical",
  },
  {
    code: "hiperbaria",
    name: "Protocolo de vigilancia para trabajos en ambientes hiperbáricos",
    shortName: "Hiperbaria",
    legalBasis: "DS 3/1985 MINSAL",
    defaultPeriodicityMonths: 12,
    agentTypeHint: "physical",
  },
  {
    code: "frio_calor",
    name: "Protocolo de vigilancia para exposición a frío y calor",
    shortName: "Frío / calor",
    legalBasis: "DS 594 arts. 96-99 · norma técnica MINSAL",
    defaultPeriodicityMonths: 12,
    agentTypeHint: "physical",
  },
  {
    code: "uv",
    name: "Protocolo de radiación ultravioleta de origen solar",
    shortName: "UV solar",
    legalBasis: "Ley 20.096 · DS 594 art. 109 bis",
    defaultPeriodicityMonths: 12,
    agentTypeHint: "physical",
  },
  {
    code: "tmert",
    name: "Norma técnica de identificación y evaluación de factores de riesgo de TMERT-EESS",
    shortName: "TMERT-EESS",
    legalBasis: "Res. Ex. 804/2012 MINSAL · DS 594 art. 110 a.1",
    defaultPeriodicityMonths: 12,
    agentTypeHint: "ergonomic",
  },
] as const

export const MINSAL_PROTOCOL_CODES = MINSAL_PROTOCOLS.map((protocol) => protocol.code)

export const MINSAL_PROTOCOL_LABELS: Record<string, string> = Object.fromEntries(
  MINSAL_PROTOCOLS.map((protocol) => [protocol.code, protocol.shortName]),
)

export function findMinsalProtocol(code: string): MinsalProtocol | undefined {
  return MINSAL_PROTOCOLS.find((protocol) => protocol.code === code)
}

export const PROTOCOL_APPLICABILITY_STATUSES = ["applicable", "not_applicable", "pending_assessment"] as const
export type ProtocolApplicabilityStatus = typeof PROTOCOL_APPLICABILITY_STATUSES[number]

export const PROTOCOL_APPLICABILITY_LABELS: Record<ProtocolApplicabilityStatus, string> = {
  applicable: "Aplicable",
  not_applicable: "No aplicable",
  pending_assessment: "Por evaluar",
}

export interface ProtocolApplicabilityRow {
  protocolCode: string
  status: string
  nextAssessmentOn?: string | null
}

export interface ProtocolCoverage {
  code: string
  shortName: string
  name: string
  legalBasis: string
  status: ProtocolApplicabilityStatus
  nextAssessmentOn: string | null
  overdue: boolean
}

/**
 * Cruza el catálogo con lo declarado por la faena.
 *
 * Un protocolo sin fila es `pending_assessment`, no "no aplica": la diferencia
 * es justo lo que se sanciona — descartar un protocolo exige justificarlo, no
 * omitirlo.
 */
export function summarizeProtocolCoverage(
  rows: readonly ProtocolApplicabilityRow[],
  today: string,
): ProtocolCoverage[] {
  const byCode = new Map(rows.map((row) => [row.protocolCode, row]))
  return MINSAL_PROTOCOLS.map((protocol) => {
    const row = byCode.get(protocol.code)
    const status = (row?.status ?? "pending_assessment") as ProtocolApplicabilityStatus
    const nextAssessmentOn = row?.nextAssessmentOn ?? null
    return {
      code: protocol.code,
      shortName: protocol.shortName,
      name: protocol.name,
      legalBasis: protocol.legalBasis,
      status,
      nextAssessmentOn,
      // Sólo un protocolo aplicable puede estar vencido: uno descartado con
      // justificación no tiene reloj corriendo.
      overdue: status === "applicable" && nextAssessmentOn !== null && nextAssessmentOn < today,
    }
  })
}

/** Cuántos protocolos quedan sin pronunciamiento. Es el número que mira la DT. */
export function countUnassessedProtocols(coverage: readonly ProtocolCoverage[]): number {
  return coverage.filter((item) => item.status === "pending_assessment").length
}
