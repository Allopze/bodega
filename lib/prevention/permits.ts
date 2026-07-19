export const PERMIT_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  pending_approval: "Pendiente de aprobación",
  approved: "Aprobado",
  active: "Vigente en terreno",
  suspended: "Suspendido",
  closed: "Cerrado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
}

export const PERMIT_CREW_ROLE_LABELS: Record<string, string> = {
  executor: "Ejecutante",
  supervisor: "Supervisor",
  standby: "Vigía / apoyo",
  observer: "Observador",
}

export const ENERGY_SOURCE_LABELS: Record<string, string> = {
  electrical: "Eléctrica",
  mechanical: "Mecánica",
  hydraulic: "Hidráulica",
  pneumatic: "Neumática",
  thermal: "Térmica",
  chemical: "Química",
  gravitational: "Gravitacional",
  other: "Otra",
}

export const RESIDUAL_RISK_LABELS: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
}

export function permitStatusBadgeVariant(status: string): "default" | "info" | "success" | "warning" | "danger" | "outline" {
  if (status === "active") return "success"
  if (status === "approved") return "info"
  if (status === "suspended") return "warning"
  if (status === "rejected" || status === "cancelled") return "danger"
  if (status === "closed") return "outline"
  return "default"
}

export const PERMIT_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["active", "cancelled"],
  active: ["suspended", "closed"],
  suspended: ["active", "closed", "cancelled"],
  closed: [],
  rejected: [],
  cancelled: [],
}

export interface PermitBlocker {
  kind:
    | "control_pending"
    | "isolation_missing"
    | "isolation_not_verified"
    | "measurement_missing"
    | "measurement_stale"
    | "measurement_out_of_range"
    | "jsa_missing"
    | "crew_empty"
    | "crew_competency"
    | "crew_access_blocked"
    | "window_expired"
  detail: string
}

export interface PermitTypeSpec {
  requiresIsolation: boolean
  requiresMeasurement: boolean
  requiresJsa: boolean
  measurementValidityMinutes: number | null
  maxDurationHours: number
}

export interface PermitControlRow {
  id: string
  description: string
  isMandatory: boolean
  verified: boolean
  notApplicableReason: string | null
}

export interface PermitIsolationRow {
  id: string
  equipmentTag: string
  appliedAt: string | null
  verifiedZeroEnergy: boolean
  removedAt: string | null
}

export interface PermitMeasurementRow {
  parameter: string
  withinRange: boolean
  takenAt: string
}

export interface PermitCrewRow {
  id: string
  workerId: string | null
  contractorWorkerId: string | null
  label: string
}

/**
 * Decide si un permiso puede pasar a `active`. Devuelve TODOS los bloqueadores
 * y no sólo el primero: en terreno interesa saber la lista completa de lo que
 * falta, no descubrirla de a uno.
 *
 * Las habilitaciones de personas se reciben ya resueltas (`crewWithoutCompetency`,
 * `crewWithBlockedAccess`) porque provienen de los módulos de competencias y de
 * contratistas; esta función sólo compone la decisión.
 */
export function assessPermitActivation(args: {
  type: PermitTypeSpec
  controls: PermitControlRow[]
  isolations: PermitIsolationRow[]
  measurements: PermitMeasurementRow[]
  jsaStepCount: number
  crew: PermitCrewRow[]
  crewWithoutCompetency: PermitCrewRow[]
  crewWithBlockedAccess: PermitCrewRow[]
  plannedEndAt: string
  now: string
}): { allowed: boolean; blockers: PermitBlocker[] } {
  const blockers: PermitBlocker[] = []

  for (const control of args.controls) {
    // Un control obligatorio se cumple verificándolo o declarando por qué no
    // aplica; no basta con dejarlo en blanco.
    if (control.isMandatory && !control.verified && !control.notApplicableReason) {
      blockers.push({ kind: "control_pending", detail: control.description })
    }
  }

  if (args.type.requiresIsolation) {
    const live = args.isolations.filter((item) => !item.removedAt)
    if (live.length === 0) {
      blockers.push({ kind: "isolation_missing", detail: "El tipo de permiso exige aislamiento de energías y no hay ninguno registrado." })
    }
    for (const isolation of live) {
      if (!isolation.appliedAt) {
        blockers.push({ kind: "isolation_missing", detail: `Aislamiento sin aplicar en ${isolation.equipmentTag}.` })
      } else if (!isolation.verifiedZeroEnergy) {
        blockers.push({ kind: "isolation_not_verified", detail: `Falta verificar energía cero en ${isolation.equipmentTag}.` })
      }
    }
  }

  if (args.type.requiresMeasurement) {
    if (args.measurements.length === 0) {
      blockers.push({ kind: "measurement_missing", detail: "El tipo de permiso exige mediciones y no hay ninguna registrada." })
    } else {
      // Sólo cuenta la medición más reciente de cada parámetro: una lectura
      // antigua fuera de rango no invalida una nueva dentro de rango, y una
      // lectura vieja no habilita aunque esté dentro de rango.
      const latestByParameter = new Map<string, PermitMeasurementRow>()
      for (const measurement of args.measurements) {
        const current = latestByParameter.get(measurement.parameter)
        if (!current || measurement.takenAt > current.takenAt) latestByParameter.set(measurement.parameter, measurement)
      }
      const validity = args.type.measurementValidityMinutes ?? 0
      for (const measurement of latestByParameter.values()) {
        if (!measurement.withinRange) {
          blockers.push({ kind: "measurement_out_of_range", detail: `${measurement.parameter} fuera del rango aceptable.` })
          continue
        }
        const ageMinutes = (Date.parse(args.now) - Date.parse(measurement.takenAt)) / 60_000
        if (validity > 0 && ageMinutes > validity) {
          blockers.push({ kind: "measurement_stale", detail: `La medición de ${measurement.parameter} venció (${Math.floor(ageMinutes)} min, máximo ${validity}).` })
        }
      }
    }
  }

  if (args.type.requiresJsa && args.jsaStepCount === 0) {
    blockers.push({ kind: "jsa_missing", detail: "El tipo de permiso exige un AST/JSA con al menos un paso." })
  }

  if (args.crew.length === 0) {
    blockers.push({ kind: "crew_empty", detail: "El permiso no tiene cuadrilla asignada." })
  }
  for (const member of args.crewWithoutCompetency) {
    blockers.push({ kind: "crew_competency", detail: `${member.label} no tiene vigente una competencia exigida por este permiso.` })
  }
  for (const member of args.crewWithBlockedAccess) {
    blockers.push({ kind: "crew_access_blocked", detail: `${member.label} pertenece a un contratista con el ingreso bloqueado.` })
  }

  if (Date.parse(args.plannedEndAt) <= Date.parse(args.now)) {
    blockers.push({ kind: "window_expired", detail: "La ventana planificada del permiso ya venció." })
  }

  return { allowed: blockers.length === 0, blockers }
}

/**
 * Un permiso vigente cuya ventana expiró deja de habilitar trabajo aunque su
 * estado siga siendo `active`: la vigencia manda sobre el registro.
 */
export function isPermitExpired(permit: { status: string; plannedEndAt: string; extendedUntilAt: string | null }, now: string) {
  if (permit.status !== "active" && permit.status !== "approved") return false
  const effectiveEnd = permit.extendedUntilAt ?? permit.plannedEndAt
  return Date.parse(effectiveEnd) <= Date.parse(now)
}

/** Duración planificada en horas, para contrastar con el máximo del tipo. */
export function plannedDurationHours(startAt: string, endAt: string) {
  return (Date.parse(endAt) - Date.parse(startAt)) / 3_600_000
}
