import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import postgres from "postgres"

export const LEGACY_ACTION_TABLES = Object.freeze([
  "pdtp_action_plan",
  "pdtp_action_plan_followups",
  "sst_action_plan",
  "ppa_corrective_actions",
])

/**
 * @typedef {object} MigrationPreflightReport
 * @property {Record<(typeof LEGACY_ACTION_TABLES)[number], number>} legacyActionRows
 * @property {{ dualBusinessLinks: number, duplicatePurchaseInvoices: number }} dte
 * @property {{ legacyObjectiveLinks: number, duplicateYears: number }} pdtp
 * @property {{ duplicateApplicabilities: number }} legal
 * @property {{ duplicateProgramSlots: number }} inspections
 * @property {{ appliedCount: number, journalCount: number, skipped: string[] }} migrations
 * @property {string[]} skippedRelations
 */

/**
 * Rechaza cualquier estado que una migración posterior destruiría o que haría
 * fallar un índice único. La reparación es una decisión operacional explícita:
 * este preflight nunca elige ganadores ni elimina historia.
 *
 * @param {MigrationPreflightReport} report
 * @returns {MigrationPreflightReport}
 */
export function assertMigrationPreflightReport(report) {
  const blockers = []
  for (const table of LEGACY_ACTION_TABLES) {
    const total = report.legacyActionRows[table] ?? 0
    if (total > 0) blockers.push(`${table}=${total}`)
  }
  if (report.dte.dualBusinessLinks > 0 || report.dte.duplicatePurchaseInvoices > 0) {
    blockers.push(
      `DTE dualBusinessLinks=${report.dte.dualBusinessLinks} duplicatePurchaseInvoices=${report.dte.duplicatePurchaseInvoices}`,
    )
  }
  if (report.pdtp.legacyObjectiveLinks > 0 || report.pdtp.duplicateYears > 0) {
    blockers.push(
      `PDTP legacyObjectiveLinks=${report.pdtp.legacyObjectiveLinks} duplicateYears=${report.pdtp.duplicateYears}`,
    )
  }
  // LEGAL-04: el índice único parcial sobre (requisito, faena) con proceso nulo
  // no puede crearse si la base ya trae dos pronunciamientos para el mismo
  // requisito y faena. Cuál sobrevive es una decisión de prevención —una es la
  // decisión vigente y la otra un duplicado de una carrera—, no de la migración.
  if (report.legal.duplicateApplicabilities > 0) {
    blockers.push(`LEGAL duplicateApplicabilities=${report.legal.duplicateApplicabilities}`)
  }
  // B-04: el índice único parcial sobre (program_id, scheduled_for) que da
  // idempotencia al materializador no puede crearse si ya hay dos ejecuciones
  // del mismo slot. Hoy `program_id` está a NULL en todas las filas porque
  // ningún formulario lo enviaba, así que en la práctica no bloquea nada —
  // pero comprobarlo cuesta una consulta y evita una migración a medias.
  if (report.inspections.duplicateProgramSlots > 0) {
    blockers.push(`INSPECTIONS duplicateProgramSlots=${report.inspections.duplicateProgramSlots}`)
  }
  /* Migraciones saltadas. El migrador de Drizzle decide qué aplicar con **una
   * sola marca de agua** —`MAX(created_at)` de `drizzle.__drizzle_migrations`—
   * y un `<` estricto contra el `when` del journal; el hash lo calcula y no lo
   * usa para decidir. Una migración que entra al repositorio con un `when`
   * anterior al de otra ya aplicada —dos ramas generando migraciones en
   * paralelo, y la base corrió primero la de la otra rama— queda saltada **para
   * siempre**, sin error ni warning.
   *
   * Pasó: `bodega_dev` llegó a 255 de 256 con la 0236 ausente, y la 0236 es la
   * que saca a las integraciones del índice de período de `pdtp_executions`. El
   * síntoma no aparece al migrar sino meses después, cuando dos inspecciones de
   * la misma semana chocan y la acreditación se cae.
   *
   * Ninguna de las dos herramientas que había podía verlo:
   * `verify-migration-chain.mjs` lo dice él mismo —*"This does not inspect the
   * database"*— y este preflight miraba datos, no el estado del migrador. */
  if (report.migrations.skipped.length > 0) {
    blockers.push(
      `MIGRATIONS saltadas=${report.migrations.skipped.length} (${report.migrations.skipped.join(", ")}) ` +
      "— aplícalas a mano y registra su fila en drizzle.__drizzle_migrations; el migrador no las reintenta.",
    )
  }
  if (blockers.length > 0) {
    throw new Error(
      "MIGRATION_PREFLIGHT_BLOCKED: la base requiere reconciliación explícita antes de migrar. " +
      blockers.join("; "),
    )
  }
  return report
}

async function relationExists(sql, relation) {
  const [row] = await sql`select to_regclass(${`public.${relation}`}) as relation`
  return Boolean(row?.relation)
}

async function countUnsafe(sql, query) {
  const [row] = await sql.unsafe(query)
  return Number(row?.total ?? 0)
}

/**
 * @param {import("postgres").Sql} sql
 * @returns {Promise<MigrationPreflightReport>}
 */
export async function inspectMigrationPreconditions(sql) {
  /** @type {MigrationPreflightReport} */
  const report = {
    legacyActionRows: {
      pdtp_action_plan: 0,
      pdtp_action_plan_followups: 0,
      sst_action_plan: 0,
      ppa_corrective_actions: 0,
    },
    dte: { dualBusinessLinks: 0, duplicatePurchaseInvoices: 0 },
    pdtp: { legacyObjectiveLinks: 0, duplicateYears: 0 },
    legal: { duplicateApplicabilities: 0 },
    inspections: { duplicateProgramSlots: 0 },
    migrations: { appliedCount: 0, journalCount: 0, skipped: [] },
    skippedRelations: [],
  }

  report.migrations = await inspectSkippedMigrations(
    sql,
    path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "db", "migrations"),
  )

  for (const table of LEGACY_ACTION_TABLES) {
    if (!await relationExists(sql, table)) {
      report.skippedRelations.push(table)
      continue
    }
    report.legacyActionRows[table] = await countUnsafe(
      sql,
      `select count(*)::int as total from "${table}"`,
    )
  }

  if (await relationExists(sql, "dte_documents")) {
    report.dte.dualBusinessLinks = await countUnsafe(sql, `
      select count(*)::int as total
      from dte_documents
      where purchase_order_invoice_id is not null and fuel_load_id is not null
    `)
    report.dte.duplicatePurchaseInvoices = await countUnsafe(sql, `
      select count(*)::int as total
      from (
        select purchase_order_invoice_id
        from dte_documents
        where purchase_order_invoice_id is not null
        group by purchase_order_invoice_id
        having count(*) > 1
      ) conflicts
    `)
  } else {
    report.skippedRelations.push("dte_documents")
  }

  if (await relationExists(sql, "prevention_pdtp_source_links")) {
    report.pdtp.legacyObjectiveLinks = await countUnsafe(sql, `
      select count(*)::int as total
      from prevention_pdtp_source_links
      where source_type = 'internal_objective'
    `)
  } else {
    report.skippedRelations.push("prevention_pdtp_source_links")
  }

  if (await relationExists(sql, "prevention_inspection_runs")) {
    report.inspections.duplicateProgramSlots = await countUnsafe(sql, `
      select count(*)::int as total
      from (
        select program_id, scheduled_for
        from prevention_inspection_runs
        where program_id is not null and scheduled_for is not null
        group by program_id, scheduled_for
        having count(*) > 1
      ) duplicates
    `)
  } else {
    report.skippedRelations.push("prevention_inspection_runs")
  }

  if (await relationExists(sql, "pdtp_programs")) {
    report.pdtp.duplicateYears = await countUnsafe(sql, `
      select count(*)::int as total
      from (
        select year from pdtp_programs group by year having count(*) > 1
      ) duplicates
    `)
  } else {
    report.skippedRelations.push("pdtp_programs")
  }

  if (await relationExists(sql, "prevention_legal_applicabilities")) {
    report.legal.duplicateApplicabilities = await countUnsafe(sql, `
      select count(*)::int as total
      from (
        select requirement_id, worksite_id
        from prevention_legal_applicabilities
        where process_id is null
        group by requirement_id, worksite_id
        having count(*) > 1
      ) duplicates
    `)
  } else {
    report.skippedRelations.push("prevention_legal_applicabilities")
  }

  return report
}

/**
 * Migraciones del artefacto que la base **no** aplicó.
 *
 * El hash es el mismo que escribe el migrador: `sha256` del contenido crudo del
 * `.sql` (`drizzle-orm/migrator.js`). Se compara por hash y no por `created_at`
 * porque el timestamp es justamente el dato que falla — dos migraciones pueden
 * compartir marca de agua y una de ellas no estar.
 *
 * Tolera base nueva: sin el esquema `drizzle` no hay nada que comparar.
 *
 * @param {import("postgres").Sql} sql
 * @param {string} migrationsDir
 */
export async function inspectSkippedMigrations(sql, migrationsDir) {
  const [exists] = await sql`select to_regclass('drizzle.__drizzle_migrations') as relation`
  if (!exists?.relation) return { appliedCount: 0, journalCount: 0, skipped: [] }

  const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"))
  const applied = await sql`select hash from drizzle.__drizzle_migrations`
  const appliedHashes = new Set(applied.map((row) => row.hash))

  const skipped = []
  for (const entry of journal.entries) {
    const file = path.join(migrationsDir, `${entry.tag}.sql`)
    const hash = createHash("sha256").update(readFileSync(file, "utf8")).digest("hex")
    if (!appliedHashes.has(hash)) skipped.push(entry.tag)
  }

  /* Sólo las que la base ya pasó de largo. Las pendientes al final de la lista
   * son lo normal antes de migrar: el migrador las va a aplicar en seguida, y
   * bloquear por ellas convertiría el preflight en un candado permanente. Se
   * corta en la última aplicada del journal. */
  const lastAppliedIndex = journal.entries.reduce((last, entry, index) => {
    const hash = createHash("sha256")
      .update(readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8"))
      .digest("hex")
    return appliedHashes.has(hash) ? index : last
  }, -1)
  const trulySkipped = skipped.filter((tag) => journal.entries.findIndex((e) => e.tag === tag) < lastAppliedIndex)

  return { appliedCount: appliedHashes.size, journalCount: journal.entries.length, skipped: trulySkipped }
}

export async function runMigrationPreflight(sql) {
  return assertMigrationPreflightReport(await inspectMigrationPreconditions(sql))
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required")
  const sql = postgres(url, { max: 1 })
  try {
    const report = await runMigrationPreflight(sql)
    console.log(JSON.stringify({ ok: true, ...report }, null, 2))
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
