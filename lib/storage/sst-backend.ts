/**
 * Backend conmutable para los documentos SST (biblioteca de Prevención).
 *
 * El `filePath` lógico en BD (`storage/sst-documents/<nanoid>.<ext>`) es la
 * clave en AMBOS backends: el filesystem la resuelve contra STORAGE_PATH y
 * Cloudreve la usa tal cual como ruta dentro de `/dav/`. Cambiar el backend es
 * cambiar una variable de entorno, sin migrar rutas en la base de datos.
 *
 * Default `filesystem` = comportamiento histórico byte a byte. Con
 * `SST_STORAGE_BACKEND=cloudreve` las lecturas/escrituras van al WebDAV.
 */

import path from "node:path"
import { promises as fs } from "node:fs"
import { logger } from "@/lib/logger"
import { mkdirp, readBuffer, removeFile, writeBuffer } from "@/lib/storage/helpers"
import {
  resolveSstDocumentFile,
  resolveSstDocumentsDir,
} from "@/lib/storage/config"
import {
  CloudreveError,
  deleteCloudreveFile,
  ensureParentDirs,
  getCloudreveFile,
  listSstFilesRecursive,
  moveCloudreveEntry,
  putCloudreveFile,
  statCloudreveFile,
} from "@/lib/services/cloudreve/client"

export type SstStorageBackend = "filesystem" | "cloudreve"

export function resolveSstBackend(): SstStorageBackend {
  const raw = process.env.SST_STORAGE_BACKEND?.trim().toLowerCase()
  return raw === "cloudreve" ? "cloudreve" : "filesystem"
}

export function isSstDocumentPath(filePath: string): boolean {
  return filePath.startsWith("storage/sst-documents/")
}

/**
 * Escribe el archivo y devuelve el `filePath` lógico para guardar en BD.
 * `logicalPath` ya es el path anidado completo (storage/sst-documents/<seg>/.../<name>);
 * el backend filesystem crea los directorios padre que falten.
 */
export async function writeSstDocument(logicalPath: string, buffer: Buffer): Promise<string> {
  if (resolveSstBackend() === "cloudreve") {
    await ensureParentDirs(logicalPath)
    await putCloudreveFile(logicalPath, buffer)
    return logicalPath
  }

  const absolutePath = resolveSstDocumentFile(logicalPath)
  if (!absolutePath) throw new Error("Invalid sst document path")
  await mkdirp(path.dirname(absolutePath))
  await writeBuffer(absolutePath, buffer)
  return logicalPath
}

/** Lee el archivo desde el backend activo. Lanza si la ruta no es del espacio SST. */
export async function readSstDocument(filePath: string): Promise<Buffer> {
  if (!isSstDocumentPath(filePath)) throw new Error("Ruta fuera del espacio de documentos SST")

  if (resolveSstBackend() === "cloudreve") {
    try {
      return await getCloudreveFile(filePath)
    } catch (error) {
      if (error instanceof CloudreveError && error.code === "CLOUDREVE_NOT_FOUND") {
        throw new CloudreveError("CLOUDREVE_NOT_FOUND", "Archivo no encontrado en Cloudreve")
      }
      throw error
    }
  }

  const absolutePath = resolveSstDocumentFile(filePath)
  if (!absolutePath) throw new Error("Invalid sst document path")
  return readBuffer(absolutePath)
}

/**
 * Elimina el archivo. No lanza si ya no existe: el contrato de los callers de
 * limpieza es «mejor no bloquear por un huérfano que ya no está».
 */
export async function deleteSstDocument(filePath: string): Promise<void> {
  if (!isSstDocumentPath(filePath)) throw new Error("Ruta fuera del espacio de documentos SST")

  if (resolveSstBackend() === "cloudreve") {
    await deleteCloudreveFile(filePath).catch((error: unknown) => {
      logger.warn("[storage/sst-backend] no se pudo eliminar archivo en Cloudreve", {
        filePath,
        code: error instanceof CloudreveError ? error.code : "UNKNOWN",
      })
    })
    return
  }

  const absolutePath = resolveSstDocumentFile(filePath)
  if (!absolutePath) return
  await removeFile(absolutePath).catch(() => undefined)
}

/** Mueve un archivo de un path lógico a otro dentro del espacio SST. */
export async function moveSstDocument(fromPath: string, toPath: string): Promise<void> {
  if (!isSstDocumentPath(fromPath) || !isSstDocumentPath(toPath)) {
    throw new Error("Ruta fuera del espacio de documentos SST")
  }

  if (resolveSstBackend() === "cloudreve") {
    await moveCloudreveEntry(fromPath, toPath)
    return
  }

  const fromAbs = resolveSstDocumentFile(fromPath)
  const toAbs = resolveSstDocumentFile(toPath)
  if (!fromAbs || !toAbs) throw new Error("Invalid sst document path")
  await mkdirp(path.dirname(toAbs))
  await fs.rename(fromAbs, toAbs)
}

/** Tamaño del archivo sin descargarlo; null si no existe (preflight de bulk-download). */
export async function statSstDocument(filePath: string): Promise<{ size: number } | null> {
  if (!isSstDocumentPath(filePath)) throw new Error("Ruta fuera del espacio de documentos SST")

  if (resolveSstBackend() === "cloudreve") {
    return statCloudreveFile(filePath)
  }

  const absolutePath = resolveSstDocumentFile(filePath)
  if (!absolutePath) throw new Error("Invalid sst document path")
  try {
    const stat = await fs.stat(absolutePath)
    return { size: stat.size }
  } catch {
    return null
  }
}

/**
 * Paths relativos de los archivos del espacio SST según el backend activo
 * (backup): `storage/sst-documents/<seg>/.../<name>`.
 */
export async function listSstStorageFiles(): Promise<string[]> {
  if (resolveSstBackend() === "cloudreve") {
    // El cliente devuelve paths relativos a la carpeta remota configurada
    // (sstPath); el path lógico de BD es storage/sst-documents/<rel>.
    const relFiles = await listSstFilesRecursive()
    return relFiles.map((rel) => `storage/sst-documents/${rel}`)
  }
  const files: string[] = []
  try {
    const walk = async (dir: string, rel: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) await walk(path.join(/*turbopackIgnore: true*/ dir, entry.name), `${rel}${entry.name}/`)
        else files.push(`storage/sst-documents/${rel}${entry.name}`)
      }
    }
    await walk(resolveSstDocumentsDir(), "")
  } catch {
    return []
  }
  return files
}
