import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { attachments, itAssets, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"

/**
 * Entidades TI que hoy admiten carga de adjuntos desde la aplicación. Es una
 * lista blanca deliberadamente más chica que el conjunto de tipos que
 * `GET /api/ti/attachments/[id]` sabe *servir* (`it_asset_assignment`,
 * `it_maintenance`, `it_ticket`, `it_asset_retirement`, `it_license_assignment`,
 * `it_license`): el modelo de permisos de escritura no es uniforme entre
 * entidades (un adjunto de ticket lo sube típicamente el solicitante, que solo
 * tiene `ti:create_ticket`, no `ti:manage_assets`; `it_license` es catálogo
 * global). Ampliar esta lista es agregar una entrada acá y un guard de permiso
 * propio en la ruta — no exige rediseñar nada.
 */
export const TI_UPLOADABLE_ENTITY_TYPES = ["it_asset"] as const
export type TiUploadableEntityType = (typeof TI_UPLOADABLE_ENTITY_TYPES)[number]

export function isTiUploadableEntityType(value: string): value is TiUploadableEntityType {
  return (TI_UPLOADABLE_ENTITY_TYPES as readonly string[]).includes(value)
}

export interface CreateTiAttachmentInput {
  entityType: TiUploadableEntityType
  entityId: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}

/**
 * Sube un documento a un activo TI. No hay borrado: `attachments` no tiene
 * `deletedAt` y el módulo es append-only, igual que el historial del activo —
 * quien suba el archivo equivocado no puede quitarlo, solo subir el correcto.
 *
 * Deliberadamente NO reusa `resolveAttachmentWorksite` de la ruta GET: esa
 * función responde "¿de qué faena es este adjunto ya existente?" para
 * autorizar *lectura* de trazabilidad histórica (su rama `it_asset` no filtra
 * `deletedAt` a propósito), mientras que esto autoriza *escritura* sobre un
 * activo que debe seguir vivo. Compartirla forzaría a este flujo a heredar esa
 * ceguera o a hacer la misma lectura dos veces.
 */
export async function createTiAttachment(
  input: CreateTiAttachmentInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    if (input.entityType !== "it_asset") {
      throw new Error("Este tipo de entidad no admite adjuntos")
    }

    // `FOR UPDATE` como el resto de los escritores de TI: sin el lock, un
    // `softDeleteAsset` concurrente se cuela entre este SELECT y el INSERT y
    // deja el adjunto colgando de un activo ya eliminado.
    const [asset] = await tx.select({ id: itAssets.id, code: itAssets.code, worksiteId: itAssets.worksiteId })
      .from(itAssets)
      .where(and(eq(itAssets.id, input.entityId), isNull(itAssets.deletedAt)))
      .for("update")
    if (!asset) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)

    await tx.insert(attachments).values({
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: input.fileName,
      filePath: input.filePath,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      uploadedBy: actor.userId,
    })

    await appendAssetHistory({
      assetId: asset.id,
      action: "document",
      detail: `Documento adjunto: ${input.fileName}.`,
      changes: { attachmentId: id, mimeType: input.mimeType, fileSize: input.fileSize },
      actorUserId: actor.userId,
    }, tx)

    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_attachment",
      entityId: id,
      entityCode: asset.code,
      newState: {
        entityType: input.entityType, entityId: input.entityId,
        fileName: input.fileName, fileSize: input.fileSize, mimeType: input.mimeType,
      },
    }, tx)
  })
  return id
}

export interface TiAttachmentRow {
  id: string
  fileName: string
  mimeType: string | null
  fileSize: number | null
  uploadedAt: string
  uploadedByName: string | null
}

/** Lista de adjuntos de una entidad TI, más reciente al final (orden cronológico de la línea de tiempo). */
export async function listTiAttachments(entityType: string, entityId: string): Promise<TiAttachmentRow[]> {
  return db
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      uploadedAt: attachments.uploadedAt,
      uploadedByName: users.name,
    })
    .from(attachments)
    .leftJoin(users, eq(attachments.uploadedBy, users.id))
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)))
    .orderBy(asc(attachments.uploadedAt))
}
