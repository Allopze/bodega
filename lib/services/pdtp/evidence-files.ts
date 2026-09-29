/**
 * Lectura de archivos de evidencia PDTP del disco: existencia y sha256.
 *
 * W5-SHA: el checksum se calcula en el servidor al vincular el archivo a una
 * ejecución, no se confía en el que manda el formulario. Queda guardado en
 * `source_metadata_json.evidenceSha256` (sin migración) y en el historial, y
 * el escaneo de integridad lo recalcula para detectar un archivo alterado.
 */
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"

/** sha256 hex del archivo, o `null` si la ruta no es del directorio PDTP o no existe. */
export async function sha256OfPdtpEvidence(path: string): Promise<string | null> {
  const absolutePath = resolvePdtpEvidenceFile(path)
  if (!absolutePath) return null
  return sha256OfFile(absolutePath)
}

/** sha256 de un archivo ya resuelto a ruta absoluta, o `null` si no existe. */
export async function sha256OfFile(absolutePath: string): Promise<string | null> {
  try {
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(absolutePath)) hash.update(chunk as Buffer)
    return hash.digest("hex")
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null
    throw err
  }
}

/** sha256 de cada ruta que existe; las que no, quedan fuera del mapa. */
export async function hashPdtpEvidenceFiles(paths: Array<string | null | undefined>): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0))]
  const entries = await Promise.all(unique.map(async (path) => [path, await sha256OfPdtpEvidence(path)] as const))
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null))
}
