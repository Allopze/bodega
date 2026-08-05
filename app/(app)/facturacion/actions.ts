"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  billingInvoiceLinks,
  billingInvoices,
  clients,
  contracts,
} from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { recordInvoiceEvent } from "@/lib/services/billing/invoices"
import { syncBillingInvoices, currentPeriod } from "@/lib/services/billing/sync"
import { getBillingProvider } from "@/lib/services/billing/providers"
import type { BillingProviderId } from "@/db/schema"

export interface ActionResult {
  ok: boolean
  message: string
}

/* ── Sincronización manual ───────────────────────────────────────────────── */

const syncSchema = z.object({
  provider: z.enum(["factura_en_linea", "chipax", "manual"]),
  scope: z.enum(["sales_invoices", "purchase_invoices"]),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El período debe tener formato AAAA-MM"),
  dryRun: z.boolean().default(false),
})

/**
 * Dispara una sincronización manual.
 *
 * Es una acción administrativa explícita: nunca se importa un histórico solo
 * porque alguien abrió la pantalla. El modo simulación permite ver qué traería
 * la fuente antes de escribir nada.
 */
export async function triggerBillingSyncAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_sync")
  if (error) return error

  const parsed = syncSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Parámetros inválidos" }
  }

  try {
    const result = await syncBillingInvoices({
      ...parsed.data,
      trigger: "manual",
      triggeredBy: session.user.id,
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "billing_sync_run",
      entityId: result.runId || "skipped",
      newState: {
        provider: result.provider,
        scope: result.scope,
        period: result.period,
        status: result.status,
        dryRun: result.dryRun,
      },
    })

    revalidatePath("/facturacion/sincronizacion")
    revalidatePath("/facturacion")

    if (result.status === "skipped") {
      return { ok: true, message: result.errorSummary ?? "No se ejecutó." }
    }
    if (result.status === "failed") {
      return { ok: false, message: result.errorSummary ?? "La sincronización falló." }
    }

    const prefix = result.dryRun ? "Simulación:" : "Sincronizado:"
    const detail = result.dryRun
      ? `${result.recordsFetched} documentos llegarían desde la fuente`
      : `${result.recordsCreated} nuevos, ${result.recordsUpdated} actualizados, ${result.recordsUnchanged} sin cambios de ${result.recordsFetched} leídos`
    const warnings = [
      result.duplicatesDetected > 0 ? `${result.duplicatesDetected} duplicados` : null,
      result.conflictsDetected > 0 ? `${result.conflictsDetected} sin RUT resuelto` : null,
      result.errorsCount > 0 ? `${result.errorsCount} con error` : null,
    ].filter(Boolean)

    // Llegar acá significa `success` o `partial`: `failed` y `skipped` ya
    // retornaron arriba. Una corrida parcial se informa como correcta pero con
    // sus advertencias visibles, nunca en silencio.
    return {
      ok: true,
      message: `${prefix} ${detail}${warnings.length > 0 ? ` · ${warnings.join(", ")}` : ""}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de sincronización"
    logger.error("[billing/triggerSync]", { message })
    return { ok: false, message }
  }
}

/** Diagnóstico de un proveedor, sin secretos. */
export async function checkProviderHealthAction(provider: BillingProviderId): Promise<ActionResult> {
  const { error } = await guardPermission("billing:manage_sync")
  if (error) return error

  try {
    const health = await getBillingProvider(provider).healthCheck()
    revalidatePath("/facturacion/sincronizacion")
    return { ok: health.ok, message: health.detail }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "No se pudo consultar el proveedor" }
  }
}

/* ── Vínculo operacional de una factura ──────────────────────────────────── */

const linkSchema = z.object({
  invoiceId: z.string().min(1),
  clientId: z.string().min(1).nullable().optional(),
  contractId: z.string().min(1).nullable().optional(),
  worksiteId: z.string().min(1).nullable().optional(),
  servicePeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(),
  clientPoNumber: z.string().max(120).nullable().optional(),
  amount: z.number().finite().nonnegative().nullable().optional(),
}).refine(
  (value) => Boolean(value.clientId || value.contractId || value.worksiteId),
  { message: "El vínculo tiene que apuntar al menos a un cliente, contrato o faena" },
)

/**
 * Vincula una factura con la operación interna.
 *
 * Nace **confirmado** porque lo está creando una persona con permiso: es una
 * decisión, no una inferencia. Las sugerencias automáticas las crea el motor de
 * conciliación con `matchedBy: "auto"` y estado `suggested`.
 */
export async function linkInvoiceAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_invoices")
  if (error) return error

  const parsed = linkSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const data = parsed.data

  // Un rol acotado por faena no puede vincular una factura a una faena que no
  // ve. La validación es en el backend, no en el botón.
  const scope = resolveWorksiteScope(session)
  if (data.worksiteId && scope.mode === "some" && !scope.ids.includes(data.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esa faena" }
  }
  if (data.worksiteId && scope.mode === "none") {
    return { ok: false, message: "No tienes acceso a ninguna faena" }
  }

  try {
    const invoice = await db.query.billingInvoices.findFirst({
      where: eq(billingInvoices.id, data.invoiceId),
      columns: { id: true, folio: true, docType: true },
    })
    if (!invoice) return { ok: false, message: "La factura no existe" }

    // El contrato tiene que pertenecer al cliente indicado: un vínculo
    // inconsistente contamina todos los reportes por contrato.
    if (data.contractId) {
      const contract = await db.query.contracts.findFirst({
        where: eq(contracts.id, data.contractId),
        columns: { id: true, clientId: true },
      })
      if (!contract) return { ok: false, message: "El contrato no existe" }
      if (data.clientId && contract.clientId !== data.clientId) {
        return { ok: false, message: "El contrato no pertenece al cliente seleccionado" }
      }
    }

    const now = new Date().toISOString()
    const linkId = nanoid()

    await db.transaction(async (tx) => {
      await tx.insert(billingInvoiceLinks).values({
        id: linkId,
        invoiceId: data.invoiceId,
        clientId: data.clientId ?? null,
        contractId: data.contractId ?? null,
        worksiteId: data.worksiteId ?? null,
        servicePeriod: data.servicePeriod ?? null,
        clientPoNumber: data.clientPoNumber ?? null,
        amount: data.amount ?? null,
        status: "confirmed",
        matchedBy: "user",
        confirmedBy: session.user.id,
        confirmedAt: now,
        createdBy: session.user.id,
      })

      await recordInvoiceEvent(tx, {
        invoiceId: data.invoiceId,
        eventType: "invoice.link_added",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: {
          clientId: data.clientId ?? null,
          contractId: data.contractId ?? null,
          worksiteId: data.worksiteId ?? null,
          servicePeriod: data.servicePeriod ?? null,
        },
      })
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "billing_invoice_link",
      entityId: linkId,
      newState: { invoiceId: data.invoiceId, clientId: data.clientId, contractId: data.contractId, worksiteId: data.worksiteId },
    })

    revalidatePath(`/facturacion/facturas/${data.invoiceId}`)
    revalidatePath("/facturacion/facturas")
    revalidatePath("/facturacion")
    return { ok: true, message: "Vínculo registrado" }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo registrar el vínculo"
    logger.error("[billing/linkInvoice]", { message })
    return { ok: false, message }
  }
}

/** Descarta un vínculo. No se borra: queda como `rejected` para trazabilidad. */
export async function rejectInvoiceLinkAction(linkId: string): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_invoices")
  if (error) return error

  try {
    const link = await db.query.billingInvoiceLinks.findFirst({
      where: eq(billingInvoiceLinks.id, linkId),
      columns: { id: true, invoiceId: true, status: true },
    })
    if (!link) return { ok: false, message: "El vínculo no existe" }

    await db.transaction(async (tx) => {
      await tx.update(billingInvoiceLinks)
        .set({ status: "rejected", updatedAt: new Date().toISOString() })
        .where(eq(billingInvoiceLinks.id, linkId))

      await recordInvoiceEvent(tx, {
        invoiceId: link.invoiceId,
        eventType: "invoice.link_rejected",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: { linkId, previousStatus: link.status },
      })
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "billing_invoice_link",
      entityId: linkId,
      oldState: { status: link.status },
      newState: { status: "rejected" },
    })

    revalidatePath(`/facturacion/facturas/${link.invoiceId}`)
    return { ok: true, message: "Vínculo descartado" }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "No se pudo descartar el vínculo" }
  }
}

/** Confirma un vínculo sugerido automáticamente. */
export async function confirmInvoiceLinkAction(linkId: string): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_invoices")
  if (error) return error

  try {
    const link = await db.query.billingInvoiceLinks.findFirst({
      where: and(eq(billingInvoiceLinks.id, linkId), eq(billingInvoiceLinks.status, "suggested")),
      columns: { id: true, invoiceId: true, worksiteId: true },
    })
    if (!link) return { ok: false, message: "El vínculo no existe o ya fue resuelto" }

    const scope = resolveWorksiteScope(session)
    if (link.worksiteId && scope.mode === "some" && !scope.ids.includes(link.worksiteId)) {
      return { ok: false, message: "No tienes acceso a esa faena" }
    }

    const now = new Date().toISOString()
    await db.transaction(async (tx) => {
      await tx.update(billingInvoiceLinks)
        .set({ status: "confirmed", confirmedBy: session.user.id, confirmedAt: now, updatedAt: now })
        .where(eq(billingInvoiceLinks.id, linkId))

      await recordInvoiceEvent(tx, {
        invoiceId: link.invoiceId,
        eventType: "invoice.link_confirmed",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: { linkId },
      })
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "billing_invoice_link",
      entityId: linkId,
      oldState: { status: "suggested" },
      newState: { status: "confirmed" },
    })

    revalidatePath(`/facturacion/facturas/${link.invoiceId}`)
    return { ok: true, message: "Vínculo confirmado" }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "No se pudo confirmar el vínculo" }
  }
}

/* ── Datos internos de la factura ────────────────────────────────────────── */

const internalDataSchema = z.object({
  invoiceId: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ownerUserId: z.string().min(1).nullable().optional(),
  collectionStatus: z.enum(["none", "in_progress", "committed", "disputed", "closed", "written_off"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

/**
 * Edita los datos INTERNOS de una factura. Nunca los tributarios: folio, RUT,
 * montos y estado SII son del documento, no de la plataforma.
 *
 * Fijar el vencimiento a mano lo marca como `manual`, y desde ese momento
 * ninguna sincronización lo vuelve a mover.
 */
export async function updateInvoiceInternalDataAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_invoices")
  if (error) return error

  const parsed = internalDataSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const data = parsed.data

  try {
    const invoice = await db.query.billingInvoices.findFirst({
      where: eq(billingInvoices.id, data.invoiceId),
      columns: { id: true, dueDate: true, dueDateSource: true, ownerUserId: true, collectionStatus: true, notes: true },
    })
    if (!invoice) return { ok: false, message: "La factura no existe" }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    const changed: string[] = []

    if (data.dueDate !== undefined && data.dueDate !== invoice.dueDate) {
      updates.dueDate = data.dueDate
      updates.dueDateSource = data.dueDate ? "manual" : null
      changed.push("dueDate")
    }
    if (data.ownerUserId !== undefined && data.ownerUserId !== invoice.ownerUserId) {
      updates.ownerUserId = data.ownerUserId
      changed.push("ownerUserId")
    }
    if (data.collectionStatus !== undefined && data.collectionStatus !== invoice.collectionStatus) {
      updates.collectionStatus = data.collectionStatus
      changed.push("collectionStatus")
    }
    if (data.notes !== undefined && data.notes !== invoice.notes) {
      updates.notes = data.notes
      changed.push("notes")
    }

    if (changed.length === 0) return { ok: true, message: "Sin cambios" }

    await db.transaction(async (tx) => {
      await tx.update(billingInvoices).set(updates).where(eq(billingInvoices.id, data.invoiceId))
      await recordInvoiceEvent(tx, {
        invoiceId: data.invoiceId,
        eventType: "invoice.internal_data_updated",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: { changed },
      })
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "billing_invoice",
      entityId: data.invoiceId,
      oldState: { dueDate: invoice.dueDate, collectionStatus: invoice.collectionStatus },
      newState: { dueDate: updates.dueDate ?? invoice.dueDate, collectionStatus: updates.collectionStatus ?? invoice.collectionStatus },
    })

    revalidatePath(`/facturacion/facturas/${data.invoiceId}`)
    revalidatePath("/facturacion/facturas")
    return { ok: true, message: "Datos internos actualizados" }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudieron guardar los cambios"
    logger.error("[billing/updateInternalData]", { message })
    return { ok: false, message }
  }
}

/* ── Maestro comercial ───────────────────────────────────────────────────── */

const clientSchema = z.object({
  id: z.string().optional(),
  rut: z.string().min(3, "El RUT es obligatorio"),
  name: z.string().min(2, "La razón social es obligatoria"),
  tradeName: z.string().max(200).nullable().optional(),
  email: z.email("Correo inválido").nullable().optional().or(z.literal("")),
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, "Moneda inválida").default("CLP"),
  ownerUserId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
})

export async function saveClientAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_clients")
  if (error) return error

  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const data = parsed.data
  const { cleanRut, validateRut } = await import("@/lib/rut")
  const rut = cleanRut(data.rut)
  if (!validateRut(rut)) return { ok: false, message: "El RUT no es válido" }

  try {
    const now = new Date().toISOString()
    const values = {
      rut,
      name: data.name.trim(),
      tradeName: data.tradeName || null,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      paymentTermsDays: data.paymentTermsDays ?? null,
      defaultCurrency: data.defaultCurrency,
      ownerUserId: data.ownerUserId ?? null,
      isActive: data.isActive,
      notes: data.notes || null,
      updatedAt: now,
    }

    if (data.id) {
      await db.update(clients).set(values).where(eq(clients.id, data.id))
    } else {
      const existing = await db.query.clients.findFirst({
        where: eq(clients.rut, rut),
        columns: { id: true, name: true },
      })
      if (existing) {
        return { ok: false, message: `Ya existe un cliente con ese RUT: ${existing.name}` }
      }
      await db.insert(clients).values({ id: nanoid(), ...values })
    }

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: data.id ? "update" : "create",
      entityType: "client",
      entityId: data.id ?? rut,
      newState: { rut, name: values.name, isActive: values.isActive },
    })

    revalidatePath("/facturacion/clientes")
    return { ok: true, message: data.id ? "Cliente actualizado" : "Cliente creado" }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo guardar el cliente"
    logger.error("[billing/saveClient]", { message })
    return { ok: false, message }
  }
}

const contractSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(2, "El código es obligatorio").max(40),
  clientId: z.string().min(1, "Selecciona un cliente"),
  name: z.string().min(2, "El nombre es obligatorio"),
  worksiteId: z.string().min(1).nullable().optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  clientPoNumber: z.string().max(120).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("CLP"),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  billingCycle: z.enum(["monthly", "milestone", "none"]).default("monthly"),
  periodAmount: z.number().finite().nonnegative().nullable().optional(),
  ownerUserId: z.string().min(1).nullable().optional(),
  status: z.enum(["active", "suspended", "closed"]).default("active"),
  notes: z.string().max(2000).nullable().optional(),
})

export async function saveContractAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_clients")
  if (error) return error

  const parsed = contractSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const data = parsed.data

  if (data.startDate && data.endDate && data.startDate > data.endDate) {
    return { ok: false, message: "La fecha de término no puede ser anterior al inicio" }
  }

  try {
    const now = new Date().toISOString()
    const values = {
      code: data.code.trim().toUpperCase(),
      clientId: data.clientId,
      name: data.name.trim(),
      worksiteId: data.worksiteId ?? null,
      costCenterId: data.costCenterId ?? null,
      clientPoNumber: data.clientPoNumber || null,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      currency: data.currency,
      paymentTermsDays: data.paymentTermsDays ?? null,
      billingCycle: data.billingCycle,
      periodAmount: data.periodAmount ?? null,
      ownerUserId: data.ownerUserId ?? null,
      status: data.status,
      notes: data.notes || null,
      updatedAt: now,
    }

    if (data.id) {
      await db.update(contracts).set(values).where(eq(contracts.id, data.id))
    } else {
      const existing = await db.query.contracts.findFirst({
        where: eq(contracts.code, values.code),
        columns: { id: true },
      })
      if (existing) return { ok: false, message: `Ya existe un contrato con el código ${values.code}` }
      await db.insert(contracts).values({ id: nanoid(), ...values })
    }

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: data.id ? "update" : "create",
      entityType: "contract",
      entityId: data.id ?? values.code,
      newState: { code: values.code, clientId: values.clientId, status: values.status },
    })

    revalidatePath("/facturacion/clientes")
    return { ok: true, message: data.id ? "Contrato actualizado" : "Contrato creado" }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo guardar el contrato"
    logger.error("[billing/saveContract]", { message })
    return { ok: false, message }
  }
}

export { currentPeriod }
