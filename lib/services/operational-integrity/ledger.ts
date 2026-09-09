import type { Session } from "next-auth"
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { inventoryMovements, operationalIntegrityCases as cases, operationalIntegrityObservations as observations, operationalIntegrityCaseEvents as events, products, purchaseOrderItems, purchaseOrders, purchaseOrderInvoiceItems, purchaseOrderInvoices, receiptItems, receipts } from "@/db/schema"
import { worksiteStock } from "@/db/schema"
import { worksiteScopeSql, serviceWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { getProductAttributesByIds } from "../product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"
import { loadInvoiceLineAllocationsTx } from "../purchasing-module/invoice-line-allocations"
import { reconcilePurchaseOrderInvoicesTx } from "../purchasing-module/invoice-reconciliation-service"
import { detectStockIntegrity } from "./stock-detector"
import { detectReceivingIntegrity } from "./receiving-detector"
import { detectPurchasingIntegrity } from "./purchasing-detector"
import { integrityDescriptions, type IntegrityScanContext, type IntegrityCaseRef, type OperationalIntegrityDetector, type OperationalIntegrityFinding, type OperationalIntegrityCode } from "./types"

type Domain = OperationalIntegrityFinding["domain"]
type CaseRow = typeof cases.$inferSelect
export type OperationalIntegrityState = "open" | "acknowledged" | "verified_resolved"
export interface OperationalIntegrityFilters {
  worksiteId?: string
  domain?: Domain
  severity?: OperationalIntegrityFinding["severity"]
  state?: OperationalIntegrityState | "active"
}
export interface OperationalIntegrityCaseDto {
  id: string
  domain: Domain
  code: OperationalIntegrityCode
  severity: OperationalIntegrityFinding["severity"]
  worksiteId: string
  entityType: string
  entityId: string
  summary: string
  href: string
  firstDetectedAt: string
  observedAt: string
  state: OperationalIntegrityState
  productId: string | null
  productName: string | null
  sku: string | null
}

const has = (session: Session, permission: string) => session.user?.isActive === true && session.user.permissions.includes(permission)
function assertMutation(session: Session) {
  if (!has(session, "warehouse:reconcile_integrity")) throw new Error("Permiso insuficiente")
}
function visibleCases(session: Session, worksiteId?: string) {
  return and(worksiteScopeSql(session, cases.worksiteId, worksiteId), has(session, "purchasing:view") ? undefined : ne(cases.domain, "purchasing"))
}

// Repeatable evidence prevents a scan from mixing pre/post mutation rows.
// Concurrent inserts/verification may require a fresh snapshot, never a partial retry.
async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(run, { isolationLevel: "repeatable read" }) }
    catch (error) {
      const cause = error instanceof Error && error.cause ? error.cause : error
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined
      if (attempt >= 2 || (code !== "40001" && code !== "40P01")) throw error
    }
  }
}

async function scanStock(ctx: IntegrityScanContext) {
  const stocks = await ctx.tx.select().from(worksiteStock).where(worksiteScopeSql(ctx.session, worksiteStock.worksiteId))
  const movements = await ctx.tx.select().from(inventoryMovements).where(worksiteScopeSql(ctx.session, inventoryMovements.worksiteId))
  return detectStockIntegrity({ stocks, movements })
}
async function scanReceiving(ctx: IntegrityScanContext) {
  const orderItems = await ctx.tx.select({ id: purchaseOrderItems.id, purchaseOrderId: purchaseOrders.id, worksiteId: purchaseOrders.worksiteId, quantity: purchaseOrderItems.quantity, deliveryMode: purchaseOrders.deliveryMode })
    .from(purchaseOrderItems).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .where(and(worksiteScopeSql(ctx.session, purchaseOrders.worksiteId), ne(purchaseOrders.status, "cancelled"), ne(purchaseOrderItems.status, "cancelled")))
  if (!orderItems.length) return []
  const dispositions = await ctx.tx.select({ id: receiptItems.id, receiptId: receipts.id, purchaseOrderItemId: receiptItems.purchaseOrderItemId, locationType: receipts.locationType, quantityReceived: receiptItems.quantityReceived, quantityRejected: receiptItems.quantityRejected, quantityDamaged: receiptItems.quantityDamaged })
    .from(receiptItems).innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, receipts.purchaseOrderId))
    .where(and(worksiteScopeSql(ctx.session, purchaseOrders.worksiteId), inArray(receiptItems.purchaseOrderItemId, orderItems.map(row => row.id))))
  return detectReceivingIntegrity({ orderItems, receipts: dispositions })
}
async function scanPurchasing(ctx: IntegrityScanContext) {
  const orders = await ctx.tx.select().from(purchaseOrders).where(and(worksiteScopeSql(ctx.session, purchaseOrders.worksiteId), ne(purchaseOrders.status, "cancelled"))).orderBy(asc(purchaseOrders.id))
  const findings: OperationalIntegrityFinding[] = []
  for (const order of orders) {
    const lines = await ctx.tx.select({ id: purchaseOrderInvoiceItems.id, documentKind: purchaseOrderInvoices.documentKind, quantity: purchaseOrderInvoiceItems.quantity, subtotal: purchaseOrderInvoiceItems.subtotal, unitOfMeasure: purchaseOrderInvoiceItems.unitOfMeasure })
      .from(purchaseOrderInvoiceItems).innerJoin(purchaseOrderInvoices, eq(purchaseOrderInvoices.id, purchaseOrderInvoiceItems.invoiceId))
      .where(eq(purchaseOrderInvoices.purchaseOrderId, order.id)).orderBy(asc(purchaseOrderInvoiceItems.id))
    const invoiceItems = []
    for (const line of lines) {
      const { allocations } = await loadInvoiceLineAllocationsTx(ctx.tx, { purchaseOrderId: order.id, invoiceItemId: line.id, worksiteScope: serviceWorksiteScope(ctx.session) })
      invoiceItems.push({ ...line, allocations })
    }
    const orderItems = await ctx.tx.select({ id: purchaseOrderItems.id, purchaseOrderId: purchaseOrderItems.purchaseOrderId, unitOfMeasure: purchaseOrderItems.unitOfMeasure }).from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, order.id))
    const currentReconciliation = await reconcilePurchaseOrderInvoicesTx(ctx.tx, order.id)
    findings.push(...detectPurchasingIntegrity({ order, orderItems, invoiceItems, currentReconciliation }))
  }
  return findings
}

const detectors: readonly OperationalIntegrityDetector[] = [
  { domain: "stock", scan: scanStock, async verify(ctx, ref) { return (await scanStock(ctx)).find(row => row.caseKey === ref.caseKey) ?? null } },
  { domain: "receiving", scan: scanReceiving, async verify(ctx, ref) { return (await scanReceiving(ctx)).find(row => row.caseKey === ref.caseKey) ?? null } },
  { domain: "purchasing", scan: scanPurchasing, async verify(ctx, ref) { return (await scanPurchasing(ctx)).find(row => row.caseKey === ref.caseKey) ?? null } },
]

async function persistFinding(tx: Tx, session: Session, finding: OperationalIntegrityFinding) {
  await tx.insert(cases).values({ id: nanoid(), caseKey: finding.caseKey, domain: finding.domain, code: finding.code, severity: finding.severity, worksiteId: finding.worksiteId, entityType: finding.entityType, entityId: finding.entityId }).onConflictDoNothing({ target: cases.caseKey })
  const [stored] = await tx.select().from(cases).where(eq(cases.caseKey, finding.caseKey)).for("update")
  // Schema v1 deduplicates evidence for the case's entire lifetime. Reopening
  // an identical fingerprint after resolution needs a future occurrence event;
  // neither this scan nor listing rewrites the append-only history.
  const [observation] = await tx.insert(observations).values({ id: nanoid(), caseId: stored!.id, fingerprint: finding.fingerprint, snapshot: finding.snapshot }).onConflictDoNothing({ target: [observations.caseId, observations.fingerprint] }).returning()
  if (observation) await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "operational_integrity_case", entityId: stored!.id, newState: { kind: "observed", observationId: observation.id, fingerprint: observation.fingerprint, code: finding.code } }, tx)
  return observation ? 1 : 0
}

export async function scanOperationalIntegrity(session: Session, domains: Domain[]): Promise<{ found: number; recorded: number }> {
  assertMutation(session)
  if (domains.some(domain => !detectors.some(detector => detector.domain === domain))) throw new Error("Dominio inválido")
  if (domains.includes("purchasing") && !has(session, "purchasing:view")) throw new Error("Permiso insuficiente")
  return transaction(async tx => {
    const findings: OperationalIntegrityFinding[] = []
    for (const detector of detectors) if (domains.includes(detector.domain)) findings.push(...await detector.scan({ tx, session }))
    let recorded = 0
    for (const finding of findings.sort((a, b) => a.caseKey.localeCompare(b.caseKey))) recorded += await persistFinding(tx, session, finding)
    return { found: findings.length, recorded }
  })
}

function caseState(observationId: string, caseEvents: (typeof events.$inferSelect)[]): OperationalIntegrityState {
  const current = caseEvents.filter(event => event.observationId === observationId)
  if (current.some(event => event.kind === "verified_resolved")) return "verified_resolved"
  return current.some(event => event.kind === "acknowledged") ? "acknowledged" : "open"
}
function caseHref(row: CaseRow) {
  const scope = `faena=${encodeURIComponent(row.worksiteId)}`
  if (row.domain === "stock") return `/bodega?vista=kardex&${scope}&producto=${encodeURIComponent(row.entityId)}`
  return `/${row.domain === "receiving" ? "recepcion" : "compras"}/${encodeURIComponent(row.entityId)}?${scope}`
}

/** Read model only: snapshots and event evidence never cross this interface. */
export async function listOperationalIntegrityCases(session: Session, filters: OperationalIntegrityFilters = {}): Promise<OperationalIntegrityCaseDto[]> {
  if (!has(session, "warehouse:view_traceability")) return []
  return transaction(async tx => {
    const rows = await tx.query.operationalIntegrityCases.findMany({
      where: and(visibleCases(session, filters.worksiteId), filters.domain ? eq(cases.domain, filters.domain) : undefined, filters.severity ? eq(cases.severity, filters.severity) : undefined),
      orderBy: [desc(cases.firstDetectedAt), asc(cases.id)],
      with: { observations: { orderBy: [desc(observations.observedAt), desc(observations.id)], limit: 1 }, events: true },
    })
    const receiptLineIds = rows.filter(row => row.domain === "receiving").flatMap(row => {
      const id = row.observations[0]?.snapshot.purchaseOrderItemId
      return typeof id === "string" ? [id] : []
    })
    const receiptLines = receiptLineIds.length ? await tx.select({ id: purchaseOrderItems.id, productId: purchaseOrderItems.productId, productNameFree: purchaseOrderItems.productNameFree, worksiteId: purchaseOrders.worksiteId })
      .from(purchaseOrderItems).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .where(and(inArray(purchaseOrderItems.id, receiptLineIds), worksiteScopeSql(session, purchaseOrders.worksiteId))) : []
    const lineById = new Map(receiptLines.map(line => [line.id, line]))
    const productIds = [...rows.filter(row => row.domain === "stock").map(row => row.entityId), ...receiptLines.flatMap(line => line.productId ? [line.productId] : [])]
    const productRows = productIds.length ? await tx.select({ id: products.id, name: products.name, sku: products.sku }).from(products).where(inArray(products.id, productIds)) : []
    const productById = new Map(productRows.map(row => [row.id, row]))
    const attributes = await getProductAttributesByIds(productIds, tx)
    return rows.flatMap(row => {
      const observation = row.observations[0]
      if (!observation || !(row.code in integrityDescriptions)) return []
      const state = caseState(observation.id, row.events)
      if (filters.state === "active" ? state === "verified_resolved" : filters.state && state !== filters.state) return []
      const code = row.code as OperationalIntegrityCode
      const lineId = row.domain === "receiving" ? observation.snapshot.purchaseOrderItemId : null
      const receiptLine = typeof lineId === "string" ? lineById.get(lineId) : undefined
      const line = receiptLine?.worksiteId === row.worksiteId ? receiptLine : undefined
      const productId = row.domain === "stock" ? row.entityId : line?.productId
      const product = productId ? productById.get(productId) : undefined
      return [{ id: row.id, domain: row.domain, code, severity: row.severity, worksiteId: row.worksiteId, entityType: row.entityType, entityId: row.entityId, summary: integrityDescriptions[code].summary, href: caseHref(row), firstDetectedAt: row.firstDetectedAt, observedAt: observation.observedAt, state, productId: product?.id ?? null, sku: product?.sku ?? null, productName: product ? formatVariantProductName(product.name, attributes.get(product.id)) : line?.productNameFree ?? null }]
    })
  })
}

async function lockCase(tx: Tx, session: Session, id: string) {
  const [row] = await tx.select().from(cases).where(and(eq(cases.id, id), visibleCases(session))).for("update")
  if (!row) throw new Error("Caso no encontrado")
  const [observation] = await tx.select().from(observations).where(eq(observations.caseId, id)).orderBy(desc(observations.observedAt), desc(observations.id)).limit(1)
  if (!observation) throw new Error("Caso no encontrado")
  return { row, observation }
}
async function appendEvent(tx: Tx, session: Session, caseId: string, observationId: string, kind: "acknowledged" | "verified_resolved", reason: string, evidence: Record<string, unknown> | null) {
  const [event] = await tx.insert(events).values({ id: nanoid(), caseId, observationId, kind, reason, evidence, actorUserId: session.user.id }).onConflictDoNothing({ target: [events.caseId, events.observationId, events.kind] }).returning()
  if (event) await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "status_change", entityType: "operational_integrity_case", entityId: caseId, reason, newState: { kind, observationId, evidence } }, tx)
}

export async function acknowledgeOperationalIntegrityCase(session: Session, caseId: string, reason: string): Promise<void> {
  assertMutation(session)
  const trimmed = reason.trim()
  if (trimmed.length < 10 || trimmed.length > 2000) throw new Error("El motivo debe tener entre 10 y 2000 caracteres")
  await transaction(async tx => {
    const { observation } = await lockCase(tx, session, caseId)
    await appendEvent(tx, session, caseId, observation.id, "acknowledged", trimmed, null)
  })
}

export async function verifyOperationalIntegrityCase(session: Session, caseId: string): Promise<{ resolved: boolean }> {
  assertMutation(session)
  return transaction(async tx => {
    const { row, observation } = await lockCase(tx, session, caseId)
    const detector = detectors.find(candidate => candidate.domain === row.domain)
    if (!detector) throw new Error("Detector no disponible")
    const ref: IntegrityCaseRef = { caseKey: row.caseKey, domain: row.domain, worksiteId: row.worksiteId, entityId: row.entityId }
    const finding = await detector.verify({ tx, session }, ref)
    if (finding) {
      await persistFinding(tx, session, finding)
      return { resolved: false }
    }
    await appendEvent(tx, session, caseId, observation.id, "verified_resolved", "Corrección verificada mediante el detector del dominio", { findingPresent: false, domain: row.domain, fingerprint: observation.fingerprint, verifiedAt: new Date().toISOString() })
    return { resolved: true }
  })
}
