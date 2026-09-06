/**
 * Mapeo y materialización de carpetas SST en el storage (filesystem/Cloudreve).
 *
 * Vive fuera de folders-crud.ts y folders-queries.ts para evitar ciclos de
 * imports: ambos importan de acá. Concentra el walk de la jerarquía de
 * carpetas (getFolderRemoteSegments) y el espejo físico (ensureSstFolderPhysical).
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders } from "@/db/schema"
import { remoteSegment } from "@/lib/services/cloudreve/sst-path"
import { createSstFolder } from "@/lib/storage/sst-folders"

/**
 * Cadena de segmentos físicos (raíz→hoja) de una carpeta, con los nombres
 * saneados para el drive. Sin checks de scope: el caller ya autorizó el acceso
 * al documento/folder y esto solo traduce la jerarquía a segmentos de ruta.
 */
export async function getFolderRemoteSegments(folderId: string | null | undefined): Promise<string[]> {
  if (!folderId) return []
  const segments: string[] = []
  let currentId: string | null = folderId
  const visited = new Set<string>()
  while (currentId) {
    if (visited.has(currentId)) throw new Error("Jerarquía de carpetas inválida.")
    visited.add(currentId)
    const [folder] = await db.select().from(sstDocumentFolders).where(eq(sstDocumentFolders.id, currentId)).limit(1)
    if (!folder) break
    // Una carpeta archivada no aporta segmentos: su subárbol ya vive físicamente
    // bajo Archivados/ y sus paths guardados ya llevan ese prefijo.
    if (!folder.archivedAt) segments.unshift(remoteSegment(folder.name))
    currentId = folder.parentId
  }
  return segments
}

/** `storage/sst-documents/<segmentos>` para una carpeta. */
function logicalFolderPath(segments: readonly string[]): string {
  return `storage/sst-documents/${segments.join("/")}`.replace(/\/+$/, "")
}

/**
 * Espeja una carpeta en el storage. Idempotente: si ya existe físicamente no
 * pasa nada. Usado por `getOrCreateSystemFolder` y por la migración para
 * materializar carpetas activas.
 */
export async function ensureSstFolderPhysical(folderId: string): Promise<void> {
  const segments = await getFolderRemoteSegments(folderId)
  if (segments.length === 0) return
  await createSstFolder(logicalFolderPath(segments))
}
