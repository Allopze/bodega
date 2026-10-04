/**
 * Carga un MIPER en Excel (formato RE-04, hoja «RE-04 IPER») a la plataforma.
 *
 * Hace lo mismo que «Importar» en /prevencion/miper, con las mismas reglas: usa
 * `previewRiskImport` y `commitRiskImport`, firma como una persona real con sus
 * permisos y sus faenas (no se salta la autorización), y decide lo mismo que la
 * pantalla trae sugerido:
 *   - el tipo (I–V) de cada medida, por sus palabras clave;
 *   - cada RESPONSABLE, tal como está escrito (o la persona de la faena con ese nombre);
 *   - cada PLAZOS, existente con su frecuencia o por implementar con su fecha;
 *   - cada FACTORES DE RIESGO que el catálogo no reconoce, al factor parecido
 *     («MCANICO» → Mecánico). Sin parecido claro se asigna con `--factor`, o esas
 *     filas no se cargan (el informe lo dice).
 *
 * Quién firma: `--como <correo>`, o, si se omite, la persona prevencionista de la
 * faena (rol `prevencionista_faena`, asignada a ella) que no revisa ni aprueba
 * MIPER. Quien elabora no puede revisar ni aprobar lo suyo, así que una persona
 * con esos permisos no sirve como autora. Si no hay exactamente una, se pide `--como`.
 *
 * Sin `--cargar` sólo informa qué pasaría. Igual que «Revisar el archivo» en la
 * pantalla, deja el lote preparado; no crea ninguna MIPER. Con `--cargar` crea el
 * borrador (o agrega al vigente), sus riesgos y sus medidas en una transacción.
 * `--reemplazar-borrador` descarta antes el borrador del mismo período, sólo si
 * nunca pasó por revisión (`discardMiperDraft`, queda en la bitácora).
 *
 * Uso:
 *   npm run miper:importar -- --archivo "<ruta.xlsx>" --faena "<nombre o código>" [--como <correo>]
 *     [--periodo 2026] [--destino borrador|vigente] [--factor "SOCIAL=Psicosocial"]... [--motivo "<texto>"]
 *     [--reemplazar-borrador] [--cargar]
 *
 * En producción, desde un equipo con acceso al servidor (abre el túnel a la base):
 *   scripts/importar-miper-prod.sh --archivo "<ruta.xlsx>" --faena "<faena>" [--cargar]
 */
import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { preventionRiskMatrices, roles, userRoles, users, worksiteUsers, worksites } from "@/db/schema"
import { getUserRbacById } from "@/lib/auth/rbac"
import { importSummary } from "@/lib/prevention/miper/import-decisions"
import { riskFactorKey, suggestedFactorMapping, unknownFactorsOf, waitsForFactor } from "@/lib/prevention/miper/factor-suggestion"
import { normalizeMiperName } from "@/lib/prevention/miper/names"
import { suggestedMappings } from "@/lib/prevention/miper/re04-measures"
import { CONTROL_HIERARCHY_LABEL } from "@/lib/prevention/miper/snapshot"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { commitRiskImport, previewRiskImport } from "@/lib/services/miper/import"
import { discardMiperDraft } from "@/lib/services/miper/matrices"
import type { MiperAccess } from "@/lib/services/miper/shared"
import { codeYear } from "@/lib/utils"

type Options = {
  archivo: string
  faena: string
  como: string | null
  periodo: number
  destino: "draft" | "live"
  factores: Array<[string, string]>
  motivo: string | null
  cargar: boolean
  reemplazarBorrador: boolean
}

const USO = `Uso: npm run miper:importar -- --archivo "<ruta.xlsx>" --faena "<nombre o código>" [--como <correo>]
       [--periodo ${codeYear()}] [--destino borrador|vigente] [--factor "SOCIAL=Psicosocial"]... [--motivo "<texto>"]
       [--reemplazar-borrador] [--cargar]`

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string[]>()
  let cargar = false
  let reemplazarBorrador = false
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!
    if (flag === "--cargar") { cargar = true; continue }
    if (flag === "--reemplazar-borrador") { reemplazarBorrador = true; continue }
    if (flag === "--ayuda" || flag === "--help") throw new UsageError("")
    if (!flag.startsWith("--")) throw new UsageError(`No entiendo «${flag}».`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) throw new UsageError(`Falta el valor de ${flag}.`)
    values.set(flag, [...(values.get(flag) ?? []), value])
    index += 1
  }
  const one = (flag: string) => values.get(flag)?.at(-1) ?? null
  const archivo = one("--archivo")
  const faena = one("--faena")
  const como = one("--como")
  if (!archivo || !faena) throw new UsageError("Faltan --archivo o --faena.")
  const periodo = one("--periodo") === null ? codeYear() : Number(one("--periodo"))
  if (!Number.isInteger(periodo) || periodo < 2000 || periodo > 2100) throw new UsageError("--periodo tiene que ser un año, por ejemplo 2026.")
  const destino = one("--destino") ?? "borrador"
  if (destino !== "borrador" && destino !== "vigente") throw new UsageError("--destino es «borrador» o «vigente».")
  const factores = (values.get("--factor") ?? []).map((pair): [string, string] => {
    const [excel, catalogo] = pair.split("=").map((part) => part.trim())
    if (!excel || !catalogo) throw new UsageError(`--factor va como "NOMBRE EN EL EXCEL=Factor del catálogo"; llegó «${pair}».`)
    return [excel, catalogo]
  })
  return { archivo, faena, como, periodo, destino: destino === "borrador" ? "draft" : "live", factores, motivo: one("--motivo"), cargar, reemplazarBorrador }
}

/** La persona que firma la importación, con el mismo acceso que tendría en la app. */
async function accessOf(email: string): Promise<{ access: MiperAccess; name: string }> {
  const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`).limit(1)
  if (!user) throw new UsageError(`No hay ninguna persona con el correo «${email}».`)
  const rbac = await getUserRbacById(user.id, true)
  if (!rbac?.isActive) throw new UsageError(`«${email}» no está activa en la plataforma.`)
  const scope: MiperAccess["scope"] = rbac.isGlobal ? { mode: "all", ids: [] }
    : rbac.worksiteIds.length > 0 ? { mode: "some", ids: rbac.worksiteIds } : { mode: "none", ids: [] }
  return { access: { userId: rbac.id, scope, permissions: rbac.permissions }, name: rbac.name }
}

/** Permisos que impiden elaborar: quien revisa o aprueba no puede hacerlo con lo que elaboró. */
const SIGNING_PERMISSIONS = ["prevention:risk:review", "prevention:risk:approve_legal"]

/** La persona prevencionista de la faena que puede ser autora, o un error que dice quiénes hay. */
async function authorOf(worksite: { id: string; name: string }): Promise<string> {
  const candidates = await db.selectDistinct({ id: users.id, email: users.email }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(worksiteUsers, eq(worksiteUsers.userId, users.id))
    .where(and(eq(roles.name, "prevencionista_faena"), eq(worksiteUsers.worksiteId, worksite.id), eq(users.isActive, true)))
  const eligible: string[] = []
  for (const candidate of candidates) {
    const rbac = await getUserRbacById(candidate.id, true)
    if (rbac?.permissions.includes("prevention:risk:edit") && !SIGNING_PERMISSIONS.some((permission) => rbac.permissions.includes(permission))) eligible.push(candidate.email)
  }
  if (eligible.length === 1) return eligible[0]!
  const all = candidates.map((candidate) => candidate.email).join(", ") || "nadie"
  throw new UsageError(eligible.length === 0
    ? `La faena «${worksite.name}» no tiene una persona prevencionista que pueda elaborar (asignadas: ${all}; quien revisa o aprueba no puede elaborar). Indica --como.`
    : `La faena «${worksite.name}» tiene varias personas prevencionistas que pueden elaborar (${eligible.join(", ")}). Indica --como.`)
}

/**
 * La faena por id, por código o por nombre (sin mayúsculas ni tildes), entre las
 * activas: una faena desactivada no recibe una MIPER nueva. Si un nombre calza con
 * varias, se rechaza y se muestran sus códigos.
 */
async function worksiteOf(text: string): Promise<{ id: string; name: string }> {
  const all = await db.select({ id: worksites.id, name: worksites.name, code: worksites.code }).from(worksites).where(eq(worksites.isActive, true))
  const wanted = normalizeMiperName(text)
  const byIdOrCode = all.find((worksite) => worksite.id === text || normalizeMiperName(worksite.code) === wanted)
  if (byIdOrCode) return byIdOrCode
  const exact = all.filter((worksite) => normalizeMiperName(worksite.name) === wanted)
  const matches = exact.length > 0 ? exact : all.filter((worksite) => normalizeMiperName(worksite.name).includes(wanted))
  if (matches.length === 1) return matches[0]!
  const label = (worksite: { name: string; code: string }) => `${worksite.name} (código ${worksite.code})`
  throw new UsageError(matches.length === 0
    ? `No hay ninguna faena activa «${text}». Las faenas activas son:\n${all.map((worksite) => `  · ${label(worksite)}`).join("\n")}`
    : `«${text}» calza con varias faenas: ${matches.map(label).join(", ")}. Usa el código.`)
}

/**
 * La ruta tal cual o, si no existe, el archivo de esa carpeta con el mismo nombre
 * en otra forma Unicode: un Excel copiado desde macOS trae «ó» como «o» + tilde
 * (NFD), y el nombre escrito en la terminal no calza aunque se vea igual.
 */
async function existingPath(file: string): Promise<string> {
  try {
    await access(file)
    return file
  } catch {
    const dir = path.dirname(file)
    const wanted = path.basename(file).normalize("NFC")
    const match = (await readdir(dir).catch(() => [] as string[])).find((name) => name.normalize("NFC") === wanted)
    return match ? path.join(dir, match) : file
  }
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`

/** Filas del Excel en tramos: «14–69, 112–113». */
function ranges(rows: readonly number[]): string {
  const parts: string[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const start = rows[index]!
    while (rows[index + 1] === rows[index]! + 1) index += 1
    parts.push(start === rows[index] ? `${start}` : `${start}–${rows[index]}`)
  }
  return parts.join(", ")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const worksite = await worksiteOf(options.faena)
  const email = options.como ?? await authorOf(worksite)
  const { access, name } = await accessOf(email)
  // El servicio también lo exige; acá se dice con nombre y antes de leer el archivo.
  if (!access.permissions.includes("prevention:risk:edit")) throw new UsageError(`${name} no tiene permiso para editar MIPER (prevention:risk:edit).`)
  const inScope = access.scope.mode === "all" || (access.scope.mode === "some" && access.scope.ids.includes(worksite.id))
  if (!inScope) throw new UsageError(`La faena «${worksite.name}» no está en el alcance de ${name}.`)
  const fileName = path.basename(options.archivo)
  console.log(`RE-04 «${fileName}» → faena «${worksite.name}», período ${options.periodo}, como ${name} (${email}${options.como ? "" : ", prevencionista de la faena"})`)
  const bytes = await readFile(await existingPath(options.archivo)).catch(() => { throw new UsageError(`No se puede leer «${options.archivo}».`) })

  // El borrador del mismo período que se reemplaza: sólo uno nunca revisado (el servicio lo vuelve a exigir).
  const [current] = options.destino === "draft" && options.reemplazarBorrador
    ? await db.select({ id: preventionRiskMatrices.id, version: preventionRiskMatrices.version, status: preventionRiskMatrices.status, entries: sql<number>`(select count(*)::int from prevention_risk_entries e where e.matrix_id = prevention_risk_matrices.id)`, controls: sql<number>`(select count(*)::int from prevention_risk_controls c join prevention_risk_entries e on e.id = c.risk_entry_id where e.matrix_id = prevention_risk_matrices.id)` })
      .from(preventionRiskMatrices)
      .where(and(eq(preventionRiskMatrices.worksiteId, worksite.id), eq(preventionRiskMatrices.period, options.periodo), ne(preventionRiskMatrices.status, "superseded")))
      .limit(1)
    : []
  if (current) {
    if (current.status !== "draft") throw new UsageError(`El MIPER ${options.periodo} de «${worksite.name}» ya fue aprobado: no se reemplaza. Usa --destino vigente.`)
    console.log(`Se ${options.cargar ? "descarta" : "descartaría"} el borrador ${current.id} (${plural(current.entries, "riesgo")}, ${plural(current.controls, "medida")}) justo antes de cargar.`)
  }

  const preview = await previewRiskImport(bytes, { worksiteId: worksite.id, target: options.destino, period: options.periodo, fileName }, access)
  const { totals } = preview

  // Factores: lo parecido viene sugerido, como en la pantalla; `--factor` decide lo demás (y manda sobre lo sugerido).
  const factorMapping = suggestedFactorMapping(preview.rows, preview.factorOptions)
  for (const [excel, catalogName] of options.factores) {
    const key = riskFactorKey(excel)
    const factor = preview.factorOptions.find((option) => riskFactorKey(option.name) === riskFactorKey(catalogName))
    if (!factor) throw new UsageError(`El catálogo no tiene el factor «${catalogName}». Los factores son: ${preview.factorOptions.map((option) => option.name).join(", ")}.`)
    if (key) factorMapping[key] = factor.id
  }
  const unknown = unknownFactorsOf(preview.rows)
  const factorName = (id: string) => preview.factorOptions.find((option) => option.id === id)?.name ?? id
  const loadable = preview.rows.filter((row) => row.status === "ready" || (row.status === "needs_review" && !waitsForFactor(row, factorMapping)))
  const waiting = preview.rows.filter((row) => waitsForFactor(row, factorMapping)).length

  console.log(`Filas: ${totals.total} (${totals.ready} listas, ${totals.needsReview} esperan su factor, ${totals.rejected} no se cargan por P o C fuera de 1, 2 y 4)`)
  for (const row of preview.rows.filter((candidate) => candidate.status === "rejected").slice(0, 10)) {
    console.log(`  · fila ${row.rowNumber}: ${row.issues.map((issue) => issue.message).join(" ")}`)
  }
  if (unknown.length > 0) {
    console.log("Factores que el catálogo no reconoce:")
    for (const factor of unknown) {
      const assigned = factorMapping[factor.key]
      console.log(`  · «${factor.name}» (${plural(factor.rows, "fila")}) → ${assigned ? factorName(assigned) : `sin asignar: no se carga. Usa --factor "${factor.name}=<factor>"`}`)
    }
  }

  // Lo que falta en las filas que sí se cargan: no detiene la carga (la MIPER las muestra
  // incompletas para terminarlas en la plataforma), pero es mejor saberlo antes.
  const missing: Array<[string, number[]]> = ([
    ["sin factor de riesgo", (row) => row.normalized.riskFactor === null],
    ["sin peligro", (row) => row.normalized.hazard === null],
    ["sin «Rutinaria / No rutinaria»", (row) => row.normalized.isRoutine === null],
    ["sin medidas de control", (row) => row.normalized.measures === null],
    ["sin plazos", (row) => row.normalized.measures !== null && row.normalized.deadlines === null],
    ["con N° de trabajadores en 0", (row) => (row.normalized.exposedFemale ?? 0) + (row.normalized.exposedMale ?? 0) + (row.normalized.exposedOther ?? 0) === 0],
  ] as Array<[string, (row: (typeof loadable)[number]) => boolean]>).map(([label, test]) => [label, loadable.filter(test).map((row) => row.rowNumber)])
  if (missing.some(([, rows]) => rows.length > 0)) {
    console.log("Datos que faltan (se cargan igual y quedan por completar en la plataforma):")
    for (const [label, rows] of missing) if (rows.length > 0) console.log(`  · ${plural(rows.length, "fila")} ${label}: ${ranges(rows)}`)
  }

  const mappings = suggestedMappings(preview.measureAnalysis)
  const summary = importSummary(preview.measureAnalysis, new Set(loadable.map((row) => row.rowNumber)), mappings.deadlineMapping)
  const noHint = preview.measureAnalysis.phrases.filter((phrase) => phrase.suggestion.source === "default")
  console.log(summary.measures === 0
    ? "Medidas: el archivo no trae medidas de control."
    : `Medidas: ${summary.measures} (${summary.existing} existentes y ${summary.pending} por implementar) en ${plural(preview.measureAnalysis.phrases.length, "frase distinta", "frases distintas")}`
      + (noHint.length > 0 ? `; ${noHint.length} sin pista van como ${CONTROL_HIERARCHY_LABEL[noHint[0]!.suggestion.hierarchy]}` : "")
      + ". Todas quedan «Propuesta».")

  // El período ocupado por el borrador que se reemplaza no bloquea: se descarta justo antes de cargar.
  const blocked = options.destino === "draft" ? (current ? null : preview.draft.blockedReason) : preview.live.blockedReason
  const destination = options.destino === "draft" ? `un borrador nuevo del período ${options.periodo}` : `la MIPER vigente «${preview.live.title}»`
  console.log(`Se cargarían ${plural(loadable.length, "riesgo")}${waiting > 0 ? ` (${waiting} quedan fuera por su factor)` : ""} en ${destination}.`)
  if (blocked) {
    console.error(`No se puede cargar: ${blocked}`)
    process.exitCode = 1
    return
  }
  if (!options.cargar) {
    console.log("Simulación: no se creó ninguna MIPER (el lote quedó preparado, como con «Revisar el archivo»). Para cargarlo, repite con --cargar.")
    return
  }

  if (current) {
    await discardMiperDraft({ matrixId: current.id, expectedVersion: current.version, reason: `Se reemplaza por la importación de ${fileName}` }, access)
    console.log("Borrador descartado.")
  }
  const result = await commitRiskImport({
    batchId: preview.batchId,
    worksiteId: worksite.id,
    target: options.destino,
    period: options.periodo,
    revisionReason: options.motivo ?? `Importación RE-04 desde ${fileName} (carga inicial por script)`,
    ...mappings,
    factorMapping,
  }, access)
  console.log(`Cargado: ${plural(result.created, "riesgo")} y ${plural(result.measures.total, "medida")}; ${plural(result.skipped, "fila detenida", "filas detenidas")}.`)
  console.log(`MIPER: /prevencion/miper/${result.matrixId}`)
  // Los avisos de filas Intolerables salen después del COMMIT (`notifyAfterCommit`): se les da tiempo antes de cerrar.
  if (result.notified > 0) await new Promise((resolve) => setTimeout(resolve, 3000))
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      if (error.message) console.error(error.message)
      console.error(USO)
    } else if (error instanceof RiskLegalDomainError) {
      console.error(`No se pudo: ${error.message}`)
    } else {
      console.error(error)
    }
    process.exit(1)
  })
