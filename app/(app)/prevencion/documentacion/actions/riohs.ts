"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sstDocuments, sstDocumentTypes } from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { RIOHS_DOCUMENT_TYPE_CODE, RIOHS_SECTION_IDS, type RiohsMetadata } from "@/lib/prevention/riohs"
import { updateDocumentMetadata } from "@/lib/services/prevention-documents-library"
import type { ActionState } from "@/lib/validation/masters"
import { clientCtx, fail, REVALIDATE } from "./shared"

/**
 * Declara qué capítulos del contenido mínimo del DS 44 art. 58 contiene el
 * Reglamento Interno.
 *
 * Sin esto el gate de `publishDocumentVersion` sería una puerta sin llave: el
 * RIOHS no se podría publicar nunca porque nada permitiría declarar sus
 * capítulos.
 *
 * Fusiona en vez de reemplazar: `extraMetadata` es un jsonb compartido y
 * sobrescribirlo entero borraría cualquier otra clave del documento.
 */
export async function setRiohsSectionsAction(input: {
  documentId: string
  sections: string[]
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return guard.error
  const session = guard.session

  if (!input?.documentId) return { ok: false, message: "Documento requerido." }
  const sections = (input.sections ?? []).filter((id) => RIOHS_SECTION_IDS.includes(id))

  try {
    const [doc] = await db
      .select({ id: sstDocuments.id, typeId: sstDocuments.typeId, extraMetadata: sstDocuments.extraMetadata })
      .from(sstDocuments)
      .where(eq(sstDocuments.id, input.documentId))
    if (!doc) return { ok: false, message: "Documento no encontrado." }

    // El checklist sólo tiene sentido en un RIOHS: en cualquier otro tipo
    // ensuciaría `extraMetadata` con una clave que nadie lee.
    if (!doc.typeId) return { ok: false, message: "El documento no tiene tipo documental asignado." }
    const [type] = await db
      .select({ code: sstDocumentTypes.code })
      .from(sstDocumentTypes)
      .where(eq(sstDocumentTypes.id, doc.typeId))
    if (type?.code !== RIOHS_DOCUMENT_TYPE_CODE) {
      return { ok: false, message: "El contenido mínimo del art. 58 sólo aplica al Reglamento Interno." }
    }

    const current = (doc.extraMetadata ?? {}) as RiohsMetadata & Record<string, unknown>
    await updateDocumentMetadata({
      input: { id: input.documentId, extraMetadata: { ...current, riohsSections: sections } },
      ctx: await clientCtx(session),
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })

    revalidatePath(`${REVALIDATE}/${input.documentId}`)
    return { ok: true, message: "Contenido del reglamento actualizado." }
  } catch (e) {
    return fail(e)
  }
}
