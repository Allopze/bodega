/**
 * Estado de un conductor: puro, compartido por la pantalla `/flota/conductores`,
 * el aviso diario (`lib/services/deadline-reminders.ts`) y la exportación. Si
 * cada uno lo calculara a su modo, el correo diría «vencida» de alguien que la
 * pantalla muestra vigente.
 */

import { expiryState, type ExpiryStatus } from "@/lib/expiry"
import {
  licenseSatisfies,
  sortLicenseClasses,
  type DriverLicenseClass,
  type DriverStatus,
} from "@/lib/validation/driver-licenses"

export interface DriverStatusInput {
  /** El cargo efectivo (capacidad `drives_vehicle` u `operates_equipment`) exige licencia. */
  requiresLicense: boolean
  /** Clases que exige el cargo; basta una. Vacío = cualquier licencia sirve. */
  requiredClasses: readonly string[]
  license: { classes: readonly string[]; expiresAt: string | null } | null
  today: string
  warningDays: number
}

export interface DriverStatusResult {
  status: DriverStatus
  expiry: ExpiryStatus | null
  /** Clases exigidas por el cargo que la licencia no tiene (sólo si `clase_insuficiente`). */
  missingClasses: DriverLicenseClass[]
}

/**
 * Precedencia: lo que impide conducir hoy (vencida, sin licencia), después lo
 * que no calza con el cargo, después lo que vencerá, y una licencia sin fecha
 * (no se puede controlar) antes de «vigente».
 */
export function resolveDriverStatus(input: DriverStatusInput): DriverStatusResult {
  const { license, requiresLicense, requiredClasses, today, warningDays } = input
  if (!license) {
    return { status: requiresLicense ? "sin_licencia" : "sin_fecha", expiry: null, missingClasses: [] }
  }
  const expiry = expiryState(license.expiresAt, today, warningDays)
  if (expiry.state === "vencido") return { status: "vencida", expiry, missingClasses: [] }
  if (requiresLicense && !licenseSatisfies(license.classes, requiredClasses)) {
    return { status: "clase_insuficiente", expiry, missingClasses: sortLicenseClasses(requiredClasses) }
  }
  if (expiry.state === "por_vencer") return { status: "por_vencer", expiry, missingClasses: [] }
  if (expiry.state === "sin_fecha") return { status: "sin_fecha", expiry, missingClasses: [] }
  return { status: "vigente", expiry, missingClasses: [] }
}

/** Rango de urgencia para ordenar «Requieren atención». Menor = más urgente. */
export const DRIVER_STATUS_RANK: Record<DriverStatus, number> = {
  vencida: 0,
  sin_licencia: 1,
  clase_insuficiente: 2,
  sin_fecha: 3,
  por_vencer: 4,
  vigente: 5,
}
