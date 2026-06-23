import fs from "node:fs"
import path from "node:path"

export type SeedWorksite = {
  id: string
  name: string
  code: string
}

export type SeedWorker = {
  id: string
  rut: string
  firstName: string
  lastName: string
  worksiteName: string
  worksiteId: string
}

type ParsedWorkerRow = {
  rut: string
  firstName: string
  lastName: string
  worksiteName: string
}

const SOURCE_FILE = "trabajadores_por_faena_actualizado.md"

// Resolve relative to this module, not process.cwd(): the file ships alongside
// the seed code (db/seed/) so it travels in the prod image and release.zip,
// regardless of the working directory the seed is launched from.
export function loadSeedWorkerData(sourcePath = path.join(__dirname, SOURCE_FILE)) {
  const markdown = fs.readFileSync(sourcePath, "utf8")
  const parsedRows = parseWorkerMarkdown(markdown)
  const worksites = buildWorksites(parsedRows)
  const worksiteIdByName = new Map(worksites.map((worksite) => [worksite.name, worksite.id]))
  const seenRuts = new Set<string>()

  const workers = parsedRows.flatMap((row) => {
    const normalizedRut = normalizeRut(row.rut)
    if (seenRuts.has(normalizedRut)) return []
    seenRuts.add(normalizedRut)

    const worksiteId = worksiteIdByName.get(row.worksiteName)
    if (!worksiteId) throw new Error(`Faena no encontrada para trabajador ${row.rut}`)

    return [{
      id: `wrk-${slugify(row.rut)}`,
      rut: row.rut,
      firstName: row.firstName,
      lastName: row.lastName,
      worksiteName: row.worksiteName,
      worksiteId,
    }]
  })

  return {
    worksites,
    workers,
    sourceRows: parsedRows.length,
    skippedDuplicateRuts: parsedRows.length - workers.length,
  }
}

export function parseWorkerMarkdown(markdown: string): ParsedWorkerRow[] {
  let currentWorksite = ""
  const rows: ParsedWorkerRow[] = []

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^## (.+)$/)
    if (heading && heading[1] !== "Resumen") {
      currentWorksite = heading[1]!
      continue
    }

    if (!currentWorksite || !line.startsWith("|")) continue
    if (line.includes("---") || line.includes("Nombre | Segundo nombre")) continue

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim())
    if (cells.length !== 5) continue

    const [firstName, middleName, paternalLastName, maternalLastName, rut] =
      cells as [string, string, string, string, string]
    rows.push({
      rut,
      firstName: [firstName, middleName].filter(Boolean).join(" "),
      lastName: [paternalLastName, maternalLastName].filter(Boolean).join(" "),
      worksiteName: currentWorksite,
    })
  }

  return rows
}

function buildWorksites(rows: ParsedWorkerRow[]): SeedWorksite[] {
  const names = [...new Set(rows.map((row) => row.worksiteName))]
  return names.map((name, index) => ({
    id: `ws-${slugify(name)}`,
    name,
    code: `FA-${String(index + 1).padStart(3, "0")}`,
  }))
}

function normalizeRut(rut: string) {
  return rut.replace(/\./g, "").toUpperCase()
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
