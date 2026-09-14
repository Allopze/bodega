/**
 * Qué queda abierto cuando una persona sale de la dotación.
 *
 * TRB-001, TIL-001 y E2E-007 (auditoría 2026-09-14): desactivar a un trabajador
 * era un cambio de bandera. En ese momento la plataforma ya sabe —y no
 * consultaba— que la persona tiene un notebook con acta abierta, accesos
 * vigentes a sistemas, licencias ocupando asiento, EPP entregado sin devolver y
 * pertenencia a cuadrillas de permisos abiertos. El checklist de salida de TI, a
 * su vez, se marcaba a mano sin verificar nada de eso.
 *
 * El cierre de faena —`setWorksiteActive`— ya trataba así a un objeto mucho
 * menos sensible: exige motivo, comprueba que no queden existencias ni
 * trabajadores activos, y ofrece devolver el saldo. Esto es lo mismo para la
 * persona.
 *
 * El servicio **informa**; no decide. Qué hacer con los pendientes es política
 * del llamador: la acción de administración los muestra y exige confirmación
 * explícita, y el checklist de salida de TI los usa como verdad en lugar de
 * casillas sueltas.
 *
 * Nota de precisión sobre los hallazgos: ambos citan una tabla `it_worker_access`
 * que no existe; la real es `it_system_access`.
 */

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  deliveries,
  deliveryItems,
  itAccessSystems,
  itAssetAssignments,
  itLicenseAssignments,
  itLicenses,
  itSystemAccess,
  preventionPermitCrew,
  preventionWorkPermits,
  stockReturns,
} from "@/db/schema"

export type WorkerOffboardingKind =
  | "it_assets"
  | "it_access"
  | "it_licenses"
  | "epp"
  | "permit_crew"

export interface WorkerOffboardingItem {
  kind: WorkerOffboardingKind
  /** Cuántos registros quedaron abiertos de esta clase. */
  count: number
  /** Frase corta para pantalla, ya en singular o plural. */
  label: string
  /** Códigos o nombres concretos, acotados para no inundar la interfaz. */
  samples: string[]
}

export interface WorkerOffboardingSummary {
  workerId: string
  items: WorkerOffboardingItem[]
  /** `true` cuando no queda nada abierto: la baja es limpia. */
  clear: boolean
}

const SAMPLE_LIMIT = 5

/**
 * Estados en que un permiso de trabajo sigue vivo. `closed`, `rejected` y
 * `cancelled` ya no comprometen a nadie.
 */
export const OPEN_PERMIT_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "active",
  "suspended",
] as const

function toItem(
  kind: WorkerOffboardingKind,
  rows: { label: string | null }[],
  singular: string,
  plural: string,
): WorkerOffboardingItem | null {
  if (rows.length === 0) return null
  return {
    kind,
    count: rows.length,
    label: rows.length === 1 ? singular : `${rows.length} ${plural}`,
    samples: rows.slice(0, SAMPLE_LIMIT).flatMap((row) => (row.label ? [row.label] : [])),
  }
}

/**
 * Reúne los pendientes de una persona. Sólo lectura y sin efectos: sirve tanto
 * para mostrarlos antes de decidir como para verificarlos después.
 */
export async function getWorkerOffboardingSummary(
  workerId: string,
  client: typeof db | Tx = db,
): Promise<WorkerOffboardingSummary> {
  const [assets, access, licenses, epp, crew] = await Promise.all([
    // Actas de asignación TI sin devolución registrada.
    client
      .select({ label: itAssetAssignments.code })
      .from(itAssetAssignments)
      .where(and(
        eq(itAssetAssignments.workerId, workerId),
        isNull(itAssetAssignments.returnedAt),
      )),

    // Accesos a sistemas que siguen vigentes.
    client
      .select({ label: itAccessSystems.name })
      .from(itSystemAccess)
      .innerJoin(itAccessSystems, eq(itSystemAccess.systemId, itAccessSystems.id))
      .where(and(
        eq(itSystemAccess.workerId, workerId),
        isNull(itSystemAccess.revokedAt),
        ne(itSystemAccess.status, "baja"),
      )),

    // Licencias que siguen consumiendo un asiento a su nombre.
    client
      .select({ label: itLicenses.name })
      .from(itLicenseAssignments)
      .innerJoin(itLicenses, eq(itLicenseAssignments.licenseId, itLicenses.id))
      .where(and(
        eq(itLicenseAssignments.workerId, workerId),
        isNull(itLicenseAssignments.revokedAt),
      )),

    // EPP entregado en entregas vigentes y sin devolución asociada a la línea.
    client
      .select({ label: deliveries.code })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .where(and(
        eq(deliveries.workerId, workerId),
        isNull(deliveries.voidedAt),
        sql`NOT EXISTS (
          SELECT 1 FROM ${stockReturns}
          WHERE ${stockReturns.deliveryItemId} = ${deliveryItems.id}
        )`,
      )),

    // Cuadrillas de permisos de trabajo que siguen abiertos.
    client
      .select({ label: preventionWorkPermits.code })
      .from(preventionPermitCrew)
      .innerJoin(preventionWorkPermits, eq(preventionPermitCrew.permitId, preventionWorkPermits.id))
      .where(and(
        eq(preventionPermitCrew.workerId, workerId),
        inArray(preventionWorkPermits.status, [...OPEN_PERMIT_STATUSES]),
      )),
  ])

  const items = [
    toItem("it_assets", assets, "1 activo TI sin devolver", "activos TI sin devolver"),
    toItem("it_access", access, "1 acceso a sistema vigente", "accesos a sistemas vigentes"),
    toItem("it_licenses", licenses, "1 licencia asignada", "licencias asignadas"),
    toItem("epp", epp, "1 entrega de EPP sin devolución", "entregas de EPP sin devolución"),
    toItem("permit_crew", crew, "1 permiso de trabajo abierto", "permisos de trabajo abiertos"),
  ].filter((entry): entry is WorkerOffboardingItem => entry !== null)

  return { workerId, items, clear: items.length === 0 }
}

/** Frase de una línea para el mensaje de una acción o de un checklist. */
export function describeWorkerOffboarding(summary: WorkerOffboardingSummary): string {
  if (summary.clear) return "No quedan activos, accesos, licencias, EPP ni permisos abiertos."
  return summary.items.map((entry) => entry.label).join("; ")
}

/**
 * Las tres dimensiones que le competen a TI. El checklist de baja es de TI: el
 * EPP y las cuadrillas de permisos los cierran bodega y prevención, y exigirlos
 * ahí sería trasladar a un rol una responsabilidad que no puede resolver.
 */
export const IT_OFFBOARDING_KINDS: ReadonlySet<WorkerOffboardingKind> = new Set([
  "it_assets",
  "it_access",
  "it_licenses",
])

/** El mismo resumen, acotado a lo que TI puede efectivamente cerrar. */
export function onlyItPendings(summary: WorkerOffboardingSummary): WorkerOffboardingSummary {
  const items = summary.items.filter((entry) => IT_OFFBOARDING_KINDS.has(entry.kind))
  return { ...summary, items, clear: items.length === 0 }
}
