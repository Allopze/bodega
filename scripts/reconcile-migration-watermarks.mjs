/**
 * One-time repair for the future-dated 0276..0296 migration watermark incident.
 *
 * The repository journal is normalized to the UTC commit time that introduced
 * each migration. Existing databases can still carry the old values in
 * drizzle.__drizzle_migrations, so this command reconciles that metadata by
 * SQL hash. It never touches application tables and fails closed on any hash,
 * tag, or watermark discrepancy.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import postgres from "postgres"

const at = (iso) => Date.parse(iso)

export const LEGACY_FUTURE_WATERMARKS = [
  ...Array.from({ length: 15 }, (_, index) => ({
    tag: `${String(276 + index).padStart(4, "0")}_${[
      "fac001_supplier_folio_unique", "mnt002_maintenance_part_stock", "com002_meter_replacement_declared",
      "per001_permit_crew_ack_blocker", "tit001_ticket_sla_due_at", "tia002_assignment_acceptance_status",
      "cob003_manual_payment_idempotency", "auth003_sessions_valid_from", "capa002_evidence_exemption_reason",
      "pdtp003_program_all_worksites_scope", "inc001_public_incident_reports", "trz002_traceability_case_reopen",
      "cap002_per002_ack_sin_cuenta", "cot004_quotation_mime_type", "cat003_product_unit_fk",
    ][index]}`,
    legacyWhen: 1_789_600_000_000 + (index * 1_000),
    correctedWhen: at("2026-09-14T14:45:40.000Z") + index,
  })),
  { tag: "0291_training_occurrences_simplification", legacyWhen: 1_789_600_015_001, correctedWhen: at("2026-09-14T20:36:47.000Z") },
  { tag: "0292_prevention_campaigns_simplification", legacyWhen: 1_789_600_016_000, correctedWhen: at("2026-09-15T01:04:17.000Z") },
  { tag: "0293_prevention_campaigns_completed_by_user", legacyWhen: 1_789_600_017_000, correctedWhen: at("2026-09-15T01:04:17.001Z") },
  { tag: "0294_prevention_cgrd_simplification", legacyWhen: 1_789_600_018_000, correctedWhen: at("2026-09-15T02:54:20.000Z") },
  { tag: "0295_prevention_cgrd_evidence", legacyWhen: 1_789_600_019_000, correctedWhen: at("2026-09-15T02:54:20.001Z") },
  { tag: "0296_prevention_held_on_y_anulacion_acta", legacyWhen: 1_789_600_020_000, correctedWhen: at("2026-09-15T04:17:41.000Z") },
]

const asNumber = (value) => typeof value === "number" ? value : Number(value)

export function buildWatermarkReconciliation({ journal, appliedRows }) {
  const journalByTag = new Map(journal.map((entry) => [entry.tag, entry]))
  const knownByLegacy = new Map(LEGACY_FUTURE_WATERMARKS.map((entry) => [entry.legacyWhen, entry]))
  const knownByCorrected = new Map(LEGACY_FUTURE_WATERMARKS.map((entry) => [entry.correctedWhen, entry]))
  const changes = []

  for (const row of appliedRows) {
    const createdAt = asNumber(row.createdAt)
    if (knownByCorrected.has(createdAt)) continue
    const known = knownByLegacy.get(createdAt)
    if (!known) continue
    const journalEntry = journalByTag.get(known.tag)
    if (!journalEntry) throw new Error(`El journal saneado no contiene ${known.tag}.`)
    if (journalEntry.when !== known.correctedWhen) {
      throw new Error(`El journal no contiene el watermark corregido de ${known.tag}.`)
    }
    if (journalEntry.hash !== row.hash) {
      throw new Error(`El hash aplicado no coincide con ${known.tag}; se bloquea el saneamiento.`)
    }
    changes.push({ id: row.id, tag: known.tag, from: known.legacyWhen, to: known.correctedWhen })
  }
  return changes
}

function loadJournalWithHashes(root) {
  const migrationsDir = path.join(root, "db/migrations")
  const parsed = JSON.parse(readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"))
  return parsed.entries.map((entry) => ({
    ...entry,
    hash: createHash("sha256").update(readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8")).digest("hex"),
  }))
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
  const apply = process.argv.slice(2).includes("--apply")
  const root = process.cwd()
  const journal = loadJournalWithHashes(root)
  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  try {
    const rows = await sql`select id, hash, created_at::text as "createdAt" from drizzle.__drizzle_migrations order by id`
    const changes = buildWatermarkReconciliation({ journal, appliedRows: rows })
    if (apply && changes.length > 0) {
      await sql.begin(async (transaction) => {
        for (const change of changes) {
          const updated = await transaction`
            update drizzle.__drizzle_migrations
               set created_at = ${change.to}
             where id = ${change.id}
               and created_at = ${change.from}
               and hash = ${(journal.find((entry) => entry.tag === change.tag)).hash}
            returning id
          `
          if (updated.length !== 1) throw new Error(`No se pudo reconciliar ${change.tag} de forma atómica.`)
        }
      })
    }
    console.log(JSON.stringify({ ok: true, mode: apply ? "apply" : "dry-run", changes }, null, 2))
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
