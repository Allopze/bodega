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
    skippedRelations: [],
  }

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

  return report
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
