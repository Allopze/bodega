/**
 * Migra los archivos de documentos SST desde el filesystem local a Cloudreve
 * (WebDAV) y reorganiza el árbol físico para que coincida con las carpetas de
 * la plataforma. One-shot idempotente, estilo `backfill-dte-order-refs`.
 *
 * Reglas:
 * - NO borra el origen local: el rollback necesita el disco intacto. El
 *   rollback se hace desde Administración › Almacenamiento de documentos
 *   (backend = «Filesystem local»), que es lo que manda: `SST_STORAGE_BACKEND`
 *   quedó como fallback del servidor y NO gana sobre el valor persistido.
 * - Verifica cada archivo: descarga desde Cloudreve y compara SHA-256 contra
 *   `sstDocumentVersions.checksum` (evidencia DS 44). Un mismatch NO se marca
 *   como migrado y queda reportado en `fallidos`.
 * - Reorganiza: para cada versión, el target es
 *   `storage/sst-documents/<segmentos-carpetas>/<storageName>`. Si el
 *   `filePath` guardado difiere, se mueve el archivo local (fs.rename) y el
 *   remoto (MOVE WebDAV) si existen, y se actualiza la BD.
 * - Materializa carpetas: crea las colecciones físicas de todas las carpetas
 *   activas antes de mover archivos (idempotente).
 * - Si el archivo local falta, no se inventa nada: queda en `sinOrigenLocal`.
 *
 * Credenciales: las resuelve `readCloudreveConfig()` —lo guardado cifrado en
 * `system_settings` gana, el entorno `CLOUDREVE_*` es el respaldo—, así que el
 * servicio one-shot debe recibir las mismas variables que `app` (incluido el
 * keyring DTE si las credenciales se guardaron desde Administración).
 */
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders, sstDocuments, sstDocumentVersions } from "@/db/schema"
import { resolveSstDocumentFile, createSstDocumentPath } from "@/lib/storage/config"
import {
  getCloudreveFile,
  moveCloudreveEntry,
  putCloudreveFile,
  statCloudreveFile,
} from "@/lib/services/cloudreve/client"
import { readCloudreveConfig } from "@/lib/services/cloudreve/settings"
import { getFolderRemoteSegments, ensureSstFolderPhysical } from "@/lib/services/prevention-documents/folder-storage"
import { sstLogicalName } from "@/lib/services/cloudreve/sst-path"

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

async function main() {
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    console.error("CLOUDREVE_NO_CREDENTIALS: configure Cloudreve en Administración o vía CLOUDREVE_* antes de migrar.")
    process.exit(2)
  }

  const result = {
    carpetasMaterializadas: 0,
    total: 0,
    migrados: 0,
    yaExistente: 0,
    reorganizados: 0,
    sinOrigenLocal: 0,
    fallidos: 0,
    detalle: [] as Array<{ filePath: string; estado: string; motivo?: string }>,
  }

  // 1. Materializa las carpetas activas (idempotente).
  const folders = await db
    .select({ id: sstDocumentFolders.id })
    .from(sstDocumentFolders)
    .where(isNull(sstDocumentFolders.archivedAt))
  for (const folder of folders) {
    try {
      await ensureSstFolderPhysical(folder.id)
      result.carpetasMaterializadas += 1
    } catch (error) {
      result.fallidos += 1
      result.detalle.push({
        filePath: folder.id,
        estado: "fallido",
        motivo: `no se pudo materializar la carpeta: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  // 2. Reorganiza y migra cada versión.
  const rows = await db
    .select({
      id: sstDocumentVersions.id,
      documentId: sstDocumentVersions.documentId,
      filePath: sstDocumentVersions.filePath,
      checksum: sstDocumentVersions.checksum,
    })
    .from(sstDocumentVersions)

  // Resuelve los segmentos de carpeta por documento (un único folder por doc).
  const docIds = [...new Set(rows.map((row) => row.documentId))]
  const segmentsByDoc = new Map<string, string[]>()
  for (const docId of docIds) {
    const [doc] = await db.select({ folderId: sstDocuments.folderId })
      .from(sstDocuments).where(eq(sstDocuments.id, docId)).limit(1)
    segmentsByDoc.set(docId, await getFolderRemoteSegments(doc?.folderId ?? null))
  }

  for (const row of rows) {
    const storageName = sstLogicalName(row.filePath)
    const segments = segmentsByDoc.get(row.documentId) ?? []
    const targetPath = createSstDocumentPath(storageName, segments)
    if (targetPath !== row.filePath) {
      // Reorganiza el archivo local (si existe) y el remoto (si existe).
      const localAbsolute = resolveSstDocumentFile(row.filePath)
      const targetLocalAbsolute = resolveSstDocumentFile(targetPath)
      if (localAbsolute && targetLocalAbsolute) {
        try {
          await fs.mkdir(path.dirname(targetLocalAbsolute), { recursive: true })
          await fs.rename(localAbsolute, targetLocalAbsolute).catch(() => undefined)
        } catch {
          // El rename local es best-effort: el archivo puede no existir aún.
        }
      }
      try {
        const remoteStat = await statCloudreveFile(row.filePath)
        if (remoteStat) await moveCloudreveEntry(row.filePath, targetPath)
      } catch {
        // Best-effort: si el remoto no existe, el upload de abajo lo crea.
      }
      await db.update(sstDocumentVersions)
        .set({ filePath: targetPath, updatedAt: new Date().toISOString() })
        .where(eq(sstDocumentVersions.id, row.id))
      result.reorganizados += 1
    }

    // Migración del contenido (idempotente).
    const localAbsolute = resolveSstDocumentFile(targetPath)
    if (!localAbsolute) {
      result.fallidos += 1
      result.detalle.push({ filePath: targetPath, estado: "fallido", motivo: "ruta local inválida" })
      continue
    }

    let localBytes: Buffer
    try {
      localBytes = await fs.readFile(localAbsolute)
    } catch {
      result.sinOrigenLocal += 1
      result.detalle.push({ filePath: targetPath, estado: "sinOrigenLocal", motivo: "no existe en el filesystem local" })
      continue
    }

    const localChecksum = sha256(localBytes)
    if (row.checksum && localChecksum !== row.checksum) {
      result.fallidos += 1
      result.detalle.push({
        filePath: targetPath,
        estado: "fallido",
        motivo: "el archivo local no coincide con el checksum documental; no se sube",
      })
      continue
    }

    try {
      const remoteStat = await statCloudreveFile(targetPath)
      if (remoteStat && remoteStat.size === localBytes.length) {
        result.yaExistente += 1
        result.detalle.push({ filePath: targetPath, estado: "yaExistente" })
        continue
      }
    } catch (error) {
      result.fallidos += 1
      result.detalle.push({
        filePath: targetPath,
        estado: "fallido",
        motivo: `no se pudo consultar el estado remoto: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }

    try {
      await putCloudreveFile(targetPath, localBytes)
    } catch (error) {
      result.fallidos += 1
      result.detalle.push({
        filePath: targetPath,
        estado: "fallido",
        motivo: `upload rechazado: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }

    try {
      const remoteBytes = await getCloudreveFile(targetPath)
      if (sha256(remoteBytes) !== localChecksum) {
        result.fallidos += 1
        result.detalle.push({
          filePath: targetPath,
          estado: "fallido",
          motivo: "verificación post-upload falló (checksum remoto distinto); el archivo quedó en Cloudreve para revisión",
        })
        continue
      }
    } catch (error) {
      result.fallidos += 1
      result.detalle.push({
        filePath: targetPath,
        estado: "fallido",
        motivo: `no se pudo verificar el archivo subido: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }

    result.migrados += 1
    result.detalle.push({ filePath: targetPath, estado: "migrado" })
  }

  result.total = rows.length
  console.log(JSON.stringify(result, null, 2))
  if (result.fallidos > 0) process.exitCode = 1
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
