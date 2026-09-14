import type { Session } from "next-auth"
import { and, asc, desc, eq, exists, gte, inArray, ne, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { dispatchGuideItems, dispatchGuides, inventoryMovements, operationalIntegrityCases as cases, operationalIntegrityObservations as observations, operationalIntegrityCaseEvents as events, products, purchaseOrderItems, purchaseOrders, purchaseOrderInvoiceItems, purchaseOrderInvoices, receiptItems, receipts } from "@/db/schema"
import { worksiteStock } from "@/db/schema"
import { worksiteScopeSql, serviceWorksiteScope, worksiteScopeSqlFor } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { getProductAttributesByIds } from "../product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"
import { loadInvoiceLineAllocationsTx } from "../purchasing-module/invoice-line-allocations"
import { reconcilePurchaseOrderInvoicesTx } from "../purchasing-module/invoice-reconciliation-service"
import { detectStockIntegrity } from "./stock-detector"
import { detectReceivingIntegrity } from "./receiving-detector"
import { detectDispatchGuideShrinkage } from "./dispatch-guide-detector"
import { detectPurchasingIntegrity } from "./purchasing-detector"
import { integrityDescriptions, type IntegrityScanContext, type IntegrityCaseRef, type OperationalIntegrityDetector, type OperationalIntegrityFinding, type OperationalIntegrityCode } from "./types"
import { invoiceNotVoided } from "@/lib/services/purchasing-module/invoice-scope"
import { integrityScanWindowStart, saveIntegrityScanWatermark } from "./scan-watermark"

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

/**
 * TRZ-003: antes esto traía **todas** las filas de `worksite_stock` y **todos**
 * los movimientos del alcance, sin recorte, en cada corrida del cron.
 *
 * Con ventana incremental se resuelve primero qué productos se tocaron desde la
 * marca de agua —por un movimiento nuevo o por un saldo actualizado— y sólo de
 * ésos se lee el historial. Se lee **completo**, no recortado: el detector
 * encadena el kardex y un historial a medias fabricaría rupturas falsas. Un
 * producto que no se movió no pudo cambiar desde el escaneo anterior, y si ya
 * tenía un descuadre su caso sigue abierto en el ledger.
 */
async function scanStock(ctx: IntegrityScanContext) {
  const touched = ctx.since ? await productsTouchedSince(ctx, ctx.since) : null
  if (touched && touched.length === 0) return []
  const productWindow = touched ? inArray(worksiteStock.productId, touched) : undefined
  const movementWindow = touched ? inArray(inventoryMovements.productId, touched) : undefined
  const stocks = await ctx.tx.select().from(worksiteStock).where(and(worksiteScopeSqlFor(ctx.scope, worksiteStock.worksiteId), productWindow))
  const movements = await ctx.tx.select().from(inventoryMovements).where(and(worksiteScopeSqlFor(ctx.scope, inventoryMovements.worksiteId), movementWindow))
  return detectStockIntegrity({ stocks, movements })
}

/**
 * Un producto entra en la ventana por dos vías: un movimiento registrado desde
 * la marca, o un saldo escrito desde la marca. La segunda es la que atrapa un
 * saldo modificado sin movimiento que lo respalde —justo el descuadre que este
 * detector existe para encontrar—.
 */
async function productsTouchedSince(ctx: IntegrityScanContext, since: Date) {
  const window = since.toISOString()
  const [byMovement, byBalance] = await Promise.all([
    ctx.tx.selectDistinct({ productId: inventoryMovements.productId }).from(inventoryMovements)
      .where(and(worksiteScopeSqlFor(ctx.scope, inventoryMovements.worksiteId), gte(inventoryMovements.performedAt, window))),
    ctx.tx.selectDistinct({ productId: worksiteStock.productId }).from(worksiteStock)
      .where(and(worksiteScopeSqlFor(ctx.scope, worksiteStock.worksiteId), gte(worksiteStock.updatedAt, window))),
  ])
  return [...new Set([...byMovement, ...byBalance].map(row => row.productId))]
}
async function scanReceiving(ctx: IntegrityScanContext) {
  const orderItems = await ctx.tx.select({ id: purchaseOrderItems.id, purchaseOrderId: purchaseOrders.id, worksiteId: purchaseOrders.worksiteId, quantity: purchaseOrderItems.quantity, deliveryMode: purchaseOrders.deliveryMode })
    .from(purchaseOrderItems).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .where(and(worksiteScopeSqlFor(ctx.scope, purchaseOrders.worksiteId), ne(purchaseOrders.status, "cancelled"), ne(purchaseOrderItems.status, "cancelled")))
  // GDI-001: sin líneas de OC no hay recepciones que revisar, pero sí puede
  // haber guías con diferencia cotejada. El corte temprano las dejaba fuera.
  if (!orderItems.length) return scanDispatchGuideShrinkage(ctx)
  const dispositions = await ctx.tx.select({ id: receiptItems.id, receiptId: receipts.id, purchaseOrderItemId: receiptItems.purchaseOrderItemId, locationType: receipts.locationType, quantityReceived: receiptItems.quantityReceived, quantityRejected: receiptItems.quantityRejected, quantityDamaged: receiptItems.quantityDamaged })
    .from(receiptItems).innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, receipts.purchaseOrderId))
    .where(and(worksiteScopeSqlFor(ctx.scope, purchaseOrders.worksiteId), inArray(receiptItems.purchaseOrderItemId, orderItems.map(row => row.id))))
  return [
    ...detectReceivingIntegrity({ orderItems, receipts: dispositions }),
    ...await scanDispatchGuideShrinkage(ctx),
  ]
}

/**
 * GDI-001: hasta ahora ningún detector miraba las guías de despacho interno. La
 * diferencia cotejada dejaba inventario fantasma en la faena y nada la recordaba.
 */
async function scanDispatchGuideShrinkage(ctx: IntegrityScanContext) {
  const lines = await ctx.tx
    .select({
      guideId: dispatchGuides.id,
      guideCode: dispatchGuides.code,
      destinationWorksiteId: dispatchGuides.destinationWorksiteId,
      guideStatus: dispatchGuides.status,
      receivedAt: dispatchGuides.receivedAt,
      itemId: dispatchGuideItems.id,
      productId: dispatchGuideItems.productId,
      productName: products.name,
      quantity: dispatchGuideItems.quantity,
      quantityReceived: dispatchGuideItems.quantityReceived,
      differenceReason: dispatchGuideItems.differenceReason,
    })
    .from(dispatchGuideItems)
    .innerJoin(dispatchGuides, eq(dispatchGuides.id, dispatchGuideItems.guideId))
    .innerJoin(products, eq(products.id, dispatchGuideItems.productId))
    .where(and(
      worksiteScopeSqlFor(ctx.scope, dispatchGuides.destinationWorksiteId),
      eq(dispatchGuides.status, "partially_received"),
    ))
    .orderBy(asc(dispatchGuideItems.id))

  return detectDispatchGuideShrinkage({
    lines: lines.map((line) => ({ ...line, quantityReceived: line.quantityReceived ?? 0 })),
  })
}
/**
 * TRZ-003: recorrer todas las OC no anuladas y recalcular la conciliación de
 * cada una era el N+1 más caro del escaneo. Con ventana incremental sólo entran
 * las OC tocadas desde la marca: la propia fila (`updatedAt`, que la
 * conciliación también escribe) o alguna de sus facturas (cargada o anulada
 * dentro de la ventana). Una OC intacta no puede haber cambiado su evidencia.
 */
async function scanPurchasing(ctx: IntegrityScanContext) {
  const window = ctx.since ? ctx.since.toISOString() : null
  const touchedOrders = window
    ? or(
        gte(purchaseOrders.updatedAt, window),
        exists(ctx.tx.select({ present: sql`1` }).from(purchaseOrderInvoices).where(and(
          eq(purchaseOrderInvoices.purchaseOrderId, purchaseOrders.id),
          or(gte(purchaseOrderInvoices.uploadedAt, window), gte(purchaseOrderInvoices.voidedAt, window)),
        ))),
      )
    : undefined
  const orders = await ctx.tx.select().from(purchaseOrders).where(and(worksiteScopeSqlFor(ctx.scope, purchaseOrders.worksiteId), ne(purchaseOrders.status, "cancelled"), touchedOrders)).orderBy(asc(purchaseOrders.id))
  const findings: OperationalIntegrityFinding[] = []
  for (const order of orders) {
    const lines = await ctx.tx.select({ id: purchaseOrderInvoiceItems.id, documentKind: purchaseOrderInvoices.documentKind, quantity: purchaseOrderInvoiceItems.quantity, subtotal: purchaseOrderInvoiceItems.subtotal, unitOfMeasure: purchaseOrderInvoiceItems.unitOfMeasure })
      .from(purchaseOrderInvoiceItems).innerJoin(purchaseOrderInvoices, eq(purchaseOrderInvoices.id, purchaseOrderInvoiceItems.invoiceId))
      // FAC-002: las líneas de una factura anulada no descuadran nada.
      .where(and(eq(purchaseOrderInvoices.purchaseOrderId, order.id), invoiceNotVoided))
      .orderBy(asc(purchaseOrderInvoiceItems.id))
    const invoiceItems = []
    for (const line of lines) {
      const { allocations } = await loadInvoiceLineAllocationsTx(ctx.tx, { purchaseOrderId: order.id, invoiceItemId: line.id, worksiteScope: ctx.scope })
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

/**
 * Quién deja el rastro. Un escaneo automático no tiene usuario, y el audit log
 * admite `userId` nulo justo para eso (el patrón ya vive en las
 * reconciliaciones automáticas de EPP).
 */
interface IntegrityActor { userId: string | null; userEmail: string }
const SYSTEM_ACTOR: IntegrityActor = { userId: null, userEmail: "sistema@chome.cl" }
const actorFor = (session: Session): IntegrityActor => ({ userId: session.user.id, userEmail: session.user.email ?? "" })

async function persistFinding(tx: Tx, actor: IntegrityActor, finding: OperationalIntegrityFinding) {
  await tx.insert(cases).values({ id: nanoid(), caseKey: finding.caseKey, domain: finding.domain, code: finding.code, severity: finding.severity, worksiteId: finding.worksiteId, entityType: finding.entityType, entityId: finding.entityId }).onConflictDoNothing({ target: cases.caseKey })
  const [stored] = await tx.select().from(cases).where(eq(cases.caseKey, finding.caseKey)).for("update")
  // Schema v1 deduplicates evidence for the case's entire lifetime. Reopening
  // an identical fingerprint after resolution needs a future occurrence event;
  // neither this scan nor listing rewrites the append-only history.
  const [observation] = await tx.insert(observations).values({ id: nanoid(), caseId: stored!.id, fingerprint: finding.fingerprint, snapshot: finding.snapshot }).onConflictDoNothing({ target: [observations.caseId, observations.fingerprint] }).returning()
  if (observation) await recordAudit({ userId: actor.userId, userEmail: actor.userEmail || undefined, action: "create", entityType: "operational_integrity_case", entityId: stored!.id, newState: { kind: "observed", observationId: observation.id, fingerprint: observation.fingerprint, code: finding.code } }, tx)
  return observation ? 1 : 0
}

function assertKnownDomains(domains: Domain[]) {
  if (domains.some(domain => !detectors.some(detector => detector.domain === domain))) throw new Error("Dominio inválido")
}

/**
 * TRZ-003: `incremental` recorta por marca de agua. Sólo lo usa el escaneo
 * automático: la marca es una por dominio y global, así que una corrida acotada
 * a una faena que la avanzara dejaría a las demás faenas sin revisar. Un escaneo
 * manual sigue mirando todo su alcance, y avanza nada.
 */
async function runScan(scope: string[] | "all", actor: IntegrityActor, domains: Domain[], options: { incremental?: boolean } = {}) {
  return transaction(async tx => {
    const startedAt = new Date()
    const findings: OperationalIntegrityFinding[] = []
    for (const detector of detectors) if (domains.includes(detector.domain)) {
      const since = options.incremental ? await integrityScanWindowStart(tx, detector.domain, startedAt) : null
      findings.push(...await detector.scan({ tx, scope, since }))
      // La marca se guarda dentro de la misma transacción que las
      // observaciones: si el escaneo falla, no avanza y nada queda sin revisar.
      if (options.incremental) await saveIntegrityScanWatermark(tx, detector.domain, startedAt)
    }
    let recorded = 0
    for (const finding of findings.sort((a, b) => a.caseKey.localeCompare(b.caseKey))) recorded += await persistFinding(tx, actor, finding)
    return { found: findings.length, recorded }
  })
}

export async function scanOperationalIntegrity(session: Session, domains: Domain[]): Promise<{ found: number; recorded: number }> {
  assertMutation(session)
  assertKnownDomains(domains)
  if (domains.includes("purchasing") && !has(session, "purchasing:view")) throw new Error("Permiso insuficiente")
  return runScan(serviceWorksiteScope(session), actorFor(session), domains)
}

/**
 * Escaneo automático, para el cron.
 *
 * No hay sesión que autorizar —la ruta se protege con `CRON_SECRET`— así que
 * tampoco se fabrica una: el alcance es `"all"` de forma explícita y el rastro
 * queda como sistema. Detecta en todas las faenas, que es justo lo que una
 * revisión programada debe hacer y ninguna sesión acotada puede.
 *
 * Sólo observa. Reconocer y verificar siguen exigiendo una persona con
 * `warehouse:reconcile_integrity`.
 *
 * TRZ-003: es el único escaneo incremental. Corre sobre todas las faenas y
 * todos los días, así que su marca de agua por dominio describe de verdad
 * "hasta dónde se revisó"; una corrida manual acotada a una faena no podría
 * decir lo mismo.
 */
export async function scanOperationalIntegrityAsSystem(domains: Domain[]): Promise<{ found: number; recorded: number }> {
  assertKnownDomains(domains)
  return runScan("all", SYSTEM_ACTOR, domains, { incremental: true })
}

function caseState(observationId: string, caseEvents: (typeof events.$inferSelect)[]): OperationalIntegrityState {
  const current = caseEvents.filter(event => event.observationId === observationId)
  if (current.some(event => event.kind === "verified_resolved")) return "verified_resolved"
  return current.some(event => event.kind === "acknowledged") ? "acknowledged" : "open"
}
function caseHref(row: CaseRow) {
  const scope = `faena=${encodeURIComponent(row.worksiteId)}`
  if (row.domain === "stock") return `/bodega?vista=kardex&${scope}&producto=${encodeURIComponent(row.entityId)}`
  // GDI-001: el dominio ya no basta para adivinar la pantalla. Una diferencia de
  // traslado vive en la guía, no en una recepción, y mandar a `/recepcion/<id de
  // guía>` es un 404 con forma de enlace.
  if (row.entityType === "dispatch_guide") return `/bodega/guias/${encodeURIComponent(row.entityId)}`
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
    const finding = await detector.verify({ tx, scope: serviceWorksiteScope(session) }, ref)
    if (finding) {
      await persistFinding(tx, actorFor(session), finding)
      return { resolved: false }
    }
    await appendEvent(tx, session, caseId, observation.id, "verified_resolved", "Corrección verificada mediante el detector del dominio", { findingPresent: false, domain: row.domain, fingerprint: observation.fingerprint, verifiedAt: new Date().toISOString() })
    return { resolved: true }
  })
}
