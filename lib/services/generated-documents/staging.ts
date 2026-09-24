/**
 * Copia local de un documento generado entre que se arma y que se sube.
 *
 * Existe para que un fallo de Cloudreve no obligue a volver a generar el
 * archivo: un PDF se imprime con la sesión de quien produjo el hecho, y esa
 * sesión ya no está cuando el cron reintenta la subida. La ruta sale del id de
 * la fila (un nanoid), nunca de un nombre de negocio.
 */
import { resolveGeneratedArchiveStagingDir, resolveStorageFile } from "@/lib/storage/config"
import { mkdirp, readBuffer, removeFile, writeBuffer } from "@/lib/storage/helpers"

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/

function stagingDir(): string {
  return resolveGeneratedArchiveStagingDir()
}

function stagingFile(id: string, extension: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Id de documento generado inválido")
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error("Extensión inválida")
  return resolveStorageFile(stagingDir(), `${id}.${extension}`)
}

export async function writeStagedDocument(id: string, extension: string, buffer: Buffer): Promise<void> {
  await mkdirp(stagingDir())
  await writeBuffer(stagingFile(id, extension), buffer)
}

/** null si la copia local ya no existe (se borró o el volumen se perdió). */
export async function readStagedDocument(id: string, extension: string): Promise<Buffer | null> {
  try {
    return await readBuffer(stagingFile(id, extension))
  } catch {
    return null
  }
}

export async function removeStagedDocument(id: string, extension: string): Promise<void> {
  await removeFile(stagingFile(id, extension)).catch(() => undefined)
}
