"use server"

/**
 * Subida tipada: quien carga declara primero **qué** documento es (tipo y
 * faena) y después adjunta el archivo. El tipo decide el resto: la categoría,
 * si la versión queda vigente al cargarla (registro externo) o pasa por
 * revisión y aprobación, y qué efecto tiene sobre el programa preventivo
 * (carpeta de requisitos legales N°19, entrega del RIOHS N°18).
 */
import { revalidatePath } from "next/cache"
import { and, desc, eq, isNull, ne } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { sstDocuments } from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { parseZ } from "@/lib/actions/parse-z"
import {
  archiveDocument,
  createDocument,
  updateDocumentMetadata,
  uploadDocumentVersion,
} from "@/lib/services/prevention-documents-library"
import { previewDocumentUploadEffects, type DocumentUploadEffects } from "@/lib/services/pdtp-adapters/document-pdtp-effects"
import { sstDocumentCreateSchema } from "@/lib/validation/prevention"
import type { ActionState } from "@/lib/validation/masters"
import { clientCtx, fail, REVALIDATE } from "./shared"

const optionalId = z.string().trim().max(120).optional().or(z.literal(""))

const typedUploadSchema = z.object({
  typeId: z.string().trim().min(1, "Selecciona el tipo de documento"),
  worksiteId: optionalId,
  folderId: optionalId,
  /** Vacío: documento nuevo. Con valor: nueva versión de ese documento. */
  documentId: optionalId,
  title: z.string().trim().max(200).optional().or(z.literal("")),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional().or(z.literal("")),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional().or(z.literal("")),
  changelog: z.string().max(2000).optional().or(z.literal("")),
})

function versionMessage(status: string, version: number, isNew: boolean) {
  if (status === "vigente") {
    return isNew
      ? "Documento cargado y vigente: su tipo no requiere aprobación."
      : `Versión ${version} cargada y vigente: su tipo no requiere aprobación.`
  }
  return isNew
    ? "Documento creado. La primera versión quedó como borrador pendiente de revisión."
    : `Versión ${version} subida como borrador pendiente de revisión.`
}

export async function uploadTypedSstDocumentAction(
  formData: FormData,
): Promise<ActionState & { data?: { id: string; versionStatus: string } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Adjunta el archivo del documento." }

  const parsed = parseZ(typedUploadSchema, {
    typeId: String(formData.get("typeId") ?? ""),
    worksiteId: String(formData.get("worksiteId") ?? ""),
    folderId: String(formData.get("folderId") ?? ""),
    documentId: String(formData.get("documentId") ?? ""),
    title: String(formData.get("title") ?? ""),
    effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
    effectiveTo: String(formData.get("effectiveTo") ?? ""),
    changelog: String(formData.get("changelog") ?? ""),
  })
  if (!parsed.ok) return parsed
  const data = parsed.data
  if (data.effectiveFrom && data.effectiveTo && data.effectiveTo < data.effectiveFrom) {
    return { ok: false, message: "La vigencia no puede terminar antes de comenzar." }
  }
  const scope = resolveWorksiteScope(session)
  const ctx = await clientCtx(session)

  // Nueva versión de un documento existente: debe ser del tipo declarado, así
  // lo que se anunció en el diálogo es lo que ocurre.
  if (data.documentId) {
    const [existing] = await db.select({ id: sstDocuments.id, typeId: sstDocuments.typeId })
      .from(sstDocuments).where(eq(sstDocuments.id, data.documentId)).limit(1)
    if (!existing) return { ok: false, message: "El documento seleccionado ya no existe." }
    if (existing.typeId !== data.typeId) return { ok: false, message: "El documento seleccionado es de otro tipo." }
    try {
      const version = await uploadDocumentVersion({
        input: {
          documentId: existing.id,
          file,
          effectiveFrom: data.effectiveFrom || undefined,
          effectiveTo: data.effectiveTo || undefined,
          changelog: data.changelog || undefined,
        },
        ctx,
        scope,
        permissions: session.user.permissions,
      })
      revalidatePath(REVALIDATE)
      revalidatePath(`${REVALIDATE}/${existing.id}`)
      return { ok: true, message: versionMessage(version.status, version.version, false), data: { id: existing.id, versionStatus: version.status } }
    } catch (error) {
      return fail<{ id: string; versionStatus: string }>(error)
    }
  }

  const title = data.title?.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 200)
  const createInput = parseZ(sstDocumentCreateSchema, {
    // La categoría la fija el tipo en `createDocument`; esto sólo satisface el
    // esquema mientras se resuelve.
    categorySlug: "gestion_preventiva",
    typeId: data.typeId,
    folderId: data.folderId ?? "",
    title,
    worksiteId: data.worksiteId ?? "",
    dataClass: "operational",
    effectiveFrom: data.effectiveFrom ?? "",
    tags: [],
    extraMetadata: {},
  })
  if (!createInput.ok) return createInput

  let documentId: string | null = null
  try {
    const row = await createDocument({ data: createInput.data, ctx, scope, permissions: session.user.permissions })
    documentId = row.id
    const version = await uploadDocumentVersion({
      input: {
        documentId: row.id,
        file,
        effectiveFrom: data.effectiveFrom || undefined,
        effectiveTo: data.effectiveTo || undefined,
        changelog: data.changelog || "Primera versión cargada desde biblioteca",
      },
      ctx,
      scope,
      permissions: session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${row.id}`)
    return { ok: true, message: versionMessage(version.status, version.version, true), data: { id: row.id, versionStatus: version.status } }
  } catch (error) {
    if (documentId) {
      try {
        await archiveDocument({
          input: { documentId, comment: "Archivado automáticamente: falló la carga de la primera versión." },
          ctx,
          scope,
        })
      } catch (archiveError) {
        logger.error("[prevencion/documentacion] falló la compensación de la carga tipada", archiveError)
      }
    }
    return fail<{ id: string; versionStatus: string }>(error)
  }
}

/** Efecto de la carga sobre el programa preventivo, para anunciarlo antes de subir. */
export async function previewSstDocumentUploadEffectsAction(input: {
  typeId: string
  worksiteId: string | null
}): Promise<ActionState & { data?: { effects: DocumentUploadEffects | null } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  if (!input.typeId) return { ok: true, data: { effects: null } }
  try {
    const effects = await previewDocumentUploadEffects({
      typeId: input.typeId,
      worksiteId: input.worksiteId || null,
      scope: resolveWorksiteScope(guard.session),
    })
    return { ok: true, data: { effects } }
  } catch (error) {
    return fail<{ effects: DocumentUploadEffects | null }>(error)
  }
}

/**
 * Documentos existentes de un tipo en la faena (o corporativos), para ofrecer
 * "Nueva versión de…" en vez de duplicar el documento.
 */
export async function listSstDocumentsOfTypeAction(input: {
  typeId: string
  worksiteId: string | null
}): Promise<ActionState & { data?: { documents: Array<{ id: string; title: string; status: string }> } }> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  if (!input.typeId) return { ok: true, data: { documents: [] } }
  const scope = resolveWorksiteScope(guard.session)
  if (input.worksiteId && scope.mode === "some" && !scope.ids.includes(input.worksiteId)) return { ok: true, data: { documents: [] } }
  try {
    const rows = await db.select({ id: sstDocuments.id, title: sstDocuments.title, status: sstDocuments.status })
      .from(sstDocuments)
      .where(and(
        eq(sstDocuments.typeId, input.typeId),
        input.worksiteId ? eq(sstDocuments.worksiteId, input.worksiteId) : isNull(sstDocuments.worksiteId),
        ne(sstDocuments.status, "archivado"),
      ))
      .orderBy(desc(sstDocuments.updatedAt))
      .limit(20)
    return { ok: true, data: { documents: rows } }
  } catch (error) {
    return fail<{ documents: Array<{ id: string; title: string; status: string }> }>(error)
  }
}

/** Clasificar un documento existente: tipo y faena. */
export async function classifySstDocumentAction(input: {
  documentId: string
  typeId: string
  worksiteId: string | null
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  if (!input.documentId || !input.typeId) return { ok: false, message: "Selecciona el tipo de documento." }
  try {
    await updateDocumentMetadata({
      input: { id: input.documentId, typeId: input.typeId, worksiteId: input.worksiteId ?? "" },
      ctx: await clientCtx(guard.session),
      scope: resolveWorksiteScope(guard.session),
      permissions: guard.session.user.permissions,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: "Documento clasificado." }
  } catch (error) {
    return fail(error)
  }
}
