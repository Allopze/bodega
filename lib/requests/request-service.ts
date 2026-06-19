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

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle dynamic table types are too complex for proper typing here */

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
import type { RequestModuleConfig } from "./request-config"
import type { Session } from "next-auth"
import { assertCanDeleteQuotation } from "./quotation-access"
import type { Permission } from "@/modules/permissions"

// ── Shared types ──────────────────────────────────────────────────────────────

export interface RequestItemInput {
  id?:            string
  description:    string
  quantity:       number
  unitOfMeasure:  string
  sortOrder?:     number
  notes?:         string | null
  equipmentName?: string | null
  patent?:        string | null
  brand?:         string | null
  model?:         string | null
  /** Repuestos: number de parte. Servicios: no se usa. */
  partNumber?:    string | null
  /** Servicios: ubicación. Repuestos: no se usa. */
  location?:      string | null
}

export interface RequestInput {
  id?:            string
  worksiteId:     string
  urgency:        "normal" | "high" | "critical"
  requiredDate:   string
  justification?: string | null
  items:          RequestItemInput[]
}

export interface AddQuotationInput {
  requestId:        string
  totalAmount:      number
  supplierId?:      string | null
  supplierNameFree?: string | null
  notes?:           string | null
  fileBuffer:       Buffer
  fileName:         string
  mimeType?:        string | null
  fileSize?:        number | null
  uploadedBy:       string
  userEmail?:       string
}

export interface DeleteQuotationInput {
  quotationId:       string
  expectedRequestId: string
  session:           Session
  elevatedPermission: Permission
  userEmail?:        string
}

export interface SubmitRequestInput {
  requestId: string
  userId:    string
  userEmail?: string
}

export interface SelectQuotationInput {
  requestId:   string
  quotationId: string
  userId:      string
  userEmail?:  string
  roleContext?: string
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRequestService(config: RequestModuleConfig) {
  const {
    requestType,
    codePrefix,
    quotationsTable,
    quotationsQueryName,
    quotationEntityType,
    attributeNames,
    storage,
  } = config

  /* ── Persist draft (create or update) ───────────────────────────────────── */

  async function persistDraft(
    session: Session,
    data: RequestInput,
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
          const value = (item as unknown as Record<string, unknown>)[fieldName]
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
    const absolutePath = path.join(dir, storageName)
    await writeBuffer(absolutePath, input.fileBuffer)

    const filePath = storage.createPath(storageName)
    const quotationId = nanoid()

    try {
      await db.insert(quotationsTable).values({
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
      } as any)

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
    const quotation = await (db.query as any)[quotationsQueryName].findFirst({
      where: eq(quotationsTable.id, input.quotationId),
    })
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

    await db.delete(quotationsTable).where(eq(quotationsTable.id, input.quotationId) as any)

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
        .select({ id: quotationsTable.id })
        .from(quotationsTable)
        .where(and(
          eq(quotationsTable.requestId as any, input.requestId),
          eq(quotationsTable.status as any, "pending"),
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

      const quotation = await (tx.query as any)[quotationsQueryName].findFirst({
        where: and(
          eq(quotationsTable.id, input.quotationId) as any,
          eq(quotationsTable.requestId as any, input.requestId),
        ),
      })
      if (!quotation) throw new Error("Cotización no encontrada")
      if (quotation.status !== "pending") {
        throw new Error("La cotización ya fue procesada")
      }

      // Mark selected quotation as 'selected', rest as 'rejected'
      await tx.update(quotationsTable)
        .set({ status: "selected", decidedBy: input.userId, selectedAt: now, updatedAt: now } as any)
        .where(eq(quotationsTable.id, input.quotationId) as any)

      await tx.update(quotationsTable)
        .set({ status: "rejected", updatedAt: now } as any)
        .where(and(
          eq(quotationsTable.requestId as any, input.requestId),
          eq(quotationsTable.status as any, "pending"),
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
        await tx.update(purchaseRequestItems).set({
          status:              "approved",
          suggestedSupplierId: winningSupplierId,
          supplierHint:        !winningSupplierId ? (quotation.supplierNameFree ?? null) : null,
          updatedAt:           now,
        }).where(eq(purchaseRequestItems.id, item.id))

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
    return (db.query as any)[quotationsQueryName].findMany({
      where: eq(quotationsTable.requestId as any, requestId),
      with: {
        supplier:      { columns: { id: true, name: true } },
        decidedByUser: { columns: { id: true, name: true } },
      },
      orderBy: (q: any, { asc }: any) => asc(q.createdAt),
    })
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
