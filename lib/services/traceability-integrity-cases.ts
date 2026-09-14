import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
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
import { resolveWorksiteScope, type WorksiteScope } from "@/lib/auth/scope"
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

/** Tolerancia al comparar cantidades del ajuste compensatorio con el exceso. */
const QUANTITY_NUDGE = 0.000_001

function worksiteConditions(session: Session) {
  return conditionsForScope(resolveWorksiteScope(session))
}

function conditionsForScope(scope: WorksiteScope) {
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
  reopenedCount: number
}> {
  return scanForScope(resolveWorksiteScope(session), {
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
  })
}

/**
 * `TRZ-001` (auditoría 2026-09-14): el escaneo tenía un único llamador, la
 * Server Action del banco de trabajo, y además recortaba por el alcance de
 * quien pulsaba el botón. La cobertura global dependía de que una persona con
 * alcance global entrara a la pantalla y hiciera clic — y este libro cubre
 * justamente lo que el libro nuevo (con cron desde el principio) no mira:
 * entregas por encima de lo recibido en faena y entregas anteriores a la
 * recepción.
 *
 * `"all"` es una afirmación explícita de quien llama, igual que en
 * `worksiteScopeSqlFor`: un cron no es un usuario y no puede fabricarse una
 * sesión. Sólo observa; reconocer y verificar siguen exigiendo una persona.
 */
export async function scanTraceabilityIntegrityAsSystem(): Promise<{
  findings: TraceabilityIntegrityFinding[]
  recordedCount: number
  reopenedCount: number
}> {
  return scanForScope({ mode: "all", ids: [] }, { userId: null, userEmail: "sistema@chome.cl" })
}

/** Quién deja el rastro del escaneo; el cron no tiene usuario y no se fabrica uno. */
interface ScanActor { userId: string | null; userEmail?: string }

async function scanForScope(resolved: WorksiteScope, actor: ScanActor): Promise<{
  findings: TraceabilityIntegrityFinding[]
  recordedCount: number
  reopenedCount: number
}> {
  const { scope, condition } = conditionsForScope(resolved)
  if (scope.mode === "none") return { findings: [], recordedCount: 0, reopenedCount: 0 }

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

  if (itemRows.length === 0) return { findings: [], recordedCount: 0, reopenedCount: 0 }
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
        isNull(deliveries.voidedAt),
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
  if (findings.length === 0) return { findings, recordedCount: 0, reopenedCount: 0 }

  const inserted = await db.insert(traceabilityIntegrityCases).values(findings.map((finding) => ({
    id: nanoid(),
    findingKey: finding.findingKey,
    requestItemId: finding.requestItemId,
    worksiteId: finding.worksiteId,
    findingCode: finding.code,
    snapshot: finding.snapshot,
  }))).onConflictDoNothing({ target: traceabilityIntegrityCases.findingKey }).returning({ id: traceabilityIntegrityCases.id })

  const reopenedCount = await reopenPersistentCases(findings.map((finding) => finding.findingKey), actor)
  return { findings, recordedCount: inserted.length, reopenedCount }
}

/**
 * `TRZ-002` (auditoría 2026-09-14): antes de esto, un caso se cerraba por
 * declaración y quedaba cerrado para siempre. `finding_key` es único, así que
 * el escaneo no recreaba el caso, y el índice único por caso impedía una
 * segunda resolución: si el descuadre persistía o reaparecía, el libro decía
 * "regularizado" sobre algo que seguía roto y nadie podía desdecirlo.
 *
 * La regla que se aplica aquí no la inventa este módulo: es la que ya declara
 * el libro nuevo —verificar significa que el detector ya no encuentra el
 * hallazgo—. Si el detector vuelve a encontrar un caso cuya ocurrencia actual
 * ya estaba regularizada, la ocurrencia avanza y el caso vuelve a quedar
 * pendiente. Nada se reescribe: la resolución anterior sigue en el historial,
 * atada a la ocurrencia que cerró.
 */
async function reopenPersistentCases(findingKeys: string[], actor: ScanActor): Promise<number> {
  if (findingKeys.length === 0) return 0
  const keyList = sql.join(findingKeys.map((key) => sql`${key}`), sql`, `)
  const result = await db.execute(sql`
    UPDATE ${traceabilityIntegrityCases} AS c
       SET occurrence = c.occurrence + 1,
           last_detected_at = now()
     WHERE c.finding_key IN (${keyList})
       AND EXISTS (
         SELECT 1 FROM ${traceabilityIntegrityResolutions} r
          WHERE r.case_id = c.id AND r.occurrence = c.occurrence
       )
    RETURNING c.id AS id, c.occurrence AS occurrence
  `)
  const rows = (((result as { rows?: unknown[] }).rows ?? result) as Array<{ id: string; occurrence: number }>)
  for (const row of rows) {
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "traceability_integrity_case",
      entityId: row.id,
      newState: { kind: "reopened", occurrence: Number(row.occurrence) },
      reason: "El detector volvió a encontrar el hallazgo tras su regularización",
    })
  }
  return rows.length
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

    // TRZ-002: la unicidad es por **ocurrencia**, no por caso. Un caso que el
    // detector reabrió (porque el descuadre seguía ahí) admite una resolución
    // nueva; lo que sigue prohibido es cerrar dos veces la misma ocurrencia.
    const [existingResolution] = await tx.select({ id: traceabilityIntegrityResolutions.id })
      .from(traceabilityIntegrityResolutions)
      .where(and(
        eq(traceabilityIntegrityResolutions.caseId, caseRow.id),
        eq(traceabilityIntegrityResolutions.occurrence, caseRow.occurrence),
      ))
      .limit(1)
    if (existingResolution) throw new Error("Este caso ya fue regularizado")

    let compensatingMovementId: string | null = null
    if (input.action === "compensating_movement") {
      const [movement] = await tx.select({ id: inventoryMovements.id, worksiteId: inventoryMovements.worksiteId, type: inventoryMovements.type, productId: inventoryMovements.productId, quantity: inventoryMovements.quantity })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.id, input.compensatingMovementId!))
        .limit(1)
      if (!movement || movement.worksiteId !== caseRow.worksiteId || movement.type !== "ajuste") {
        throw new Error("El movimiento compensatorio debe ser un ajuste de la misma faena")
      }
      // OP-04 (auditoría 2026-09-05): la resolución sólo comprobaba faena y
      // tipo, así que un ajuste de botas podía "compensar" un exceso de
      // cascos. Un movimiento compensatorio debe reparar materialmente el
      // caso: mismo producto que la línea del ítem y magnitud suficiente.
      const [itemRow] = await tx
        .select({ productId: purchaseRequestItems.productId })
        .from(purchaseRequestItems)
        .where(eq(purchaseRequestItems.id, caseRow.requestItemId))
        .limit(1)
      if (!itemRow?.productId) {
        throw new Error("El ítem del caso no tiene producto: no se puede vincular un ajuste compensatorio")
      }
      if (movement.productId !== itemRow.productId) {
        throw new Error("El movimiento compensatorio debe ser un ajuste del mismo producto que el caso")
      }
      const excessQty = Number(caseRow.snapshot.excessQuantity ?? 0)
      if (excessQty > 0 && Math.abs(movement.quantity) < excessQty - QUANTITY_NUDGE) {
        throw new Error("El ajuste compensatorio debe cubrir al menos el exceso detectado en el caso")
      }
      compensatingMovementId = movement.id
    }

    const resolutionId = nanoid()
    await tx.insert(traceabilityIntegrityResolutions).values({
      id: resolutionId,
      caseId: caseRow.id,
      occurrence: caseRow.occurrence,
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
      newState: { action: input.action, compensatingMovementId, resolutionId, occurrence: caseRow.occurrence },
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
      lastDetectedAt: traceabilityIntegrityCases.lastDetectedAt,
      occurrence: traceabilityIntegrityCases.occurrence,
      resolutionId: traceabilityIntegrityResolutions.id,
      resolutionAction: traceabilityIntegrityResolutions.action,
      resolvedAt: traceabilityIntegrityResolutions.createdAt,
    })
    .from(traceabilityIntegrityCases)
    // TRZ-002: el caso se muestra regularizado sólo si la resolución cierra la
    // ocurrencia **vigente**. Una reapertura deja el caso pendiente otra vez
    // sin borrar la resolución anterior, que queda atada a su ocurrencia.
    .leftJoin(traceabilityIntegrityResolutions, and(
      eq(traceabilityIntegrityResolutions.caseId, traceabilityIntegrityCases.id),
      eq(traceabilityIntegrityResolutions.occurrence, traceabilityIntegrityCases.occurrence),
    ))
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
