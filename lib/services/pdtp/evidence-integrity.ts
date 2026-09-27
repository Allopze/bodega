/**
 * Escaneo de integridad entre la base y el disco para la evidencia PDTP
 * (PREV-I13-C).
 *
 * La auditoría lo planteó así: si desaparecen las evidencias de 40
 * actividades, nadie lo detecta hasta que un auditor hace clic. Este escaneo
 * recorre cada referencia al directorio `storage/pdtp-evidence/` que conoce la
 * base (`collectPdtpEvidenceReferences`: ejecuciones, CAPA, historial e
 * instancias) y comprueba que el archivo exista y que su sha256, cuando se
 * registró al vincularlo (W5-SHA) o, en su defecto, al subirlo (registro de
 * subidas, PREV-M02-B), siga coincidiendo.
 *
 * Sólo observa: no borra, no corrige y no toca la base. La alerta es el log
 * (D28: "sólo logs por ahora"): `logger.error` con los conteos y una muestra
 * de rutas, que en producción sí se emite.
 */
import { promises as fs } from "node:fs"
import { logger } from "@/lib/logger"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"
import { sha256OfPdtpEvidence } from "./evidence-files"
import { collectPdtpEvidenceReferences, isPdtpEvidencePath, type PdtpEvidenceSource } from "./evidence-references"
import { loadPdtpEvidenceUploadSha256 } from "./evidence-uploads"

export type PdtpEvidenceOwnerRef = { source: PdtpEvidenceSource; ownerId: string; worksiteId: string | null }

export type PdtpEvidenceIntegrityResult = {
  ok: boolean
  /** Referencias al directorio PDTP encontradas en la base (una ruta puede tener varias). */
  references: number
  /** Archivos distintos revisados. */
  checkedFiles: number
  missingCount: number
  checksumMismatchCount: number
  /** Archivos presentes sin sha256 registrado (anteriores a W5-SHA). */
  withoutChecksum: number
  missing: Array<{ path: string; owners: PdtpEvidenceOwnerRef[] }>
  checksumMismatches: Array<{ path: string; expected: string; actual: string; owners: PdtpEvidenceOwnerRef[] }>
}

function describeFinding(item: { path: string; owners: PdtpEvidenceOwnerRef[] }): string {
  const owners = item.owners.map((owner) => `${owner.source}:${owner.ownerId}@${owner.worksiteId ?? "?"}`).join(", ")
  return `${item.path} ← ${owners}`
}

export async function scanPdtpEvidenceIntegrity(): Promise<PdtpEvidenceIntegrityResult> {
  const references = (await collectPdtpEvidenceReferences()).filter((ref) => isPdtpEvidencePath(ref.path))

  const byPath = new Map<string, { owners: PdtpEvidenceOwnerRef[]; sha256: Set<string> }>()
  for (const ref of references) {
    const entry = byPath.get(ref.path) ?? { owners: [], sha256: new Set<string>() }
    entry.owners.push({ source: ref.source, ownerId: ref.ownerId, worksiteId: ref.worksiteId })
    if (ref.sha256) entry.sha256.add(ref.sha256)
    byPath.set(ref.path, entry)
  }

  // PREV-M02-B (0334): el sha256 que registró la subida sirve de referencia
  // cuando ninguna fila guardó uno (por ejemplo, una instancia programada).
  const uploadSha256 = await loadPdtpEvidenceUploadSha256([...byPath.keys()])
  for (const [path, entry] of byPath) {
    const registered = uploadSha256.get(path)
    if (entry.sha256.size === 0 && registered) entry.sha256.add(registered)
  }

  const result: PdtpEvidenceIntegrityResult = {
    ok: true,
    references: references.length,
    checkedFiles: 0,
    missingCount: 0,
    checksumMismatchCount: 0,
    withoutChecksum: 0,
    missing: [],
    checksumMismatches: [],
  }

  for (const [path, entry] of [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    result.checkedFiles++
    const absolutePath = resolvePdtpEvidenceFile(path)
    const exists = absolutePath
      ? await fs.stat(absolutePath).then((stat) => stat.isFile(), () => false)
      : false
    if (!exists) {
      result.missing.push({ path, owners: entry.owners })
      continue
    }
    if (entry.sha256.size === 0) {
      result.withoutChecksum++
      continue
    }
    const actual = await sha256OfPdtpEvidence(path)
    if (!actual) {
      result.missing.push({ path, owners: entry.owners })
      continue
    }
    // Una ruta puede tener el checksum en dos fuentes (la ejecución y su
    // historial): basta que no coincida con uno para que el archivo no sea
    // el que se vinculó.
    for (const expected of entry.sha256) {
      if (expected !== actual) {
        result.checksumMismatches.push({ path, expected, actual, owners: entry.owners })
        break
      }
    }
  }

  result.missingCount = result.missing.length
  result.checksumMismatchCount = result.checksumMismatches.length
  result.ok = result.missingCount === 0 && result.checksumMismatchCount === 0

  if (!result.ok) {
    logger.error({
      missingCount: result.missingCount,
      checksumMismatchCount: result.checksumMismatchCount,
      checkedFiles: result.checkedFiles,
      // Texto plano: el logger redacta hasta cuatro niveles y una muestra
      // anidada perdería justo el dueño, que es lo que permite recuperar.
      missingSample: result.missing.slice(0, 20).map(describeFinding),
      mismatchSample: result.checksumMismatches.slice(0, 20).map(describeFinding),
    }, "[pdtp/evidence-integrity] evidencia referenciada sin archivo o alterada")
  } else {
    logger.info({ checkedFiles: result.checkedFiles, withoutChecksum: result.withoutChecksum }, "[pdtp/evidence-integrity] sin hallazgos")
  }
  return result
}
