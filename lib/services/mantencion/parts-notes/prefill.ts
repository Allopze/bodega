import { and, asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders } from "@/db/schema"
import type { MantViewer } from "../access"
import type { PartsNotePrefill } from "../parts/types"
import { canSeeNote, NP_PERMISSIONS, noteVisibility } from "./access"
import { loadPurchases } from "./lines"
import { isResolvableLine } from "./status"

/** Como `vehicleLabel` de `lib/fleet-vehicle-label.ts`, pero sin repetir la patente cuando un equipo sin patente la tiene igual al código. */
const vehicleLabel = (code: string | null, plate: string | null) => (!code ? plate : plate && plate !== code ? `${code} · ${plate}` : code)

/**
 * Lo que `?np=<id>` precarga en la solicitud de repuestos: el equipo y la OT de la NP (si los tiene),
 * urgencia crítica si la NP es urgente, y sólo las líneas que aún nadie resolvió (pendientes, o «en compra»
 * cuyas compras murieron todas). Sin OT, la solicitud se arma sin OT y en la faena de la NP; cada línea lleva
 * su equipo de cargo. `null` si no hay nada que pedir, la NP está anulada o en espera, o quien pregunta no puede
 * resolverla (ni `mant:np:manage` ni `mant:np:purchase` en su alcance).
 */
export async function loadPartsNotePrefill(viewer: MantViewer, noteId: string): Promise<PartsNotePrefill | null> {
  const canBuy = viewer.permissions.includes(NP_PERMISSIONS.manage) || viewer.permissions.includes(NP_PERMISSIONS.purchase)
  if (!canBuy) return null
  const [note] = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      worksiteId: mantPartsNotes.worksiteId,
      vehicleId: mantPartsNotes.vehicleId,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      urgent: mantPartsNotes.urgent,
      requestedByUserId: mantPartsNotes.requestedByUserId,
      vehicleCode: fuelVehicles.code,
      vehiclePlate: fuelVehicles.plate,
      vehicleWorksiteId: fuelVehicles.worksiteId,
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(eq(mantPartsNotes.id, noteId))
    .limit(1)
  if (!note || note.status === "anulada" || note.status === "en_espera") return null
  if (!canSeeNote(noteVisibility(viewer), note)) return null

  const chargeVehicle = alias(fuelVehicles, "np_prefill_charge_vehicle")
  const items = await db
    .select({
      id: mantPartsNoteItems.id,
      productId: mantPartsNoteItems.productId,
      description: mantPartsNoteItems.description,
      quantity: mantPartsNoteItems.quantity,
      unitOfMeasure: mantPartsNoteItems.unitOfMeasure,
      partNumber: mantPartsNoteItems.partNumber,
      chargeVehicleId: mantPartsNoteItems.chargeVehicleId,
      chargeVehicleCode: chargeVehicle.code,
      chargeVehiclePlate: chargeVehicle.plate,
      resolution: mantPartsNoteItems.resolution,
      sortOrder: mantPartsNoteItems.sortOrder,
    })
    .from(mantPartsNoteItems)
    .leftJoin(chargeVehicle, eq(chargeVehicle.id, mantPartsNoteItems.chargeVehicleId))
    .where(and(eq(mantPartsNoteItems.noteId, noteId), inArray(mantPartsNoteItems.resolution, ["pendiente", "en_compra"])))
    .orderBy(asc(mantPartsNoteItems.sortOrder))
  const purchases = await loadPurchases(db, items.filter((item) => item.resolution === "en_compra").map((item) => item.id))
  const open = items.filter((item) => isResolvableLine(
    item.resolution,
    (purchases.get(item.id) ?? []).map((row) => ({ itemStatus: row.status, requestStatus: row.requestStatus })),
  ))
  if (open.length === 0) return null

  return {
    noteId: note.id,
    noteCode: note.code,
    // La solicitud nace en la faena donde está el equipo hoy: es donde se necesita el repuesto.
    // Sin equipo (NP sin OT) o si el equipo no tiene faena, cae a la faena de la NP.
    worksiteId: note.vehicleWorksiteId ?? note.worksiteId,
    vehicleId: note.vehicleId,
    vehicleLabel: note.vehicleId ? vehicleLabel(note.vehicleCode, note.vehiclePlate) : null,
    workOrderId: note.workOrderId,
    workOrderFolio: note.workOrderFolio,
    urgency: note.urgent || note.equipmentStopped ? "critical" : "high",
    items: open.map((item) => ({
      partsNoteItemId: item.id,
      productId: item.productId,
      description: item.description,
      quantity: Number(item.quantity),
      unitOfMeasure: item.unitOfMeasure,
      partNumber: item.partNumber,
      chargeVehicleId: item.chargeVehicleId,
      chargeVehicleLabel: item.chargeVehicleId ? vehicleLabel(item.chargeVehicleCode, item.chargeVehiclePlate) : null,
    })),
  }
}
