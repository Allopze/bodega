import { FLEET_STOPPED_FILTER, filterFleetOverviewRows } from "@/lib/fleet-overview-filters"
import { resolveExpiryCandidates } from "@/lib/validation/fleet-documents"

/**
 * Conteos de «Requiere atención» del Panel operacional.
 *
 * Cada cifra lleva a una lista filtrada (`/flota?estado=detenidos`,
 * `/flota?vencimiento=vencidos`), así que se mide con **el mismo predicado** que
 * esa lista: `filterFleetOverviewRows`. Si el criterio de la lista cambia, la
 * cifra del tile cambia con él en vez de contar otra cosa.
 *
 * Todo aquí es puro: sin base de datos, sin sesión. El servicio
 * (`getOperationalControlHub`) trae las filas con su alcance de faenas y llama
 * a estas funciones.
 */

export interface AttentionVehicle {
  plate: string
  type: string
  worksiteName: string
  operationalStatus: string
  soapExpiresAt: string | null
  technicalReviewExpiresAt: string | null
  circulationPermitExpiresAt: string | null
  insuranceExpiresAt: string | null
}

export interface AttentionVehicleDocument {
  /** Debe coincidir con la clave por la que se agrupan los documentos. */
  vehicleId: string
  documentType: string
  expiresAt: string | null
}

export interface StoppedVehicles {
  total: number
  inMaintenance: number
  outOfService: number
}

export interface FleetDocumentExpiry {
  /** Equipos (no documentos) con algún vencimiento anterior a hoy. */
  expired: number
  /** Equipos cuyo próximo vencimiento cae entre hoy y el fin de la ventana de aviso. */
  expiringSoon: number
}

/** El filtro por estado no mide fechas; la firma de `filterFleetOverviewRows` las exige igual. */
const NO_DATES = { today: "", warningWindowEnd: "" } as const

function toFilterRow(vehicle: AttentionVehicle, nextExpiryDate: string | null) {
  return {
    plate: vehicle.plate,
    brand: null,
    model: null,
    type: vehicle.type,
    worksiteName: vehicle.worksiteName,
    operationalStatus: vehicle.operationalStatus,
    responsibleName: null,
    nextExpiryDate,
  }
}

/**
 * Equipos que hoy no producen: en mantención o fuera de servicio. Es el mismo
 * conjunto que abre `/flota?estado=detenidos`, que no distingue activos de
 * inactivos.
 */
export function countStoppedVehicles(vehicles: readonly AttentionVehicle[]): StoppedVehicles {
  const stopped = filterFleetOverviewRows(
    vehicles.map((vehicle) => toFilterRow(vehicle, null)),
    { operationalStatus: FLEET_STOPPED_FILTER },
    NO_DATES,
  )
  const inMaintenance = stopped.filter((row) => row.operationalStatus === "mantencion").length
  return { total: stopped.length, inMaintenance, outOfService: stopped.length - inMaintenance }
}

/**
 * Próximo vencimiento de un equipo: el menor de sus fechas vigentes. Replica
 * `getNextExpiryDate` de `lib/services/fleet.ts` (privada) con las mismas
 * candidatas: columnas declaradas del equipo más el documento vigente de cada
 * tipo cuya columna esté vacía.
 */
function nextExpiryDate(
  vehicle: AttentionVehicle,
  documents: ReadonlyArray<{ documentType: string; expiresAt: string | null }>,
): string | null {
  const candidates = resolveExpiryCandidates(
    {
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    },
    [...documents],
  )
  return candidates.filter(Boolean).sort((a, b) => a.localeCompare(b))[0] ?? null
}

/**
 * Equipos con documentación vencida o por vencer. `dates` son fechas civiles
 * chilenas (`todayInChile()` y hoy + días de aviso de Flota): medirlas con UTC
 * marcaría como vencido, desde las 20:00, lo que vence hoy.
 *
 * `vehicles` y `documents` vienen con el mismo alcance de faenas; `documents`
 * son sólo los vigentes (`status = 'current'`) con fecha.
 */
export function countFleetDocumentExpiry(
  vehicles: ReadonlyArray<AttentionVehicle & { id: string }>,
  documents: readonly AttentionVehicleDocument[],
  dates: { today: string; warningWindowEnd: string },
): FleetDocumentExpiry {
  const documentsByVehicle = new Map<string, AttentionVehicleDocument[]>()
  for (const document of documents) {
    const list = documentsByVehicle.get(document.vehicleId)
    if (list) list.push(document)
    else documentsByVehicle.set(document.vehicleId, [document])
  }
  const rows = vehicles.map((vehicle) => toFilterRow(vehicle, nextExpiryDate(vehicle, documentsByVehicle.get(vehicle.id) ?? [])))
  return {
    expired: filterFleetOverviewRows(rows, { expiry: "vencidos" }, dates).length,
    expiringSoon: filterFleetOverviewRows(rows, { expiry: "proximos" }, dates).length,
  }
}
