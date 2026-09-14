/**
 * lib/services/billing/invoices.ts
 *
 * Escritura y derivación del modelo de facturas.
 *
 * Concentra las tres reglas que no pueden quedar repartidas por el módulo:
 *
 * 1. **Idempotencia.** Un documento se identifica por su identidad tributaria;
 *    sincronizar dos veces actualiza, nunca duplica.
 * 2. **La decisión humana manda.** Un `dueDate` puesto a mano o un vínculo
 *    confirmado no los pisa una sincronización posterior.
 * 3. **El estado de pago se calcula.** `paymentStatus` y `paidAmount` son caché
 *    de los pagos *confirmados*; una sugerencia no mueve la aguja.
 */

import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  billingExternalRefs,
  billingInvoiceEvents,
  billingInvoiceItems,
  billingInvoicePayments,
  billingInvoices,
  clients,
  contracts,
  type BillingProviderId,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { addAmounts, compareAmounts, subtractAmounts, sumAmounts, absAmount } from "./money"
import { applyCreditSign } from "./dte-xml"
import type { ProviderInvoice } from "./providers/types"
import { describeCrossBookMatch, findInPurchasingBook } from "@/lib/services/purchasing-module/supplier-document-crosscheck"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type DbOrTx = typeof db | Tx

export type UpsertOutcome = "inserted" | "updated" | "unchanged"

export interface UpsertInvoiceResult {
  outcome: UpsertOutcome
  invoiceId: string
  /** True si el proveedor reportó valores distintos a los ya guardados. */
  changedFields: string[]
}

export class BillingExternalReferenceConflict extends Error {
  readonly code = "EXTERNAL_REFERENCE_REASSIGNMENT"

  constructor(
    readonly provider: BillingProviderId,
    readonly externalId: string,
    readonly existingInvoiceId: string,
    readonly requestedInvoiceId: string,
  ) {
    super(
      `La referencia externa ${provider}/${externalId} ya pertenece a otra factura interna; ` +
      "se rechaza la reasignación.",
    )
    this.name = "BillingExternalReferenceConflict"
  }
}

/** A provider document without a stable external identity is not importable. */
export class BillingExternalReferenceInvalid extends Error {
  readonly code = "EXTERNAL_REFERENCE_INVALID"

  constructor(readonly provider: BillingProviderId) {
    super(`El proveedor ${provider} no entregó una referencia externa válida; se rechaza la factura.`)
    this.name = "BillingExternalReferenceInvalid"
  }
}

/* ── Hash del payload ────────────────────────────────────────────────────── */

/**
 * Huella del contenido que un proveedor reportó para un documento.
 *
 * Sirve para dos cosas distintas que conviene no confundir:
 * - detectar que la fuente cambió (estado, montos) y evaluar si toca actualizar;
 * - comparar lo que dicen dos fuentes sobre el mismo documento.
 *
 * **No** es la identidad del documento: esa es la clave tributaria. Un cambio de
 * estado cambia el hash sin cambiar de documento.
 */
export function computePayloadHash(invoice: ProviderInvoice): string {
  const canonical = [
    invoice.direction,
    invoice.docType,
    String(invoice.folio),
    invoice.issuerTaxId ?? "",
    invoice.receiverTaxId ?? "",
    invoice.issueDate,
    invoice.dueDate ?? "",
    invoice.currency,
    formatForHash(invoice.netAmount),
    formatForHash(invoice.taxAmount),
    formatForHash(invoice.exemptAmount),
    formatForHash(invoice.totalAmount),
    invoice.documentStatus,
    invoice.externalStatus ?? "",
  ].join("|")
  return createHash("sha256").update(canonical).digest("hex")
}

function formatForHash(amount: number | null): string {
  return amount === null ? "" : amount.toFixed(2)
}

/* ── Vencimiento ─────────────────────────────────────────────────────────── */

export interface DueDateResolution {
  dueDate: string | null
  source: "contract" | "client" | "provider" | "manual" | null
}

/**
 * Resuelve el vencimiento con precedencia explícita:
 *
 *   manual (ya guardado) > proveedor (FchVenc del XML) > contrato > cliente
 *
 * El proveedor gana sobre el contrato porque `FchVenc` es lo que dice el
 * documento tributario emitido; el contrato solo permite *derivarlo* cuando el
 * documento no lo trae. Un valor puesto a mano nunca se toca.
 */
export function resolveDueDate(input: {
  existingDueDate: string | null
  existingSource: DueDateResolution["source"]
  providerDueDate: string | null
  issueDate: string
  contractTermsDays: number | null
  clientTermsDays: number | null
}): DueDateResolution {
  if (input.existingSource === "manual" && input.existingDueDate) {
    return { dueDate: input.existingDueDate, source: "manual" }
  }
  if (input.providerDueDate) {
    return { dueDate: input.providerDueDate, source: "provider" }
  }
  if (input.contractTermsDays !== null) {
    return { dueDate: addDays(input.issueDate, input.contractTermsDays), source: "contract" }
  }
  if (input.clientTermsDays !== null) {
    return { dueDate: addDays(input.issueDate, input.clientTermsDays), source: "client" }
  }
  return { dueDate: input.existingDueDate, source: input.existingSource }
}

/** Suma días a una fecha "YYYY-MM-DD" en UTC (sin desplazar el día). */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

/** Días de atraso respecto a `today`. Negativo = aún no vence. */
export function daysOverdue(dueDate: string, today: string): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  return Math.round((now - due) / 86_400_000)
}

/* ── Plazos del cliente/contrato ─────────────────────────────────────────── */

/**
 * Busca los plazos de pago aplicables al RUT de una contraparte.
 * Devuelve nulos si el cliente no existe todavía: el módulo funciona con
 * facturas de clientes que aún no están en el maestro.
 */
export async function lookupPaymentTerms(
  taxId: string,
  executor: DbOrTx = db,
): Promise<{ clientId: string | null; clientTermsDays: number | null; contractTermsDays: number | null }> {
  const client = await executor
    .select({ id: clients.id, terms: clients.paymentTermsDays })
    .from(clients)
    .where(eq(clients.rut, taxId))
    .limit(1)

  const found = client[0]
  if (!found) return { clientId: null, clientTermsDays: null, contractTermsDays: null }

  // Si el cliente tiene exactamente un contrato activo con plazo propio, ese
  // plazo aplica. Con varios contratos no se adivina: manda el del cliente y el
  // vínculo con contrato lo confirma una persona.
  const activeContracts = await executor
    .select({ terms: contracts.paymentTermsDays })
    .from(contracts)
    .where(and(eq(contracts.clientId, found.id), eq(contracts.status, "active")))

  const withTerms = activeContracts.filter((row) => row.terms !== null)
  return {
    clientId: found.id,
    clientTermsDays: found.terms,
    contractTermsDays: withTerms.length === 1 ? withTerms[0]!.terms : null,
  }
}

/* ── Upsert ──────────────────────────────────────────────────────────────── */

/**
 * Inserta o actualiza una factura y su referencia externa, dentro de la
 * transacción del llamador.
 *
 * Requiere `issuerTaxId` y `receiverTaxId`: sin ambos no hay identidad
 * tributaria y el registro no se podría deduplicar. El llamador es responsable
 * de contar y reportar los documentos que llegan sin RUT resuelto — nunca se
 * inventa un valor para poder insertar.
 */
export async function upsertProviderInvoice(
  tx: Tx,
  providerInvoice: ProviderInvoice,
  provider: BillingProviderId,
): Promise<UpsertInvoiceResult> {
  // El signo de una nota de crédito se normaliza acá, en el único camino de
  // escritura de facturas, y no en cada adaptador: unos entregan la NC en
  // magnitud (Chipax, listados del portal) y otros ya en negativo (XML del
  // SII). `applyCreditSign` es idempotente, así que no importa cuál llegue.
  const invoice: ProviderInvoice = {
    ...providerInvoice,
    netAmount:    applyCreditSign(providerInvoice.docType, providerInvoice.netAmount),
    taxAmount:    applyCreditSign(providerInvoice.docType, providerInvoice.taxAmount),
    exemptAmount: applyCreditSign(providerInvoice.docType, providerInvoice.exemptAmount),
    totalAmount:  applyCreditSign(providerInvoice.docType, providerInvoice.totalAmount),
  }

  if (invoice.externalId.trim() === "") {
    throw new BillingExternalReferenceInvalid(provider)
  }
  if (!invoice.issuerTaxId || !invoice.receiverTaxId) {
    throw new Error(
      `Documento ${invoice.docType}/${invoice.folio} sin RUT de emisor o receptor: no se puede identificar.`,
    )
  }

  const payloadHash = computePayloadHash(invoice)
  const now = new Date().toISOString()

  const existingRows = await tx
    .select()
    .from(billingInvoices)
    .where(and(
      eq(billingInvoices.direction, invoice.direction),
      eq(billingInvoices.docType, invoice.docType),
      eq(billingInvoices.folio, invoice.folio),
      eq(billingInvoices.issuerTaxId, invoice.issuerTaxId),
      eq(billingInvoices.receiverTaxId, invoice.receiverTaxId),
    ))
    .limit(1)
  const existing = existingRows[0]

  // La contraparte es el cliente en una venta y el proveedor en una compra.
  const counterpartyTaxId = invoice.direction === "sale" ? invoice.receiverTaxId : invoice.issuerTaxId
  const terms = await lookupPaymentTerms(counterpartyTaxId, tx)

  const due = resolveDueDate({
    existingDueDate: existing?.dueDate ?? null,
    existingSource: existing?.dueDateSource ?? null,
    providerDueDate: invoice.dueDate,
    issueDate: invoice.issueDate,
    contractTermsDays: terms.contractTermsDays,
    clientTermsDays: terms.clientTermsDays,
  })

  if (!existing) {
    const invoiceId = nanoid()
    await tx.insert(billingInvoices).values({
      id: invoiceId,
      direction:      invoice.direction,
      docType:        invoice.docType,
      folio:          invoice.folio,
      issuerTaxId:    invoice.issuerTaxId,
      issuerName:     invoice.issuerName ?? invoice.issuerTaxId,
      receiverTaxId:  invoice.receiverTaxId,
      receiverName:   invoice.receiverName ?? invoice.receiverTaxId,
      issueDate:      invoice.issueDate,
      dueDate:        due.dueDate,
      dueDateSource:  due.source,
      currency:       invoice.currency,
      netAmount:      invoice.netAmount,
      taxAmount:      invoice.taxAmount,
      exemptAmount:   invoice.exemptAmount,
      totalAmount:    invoice.totalAmount,
      documentStatus: invoice.documentStatus,
      source:         provider,
      sourceLastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    await replaceItems(tx, invoiceId, invoice)
    await upsertExternalRef(tx, invoiceId, invoice, provider, payloadHash, now)
    await recordInvoiceEvent(tx, {
      invoiceId,
      eventType: "invoice.imported",
      actorKind: "provider",
      detail: { provider, externalId: invoice.externalId, documentStatus: invoice.documentStatus },
    })

    // E2E-003: el mismo documento de proveedor puede estar ya adjunto a una OC
    // en `purchase_order_invoices`, un libro que este no conoce. Cuál de los dos
    // manda es una decisión de producto; mientras no se tome, al menos queda
    // constancia de que el documento entró dos veces por puertas distintas.
    if (invoice.direction === "purchase") {
      const twin = await findInPurchasingBook(
        { issuerTaxId: invoice.issuerTaxId, folio: invoice.folio, docType: invoice.docType },
        tx,
      )
      if (twin) {
        await recordInvoiceEvent(tx, {
          invoiceId,
          eventType: "invoice.crossbook_duplicate",
          actorKind: "system",
          detail: {
            book: "purchasing",
            purchaseOrderInvoiceId: twin.id,
            purchaseOrderCode: twin.purchaseOrderCode ?? null,
            message: describeCrossBookMatch(twin),
          },
        })
      }
    }

    return { outcome: "inserted", invoiceId, changedFields: [] }
  }

  // Ya existe: se compara contra lo que ESTE proveedor había reportado antes.
  const refRows = await tx
    .select({ payloadHash: billingExternalRefs.payloadHash })
    .from(billingExternalRefs)
    .where(and(
      eq(billingExternalRefs.invoiceId, existing.id),
      eq(billingExternalRefs.provider, provider),
    ))
    .limit(1)

  const sameHash = refRows[0]?.payloadHash === payloadHash
  await upsertExternalRef(tx, existing.id, invoice, provider, payloadHash, now)

  if (sameHash) {
    return { outcome: "unchanged", invoiceId: existing.id, changedFields: [] }
  }

  const changedFields: string[] = []
  const updates: Partial<typeof billingInvoices.$inferInsert> = {
    sourceLastSyncedAt: now,
    updatedAt: now,
  }

  // Solo se actualizan los campos que son responsabilidad del proveedor. Los
  // internos (vínculos, responsable, estado de cobranza, notas) no se tocan.
  if (compareAmounts(existing.totalAmount, invoice.totalAmount) !== 0) {
    updates.totalAmount = invoice.totalAmount
    changedFields.push("totalAmount")
  }
  if (invoice.netAmount !== null && existing.netAmount !== invoice.netAmount) {
    updates.netAmount = invoice.netAmount
    changedFields.push("netAmount")
  }
  if (invoice.taxAmount !== null && existing.taxAmount !== invoice.taxAmount) {
    updates.taxAmount = invoice.taxAmount
    changedFields.push("taxAmount")
  }
  if (invoice.exemptAmount !== null && existing.exemptAmount !== invoice.exemptAmount) {
    updates.exemptAmount = invoice.exemptAmount
    changedFields.push("exemptAmount")
  }
  if (invoice.documentStatus !== "unknown" && existing.documentStatus !== invoice.documentStatus) {
    updates.documentStatus = invoice.documentStatus
    changedFields.push("documentStatus")
  }
  // El vencimiento solo se mueve si no lo fijó una persona.
  if (existing.dueDateSource !== "manual" && due.dueDate !== existing.dueDate) {
    updates.dueDate = due.dueDate
    updates.dueDateSource = due.source
    changedFields.push("dueDate")
  }
  if (invoice.receiverName && existing.receiverName !== invoice.receiverName) {
    updates.receiverName = invoice.receiverName
    changedFields.push("receiverName")
  }
  if (invoice.issuerName && existing.issuerName !== invoice.issuerName) {
    updates.issuerName = invoice.issuerName
    changedFields.push("issuerName")
  }

  await tx.update(billingInvoices).set(updates).where(eq(billingInvoices.id, existing.id))

  // `paymentStatus`/`paidAmount` son caché derivada del total: si el proveedor
  // corrigió el monto, la factura quedaba "pagada" con saldo real pendiente
  // (o sobrepagada sin marcarlo). Recalcular es idempotente.
  if (changedFields.includes("totalAmount")) {
    await recomputeInvoicePaymentStatus(tx, existing.id)
  }

  // Los ítems solo se reemplazan si esta fuente los trajo: una fuente que solo
  // entrega totales no debe borrar los ítems que otra sí entregó.
  if (invoice.items.length > 0) {
    await replaceItems(tx, existing.id, invoice)
  }

  if (changedFields.length > 0) {
    await recordInvoiceEvent(tx, {
      invoiceId: existing.id,
      eventType: "invoice.updated_from_provider",
      actorKind: "provider",
      detail: { provider, changedFields },
    })
    return { outcome: "updated", invoiceId: existing.id, changedFields }
  }

  return { outcome: "unchanged", invoiceId: existing.id, changedFields: [] }
}

async function replaceItems(tx: Tx, invoiceId: string, invoice: ProviderInvoice): Promise<void> {
  if (invoice.items.length === 0) return
  await tx.delete(billingInvoiceItems).where(eq(billingInvoiceItems.invoiceId, invoiceId))
  await tx.insert(billingInvoiceItems).values(
    invoice.items.map((item) => ({
      id: nanoid(),
      invoiceId,
      externalItemId: item.externalItemId,
      description:    item.description,
      quantity:       item.quantity,
      unit:           item.unit,
      unitPrice:      item.unitPrice,
      discountAmount: item.discountAmount,
      netAmount:      item.netAmount,
      taxAmount:      item.taxAmount,
      totalAmount:    item.totalAmount,
      sortOrder:      item.sortOrder,
    })),
  )
}

async function upsertExternalRef(
  tx: Tx,
  invoiceId: string,
  invoice: ProviderInvoice,
  provider: BillingProviderId,
  payloadHash: string,
  now: string,
): Promise<void> {
  // El snapshot guarda solo campos normalizados del documento: sirve para
  // comparar fuentes. Nunca credenciales, ni el XML completo, ni glosas crudas.
  const snapshot = {
    docType: invoice.docType,
    folio: invoice.folio,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    totalAmount: invoice.totalAmount,
    netAmount: invoice.netAmount,
    taxAmount: invoice.taxAmount,
    exemptAmount: invoice.exemptAmount,
    documentStatus: invoice.documentStatus,
  }

  const values = {
      id: nanoid(),
      invoiceId,
      provider,
      externalId:     invoice.externalId,
      externalFolio:  String(invoice.folio),
      externalStatus: invoice.externalStatus,
      accountRef:     invoice.accountRef,
      documentUrl:    invoice.documentUrl,
      payloadHash,
      snapshot,
      firstSeenAt: now,
      lastSeenAt: now,
    }

  // La fila tiene DOS identidades únicas: (provider, externalId) y
  // (invoiceId, provider). `ON CONFLICT` solo puede nombrar una, así que un
  // choque con la otra escapaba como 23505 crudo y mataba el documento en la
  // corrida. Pasa de verdad: el externalId NO es inmutable (la bandeja del
  // portal lo recalcula según lo que logre decodificar de cada fila, y el
  // CodEmp puede cambiar), mientras que el par (factura, proveedor) sí lo es.
  // Por eso se resuelven las dos antes de insertar.
  const [byExternalId] = await tx
    .select({ id: billingExternalRefs.id, invoiceId: billingExternalRefs.invoiceId })
    .from(billingExternalRefs)
    .where(and(
      eq(billingExternalRefs.provider, provider),
      eq(billingExternalRefs.externalId, invoice.externalId),
    ))
    .limit(1)

  // Mover una referencia externa de una factura interna a otra sigue prohibido:
  // el vínculo es identidad, no un dato editable.
  if (byExternalId && byExternalId.invoiceId !== invoiceId) {
    throw new BillingExternalReferenceConflict(provider, invoice.externalId, byExternalId.invoiceId, invoiceId)
  }

  const [byInvoice] = byExternalId
    ? [byExternalId]
    : await tx
        .select({ id: billingExternalRefs.id, invoiceId: billingExternalRefs.invoiceId })
        .from(billingExternalRefs)
        .where(and(
          eq(billingExternalRefs.invoiceId, invoiceId),
          eq(billingExternalRefs.provider, provider),
        ))
        .limit(1)

  let existingId = byInvoice?.id ?? null

  if (existingId === null) {
    const inserted = await tx.insert(billingExternalRefs).values(values)
      .onConflictDoNothing({ target: [billingExternalRefs.provider, billingExternalRefs.externalId] })
      .returning({ id: billingExternalRefs.id })
    if (inserted.length > 0) return

    // Carrera: otra transacción insertó esta misma referencia entre la lectura
    // y el insert. Se resuelve releyendo, con la misma regla de identidad.
    const [raced] = await tx.select({ id: billingExternalRefs.id, invoiceId: billingExternalRefs.invoiceId })
      .from(billingExternalRefs)
      .where(and(
        eq(billingExternalRefs.provider, provider),
        eq(billingExternalRefs.externalId, invoice.externalId),
      ))
      .limit(1)
    if (!raced) throw new Error("No se pudo resolver la referencia externa después del conflicto de unicidad.")
    if (raced.invoiceId !== invoiceId) {
      throw new BillingExternalReferenceConflict(provider, invoice.externalId, raced.invoiceId, invoiceId)
    }
    existingId = raced.id
  }

  await tx.update(billingExternalRefs).set({
    // El proveedor puede recalcular el id externo de un documento ya importado.
    externalId:     invoice.externalId,
    externalStatus: invoice.externalStatus,
    documentUrl:    invoice.documentUrl,
    payloadHash,
    snapshot,
    lastSeenAt: now,
  }).where(eq(billingExternalRefs.id, existingId))
}

/* ── Historial ───────────────────────────────────────────────────────────── */

export async function recordInvoiceEvent(
  executor: DbOrTx,
  event: {
    invoiceId: string
    eventType: string
    actorKind: "provider" | "system" | "user"
    actorUserId?: string | null
    detail?: Record<string, unknown>
  },
): Promise<void> {
  await executor.insert(billingInvoiceEvents).values({
    id: nanoid(),
    invoiceId:   event.invoiceId,
    eventType:   event.eventType,
    actorKind:   event.actorKind,
    actorUserId: event.actorUserId ?? null,
    detail:      event.detail ?? {},
  })
}

/* ── Estado de pago derivado ─────────────────────────────────────────────── */

export interface PaymentStatusSnapshot {
  paidAmount: number
  paymentStatus: "unpaid" | "partial" | "paid" | "overpaid"
  outstandingAmount: number
}

/**
 * Calcula el estado de pago a partir de los pagos **confirmados**.
 *
 * Compara magnitudes porque una nota de crédito tiene total negativo: lo que
 * interesa es cuánto del documento quedó cubierto. Pero el pago tiene que ir en
 * la MISMA dirección que el documento — un pago negativo no cubre una factura
 * positiva.
 */
export function derivePaymentStatus(
  totalAmount: number,
  confirmedPayments: readonly number[],
): PaymentStatusSnapshot {
  const paidAmount = sumAmounts(confirmedPayments)
  const total = absAmount(totalAmount)
  // La cobertura se mide EN LA DIRECCIÓN del documento, no por magnitud: una NC
  // (total negativo) se cubre con pagos negativos. Tomar el valor absoluto de
  // la suma hacía que un ajuste negativo sobre una factura positiva se leyera
  // como cobertura completa y la sacara de la cobranza.
  const paid = compareAmounts(totalAmount, 0) < 0 ? subtractAmounts(0, paidAmount) : paidAmount
  const outstandingAmount = addAmounts(total, -paid)

  // Sin cobertura, o cobertura de signo contrario: no está pagada, y lo
  // pendiente crece en vez de bajar.
  if (compareAmounts(paid, 0) <= 0) {
    return { paidAmount, paymentStatus: "unpaid", outstandingAmount }
  }
  const comparison = compareAmounts(paid, total)
  if (comparison < 0) {
    return { paidAmount, paymentStatus: "partial", outstandingAmount }
  }
  if (comparison === 0) {
    return { paidAmount, paymentStatus: "paid", outstandingAmount: 0 }
  }
  return { paidAmount, paymentStatus: "overpaid", outstandingAmount }
}

/**
 * Relee los pagos confirmados de una factura y persiste el estado derivado.
 * Se llama después de cualquier cambio en pagos; es idempotente.
 */
export async function recomputeInvoicePaymentStatus(
  executor: DbOrTx,
  invoiceId: string,
): Promise<PaymentStatusSnapshot> {
  const invoiceRows = await executor
    .select({ totalAmount: billingInvoices.totalAmount })
    .from(billingInvoices)
    .where(eq(billingInvoices.id, invoiceId))
    .limit(1)

  const invoice = invoiceRows[0]
  if (!invoice) throw new Error(`Factura ${invoiceId} no encontrada.`)

  const payments = await executor
    .select({ amount: billingInvoicePayments.amount })
    .from(billingInvoicePayments)
    .where(and(
      eq(billingInvoicePayments.invoiceId, invoiceId),
      eq(billingInvoicePayments.verificationStatus, "confirmed"),
    ))

  const snapshot = derivePaymentStatus(invoice.totalAmount, payments.map((row) => row.amount))

  await executor
    .update(billingInvoices)
    .set({
      paidAmount: snapshot.paidAmount,
      paymentStatus: snapshot.paymentStatus,
      updatedAt: sql`now()`,
    })
    .where(eq(billingInvoices.id, invoiceId))

  return snapshot
}
