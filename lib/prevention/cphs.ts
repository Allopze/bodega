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

export const COMMITTEE_MEETING_STATUS_LABELS: Record<string, string> = {
  scheduled: "Convocada",
  held: "Realizada",
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
 * Quórum: mayoría de titulares activos presentes. Un suplente presente cubre
 * al titular ausente de su misma representación, que es la razón de existir de
 * la suplencia.
 */
export function assessQuorum(args: {
  members: CommitteeMemberRow[]
  attendedMemberIds: string[]
}): { reached: boolean; required: number; effective: number } {
  const active = args.members.filter((member) => member.status === "active")
  const titulars = active.filter((member) => member.seat === "titular")
  const attended = new Set(args.attendedMemberIds)
  const required = Math.ceil(titulars.length / 2)

  let effective = titulars.filter((member) => attended.has(member.id)).length
  for (const representation of ["company", "workers"] as const) {
    const absentTitulars = titulars.filter((member) => member.representation === representation && !attended.has(member.id)).length
    const presentSubstitutes = active.filter((member) =>
      member.seat === "suplente" && member.representation === representation && attended.has(member.id)).length
    effective += Math.min(absentTitulars, presentSubstitutes)
  }

  return { reached: titulars.length > 0 && effective >= required, required, effective }
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
