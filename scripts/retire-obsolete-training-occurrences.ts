/**
 * PRV-06 (auditoría de production readiness 2026-09-28).
 *
 * Al alinear el catálogo de capacitación con la grilla del PDTP (23-09) la
 * siembra de ocurrencias no retiró las casillas que dejaron de existir: sólo
 * agrega (`onConflictDoNothing`). Quedaron ocurrencias "pendientes" que, si
 * alguien las marca hechas, acreditan una celda sin plan y cuentan cero.
 *
 * Este script las lista y, con `--apply --actor=<userId>`, elimina sólo las
 * pendientes sin evidencia. Las que tienen estado, observación o evidencia se
 * reportan y no se tocan: son historia y las decide una persona.
 *
 *   npm run prevention:retire-obsolete-training-occurrences
 *   npm run prevention:retire-obsolete-training-occurrences -- --apply --actor=<userId>
 */
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionTrainingCatalogItems,
  preventionTrainingOccurrenceEvidence,
  preventionTrainingOccurrences,
  users,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import {
  isTrainingCatalogYear,
  trainingCatalogSlotKeysForYear,
  trainingCatalogVersionForYear,
} from "@/lib/prevention/training-occurrences-catalog"

const apply = process.argv.includes("--apply")
const actor = process.argv.find((arg) => arg.startsWith("--actor="))?.slice("--actor=".length)

async function main() {
  if (apply && !actor) throw new Error("--apply exige --actor=<userId>.")
  if (apply) {
    const [row] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, actor!)).limit(1)
    if (!row) throw new Error(`No existe el usuario ${actor}.`)
  }

  const years = await db.selectDistinct({ year: preventionTrainingOccurrences.year }).from(preventionTrainingOccurrences)
  const removable: string[] = []
  const withHistory: string[] = []
  for (const { year } of years) {
    if (!isTrainingCatalogYear(year)) continue
    const valid = trainingCatalogSlotKeysForYear(year)
    const rows = await db.select({ occurrence: preventionTrainingOccurrences, code: preventionTrainingCatalogItems.code })
      .from(preventionTrainingOccurrences)
      .innerJoin(preventionTrainingCatalogItems, eq(preventionTrainingCatalogItems.id, preventionTrainingOccurrences.catalogItemId))
      .where(and(
        eq(preventionTrainingOccurrences.year, year),
        eq(preventionTrainingCatalogItems.catalogVersion, trainingCatalogVersionForYear(year)),
      ))
    const obsolete = rows.filter((row) => !valid.has(`${row.code}:${row.occurrence.slotKey}`))
    if (obsolete.length === 0) continue
    const evidence = await db.select({ occurrenceId: preventionTrainingOccurrenceEvidence.occurrenceId })
      .from(preventionTrainingOccurrenceEvidence)
      .where(inArray(preventionTrainingOccurrenceEvidence.occurrenceId, obsolete.map((row) => row.occurrence.id)))
    const withEvidence = new Set(evidence.map((row) => row.occurrenceId))
    for (const row of obsolete) {
      const label = `${row.occurrence.id} · ${row.code} ${row.occurrence.slotKey} · faena ${row.occurrence.worksiteId} · ${year} · ${row.occurrence.status}`
      const untouched = row.occurrence.status === "pending" && !withEvidence.has(row.occurrence.id) && !row.occurrence.observation
      if (untouched) removable.push(row.occurrence.id)
      else withHistory.push(label)
      console.log(`  ${untouched ? "- retirable" : "- con historia (no se toca)"}: ${label}`)
    }
  }

  console.log(`[training-occurrences] modo: ${apply ? "apply" : "dry-run"} · retirables: ${removable.length} · con historia: ${withHistory.length}`)
  if (!apply || removable.length === 0) return

  await db.transaction(async (tx) => {
    const deleted = await tx.delete(preventionTrainingOccurrences)
      .where(and(inArray(preventionTrainingOccurrences.id, removable), eq(preventionTrainingOccurrences.status, "pending")))
      .returning({ id: preventionTrainingOccurrences.id })
    await recordAudit({
      userId: actor!,
      action: "delete",
      entityType: "prevention_training_occurrence",
      entityId: "obsolete-slots",
      reason: "PRV-06: casillas de capacitación que el catálogo vigente ya no pide (pendientes, sin evidencia).",
      oldState: { ids: deleted.map((row) => row.id) },
    }, tx)
    console.log(`[training-occurrences] retiradas: ${deleted.length}`)
  })
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
