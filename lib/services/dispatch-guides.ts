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

import { and, asc, count, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  dispatchGuideItems,
  dispatchGuides,
  fuelVehicles,
  inventoryMovements,
  products,
  systemSettings,
  users,
  workers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { applyMovementTx } from "@/lib/services/stock"
import type { DispatchGuideInput } from "@/lib/validation/dispatch-guides"

/* ── Constantes de dominio ──────────────────────────────────────────────── */

/** Rótulo del origen en el documento. La entidad real es la faena-oficina. */
export const OFFICE_ORIGIN_LABEL = "Oficina CHOME"

/** Referencia de kardex que une guía ↔ movimiento en los dos sentidos. */
export const DISPATCH_GUIDE_REFERENCE_TYPE = "dispatch_guide"

/** Ajustable sin tocar código: `system_settings.key`. */
export const OFFICE_WORKSITE_SETTING_KEY = "warehouse.office_worksite_id"

/** Fallback por nombre cuando no hay ajuste explícito. */
const OFFICE_WORKSITE_NAME_FALLBACKS = ["administracion", "oficina", "oficina chome", "casa matriz"]

export type DispatchGuideStatus = "draft" | "dispatched" | "received" | "cancelled"

const CANCELLABLE_STATUSES: DispatchGuideStatus[] = ["draft", "dispatched", "received"]

/* ── Origen: la bodega de la oficina ────────────────────────────────────── */

export interface OfficeWorksite {
  id: string
  name: string
  code: string
}

type Reader = Pick<DB, "select">

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase()
}

/**
 * Resuelve la faena que representa la bodega de la oficina central.
 *
 * 1. `system_settings['warehouse.office_worksite_id']`, si está configurado.
 * 2. Si no, la faena activa cuyo nombre corresponda a la oficina
 *    ("Administración", "Oficina", "Casa Matriz").
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
  return tx
    .select({
      id:        dispatchGuideItems.id,
      productId: dispatchGuideItems.productId,
      quantity:  dispatchGuideItems.quantity,
      name:      products.name,
    })
    .from(dispatchGuideItems)
    .innerJoin(products, eq(dispatchGuideItems.productId, products.id))
    .where(eq(dispatchGuideItems.guideId, guideId))
    .orderBy(asc(dispatchGuideItems.sortOrder))
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

/** Confirma la llegada a faena. No vuelve a mover stock. */
export async function confirmDispatchGuideReceipt(
  guideId: string,
  input: { receivedByWorkerId?: string | null },
  actor: DispatchGuideActor,
  scope: WorksiteScope = "all",
): Promise<{ code: string }> {
  return db.transaction(async (tx) => {
    const guide = await lockGuide(tx, guideId)
    if (guide.status === "received") throw new Error("La recepción de esta guía ya fue confirmada")
    if (guide.status !== "dispatched") {
      throw new Error(
        guide.status === "draft"
          ? "La guía todavía no ha sido despachada"
          : "La guía está anulada",
      )
    }
    assertWorksiteScope(scope, guide.destinationWorksiteId)
    await assertWorkerRefs(tx, [input.receivedByWorkerId])

    const now = new Date().toISOString()
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

    const hadStockEgress = guide.status === "dispatched" || guide.status === "received"
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
