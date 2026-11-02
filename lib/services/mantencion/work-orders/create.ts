import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantWorkOrderEvents, mantWorkOrderItems, mantWorkOrders } from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { OT_ITEM_MAX_PER_KIND, OT_PERMISSIONS, type OtItemKind, type OtStatus } from "@/lib/mantencion/work-order-states"
import type { CreateWorkOrderInput } from "@/lib/mantencion/work-order-schemas"
import { todayInChile } from "@/lib/utils"
import { nextFolio } from "../folio"
import { inWorksiteScope } from "./access"
import { equipmentLabel, failureOf, lockVehicle, OtRefusal, refuse, snapshotOf, type OtRow } from "./core"
import { findAssignableMechanic } from "./mechanics"
import { dispatchWorkOrderNotifications, sendWorkOrderNotification, type NotificationPlan } from "./notifications"
import type { SystemWorkOrderInput, WorkOrderActor, WorkOrderResult } from "./types"

/**
 * Alta de una orden de trabajo: la web (`createWorkOrder`, con permisos, alcance
 * e idempotencia) y la que nace de un hallazgo de inspección
 * (`createWorkOrderWithClient`, dentro de la transacción del llamador).
 *
 * El equipo tiene que estar en el módulo de mantención (tener perfil en
 * `mant_equipment_profiles`) y activo: es lo que da la unidad de medida, la
 * faena del folio y el resumen del equipo. El folio se toma al final, para
 * sostener lo menos posible el bloqueo del contador.
 */

type ItemTexts = { annex: string[]; maintenance: string[] }

interface NewOrder {
  vehicleId: string
  repair: boolean
  maintenance: boolean
  requestDate: string
  requesterName: string
  repairDescription: string | null
  observations: string | null
  items: ItemTexts
  inspectionFindingId: string | null
  clientRequestId: string | null
  assignedToUserId: string | null
}

function cleanItems(texts: readonly string[] | undefined, label: string): string[] {
  const items = (texts ?? []).map((text) => text.trim()).filter(Boolean)
  if (items.length > OT_ITEM_MAX_PER_KIND) refuse(`Máximo ${OT_ITEM_MAX_PER_KIND} ítems en «${label}», como el talonario.`, "invalid", "items")
  if (items.some((text) => text.length < 3)) refuse("Cada ítem necesita al menos 3 caracteres.", "invalid", "items")
  return items
}

export function checkRequestFields(input: { repair: boolean; maintenance: boolean; repairDescription: string | null; requesterName: string }) {
  if (!input.repair && !input.maintenance) refuse("Marca REPARACIÓN, MANTENCIÓN o ambas.", "invalid", "repair")
  if (input.repair && (input.repairDescription ?? "").trim().length < 5) refuse("Describe la reparación que se pide.", "invalid", "repairDescription")
  if (input.requesterName.trim().length < 2) refuse("Indica quién solicita.", "invalid", "requesterName")
}

export function itemRows(workOrderId: string, userId: string, items: ItemTexts) {
  const rows = (kind: OtItemKind, texts: string[]) => texts.map((description, index) => ({
    id: nanoid(), workOrderId, kind, origin: "solicitud" as const, description, sortOrder: index, createdByUserId: userId,
  }))
  return [...rows("anexo", items.annex), ...rows("mantencion", items.maintenance)]
}

export function normalizeItems(annexItems: readonly string[] | undefined, maintenanceItems: readonly string[] | undefined): ItemTexts {
  return {
    annex: cleanItems(annexItems, "Trabajos anexos"),
    maintenance: cleanItems(maintenanceItems, "Mantenciones solicitadas"),
  }
}

/** Valida el equipo, toma el folio e inserta la OT con sus ítems y su historial. Dentro de la transacción, con el equipo bloqueado. */
async function insertOrder(tx: Tx, order: NewOrder, actor: Pick<WorkOrderActor, "userId" | "name">): Promise<OtRow> {
  const vehicle = await lockVehicle(tx, order.vehicleId)
  if (!vehicle) refuse("Ese equipo no existe o no está en el módulo de mantención.", "invalid", "vehicleId")
  if (!vehicle.isActive) refuse(`El equipo ${vehicle.code} está dado de baja: no admite órdenes de trabajo.`, "invalid", "vehicleId")
  return insertLocked(tx, order, actor, vehicle)
}

async function insertLocked(tx: Tx, order: NewOrder, actor: Pick<WorkOrderActor, "userId" | "name">, vehicle: NonNullable<Awaited<ReturnType<typeof lockVehicle>>>): Promise<OtRow> {
  const folio = await nextFolio(tx, vehicle.worksiteId, "OT")
  const assigned = order.assignedToUserId
  const id = nanoid()
  const [row] = await tx.insert(mantWorkOrders).values({
    id,
    folio,
    clientRequestId: order.clientRequestId,
    vehicleId: vehicle.vehicleId,
    worksiteId: vehicle.worksiteId,
    equipmentSnapshot: snapshotOf(vehicle),
    repair: order.repair,
    maintenance: order.maintenance,
    requestDate: order.requestDate,
    requestedByUserId: actor.userId,
    requesterName: order.requesterName.trim(),
    repairDescription: order.repairDescription?.trim() || null,
    observations: order.observations?.trim() || null,
    status: assigned ? "asignada" : "solicitada",
    assignedToUserId: assigned,
    assignedByUserId: assigned ? actor.userId : null,
    assignedAt: assigned ? new Date().toISOString() : null,
    inspectionFindingId: order.inspectionFindingId,
  }).returning()
  if (!row) throw new Error("No se pudo crear la orden de trabajo")

  const items = itemRows(id, actor.userId, order.items)
  if (items.length) await tx.insert(mantWorkOrderItems).values(items)
  await tx.insert(mantWorkOrderEvents).values([
    {
      id: nanoid(), workOrderId: id, type: "created", fromStatus: null, toStatus: "solicitada", actorUserId: actor.userId,
      changeSet: { equipment: vehicle.code, repair: order.repair, maintenance: order.maintenance, items: items.length, inspectionFindingId: order.inspectionFindingId },
    },
    ...(assigned ? [{
      id: nanoid(), workOrderId: id, type: "assigned" as const, fromStatus: "solicitada", toStatus: "asignada", actorUserId: actor.userId,
      changeSet: { from: null, to: assigned },
    }] : []),
  ])
  await recordAudit({
    userId: actor.userId,
    action: "create",
    entityType: "mant_work_order",
    entityId: id,
    entityCode: folio,
    worksiteId: vehicle.worksiteId,
    newState: {
      vehicleId: vehicle.vehicleId, equipment: vehicle.code, repair: order.repair, maintenance: order.maintenance,
      assignedToUserId: assigned, inspectionFindingId: order.inspectionFindingId, items: items.length,
    },
  }, tx)
  return row
}

/**
 * Crea una OT dentro de la transacción del llamador (p. ej. al derivar un
 * hallazgo de inspección). No valida permisos de OT: el llamador ya validó los
 * suyos. Devuelve el id y el folio; el aviso se dispara después del commit con
 * `notifyWorkOrderCreated`. Lanza un `Error` con mensaje legible si el equipo no
 * está en el módulo de mantención o está dado de baja.
 */
export async function createWorkOrderWithClient(
  tx: Tx,
  input: SystemWorkOrderInput,
  actor: Pick<WorkOrderActor, "userId" | "name">,
): Promise<{ id: string; folio: string; worksiteId: string }> {
  try {
    const items = normalizeItems(input.annexItems, input.maintenanceItems)
    checkRequestFields({ repair: input.repair, maintenance: input.maintenance, repairDescription: input.repairDescription, requesterName: input.requesterName })
    const row = await insertOrder(tx, {
      vehicleId: input.vehicleId,
      repair: input.repair,
      maintenance: input.maintenance,
      requestDate: todayInChile(),
      requesterName: input.requesterName,
      repairDescription: input.repairDescription,
      observations: input.observations,
      items,
      inspectionFindingId: input.inspectionFindingId,
      clientRequestId: null,
      assignedToUserId: null,
    }, actor)
    return { id: row.id, folio: row.folio, worksiteId: row.worksiteId }
  } catch (error) {
    // El llamador está dentro de SU transacción: se relanza como `Error` plano con el mensaje legible.
    if (error instanceof OtRefusal) throw new Error(error.message)
    throw error
  }
}

/** Aviso «OT nueva» a la jefatura de mantención de la faena. Llamar DESPUÉS del commit. */
export async function notifyWorkOrderCreated(workOrderId: string): Promise<void> {
  const [row] = await db.select().from(mantWorkOrders).where(eq(mantWorkOrders.id, workOrderId)).limit(1)
  if (!row) return
  await sendWorkOrderNotification(createdPlan(row))
}

function createdPlan(row: OtRow): NotificationPlan {
  return {
    event: "created",
    workOrderId: row.id,
    folio: row.folio,
    worksiteId: row.worksiteId,
    // La versión del alta es siempre 1: reenviar el aviso no duplica.
    version: 1,
    actorUserId: row.requestedByUserId,
    requestedByUserId: row.requestedByUserId,
    assigneeUserId: row.assignedToUserId,
    equipment: equipmentLabel(row.equipmentSnapshot),
    detail: null,
  }
}

type Created = { id: string; folio: string; version: number; status: OtStatus }

async function findByClientRequest(client: Pick<Tx, "select">, clientRequestId: string) {
  const [row] = await client
    .select({ id: mantWorkOrders.id, folio: mantWorkOrders.folio, version: mantWorkOrders.version, status: mantWorkOrders.status, requestedByUserId: mantWorkOrders.requestedByUserId })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.clientRequestId, clientRequestId))
    .limit(1)
  return row ?? null
}

function existingResult(existing: NonNullable<Awaited<ReturnType<typeof findByClientRequest>>>, userId: string): WorkOrderResult<Created> {
  if (existing.requestedByUserId !== userId) {
    return { ok: false, message: "Ese identificador de solicitud ya pertenece a otra persona.", code: "conflict" }
  }
  return { ok: true, value: { id: existing.id, folio: existing.folio, version: existing.version, status: existing.status as OtStatus } }
}

/**
 * Alta web de una OT. Idempotente por `clientRequestId` (el formulario lo genera
 * al abrirse): reenviar el mismo formulario devuelve la OT ya creada. Exige
 * `mant:ot:create`, que la faena del equipo esté en el alcance de quien crea
 * (un rol global, todas) y `mant:ot:manage` para asignar al crear.
 */
export async function createWorkOrder(actor: WorkOrderActor, input: CreateWorkOrderInput): Promise<WorkOrderResult<Created>> {
  if (!actor.permissions.includes(OT_PERMISSIONS.create)) return { ok: false, message: "No tienes permiso para crear órdenes de trabajo.", code: "forbidden" }
  if (input.assignedToUserId && !actor.permissions.includes(OT_PERMISSIONS.manage)) {
    return { ok: false, message: "Sólo la jefatura de mantención puede asignar al crear la OT.", code: "forbidden", field: "assignedToUserId" }
  }

  const already = await findByClientRequest(db, input.clientRequestId)
  if (already) return existingResult(already, actor.userId)

  try {
    const row = await db.transaction(async (tx) => {
      // El alcance se mira con el equipo bloqueado y ya leído: su faena no puede cambiar bajo nuestros pies.
      const vehicle = await lockVehicle(tx, input.vehicleId)
      if (!vehicle) refuse("Ese equipo no existe o no está en el módulo de mantención.", "invalid", "vehicleId")
      if (!vehicle.isActive) refuse(`El equipo ${vehicle.code} está dado de baja: no admite órdenes de trabajo.`, "invalid", "vehicleId")
      if (!inWorksiteScope(actor, vehicle.worksiteId)) {
        refuse(`El equipo ${vehicle.code} es de ${vehicle.worksiteName}, que no está entre tus faenas.`, "forbidden", "vehicleId")
      }
      // Dos envíos simultáneos del mismo formulario se serializan en el bloqueo del equipo: el segundo ve al primero aquí.
      const raced = await findByClientRequest(tx, input.clientRequestId)
      if (raced) return { raced }

      checkRequestFields(input)
      const items = normalizeItems(input.annexItems, input.maintenanceItems)
      if (input.assignedToUserId && !(await findAssignableMechanic(tx, input.assignedToUserId))) {
        refuse("Ese mecánico no existe, está inactivo o no puede ejecutar órdenes de trabajo.", "invalid", "assignedToUserId")
      }
      const created = await insertLocked(tx, {
        vehicleId: input.vehicleId,
        repair: input.repair,
        maintenance: input.maintenance,
        requestDate: input.requestDate,
        requesterName: input.requesterName,
        repairDescription: input.repairDescription,
        observations: input.observations,
        items,
        inspectionFindingId: null,
        clientRequestId: input.clientRequestId,
        assignedToUserId: input.assignedToUserId,
      }, actor, vehicle)
      return { created }
    })
    if ("raced" in row && row.raced) return existingResult(row.raced, actor.userId)
    const created = (row as { created: OtRow }).created
    const plans: NotificationPlan[] = [createdPlan(created), ...(created.assignedToUserId
      ? [{ ...createdPlan(created), event: "assigned" as const, actorUserId: actor.userId }]
      : [])]
    dispatchWorkOrderNotifications(plans)
    return { ok: true, value: { id: created.id, folio: created.folio, version: created.version, status: created.status as OtStatus } }
  } catch (error) {
    const failure = failureOf(error)
    if (failure) return failure
    // Carrera por el índice único de `client_request_id`: otro envío del mismo formulario confirmó primero.
    if (isUniqueViolation(error)) {
      const winner = await findByClientRequest(db, input.clientRequestId)
      if (winner) return existingResult(winner, actor.userId)
    }
    throw error
  }
}
