/**
 * Guías de Despacho Internas (GDI) — servicio.
 *
 * Documento interno de traslado **Oficina CHOME → Faena**, para control y
 * trazabilidad logística. No es un DTE del SII: sin folio tributario, sin CAF,
 * sin firma electrónica, sin integración con el SII.
 *
 * ## Origen
 * Siempre la faena que representa la bodega de la oficina central. Se resuelve
 * en el backend (`resolveOfficeWorksite`) y nunca viaja en el formulario, así
 * que la dirección del traslado no es un dato de entrada: no existe
 * faena → oficina, faena → faena ni oficina → oficina.
 *
 * ## Integración con Bodega
 * Al despachar, cada línea genera **dos** movimientos de kardex dentro de la
 * misma transacción: `egreso_traslado` en la oficina y `ingreso_traslado` en la
 * faena de destino, ambos con `referenceType = 'dispatch_guide'` y
 * `referenceId = <id de la guía>`. Las dos patas existen porque el stock de
 * esta plataforma es por faena: descontar en la oficina sin abonar en el
 * destino haría desaparecer los bienes del inventario, que es justamente lo
 * que la guía documenta que no pasó.
 *
 * El bloqueo (`SELECT … FOR UPDATE`) sobre la fila de la guía es el punto de
 * serialización: dos despachos simultáneos de la misma guía se ordenan, y el
 * segundo encuentra el estado ya movido y falla sin descontar de nuevo.
 *
 * ## Recepción y diferencias
 * Confirmar la recepción **no** mueve stock: el traslado ya se registró al
 * despachar. Por eso esta versión no implementa recepción parcial ni
 * diferencias despachado/recibido: no hay base arquitectónica para stock "en
 * tránsito" (no existe una ubicación intermedia en `worksite_stock`), y
 * partirla en dos etapas dejaría a los bienes sin dueño mientras viajan. Una
 * diferencia real se regulariza hoy con el ajuste de inventario de Bodega
 * (`AJU-*`), que ya exige motivo y queda en el kardex.
 */

import { and, asc, count, desc, eq, gt, gte, inArray, lte, ne, notInArray, sql, type SQL } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  dispatchGuideItems,
  dispatchGuides,
  fuelVehicles,
  inventoryMovements,
  purchaseOrderItems,
  purchaseOrders,
  products,
  receiptItems,
  receipts,
  systemSettings,
  users,
  workers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { textSearchSql } from "@/lib/adquisiciones/list-query"
import { nanoid } from "@/lib/id"
import { getProductSizesByIds } from "@/lib/services/product-sizes"
import { formatSizedProductName } from "@/lib/products/product-size"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { applyMovementTx } from "@/lib/services/stock"
import { closeOrderTx } from "@/lib/services/purchasing-module/receiving"
import { receiveItemTx } from "@/lib/services/item-state"
import type { DispatchGuideInput } from "@/lib/validation/dispatch-guides"

/* ── Constantes de dominio ──────────────────────────────────────────────── */

/**
 * Respaldo del rótulo de origen cuando la faena-oficina no se puede resolver.
 * El nombre real sale de `officeWorksiteLabel`; esto es sólo la última carta.
 */
export const OFFICE_ORIGIN_LABEL = "Oficina CHOME"

/** Referencia de kardex que une guía ↔ movimiento en los dos sentidos. */
export const DISPATCH_GUIDE_REFERENCE_TYPE = "dispatch_guide"

/** Ajustable sin tocar código: `system_settings.key`. */
export const OFFICE_WORKSITE_SETTING_KEY = "warehouse.office_worksite_id"

/** Fallback por nombre cuando no hay ajuste explícito. */
const OFFICE_WORKSITE_NAME_FALLBACKS = [
  "administracion", "oficina", "oficina central", "oficina chome", "casa matriz",
]

export type DispatchGuideStatus = "draft" | "dispatched" | "partially_received" | "received" | "cancelled"

const CANCELLABLE_STATUSES: DispatchGuideStatus[] = ["draft", "dispatched", "partially_received", "received"]

/* ── Origen: la bodega de la oficina ────────────────────────────────────── */

export interface OfficeWorksite {
  id: string
  name: string
  code: string
}

type Reader = Pick<DB, "select">
type SettingsWriter = Pick<DB, "select" | "insert" | "delete">

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase()
}

/**
 * Resuelve la faena que representa la bodega de la oficina central.
 *
 * 1. `system_settings['warehouse.office_worksite_id']`, si está configurado.
 * 2. Si no, la faena activa cuyo nombre corresponda a la oficina
 *    ("Administración", "Oficina", "Oficina Central", "Casa Matriz").
 *
 * Nunca devuelve un texto: la guía guarda la FK a `worksites`, que es la que
 * permite descontar su stock.
 */
export async function resolveOfficeWorksite(client: Reader = db): Promise<OfficeWorksite> {
  const [setting] = await client
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, OFFICE_WORKSITE_SETTING_KEY))
    .limit(1)

  const configuredId = setting?.value?.trim()
  if (configuredId) {
    const [configured] = await client
      .select({ id: worksites.id, name: worksites.name, code: worksites.code })
      .from(worksites)
      .where(and(eq(worksites.id, configuredId), eq(worksites.isActive, true)))
      .limit(1)
    if (configured) return configured
    throw new Error(
      `La bodega de origen configurada (${configuredId}) no existe o está inactiva. ` +
      `Revisa el ajuste "${OFFICE_WORKSITE_SETTING_KEY}".`,
    )
  }

  // El catálogo de faenas es de una decena de filas: filtrar en memoria evita
  // depender de comparaciones sin acentos en SQL (y de que las soporte PGlite).
  const activeWorksites = await client
    .select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(asc(worksites.code))

  const office = activeWorksites.find((worksite) =>
    OFFICE_WORKSITE_NAME_FALLBACKS.includes(normalizeName(worksite.name)),
  )
  if (office) return office

  throw new Error(
    "No se pudo determinar la bodega de la oficina para el despacho. " +
    `Configura el ajuste "${OFFICE_WORKSITE_SETTING_KEY}" con el id de la faena que representa la oficina.`,
  )
}

/**
 * El nombre de la oficina para mostrar en pantalla.
 *
 * Nunca lanza: un rótulo no puede voltear una página. `resolveOfficeWorksite`
 * sí lanza, y debe seguir haciéndolo donde vamos a mover stock —equivocarse de
 * bodega corrompe el kardex—, pero una lista o un subtítulo prefieren un
 * respaldo antes que un 500.
 */
export async function officeWorksiteLabel(client: Reader = db): Promise<string> {
  try {
    return (await resolveOfficeWorksite(client)).name
  } catch {
    return OFFICE_ORIGIN_LABEL
  }
}

/**
 * Fija (o borra) la faena que representa la oficina.
 *
 * Un id vacío borra el ajuste y devuelve el control al calce por nombre. La
 * faena tiene que existir y estar activa: guardar un id muerto convertiría cada
 * despacho en el error que motivó esta pantalla.
 */
export async function setOfficeWorksite(
  worksiteId: string,
  actor: DispatchGuideActor,
  client: SettingsWriter = db,
): Promise<void> {
  const target = worksiteId.trim()
  const now = new Date().toISOString()

  if (target) {
    const [worksite] = await client
      .select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive })
      .from(worksites)
      .where(eq(worksites.id, target))
      .limit(1)
    if (!worksite) throw new Error("La faena indicada no existe")
    if (!worksite.isActive) throw new Error(`La faena "${worksite.name}" no está activa`)
  }

  const [previous] = await client
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, OFFICE_WORKSITE_SETTING_KEY))
    .limit(1)

  if (target) {
    await client.insert(systemSettings)
      .values({ key: OFFICE_WORKSITE_SETTING_KEY, value: target, updatedAt: now })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: target, updatedAt: now } })
  } else {
    await client.delete(systemSettings).where(eq(systemSettings.key, OFFICE_WORKSITE_SETTING_KEY))
  }

  await recordAudit({
    userId:     actor.userId,
    userEmail:  actor.userEmail,
    action:     "update",
    entityType: "system_settings",
    entityId:   OFFICE_WORKSITE_SETTING_KEY,
    oldState:   { worksiteId: previous?.value ?? null },
    newState:   { worksiteId: target || null },
  }, client)
}

/** Faenas activas ofrecibles como oficina, y cuál rige hoy. */
export async function officeWorksiteOptions(): Promise<{
  worksites: OfficeWorksite[]
  configuredId: string
  resolvedId: string | null
}> {
  const [rows, setting, resolved] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name, code: worksites.code })
      .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.code)),
    db.select({ value: systemSettings.value }).from(systemSettings)
      .where(eq(systemSettings.key, OFFICE_WORKSITE_SETTING_KEY)).limit(1),
    resolveOfficeWorksite().catch(() => null),
  ])
  return { worksites: rows, configuredId: setting[0]?.value?.trim() ?? "", resolvedId: resolved?.id ?? null }
}

/* ── Altas y edición ────────────────────────────────────────────────────── */

export interface DispatchGuideActor {
  userId: string
  userEmail?: string
}

type WorksiteScope = string[] | "all"

function assertWorksiteScope(scope: WorksiteScope, worksiteId: string) {
  if (scope !== "all" && !scope.includes(worksiteId)) {
    throw new Error("No tienes acceso a la faena de destino")
  }
}

async function assertDestination(tx: Tx, officeId: string, destinationWorksiteId: string, scope: WorksiteScope) {
  if (destinationWorksiteId === officeId) {
    throw new Error("El destino debe ser una faena distinta de la bodega de origen")
  }
  const [destination] = await tx
    .select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive })
    .from(worksites)
    .where(eq(worksites.id, destinationWorksiteId))
    .limit(1)
  if (!destination) throw new Error("La faena de destino no existe")
  if (!destination.isActive) throw new Error(`La faena "${destination.name}" no está activa`)
  assertWorksiteScope(scope, destination.id)
  return destination
}

async function assertItemProducts(tx: Tx, items: DispatchGuideInput["items"]) {
  const productIds = [...new Set(items.map((item) => item.productId))]
  const rows = await tx
    .select({ id: products.id, name: products.name, isActive: products.isActive })
    .from(products)
    .where(inArray(products.id, productIds))

  if (rows.length !== productIds.length) {
    throw new Error("Hay líneas que apuntan a un producto que no existe en el catálogo")
  }
  const inactive = rows.filter((row) => !row.isActive)
  if (inactive.length > 0) {
    throw new Error(`Producto no disponible: ${inactive.map((row) => row.name).join(", ")}`)
  }
}

async function assertWorkerRefs(tx: Tx, ids: Array<string | null | undefined>) {
  const workerIds = [...new Set(ids.filter((id): id is string => !!id))]
  if (workerIds.length === 0) return
  const rows = await tx
    .select({ id: workers.id, isActive: workers.isActive })
    .from(workers)
    .where(inArray(workers.id, workerIds))
  if (rows.length !== workerIds.length) throw new Error("Un colaborador indicado no existe")
  if (rows.some((row) => !row.isActive)) throw new Error("Un colaborador indicado está inactivo")
}

async function assertVehicleRef(tx: Tx, vehicleId: string | null | undefined) {
  if (!vehicleId) return
  const [vehicle] = await tx
    .select({ id: fuelVehicles.id, isActive: fuelVehicles.isActive })
    .from(fuelVehicles)
    .where(eq(fuelVehicles.id, vehicleId))
    .limit(1)
  if (!vehicle) throw new Error("El vehículo indicado no existe")
  if (!vehicle.isActive) throw new Error("El vehículo indicado está inactivo")
}

function itemRows(guideId: string, items: DispatchGuideInput["items"]) {
  return items.map((item, index) => ({
    id:            nanoid(),
    guideId,
    productId:     item.productId,
    quantity:      item.quantity,
    unitOfMeasure: item.unitOfMeasure,
    notes:         item.notes ?? null,
    sortOrder:     index,
  }))
}

export interface PreparedDispatchGuide {
  id: string
  code: string
  itemCount: number
}

/**
 * Prepara la GDI desde una recepción de proveedor ya confirmada en oficina.
 *
 * Esta función corre dentro de la misma transacción que inserta la recepción:
 * si falla, no queda una recepción sin su siguiente paso. Sólo toma bienes de
 * catálogo, omite servicios y usa la cantidad buena de ese comprobante. La
 * faena de la OC es la única destination; los históricos sin estas FK siguen
 * siendo válidos y no entran por este camino.
 */
export async function prepareDispatchGuideForOfficeReceiptTx(
  tx: Tx,
  input: { receiptId: string; purchaseOrderId: string; preparedBy: string; userEmail?: string },
): Promise<PreparedDispatchGuide | null> {
  const [receipt] = await tx
    .select({
      id: receipts.id,
      locationType: receipts.locationType,
      purchaseOrderId: receipts.purchaseOrderId,
    })
    .from(receipts)
    .where(eq(receipts.id, input.receiptId))
    .limit(1)
  if (!receipt || receipt.purchaseOrderId !== input.purchaseOrderId) {
    throw new Error("La recepción no pertenece a la orden de compra")
  }
  if (receipt.locationType !== "office") return null

  const [order] = await tx
    .select({ id: purchaseOrders.id, deliveryMode: purchaseOrders.deliveryMode, worksiteId: purchaseOrders.worksiteId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.purchaseOrderId))
    .limit(1)
  if (!order || order.deliveryMode !== "via_oficina") return null

  const office = await resolveOfficeWorksite(tx)
  if (order.worksiteId === office.id) return null

  // A retried transaction/action must not mint a second document for the same
  // receipt. A later partial dispatch can create another draft explicitly with
  // the remaining quantities; this automatic preparation is idempotent.
  const [existing] = await tx
    .select({ id: dispatchGuides.id, code: dispatchGuides.code })
    .from(dispatchGuides)
    .where(and(eq(dispatchGuides.receiptId, input.receiptId), ne(dispatchGuides.status, "cancelled")))
    .limit(1)
  if (existing) return { ...existing, itemCount: 0 }

  const rows = await tx
    .select({
      purchaseOrderItemId: purchaseOrderItems.id,
      receiptItemId: receiptItems.id,
      productId: products.id,
      quantity: receiptItems.quantityReceived,
      unitOfMeasure: purchaseOrderItems.unitOfMeasure,
      notes: receiptItems.notes,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .innerJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id))
    .innerJoin(purchaseOrderItems, eq(receiptItems.purchaseOrderItemId, purchaseOrderItems.id))
    .innerJoin(products, eq(purchaseOrderItems.productId, products.id))
    .where(and(
      eq(receiptItems.receiptId, input.receiptId),
      eq(receipts.purchaseOrderId, input.purchaseOrderId),
      eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId),
      eq(products.isService, false),
      gt(receiptItems.quantityReceived, 0),
    ))
    .orderBy(asc(receiptItems.id))

  if (rows.length === 0) return null

  const id = nanoid()
  const now = new Date().toISOString()
  const code = await nextCodeTx(tx, "GDI")
  await tx.insert(dispatchGuides).values({
    id,
    code,
    status: "draft",
    originWorksiteId: office.id,
    destinationWorksiteId: order.worksiteId,
    purchaseOrderId: input.purchaseOrderId,
    receiptId: input.receiptId,
    issuedBy: input.preparedBy,
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(dispatchGuideItems).values(rows.map((row, index) => ({
    id: nanoid(),
    guideId: id,
    productId: row.productId,
    purchaseOrderItemId: row.purchaseOrderItemId,
    receiptItemId: row.receiptItemId,
    quantity: row.quantity,
    unitOfMeasure: row.unitOfMeasure,
    notes: row.notes,
    sortOrder: index,
  })))

  await recordStatusChange({
    entityType: "dispatch_guide",
    entityId: id,
    fromStatus: null,
    toStatus: "draft",
    changedBy: input.preparedBy,
  }, tx)
  await recordAudit({
    userId: input.preparedBy,
    userEmail: input.userEmail,
    action: "create",
    entityType: "dispatch_guide",
    entityId: id,
    entityCode: code,
    newState: {
      source: "office_receipt",
      receiptId: input.receiptId,
      purchaseOrderId: input.purchaseOrderId,
      destinationWorksiteId: order.worksiteId,
      itemCount: rows.length,
    },
  }, tx)

  return { id, code, itemCount: rows.length }
}

/** Crea otra GDI para el saldo de una recepción que se despacha por partes. */
export async function prepareAdditionalDispatchGuideForOfficeReceipt(
  receiptId: string,
  actor: DispatchGuideActor,
  scope: WorksiteScope = "all",
): Promise<PreparedDispatchGuide> {
  return db.transaction(async (tx) => {
    const [receipt] = await tx
      .select({ id: receipts.id, purchaseOrderId: receipts.purchaseOrderId, locationType: receipts.locationType })
      .from(receipts)
      .where(eq(receipts.id, receiptId))
      .for("update")
    if (!receipt || receipt.locationType !== "office") throw new Error("La recepción de origen no es una recepción en oficina")

    const [order] = await tx
      .select({ id: purchaseOrders.id, worksiteId: purchaseOrders.worksiteId, deliveryMode: purchaseOrders.deliveryMode })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, receipt.purchaseOrderId))
      .for("update")
    if (!order || order.deliveryMode !== "via_oficina") throw new Error("La OC no requiere traslado Oficina → Faena")
    const office = await resolveOfficeWorksite(tx)
    if (order.worksiteId === office.id) throw new Error("La OC tiene destino final en oficina")
    assertWorksiteScope(scope, order.worksiteId)

    const rows = await tx
      .select({
        receiptItemId: receiptItems.id,
        purchaseOrderItemId: purchaseOrderItems.id,
        productId: products.id,
        quantity: receiptItems.quantityReceived,
        unitOfMeasure: purchaseOrderItems.unitOfMeasure,
        notes: receiptItems.notes,
      })
      .from(receiptItems)
      .innerJoin(purchaseOrderItems, eq(receiptItems.purchaseOrderItemId, purchaseOrderItems.id))
      .innerJoin(products, eq(purchaseOrderItems.productId, products.id))
      .where(and(
        eq(receiptItems.receiptId, receiptId),
        eq(purchaseOrderItems.purchaseOrderId, order.id),
        eq(products.isService, false),
        gt(receiptItems.quantityReceived, 0),
      ))
      .orderBy(asc(receiptItems.id))
    const activeIds = rows.map((row) => row.receiptItemId)
    if (activeIds.length === 0) throw new Error("Esta recepción no tiene bienes trasladables")

    const allocated = await tx
      .select({ receiptItemId: dispatchGuideItems.receiptItemId, quantity: sql<number>`coalesce(sum(${dispatchGuideItems.quantity}), 0)` })
      .from(dispatchGuideItems)
      .innerJoin(dispatchGuides, eq(dispatchGuideItems.guideId, dispatchGuides.id))
      .where(and(inArray(dispatchGuideItems.receiptItemId, activeIds), ne(dispatchGuides.status, "cancelled")))
      .groupBy(dispatchGuideItems.receiptItemId)
    const allocatedByReceiptItem = new Map(allocated.map((row) => [row.receiptItemId, Number(row.quantity)]))
    const remaining = rows.flatMap((row) => {
      const quantity = row.quantity - (allocatedByReceiptItem.get(row.receiptItemId) ?? 0)
      return quantity > 1e-9 ? [{ ...row, quantity }] : []
    })
    if (remaining.length === 0) throw new Error("No quedan cantidades recibidas disponibles para otro despacho")

    const [existingDraft] = await tx
      .select({ id: dispatchGuides.id, code: dispatchGuides.code })
      .from(dispatchGuides)
      .where(and(eq(dispatchGuides.receiptId, receiptId), eq(dispatchGuides.status, "draft")))
      .limit(1)
    if (existingDraft) return { ...existingDraft, itemCount: 0 }

    const id = nanoid()
    const now = new Date().toISOString()
    const code = await nextCodeTx(tx, "GDI")
    await tx.insert(dispatchGuides).values({
      id, code, status: "draft", originWorksiteId: office.id, destinationWorksiteId: order.worksiteId,
      purchaseOrderId: order.id, receiptId, issuedBy: actor.userId, issuedAt: now, createdAt: now, updatedAt: now,
    })
    await tx.insert(dispatchGuideItems).values(remaining.map((row, index) => ({
      id: nanoid(), guideId: id, productId: row.productId, purchaseOrderItemId: row.purchaseOrderItemId,
      receiptItemId: row.receiptItemId, quantity: row.quantity, unitOfMeasure: row.unitOfMeasure,
      notes: row.notes, sortOrder: index,
    })))
    await recordStatusChange({ entityType: "dispatch_guide", entityId: id, fromStatus: null, toStatus: "draft", changedBy: actor.userId }, tx)
    await recordAudit({
      userId: actor.userId, userEmail: actor.userEmail, action: "create", entityType: "dispatch_guide", entityId: id, entityCode: code,
      newState: { source: "office_receipt_remainder", receiptId, purchaseOrderId: order.id, itemCount: remaining.length },
    }, tx)
    return { id, code, itemCount: remaining.length }
  })
}

/**
 * Crea la guía en estado borrador con su correlativo definitivo.
 *
 * El folio se reserva acá (misma convención que OC y solicitudes) usando la
 * SEQUENCE nativa: es atómica y a prueba de concurrencia.
 */
export async function createDispatchGuide(
  input: DispatchGuideInput,
  actor: DispatchGuideActor,
  scope: WorksiteScope = "all",
): Promise<{ id: string; code: string }> {
  return db.transaction(async (tx) => {
    const office = await resolveOfficeWorksite(tx)
    const destination = await assertDestination(tx, office.id, input.destinationWorksiteId, scope)
    await assertItemProducts(tx, input.items)
    await assertWorkerRefs(tx, [input.dispatcherWorkerId, input.receiverWorkerId, input.driverWorkerId])
    await assertVehicleRef(tx, input.vehicleId)

    const id = nanoid()
    const now = new Date().toISOString()
    const code = await nextCodeTx(tx, "GDI")

    await tx.insert(dispatchGuides).values({
      id,
      code,
      status: "draft",
      originWorksiteId:      office.id,
      destinationWorksiteId: destination.id,
      issuedBy:              actor.userId,
      issuedAt:              now,
      dispatcherWorkerId:    input.dispatcherWorkerId ?? null,
      receiverWorkerId:      input.receiverWorkerId ?? null,
      vehicleId:             input.vehicleId ?? null,
      driverWorkerId:        input.driverWorkerId ?? null,
      notes:                 input.notes ?? null,
      createdAt:             now,
      updatedAt:             now,
    })
    await tx.insert(dispatchGuideItems).values(itemRows(id, input.items))

    await recordStatusChange({
      entityType: "dispatch_guide",
      entityId:   id,
      fromStatus: null,
      toStatus:   "draft",
      changedBy:  actor.userId,
    }, tx)
    await recordAudit({
      userId:     actor.userId,
      userEmail:  actor.userEmail,
      action:     "create",
      entityType: "dispatch_guide",
      entityId:   id,
      entityCode: code,
      newState: {
        originWorksiteId:      office.id,
        destinationWorksiteId: destination.id,
        items: input.items.length,
      },
    }, tx)

    return { id, code }
  })
}

/** Edita un borrador: reemplaza cabecera y líneas. Fuera de `draft` falla. */
export async function updateDispatchGuide(
  guideId: string,
  input: DispatchGuideInput,
  actor: DispatchGuideActor,
  scope: WorksiteScope = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const guide = await lockGuide(tx, guideId)
    if (guide.status !== "draft") {
      throw new Error("Solo una guía en borrador puede editarse. Una guía despachada es un hecho histórico.")
    }
    assertWorksiteScope(scope, guide.destinationWorksiteId)
    const destination = await assertDestination(tx, guide.originWorksiteId, input.destinationWorksiteId, scope)
    if (guide.purchaseOrderId && destination.id !== guide.destinationWorksiteId) {
      throw new Error("La faena de una GDI de adquisiciones se hereda de la OC y no puede cambiarse")
    }
    await assertItemProducts(tx, input.items)
    await assertWorkerRefs(tx, [input.dispatcherWorkerId, input.receiverWorkerId, input.driverWorkerId])
    await assertVehicleRef(tx, input.vehicleId)

    const now = new Date().toISOString()
    await tx.update(dispatchGuides).set({
      destinationWorksiteId: destination.id,
      dispatcherWorkerId:    input.dispatcherWorkerId ?? null,
      receiverWorkerId:      input.receiverWorkerId ?? null,
      vehicleId:             input.vehicleId ?? null,
      driverWorkerId:        input.driverWorkerId ?? null,
      notes:                 input.notes ?? null,
      updatedAt:             now,
    }).where(and(eq(dispatchGuides.id, guideId), eq(dispatchGuides.status, "draft")))

    if (guide.purchaseOrderId) {
      // Una GDI nacida de una recepción no puede cambiar de OC, faena ni
      // producto. Sí puede seleccionar menos cantidad/líneas para un despacho
      // parcial; las FK hacia OC/recepción se conservan al reemplazar sólo el
      // borrador, antes de que exista un hecho histórico.
      const existingItems = await tx
        .select({
          id: dispatchGuideItems.id,
          productId: dispatchGuideItems.productId,
          purchaseOrderItemId: dispatchGuideItems.purchaseOrderItemId,
          receiptItemId: dispatchGuideItems.receiptItemId,
        })
        .from(dispatchGuideItems)
        .where(eq(dispatchGuideItems.guideId, guideId))
      const existingByProduct = new Map(existingItems.map((item) => [item.productId, item]))
      if (input.items.some((item) => !existingByProduct.has(item.productId))) {
        throw new Error("Una GDI de adquisiciones sólo puede usar bienes de su recepción de origen")
      }
      await tx.delete(dispatchGuideItems).where(eq(dispatchGuideItems.guideId, guideId))
      await tx.insert(dispatchGuideItems).values(input.items.map((item, index) => {
        const source = existingByProduct.get(item.productId)!
        return {
          id: nanoid(),
          guideId,
          productId: item.productId,
          purchaseOrderItemId: source.purchaseOrderItemId,
          receiptItemId: source.receiptItemId,
          quantity: item.quantity,
          unitOfMeasure: item.unitOfMeasure,
          notes: item.notes ?? null,
          sortOrder: index,
        }
      }))

      await recordAudit({
        userId: actor.userId,
        userEmail: actor.userEmail,
        action: "update",
        entityType: "dispatch_guide",
        entityId: guideId,
        entityCode: guide.code,
        oldState: { destinationWorksiteId: guide.destinationWorksiteId, source: "office_receipt" },
        newState: { destinationWorksiteId: destination.id, items: input.items.length, source: "office_receipt" },
      }, tx)
      return
    }

    await tx.delete(dispatchGuideItems).where(eq(dispatchGuideItems.guideId, guideId))
    await tx.insert(dispatchGuideItems).values(itemRows(guideId, input.items))

    await recordAudit({
      userId:     actor.userId,
      userEmail:  actor.userEmail,
      action:     "update",
      entityType: "dispatch_guide",
      entityId:   guideId,
      entityCode: guide.code,
      oldState:   { destinationWorksiteId: guide.destinationWorksiteId },
      newState:   { destinationWorksiteId: destination.id, items: input.items.length },
    }, tx)
  })
}

/* ── Transiciones ───────────────────────────────────────────────────────── */

async function lockGuide(tx: Tx, guideId: string) {
  const [guide] = await tx
    .select()
    .from(dispatchGuides)
    .where(eq(dispatchGuides.id, guideId))
    .for("update")
  if (!guide) throw new Error("Guía de despacho no encontrada")
  return guide
}

async function guideItemsTx(tx: Tx, guideId: string) {
  const rows = await tx
    .select({
      id:        dispatchGuideItems.id,
      productId: dispatchGuideItems.productId,
      purchaseOrderItemId: dispatchGuideItems.purchaseOrderItemId,
      receiptItemId: dispatchGuideItems.receiptItemId,
      quantity:  dispatchGuideItems.quantity,
      quantityReceived: dispatchGuideItems.quantityReceived,
      differenceReason: dispatchGuideItems.differenceReason,
      name:      products.name,
      isService: products.isService,
    })
    .from(dispatchGuideItems)
    .innerJoin(products, eq(dispatchGuideItems.productId, products.id))
    .where(eq(dispatchGuideItems.guideId, guideId))
    .orderBy(asc(dispatchGuideItems.sortOrder))

  // La guía es el documento que viaja con la carga y se coteja en faena: sin la
  // talla, «Zapato SteelPro ×10» no se puede verificar contra lo que llegó.
  const sizeById = await getProductSizesByIds(rows.map((row) => row.productId), tx)
  return rows.map((row) => ({
    ...row,
    name: formatSizedProductName(row.name, sizeById.get(row.productId)),
  }))
}

/**
 * Serializes each OC line and proves that all active guides together fit inside
 * what arrived in office. Drafts reserve their selected quantity as well, so a
 * second operator cannot prepare two documents for the same units and rely on
 * the stock check alone.
 */
async function assertGuideQuantitiesWithinOfficeReceipt(
  tx: Tx,
  guide: { id: string; purchaseOrderId: string | null; destinationWorksiteId: string },
  items: Array<{
    purchaseOrderItemId: string | null
    quantity: number
    isService: boolean
  }>,
) {
  if (!guide.purchaseOrderId) return
  if (items.some((item) => !item.purchaseOrderItemId)) {
    throw new Error("La guía asociada a adquisiciones tiene una línea sin trazabilidad de OC")
  }

  const poItemIds = items.map((item) => item.purchaseOrderItemId as string)
  const lockedItems = await tx
    .select({
      id: purchaseOrderItems.id,
      quantity: purchaseOrderItems.quantity,
      quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
      productId: purchaseOrderItems.productId,
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
    })
    .from(purchaseOrderItems)
    .where(inArray(purchaseOrderItems.id, poItemIds))
    .orderBy(asc(purchaseOrderItems.id))
    .for("update")
  if (lockedItems.length !== poItemIds.length || lockedItems.some((item) => item.purchaseOrderId !== guide.purchaseOrderId)) {
    throw new Error("La guía contiene una línea que ya no pertenece a su orden de compra")
  }
  if (lockedItems.some((item) => !item.productId)) {
    throw new Error("Los servicios no pueden formar parte de una Guía de Despacho Interna")
  }

  const allocations = await tx
    .select({
      purchaseOrderItemId: dispatchGuideItems.purchaseOrderItemId,
      quantity: sql<number>`coalesce(sum(${dispatchGuideItems.quantity}), 0)`,
    })
    .from(dispatchGuideItems)
    .innerJoin(dispatchGuides, eq(dispatchGuideItems.guideId, dispatchGuides.id))
    .where(and(
      inArray(dispatchGuideItems.purchaseOrderItemId, poItemIds),
      ne(dispatchGuides.status, "cancelled"),
    ))
    .groupBy(dispatchGuideItems.purchaseOrderItemId)
  const allocatedByItem = new Map(allocations.map((row) => [row.purchaseOrderItemId, Number(row.quantity)]))

  const order = lockedItems[0]
  if (!order || order.purchaseOrderId !== guide.purchaseOrderId) {
    throw new Error("La guía no tiene una OC válida")
  }
  const [purchaseOrder] = await tx
    .select({ worksiteId: purchaseOrders.worksiteId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, guide.purchaseOrderId))
    .limit(1)
  if (!purchaseOrder || purchaseOrder.worksiteId !== guide.destinationWorksiteId) {
    throw new Error("La faena de la guía no coincide con la faena de su orden de compra")
  }

  const shortages = lockedItems.flatMap((poItem) => {
    const allocated = allocatedByItem.get(poItem.id) ?? 0
    const received = poItem.quantityOfficeReceived ?? 0
    return allocated > received + 1e-9
      ? [`OC ${poItem.id}: recibidas ${received}, comprometidas ${allocated}`]
      : []
  })
  if (shortages.length > 0) {
    throw new Error(`No se puede despachar más de lo recibido en oficina: ${shortages.join("; ")}`)
  }
}

/**
 * Pre-chequeo de saldo con mensaje por producto.
 *
 * No sustituye la validación de `applyMovementTx` (esa es la que gana la
 * carrera y la que impide stock negativo): existe para que el usuario lea
 * *qué* falta en vez de un "disponible 3, solicitado 10" sin nombre.
 */
async function assertEnoughStock(
  tx: Tx,
  worksiteId: string,
  items: Array<{ productId: string; quantity: number; name: string }>,
  buildMessage: (shortages: string[]) => string,
) {
  const stockRows = await tx
    .select({ productId: worksiteStock.productId, quantity: worksiteStock.quantity })
    .from(worksiteStock)
    .where(and(
      eq(worksiteStock.worksiteId, worksiteId),
      inArray(worksiteStock.productId, items.map((item) => item.productId)),
    ))
  const available = new Map(stockRows.map((row) => [row.productId, row.quantity]))

  const shortages = items
    .filter((item) => (available.get(item.productId) ?? 0) < item.quantity)
    .map((item) => `${item.name} (disponible ${available.get(item.productId) ?? 0}, requerido ${item.quantity})`)

  if (shortages.length > 0) throw new Error(buildMessage(shortages))
}

/**
 * Despacha la guía: descuenta en la oficina, abona en la faena y sella el
 * documento. Todo en una transacción; si algo falla, no queda ni stock movido
 * ni guía despachada.
 */
export async function dispatchDispatchGuide(
  guideId: string,
  actor: DispatchGuideActor,
  scope: WorksiteScope = "all",
): Promise<{ code: string; movements: number }> {
  return db.transaction(async (tx) => {
    const guide = await lockGuide(tx, guideId)
    if (guide.status !== "draft") {
      throw new Error(
        guide.status === "cancelled"
          ? "La guía está anulada y no puede despacharse"
          : "La guía ya fue despachada",
      )
    }
    assertWorksiteScope(scope, guide.destinationWorksiteId)

    const items = await guideItemsTx(tx, guideId)
    if (items.length === 0) throw new Error("La guía no tiene elementos que despachar")
    await assertGuideQuantitiesWithinOfficeReceipt(tx, guide, items)
    if (items.some((item) => item.isService)) {
      throw new Error("Los servicios no pueden formar parte de una Guía de Despacho Interna")
    }

    const [destination] = await tx
      .select({ name: worksites.name })
      .from(worksites)
      .where(eq(worksites.id, guide.destinationWorksiteId))
      .limit(1)
    const destinationName = destination?.name ?? "faena"

    await assertEnoughStock(tx, guide.originWorksiteId, items, (shortages) =>
      `Stock insuficiente en ${OFFICE_ORIGIN_LABEL} para: ${shortages.join("; ")}`)

    const now = new Date().toISOString()
    for (const item of items) {
      await applyMovementTx(tx, {
        worksiteId:    guide.originWorksiteId,
        productId:     item.productId,
        type:          "egreso_traslado",
        quantity:      -item.quantity,
        referenceType: DISPATCH_GUIDE_REFERENCE_TYPE,
        referenceId:   guide.id,
        performedBy:   actor.userId,
        userEmail:     actor.userEmail,
        reason:        `Guía ${guide.code} · salida a ${destinationName}`,
      })
      await applyMovementTx(tx, {
        worksiteId:    guide.destinationWorksiteId,
        productId:     item.productId,
        type:          "ingreso_traslado",
        quantity:      item.quantity,
        referenceType: DISPATCH_GUIDE_REFERENCE_TYPE,
        referenceId:   guide.id,
        performedBy:   actor.userId,
        userEmail:     actor.userEmail,
        reason:        `Guía ${guide.code} · ingreso desde ${OFFICE_ORIGIN_LABEL}`,
      })
    }

    // Doble cinturón: la fila ya está bloqueada, pero el `WHERE status='draft'`
    // deja el doble despacho imposible incluso si el bloqueo desapareciera.
    const updated = await tx
      .update(dispatchGuides)
      .set({ status: "dispatched", dispatchedAt: now, dispatchedBy: actor.userId, updatedAt: now })
      .where(and(eq(dispatchGuides.id, guideId), eq(dispatchGuides.status, "draft")))
      .returning({ id: dispatchGuides.id })
    if (updated.length === 0) throw new Error("La guía ya fue despachada")

    await recordStatusChange({
      entityType: "dispatch_guide",
      entityId:   guideId,
      fromStatus: "draft",
      toStatus:   "dispatched",
      changedBy:  actor.userId,
    }, tx)
    await recordAudit({
      userId:     actor.userId,
      userEmail:  actor.userEmail,
      action:     "status_change",
      entityType: "dispatch_guide",
      entityId:   guideId,
      entityCode: guide.code,
      oldState:   { status: "draft" },
      newState:   { status: "dispatched", movements: items.length * 2 },
    }, tx)

    return { code: guide.code, movements: items.length * 2 }
  })
}

export interface DispatchGuideReceiptLineInput {
  guideItemId: string
  quantityReceived: number
  differenceReason?: string | null
}

interface LinkedGuideReceiptContext {
  order: typeof purchaseOrders.$inferSelect
  guideItems: Awaited<ReturnType<typeof guideItemsTx>>
}

async function loadLinkedGuideReceiptContext(tx: Tx, guide: typeof dispatchGuides.$inferSelect): Promise<LinkedGuideReceiptContext | null> {
  if (!guide.purchaseOrderId) return null
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, guide.purchaseOrderId))
    .for("update")
  if (!order) throw new Error("La orden de compra de la guía no existe")
  if (order.worksiteId !== guide.destinationWorksiteId || order.deliveryMode !== "via_oficina") {
    throw new Error("La guía no corresponde al destino de su orden de compra")
  }
  const guideItems = await guideItemsTx(tx, guide.id)
  if (guideItems.length === 0 || guideItems.some((item) => !item.purchaseOrderItemId || !item.receiptItemId || item.isService)) {
    throw new Error("La guía no tiene líneas de bienes trazables para cotejar")
  }
  return { order, guideItems }
}

async function rollupOrderAfterGuideReceiptTx(tx: Tx, orderId: string): Promise<string | null> {
  const items = await tx
    .select({ quantity: purchaseOrderItems.quantity, received: purchaseOrderItems.quantityReceived })
    .from(purchaseOrderItems)
    .where(and(eq(purchaseOrderItems.purchaseOrderId, orderId), ne(purchaseOrderItems.status, "cancelled")))
  if (items.length === 0) return null
  const allReceived = items.every((item) => (item.received ?? 0) >= item.quantity)
  const anyReceived = items.some((item) => (item.received ?? 0) > 0)
  const nextStatus = allReceived ? "received" : anyReceived ? "partially_received" : null
  if (!nextStatus) return null
  await tx.update(purchaseOrders).set({ status: nextStatus, updatedAt: new Date().toISOString() }).where(
    and(eq(purchaseOrders.id, orderId), notInArray(purchaseOrders.status, ["closed", "cancelled"])),
  )
  return nextStatus
}

/** Confirma y coteja la llegada a faena. No vuelve a mover stock. */
export async function confirmDispatchGuideReceipt(
  guideId: string,
  input: { receivedByWorkerId?: string | null; items?: DispatchGuideReceiptLineInput[]; notes?: string | null },
  actor: DispatchGuideActor,
  scope: WorksiteScope = "all",
): Promise<{ code: string }> {
  return db.transaction(async (tx) => {
    const guide = await lockGuide(tx, guideId)
    if (guide.status === "received") throw new Error("La recepción de esta guía ya fue confirmada")
    if (guide.status !== "dispatched" && guide.status !== "partially_received") {
      throw new Error(
        guide.status === "draft"
          ? "La guía todavía no ha sido despachada"
          : "La guía está anulada",
      )
    }
    assertWorksiteScope(scope, guide.destinationWorksiteId)
    await assertWorkerRefs(tx, [input.receivedByWorkerId])
    const now = new Date().toISOString()

    const linked = await loadLinkedGuideReceiptContext(tx, guide)
    if (linked) {
      const lines = input.items ?? []
      const expectedIds = new Set(linked.guideItems.map((item) => item.id))
      if (lines.length !== expectedIds.size || new Set(lines.map((line) => line.guideItemId)).size !== lines.length || lines.some((line) => !expectedIds.has(line.guideItemId))) {
        throw new Error("Debes cotejar todas las líneas de la guía exactamente una vez")
      }

      const poItemIds = linked.guideItems.map((item) => item.purchaseOrderItemId as string)
      const lockedPoItems = await tx
        .select()
        .from(purchaseOrderItems)
        .where(inArray(purchaseOrderItems.id, poItemIds))
        .orderBy(asc(purchaseOrderItems.id))
        .for("update")
      if (lockedPoItems.length !== poItemIds.length) throw new Error("Una línea de la OC ya no está disponible")
      const poItemById = new Map(lockedPoItems.map((item) => [item.id, item]))
      const lineById = new Map(lines.map((line) => [line.guideItemId, line]))
      const normalized = linked.guideItems.map((guideItem) => {
        const line = lineById.get(guideItem.id)!
        const quantityReceived = Number(line.quantityReceived)
        if (!Number.isFinite(quantityReceived) || quantityReceived < 0 || quantityReceived > guideItem.quantity) {
          throw new Error(`La cantidad recibida en faena para ${guideItem.name} no es válida`)
        }
        const alreadyReceived = guideItem.quantityReceived ?? 0
        const remaining = guideItem.quantity - alreadyReceived
        if (quantityReceived > remaining + 1e-9) {
          throw new Error(`La cantidad recibida en faena para ${guideItem.name} supera el saldo pendiente`)
        }
        const nextGuideItemReceived = alreadyReceived + quantityReceived
        const difference = remaining - quantityReceived
        const differenceReason = line.differenceReason?.trim() || null
        if (difference > 1e-9 && (!differenceReason || differenceReason.length < 5)) {
          throw new Error(`Indica el motivo de la diferencia para ${guideItem.name}`)
        }
        const poItem = poItemById.get(guideItem.purchaseOrderItemId as string)
        if (!poItem) throw new Error("La línea de la OC no existe")
        const nextReceived = (poItem.quantityReceived ?? 0) + quantityReceived
        if (nextReceived > poItem.quantity + 1e-9) {
          throw new Error(`La recepción en faena excede la cantidad comprada de ${guideItem.name}`)
        }
        return { guideItem, quantityReceived, difference, differenceReason, poItem, nextReceived, nextGuideItemReceived }
      })

      const receiptId = nanoid()
      const receiptCode = await nextCodeTx(tx, "REC", new Date().getFullYear())
      await tx.insert(receipts).values({
        id: receiptId,
        code: receiptCode,
        purchaseOrderId: linked.order.id,
        receivedBy: actor.userId,
        receivedAt: now,
        locationType: "faena",
        worksiteId: guide.destinationWorksiteId,
        dispatchGuideNo: guide.code,
        status: "closed",
        notes: input.notes ?? null,
        createdAt: now,
      })
      await recordOperationalActivity({
        eventType: "receipt.registered",
        module: "recepciones",
        entityType: "receipt",
        entityId: receiptId,
        entityCode: receiptCode,
        worksiteId: guide.destinationWorksiteId,
        actorUserId: actor.userId,
        payload: {
          stage: "faena",
          dispatchGuideId: guide.id,
          differences: normalized.filter((line) => line.difference > 1e-9).length,
        },
      }, tx)

      for (const line of normalized) {
        await tx.insert(receiptItems).values({
          id: nanoid(),
          receiptId,
          purchaseOrderItemId: line.poItem.id,
          quantityReceived: line.quantityReceived,
          quantityRejected: 0,
          quantityDamaged: 0,
          quantityDifference: line.difference,
          status: line.difference > 1e-9 ? "partially_received" : "received",
          notes: line.differenceReason,
        })
        await tx.update(purchaseOrderItems)
          .set({ quantityReceived: line.nextReceived })
          .where(eq(purchaseOrderItems.id, line.poItem.id))
        if (line.poItem.requestItemId) {
          await receiveItemTx(tx, line.poItem.requestItemId, actor.userId, {
            fullReceived: line.nextReceived >= line.poItem.quantity,
            userEmail: actor.userEmail,
          })
        }
        await tx.update(dispatchGuideItems)
          .set({
            quantityReceived: line.nextGuideItemReceived,
            differenceReason: line.differenceReason ?? line.guideItem.differenceReason,
          })
          .where(eq(dispatchGuideItems.id, line.guideItem.id))
      }

      const complete = normalized.every((line) => line.difference <= 1e-9)
      const nextGuideStatus: DispatchGuideStatus = complete ? "received" : "partially_received"
      await tx.update(dispatchGuides).set({
        status: nextGuideStatus,
        receivedAt: now,
        receivedBy: actor.userId,
        receivedByWorkerId: input.receivedByWorkerId ?? guide.receiverWorkerId ?? null,
        updatedAt: now,
      }).where(and(
        eq(dispatchGuides.id, guideId),
        inArray(dispatchGuides.status, ["dispatched", "partially_received"]),
      ))

      const orderStatus = await rollupOrderAfterGuideReceiptTx(tx, linked.order.id)
      if (orderStatus === "received") {
        await closeOrderTx(tx, { ...linked.order, status: "received" }, actor.userId, "Cierre automático: cotejo completo de GDI", { userEmail: actor.userEmail })
      }

      if (guide.status !== nextGuideStatus) {
        await recordStatusChange({
          entityType: "dispatch_guide",
          entityId: guideId,
          fromStatus: guide.status,
          toStatus: nextGuideStatus,
          changedBy: actor.userId,
        }, tx)
      }
      await recordAudit({
        userId: actor.userId,
        userEmail: actor.userEmail,
        action: "status_change",
        entityType: "dispatch_guide",
        entityId: guideId,
        entityCode: guide.code,
        oldState: { status: guide.status },
        newState: {
          status: nextGuideStatus,
          receiptId,
          receiptCode,
          complete,
          differences: normalized.filter((line) => line.difference > 1e-9).length,
        },
      }, tx)
      return { code: guide.code }
    }

    const updated = await tx
      .update(dispatchGuides)
      .set({
        status:             "received",
        receivedAt:         now,
        receivedBy:         actor.userId,
        receivedByWorkerId: input.receivedByWorkerId ?? guide.receiverWorkerId ?? null,
        updatedAt:          now,
      })
      .where(and(eq(dispatchGuides.id, guideId), eq(dispatchGuides.status, "dispatched")))
      .returning({ id: dispatchGuides.id })
    if (updated.length === 0) throw new Error("La recepción de esta guía ya fue confirmada")

    await recordStatusChange({
      entityType: "dispatch_guide",
      entityId:   guideId,
      fromStatus: "dispatched",
      toStatus:   "received",
      changedBy:  actor.userId,
    }, tx)
    await recordAudit({
      userId:     actor.userId,
      userEmail:  actor.userEmail,
      action:     "status_change",
      entityType: "dispatch_guide",
      entityId:   guideId,
      entityCode: guide.code,
      oldState:   { status: "dispatched" },
      newState:   { status: "received", receivedByWorkerId: input.receivedByWorkerId ?? null },
    }, tx)

    return { code: guide.code }
  })
}

/**
 * Anula la guía. Nunca borra la fila.
 *
 * Si ya había salida de stock, la reversa son dos movimientos nuevos (sale de
 * la faena, vuelve a la oficina): el kardex conserva el despacho original y
 * suma su corrección. Si la faena ya consumió los bienes, la anulación se
 * rechaza antes de tocar nada — dejar stock negativo o "arreglar" el histórico
 * no son opciones.
 */
export async function cancelDispatchGuide(
  guideId: string,
  input: { reason: string },
  actor: DispatchGuideActor,
  scope: WorksiteScope = "all",
): Promise<{ code: string; reversedMovements: number }> {
  const reason = input.reason.trim()
  if (reason.length < 5) throw new Error("Indica el motivo de la anulación (mínimo 5 caracteres)")

  return db.transaction(async (tx) => {
    const guide = await lockGuide(tx, guideId)
    if (guide.status === "cancelled") throw new Error("La guía ya está anulada")
    if (!CANCELLABLE_STATUSES.includes(guide.status as DispatchGuideStatus)) {
      throw new Error("La guía no puede anularse en su estado actual")
    }
    assertWorksiteScope(scope, guide.destinationWorksiteId)

    // Una GDI enlazada ya cotejada también puede estar parcialmente recibida,
    // pero anularla en ese punto dejaría desfasados los acumuladores de la OC.
    // El histórico se conserva y la corrección se realiza mediante un ajuste
    // explícito, no borrando ni retrocediendo eventos de recepción.
    if (guide.purchaseOrderId && (guide.status === "partially_received" || guide.status === "received")) {
      throw new Error("Una guía enlazada no puede anularse después del cotejo; registra una corrección de recepción")
    }

    const hadStockEgress = guide.status === "dispatched" || guide.status === "partially_received" || guide.status === "received"
    const items = hadStockEgress ? await guideItemsTx(tx, guideId) : []

    if (hadStockEgress) {
      await assertEnoughStock(tx, guide.destinationWorksiteId, items, (shortages) =>
        "No se puede anular: la faena ya consumió parte de lo despachado " +
        `(${shortages.join("; ")}). Regulariza con un ajuste de inventario en Bodega.`)

      for (const item of items) {
        await applyMovementTx(tx, {
          worksiteId:    guide.destinationWorksiteId,
          productId:     item.productId,
          type:          "egreso_traslado",
          quantity:      -item.quantity,
          referenceType: DISPATCH_GUIDE_REFERENCE_TYPE,
          referenceId:   guide.id,
          performedBy:   actor.userId,
          userEmail:     actor.userEmail,
          reason:        `Anulación guía ${guide.code} · reverso del ingreso en faena`,
          notes:         reason,
        })
        await applyMovementTx(tx, {
          worksiteId:    guide.originWorksiteId,
          productId:     item.productId,
          type:          "ingreso_traslado",
          quantity:      item.quantity,
          referenceType: DISPATCH_GUIDE_REFERENCE_TYPE,
          referenceId:   guide.id,
          performedBy:   actor.userId,
          userEmail:     actor.userEmail,
          reason:        `Anulación guía ${guide.code} · reintegro a ${OFFICE_ORIGIN_LABEL}`,
          notes:         reason,
        })
      }
    }

    const now = new Date().toISOString()
    const updated = await tx
      .update(dispatchGuides)
      .set({
        status:             "cancelled",
        cancelledAt:        now,
        cancelledBy:        actor.userId,
        cancellationReason: reason,
        updatedAt:          now,
      })
      .where(and(eq(dispatchGuides.id, guideId), eq(dispatchGuides.status, guide.status)))
      .returning({ id: dispatchGuides.id })
    if (updated.length === 0) throw new Error("La guía cambió de estado; vuelve a intentarlo")

    await recordStatusChange({
      entityType: "dispatch_guide",
      entityId:   guideId,
      fromStatus: guide.status,
      toStatus:   "cancelled",
      changedBy:  actor.userId,
      reason,
    }, tx)
    await recordAudit({
      userId:     actor.userId,
      userEmail:  actor.userEmail,
      action:     "cancel",
      entityType: "dispatch_guide",
      entityId:   guideId,
      entityCode: guide.code,
      oldState:   { status: guide.status },
      newState:   { status: "cancelled", reversedMovements: items.length * 2 },
      reason,
    }, tx)

    return { code: guide.code, reversedMovements: items.length * 2 }
  })
}

/* ── Consultas ──────────────────────────────────────────────────────────── */

export interface DispatchGuideListFilters {
  /** Predicado de faena ya resuelto por el llamador (`worksiteScopeSql`). */
  scopeSql?: SQL | undefined
  /**
   * Búsqueda por folio. Server-side desde que `/bodega` tomó el buscador de la
   * shell: `ROUTES_WITH_OWN_SEARCH` matchea por prefijo, así que registrar
   * `/bodega` apagó también el input en memoria del que dependía esta lista.
   * La faena de destino ya tiene su propio select al lado, así que el texto
   * busca sólo el código.
   */
  q?: string
  status?: DispatchGuideStatus
  destinationWorksiteId?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

/**
 * `type` y no `interface`: el `DataTable` restringe sus filas a
 * `Record<string, unknown>` y TypeScript no considera que una `interface`
 * cumpla ese índice (sí un alias de tipo).
 */
export type DispatchGuideListRow = {
  id: string
  code: string
  status: string
  issuedAt: string
  destinationWorksiteId: string
  destinationWorksiteName: string
  dispatcherName: string
  itemCount: number
  totalQuantity: number
}

function listWhere(filters: DispatchGuideListFilters) {
  return and(
    filters.scopeSql,
    textSearchSql(filters.q ?? "", [dispatchGuides.code]),
    filters.status ? eq(dispatchGuides.status, filters.status) : undefined,
    filters.destinationWorksiteId ? eq(dispatchGuides.destinationWorksiteId, filters.destinationWorksiteId) : undefined,
    filters.from ? gte(dispatchGuides.issuedAt, `${filters.from}T00:00:00.000Z`) : undefined,
    filters.to ? lte(dispatchGuides.issuedAt, `${filters.to}T23:59:59.999Z`) : undefined,
  )
}

export async function countDispatchGuides(filters: DispatchGuideListFilters): Promise<number> {
  const [row] = await db.select({ total: count() }).from(dispatchGuides).where(listWhere(filters))
  return row?.total ?? 0
}

export async function listDispatchGuides(filters: DispatchGuideListFilters): Promise<DispatchGuideListRow[]> {
  const rows = await db
    .select({
      id:            dispatchGuides.id,
      code:          dispatchGuides.code,
      status:        dispatchGuides.status,
      issuedAt:      dispatchGuides.issuedAt,
      destinationWorksiteId: dispatchGuides.destinationWorksiteId,
      destinationWorksiteName: worksites.name,
      dispatcherFirstName: workers.firstName,
      dispatcherLastName:  workers.lastName,
      issuedByName:  users.name,
      issuedByEmail: users.email,
    })
    .from(dispatchGuides)
    .innerJoin(worksites, eq(dispatchGuides.destinationWorksiteId, worksites.id))
    .innerJoin(users, eq(dispatchGuides.issuedBy, users.id))
    .leftJoin(workers, eq(dispatchGuides.dispatcherWorkerId, workers.id))
    .where(listWhere(filters))
    .orderBy(desc(dispatchGuides.issuedAt))
    .limit(filters.limit ?? 25)
    .offset(filters.offset ?? 0)

  if (rows.length === 0) return []

  const totals = await db
    .select({
      guideId:  dispatchGuideItems.guideId,
      itemCount: count(),
      totalQuantity: sql<number>`coalesce(sum(${dispatchGuideItems.quantity}), 0)`,
    })
    .from(dispatchGuideItems)
    .where(inArray(dispatchGuideItems.guideId, rows.map((row) => row.id)))
    .groupBy(dispatchGuideItems.guideId)
  const totalsByGuide = new Map(totals.map((row) => [row.guideId, row]))

  return rows.map((row) => {
    const totalsRow = totalsByGuide.get(row.id)
    return {
      id:       row.id,
      code:     row.code,
      status:   row.status,
      issuedAt: row.issuedAt,
      destinationWorksiteId:   row.destinationWorksiteId,
      destinationWorksiteName: row.destinationWorksiteName,
      dispatcherName: row.dispatcherFirstName
        ? `${row.dispatcherFirstName} ${row.dispatcherLastName ?? ""}`.trim()
        : row.issuedByName ?? row.issuedByEmail ?? "—",
      itemCount:     Number(totalsRow?.itemCount ?? 0),
      totalQuantity: Number(totalsRow?.totalQuantity ?? 0),
    }
  })
}

export type AcquisitionDispatchGuideSummary = {
  id: string
  code: string
  status: string
  destinationWorksiteId: string
  destinationWorksiteName: string
  receiptId: string | null
  purchaseOrderId: string | null
  issuedAt: string
  itemCount: number
  totalQuantity: number
  receivedQuantity: number
}

async function listAcquisitionGuidesWhere(predicate: SQL) {
  return db
    .select({
      id: dispatchGuides.id,
      code: dispatchGuides.code,
      status: dispatchGuides.status,
      destinationWorksiteId: dispatchGuides.destinationWorksiteId,
      destinationWorksiteName: worksites.name,
      receiptId: dispatchGuides.receiptId,
      purchaseOrderId: dispatchGuides.purchaseOrderId,
      issuedAt: dispatchGuides.issuedAt,
      itemCount: count(dispatchGuideItems.id),
      totalQuantity: sql<number>`coalesce(sum(${dispatchGuideItems.quantity}), 0)`,
      receivedQuantity: sql<number>`coalesce(sum(${dispatchGuideItems.quantityReceived}), 0)`,
    })
    .from(dispatchGuides)
    .innerJoin(worksites, eq(dispatchGuides.destinationWorksiteId, worksites.id))
    .leftJoin(dispatchGuideItems, eq(dispatchGuideItems.guideId, dispatchGuides.id))
    .where(predicate)
    .groupBy(
      dispatchGuides.id,
      dispatchGuides.code,
      dispatchGuides.status,
      dispatchGuides.destinationWorksiteId,
      worksites.name,
      dispatchGuides.receiptId,
      dispatchGuides.purchaseOrderId,
      dispatchGuides.issuedAt,
    )
    .orderBy(desc(dispatchGuides.issuedAt))
}

export function listDispatchGuidesForReceipt(receiptId: string): Promise<AcquisitionDispatchGuideSummary[]> {
  return listAcquisitionGuidesWhere(eq(dispatchGuides.receiptId, receiptId))
}

export function listDispatchGuidesForPurchaseOrder(purchaseOrderId: string): Promise<AcquisitionDispatchGuideSummary[]> {
  return listAcquisitionGuidesWhere(eq(dispatchGuides.purchaseOrderId, purchaseOrderId))
}

/** Ficha completa: cabecera con relaciones, líneas y movimientos de kardex. */
export async function getDispatchGuideDetail(guideId: string) {
  const guide = await db.query.dispatchGuides.findFirst({
    where: eq(dispatchGuides.id, guideId),
    with: {
      originWorksite:      true,
      destinationWorksite: true,
      issuedByUser:        { columns: { id: true, name: true, email: true } },
      dispatchedByUser:    { columns: { id: true, name: true, email: true } },
      receivedByUser:      { columns: { id: true, name: true, email: true } },
      cancelledByUser:     { columns: { id: true, name: true, email: true } },
      dispatcherWorker:    true,
      receiverWorker:      true,
      receivedByWorker:    true,
      driverWorker:        true,
      vehicle:             true,
      purchaseOrder:       {
        columns: { id: true, code: true, status: true, deliveryMode: true },
        with: {
          items: {
            columns: { requestItemId: true },
            with: { requestItem: { columns: { requestId: true }, with: { request: { columns: { id: true, code: true } } } } },
          },
        },
      },
      receipt:             { columns: { id: true, code: true, locationType: true, receivedAt: true } },
      items: {
        orderBy: (item, { asc: ascending }) => [ascending(item.sortOrder)],
        with: { product: { columns: { id: true, sku: true, name: true, unitOfMeasure: true } } },
      },
    },
  })
  if (!guide) return null

  const movements = await db
    .select({
      id:          inventoryMovements.id,
      worksiteId:  inventoryMovements.worksiteId,
      worksiteName: worksites.name,
      productName: products.name,
      productSku:  products.sku,
      type:        inventoryMovements.type,
      quantity:    inventoryMovements.quantity,
      stockBefore: inventoryMovements.stockBefore,
      stockAfter:  inventoryMovements.stockAfter,
      performedAt: inventoryMovements.performedAt,
      reason:      inventoryMovements.reason,
    })
    .from(inventoryMovements)
    .innerJoin(worksites, eq(inventoryMovements.worksiteId, worksites.id))
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(and(
      eq(inventoryMovements.referenceType, DISPATCH_GUIDE_REFERENCE_TYPE),
      eq(inventoryMovements.referenceId, guideId),
    ))
    .orderBy(asc(inventoryMovements.performedAt))

  return { guide, movements }
}

export interface OfficeStockOption {
  productId: string
  sku: string
  name: string
  unitOfMeasure: string
  available: number
}

/** Catálogo del formulario: sólo lo que la oficina tiene en stock hoy. */
export async function listOfficeStockOptions(officeWorksiteId: string): Promise<OfficeStockOption[]> {
  const rows = await db
    .select({
      productId:     products.id,
      sku:           products.sku,
      name:          products.name,
      unitOfMeasure: products.unitOfMeasure,
      available:     worksiteStock.quantity,
    })
    .from(worksiteStock)
    .innerJoin(products, eq(worksiteStock.productId, products.id))
    .where(and(
      eq(worksiteStock.worksiteId, officeWorksiteId),
      eq(products.isActive, true),
      sql`${worksiteStock.quantity} > 0`,
    ))
    .orderBy(asc(products.name))
  return rows
}
