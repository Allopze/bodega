/**
 * Encolar un documento generado en el momento del hecho.
 *
 * Se llama DENTRO de la transacción del servicio que produce el hecho (la
 * entrega, el cierre del mes…): si el hecho se confirma, su copia pendiente
 * también; si se revierte, no queda nada que archivar. Va en un savepoint y
 * atrapa todo: un fallo al encolar nunca puede deshacer el hecho de negocio.
 */
import { eq } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import { generatedDocumentArchives, worksites } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { codeYear } from "@/lib/utils"
import { GENERATED_DOCUMENT_KIND_SPECS, generatedDocumentDedupeKey, type GeneratedDocumentKind } from "./kinds"
import { readGeneratedArchiveSettings } from "./settings"

export interface GeneratedDocumentRef {
  kind: GeneratedDocumentKind
  entityId: string
  milestone: string
  /** Versión del documento para ese hito; 1 si no se versiona. */
  revision?: number
  worksiteId: string | null
  /** Momento del hecho (ISO). Por defecto, ahora. */
  occurredAt?: string
  /**
   * Año del documento cuando no es el del hecho: el cierre de diciembre que se
   * hace en enero es un documento de diciembre.
   */
  documentYear?: number
  actorUserId: string | null
}

export type EnqueueResult =
  | { status: "queued"; id: string }
  | { status: "duplicate" | "disabled" | "failed" }

type TxLike = DB | Tx

export async function enqueueGeneratedDocumentTx(client: TxLike, ref: GeneratedDocumentRef): Promise<EnqueueResult> {
  try {
    return await client.transaction(async (sp) => {
      const settings = await readGeneratedArchiveSettings(sp)
      if (!settings.enabled) return { status: "disabled" } as const

      const spec = GENERATED_DOCUMENT_KIND_SPECS[ref.kind]
      const revision = ref.revision ?? 1
      const occurredAt = ref.occurredAt ?? new Date().toISOString()
      const worksiteLabel = ref.worksiteId
        ? (await sp.select({ name: worksites.name }).from(worksites).where(eq(worksites.id, ref.worksiteId)).limit(1))[0]?.name ?? null
        : null

      const id = `gdoc-${nanoid(16)}`
      const inserted = await sp.insert(generatedDocumentArchives).values({
        id,
        kind: ref.kind,
        entityId: ref.entityId,
        milestone: ref.milestone,
        revision,
        dedupeKey: generatedDocumentDedupeKey({ kind: ref.kind, entityId: ref.entityId, milestone: ref.milestone, revision }),
        worksiteId: ref.worksiteId,
        worksiteLabel,
        documentYear: ref.documentYear ?? codeYear(occurredAt),
        occurredAt,
        actorUserId: ref.actorUserId,
        renderMode: spec.renderMode,
        status: "pending",
      }).onConflictDoNothing().returning({ id: generatedDocumentArchives.id })

      return inserted.length > 0 ? { status: "queued", id } as const : { status: "duplicate" } as const
    })
  } catch (error) {
    logger.error("[generated-documents] no se pudo encolar el documento", {
      kind: ref.kind,
      entityId: ref.entityId,
      milestone: ref.milestone,
      message: error instanceof Error ? error.message : String(error),
    })
    return { status: "failed" }
  }
}
