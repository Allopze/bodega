import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelAnomalyCases,
  fuelAnomalyRules,
  fuelConsumptionRecords,
  fuelEquipmentTypes,
  fuelVehicles,
} from "@/db/schema"
import { thresholdPctOf } from "@/lib/combustibles/anomaly-detector"
import {
  buildFuelVariationCandidates,
  formatFuelVariationReconciliationReport,
  reconcileLegacyVariationCases,
  type FuelVariationRecord,
  type LegacyFuelVariationCase,
} from "@/lib/combustibles/fuel-variation"
import { todayInChile } from "@/lib/utils"

export interface FuelVariationReconciliationSnapshot {
  recordCount: number
  legacyCases: LegacyFuelVariationCase[]
  legacyStatusCounts: Record<string, number>
  openQueueCounts: Record<string, number>
  unclassifiedRecords: number
  reconciliation: ReturnType<typeof reconcileLegacyVariationCases>
}

export async function readFuelVariationReconciliationSnapshot(): Promise<FuelVariationReconciliationSnapshot> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`)
    const [rule] = await tx.select({ config: fuelAnomalyRules.config })
      .from(fuelAnomalyRules)
      .where(eq(fuelAnomalyRules.code, "variacion_brusca_consumo"))
      .limit(1)
    const rows = await tx.select({
      id: fuelConsumptionRecords.id,
      vehicleId: fuelConsumptionRecords.vehicleId,
      periodoDesde: fuelConsumptionRecords.periodoDesde,
      cantidad: fuelConsumptionRecords.cantidadUnidad,
      fuente: fuelConsumptionRecords.fuente,
      worksiteId: fuelConsumptionRecords.worksiteId,
      createdAt: fuelConsumptionRecords.createdAt,
      updatedAt: fuelConsumptionRecords.updatedAt,
      equipmentTypeSlug: fuelEquipmentTypes.slug,
    })
      .from(fuelConsumptionRecords)
      .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelConsumptionRecords.vehicleId))
      .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
      .orderBy(fuelConsumptionRecords.vehicleId, fuelConsumptionRecords.periodoDesde, fuelConsumptionRecords.id)
    const records: FuelVariationRecord[] = rows
      .filter((row): row is typeof row & { vehicleId: string } => Boolean(row.vehicleId))
      .map((row) => ({ ...row, vehicleId: row.vehicleId, cantidad: Number(row.cantidad), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) }))
    const legacyCases: LegacyFuelVariationCase[] = await tx.select({
      vehicleId: fuelAnomalyCases.vehicleId,
      referenceEntityId: fuelAnomalyCases.referenceEntityId,
      observedValue: fuelAnomalyCases.observedValue,
      status: fuelAnomalyCases.status,
    })
      .from(fuelAnomalyCases)
      .where(and(
        eq(fuelAnomalyCases.ruleCode, "variacion_brusca_consumo"),
        eq(fuelAnomalyCases.referenceEntityType, "fuel_consumption_record"),
      ))
      .then((cases) => cases.filter((row) => /^([^:]+):\d{4}-\d{2}-\d{2}$/.test(row.referenceEntityId ?? "")))

    const thresholdFor = (equipmentTypeSlug: string | null) => thresholdPctOf({ config: rule?.config ?? null }, 50, equipmentTypeSlug ?? undefined)
    const { unclassifiedRecords } = buildFuelVariationCandidates(records, thresholdFor)
    const legacyStatusCounts: Record<string, number> = {}
    for (const legacyCase of legacyCases) legacyStatusCounts[legacyCase.status ?? "unknown"] = (legacyStatusCounts[legacyCase.status ?? "unknown"] ?? 0) + 1
    const openQueueRows = await tx.select({ ruleCode: fuelAnomalyCases.ruleCode })
      .from(fuelAnomalyCases)
      .where(inArray(fuelAnomalyCases.status, ["open", "in_review", "reopened"]))
    const openQueueCounts: Record<string, number> = {}
    for (const row of openQueueRows) openQueueCounts[row.ruleCode] = (openQueueCounts[row.ruleCode] ?? 0) + 1
    return {
      recordCount: records.length,
      legacyCases,
      legacyStatusCounts,
      openQueueCounts,
      unclassifiedRecords,
      reconciliation: reconcileLegacyVariationCases(legacyCases, records, thresholdFor),
    }
  })
}

async function main() {
  const snapshot = await readFuelVariationReconciliationSnapshot()
  const report = formatFuelVariationReconciliationReport({
    generatedAt: new Date().toISOString(),
    recordCount: snapshot.recordCount,
    legacyCaseCount: snapshot.legacyCases.length,
    legacyStatusCounts: snapshot.legacyStatusCounts,
    openQueueCounts: snapshot.openQueueCounts,
    unclassifiedRecords: snapshot.unclassifiedRecords,
    reconciliation: snapshot.reconciliation,
  })
  const reportPath = resolve(dirname(fileURLToPath(import.meta.url)), "../qa/reports", `fuel-variation-reconciliation-${todayInChile()}.md`)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, report, "utf8")
  console.log(`Informe agregado de solo lectura: ${reportPath}`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    () => {
      console.error("No se pudo generar el informe de conciliación de combustible.")
      process.exit(1)
    },
  )
}
