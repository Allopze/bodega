/**
 * lib/services/prevention-evidence-upload.ts
 *
 * Subida de un archivo de evidencia para Campañas, CGRD e Higiene.
 *
 * Existe porque la simplificación de 2026-09-14 hizo la evidencia
 * **obligatoria** en ambos módulos y ninguno tenía dónde subir un archivo: la
 * única forma de cumplir era pegar una URL externa, así que el acta o la foto
 * que se le muestra a un fiscalizador vivía fuera de la plataforma.
 *
 * Es un helper y no dos rutas copiadas porque la lógica —validar el tipo real
 * del archivo por su contenido, acotar el tamaño, escribir con un nombre
 * generado (nunca el del usuario) y devolver la ruta con su checksum— es
 * idéntica; lo que cambia por módulo es el permiso y el directorio, y eso lo
 * decide cada ruta.
 */

import { createHash } from "node:crypto"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import {
  createCampaignEvidencePath,
  createCgrdEvidencePath,
  createHygieneEvidencePath,
  resolveCampaignEvidenceDir,
  resolveCgrdEvidenceDir,
  resolveHygieneEvidenceDir,
  resolveStorageFile,
} from "@/lib/storage/config"

/** Mismo tope que la evidencia del PDTP: son el mismo tipo de respaldo. */
export const PREVENTION_EVIDENCE_MAX_FILE_SIZE = 25 * 1024 * 1024

export type PreventionEvidenceDomain = "campaign" | "cgrd" | "hygiene"

const DOMAINS = {
  campaign: { dir: resolveCampaignEvidenceDir, toPath: createCampaignEvidencePath },
  cgrd: { dir: resolveCgrdEvidenceDir, toPath: createCgrdEvidencePath },
  hygiene: { dir: resolveHygieneEvidenceDir, toPath: createHygieneEvidencePath },
} as const

export class PreventionEvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PreventionEvidenceError"
  }
}

/**
 * Guarda el archivo y devuelve la ruta relativa con la que se referencia desde
 * la base, más su checksum. El checksum se calcula acá, sobre el mismo buffer
 * que se escribe: es el único punto donde el contenido está en memoria.
 */
export async function storePreventionEvidence(input: {
  domain: PreventionEvidenceDomain
  fileName: string
  fileSize: number
  buffer: Uint8Array
}): Promise<{ path: string; checksumSha256: string }> {
  if (input.fileSize > PREVENTION_EVIDENCE_MAX_FILE_SIZE) {
    throw new PreventionEvidenceError(
      `El archivo supera el máximo permitido de ${Math.round(PREVENTION_EVIDENCE_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    )
  }

  const validated = validateFileBuffer(input.buffer, input.fileSize, MimeType.PROOF)
  if (validated.error) throw new PreventionEvidenceError(validated.error)

  const { dir: resolveDir, toPath } = DOMAINS[input.domain]
  const storageName = generateStorageName(input.fileName)
  const dir = resolveDir()
  await mkdirp(dir)
  await writeBuffer(resolveStorageFile(dir, storageName), Buffer.from(input.buffer))

  return {
    path: toPath(storageName),
    checksumSha256: createHash("sha256").update(input.buffer).digest("hex"),
  }
}

/**
 * Tipo de contenido por extensión, para servir el archivo de vuelta. El
 * nombre almacenado siempre lo generó `generateStorageName`, así que la
 * extensión ya viene acotada; `octet-stream` es el piso seguro para lo que no
 * se reconozca. Mismo criterio que la ruta de evidencia del PDTP.
 */
export function inferEvidenceContentType(storageName: string): string {
  const lower = storageName.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  return "application/octet-stream"
}
