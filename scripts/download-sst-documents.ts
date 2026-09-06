/**
 * Descarga el espacio de documentos SST desde el backend activo hacia un
 * directorio local, preservando la estructura de carpetas. Lo usa el
 * orquestador de backups cuando `SST_STORAGE_BACKEND=cloudreve`: el storage
 * local ya no contiene esos archivos y el backup debe recogerlos desde
 * Cloudreve, con la misma ruta (`storage/sst-documents/<carpetas>/...`) para
 * que `restore-all.sh` siga funcionando sin cambios.
 *
 * Fallo visible: si Cloudreve no responde, sale con código distinto de cero —
 * el orquestador aborta y el backup NO queda "storage omitido" en silencio.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { readSstDocument, listSstStorageFiles } from "@/lib/storage/sst-backend"

async function main() {
  const destination = process.argv[2]
  if (!destination) {
    console.error("Uso: node scripts/download-sst-documents.mjs <directorio-destino>")
    process.exit(2)
  }

  await fs.mkdir(destination, { recursive: true })

  const files = await listSstStorageFiles()
  const result = { total: files.length, descargados: 0, fallidos: 0 }

  for (const filePath of files) {
    // filePath lógico: storage/sst-documents/<seg>/.../<name>.
    const relative = filePath.slice("storage/sst-documents/".length)
    try {
      const buffer = await readSstDocument(filePath)
      const target = path.join(/*turbopackIgnore: true*/ destination, ...relative.split("/"))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, buffer)
      result.descargados += 1
    } catch (error) {
      result.fallidos += 1
      console.error(`[download-sst-documents] ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  console.log(JSON.stringify(result))
  if (result.fallidos > 0) process.exitCode = 1
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
