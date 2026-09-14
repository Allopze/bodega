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
    | "measurement_invalid"
    | "measurement_stale"
    | "measurement_out_of_range"
    | "measurement_uncalibrated"
    | "jsa_missing"
    | "crew_empty"
    | "crew_competency"
    /** PER-001: integrante de la cuadrilla que no ha acusado el AST. */
    | "crew_ack_missing"
    | "window_expired"
  detail: string
}

export interface PermitTypeSpec {
  requiresIsolation: boolean
  requiresMeasurement: boolean
  requiresJsa: boolean
  /**
   * PER-001: ¿este tipo exige que cada integrante de la cuadrilla haya acusado
   * el AST antes de activar? Configurable por tipo; ver `permits.ts` del schema.
   */
  requiresCrewAcknowledgement: boolean
  measurementValidityMinutes: number | null
  /** `null` = este tipo no exige calibración vigente del instrumento (opt-in). */
  measurementCalibrationValidityDays: number | null
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
  calibrationDate: string | null
}

export interface PermitCrewRow {
  id: string
  workerId: string
  label: string
  /**
   * PER-001: momento del acuse del AST (`null` = no ha acusado). Se pide
   * explícito y no opcional para que ningún llamador pueda omitirlo y obtener
   * por silencio un permiso habilitado sin acuses, que es justo el defecto.
   */
  acknowledgedAt: string | null
}

/**
 * Decide si un permiso puede pasar a `active`. Devuelve TODOS los bloqueadores
 * y no sólo el primero: en terreno interesa saber la lista completa de lo que
 * falta, no descubrirla de a uno.
 *
 * Las habilitaciones de personas se reciben ya resueltas
 * (`crewWithoutCompetency`) porque provienen del módulo de competencias; esta
 * función sólo compone la decisión.
 */
export function assessPermitActivation(args: {
  type: PermitTypeSpec
  controls: PermitControlRow[]
  isolations: PermitIsolationRow[]
  measurements: PermitMeasurementRow[]
  jsaStepCount: number
  crew: PermitCrewRow[]
  crewWithoutCompetency: PermitCrewRow[]
  /**
   * `CAP-001`: los que sólo incumplen un requisito declarado «advertencia».
   * Opcional para no romper a los llamadores que aún no lo pasan; su ausencia
   * significa «ninguno», no «no se sabe».
   */
  crewWithCompetencyWarning?: PermitCrewRow[]
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
        // Una hora futura ya la rechaza la validación de entrada; esto atrapa
        // las filas mal grabadas antes de esa guardia, que de otro modo nunca
        // vencerían y habilitarían el permiso para siempre.
        if (ageMinutes < 0) {
          blockers.push({ kind: "measurement_invalid", detail: `La medición de ${measurement.parameter} tiene hora futura y no es válida.` })
          continue
        }
        if (validity > 0 && ageMinutes > validity) {
          blockers.push({ kind: "measurement_stale", detail: `La medición de ${measurement.parameter} venció (${Math.floor(ageMinutes)} min, máximo ${validity}).` })
        }
        // Vigencia de calibración del instrumento: opt-in por tipo de permiso.
        // Una fecha de calibración futura ya la rechaza la validación de entrada.
        const calDays = args.type.measurementCalibrationValidityDays
        if (calDays !== null && calDays > 0) {
          if (!measurement.calibrationDate) {
            blockers.push({ kind: "measurement_uncalibrated", detail: `La medición de ${measurement.parameter} no declara fecha de calibración del equipo.` })
            continue
          }
          const calAgeDays = (Date.parse(args.now) - Date.parse(`${measurement.calibrationDate}T00:00:00.000Z`)) / 86_400_000
          if (calAgeDays > calDays) {
            blockers.push({ kind: "measurement_uncalibrated", detail: `La calibración del equipo de ${measurement.parameter} venció (${Math.floor(calAgeDays)} días, máximo ${calDays}).` })
          }
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
  /*
   * CAP-001 (auditoría 2026-09-14): sólo bloquea la falta de una competencia
   * declarada **bloqueante**. Antes bloqueaba cualquiera, incluidas las que el
   * catálogo marcaba como advertencia, así que la marca decidía al revés de lo
   * que decía.
   */
  for (const member of args.crewWithoutCompetency) {
    blockers.push({ kind: "crew_competency", detail: `${member.label} no tiene vigente una competencia BLOQUEANTE exigida por este permiso.` })
  }

  /*
   * PER-001 (auditoría 2026-09-14): la lista de bloqueadores no incluía el
   * acuse del AST. El acuse existía —sólo el propio integrante, de un solo uso,
   * sellado con SHA-256— pero era opcional: el permiso pasaba a `active` con
   * cero acuses, de modo que el registro de que la cuadrilla fue informada de
   * los riesgos no condicionaba la autorización, a diferencia de los otros doce
   * controles. Ahora bloquea, y el tipo de permiso decide si lo exige.
   *
   * DECISIÓN DE PRODUCTO PENDIENTE: el valor por defecto para los tipos nuevos
   * es «exigir» (columna `requires_crew_acknowledgement DEFAULT true`) y los
   * tipos ya existentes heredaron su `requiresJsa`. Que ese default sea el
   * correcto para toda faena, y si debe existir además una vía de excepción
   * motivada del supervisor, no lo declara la plataforma en ninguna parte.
   */
  if (args.type.requiresCrewAcknowledgement) {
    for (const member of args.crew) {
      if (member.acknowledgedAt) continue
      blockers.push({ kind: "crew_ack_missing", detail: `${member.label} no ha acusado el AST del permiso.` })
    }
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
