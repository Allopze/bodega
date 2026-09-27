/**
 * lib/services/pdtp/evidence-uploads.ts
 *
 * PREV-M02-B (0334): registro de dueño de cada archivo subido a
 * `storage/pdtp-evidence/`. Lo escribe `POST /api/prevencion/pdtp/evidence`
 * al guardar el archivo, y lo consultan:
 *
 * - `assertPdtpEvidenceLinkable`: una ruta que ninguna fila referencia todavía
 *   sólo la vincula quien la subió y en la faena para la que la subió;
 * - el GC (`evidence-gc.ts`): borra la fila del huérfano que borra;
 * - el escaneo de integridad: usa el sha256 del registro cuando la referencia
 *   no guardó uno.
 */
import { eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpActivities, pdtpEvidenceUploads } from "@/db/schema"

export type PdtpEvidenceUpload = typeof pdtpEvidenceUploads.$inferSelect

type Client = Tx | typeof db

export async function recordPdtpEvidenceUpload(input: {
  path: string
  uploadedByUserId: string
  worksiteId: string
  activityId?: string | null
  sha256: string
  sizeBytes: number
  mimeType: string
}, client: Client = db): Promise<PdtpEvidenceUpload> {
  // La actividad es contexto, no autorización: quien sólo tiene `execute` no
  // está obligado a mandarla y el endpoint no la valida. Un id que no existe
  // se guarda como null en vez de tumbar la subida con la FK.
  let activityId: string | null = null
  if (input.activityId) {
    const [activity] = await client.select({ id: pdtpActivities.id })
      .from(pdtpActivities).where(eq(pdtpActivities.id, input.activityId)).limit(1)
    activityId = activity?.id ?? null
  }
  const [row] = await client.insert(pdtpEvidenceUploads).values({
    path: input.path,
    uploadedByUserId: input.uploadedByUserId,
    worksiteId: input.worksiteId,
    activityId,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType,
    createdAt: new Date().toISOString(),
  }).returning()
  if (!row) throw new Error("No se pudo registrar la subida.")
  return row
}

export async function findPdtpEvidenceUpload(client: Client, path: string): Promise<PdtpEvidenceUpload | null> {
  const [row] = await client.select().from(pdtpEvidenceUploads).where(eq(pdtpEvidenceUploads.path, path)).limit(1)
  return row ?? null
}

/** sha256 registrado al subir, por ruta. */
export async function loadPdtpEvidenceUploadSha256(paths: readonly string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const rows = await db.select({ path: pdtpEvidenceUploads.path, sha256: pdtpEvidenceUploads.sha256 })
    .from(pdtpEvidenceUploads).where(inArray(pdtpEvidenceUploads.path, [...paths]))
  return new Map(rows.map((row) => [row.path, row.sha256]))
}

/** Borra las filas de registro de archivos que el GC ya borró del disco. */
export async function deletePdtpEvidenceUploads(paths: readonly string[]): Promise<number> {
  if (paths.length === 0) return 0
  const rows = await db.delete(pdtpEvidenceUploads)
    .where(inArray(pdtpEvidenceUploads.path, [...paths]))
    .returning({ path: pdtpEvidenceUploads.path })
  return rows.length
}
