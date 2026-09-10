/**
 * Sube el snapshot de respaldo a Cloudreve (WebDAV), en una carpeta remota
 * distinta del espacio SST. Lo invoca `backup-orchestrator.sh` después de
 * ensamblar (y, si corresponde, cifrar) el snapshot local.
 *
 * Sube los MISMOS artefactos que irían a Drive —en claro o `.gpg` según lo que
 * esté en el directorio de subida— y poda las carpetas de fechas viejas según
 * `RETENTION_DAYS`. Falla (exit != 0) si no hay credenciales o si algún
 * artefacto no se pudo subir: un respaldo que miente sobre su copia remota no
 * es aceptable.
 *
 * Credenciales: las resuelve `readCloudreveConfig()` (lo guardado cifrado en
 * `system_settings` gana, el entorno `CLOUDREVE_*` es el respaldo), así que el
 * contenedor debe recibir `DATABASE_URL` y el keyring DTE igual que `app`.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { readCloudreveConfig } from "@/lib/services/cloudreve/settings"
import {
  deleteCloudreveBackupDate,
  ensureCloudreveBackupCollection,
  listCloudreveBackupDates,
  putCloudreveBackupFile,
} from "@/lib/services/cloudreve/client"
import { normalizeBackupCloudrevePath } from "@/lib/services/cloudreve/backup"

const SNAPSHOT_FILES = ["postgres.dump", "storage.tar.gz", "env-config.tar.gz", "manifest.json"]

async function main() {
  const sourceDir = process.argv[2]
  const dateStr = process.argv[3]
  const basePath = normalizeBackupCloudrevePath(process.argv[4])

  if (!sourceDir || !dateStr) {
    console.error("Uso: node scripts/upload-backup-cloudreve.cjs <dir-snapshot> <YYYY-MM-DD> [carpeta-remota]")
    process.exit(2)
  }

  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    console.error("CLOUDREVE_NO_CREDENTIALS: configure Cloudreve en Administración › Almacenamiento de documentos antes de respaldar.")
    process.exit(2)
  }

  // El directorio de subida trae el snapshot en claro o cifrado (.gpg). Se
  // sube la variante presente, priorizando la cifrada para no mezclar ambas.
  const entries = await fs.readdir(sourceDir)
  const files = SNAPSHOT_FILES
    .map((name) => {
      const gpg = `${name}.gpg`
      if (entries.includes(gpg)) return gpg
      if (entries.includes(name)) return name
      return null
    })
    .filter((f): f is string => f !== null)

  await ensureCloudreveBackupCollection(basePath, dateStr)

  const failures: string[] = []
  let uploaded = 0
  for (const file of files) {
    try {
      const buffer = await fs.readFile(path.join(/*turbopackIgnore: true*/ sourceDir, file))
      await putCloudreveBackupFile(basePath, dateStr, file, buffer)
      uploaded += 1
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Poda de retención (mejor esfuerzo): no aborta el backup por no poder borrar.
  let pruned = 0
  try {
    const retentionDays = Number(process.env.RETENTION_DAYS ?? "30")
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - (Number.isFinite(retentionDays) ? retentionDays : 30))
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    for (const d of await listCloudreveBackupDates(basePath)) {
      if (d < cutoffStr && d !== dateStr) {
        try {
          await deleteCloudreveBackupDate(basePath, d)
          pruned += 1
        } catch { /* best-effort */ }
      }
    }
  } catch { /* best-effort */ }

  console.log(JSON.stringify({ dateStr, basePath, total: files.length, uploaded, failed: failures.length, pruned }))

  if (failures.length > 0) {
    for (const f of failures) console.error(`[upload-backup-cloudreve] ${f}`)
    process.exit(1)
  }
  console.log("Cloudreve upload completado")
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
