import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { PGlite } from "@electric-sql/pglite"

/**
 * Plantilla migrada de PGlite.
 *
 * Cada suite PGlite instancia su propia base y le corre las 371 migraciones
 * completas. Medido el 2026-11-04: 4,8 s de migración por archivo × 336
 * archivos ≈ 22 min por corrida, y con `--coverage` casi el doble. La
 * alternativa es migrar una vez, guardar el `dumpDataDir()` (10,9 MB) y que
 * cada suite lo cargue (1,0 s): mismo esquema, sin replay.
 *
 * El dump se cachea por huella del contenido de `db/migrations`, así que una
 * migración nueva invalida la plantilla sola — no hay que acordarse de borrar
 * nada. Vive en `.tmp/` (ignorado por git y por los dos proyectos de Vitest).
 */
const templateDir = path.resolve(process.cwd(), ".tmp/pglite-template")

export const DEFAULT_PGLITE_MIGRATIONS_FOLDER = path.resolve(process.cwd(), "db/migrations")

/**
 * Huella del contenido real de las migraciones, no del nombre del archivo.
 * Dos ramas con el mismo journal pero distinto SQL no comparten plantilla.
 */
export function pgliteTemplatePath(folder = DEFAULT_PGLITE_MIGRATIONS_FOLDER): string {
  const journalPath = path.join(folder, "meta", "_journal.json")
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[]
  }
  const hash = createHash("sha256")
  for (const entry of journal.entries) {
    hash.update(entry.tag)
    hash.update(readFileSync(path.join(folder, `${entry.tag}.sql`)))
  }
  return path.join(templateDir, `${hash.digest("hex").slice(0, 24)}.tar`)
}

/**
 * `null` cuando todavía no hay plantilla o está incompleta: el llamador debe
 * caer al camino lento (instancia vacía + `migratePGlite`) en vez de fallar.
 */
export function readPgliteTemplate(folder?: string): File | null {
  try {
    const bytes = readFileSync(pgliteTemplatePath(folder))
    if (bytes.byteLength < 1024) return null
    return new File([bytes], "pglite-template.tar")
  } catch {
    return null
  }
}

/**
 * Se llama al terminar una migración desde cero. Si dos workers arrancan a la
 * vez, ambos escriben su temporal y renombran: `rename` es atómico y el
 * contenido es idéntico, así que no hace falta un lock.
 */
export async function cachePgliteTemplate(pg: PGlite, folder?: string): Promise<void> {
  const target = pgliteTemplatePath(folder)
  if (existsSync(target)) return

  try {
    const dump = await pg.dumpDataDir()
    mkdirSync(path.dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.tmp`
    writeFileSync(temporary, Buffer.from(await dump.arrayBuffer()))
    renameSync(temporary, target)
  } catch (error) {
    // La plantilla es una optimización: si el filesystem no permite escribirla,
    // la suite debe seguir corriendo por el camino de las migraciones.
    console.warn("[pglite-template] no se pudo cachear la plantilla:", error)
  }
}
