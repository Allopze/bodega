/**
 * Repuestos service — solicitud lifecycle: draft, quotation management, approval.
 *
 * Hard rule: all DB mutations here, never in Server Actions or UI components.
 *
 * Flow:
 *   draft → (upload 1..N cotizaciones) → submitted (items: draft→requested)
 *   jefa selects one quotation → items: requested→approved, suggestedSupplierId set
 *   [shared] compras → OC → recepción (via existing purchasing/item-state services)
 */

import { eq, and, inArray } from "drizzle-orm"
import { promises as fs } from "node:fs"
import path from "node:path"
import { db, type Tx } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes,
  repuestoQuotations, approvalDecisions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { submitItemTx } from "@/lib/services/item-state"
import {
  createQuotationAttachmentPath,
  resolveQuotationAttachmentFile,
  resolveRepuestosDir,
} from "@/lib/storage/config"
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"
import type { Session } from "next-auth"

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface RepuestoItemInput {
  id?:            string
  description:    string
  quantity:       number
  unitOfMeasure:  string
  sortOrder?:     number
  notes?:         string | null
  partNumber?:    string | null
  equipmentName?: string | null
  patent?:        string | null
  brand?:         string | null
  model?:         string | null
}

export interface RepuestoRequestInput {
  id?:           string
  worksiteId:    string
  urgency:       "normal" | "high" | "critical"
  requiredDate:  string
  justification?: string | null
  items:         RepuestoItemInput[]
}

export interface AddQuotationInput {
  requestId:        string
  totalAmount:      number
  supplierId?:      string | null
  supplierNameFree?: string | null
  notes?:           string | null
  // File upload (received from FormData in the action)
  fileBuffer:       Buffer
  fileName:         string
  mimeType?:        string | null
  fileSize?:        number | null
  uploadedBy:       string
  userEmail?:       string
}

export interface DeleteQuotationInput {
  quotationId: string
  userId:      string
  userEmail?:  string
}

export interface SubmitRepuestoInput {
  requestId:     string
  userId:        string
  userEmail?:    string
  // If < 3 quotations, justification must be in the request notes
}

export interface SelectQuotationInput {
  requestId:   string
  quotationId: string
  userId:      string
  userEmail?:  string
  roleContext?: string
}

/* ── Persist draft (create or update) ───────────────────────────────────────── */

export async function persistRepuestoDraft(
  session: Session,
  data: RepuestoRequestInput,
): Promise<string> {
  const isEdit = !!data.id
  let requestId = data.id ?? nanoid()
  const now = new Date().toISOString()
  const year = new Date().getFullYear()

  await db.transaction(async (tx) => {
    if (isEdit) {
      // Verify ownership + draft status
      const existing = await tx.query.purchaseRequests.findFirst({
        where: eq(purchaseRequests.id, requestId),
        columns: { id: true, requesterId: true, status: true },
      })
      if (!existing) throw new Error("Solicitud no encontrada")
      if (!["draft", "returned"].includes(existing.status)) {
        throw new Error("Solo se puede editar una solicitud en borrador o devuelta")
      }
      if (existing.requesterId !== session.user.id) {
        throw new Error("Solo el solicitante puede editar su propia solicitud")
      }

      await tx.update(purchaseRequests).set({
        worksiteId:   data.worksiteId,
        urgency:      data.urgency,
        requiredDate: data.requiredDate,
        notes:        data.justification || null,
        updatedAt:    now,
      }).where(eq(purchaseRequests.id, requestId))

      // Replace items (delete existing, re-insert)
      await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.requestId, requestId))
    } else {
      const code = await nextCodeTx(tx, "REP", year)
      await tx.insert(purchaseRequests).values({
        id:          requestId,
        code,
        worksiteId:  data.worksiteId,
        requesterId: session.user.id,
        requestType: "repuestos",
        urgency:     data.urgency,
        requiredDate: data.requiredDate,
        notes:       data.justification || null,
        status:      "draft",
        createdAt:   now,
        updatedAt:   now,
      })

      await recordAudit({
        userId:     session.user.id,
        userEmail:  session.user.email ?? undefined,
        action:     "create",
        entityType: "purchase_request",
        entityId:   requestId,
        entityCode: code,
        newState:   { status: "draft", requestType: "repuestos" },
      }, tx)
    }

    // Insert items + attributes
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      const itemId = item.id ?? nanoid()

      await tx.insert(purchaseRequestItems).values({
        id:              itemId,
        requestId,
        productId:       null,
        productNameFree: item.description,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        status:          "draft",
        urgency:         data.urgency,
        requiredDate:    data.requiredDate,
        workerId:        null,
        sortOrder:       item.sortOrder ?? i,
        notes:           item.notes ?? null,
        createdAt:       now,
        updatedAt:       now,
      })

      // Insert open-field attributes (only those with a value)
      const attrs: Array<{ name: string; value: string | null | undefined }> = [
        { name: REPUESTO_ATTRIBUTE_NAMES.partNumber,    value: item.partNumber },
        { name: REPUESTO_ATTRIBUTE_NAMES.equipmentName, value: item.equipmentName },
        { name: REPUESTO_ATTRIBUTE_NAMES.patent,        value: item.patent },
        { name: REPUESTO_ATTRIBUTE_NAMES.brand,         value: item.brand },
        { name: REPUESTO_ATTRIBUTE_NAMES.model,         value: item.model },
      ]
      for (const attr of attrs) {
        if (attr.value?.trim()) {
          await tx.insert(requestItemAttributes).values({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   null,
            attributeName: attr.name,
            value:         attr.value.trim(),
          })
        }
      }
    }
  })

  return requestId
}

/* ── Add quotation (upload PDF) ──────────────────────────────────────────────── */

export async function addQuotation(input: AddQuotationInput): Promise<string> {
  const now = new Date().toISOString()

  // Verify the request exists and is in a state that accepts quotations
  const request = await db.query.purchaseRequests.findFirst({
    where: and(
      eq(purchaseRequests.id, input.requestId),
      eq(purchaseRequests.requestType, "repuestos"),
    ),
    columns: { id: true, status: true, requesterId: true },
  })
  if (!request) throw new Error("Solicitud de repuestos no encontrada")
  if (!["draft", "returned"].includes(request.status)) {
    throw new Error("Solo se pueden agregar cotizaciones a solicitudes en borrador o devueltas")
  }

  // Save file to disk
  const dir = resolveRepuestosDir()
  await fs.mkdir(dir, { recursive: true })

  const ext = path.extname(input.fileName) || ".pdf"
  const storageName = `${nanoid()}${ext}`
  const absolutePath = path.join(dir, storageName)
  await fs.writeFile(absolutePath, input.fileBuffer)

  const filePath = createQuotationAttachmentPath(storageName)
  const quotationId = nanoid()

  try {
    await db.insert(repuestoQuotations).values({
      id:               quotationId,
      requestId:        input.requestId,
      supplierId:       input.supplierId ?? null,
      supplierNameFree: input.supplierNameFree ?? null,
      fileName:         input.fileName,
      filePath,
      fileSize:         input.fileSize ? String(input.fileSize) : null,
      totalAmount:      input.totalAmount,
      status:           "pending",
      notes:            input.notes ?? null,
      decidedBy:        null,
      selectedAt:       null,
      createdAt:        now,
      updatedAt:        now,
    })

    await recordAudit({
      userId:     input.uploadedBy,
      userEmail:  input.userEmail,
      action:     "create",
      entityType: "repuesto_quotation",
      entityId:   quotationId,
      newState:   {
        requestId:    input.requestId,
        totalAmount:  input.totalAmount,
        fileName:     input.fileName,
      },
    })
  } catch (err) {
    // Clean up file if DB insert fails
    await fs.unlink(absolutePath).catch(() => { /* ignore */ })
    throw err
  }

  return quotationId
}

/* ── Delete quotation ────────────────────────────────────────────────────────── */

export async function deleteQuotation(input: DeleteQuotationInput): Promise<void> {
  const quotation = await db.query.repuestoQuotations.findFirst({
    where: eq(repuestoQuotations.id, input.quotationId),
  })
  if (!quotation) throw new Error("Cotización no encontrada")
  if (quotation.status !== "pending") {
    throw new Error("Solo se pueden eliminar cotizaciones pendientes")
  }

  // Verify request is still editable
  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, quotation.requestId),
    columns: { status: true },
  })
  if (!request || !["draft", "returned"].includes(request.status)) {
    throw new Error("La solicitud ya no es editable")
  }

  await db.delete(repuestoQuotations).where(eq(repuestoQuotations.id, input.quotationId))

  // Remove file from disk
  const absolutePath = resolveQuotationAttachmentFile(quotation.filePath)
  if (absolutePath) {
    await fs.unlink(absolutePath).catch(() => { /* ignore — file may already be gone */ })
  }

  await recordAudit({
    userId:     input.userId,
    userEmail:  input.userEmail,
    action:     "delete",
    entityType: "repuesto_quotation",
    entityId:   input.quotationId,
    oldState:   { requestId: quotation.requestId, fileName: quotation.fileName },
  })
}

/* ── Submit request (draft → submitted, items draft → requested) ─────────────── */

export async function submitRepuestoRequest(input: SubmitRepuestoInput): Promise<void> {
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    const request = await tx.query.purchaseRequests.findFirst({
      where: and(
        eq(purchaseRequests.id, input.requestId),
        eq(purchaseRequests.requestType, "repuestos"),
      ),
    })
    if (!request) throw new Error("Solicitud de repuestos no encontrada")
    if (!["draft", "returned"].includes(request.status)) {
      throw new Error("Solo se pueden enviar solicitudes en borrador o devueltas")
    }

    // Check quotation count rule
    const quotations = await tx
      .select({ id: repuestoQuotations.id })
      .from(repuestoQuotations)
      .where(and(
        eq(repuestoQuotations.requestId, input.requestId),
        eq(repuestoQuotations.status, "pending"),
      ))

    if (quotations.length < 3 && !request.notes?.trim()) {
      throw new Error(
        "Se requieren al menos 3 cotizaciones. Si no es posible, agrega una justificación en las notas de la solicitud."
      )
    }

    // Transition all draft items to requested
    const items = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.requestId, input.requestId),
        eq(purchaseRequestItems.status, "draft"),
      ))

    for (const item of items) {
      await submitItemTx(tx, item.id, input.userId, { userEmail: input.userEmail })
    }

    // Transition request draft → submitted
    await tx.update(purchaseRequests).set({
      status:      "submitted",
      submittedAt: now,
      updatedAt:   now,
    }).where(eq(purchaseRequests.id, input.requestId))

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   input.requestId,
      fromStatus: request.status,
      toStatus:   "submitted",
      changedBy:  input.userId,
    }, tx)

    await recordAudit({
      userId:     input.userId,
      userEmail:  input.userEmail,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   input.requestId,
      entityCode: request.code,
      oldState:   { status: request.status },
      newState:   { status: "submitted", quotationCount: quotations.length },
    }, tx)
  })
}

/* ── Select quotation (jefa approves one → items approved) ──────────────────── */

export async function selectRepuestoQuotation(input: SelectQuotationInput): Promise<void> {
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    // Load the request + verify it's in review
    const request = await tx.query.purchaseRequests.findFirst({
      where: and(
        eq(purchaseRequests.id, input.requestId),
        eq(purchaseRequests.requestType, "repuestos"),
      ),
    })
    if (!request) throw new Error("Solicitud de repuestos no encontrada")
    if (!["submitted", "in_review"].includes(request.status)) {
      throw new Error("La solicitud no está pendiente de aprobación")
    }

    // Load the winning quotation
    const quotation = await tx.query.repuestoQuotations.findFirst({
      where: and(
        eq(repuestoQuotations.id, input.quotationId),
        eq(repuestoQuotations.requestId, input.requestId),
      ),
    })
    if (!quotation) throw new Error("Cotización no encontrada")
    if (quotation.status !== "pending") {
      throw new Error("La cotización ya fue procesada")
    }

    // Mark selected quotation as 'selected', rest as 'rejected'
    await tx.update(repuestoQuotations)
      .set({ status: "selected", decidedBy: input.userId, selectedAt: now, updatedAt: now })
      .where(eq(repuestoQuotations.id, input.quotationId))

    await tx.update(repuestoQuotations)
      .set({ status: "rejected", updatedAt: now })
      .where(and(
        eq(repuestoQuotations.requestId, input.requestId),
        eq(repuestoQuotations.status, "pending"),
      ))

    // Resolve the supplier for the winning quotation
    const winningSupplierId = quotation.supplierId ?? null

    // Approve all 'requested' items in batch
    const requestedItems = await tx
      .select({ id: purchaseRequestItems.id, requestId: purchaseRequestItems.requestId })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.requestId, input.requestId),
        eq(purchaseRequestItems.status, "requested"),
      ))

    for (const item of requestedItems) {
      // Update item: approved + set suggested supplier from winning quotation
      await tx.update(purchaseRequestItems).set({
        status:              "approved",
        suggestedSupplierId: winningSupplierId,
        supplierHint:        !winningSupplierId ? (quotation.supplierNameFree ?? null) : null,
        updatedAt:           now,
      }).where(eq(purchaseRequestItems.id, item.id))

      // Record approval decision
      await tx.insert(approvalDecisions).values({
        id:            nanoid(),
        requestItemId: item.id,
        requestId:     input.requestId,
        type:          "approve",
        decidedBy:     input.userId,
        decidedAt:     now,
        reason:        `Cotización seleccionada: ${quotation.supplierNameFree ?? quotation.supplierId ?? quotation.id}`,
        roleContext:   input.roleContext ?? null,
      })

      await recordStatusChange({
        entityType: "request_item",
        entityId:   item.id,
        fromStatus: "requested",
        toStatus:   "approved",
        changedBy:  input.userId,
      }, tx)

      await recordAudit({
        userId:     input.userId,
        userEmail:  input.userEmail,
        action:     "status_change",
        entityType: "request_item",
        entityId:   item.id,
        oldState:   { status: "requested" },
        newState:   { status: "approved", quotationId: input.quotationId },
      }, tx)
    }

    // Roll up request status → 'approved'
    await tx.update(purchaseRequests).set({
      status:    "approved",
      updatedAt: now,
    }).where(eq(purchaseRequests.id, input.requestId))

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   input.requestId,
      fromStatus: request.status,
      toStatus:   "approved",
      changedBy:  input.userId,
    }, tx)

    await recordAudit({
      userId:     input.userId,
      userEmail:  input.userEmail,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   input.requestId,
      entityCode: request.code,
      oldState:   { status: request.status },
      newState:   { status: "approved", selectedQuotationId: input.quotationId },
    }, tx)
  })
}

/* ── Cancel request ──────────────────────────────────────────────────────────── */

export async function cancelRepuestoRequest(
  requestId: string,
  userId: string,
  reason: string,
  opts?: { userEmail?: string },
): Promise<void> {
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    const request = await tx.query.purchaseRequests.findFirst({
      where: and(
        eq(purchaseRequests.id, requestId),
        eq(purchaseRequests.requestType, "repuestos"),
      ),
    })
    if (!request) throw new Error("Solicitud no encontrada")
    if (!["draft", "submitted", "in_review", "returned"].includes(request.status)) {
      throw new Error(`No se puede cancelar una solicitud en estado '${request.status}'`)
    }

    await tx.update(purchaseRequests).set({
      status:    "cancelled",
      closedAt:  now,
      updatedAt: now,
    }).where(eq(purchaseRequests.id, requestId))

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: request.status,
      toStatus:   "cancelled",
      changedBy:  userId,
      reason,
    }, tx)

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   requestId,
      entityCode: request.code,
      oldState:   { status: request.status },
      newState:   { status: "cancelled" },
      reason,
    }, tx)
  })
}

/* ── Queries ─────────────────────────────────────────────────────────────────── */

/** Load quotations for a request (for display in the detail page) */
export async function getQuotationsForRequest(requestId: string) {
  return db.query.repuestoQuotations.findMany({
    where: eq(repuestoQuotations.requestId, requestId),
    with: {
      supplier:      { columns: { id: true, name: true } },
      decidedByUser: { columns: { id: true, name: true } },
    },
    orderBy: (q, { asc }) => asc(q.createdAt),
  })
}
