/**
 * scripts/apply-lista-empleados-2026-11.ts
 *
 * Carga única de «Lista Empleados de servicios-industriales-chome-ltda.xlsx»,
 * la nómina que exporta el sistema de remuneraciones (2026-11-06). Pone al día
 * la dotación de Chome con ella (decisión del usuario, 2026-11-06: «que
 * actualice lo desactualizado en la plataforma»):
 *
 * - **Sexo**: «M»/«F» de la nómina.
 * - **Cargo**: la columna Cargo, llevada al catálogo con `CARGO_MAP`. Sólo se
 *   clasifica a quien está «Sin clasificar»: un cargo puesto a mano o por la
 *   planilla de vencimientos no se pisa; si difiere, se informa.
 * - **Jefe directo** (`workers.supervisor`): el nombre del jefe tal como está
 *   en Chome (se busca por «Rut Jefe»), o el de la nómina si no está.
 * - **Nombre**: la nómina trae nombres y apellidos por separado. Se corrige la
 *   ortografía que difiere, pero se conservan los segundos nombres que Chome ya
 *   tiene y la nómina omite (ver `reconcileName`).
 * - **Faena**: «Nombre Centro Costo 2» → faena de Chome (`AREA_TO_WORKSITE`).
 *   Un cambio es un traslado, con su revisión de pendientes en la faena de origen.
 * - **Altas**: quien está en la nómina y no en Chome se crea activo.
 * - **Reactivaciones**: quien está en la nómina e inactivo en Chome.
 * - **Bajas**: quien está activo en Chome y no figura en la nómina se desactiva,
 *   con el resumen de lo que deja abierto (TI, EPP, permisos) en la auditoría.
 *
 * Todo pasa por los mismos servicios que la pantalla de Trabajadores
 * (`lib/services/workers`, `worker-positions`, `worker-offboarding`): deja
 * auditoría a nombre de `--actor-email`, historial de cargos y los eventos de
 * dotación que abren la inducción del PDTP (N°15, N°52).
 *
 * **Requiere el catálogo de cargos de `apply-vencimientos-planilla-2026-11.ts`**
 * (lo crea su paso 5). Sin él, el dry-run lo dice y `--apply` se niega.
 *
 * La nómina **se lee al ejecutarse** (`--file`): RUT, nombres y fechas no entran
 * al repositorio. El informe nombra a las personas por sus iniciales y la fila
 * (o la faena, si no están en la nómina), nunca por RUT ni nombre.
 *
 *   npx tsx scripts/apply-lista-empleados-2026-11.ts --file <xlsx> --actor-email <correo>          # dry-run
 *   npx tsx scripts/apply-lista-empleados-2026-11.ts --file <xlsx> --actor-email <correo> --apply  # escribe
 *
 * Idempotente: cada cambio compara el estado real con la nómina y se salta si ya
 * coincide. Se aplica una vez, a mano; no forma parte del deploy.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ExcelJS from "exceljs"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { users, workerPositions, workers, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { isExcelErrorText, normalizeCellValue } from "@/lib/combustibles/xlsx-utils"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { cleanRut, validateRut } from "@/lib/rut"
import { evaluateWorksitePreventiveOrganization } from "@/lib/services/pdtp-adapters/preventive-organization-connector"
import { onWorkerEnteredDotacion } from "@/lib/services/pdtp-adapters/worker-lifecycle-connector"
import { getWorkerOffboardingSummary } from "@/lib/services/worker-offboarding"
import {
  bulkAssignWorkerPosition, createWorkerPosition, recordWorkerPositionChange,
} from "@/lib/services/worker-positions"
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"
import { insertWorker, setWorkerActive, updateWorkerFields, type WorkerLifecycleEvent } from "@/lib/services/workers"
import { AREA_TO_WORKSITE, CARGO_MAP, reconcileName, textKey, titleCase } from "@/lib/integrations/talana/mapping"

// Las correspondencias viven en lib/integrations/talana/mapping.ts (las comparte
// la sincronización diaria con Talana); se reexportan para quien ya las importaba.
export { CARGO_MAP, reconcileName, textKey, titleCase }

const REASON = "Nómina de remuneraciones 2026-11"

/* ── Plan ─────────────────────────────────────────────────────────────────── */

/**
 * Cargos que esta carga crea si faltan: no están en el plan de la planilla de
 * vencimientos porque no conducen. Sin capacidades ni clases exigidas; se
 * completan en Administración › Cargos.
 */
const NEW_POSITIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "GERENTE-GENERAL", name: "Gerente general" },
  { code: "GERENTE-ADMIN-OPERACIONES", name: "Gerente de administración y operaciones" },
  { code: "GERENTE-LEGAL-PERSONAS", name: "Gerente legal y de personas" },
  { code: "SECRETARIA-GERENCIA", name: "Secretaria de gerencia" },
  { code: "JEFE-MANTENCION", name: "Jefe de mantención" },
  { code: "RIGGER", name: "Rigger" },
]

function words(value: string): string[] {
  return textKey(value).split(" ").filter(Boolean)
}

function initials(name: string | null): string {
  const parts = (name ?? "").split(/\s+/).filter(Boolean)
  return parts.length ? `${parts.map((part) => part[0]!.toLocaleUpperCase("es-CL")).join(".")}.` : "?"
}

/* ── Lectura de la nómina ─────────────────────────────────────────────────── */

export interface EmployeeRow {
  row: number
  /** Canónico `12345678-9`. */
  rut: string
  firstName: string
  lastName: string
  sex: "male" | "female" | null
  cargo: string | null
  area: string | null
  jefe: string | null
  jefeRut: string | null
}

export interface ReviewNote { kind: ReviewKind; item: string; detail: string }

const COLUMNS = {
  rut: (key: string) => key === "RUT",
  firstName: (key: string) => key === "NOMBRE",
  paterno: (key: string) => key === "APELLIDO PATERNO",
  materno: (key: string) => key === "APELLIDO MATERNO",
  sex: (key: string) => key === "SEXO",
  cargo: (key: string) => key === "CARGO",
  area: (key: string) => key === "NOMBRE CENTRO COSTO 2",
  jefe: (key: string) => key === "JEFE",
  jefeRut: (key: string) => key === "RUT JEFE",
}
type Column = keyof typeof COLUMNS
const REQUIRED: Column[] = ["rut", "firstName", "paterno", "sex", "cargo", "area", "jefe", "jefeRut"]

/** Lee la hoja «Empleados». Las columnas se buscan por su nombre, no por su letra. */
export async function readNomina(source: Buffer | ArrayBuffer): Promise<{ rows: EmployeeRow[]; skipped: ReviewNote[] }> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(source as never)
  } catch {
    throw new Error("El archivo no es una planilla Excel válida.")
  }
  const sheet = workbook.worksheets.find((candidate) => textKey(candidate.name) === "EMPLEADOS") ?? workbook.worksheets[0]
  if (!sheet) throw new Error("La planilla no tiene hojas.")

  const cols: Partial<Record<Column, number>> = {}
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    const key = textKey(String(normalizeCellValue(cell.value) ?? ""))
    for (const field of Object.keys(COLUMNS) as Column[]) {
      if (cols[field] === undefined && COLUMNS[field](key)) { cols[field] = column; break }
    }
  })
  const missing = REQUIRED.filter((field) => cols[field] === undefined)
  if (missing.length > 0) throw new Error(`En la hoja «${sheet.name}» faltan las columnas: ${missing.join(", ")}.`)

  const text = (rowNumber: number, field: Column): string | null => {
    const column = cols[field]
    if (!column) return null
    const value = normalizeCellValue(sheet.getRow(rowNumber).getCell(column).value)
    if (value === null || value === undefined || value instanceof Date) return null
    const out = String(value).replace(/\s+/g, " ").trim()
    return out && !isExcelErrorText(out) ? out : null
  }

  const rows: EmployeeRow[] = []
  const skipped: ReviewNote[] = []
  const seen = new Set<string>()
  for (let row = 2; row <= sheet.rowCount; row++) {
    const rutRaw = text(row, "rut")
    const firstName = text(row, "firstName")
    const lastName = [text(row, "paterno"), text(row, "materno")].filter(Boolean).join(" ")
    if (!rutRaw && !firstName && !lastName) continue
    const label = `${initials(`${firstName ?? ""} ${lastName}`)} · fila ${row}`
    if (!rutRaw || !validateRut(rutRaw)) { skipped.push({ kind: "fila_omitida", item: label, detail: "RUT vacío o con dígito verificador inválido" }); continue }
    if (!firstName || !lastName) { skipped.push({ kind: "fila_omitida", item: label, detail: "sin nombre o sin apellido" }); continue }
    const rut = cleanRut(rutRaw)
    if (seen.has(rut)) { skipped.push({ kind: "fila_omitida", item: label, detail: "RUT repetido en la nómina; vale la primera fila" }); continue }
    seen.add(rut)
    const sexRaw = textKey(text(row, "sex"))
    const jefeRutRaw = text(row, "jefeRut")
    rows.push({
      row,
      rut,
      firstName,
      lastName,
      sex: sexRaw === "M" ? "male" : sexRaw === "F" ? "female" : null,
      cargo: text(row, "cargo"),
      area: text(row, "area"),
      jefe: text(row, "jefe"),
      jefeRut: jefeRutRaw && validateRut(jefeRutRaw) ? cleanRut(jefeRutRaw) : null,
    })
  }
  return { rows, skipped }
}

/* ── Resultado ────────────────────────────────────────────────────────────── */

type Result = "aplicado" | "dry-run" | "ya estaba" | "omitido"
export interface Outcome { step: string; item: string; action: string; result: Result; detail?: string }

export type ReviewKind =
  | "fila_omitida" | "catalogo_faltante" | "cargo_distinto" | "cargo_desconocido" | "sin_cargo"
  | "baja_con_pendientes" | "baja_con_usuario" | "traslado_con_pendientes" | "nombre_corregido"
  | "rut_repetido_en_chome"

const REVIEW_TITLES: Record<ReviewKind, string> = {
  catalogo_faltante: "Cargos que faltan en el catálogo (corre antes la planilla de vencimientos)",
  fila_omitida: "Filas omitidas",
  rut_repetido_en_chome: "RUT repetido en Chome (no se tocó)",
  cargo_desconocido: "Cargos de la nómina sin equivalencia en el catálogo",
  sin_cargo: "Sin cargo en la nómina (siguen como estaban)",
  cargo_distinto: "Cargo de Chome distinto al de la nómina (no se cambió)",
  nombre_corregido: "Nombres corregidos con la ortografía de la nómina",
  traslado_con_pendientes: "Traslados que dejan pendientes en la faena de origen",
  baja_con_pendientes: "Bajas con pendientes abiertos (TI, EPP, permisos)",
  baja_con_usuario: "Bajas con cuenta de usuario activa (la cuenta no se tocó)",
}

export interface NominaReport { outcomes: Outcome[]; review: ReviewNote[] }

/* ── Ejecución ────────────────────────────────────────────────────────────── */

export interface NominaOptions {
  actorEmail: string
  apply?: boolean
  file?: string
  buffer?: Buffer | ArrayBuffer
}

type PositionRow = typeof workerPositions.$inferSelect
type WorkerRow = typeof workers.$inferSelect

export async function applyListaEmpleados202611(options: NominaOptions): Promise<NominaReport> {
  const apply = options.apply ?? false
  if (!options.file && !options.buffer) throw new Error("Falta la nómina: --file <ruta del .xlsx>.")
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const actor = { userId: actorRow.id, email: actorRow.email }
  const source = options.buffer ?? await readFile(path.resolve(options.file!))
  const { rows, skipped } = await readNomina(source)

  const outcomes: Outcome[] = []
  const review: ReviewNote[] = [...skipped]
  let step = ""
  const report = (outcome: Omit<Outcome, "step">) => { outcomes.push({ step, ...outcome }) }
  const note = (entry: ReviewNote) => { review.push(entry) }
  const events: WorkerLifecycleEvent[] = []

  /* 1. Catálogo de cargos ─────────────────────────────────────────────────── */
  step = "1 Catálogo de cargos"
  let positions = await db.select().from(workerPositions)
  const byKey = () => new Map(positions.map((position) => [position.normalizedKey, position]))
  // Antes de escribir nada: sin el catálogo de vencimientos, el apply no empieza.
  const newPositionKeys = new Set(NEW_POSITIONS.map((plan) => normalizeWorkerPositionKey(plan.name)))
  const missingCatalog = [...new Set(CARGO_MAP.values())].filter((name) => {
    const key = normalizeWorkerPositionKey(name)
    return !byKey().has(key) && !newPositionKeys.has(key)
  })
  for (const name of missingCatalog) note({ kind: "catalogo_faltante", item: name, detail: "lo crea el paso 5 de apply-vencimientos-planilla-2026-11.ts" })
  if (apply && missingCatalog.length > 0) {
    throw new Error(`Faltan cargos en el catálogo (${missingCatalog.join(", ")}). Corre antes scripts/apply-vencimientos-planilla-2026-11.ts --apply.`)
  }
  for (const plan of NEW_POSITIONS) {
    const action = "crear cargo"
    const existing = byKey().get(normalizeWorkerPositionKey(plan.name))
    if (existing) { report({ item: plan.name, action, result: "ya estaba" }); continue }
    if (!apply) { report({ item: plan.name, action, result: "dry-run" }); continue }
    const created = await db.transaction(async (tx) => {
      const position = await createWorkerPosition({ code: plan.code, name: plan.name, needsReview: false, requiredLicenseClasses: [] }, tx)
      await recordAudit({
        userId: actor.userId, userEmail: actor.email, action: "create", entityType: "worker_position",
        entityId: position.id, entityCode: position.code, newState: { name: position.name }, reason: REASON,
      }, tx)
      return position
    })
    positions = [...positions, created]
    report({ item: plan.name, action, result: "aplicado" })
  }
  /** Cargo destino de un texto de la nómina: fila del catálogo, `undefined` si aún no existe, `null` si no hay equivalencia. */
  const positionFor = (cargo: string | null): { name: string; position: PositionRow | undefined } | null => {
    const name = CARGO_MAP.get(textKey(cargo))
    return name ? { name, position: byKey().get(normalizeWorkerPositionKey(name)) } : null
  }

  /* Estado de Chome ──────────────────────────────────────────────────────── */
  const [allWorkers, allWorksites, linkedUsers] = await Promise.all([
    db.select().from(workers),
    db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites),
    db.select({ workerId: users.workerId, isActive: users.isActive }).from(users),
  ])
  const positionById = new Map(positions.map((position) => [position.id, position]))
  const worksiteName = new Map(allWorksites.map((worksite) => [worksite.id, worksite.name]))
  const activeUserByWorker = new Set(linkedUsers.filter((user) => user.workerId && user.isActive).map((user) => user.workerId!))
  const byRut = new Map<string, WorkerRow[]>()
  for (const worker of allWorkers) {
    if (!worker.rut) continue
    const key = cleanRut(worker.rut)
    byRut.set(key, [...(byRut.get(key) ?? []), worker])
  }
  const resolveWorksite = (area: string | null) => {
    const target = AREA_TO_WORKSITE.get(textKey(area))
    if (!target) return null
    const matches = allWorksites.filter((worksite) => worksite.isActive && textKey(worksite.name) === textKey(target))
    return matches.length === 1 ? matches[0]! : null
  }
  // Nombre del jefe como quedará en Chome: el de su ficha (ya corregido con la
  // nómina si corresponde) o, si no tiene ficha, el de la nómina.
  const sheetByRut = new Map(rows.map((row) => [row.rut, row]))
  const displayNameByRut = (rut: string | null, fallback: string | null): string | null => {
    if (rut) {
      const worker = byRut.get(rut)?.[0]
      const sheet = sheetByRut.get(rut)
      if (worker) {
        const fixed = sheet ? reconcileName(worker, sheet) : null
        return `${(fixed ?? worker).firstName.trim()} ${(fixed ?? worker).lastName.trim()}`
      }
      if (sheet) return `${titleCase(sheet.firstName)} ${titleCase(sheet.lastName)}`
    }
    return fallback ? titleCase(fallback) : null
  }

  /* 2. Trabajadores de la nómina ─────────────────────────────────────────── */
  step = "2 Trabajadores de la nómina"
  const toAssign = new Map<string, Array<{ workerId: string; label: string }>>()

  for (const row of rows) {
    const label = `${initials(`${row.firstName} ${row.lastName}`)} · fila ${row.row}`
    const worksite = resolveWorksite(row.area)
    if (!worksite) {
      report({ item: label, action: "trabajador de la nómina", result: "omitido", detail: `centro de costo «${row.area ?? ""}» sin faena` })
      note({ kind: "fila_omitida", item: label, detail: `centro de costo «${row.area ?? ""}» sin faena equivalente` })
      continue
    }
    const target = positionFor(row.cargo)
    if (!row.cargo) note({ kind: "sin_cargo", item: label, detail: `faena «${worksite.name}»` })
    else if (!target) note({ kind: "cargo_desconocido", item: label, detail: `«${row.cargo}»: agrégalo a CARGO_MAP o clasifícalo a mano` })
    const supervisor = row.jefeRut === row.rut ? null : displayNameByRut(row.jefeRut, row.jefe)

    const matches = byRut.get(row.rut) ?? []
    if (matches.length > 1) {
      report({ item: label, action: "trabajador de la nómina", result: "omitido", detail: "su RUT está repetido en Chome" })
      note({ kind: "rut_repetido_en_chome", item: label, detail: "decide cuál ficha conservar" })
      continue
    }
    const existing = matches[0]

    /* Alta ─ */
    if (!existing) {
      const action = `alta en «${worksite.name}»`
      const firstName = titleCase(row.firstName)
      const lastName = titleCase(row.lastName)
      if (firstName.length > 60 || lastName.length > 60) { report({ item: label, action, result: "omitido", detail: "nombre o apellido de más de 60 caracteres" }); continue }
      const detail = `cargo «${target?.name ?? "Sin clasificar"}»`
      if (!apply) { report({ item: label, action, result: "dry-run", detail }); continue }
      const id = nanoid()
      const inserted = await db.transaction(async (tx) => {
        const position = target?.position
          ?? await tx.query.workerPositions.findFirst({ where: eq(workerPositions.code, "SIN-CLASIFICAR") })
        if (!position) throw new Error("No existe el cargo de sistema Sin clasificar.")
        const result = await insertWorker({
          id, rut: row.rut, firstName, lastName, sex: row.sex, supervisor,
          positionId: position.id, position: position.name, worksiteId: worksite.id, isActive: true,
        }, tx)
        await recordWorkerPositionChange({
          workerId: id, nextPosition: position, source: "import", actorUserId: actor.userId,
          reason: `Cargo asignado al crear el trabajador desde la ${REASON.toLowerCase()}`,
        }, tx)
        await recordAudit({
          userId: actor.userId, userEmail: actor.email, action: "create", entityType: "worker", entityId: id,
          newState: { firstName, lastName, rut: row.rut, position: position.name, supervisor, ...(row.sex ? { sexoRegistrado: true } : {}) },
          reason: REASON, worksiteId: worksite.id,
        }, tx)
        return result
      })
      events.push(...inserted.events)
      report({ item: label, action, result: "aplicado", detail })
      continue
    }

    /* Ficha existente ─ */
    const changes: Partial<WorkerRow> = {}
    const changed: string[] = []
    const fixedName = reconcileName(existing, row)
    if (fixedName) {
      Object.assign(changes, fixedName)
      changed.push("nombre")
      note({ kind: "nombre_corregido", item: label, detail: describeNameChange(existing, fixedName) })
    }
    if (row.sex && existing.sex !== row.sex) { changes.sex = row.sex; changed.push("sexo") }
    if (supervisor && textKey(existing.supervisor) !== textKey(supervisor)) { changes.supervisor = supervisor; changed.push("jefe directo") }
    const isTransfer = existing.worksiteId !== worksite.id
    if (isTransfer) { changes.worksiteId = worksite.id; changed.push(`faena ${worksiteName.get(existing.worksiteId) ?? "?"} → ${worksite.name}`) }
    if (!existing.isActive) { changes.isActive = true; changed.push("reactivación") }

    if (changed.length === 0) report({ item: label, action: "actualizar ficha", result: "ya estaba" })
    else if (!apply) report({ item: label, action: "actualizar ficha", result: "dry-run", detail: changed.join(", ") })
    else {
      // Pendientes en la faena de origen: sólo si de verdad es un traslado (activo antes y después).
      const pendings = isTransfer && existing.isActive ? await getWorkerOffboardingSummary(existing.id) : null
      if (pendings && !pendings.clear) {
        note({ kind: "traslado_con_pendientes", item: label, detail: `en ${worksiteName.get(existing.worksiteId) ?? "la faena de origen"}: ${pendings.items.map((item) => item.label).join("; ")}` })
      }
      const updated = await db.transaction(async (tx) => {
        const result = await updateWorkerFields(existing.id, changes, existing, tx)
        await recordAudit({
          userId: actor.userId, userEmail: actor.email, action: "update", entityType: "worker", entityId: existing.id,
          oldState: {
            ...(fixedName ? { firstName: existing.firstName, lastName: existing.lastName } : {}),
            ...(changes.supervisor !== undefined ? { supervisor: existing.supervisor } : {}),
            ...(changes.worksiteId ? { worksiteId: existing.worksiteId } : {}),
            ...(changes.isActive ? { isActive: false } : {}),
          },
          newState: {
            ...(fixedName ?? {}),
            ...(changes.supervisor !== undefined ? { supervisor: changes.supervisor } : {}),
            ...(changes.worksiteId ? { worksiteId: changes.worksiteId } : {}),
            ...(changes.isActive ? { isActive: true } : {}),
            // Sólo el hecho, no el valor: la auditoría es append-only (mismo criterio que la ficha).
            ...(changes.sex !== undefined ? { sexoModificado: true } : {}),
            ...(pendings ? { pendientesEnFaenaDeOrigen: pendings.items } : {}),
          },
          reason: REASON, worksiteId: worksite.id,
        }, tx)
        return result
      })
      events.push(...updated.events)
      report({ item: label, action: "actualizar ficha", result: "aplicado", detail: changed.join(", ") })
    }

    /* Cargo ─ */
    if (!target) continue
    const action = `cargo «${target.name}»`
    const current = existing.positionId ? positionById.get(existing.positionId) : undefined
    if (target.position && existing.positionId === target.position.id) { report({ item: label, action, result: "ya estaba" }); continue }
    if (current && !current.isSystem) {
      report({ item: label, action, result: "omitido", detail: `ya tiene «${current.name}»` })
      note({ kind: "cargo_distinto", item: label, detail: `Chome dice «${current.name}», la nómina «${row.cargo}» («${target.name}»)` })
      continue
    }
    if (!apply || !target.position) { report({ item: label, action, result: "dry-run" }); continue }
    toAssign.set(target.position.id, [...(toAssign.get(target.position.id) ?? []), { workerId: existing.id, label }])
  }

  for (const [positionId, group] of toAssign) {
    const action = `cargo «${positionById.get(positionId)?.name ?? positionId}»`
    const { changed } = await db.transaction((tx) => bulkAssignWorkerPosition({
      workerIds: group.map((entry) => entry.workerId),
      positionId,
      reason: REASON,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      source: "import",
    }, tx))
    const changedIds = new Set(changed)
    for (const entry of group) report({ item: entry.label, action, result: changedIds.has(entry.workerId) ? "aplicado" : "ya estaba" })
  }

  /* 3. Bajas ──────────────────────────────────────────────────────────────── */
  step = "3 Bajas (activos que no están en la nómina)"
  const inSheet = new Set(rows.map((row) => row.rut))
  for (const worker of allWorkers) {
    if (!worker.isActive) continue
    const site = worksiteName.get(worker.worksiteId) ?? "?"
    const label = `${initials(`${worker.firstName} ${worker.lastName}`)} · ${site}`
    if (!worker.rut) {
      report({ item: label, action: "baja", result: "omitido", detail: "no tiene RUT: no se puede cruzar con la nómina" })
      continue
    }
    if (inSheet.has(cleanRut(worker.rut))) continue
    const detail = `en Chome desde ${worker.createdAt.slice(0, 10)}`
    if (activeUserByWorker.has(worker.id)) note({ kind: "baja_con_usuario", item: label, detail: "desactiva su cuenta en Usuarios si ya no trabaja en la empresa" })
    const pendings = await getWorkerOffboardingSummary(worker.id)
    if (!pendings.clear) note({ kind: "baja_con_pendientes", item: label, detail: pendings.items.map((item) => item.label).join("; ") })
    if (!apply) { report({ item: label, action: "baja", result: "dry-run", detail }); continue }
    await db.transaction(async (tx) => {
      await setWorkerActive(worker.id, false, worker, tx)
      await recordAudit({
        userId: actor.userId, userEmail: actor.email, action: "update", entityType: "worker", entityId: worker.id,
        oldState: { isActive: true },
        newState: { isActive: false, pendientesAlDesactivar: pendings.items },
        reason: `${REASON}: no figura en la nómina`, worksiteId: worker.worksiteId,
      }, tx)
    })
    report({ item: label, action: "baja", result: "aplicado", detail })
  }

  /* 4. Dotación ───────────────────────────────────────────────────────────── */
  // Lo mismo que hace la pantalla de Trabajadores tras guardar: abre la
  // inducción del PDTP de quien entra a una faena. Nunca deshace lo escrito.
  if (apply && events.length > 0) {
    try {
      await onWorkerEnteredDotacion(events, actor.userId)
      await evaluateWorksitePreventiveOrganization(events.map((event) => event.worksiteId))
    } catch (error) {
      logger.error("[nómina 2026-11] no se pudo registrar el cambio de dotación en el PDTP", error)
    }
  }

  return { outcomes, review }
}

/** Qué cambió del nombre, sin escribir el nombre: posición y largo de cada palabra distinta. */
function describeNameChange(before: { firstName: string; lastName: string }, after: { firstName: string; lastName: string }): string {
  const parts: string[] = []
  if (words(before.firstName).join(" ") !== words(after.firstName).join(" ")) parts.push("nombres")
  if (words(before.lastName).join(" ") !== words(after.lastName).join(" ")) {
    const same = [...words(before.lastName)].sort().join(" ") === [...words(after.lastName)].sort().join(" ")
    parts.push(same ? "apellidos (orden)" : "apellidos")
  }
  return `cambian ${parts.join(" y ")}`
}

export function printNominaReport(report: NominaReport, apply: boolean) {
  const steps = [...new Set(report.outcomes.map((outcome) => outcome.step))]
  for (const step of steps) {
    console.log(`\n[${step}]`)
    const own = report.outcomes.filter((outcome) => outcome.step === step)
    const quiet = own.filter((outcome) => outcome.result === "ya estaba" && !outcome.detail)
    for (const o of own.filter((outcome) => !quiet.includes(outcome))) {
      console.log(`  ${o.item.padEnd(24)} ${o.action.padEnd(40)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
    }
    const byAction = new Map<string, number>()
    for (const o of quiet) byAction.set(o.action, (byAction.get(o.action) ?? 0) + 1)
    for (const [action, count] of byAction) console.log(`  ${count} ya estaban: ${action}`)
  }
  const count = (result: Result) => report.outcomes.filter((outcome) => outcome.result === result).length
  console.log(
    `\n${apply ? `${count("aplicado")} aplicada(s)` : `${count("dry-run")} por aplicar (dry-run)`}, `
    + `${count("ya estaba")} ya estaban, ${count("omitido")} omitida(s).`,
  )
  console.log(`\nA revisar (${report.review.length}):`)
  if (report.review.length === 0) console.log("  nada")
  for (const kind of Object.keys(REVIEW_TITLES) as ReviewKind[]) {
    const notes = report.review.filter((entry) => entry.kind === kind)
    if (notes.length === 0) continue
    console.log(`\n  ${REVIEW_TITLES[kind]} (${notes.length})`)
    for (const entry of notes) console.log(`    - ${entry.item}: ${entry.detail}`)
  }
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value && !value.startsWith("--") ? value : undefined
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const file = argValue(argv, "--file")
  const actorEmail = argValue(argv, "--actor-email")
  if (!file) throw new Error("Falta --file <ruta del .xlsx>.")
  if (!actorEmail) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  console.log(`Nómina de remuneraciones 2026-11 — ${apply ? "escribiendo" : "dry-run"}`)
  printNominaReport(await applyListaEmpleados202611({ actorEmail, file, apply }), apply)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
