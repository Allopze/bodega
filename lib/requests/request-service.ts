/**
 * Shared request service — factory que elimina la duplicación entre repuestos y servicios.
 *
 * Uso: cada módulo crea una instancia con su config y re-exporta las funciones.
 *
 *   const svc = createRequestService(repuestoConfig)
 *   export const persistDraft = svc.persistDraft
 *   export const addQuotation = svc.addQuotation
 *   // ...
 */

import { eq, and } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  requestItemAttributes,
  approvalDecisions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { submitItemTx } from "@/lib/services/item-state"
import path from "node:path"
import { mkdirp, writeBuffer, removeFile } from "@/lib/storage/helpers"
import type {
  RequestModuleConfig,
  RequestItemInput,
  RequestServiceInput,
  AddQuotationInput,
  DeleteQuotationInput,
  SubmitRequestInput,
  SelectQuotationInput,
} from "./request-config"
import type { Session } from "next-auth"
import { assertCanDeleteQuotation } from "./quotation-access"

// Re-export shared types for backward compatibility
export type {
  RequestItemInput,
  RequestServiceInput as RequestInput,
  AddQuotationInput,
  DeleteQuotationInput,
  SubmitRequestInput,
  SelectQuotationInput,
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRequestService(config: RequestModuleConfig) {
  const {
    requestType,
    codePrefix,
    quotationsTable,
    quotationEntityType,
    attributeNames,
    storage,
  } = config

  const qt = quotationsTable

  /* ── Persist draft (create or update) ───────────────────────────────────── */

  async function persistDraft(
    session: Session,
    data: RequestServiceInput,
  ): Promise<string> {
    const isEdit = !!data.id
    const requestId = data.id ?? nanoid()
    const now = new Date().toISOString()
    const year = new Date().getFullYear()

    await db.transaction(async (tx) => {
      if (isEdit) {
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

        await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.requestId, requestId))
      } else {
        const code = await nextCodeTx(tx, codePrefix, year)
        await tx.insert(purchaseRequests).values({
          id:          requestId,
          code,
          worksiteId:  data.worksiteId,
          requesterId: session.user.id,
          requestType,
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
          newState:   { status: "draft", requestType },
        }, tx)
      }

      // Insert items + attributes
      for (const [i, item] of data.items.entries()) {
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
        for (const [fieldName, displayName] of Object.entries(attributeNames)) {
          const value = item[fieldName as keyof RequestItemInput]
          if (typeof value === "string" && value.trim()) {
            await tx.insert(requestItemAttributes).values({
              id:            nanoid(),
              requestItemId: itemId,
              attributeId:   null,
              attributeName: displayName,
              value:         value.trim(),
            })
          }
        }
      }
    })

    return requestId
  }

  /* ── Add quotation (upload PDF) ──────────────────────────────────────────── */

  async function addQuotation(input: AddQuotationInput): Promise<string> {
    const now = new Date().toISOString()

    const request = await db.query.purchaseRequests.findFirst({
      where: and(
        eq(purchaseRequests.id, input.requestId),
        eq(purchaseRequests.requestType, requestType),
      ),
      columns: { id: true, status: true, requesterId: true },
    })
    if (!request) throw new Error(`Solicitud de ${requestType === "repuestos" ? "repuestos" : "servicios"} no encontrada`)
    if (!["draft", "returned"].includes(request.status)) {
      throw new Error("Solo se pueden agregar cotizaciones a solicitudes en borrador o devueltas")
    }

    const dir = storage.dir()
    await mkdirp(dir)

    const ext = path.extname(input.fileName) || ".pdf"
    const storageName = `${nanoid()}${ext}`
    const absolutePath = path.join(/*turbopackIgnore: true*/ dir, storageName)
    await writeBuffer(absolutePath, input.fileBuffer)

    const filePath = storage.createPath(storageName)
    const quotationId = nanoid()

    try {
      await db.insert(qt).values({
        id:               quotationId,
        requestId:        input.requestId,
        supplierId:       input.supplierId ?? null,
        supplierNameFree: input.supplierNameFree ?? null,
        fileName:         input.fileName,
        filePath,
        fileSize:         input.fileSize ? String(input.fileSize) : null,
        uploadedBy:       input.uploadedBy,
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
        entityType: quotationEntityType,
        entityId:   quotationId,
        newState:   {
          requestId:   input.requestId,
          totalAmount: input.totalAmount,
          fileName:    input.fileName,
        },
      })
    } catch (err) {
      await removeFile(absolutePath).catch(() => { /* ignore */ })
      throw err
    }

    return quotationId
  }

  /* ── Delete quotation ────────────────────────────────────────────────────── */

  async function deleteQuotation(input: DeleteQuotationInput): Promise<void> {
    const [quotation] = await db.select().from(qt).where(eq(qt.id, input.quotationId)).limit(1)
    if (!quotation) throw new Error("Cotización no encontrada")
    if (quotation.status !== "pending") {
      throw new Error("Solo se pueden eliminar cotizaciones pendientes")
    }

    const request = await db.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, quotation.requestId),
      columns: { id: true, status: true, requesterId: true, worksiteId: true },
    })
    if (!request || !["draft", "returned"].includes(request.status)) {
      throw new Error("La solicitud ya no es editable")
    }
    assertCanDeleteQuotation({
      session: input.session,
      request,
      quotation,
      expectedRequestId: input.expectedRequestId,
      elevatedPermission: input.elevatedPermission,
    })

    await db.delete(qt).where(eq(qt.id, input.quotationId))

    const absolutePath = storage.resolveFile(quotation.filePath)
    if (absolutePath) {
      await removeFile(absolutePath).catch(() => { /* ignore */ })
    }

    await recordAudit({
      userId:     input.session.user.id,
      userEmail:  input.userEmail,
      action:     "delete",
      entityType: quotationEntityType,
      entityId:   input.quotationId,
      oldState:   { requestId: quotation.requestId, fileName: quotation.fileName },
    })
  }

  /* ── Submit request ──────────────────────────────────────────────────────── */

  async function submitRequest(input: SubmitRequestInput): Promise<void> {
    const now = new Date().toISOString()

    await db.transaction(async (tx) => {
      const request = await tx.query.purchaseRequests.findFirst({
        where: and(
          eq(purchaseRequests.id, input.requestId),
          eq(purchaseRequests.requestType, requestType),
        ),
      })
      if (!request) throw new Error(`Solicitud de ${requestType === "repuestos" ? "repuestos" : "servicios"} no encontrada`)
      if (!["draft", "returned"].includes(request.status)) {
        throw new Error("Solo se pueden enviar solicitudes en borrador o devueltas")
      }

      // Check quotation count rule
      const quotations = await tx
        .select({ id: qt.id })
        .from(qt)
        .where(and(
          eq(qt.requestId, input.requestId),
          eq(qt.status, "pending"),
        ))

      if (quotations.length < 3 && !request.notes?.trim()) {
        throw new Error(
          "Se requieren al menos 3 cotizaciones. Si no es posible, agrega una justificación en las notas de la solicitud.",
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

  /* ── Select quotation ────────────────────────────────────────────────────── */

  async function selectQuotation(input: SelectQuotationInput): Promise<void> {
    const now = new Date().toISOString()
    const requestTypeLabel = requestType === "repuestos" ? "repuestos" : "servicios"

    await db.transaction(async (tx) => {
      const request = await tx.query.purchaseRequests.findFirst({
        where: and(
          eq(purchaseRequests.id, input.requestId),
          eq(purchaseRequests.requestType, requestType),
        ),
      })
      if (!request) throw new Error(`Solicitud de ${requestTypeLabel} no encontrada`)
      if (!["submitted", "in_review"].includes(request.status)) {
        throw new Error("La solicitud no está pendiente de aprobación")
      }

      // Security audit: scope-defensive check — reject if caller's
      // worksite scope doesn't cover this request's worksite.
      const scope = input.worksiteIds ?? "all"
      if (scope !== "all" && !scope.includes(request.worksiteId)) {
        throw new Error("No tienes acceso a esta faena")
      }

      const [quotation] = await tx
        .select()
        .from(qt)
        .where(and(
          eq(qt.id, input.quotationId),
          eq(qt.requestId, input.requestId),
        ))
      if (!quotation) throw new Error("Cotización no encontrada")
      if (quotation.status !== "pending") {
        throw new Error("La cotización ya fue procesada")
      }

      // Mark selected quotation as 'selected', rest as 'rejected'
      await tx.update(qt)
        .set({ status: "selected", decidedBy: input.userId, selectedAt: now, updatedAt: now })
        .where(eq(qt.id, input.quotationId))

      await tx.update(qt)
        .set({ status: "rejected", updatedAt: now })
        .where(and(
          eq(qt.requestId, input.requestId),
          eq(qt.status, "pending"),
        ))

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
        // Security audit SM-02: only transition items still in 'requested'
        // status. Another transaction may have already modified the item.
        const [updated] = await tx.update(purchaseRequestItems).set({
          status:              "approved",
          suggestedSupplierId: winningSupplierId,
          supplierHint:        !winningSupplierId ? (quotation.supplierNameFree ?? null) : null,
          updatedAt:           now,
        }).where(and(
          eq(purchaseRequestItems.id, item.id),
          eq(purchaseRequestItems.status, "requested"),
        )).returning({ id: purchaseRequestItems.id })

        if (!updated) continue // item was already modified — skip silently

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

  /* ── Cancel request ──────────────────────────────────────────────────────── */

  async function cancelRequest(
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
          eq(purchaseRequests.requestType, requestType),
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

  /* ── Queries ─────────────────────────────────────────────────────────────── */

  async function getQuotationsForRequest(requestId: string) {
    return db
      .select()
      .from(qt)
      .where(eq(qt.requestId, requestId))
      .orderBy(qt.createdAt)
  }

  return {
    persistDraft,
    addQuotation,
    deleteQuotation,
    submitRequest,
    selectQuotation,
    cancelRequest,
    getQuotationsForRequest,
  }
}
