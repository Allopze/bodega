import { chileDateParts } from "@/lib/utils"
export const COMMITTEE_STATUS_LABELS: Record<string, string> = {
  active: "Vigente",
  dissolved: "Disuelto",
  expired: "Mandato vencido",
}

export const REPRESENTATION_LABELS: Record<string, string> = {
  company: "Representante de la empresa",
  workers: "Representante de las personas trabajadoras",
}

export const SEAT_LABELS: Record<string, string> = {
  titular: "Titular",
  suplente: "Suplente",
}

export const MEMBER_ROLE_LABELS: Record<string, string> = {
  presidente: "Presidente",
  secretario: "Secretario",
  integrante: "Integrante",
}

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  replaced: "Reemplazado",
  resigned: "Renunció",
}

/* Sin `held`: el CHECK ya no lo admite. La sesión va de convocada a acta
 * cerrada, o se cancela. */
export const COMMITTEE_MEETING_STATUS_LABELS: Record<string, string> = {
  scheduled: "Convocada",
  closed: "Acta cerrada",
  cancelled: "Cancelada",
}

export const MEETING_TYPE_LABELS: Record<string, string> = {
  ordinary: "Ordinaria",
  extraordinary: "Extraordinaria",
}

export const MANAGEMENT_REVIEW_STATUS_LABELS: Record<string, string> = {
  draft: "En preparación",
  closed: "Cerrada",
}

export function committeeStatusBadgeVariant(status: string): "success" | "warning" | "outline" {
  if (status === "active") return "success"
  if (status === "expired") return "warning"
  return "outline"
}

export interface CommitteeMemberRow {
  id: string
  representation: string
  seat: string
  role: string | null
  status: string
}

export interface ParityIssue {
  kind: "no_titulars" | "parity_mismatch" | "missing_role" | "duplicate_role"
    | "incomplete_legal_composition" | "missing_substitutes"
  detail: string
}

/**
 * Composición legal del CPHS según el **DS 44** (que incorporó esta materia y
 * derogó el DS 54 desde el 1 de febrero de 2025): tres representantes titulares
 * del empleador, tres de las personas trabajadoras, y un suplente por titular.
 */
export const CPHS_TITULARS_PER_REPRESENTATION = 3

export interface CommitteeCompositionAssessment {
  /** Compatibilidad: `valid` sigue significando "sin ningún hallazgo". */
  valid: boolean
  issues: ParityIssue[]
  /** El comité alcanza la composición reglamentaria completa (3+3 con suplentes). */
  legalCompositionComplete: boolean
  /** Hay paridad y al menos un titular: puede sesionar aunque falten cupos. */
  sessionQuorumValid: boolean
  /** Faltan integrantes respecto de la composición legal: hay que reemplazar. */
  vacanciesPendingReplacement: boolean
}

/**
 * Evalúa la composición del comité en TRES dimensiones que la ley distingue y
 * que antes se resolvían con una sola bandera de paridad:
 *
 * 1. **Composición legal** (DS 44): 3 titulares por representación y un suplente
 *    por titular. Un comité constituido con 1+1 y sin suplentes NO está
 *    legalmente constituido, aunque sea paritario.
 * 2. **Quórum de funcionamiento**: basta representación de ambas partes, así que
 *    un comité con vacancias sobrevinientes SIGUE pudiendo sesionar. Bloquearlo
 *    empujaría a registrar las sesiones fuera del sistema.
 * 3. **Vacancias pendientes**: faltan cupos respecto de la composición legal y
 *    corresponde iniciar el reemplazo.
 *
 * Un comité correctamente constituido que pierde un integrante queda con
 * `legalCompositionComplete = false`, `sessionQuorumValid = true` y
 * `vacanciesPendingReplacement = true`: incumplimiento visible, operación viva.
 */
export function assessCommitteeParity(members: CommitteeMemberRow[]): CommitteeCompositionAssessment {
  const active = members.filter((member) => member.status === "active")
  const titulars = active.filter((member) => member.seat === "titular")
  const substitutes = active.filter((member) => member.seat === "suplente")
  const companyTitulars = titulars.filter((member) => member.representation === "company").length
  const workerTitulars = titulars.filter((member) => member.representation === "workers").length
  const companySubstitutes = substitutes.filter((member) => member.representation === "company").length
  const workerSubstitutes = substitutes.filter((member) => member.representation === "workers").length
  const issues: ParityIssue[] = []

  if (titulars.length === 0) {
    issues.push({ kind: "no_titulars", detail: "El comité no tiene integrantes titulares activos." })
  } else if (companyTitulars !== workerTitulars) {
    issues.push({
      kind: "parity_mismatch",
      detail: `El comité no es paritario: ${companyTitulars} titular(es) de la empresa contra ${workerTitulars} de las personas trabajadoras.`,
    })
  }

  const expected = CPHS_TITULARS_PER_REPRESENTATION
  const titularsComplete = companyTitulars === expected && workerTitulars === expected
  if (titulars.length > 0 && !titularsComplete) {
    issues.push({
      kind: "incomplete_legal_composition",
      detail: `La composición legal exige ${expected} titulares por representación (DS 44); hay ${companyTitulars} de la empresa y ${workerTitulars} de las personas trabajadoras.`,
    })
  }

  const substitutesComplete = companySubstitutes >= companyTitulars && workerSubstitutes >= workerTitulars
  if (titulars.length > 0 && !substitutesComplete) {
    issues.push({
      kind: "missing_substitutes",
      detail: `Falta un suplente por cada titular: ${companySubstitutes} suplente(s) de la empresa para ${companyTitulars} titular(es), y ${workerSubstitutes} para ${workerTitulars}.`,
    })
  }

  for (const role of ["presidente", "secretario"] as const) {
    const holders = active.filter((member) => member.role === role)
    if (holders.length === 0) {
      issues.push({ kind: "missing_role", detail: `El comité no tiene ${role} designado.` })
    } else if (holders.length > 1) {
      issues.push({ kind: "duplicate_role", detail: `El comité tiene ${holders.length} personas designadas como ${role}.` })
    }
  }

  const legalCompositionComplete = titularsComplete && substitutesComplete
  return {
    valid: issues.length === 0,
    issues,
    legalCompositionComplete,
    // Sesiona con ambas representaciones presentes en el padrón, aunque falten
    // cupos: es la diferencia entre "no puede funcionar" y "debe recomponerse".
    sessionQuorumValid: companyTitulars > 0 && workerTitulars > 0,
    vacanciesPendingReplacement: titulars.length > 0 && !legalCompositionComplete,
  }
}

/**
 * Quórum del comité. La regla proviene del DS 54 art. 17, cuya materia quedó
 * incorporada al **DS 44** (vigente desde el 1 de febrero de 2025): «El Comité
 * Paritario de Higiene y Seguridad
 * podrá funcionar siempre que concurran un representante patronal y un
 * representante de los trabajadores».
 *
 * O sea: basta UNO por cada parte. **No hay exigencia de mayoría** — y el mismo
 * artículo lo confirma al resolver la asimetría por la vía de los votos y no del
 * quórum: «cuando a las sesiones no concurran todos los representantes
 * patronales o de los trabajadores, se entenderá que los asistentes disponen de
 * la totalidad de los votos de su respectiva representación».
 *
 * Exigir además mayoría de titulares —como se hizo en una primera pasada, por
 * criterio conservador y sin el texto a la vista— **bloqueaba sesiones que la
 * norma declara válidas**: un comité de 3+3 que junta 1+1, que es el caso
 * corriente, no habría podido cerrar acta. Un guard más estricto que la ley no
 * es más seguro: impide operar y empuja a registrar fuera del sistema.
 *
 * `required`/`effective` se conservan porque el acta los informa, pero **no
 * deciden** el quórum: lo decide `missingRepresentations`.
 *
 * El quórum se calcula sobre INTEGRANTES, no sobre filas de asistencia: un
 * invitado nunca lo altera. Un suplente presente cubre al titular ausente de su
 * misma representación, que es la razón de existir de la suplencia.
 */
export function assessQuorum(args: {
  members: CommitteeMemberRow[]
  attendedMemberIds: string[]
}): {
  reached: boolean
  required: number
  effective: number
  /** Representaciones sin ningún presente efectivo, para poder nombrarlas. */
  missingRepresentations: Array<"company" | "workers">
} {
  const active = args.members.filter((member) => member.status === "active")
  const titulars = active.filter((member) => member.seat === "titular")
  const attended = new Set(args.attendedMemberIds)
  const required = Math.ceil(titulars.length / 2)

  let effective = 0
  const missingRepresentations: Array<"company" | "workers"> = []
  for (const representation of ["company", "workers"] as const) {
    const ownTitulars = titulars.filter((member) => member.representation === representation)
    const presentTitulars = ownTitulars.filter((member) => attended.has(member.id)).length
    const presentSubstitutes = active.filter((member) =>
      member.seat === "suplente" && member.representation === representation && attended.has(member.id)).length
    const covered = presentTitulars + Math.min(ownTitulars.length - presentTitulars, presentSubstitutes)
    if (covered === 0) missingRepresentations.push(representation)
    effective += covered
  }

  return {
    // Concurriendo un representante de cada parte, el comité sesiona (regla del
    // DS 54 art. 17, hoy incorporada al DS 44).
    // `effective >= required` (mayoría) queda deliberadamente FUERA de la condición.
    reached: titulars.length > 0 && missingRepresentations.length === 0,
    required,
    effective,
    missingRepresentations,
  }
}

export interface MeetingCadenceStatus {
  /** Meses calendario transcurridos sin sesión cerrada. */
  monthsWithoutMeeting: number
  overdue: boolean
}

/**
 * El comité sesiona al menos una vez al mes. Sin sesión cerrada en el mes en
 * curso ni en el anterior, la cadencia se reporta vencida.
 */
export function assessMeetingCadence(lastClosedMeetingAt: string | null, asOf: string): MeetingCadenceStatus {
  if (!lastClosedMeetingAt) return { monthsWithoutMeeting: Number.POSITIVE_INFINITY, overdue: true }
  // Meses del calendario CHILENO. Con `getUTC*` una sesión del 1 de febrero a
  // las 21:00 de Chile se contaba como de febrero UTC y una evaluación del 31 de
  // marzo a las 21:00 como de abril: daba 2 meses y emitía un aviso falso de
  // "el comité no sesiona hace dos meses o más" con el comité al día.
  const last = chileDateParts(lastClosedMeetingAt)
  const now = chileDateParts(asOf)
  const months = (now.year - last.year) * 12 + (now.month - last.month)
  return { monthsWithoutMeeting: months, overdue: months >= 2 }
}

/** Un mandato vencido invalida al comité aunque su estado siga en `active`. */
export function isMandateExpired(mandateEndsOn: string, asOf: string) {
  return mandateEndsOn < asOf
}
