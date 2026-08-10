import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  deliveries,
  deliveryItems,
  inventoryMovements,
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  receiptItems,
  receipts,
  traceabilityIntegrityCases,
  traceabilityIntegrityResolutions,
} from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import {
  detectTraceabilityIntegrity,
  type TraceabilityIntegrityFinding,
  type TraceabilityIntegrityItem,
} from "./traceability-integrity"

const ACTIVE_ORDER_STATUSES = new Set([
  "draft",
  "sent",
  "partially_office_received",
  "office_received",
  "partially_received",
  "received",
  "closed",
])

function worksiteConditions(session: Session) {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return { scope, condition: undefined }
  return {
    scope,
    condition: scope.mode === "some" ? inArray(purchaseRequests.worksiteId, scope.ids) : undefined,
  }
}

/**
 * Recoge las excepciones de registros existentes, sin reescribir la historia.
 * La exploración es intencional: debe ser invocada por un usuario autorizado,
 * nunca desde el render de una página.
 */
export async function scanTraceabilityIntegrity(session: Session): Promise<{
  findings: TraceabilityIntegrityFinding[]
  recordedCount: number
}> {
  const { scope, condition } = worksiteConditions(session)
  if (scope.mode === "none") return { findings: [], recordedCount: 0 }

  const itemRows = await db
    .select({
      requestItemId: purchaseRequestItems.id,
      requestCode: purchaseRequests.code,
      worksiteId: purchaseRequests.worksiteId,
      deliveryMode: purchaseRequests.deliveryMode,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(condition)

  if (itemRows.length === 0) return { findings: [], recordedCount: 0 }
  const itemIds = itemRows.map((item) => item.requestItemId)

  const [orderRows, receiptRows, deliveryRows] = await Promise.all([
    db
      .select({
        requestItemId: purchaseOrderItems.requestItemId,
        quantity: purchaseOrderItems.quantity,
        orderStatus: purchaseOrders.status,
        orderItemStatus: purchaseOrderItems.status,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .where(inArray(purchaseOrderItems.requestItemId, itemIds)),
    db
      .select({
        requestItemId: purchaseOrderItems.requestItemId,
        quantityReceived: receiptItems.quantityReceived,
        quantityRejected: receiptItems.quantityRejected,
        quantityDamaged: receiptItems.quantityDamaged,
        locationType: receipts.locationType,
        worksiteId: receipts.worksiteId,
        receivedAt: receipts.receivedAt,
      })
      .from(receiptItems)
      .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
      .innerJoin(purchaseOrderItems, eq(receiptItems.purchaseOrderItemId, purchaseOrderItems.id))
      .where(inArray(purchaseOrderItems.requestItemId, itemIds)),
    db
      .select({
        requestItemId: deliveryItems.requestItemId,
        quantity: deliveryItems.quantity,
        deliveredAt: deliveries.deliveredAt,
      })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .where(and(
        isNotNull(deliveryItems.requestItemId),
        inArray(deliveryItems.requestItemId, itemIds),
      )),
  ])

  const itemById = new Map<string, TraceabilityIntegrityItem>(itemRows.map((item) => [item.requestItemId, {
    ...item,
    deliveryMode: item.deliveryMode === "directo_faena" ? "directo_faena" : "via_oficina",
    orderedQuantity: 0,
    cancelledOrderedQuantity: 0,
    receipts: [],
    deliveries: [],
  }]))

  for (const row of orderRows) {
    if (!row.requestItemId) continue
    const item = itemById.get(row.requestItemId)
    if (!item) continue
    const cancelled = row.orderStatus === "cancelled" || row.orderItemStatus === "cancelled"
    if (cancelled) item.cancelledOrderedQuantity += row.quantity
    else if (ACTIVE_ORDER_STATUSES.has(row.orderStatus)) item.orderedQuantity += row.quantity
  }
  for (const row of receiptRows) {
    if (!row.requestItemId || (row.locationType !== "office" && row.locationType !== "faena")) continue
    const item = itemById.get(row.requestItemId)
    if (!item) continue
    item.receipts.push({
      quantityReceived: row.quantityReceived,
      quantityRejected: row.quantityRejected,
      quantityDamaged: row.quantityDamaged,
      locationType: row.locationType,
      worksiteId: row.worksiteId,
      receivedAt: row.receivedAt,
    })
  }
  for (const row of deliveryRows) {
    if (!row.requestItemId) continue
    const item = itemById.get(row.requestItemId)
    if (!item) continue
    item.deliveries.push({ quantity: row.quantity, deliveredAt: row.deliveredAt })
  }

  const findings = detectTraceabilityIntegrity({ items: [...itemById.values()] })
  if (findings.length === 0) return { findings, recordedCount: 0 }

  const inserted = await db.insert(traceabilityIntegrityCases).values(findings.map((finding) => ({
    id: nanoid(),
    findingKey: finding.findingKey,
    requestItemId: finding.requestItemId,
    worksiteId: finding.worksiteId,
    findingCode: finding.code,
    snapshot: finding.snapshot,
  }))).onConflictDoNothing({ target: traceabilityIntegrityCases.findingKey }).returning({ id: traceabilityIntegrityCases.id })

  return { findings, recordedCount: inserted.length }
}

export interface ResolveTraceabilityIntegrityCaseInput {
  caseId: string
  action: "acknowledge" | "compensating_movement"
  reason: string
  compensatingMovementId?: string | null
  userId: string
  userEmail?: string | null
  session: Session
}

/**
 * Añade el único evento de resolución permitido para un caso. No cambia la
 * solicitud, la OC, recepción, entrega ni el snapshot detectado.
 */
export async function resolveTraceabilityIntegrityCase(input: ResolveTraceabilityIntegrityCaseInput) {
  const reason = input.reason.trim()
  if (reason.length < 10 || reason.length > 2000) {
    throw new Error("La regularización requiere un motivo de 10 a 2.000 caracteres")
  }
  if (input.action === "compensating_movement" && !input.compensatingMovementId) {
    throw new Error("Selecciona el movimiento compensatorio registrado")
  }
  if (input.action === "acknowledge" && input.compensatingMovementId) {
    throw new Error("Una resolución sin movimiento no puede adjuntar un movimiento compensatorio")
  }

  const scope = resolveWorksiteScope(input.session)
  if (scope.mode === "none") throw new Error("No tienes acceso a esta faena")

  await db.transaction(async (tx) => {
    const [caseRow] = await tx.select().from(traceabilityIntegrityCases)
      .where(eq(traceabilityIntegrityCases.id, input.caseId)).for("update")
    if (!caseRow) throw new Error("Caso de integridad no encontrado")
    if (scope.mode === "some" && !scope.ids.includes(caseRow.worksiteId)) {
      throw new Error("No tienes acceso a la faena de este caso")
    }

    const [existingResolution] = await tx.select({ id: traceabilityIntegrityResolutions.id })
      .from(traceabilityIntegrityResolutions)
      .where(eq(traceabilityIntegrityResolutions.caseId, caseRow.id))
      .limit(1)
    if (existingResolution) throw new Error("Este caso ya fue regularizado")

    let compensatingMovementId: string | null = null
    if (input.action === "compensating_movement") {
      const [movement] = await tx.select({ id: inventoryMovements.id, worksiteId: inventoryMovements.worksiteId, type: inventoryMovements.type })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.id, input.compensatingMovementId!))
        .limit(1)
      if (!movement || movement.worksiteId !== caseRow.worksiteId || movement.type !== "ajuste") {
        throw new Error("El movimiento compensatorio debe ser un ajuste de la misma faena")
      }
      compensatingMovementId = movement.id
    }

    const resolutionId = nanoid()
    await tx.insert(traceabilityIntegrityResolutions).values({
      id: resolutionId,
      caseId: caseRow.id,
      action: input.action,
      reason,
      compensatingMovementId,
      resolvedBy: input.userId,
    })
    await recordAudit({
      userId: input.userId,
      userEmail: input.userEmail ?? undefined,
      action: "update",
      entityType: "traceability_integrity_case",
      entityId: caseRow.id,
      newState: { action: input.action, compensatingMovementId, resolutionId },
      reason,
    }, tx)
  })
}

export async function listTraceabilityIntegrityCases(session: Session) {
  const { scope, condition } = worksiteConditions(session)
  if (scope.mode === "none") return []
  return db
    .select({
      id: traceabilityIntegrityCases.id,
      requestItemId: traceabilityIntegrityCases.requestItemId,
      worksiteId: traceabilityIntegrityCases.worksiteId,
      findingCode: traceabilityIntegrityCases.findingCode,
      snapshot: traceabilityIntegrityCases.snapshot,
      detectedAt: traceabilityIntegrityCases.detectedAt,
      resolutionId: traceabilityIntegrityResolutions.id,
      resolutionAction: traceabilityIntegrityResolutions.action,
      resolvedAt: traceabilityIntegrityResolutions.createdAt,
    })
    .from(traceabilityIntegrityCases)
    .leftJoin(traceabilityIntegrityResolutions, eq(traceabilityIntegrityResolutions.caseId, traceabilityIntegrityCases.id))
    .innerJoin(purchaseRequestItems, eq(purchaseRequestItems.id, traceabilityIntegrityCases.requestItemId))
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(condition)
}

export interface TraceabilityIntegrityAdjustmentOption {
  id: string
  worksiteId: string
  label: string
}

/**
 * Shows only adjustments that already exist and are in the actor's worksite
 * scope. The resolution service repeats this validation inside its
 * transaction; the selector is guidance, never an authorization boundary.
 */
export async function listTraceabilityIntegrityAdjustmentOptions(
  session: Session,
): Promise<TraceabilityIntegrityAdjustmentOption[]> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return []

  const rows = await db
    .select({
      id: inventoryMovements.id,
      worksiteId: inventoryMovements.worksiteId,
      productName: products.name,
      quantity: inventoryMovements.quantity,
      reason: inventoryMovements.reason,
      performedAt: inventoryMovements.performedAt,
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(products.id, inventoryMovements.productId))
    .where(and(
      eq(inventoryMovements.type, "ajuste"),
      scope.mode === "some" ? inArray(inventoryMovements.worksiteId, scope.ids) : undefined,
    ))
    .orderBy(desc(inventoryMovements.performedAt))
    .limit(250)

  return rows.map((row) => ({
    id: row.id,
    worksiteId: row.worksiteId,
    label: `${row.productName} · ${row.quantity > 0 ? "+" : ""}${row.quantity} · ${row.reason?.trim() || "Sin motivo"} · ${row.performedAt.slice(0, 10)}`,
  }))
}
