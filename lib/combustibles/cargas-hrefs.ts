/**
 * Los enlaces de cada fila de la lista de Cargas. Los arma el servidor con el período y la
 * faena de la pantalla (`context`) y la tabla sólo los pinta: no construye URL. Es una función
 * pura y vive aparte de la página porque ésta es un componente de servidor y no se puede probar.
 */
import { FUEL_LOG_LOAD_ORIGIN, fuelLogDetailHref, type FuelLogRow } from "@/lib/combustibles/fuel-log-shared"
import { inboxRowKey } from "@/lib/combustibles/inbox/types"
import { fuelEquipmentHref, fuelInboxHref, fuelInboxRef, fuelLoadHistoryHref } from "@/lib/combustibles/routes"

/** Enlaces ya armados por la página (con el período y la faena de la pantalla): la tabla no construye URL. */
export interface CargaRowHrefs {
  /** Ficha de la carga. */
  detail: string
  /** Ficha del equipo; `null` cuando la patente no está vinculada. */
  equipment: string | null
  /** Historial de la carga; `null` sin `view_audit`. */
  history: string | null
  /** Fotos de la carga (ancla de la ficha); `null` sin `view_personal` o sin fotos. */
  evidence: string | null
  /** La carga en la bandeja «Por revisar»; `null` si no está por decidir. */
  decide: string | null
  /** El pedido de revisión en la bandeja. */
  requested: string
  /** Los casos de anomalía de ESTA carga en la bandeja (`ref=<fuente>:<id>`), no los de todas. */
  cases: string
}

type CargaRowForHrefs = Pick<FuelLogRow, "source" | "id" | "detailId" | "vehicleId" | "evidenceCount" | "reviewFlagged" | "equipmentLoadId">

/**
 * `canViewAudit` decide si hay enlace al historial y `canViewPersonal`, si hay enlace a las
 * fotos (las fotos pueden mostrar personas). `context` agrega al destino el período y la faena
 * de la pantalla (`withFuelContext`); un destino que ya trae los suyos los conserva.
 */
export function buildCargaRowHrefs(
  row: CargaRowForHrefs,
  { canViewAudit, canViewPersonal, context }: { canViewAudit: boolean; canViewPersonal: boolean; context: (href: string) => string },
): CargaRowHrefs {
  const detail = context(fuelLogDetailHref(row))
  return {
    detail,
    equipment: row.vehicleId ? context(fuelEquipmentHref(row.vehicleId)) : null,
    history: canViewAudit ? context(fuelLoadHistoryHref({ origen: FUEL_LOG_LOAD_ORIGIN[row.source], id: row.detailId })) : null,
    evidence: canViewPersonal && row.source === "tae_pwa" && (row.evidenceCount ?? 0) > 0 ? `${detail}#evidencia` : null,
    decide: row.reviewFlagged && row.equipmentLoadId ? context(fuelInboxHref({ tipo: "carga", item: inboxRowKey("carga", row.equipmentLoadId) })) : null,
    requested: context(fuelInboxHref({ tipo: "pedido" })),
    // La insignia «Caso abierto» de una fila lleva a los casos de ESA carga: sin `ref` listaría los de todas.
    cases: context(fuelInboxHref({ tipo: "caso", ref: fuelInboxRef(row.source, row.id) })),
  }
}
