/**
 * Capa de carpetas con dispatch por backend para el espacio SST.
 *
 * Las carpetas de la plataforma se materializan físicamente en ambos backends:
 * - filesystem: directorios bajo `storage/sst-documents/` (STORAGE_PATH).
 * - cloudreve: colecciones WebDAV bajo la carpeta remota configurada.
 *
 * Los paths acá son SIEMPRE paths lógicos (`storage/sst-documents/<seg>/...`),
 * la misma convención que `sst-backend.ts`.
 */

import path from "node:path"
import { promises as fs } from "node:fs"
import { mkdirp } from "@/lib/storage/helpers"
import { resolveSstDocumentsDir } from "@/lib/storage/config"
import { sstLogicalSegments } from "@/lib/services/cloudreve/sst-path"
import {
  mkdirCloudreveCollection,
  moveCloudreveEntry,
} from "@/lib/services/cloudreve/client"
import { resolveSstBackend } from "@/lib/storage/sst-backend"

/** Resuelve el directorio físico local de un path lógico de carpeta. */
function resolveLocalFolderDir(logicalPath: string): string {
  const segments = sstLogicalSegments(logicalPath)
  return path.join(/*turbopackIgnore: true*/ resolveSstDocumentsDir(), ...segments)
}

/** Crea una carpeta física. Idempotente. */
export async function createSstFolder(logicalPath: string): Promise<void> {
  if (resolveSstBackend() === "cloudreve") {
    await mkdirCloudreveCollection(logicalPath)
    return
  }
  await mkdirp(resolveLocalFolderDir(logicalPath))
}

/** Mueve una carpeta física (y todo su contenido). */
export async function moveSstFolder(fromLogical: string, toLogical: string): Promise<void> {
  if (resolveSstBackend() === "cloudreve") {
    await moveCloudreveEntry(fromLogical, toLogical)
    return
  }
  const fromDir = resolveLocalFolderDir(fromLogical)
  const toDir = resolveLocalFolderDir(toLogical)
  await mkdirp(path.dirname(toDir))
  await fs.rename(fromDir, toDir)
}