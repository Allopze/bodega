import type { Tx } from "@/db"
import { asc, eq, inArray, or } from "drizzle-orm"
import { purchaseOrderInvoiceItemAllocations, purchaseOrderInvoiceItems, purchaseOrderInvoices, purchaseOrderItems, purchaseOrders } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { validateInvoiceLineAllocationSet, type InvoiceLineAllocationInput, type InvoiceLineAllocationErrorCode } from "./invoice-line-allocation-validation"

// Client previews import the pure file directly, avoiding this database module.
export { validateInvoiceLineAllocationSet, type InvoiceLineAllocationInput, type InvoiceLineAllocationErrorCode } from "./invoice-line-allocation-validation"

export interface ReplaceInvoiceLineAllocationsInput {
  purchaseOrderId: string
  invoiceItemId: string
  expectedFingerprint: string
  coverage: "partial" | "complete"
  source: "operator" | "dte_suggestion"
  allocations: InvoiceLineAllocationInput[]
  actor: { userId: string; userEmail?: string }
  worksiteScope: string[] | "all"
}

export class InvoiceLineAllocationError extends Error {
  constructor(public readonly code: InvoiceLineAllocationErrorCode) {
    super(code)
    this.name = "InvoiceLineAllocationError"
  }
}

export interface InvoiceLineAllocationView extends InvoiceLineAllocationInput {
  id: string
  invoiceItemId: string
  source: "legacy_backfill" | "operator" | "dte_suggestion"
  createdBy: string | null
  createdAt: string
}

export interface ReplaceInvoiceLineAllocationsResult {
  fingerprint: string
  allocations: InvoiceLineAllocationView[]
  legacyPurchaseOrderItemId: string | null
}

export type LoadInvoiceLineAllocationsInput = Pick<ReplaceInvoiceLineAllocationsInput,
  "purchaseOrderId" | "invoiceItemId" | "worksiteScope">

/**
 * Service boundary: actor and scope must come from authenticated server context.
 * Locks live for the caller's transaction. Loading uses the same lock order as
 * replacing so a fingerprint cannot combine old invoice and new allocation rows.
 */
async function lockEvidence(tx: Tx, input: LoadInvoiceLineAllocationsInput, targetIds: string[] = []) {
  const [evidence] = await tx.select({
    invoiceItem: purchaseOrderInvoiceItems,
    purchaseOrderId: purchaseOrderInvoices.purchaseOrderId,
    documentKind: purchaseOrderInvoices.documentKind,
    invoiceAmount: purchaseOrderInvoices.amount,
    worksiteId: purchaseOrders.worksiteId,
  }).from(purchaseOrderInvoiceItems)
    .innerJoin(purchaseOrderInvoices, eq(purchaseOrderInvoices.id, purchaseOrderInvoiceItems.invoiceId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderInvoices.purchaseOrderId))
    .where(eq(purchaseOrderInvoiceItems.id, input.invoiceItemId))
    .for("update")
  if (!evidence) throw new InvoiceLineAllocationError("INVOICE_ITEM_NOT_FOUND")
  if (evidence.purchaseOrderId !== input.purchaseOrderId) throw new InvoiceLineAllocationError("CROSS_ORDER_TARGET")
  if (input.worksiteScope !== "all" && !input.worksiteScope?.includes(evidence.worksiteId)) throw new InvoiceLineAllocationError("OUT_OF_SCOPE")

  // The fingerprint covers all documentary OC evidence, so lock the whole
  // order's lines as well as proposed destinations in one stable ID ordering.
  const orderItems = await tx.select({
    id: purchaseOrderItems.id,
    purchaseOrderId: purchaseOrderItems.purchaseOrderId,
    unitOfMeasure: purchaseOrderItems.unitOfMeasure,
    quantity: purchaseOrderItems.quantity,
    subtotal: purchaseOrderItems.subtotal,
  }).from(purchaseOrderItems).where(targetIds.length
    ? or(eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId), inArray(purchaseOrderItems.id, targetIds))
    : eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId))
    .orderBy(asc(purchaseOrderItems.id)).for("update")
  const allocations: InvoiceLineAllocationView[] = await tx.select().from(purchaseOrderInvoiceItemAllocations)
    .where(eq(purchaseOrderInvoiceItemAllocations.invoiceItemId, input.invoiceItemId))
    .orderBy(asc(purchaseOrderInvoiceItemAllocations.purchaseOrderItemId))
  return { ...evidence, orderItems, allocations }
}

async function allocationResult(evidence: Awaited<ReturnType<typeof lockEvidence>>): Promise<ReplaceInvoiceLineAllocationsResult> {
  const documentaryEvidence = {
    ...evidence,
    orderItems: evidence.orderItems.filter(row => row.purchaseOrderId === evidence.purchaseOrderId),
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(documentaryEvidence)))
  const fingerprint = `alloc-v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`
  return { fingerprint, allocations: evidence.allocations, legacyPurchaseOrderItemId: evidence.invoiceItem.purchaseOrderItemId }
}

export async function loadInvoiceLineAllocationsTx(tx: Tx, input: LoadInvoiceLineAllocationsInput): Promise<ReplaceInvoiceLineAllocationsResult> {
  return allocationResult(await lockEvidence(tx, input))
}

/** Callers must propagate failures to roll back their enclosing transaction. */
export async function replaceInvoiceLineAllocationsTx(tx: Tx, input: ReplaceInvoiceLineAllocationsInput): Promise<ReplaceInvoiceLineAllocationsResult> {
  const allocations = [...input.allocations].sort((a, b) => a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId))
  const evidence = await lockEvidence(tx, input, allocations.map(row => row.purchaseOrderItemId))
  const before = await allocationResult(evidence)
  if (before.fingerprint !== input.expectedFingerprint) throw new InvoiceLineAllocationError("STALE_EVIDENCE")
  if ((evidence.documentKind === "credit_note" ? -1 : 1) !== Math.sign(evidence.invoiceItem.quantity)) throw new InvoiceLineAllocationError("SIGN_MISMATCH")
  const validation = validateInvoiceLineAllocationSet({ invoiceItem: evidence.invoiceItem, orderId: input.purchaseOrderId, orderItems: evidence.orderItems, allocations, coverage: input.coverage })
  if (!validation.ok) throw new InvoiceLineAllocationError(validation.code)

  await tx.delete(purchaseOrderInvoiceItemAllocations).where(eq(purchaseOrderInvoiceItemAllocations.invoiceItemId, input.invoiceItemId))
  if (allocations.length) await tx.insert(purchaseOrderInvoiceItemAllocations).values(allocations.map(row => ({
    id: nanoid(), invoiceItemId: input.invoiceItemId, purchaseOrderItemId: row.purchaseOrderItemId,
    quantity: row.quantity, subtotal: row.subtotal, source: input.source, createdBy: input.actor.userId,
  })))
  const legacyPurchaseOrderItemId = input.coverage === "complete" && allocations.length === 1 ? allocations[0]!.purchaseOrderItemId : null
  await tx.update(purchaseOrderInvoiceItems).set({ purchaseOrderItemId: legacyPurchaseOrderItemId })
    .where(eq(purchaseOrderInvoiceItems.id, input.invoiceItemId))
  // Read DB-normalized real/numeric values before creating the returned fingerprint.
  const after = await loadInvoiceLineAllocationsTx(tx, input)
  const persistedValidation = validateInvoiceLineAllocationSet({ invoiceItem: evidence.invoiceItem, orderId: input.purchaseOrderId, orderItems: evidence.orderItems, allocations: after.allocations, coverage: input.coverage })
  if (!persistedValidation.ok) throw new InvoiceLineAllocationError(persistedValidation.code)
  await recordAudit({
    userId: input.actor.userId, userEmail: input.actor.userEmail,
    action: "update", entityType: "purchase_order_invoice_item_allocation", entityId: input.invoiceItemId,
    oldState: { ...before }, newState: { ...after, coverage: input.coverage, source: input.source },
  }, tx)
  return after
}
