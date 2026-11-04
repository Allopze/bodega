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
  type SeedContext,
  type SeedResult,
} from "./shared"

export async function seedFlota(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const insertBatch = async <T>(rows: T[], run: (chunk: T[]) => Promise<number>): Promise<number> =>
    insertInBatches(rows, run)

  const vehicles = base.fuelVehicles.filter((vehicle) => vehicle.worksiteId)
  if (vehicles.length === 0) {
    return { domain: "flota", inserted: 0, skipped: 0, notes: ["No hay vehículos con faena; no se sembró flota."] }
  }

  // ── Reglas de alerta GPS ──────────────────────────────────────────────────
  const ruleCount = await countRows(sql, "fleet_gps_alert_rules")
  if (ruleCount < 3) {
    const rules: (typeof schema.fleetGpsAlertRules.$inferInsert)[] = [
      { category: "speed", alertType: "speeding", destination: "capa" },
      { category: "geofence", alertType: "geofence_exit", destination: "none" },
      { category: "idle", alertType: "idle_excess", destination: "none" },
      { category: "maintenance", alertType: "maintenance_due", destination: "none" },
    ].map((rule, index) => ({
      id: devId("gps-rule", index + 1),
      provider: "onway",
      ...rule,
      worksiteId: base.worksites[index % base.worksites.length]?.id ?? null,
      ownerUserId: actors.adminUserId,
      cooldownMinutes: 60,
      isEnabled: index < 2,
      createdAt: iso(daysAgo(today, 90)),
      updatedAt: iso(daysAgo(today, 90)),
    }))
    if (apply) {
      inserted += await insertBatch(rules, async (chunk) =>
        (await db.insert(schema.fleetGpsAlertRules).values(chunk).onConflictDoNothing().returning({ id: schema.fleetGpsAlertRules.id })).length,
      )
    } else {
      skipped += rules.length
    }
  } else {
    skipped += 4
  }

  // ── Mapeos de conductor ───────────────────────────────────────────────────
  const mappingCount = await countRows(sql, "fleet_gps_driver_mappings")
  if (mappingCount < 5 && base.workers.length > 0) {
    const mappings: (typeof schema.fleetGpsDriverMappings.$inferInsert)[] = base.workers.slice(0, 5).map((worker, index) => ({
      id: devId("gps-driver", index + 1),
      provider: "onway",
      externalDriverHash: `dev-driver-hash-${index + 1}`,
      externalDriverCiphertext: shortHash(`dev-driver-cipher-${index + 1}`),
      displayNameCiphertext: shortHash(`${worker.firstName} ${worker.lastName}`),
      workerId: worker.id,
      mappedByUserId: actors.adminUserId,
      isActive: true,
      createdAt: iso(daysAgo(today, 90)),
      updatedAt: iso(daysAgo(today, 90)),
    }))
    if (apply) {
      inserted += await insertBatch(mappings, async (chunk) =>
        (await db.insert(schema.fleetGpsDriverMappings).values(chunk).onConflictDoNothing().returning({ id: schema.fleetGpsDriverMappings.id })).length,
      )
    } else {
      skipped += mappings.length
    }
  } else {
    skipped += 5
  }

  // ── Historial de posiciones y viajes ──────────────────────────────────────
  const positionCount = await countRows(sql, "fleet_gps_position_history")
  if (positionCount < 50) {
    const positions: (typeof schema.fleetGpsPositionHistory.$inferInsert)[] = []
    for (const [vehicleIndex, vehicle] of vehicles.slice(0, 5).entries()) {
      for (let point = 0; point < 20; point++) {
        const at = daysAgo(today, point)
        positions.push({
          id: devId("gps-point", vehicleIndex * 100 + point + 1, 6),
          provider: "onway",
          externalDeviceId: `dev-device-${vehicleIndex + 1}`,
          externalPointKey: `dev-point-${vehicleIndex + 1}-${point + 1}`,
          vehicleId: vehicle.id,
          worksiteId: vehicle.worksiteId,
          driverMappingId: null,
          occurredAt: iso(at),
          latitude: -36.8 + rng() * 0.2,
          longitude: -73.1 + rng() * 0.2,
          speedKph: int(rng, 0, 90),
          headingDegrees: int(rng, 0, 359),
          ignition: point % 4 !== 0,
        })
      }
    }
    if (apply) {
      inserted += await insertBatch(positions, async (chunk) =>
        (await db.insert(schema.fleetGpsPositionHistory).values(chunk).onConflictDoNothing().returning({ id: schema.fleetGpsPositionHistory.id })).length,
      )
    } else {
      skipped += positions.length
    }
  } else {
    skipped += 100
  }

  const tripCount = await countRows(sql, "fleet_gps_trips")
  if (tripCount < 8) {
    const trips: (typeof schema.fleetGpsTrips.$inferInsert)[] = Array.from({ length: 10 }, (_, index) => {
      const vehicle = pick(rng, vehicles)
      const start = daysAgo(today, int(rng, 1, 30))
      const end = new Date(start.getTime() + int(rng, 1, 6) * 3_600_000)
      return {
        id: devId("gps-trip", index + 1),
        provider: "onway",
        externalDeviceId: `dev-device-${(index % 5) + 1}`,
        externalTripKey: `dev-trip-${index + 1}`,
        vehicleId: vehicle.id,
        worksiteId: vehicle.worksiteId,
        driverMappingId: null,
        startedAt: iso(start),
        endedAt: iso(end),
        distanceKm: int(rng, 5, 220),
        idleDuration: `PT${int(rng, 0, 2)}H`,
        movementDuration: `PT${int(rng, 1, 5)}H`,
        travelDuration: `PT${int(rng, 1, 7)}H`,
        beginOdometer: int(rng, 20_000, 150_000),
        endOdometer: int(rng, 20_000, 150_000),
        createdAt: iso(start),
        updatedAt: iso(end),
      }
    })
    if (apply) {
      inserted += await insertBatch(trips, async (chunk) =>
        (await db.insert(schema.fleetGpsTrips).values(chunk).onConflictDoNothing().returning({ id: schema.fleetGpsTrips.id })).length,
      )
    } else {
      skipped += trips.length
    }
  } else {
    skipped += 10
  }

  // ── Documentos de flota ───────────────────────────────────────────────────
  const documentCount = await countRows(sql, "fleet_vehicle_documents")
  if (documentCount < 8) {
    const types = ["Revisión técnica", "Permiso de circulación", "Seguro"] as const
    const documents: (typeof schema.fleetVehicleDocuments.$inferInsert)[] = vehicles.slice(0, 4).flatMap((vehicle, index) =>
      [types[index % types.length]!, types[(index + 1) % types.length]!].map((documentType, position) => ({
        id: devId("fleet-doc", index * 2 + position + 1),
        vehicleId: vehicle.id,
        documentType,
        fileName: `${documentType.toLowerCase().replace(/\s+/g, "-")}-${index + 1}.pdf`,
        filePath: `dev/flota/${vehicle.plate}-${position + 1}.pdf`,
        fileSize: 180_000,
        mimeType: "application/pdf",
        expiresAt: dateOnly(daysAgo(today, position === 0 ? -15 : 120)),
        status: "current",
        uploadedBy: actors.adminUserId,
        createdAt: iso(daysAgo(today, 200)),
      })),
    )
    if (apply) {
      inserted += await insertBatch(documents, async (chunk) =>
        (await db.insert(schema.fleetVehicleDocuments).values(chunk).onConflictDoNothing().returning({ id: schema.fleetVehicleDocuments.id })).length,
      )
    } else {
      skipped += documents.length
    }
  } else {
    skipped += 8
  }

  log(`  flota: ${inserted} filas insertadas, ${skipped} omitidas o planificadas`)
  return { domain: "flota", inserted, skipped, notes }
}
