/**
 * Licencias de conducir de trabajadores (2026-11).
 *
 * ESQUELETO de la Fase 0: las firmas son el contrato con `/flota/conductores`,
 * la exportación y el script de carga. La línea de servicio lo implementa sin
 * cambiar firmas (ver `driver-licenses-contract.ts`).
 */

import type { Session } from "next-auth"
import type { db } from "@/db"
import type { DriverLicenseInput } from "@/lib/validation/driver-licenses"
import type {
  DriverCandidate,
  DriverLicenseMutationResult,
  DriverRoster,
  DriverRosterRow,
} from "./driver-licenses-contract"

type Client = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Actor para auditoría cuando no hay sesión (script de carga). */
export interface DriverLicenseActor {
  userId: string
  userEmail: string
}

/**
 * Conductores visibles para la sesión: licencia registrada ∪ cargo que la exige
 * (capacidad efectiva `drives_vehicle` u `operates_equipment`), trabajadores
 * activos, con alcance de faena. Exige `flota:manage_licenses`.
 */
export async function listDriverRoster(_session: Session, _options?: { worksiteId?: string }): Promise<DriverRoster> {
  throw new Error("listDriverRoster: pendiente de implementar")
}

/** Una fila, para refrescar tras guardar o abrir `?editar=`. Null si no existe o está fuera de alcance. */
export async function getDriverRosterRow(_session: Session, _workerId: string): Promise<DriverRosterRow | null> {
  throw new Error("getDriverRosterRow: pendiente de implementar")
}

/** Trabajadores activos del alcance sin licencia registrada, para «Registrar licencia». */
export async function listDriverCandidates(_session: Session): Promise<DriverCandidate[]> {
  throw new Error("listDriverCandidates: pendiente de implementar")
}

/** Crea o reemplaza la licencia. Valida permiso, alcance de faena y datos; audita. */
export async function upsertDriverLicense(_session: Session, _input: DriverLicenseInput): Promise<DriverLicenseMutationResult> {
  throw new Error("upsertDriverLicense: pendiente de implementar")
}

/** Quita la licencia registrada. Valida permiso y alcance; audita con el estado anterior. */
export async function removeDriverLicense(_session: Session, _workerId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  throw new Error("removeDriverLicense: pendiente de implementar")
}

/**
 * Escritura sin sesión para el script de carga: mismo upsert y misma auditoría,
 * dentro del cliente/transacción recibido. No verifica permisos (el script
 * exige un actor activo). Devuelve si cambió algo, para el informe idempotente.
 */
export async function writeDriverLicense(
  _client: Client,
  _input: DriverLicenseInput,
  _actor: DriverLicenseActor,
  _reason: string,
): Promise<"created" | "updated" | "unchanged"> {
  throw new Error("writeDriverLicense: pendiente de implementar")
}
