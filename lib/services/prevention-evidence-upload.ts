/**
 * lib/services/prevention-evidence-upload.ts
 *
 * Subida de un archivo de evidencia para Campañas, CGRD, Higiene y CAPA.
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
import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { preventionEvidenceUploads } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { validateFileBuffer, MimeType, MIPER_EVIDENCE } from "@/lib/file-validation"
import { QUOTATION_EXTENSION_BY_MIME } from "@/lib/storage/quotation-content-type"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import {
  createCampaignEvidencePath,
  createCapaEvidencePath,
  createCgrdEvidencePath,
  createHygieneEvidencePath,
  createMiperEvidencePath,
  resolveCampaignEvidenceDir,
  resolveCapaEvidenceDir,
  resolveCgrdEvidenceDir,
  resolveHygieneEvidenceDir,
  resolveMiperEvidenceDir,
  resolveStorageFile,
} from "@/lib/storage/config"

/** Mismo tope que la evidencia del PDTP: son el mismo tipo de respaldo. */
export const PREVENTION_EVIDENCE_MAX_FILE_SIZE = 25 * 1024 * 1024

export type PreventionEvidenceDomain = "campaign" | "cgrd" | "hygiene" | "capa" | "miper"

const DOMAINS = {
  campaign: { dir: resolveCampaignEvidenceDir, toPath: createCampaignEvidencePath },
  cgrd: { dir: resolveCgrdEvidenceDir, toPath: createCgrdEvidencePath },
  hygiene: { dir: resolveHygieneEvidenceDir, toPath: createHygieneEvidencePath },
  capa: { dir: resolveCapaEvidenceDir, toPath: createCapaEvidencePath },
  /* MIPER F2 (§7.6): la evidencia de una ocurrencia del Programa de Trabajo
   * admite además Word y Excel para actas y registros (MIPER_EVIDENCE). */
  miper: { dir: resolveMiperEvidenceDir, toPath: createMiperEvidencePath },
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
 *
 * PRV-01 (auditoría 2026-09-28): además deja la fila de dueño en
 * `prevention_evidence_uploads`. Sin ella, la acreditación automática no puede
 * distinguir un archivo subido de una ruta inventada. M-21: la extensión sale
 * del tipo detectado por contenido, nunca del nombre que manda el cliente.
 */
export async function storePreventionEvidence(input: {
  domain: PreventionEvidenceDomain
  fileName: string
  fileSize: number
  buffer: Uint8Array
  uploadedByUserId: string | null
}, client: typeof db | Tx = db): Promise<{ path: string; checksumSha256: string }> {
  if (input.fileSize > PREVENTION_EVIDENCE_MAX_FILE_SIZE) {
    throw new PreventionEvidenceError(
      `El archivo supera el máximo permitido de ${Math.round(PREVENTION_EVIDENCE_MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    )
  }

  /* El conjunto admitido depende del dominio: el Programa de Trabajo acepta
   * además Word y Excel (§7.6), y para un paquete Office el validador necesita
   * el nombre —compara la extensión contra el contenido real—. */
  const allowed = input.domain === "miper" ? MIPER_EVIDENCE : MimeType.PROOF
  const validated = validateFileBuffer(input.buffer, input.fileSize, allowed, input.fileName)
  if (validated.error) throw new PreventionEvidenceError(validated.error)

  const { dir: resolveDir, toPath } = DOMAINS[input.domain]
  const storageName = `${nanoid(20)}${QUOTATION_EXTENSION_BY_MIME[validated.mimeType] ?? ""}`
  const dir = resolveDir()
  await mkdirp(dir)
  await writeBuffer(resolveStorageFile(dir, storageName), Buffer.from(input.buffer))

  const path = toPath(storageName)
  const checksumSha256 = createHash("sha256").update(input.buffer).digest("hex")
  await client.insert(preventionEvidenceUploads).values({
    path,
    domain: input.domain,
    uploadedByUserId: input.uploadedByUserId,
    worksiteId: null,
    sha256: checksumSha256,
    sizeBytes: input.fileSize,
    mimeType: validated.mimeType,
    createdAt: new Date().toISOString(),
  })
  return { path, checksumSha256 }
}

/**
 * Liga un archivo subido a la faena del acto que lo usa como evidencia. Es la
 * contraparte de `assertPdtpEvidenceLinkable` para los dominios de Prevención:
 *
 * - el archivo tiene que haberse subido por la plataforma (hay fila);
 * - la primera vez lo reclama quien lo subió, para su faena;
 * - una vez ligado a una faena, sólo se reutiliza dentro de esa misma faena.
 *
 * Se llama dentro de la transacción del acto, así que un rechazo no deja nada
 * a medio escribir.
 */
export async function claimPreventionEvidenceUpload(
  client: typeof db | Tx,
  input: { path: string; domain: PreventionEvidenceDomain; worksiteId: string; userId: string },
): Promise<void> {
  const [row] = await client.select().from(preventionEvidenceUploads)
    .where(eq(preventionEvidenceUploads.path, input.path))
    .for("update")
    .limit(1)
  if (!row || row.domain !== input.domain) {
    throw new PreventionEvidenceError("La evidencia debe ser un archivo subido a la plataforma desde este formulario.")
  }
  if (row.worksiteId) {
    if (row.worksiteId !== input.worksiteId) {
      throw new PreventionEvidenceError("Ese archivo ya respalda un registro de otra faena y no se puede reutilizar aquí.")
    }
    return
  }
  if (row.uploadedByUserId !== input.userId) {
    throw new PreventionEvidenceError("Sólo quien subió el archivo puede vincularlo por primera vez.")
  }
  await client.update(preventionEvidenceUploads)
    .set({ worksiteId: input.worksiteId, claimedAt: new Date().toISOString() })
    .where(eq(preventionEvidenceUploads.path, input.path))
}

/**
 * Tipo de contenido por extensión, para servir el archivo de vuelta. El
 * nombre almacenado siempre lo generó `storePreventionEvidence` (nanoid + extensión del MIME real), así que la
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
