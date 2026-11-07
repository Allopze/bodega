/**
 * Contrato entre el servicio de licencias (`lib/services/driver-licenses.ts`) y
 * quienes lo consumen (pantalla `/flota/conductores`, exportación, script de
 * carga). Sólo tipos: cambiarlos obliga a revisar a ambos lados.
 */

import type { ExpiryStatus } from "@/lib/expiry"
import type { DriverLicenseClass, DriverStatus } from "@/lib/validation/driver-licenses"

export interface DriverLicenseRecord {
  classes: DriverLicenseClass[]
  expiresAt: string | null
  notes: string | null
  updatedAt: string
}

export interface DriverRosterRow {
  workerId: string
  /** «Nombre Apellido», como en el resto de la plataforma. */
  name: string
  rut: string | null
  worksiteId: string
  worksiteName: string
  positionId: string | null
  /** Null o «Sin clasificar» si el trabajador no tiene cargo. */
  positionName: string | null
  /** El cargo efectivo (con excepciones individuales) conduce u opera maquinaria. */
  requiresLicense: boolean
  /** Clases que exige el cargo; basta una. */
  requiredClasses: DriverLicenseClass[]
  license: DriverLicenseRecord | null
  status: DriverStatus
  expiry: ExpiryStatus | null
  /** Sólo con `status === "clase_insuficiente"`. */
  missingClasses: DriverLicenseClass[]
}

export interface DriverLicenseAttention {
  /** Trabajadores del alcance en la nómina (con o sin licencia registrada). */
  total: number
  /** Trabajadores con licencia vencida, sin licencia o sin la clase requerida. */
  expired: number
  /** Licencias que vencen dentro de la ventana configurada de Flota. */
  expiringSoon: number
  warningDays: number
}

export interface DriverRoster {
  rows: DriverRosterRow[]
  today: string
  warningDays: number
  /** Faenas que el usuario puede ver (para el filtro; sólo se muestra si > 1). */
  worksites: Array<{ id: string; name: string }>
  /** Trabajadores activos sin cargo (o «Sin clasificar») en el alcance: alimenta el aviso de clasificar. */
  unclassifiedWorkers: number
}

/** Opción del buscador de «Registrar licencia»: trabajadores activos del alcance sin licencia registrada. */
export interface DriverCandidate {
  workerId: string
  name: string
  rut: string | null
  worksiteName: string
  positionName: string | null
  requiredClasses: DriverLicenseClass[]
}

export type DriverLicenseMutationResult =
  | { ok: true; row: DriverRosterRow }
  | { ok: false; message: string; fieldErrors?: Partial<Record<"classes" | "expiresAt" | "notes" | "workerId", string>> }
