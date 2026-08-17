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
  detail: string
}

/**
 * Un Comité Paritario exige igual número de titulares por representación.
 * La cifra exacta de integrantes depende de la dotación del centro de trabajo
 * y la define Prevención; lo que el software sí puede sostener es la paridad
 * y la existencia de presidencia y secretaría.
 */
export function assessCommitteeParity(members: CommitteeMemberRow[]): { valid: boolean; issues: ParityIssue[] } {
  const active = members.filter((member) => member.status === "active")
  const titulars = active.filter((member) => member.seat === "titular")
  const companyTitulars = titulars.filter((member) => member.representation === "company").length
  const workerTitulars = titulars.filter((member) => member.representation === "workers").length
  const issues: ParityIssue[] = []

  if (titulars.length === 0) {
    issues.push({ kind: "no_titulars", detail: "El comité no tiene integrantes titulares activos." })
  } else if (companyTitulars !== workerTitulars) {
    issues.push({
      kind: "parity_mismatch",
      detail: `El comité no es paritario: ${companyTitulars} titular(es) de la empresa contra ${workerTitulars} de las personas trabajadoras.`,
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

  return { valid: issues.length === 0, issues }
}

/**
 * Quórum según el **DS 54 art. 17**: «El Comité Paritario de Higiene y Seguridad
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
    // DS 54 art. 17: concurriendo un representante de cada parte, el comité sesiona.
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
  const last = new Date(lastClosedMeetingAt)
  const now = new Date(asOf)
  const months = (now.getUTCFullYear() - last.getUTCFullYear()) * 12 + (now.getUTCMonth() - last.getUTCMonth())
  return { monthsWithoutMeeting: months, overdue: months >= 2 }
}

/** Un mandato vencido invalida al comité aunque su estado siga en `active`. */
export function isMandateExpired(mandateEndsOn: string, asOf: string) {
  return mandateEndsOn < asOf
}
