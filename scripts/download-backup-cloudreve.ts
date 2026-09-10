/**
 * Descarga un snapshot de respaldo desde Cloudreve (WebDAV) a un directorio
 * local. Lo usa `restore-all.sh --source cloudreve` como paso previo al
 * descifrado + verificación + `pg_restore` existentes.
 *
 * Acepta `latest` o una fecha `YYYY-MM-DD`. Descarga `manifest.json` y los tres
 * artefactos (en claro o `.gpg`, según estén remotos) preservando sus nombres.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { readCloudreveConfig } from "@/lib/services/cloudreve/settings"
import {
  CloudreveError,
  getCloudreveBackupFile,
  listCloudreveBackupDates,
} from "@/lib/services/cloudreve/client"
import { normalizeBackupCloudrevePath } from "@/lib/services/cloudreve/backup"

const ARTIFACTS = ["postgres.dump", "storage.tar.gz", "env-config.tar.gz"]

async function downloadArtifact(
  basePath: string,
  dateStr: string,
  name: string,
): Promise<{ name: string; buffer: Buffer }> {
  try {
    return { name: `${name}.gpg`, buffer: await getCloudreveBackupFile(basePath, dateStr, `${name}.gpg`) }
  } catch (error) {
    if (error instanceof CloudreveError && error.code === "CLOUDREVE_NOT_FOUND") {
      return { name, buffer: await getCloudreveBackupFile(basePath, dateStr, name) }
    }
    throw error
  }
}

async function main() {
  // `--list-dates <carpeta>` imprime las fechas disponibles y sale: lo usa
  // backup-verify.sh para comprobar presencia sin descargar nada.
  const listDatesIdx = process.argv.indexOf("--list-dates")
  if (listDatesIdx !== -1) {
    const basePath = normalizeBackupCloudrevePath(process.argv[listDatesIdx + 1])
    const config = await readCloudreveConfig()
    if (!config.hasCredentials) {
      console.error("CLOUDREVE_NO_CREDENTIALS: configure Cloudreve en Administración › Almacenamiento de documentos.")
      process.exit(2)
    }
    console.log((await listCloudreveBackupDates(basePath)).join("\n"))
    return
  }

  const dateArg = process.argv[2] ?? "latest"
  const destination = process.argv[3]
  const basePath = normalizeBackupCloudrevePath(process.argv[4])

  if (!destination) {
    console.error("Uso: node scripts/download-backup-cloudreve.cjs <YYYY-MM-DD|latest> <dir-destino> [carpeta-remota]")
    process.exit(2)
  }

  const config = await readCloudreveConfig()
  if (!config.hasCredentials) {
    console.error("CLOUDREVE_NO_CREDENTIALS: configure Cloudreve en Administración › Almacenamiento de documentos.")
    process.exit(2)
  }

  let dateStr = dateArg
  if (dateStr === "latest") {
    const dates = (await listCloudreveBackupDates(basePath))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
    dateStr = dates[dates.length - 1] ?? ""
    if (!dateStr) {
      console.error("No hay snapshots de respaldo en Cloudreve.")
      process.exit(2)
    }
  }

  await fs.mkdir(destination, { recursive: true })

  const result = { dateStr, total: ARTIFACTS.length + 1, descargados: 0, fallidos: [] as string[] }

  // Manifest es la llave del restore: sin él no hay checksums que verificar.
  try {
    const manifest = await getCloudreveBackupFile(basePath, dateStr, "manifest.json")
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ destination, "manifest.json"), manifest)
    result.descargados += 1
  } catch (error) {
    result.fallidos.push(`manifest.json: ${error instanceof Error ? error.message : String(error)}`)
  }

  for (const name of ARTIFACTS) {
    try {
      const { name: remoteName, buffer } = await downloadArtifact(basePath, dateStr, name)
      await fs.writeFile(path.join(/*turbopackIgnore: true*/ destination, remoteName), buffer)
      result.descargados += 1
    } catch (error) {
      result.fallidos.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  console.log(JSON.stringify(result))
  if (result.fallidos.length > 0) {
    for (const f of result.fallidos) console.error(`[download-backup-cloudreve] ${f}`)
    process.exit(1)
  }
  console.log("Cloudreve download completado")
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
