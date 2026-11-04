import * as schema from "../../db/schema"
import {
  countRows,
  dateOnly,
  daysAgo,
  devId,
  insertInBatches,
  int,
  iso,
  pick,
  shortHash,
  tableExists,
  type SeedContext,
  type SeedResult,
} from "./shared"

export async function seedMantencion(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const insertBatch = async <T>(rows: T[], run: (chunk: T[]) => Promise<number>): Promise<number> =>
    insertInBatches(rows, run)

  const vehicles = base.fuelVehicles.filter((vehicle) => vehicle.worksiteId)
  if (vehicles.length === 0) {
    return { domain: "mantencion", inserted: 0, skipped: 0, notes: ["No hay vehículos; no se sembró mantención."] }
  }

  // ── Historial importado ───────────────────────────────────────────────────
  const hasHistorical = await tableExists(sql, "mant_historical_records")
  const historicalCount = hasHistorical ? await countRows(sql, "mant_historical_records") : 0
  if (hasHistorical && historicalCount < 10) {
    const rows: (typeof schema.mantHistoricalRecords.$inferInsert)[] = Array.from({ length: 12 }, (_, index) => {
      const vehicle = pick(rng, vehicles)
      const entry = daysAgo(today, int(rng, 30, 365))
      const exit = new Date(entry.getTime() + int(rng, 2, 20) * 86_400_000)
      return {
        sourceKey: `dev-historical-${index + 1}`,
        fingerprint: shortHash(`dev-historical-fingerprint-${index + 1}`),
        sourceFile: "historial-mantenimiento-demo.xlsx",
        sourceSheet: index % 2 === 0 ? "Camiones" : "Maquinaria",
        sourceRow: index + 2,
        submittedAt: iso(entry),
        worksiteText: base.worksites.find((worksite) => worksite.id === vehicle.worksiteId)?.name ?? "Faena de demostración",
        worksiteId: vehicle.worksiteId,
        equipmentText: `${vehicle.code ?? vehicle.plate} ${vehicle.brand ?? ""} ${vehicle.model ?? ""}`.trim(),
        vehicleId: vehicle.id,
        equipmentMatch: "linked",
        orderText: `OT-DEV-${String(index + 1).padStart(4, "0")}`,
        kindText: index % 3 === 0 ? "Correctiva" : "Preventiva",
        readingText: `${int(rng, 1_000, 18_000)} h`,
        description: "Trabajo histórico de demostración: cambio de filtros y revisión general.",
        entryDate: dateOnly(entry),
        exitDate: dateOnly(exit),
        hoursText: `${int(rng, 2, 24)} h`,
        fields: [],
        importedBy: actors.adminUserId,
        importedAt: iso(daysAgo(today, int(rng, 1, 20))),
      }
    })
    if (apply) {
      inserted += await insertBatch(rows, async (chunk) =>
        (await db.insert(schema.mantHistoricalRecords).values(chunk).onConflictDoNothing().returning({ sourceKey: schema.mantHistoricalRecords.sourceKey })).length,
      )
    } else {
      skipped += rows.length
    }
  } else {
    skipped += 12
    if (!hasHistorical) notes.push("La tabla mant_historical_records no existe en esta base; falta la migración.")
  }

  // ── Fotografías de registros existentes ───────────────────────────────────
  const hasPhotos = await tableExists(sql, "mant_record_photos")
  const photoCount = hasPhotos ? await countRows(sql, "mant_record_photos") : 0
  const records = await db.select({ id: schema.mantRecords.id }).from(schema.mantRecords).limit(8)
  if (hasPhotos && photoCount < 5 && records.length > 0) {
    const photos: (typeof schema.mantRecordPhotos.$inferInsert)[] = records.flatMap((record, index) => {
      const kind = pick(rng, ["filtros", "sticker", "correctiva"] as const)
      return [{
        id: devId("mant-photo", index + 1),
        recordId: record.id,
        kind,
        storageKey: `dev/mantencion/${record.id}-${index + 1}.jpg`,
        mimeType: "image/jpeg",
        sha256: shortHash(`${record.id}-${index + 1}`),
        bytes: int(rng, 80_000, 900_000),
        width: 1280,
        height: 960,
        exif: { origen: "dev-seed" },
        takenAtExif: iso(daysAgo(today, int(rng, 1, 30))),
        stampedAt: iso(daysAgo(today, int(rng, 1, 30))),
        uploadedBy: actors.adminUserId,
        deviceId: "dev-device-1",
        sortOrder: 1,
      }]
    })
    if (apply) {
      inserted += await insertBatch(photos, async (chunk) =>
        (await db.insert(schema.mantRecordPhotos).values(chunk).onConflictDoNothing().returning({ id: schema.mantRecordPhotos.id })).length,
      )
    } else {
      skipped += photos.length
    }
  } else {
    skipped += 5
    if (!hasPhotos) notes.push("La tabla mant_record_photos no existe en esta base; falta la migración.")
    else if (records.length === 0) notes.push("No hay registros de mantención existentes para adjuntar fotos.")
  }

  log(`  mantención: ${inserted} filas insertadas, ${skipped} omitidas o planificadas`)
  return { domain: "mantencion", inserted, skipped, notes }
}
