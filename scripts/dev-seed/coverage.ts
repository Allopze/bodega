/**
 * Inventario de cobertura de datos por dominio.
 *
 * Es sólo lectura: sirve antes y después de sembrar para decidir qué módulos
 * necesitan datos y para dejar evidencia de lo que cambió. No usa el guard de
 * escritura, pero sí exige una base local de desarrollo (`*_dev`, `*_test` o
 * `*_e2e`) para no confundir el diagnóstico de producción con el de dev.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import postgres, { type Sql } from "postgres"
import { assertDevSeedTarget, formatDevSeedTarget } from "./guard"

export type TableCoverage = {
  table: string
  count: number
  min: number
  status: "ok" | "low" | "empty" | "missing"
}

export type DomainCoverage = {
  key: string
  label: string
  tables: TableCoverage[]
  status: "ok" | "incomplete"
}

type DomainDefinition = {
  key: string
  label: string
  tables: Record<string, number>
}

export const DOMAIN_DEFINITIONS: readonly DomainDefinition[] = [
  {
    key: "ti",
    label: "TI",
    tables: {
      it_asset_types: 3,
      it_assets: 12,
      it_tickets: 8,
      it_licenses: 3,
      it_license_assignments: 5,
      it_access_systems: 2,
      it_worker_checklists: 2,
    },
  },
  {
    key: "mantencion",
    label: "Mantención",
    tables: {
      mant_work_orders: 12,
      mant_records: 30,
      mant_historical_records: 10,
      mant_record_photos: 5,
    },
  },
  {
    key: "miper",
    label: "MIPER",
    tables: {
      prevention_risk_matrices: 2,
      prevention_risk_entries: 40,
      prevention_risk_observations: 4,
      prevention_risk_review_rounds: 2,
      prevention_risk_programs: 2,
    },
  },
  {
    key: "pdtp",
    label: "PDTP",
    tables: {
      pdtp_executions: 50,
      pdtp_obligations: 6,
      pdtp_scheduled_instances: 8,
    },
  },
  {
    key: "prevencion",
    label: "Prevención",
    tables: {
      prevention_privacy_requests: 6,
      alcohol_tests: 20,
      prevention_committee_meetings: 8,
      prevention_emergency_drills: 6,
      sst_document_acks: 20,
    },
  },
  {
    key: "operaciones",
    label: "Operaciones y bodega",
    tables: {
      inventory_movements: 100,
      physical_inventory_counts: 2,
      feedback_reports: 8,
      repuesto_quotations: 5,
      service_quotations: 5,
    },
  },
  {
    key: "combustibles",
    label: "Combustibles",
    tables: {
      fuel_loads: 150,
      fuel_monthly_statements: 6,
      fuel_payments: 6,
      fuel_tae_submissions: 20,
      fuel_seal_movements: 20,
      fuel_anomaly_comments: 10,
      fuel_telemetry_daily: 60,
    },
  },
  {
    key: "facturacion",
    label: "Facturación y clientes",
    tables: {
      clients: 6,
      contracts: 4,
      billing_invoice_items: 30,
      billing_invoice_payments: 8,
      billing_collection_actions: 5,
      billing_proposals: 3,
    },
  },
  {
    key: "flota",
    label: "Flota y GPS",
    tables: {
      fleet_gps_alert_rules: 3,
      fleet_gps_driver_mappings: 5,
      fleet_gps_position_history: 50,
      fleet_gps_trips: 8,
      fleet_vehicle_documents: 8,
    },
  },
  {
    key: "documentos",
    label: "Documentos SST",
    tables: {
      sst_documents: 12,
      sst_document_versions: 12,
      sst_document_acks: 20,
    },
  },
]

export async function collectCounts(sql: Sql): Promise<Map<string, number>> {
  const rows = await sql<{ table_name: string; rows: string }[]>`
    with t as (
      select table_schema, table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    )
    select table_name,
      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text as rows
    from t
  `
  return new Map(rows.map((row) => [row.table_name, Number(row.rows)]))
}

export function evaluateCoverage(counts: Map<string, number>): DomainCoverage[] {
  return DOMAIN_DEFINITIONS.map((definition) => {
    const tables = Object.entries(definition.tables).map(([table, min]) => {
      const found = counts.get(table)
      const count = found ?? 0
      const status: TableCoverage["status"] = found === undefined
        ? "missing"
        : count >= min ? "ok" : count === 0 ? "empty" : "low"
      return { table, count, min, status }
    })
    return {
      key: definition.key,
      label: definition.label,
      tables,
      status: tables.every((table) => table.status === "ok") ? "ok" : "incomplete",
    }
  })
}

export function renderCoverage(domains: DomainCoverage[], target: string): string {
  const lines: string[] = []
  lines.push(`# Cobertura de datos de desarrollo — ${target}`)
  lines.push("")
  lines.push("| Dominio | Estado | Tablas bajo umbral |")
  lines.push("|---|---|---|")
  for (const domain of domains) {
    const pending = domain.tables.filter((table) => table.status !== "ok")
    lines.push(
      `| ${domain.label} | ${domain.status === "ok" ? "OK" : "INCOMPLETO"} | ${pending.length === 0 ? "—" : pending.map((table) => `\`${table.table}\` (${table.count}/${table.min})`).join(", ")} |`,
    )
  }
  lines.push("")
  for (const domain of domains) {
    lines.push(`## ${domain.label}`)
    lines.push("")
    lines.push("| Tabla | Filas | Mínimo | Estado |")
    lines.push("|---|---:|---:|---|")
    for (const table of domain.tables) {
      lines.push(
        `| \`${table.table}\` | ${table.count} | ${table.min} | ${table.status === "ok" ? "OK" : table.status === "missing" ? "FALTA TABLA" : table.status === "empty" ? "VACÍA" : "BAJA"} |`,
      )
    }
    lines.push("")
  }
  return lines.join("\n")
}

export function printCoverage(domains: DomainCoverage[]): void {
  for (const domain of domains) {
    const pending = domain.tables.filter((table) => table.status !== "ok")
    console.log(
      `${domain.status === "ok" ? "✓" : "·"} ${domain.label}: ${pending.length === 0 ? "completo" : pending.map((table) => `${table.table} ${table.status === "missing" ? "falta" : `${table.count}/${table.min}`}`).join(" · ")}`,
    )
  }
}

export async function runCoverage(options: { write?: boolean } = {}): Promise<DomainCoverage[]> {
  const rawUrl = process.env.DATABASE_URL
  const target = assertDevSeedTarget(rawUrl, { apply: false })
  const sql = postgres(rawUrl!, { max: 1 })
  try {
    const counts = await collectCounts(sql)
    const domains = evaluateCoverage(counts)
    console.log(`Cobertura en ${formatDevSeedTarget(target)}`)
    printCoverage(domains)
    if (options.write) {
      const out = resolve("qa/reports", `seed-dev-${new Date().toISOString().slice(0, 10)}.md`)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, `${renderCoverage(domains, formatDevSeedTarget(target))}\n`, "utf8")
      console.log(`Reporte escrito en ${out}`)
    }
    return domains
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const isEntrypoint = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntrypoint) {
  runCoverage({ write: process.argv.includes("--write") }).then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
