import * as schema from "../../db/schema"
import {
  chance,
  countRows,
  dateOnly,
  daysAgo,
  devId,
  insertInBatches,
  int,
  iso,
  monthOnly,
  pick,
  shortHash,
  type SeedContext,
  type SeedResult,
} from "./shared"

const MONTHS = 6
const LOADS = 210

export async function seedCombustibles(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const vehicles = base.fuelVehicles.filter((vehicle) => vehicle.worksiteId)
  const suppliers = base.fuelSuppliers
  const products = base.fuelProducts
  if (vehicles.length === 0 || suppliers.length === 0 || products.length === 0) {
    return { domain: "combustibles", inserted: 0, skipped: 0, notes: ["Faltan vehículos, proveedores o productos de combustible; no se sembró."] }
  }

  const insertBatch = async <T>(
    rows: T[],
    run: (chunk: T[]) => Promise<number>,
  ): Promise<number> => insertInBatches(rows, run)

  // ── Cargas y cuenta corriente ─────────────────────────────────────────────
  const loadCount = await countRows(sql, "fuel_loads")
  if (loadCount >= 150) {
    skipped += LOADS
    notes.push(`fuel_loads ya tiene ${loadCount} filas; se omite.`)
  } else {
    const loads: (typeof schema.fuelLoads.$inferInsert)[] = []
    for (let index = 0; index < LOADS; index++) {
      const vehicle = pick(rng, vehicles)
      const product = pick(rng, products)
      const supplier = pick(rng, suppliers)
      const at = daysAgo(today, int(rng, 0, MONTHS * 30))
      const liters = int(rng, 40, 320)
      const price = int(rng, 950, 1250)
      const baseAmount = liters * price
      const iecFixed = Math.round(liters * 104.67)
      const iecVariable = Math.round(liters * 82.07)
      const iecTotal = iecFixed + iecVariable
      const ivaAmount = Math.round((baseAmount + iecTotal) * 0.19)
      const usesHourMeter = vehicle.performanceUnit === "liters_per_hour"
      loads.push({
        id: devId("fuel-load", index + 1),
        loadDate: dateOnly(at),
        month: monthOnly(at),
        serviceType: chance(rng, 0.25) ? "TAE" : "TCT",
        vehicleId: vehicle.id,
        fuelSupplierId: supplier.id,
        worksiteId: vehicle.worksiteId!,
        product: product.name,
        productId: product.id,
        receiptNumber: `DEV-${String(index + 1).padStart(5, "0")}`,
        odometerReading: usesHourMeter ? null : int(rng, 20_000, 180_000),
        hourMeterReading: usesHourMeter ? int(rng, 1_000, 18_000) : null,
        liters,
        iecFixed,
        iecVariable,
        baseAmount,
        iecTotal,
        ivaAmount,
        totalAmount: baseAmount + iecTotal + ivaAmount,
        status: "registered",
        createdBy: actors.adminUserId,
        createdAt: iso(at),
        updatedAt: iso(at),
      })
    }

    if (apply) {
      inserted += await insertBatch(loads, async (chunk) =>
        (await db.insert(schema.fuelLoads).values(chunk).onConflictDoNothing().returning({ id: schema.fuelLoads.id })).length,
      )
    } else {
      skipped += loads.length
    }
    log(`  combustible: ${loads.length} cargas ${apply ? "insertadas" : "planificadas"}`)
  }

  // ── Estados mensuales y pagos ─────────────────────────────────────────────
  const statements: (typeof schema.fuelMonthlyStatements.$inferInsert)[] = []
  const statementIdByMonth = new Map<string, string>()
  for (let offset = MONTHS - 1; offset >= 0; offset--) {
    const monthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1))
    const month = monthOnly(monthDate)
    const supplier = suppliers[offset % suppliers.length]!
    const statementId = devId("fuel-stmt", MONTHS - offset)
    statementIdByMonth.set(month, statementId)
    const liters = int(rng, 4_000, 9_000)
    const baseAmount = liters * 1_080
    const iec = Math.round(liters * 186.74)
    const iva = Math.round((baseAmount + iec) * 0.19)
    const total = baseAmount + iec + iva
    const status = offset > 1 ? "paid" : "partial"
    statements.push({
      id: statementId,
      month,
      fuelSupplierId: supplier.id,
      totalLiters: liters,
      totalBaseAmount: baseAmount,
      totalIec: iec,
      totalIva: iva,
      totalAmount: total,
      paidAmount: status === "paid" ? total : status === "partial" ? Math.round(total * 0.45) : 0,
      dueDate: dateOnly(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 15))),
      status,
      notes: "Estado de demostración del entorno de desarrollo.",
      createdBy: actors.adminUserId,
      createdAt: iso(monthDate),
      updatedAt: iso(monthDate),
    })
  }

  const statementCount = await countRows(sql, "fuel_monthly_statements")
  if (statementCount < MONTHS) {
    if (apply) {
      inserted += await insertBatch(statements, async (chunk) =>
        (await db.insert(schema.fuelMonthlyStatements).values(chunk).onConflictDoNothing().returning({ id: schema.fuelMonthlyStatements.id })).length,
      )
    } else {
      skipped += statements.length
    }
  } else {
    skipped += statements.length
    notes.push(`fuel_monthly_statements ya tiene ${statementCount} filas; se omite.`)
  }

  const payments: (typeof schema.fuelPayments.$inferInsert)[] = statements
    .filter((statement) => statement.status === "paid" || statement.status === "partial")
    .map((statement, index) => ({
      id: devId("fuel-payment", index + 1),
      statementId: statement.id!,
      paymentDate: dateOnly(daysAgo(today, int(rng, 1, 20))),
      amount: Number(statement.paidAmount ?? 0),
      paymentMethod: "transferencia",
      reference: `DEV-PAGO-${String(index + 1).padStart(3, "0")}`,
      notes: "Pago de demostración.",
      createdBy: actors.adminUserId,
      createdAt: iso(daysAgo(today, int(rng, 1, 20))),
    }))

  const paymentCount = await countRows(sql, "fuel_payments")
  if (paymentCount < 6) {
    if (apply) {
      inserted += await insertBatch(payments, async (chunk) =>
        (await db.insert(schema.fuelPayments).values(chunk).onConflictDoNothing().returning({ id: schema.fuelPayments.id })).length,
      )
    } else {
      skipped += payments.length
    }
  } else {
    skipped += payments.length
  }

  // ── TAE: lotes, puntos, envíos, evidencia y sellos ────────────────────────
  const taeBatches: (typeof schema.fuelTaeImportBatches.$inferInsert)[] = [1, 2].map((index): typeof schema.fuelTaeImportBatches.$inferInsert => ({
    id: devId("fuel-tae-batch", index),
    fileName: `dev-tae-${index}.xlsx`,
    filePath: `dev/fuel-tae/dev-tae-${index}.xlsx`,
    fileHash: shortHash(`dev-tae-batch-${index}`),
    status: "imported",
    totalRows: 30,
    validRows: 27,
    observedRows: 2,
    invalidRows: 1,
    totalLiters: 7_500,
    importedBy: actors.adminUserId,
    notes: "Lote de demostración.",
    createdAt: iso(daysAgo(today, 30 * index)),
    updatedAt: iso(daysAgo(today, 30 * index)),
  }))

  const existingTaeBatches = await db.select().from(schema.fuelTaeImportBatches).limit(5)
  let usableTaeBatches: { id: string }[] = existingTaeBatches
  if (existingTaeBatches.length < 2) {
    if (apply) {
      inserted += await insertBatch(taeBatches, async (chunk) =>
        (await db.insert(schema.fuelTaeImportBatches).values(chunk).onConflictDoNothing().returning({ id: schema.fuelTaeImportBatches.id })).length,
      )
      usableTaeBatches = taeBatches
    } else {
      skipped += taeBatches.length
      usableTaeBatches = taeBatches
    }
  } else {
    skipped += taeBatches.length
  }

  const existingPoints = await db.select().from(schema.fuelTaeLoadingPoints).limit(10)
  const points: (typeof schema.fuelTaeLoadingPoints.$inferInsert)[] = existingPoints.length > 0
    ? []
    : base.worksites.slice(0, 2).map((worksite, index) => ({
        id: devId("fuel-tae-point", index + 1),
        worksiteId: worksite.id,
        name: `Punto TAE ${worksite.name}`,
        type: "fixed_dispenser",
        importAliases: [],
        isActive: true,
        createdAt: iso(daysAgo(today, 120)),
        updatedAt: iso(daysAgo(today, 120)),
      }))
  if (apply && points.length > 0) {
    inserted += await insertBatch(points, async (chunk) =>
      (await db.insert(schema.fuelTaeLoadingPoints).values(chunk).onConflictDoNothing().returning({ id: schema.fuelTaeLoadingPoints.id })).length,
    )
  } else if (points.length > 0) {
    skipped += points.length
  }
  const allPoints = existingPoints.length > 0 ? existingPoints : points

  const media = await db.select().from(schema.fuelSupplyMedia).limit(10)
  const submissions: (typeof schema.fuelTaeSubmissions.$inferInsert)[] = []
  for (let index = 0; index < 20; index++) {
    const vehicle = pick(rng, vehicles)
    const worker = pick(rng, base.workers)
    const at = daysAgo(today, int(rng, 0, 120))
    const usesHourMeter = vehicle.performanceUnit === "liters_per_hour"
    const status = index < 14 ? "validated" : index < 18 ? "submitted" : "observed"
    submissions.push({
      id: devId("fuel-tae", index + 1),
      clientSubmissionId: `dev-tae-client-${index + 1}`,
      importBatchId: index < 8 && usableTaeBatches.length > 0
        ? usableTaeBatches[index % usableTaeBatches.length]!.id
        : null,
      source: "internal_app",
      publicResultToken: `dev-tae-result-${index + 1}`,
      worksiteId: vehicle.worksiteId!,
      loadingPointId: allPoints.length > 0 ? pick(rng, allPoints).id : null,
      vehicleId: vehicle.id,
      productId: pick(rng, products).id,
      equipmentCodeSnapshot: vehicle.code ?? vehicle.plate,
      plateSnapshot: vehicle.plate,
      loadedAt: iso(at),
      submittedAt: iso(at),
      driverWorkerId: worker?.id ?? null,
      driverNameSnapshot: worker ? `${worker.firstName} ${worker.lastName}` : "Operador de demostración",
      supervisorWorkerId: null,
      supervisorNameSnapshot: "Supervisor de demostración",
      manualIdentity: true,
      meterType: usesHourMeter ? "hour_meter" : "odometer",
      meterReading: usesHourMeter ? int(rng, 1_000, 18_000) : int(rng, 20_000, 180_000),
      meterReadingSource: "manual",
      liters: int(rng, 40, 260),
      removedSealNumber: `SELLO-DEV-${index + 1}-A`,
      installedSealNumber: `SELLO-DEV-${index + 1}-B`,
      status,
      supplyMediumId: media.length > 0 ? pick(rng, media).id : null,
      loadedAtSource: "device",
      registeredBy: actors.adminUserId,
      sealChainStatus: status === "observed" ? "mismatch" : "ok",
      createdAt: iso(at),
      updatedAt: iso(at),
    })
  }

  const submissionCount = await countRows(sql, "fuel_tae_submissions")
  if (submissionCount < 20) {
    if (apply) {
      inserted += await insertBatch(submissions, async (chunk) =>
        (await db.insert(schema.fuelTaeSubmissions).values(chunk).onConflictDoNothing().returning({ id: schema.fuelTaeSubmissions.id })).length,
      )
    } else {
      skipped += submissions.length
    }
  } else {
    skipped += submissions.length
    notes.push(`fuel_tae_submissions ya tiene ${submissionCount} filas; se omite.`)
  }

  const usableSubmissions = submissionCount < 20
    ? submissions
    : await db.select().from(schema.fuelTaeSubmissions).limit(40)
  const submissionRefs = usableSubmissions.map((submission) => ({
    id: String(submission.id),
    loadedAt: String(submission.loadedAt),
    worksiteId: String(submission.worksiteId),
    vehicleId: submission.vehicleId ?? null,
    liters: Number(submission.liters),
    meterType: submission.meterType ?? "odometer",
    meterReading: submission.meterReading ?? null,
    driverWorkerId: submission.driverWorkerId ?? null,
    driverName: submission.driverNameSnapshot ?? "Operador de demostración",
    supervisorWorkerId: submission.supervisorWorkerId ?? null,
    supervisorName: submission.supervisorNameSnapshot ?? "Supervisor de demostración",
    createdAt: String(submission.createdAt ?? submission.loadedAt),
    updatedAt: String(submission.updatedAt ?? submission.loadedAt),
  }))

  const evidence: (typeof schema.fuelTaeEvidence.$inferInsert)[] = submissionRefs.slice(0, 4).map((submission, index) => ({
    id: devId("fuel-tae-evidence", index + 1),
    submissionId: submission.id,
    kind: "odometer",
    fileName: `odometro-${index + 1}.jpg`,
    filePath: `dev/fuel-tae/odometro-${index + 1}.jpg`,
    fileSize: 48_000,
    mimeType: "image/jpeg",
    sha256: shortHash(`odometro-${index + 1}`),
    capturedAt: submission.loadedAt,
  }))
  const evidenceCount = await countRows(sql, "fuel_tae_evidence")
  if (evidenceCount < 4) {
    if (apply) {
      inserted += await insertBatch(evidence, async (chunk) =>
        (await db.insert(schema.fuelTaeEvidence).values(chunk).onConflictDoNothing().returning({ id: schema.fuelTaeEvidence.id })).length,
      )
    } else {
      skipped += evidence.length
    }
  } else {
    skipped += evidence.length
  }

  const rejections: (typeof schema.fuelTaeImportRejections.$inferInsert)[] = taeBatches.flatMap((batch, batchIndex) =>
    [1, 2, 3].map((rowIndex) => ({
      id: devId("fuel-tae-rejection", batchIndex * 3 + rowIndex),
      batchId: batch.id!,
      rowIndex,
      stage: "parse",
      field: "litros",
      message: "Litros vacíos o no numéricos en la fila de demostración.",
      legacySourceId: `dev-legacy-${batchIndex}-${rowIndex}`,
      rawRow: { fila: rowIndex, motivo: "dato de demostración" },
      createdAt: iso(daysAgo(today, 20)),
    })),
  )
  const rejectionCount = await countRows(sql, "fuel_tae_import_rejections")
  if (rejectionCount < 3) {
    if (apply) {
      inserted += await insertBatch(rejections, async (chunk) =>
        (await db.insert(schema.fuelTaeImportRejections).values(chunk).onConflictDoNothing().returning({ id: schema.fuelTaeImportRejections.id })).length,
      )
    } else {
      skipped += rejections.length
    }
  } else {
    skipped += rejections.length
  }

  const seals: (typeof schema.fuelSealMovements.$inferInsert)[] = submissionRefs.flatMap((submission, index) => [
    {
      id: devId("fuel-seal-removed", index + 1),
      submissionId: submission.id,
      sealNumber: `SELLO-DEV-${index + 1}-A`,
      movementType: "removed",
      changedBy: actors.adminUserId,
      justification: "Retiro de sello para carga de demostración.",
    },
    {
      id: devId("fuel-seal-installed", index + 1),
      submissionId: submission.id,
      sealNumber: `SELLO-DEV-${index + 1}-B`,
      movementType: "installed",
      changedBy: actors.adminUserId,
      justification: "Instalación de sello tras carga de demostración.",
    },
  ])
  const sealCount = await countRows(sql, "fuel_seal_movements")
  if (sealCount < 20) {
    if (apply) {
      inserted += await insertBatch(seals, async (chunk) =>
        (await db.insert(schema.fuelSealMovements).values(chunk).onConflictDoNothing().returning({ id: schema.fuelSealMovements.id })).length,
      )
    } else {
      skipped += seals.length
    }
  } else {
    skipped += seals.length
  }

  // ── Ciclo, mandantes y medios ─────────────────────────────────────────────
  const locations: (typeof schema.fuelStorageLocations.$inferInsert)[] = base.worksites.slice(0, 3).map((worksite, index) => ({
    id: devId("fuel-location", index + 1),
    worksiteId: worksite.id,
    productId: products[index % products.length]!.id,
    name: `Estanque de demostración ${index + 1}`,
    capacityLiters: int(rng, 5_000, 20_000),
    taeCardNumber: `DEV-TAE-${index + 1}`,
    isActive: true,
    createdAt: iso(daysAgo(today, 180)),
    updatedAt: iso(daysAgo(today, 180)),
  }))
  const locationCount = await countRows(sql, "fuel_storage_locations")
  if (locationCount < 2) {
    if (apply) {
      inserted += await insertBatch(locations, async (chunk) =>
        (await db.insert(schema.fuelStorageLocations).values(chunk).onConflictDoNothing().returning({ id: schema.fuelStorageLocations.id })).length,
      )
    } else {
      skipped += locations.length
    }
  } else {
    skipped += locations.length
  }
  const allLocations = locationCount < 2 ? locations : await db.select().from(schema.fuelStorageLocations).limit(10)

  const cycle: (typeof schema.fuelCycleMovements.$inferInsert)[] = []
  for (let index = 0; index < 30; index++) {
    const at = daysAgo(today, int(rng, 0, 90))
    const worksite = pick(rng, base.worksites)
    const product = pick(rng, products)
    const type = pick(rng, ["received", "transfer", "tank_delivery", "direct_delivery"] as const)
    const vehicle = pick(rng, vehicles)
    const locationIndex = allLocations.length > 0 ? int(rng, 0, allLocations.length - 1) : -1
    const location = locationIndex >= 0 ? allLocations[locationIndex]! : null
    const secondLocation = allLocations.length > 1
      ? allLocations[(locationIndex + 1 + int(rng, 0, allLocations.length - 2)) % allLocations.length]!
      : null
    cycle.push({
      id: devId("fuel-cycle", index + 1),
      eventType: type,
      worksiteId: worksite.id,
      productId: product.id,
      quantity: int(rng, 100, 1_500),
      occurredAt: iso(at),
      supplierId: type === "received" || type === "direct_delivery" ? pick(rng, suppliers).id : null,
      sourceLocationId: type === "transfer" || type === "tank_delivery" ? location?.id ?? null : null,
      targetLocationId: type === "received" || type === "transfer" ? (type === "transfer" ? secondLocation?.id ?? null : location?.id ?? null) : null,
      vehicleId: type === "tank_delivery" || type === "direct_delivery" ? vehicle.id : null,
      documentNumber: `DEV-GUIA-${index + 1}`,
      sourceType: "dev-seed",
      sourceId: `fuel-cycle-${index + 1}`,
      notes: "Movimiento de demostración.",
      createdBy: actors.adminUserId,
      createdAt: iso(at),
    })
  }
  const cycleCount = await countRows(sql, "fuel_cycle_movements")
  if (cycleCount < 20) {
    if (apply) {
      inserted += await insertBatch(cycle, async (chunk) =>
        (await db.insert(schema.fuelCycleMovements).values(chunk).onConflictDoNothing().returning({ id: schema.fuelCycleMovements.id })).length,
      )
    } else {
      skipped += cycle.length
    }
  } else {
    skipped += cycle.length
  }

  const mandantes: (typeof schema.fuelMandantes.$inferInsert)[] = [1, 2, 3].map((index): typeof schema.fuelMandantes.$inferInsert => ({
    id: devId("fuel-mandante", index),
    name: `Mandante de demostración ${index}`,
    tolerancePct: 2,
    isActive: true,
    createdAt: iso(daysAgo(today, 180)),
    updatedAt: iso(daysAgo(today, 180)),
  }))
  const existingMandantes = await db.select().from(schema.fuelMandantes).limit(10)
  let usableMandantes: { id: string }[] = existingMandantes
  if (existingMandantes.length < 3) {
    if (apply) {
      inserted += await insertBatch(mandantes, async (chunk) =>
        (await db.insert(schema.fuelMandantes).values(chunk).onConflictDoNothing().returning({ id: schema.fuelMandantes.id })).length,
      )
      usableMandantes = mandantes
    } else {
      skipped += mandantes.length
      usableMandantes = mandantes
    }
  } else {
    skipped += mandantes.length
  }

  const mandanteWorksites: (typeof schema.fuelMandanteWorksites.$inferInsert)[] = base.worksites.slice(0, 3).map((worksite, index) => ({
    worksiteId: worksite.id,
    mandanteId: usableMandantes[index % usableMandantes.length]!.id,
  }))
  const mandanteWorksiteCount = await countRows(sql, "fuel_mandante_worksites")
  if (mandanteWorksiteCount < 3) {
    if (apply) {
      inserted += await insertBatch(mandanteWorksites, async (chunk) =>
        (await db.insert(schema.fuelMandanteWorksites).values(chunk).onConflictDoNothing().returning()).length,
      )
    } else {
      skipped += mandanteWorksites.length
    }
  } else {
    skipped += mandanteWorksites.length
  }

  const mediaRows: (typeof schema.fuelSupplyMedia.$inferInsert)[] = [1, 2].map((index) => ({
    id: devId("fuel-media", index),
    slug: `dev-media-${index}`,
    name: `Medio de suministro de demostración ${index}`,
    kind: "card",
    fuelSupplierId: suppliers[index % suppliers.length]!.id,
    aliases: [`MEDIO DEV ${index}`],
    sortOrder: 100 + index,
    isActive: true,
    createdAt: iso(daysAgo(today, 180)),
    updatedAt: iso(daysAgo(today, 180)),
  }))
  const mediaCount = await countRows(sql, "fuel_supply_media")
  if (mediaCount < 6) {
    if (apply) {
      inserted += await insertBatch(mediaRows, async (chunk) =>
        (await db.insert(schema.fuelSupplyMedia).values(chunk).onConflictDoNothing().returning({ id: schema.fuelSupplyMedia.id })).length,
      )
    } else {
      skipped += mediaRows.length
    }
  } else {
    skipped += mediaRows.length
  }

  // ── Log operacional y telemetría ──────────────────────────────────────────
  const operationBatches: (typeof schema.fuelOperationBatches.$inferInsert)[] = [1, 2].map((index): typeof schema.fuelOperationBatches.$inferInsert => ({
    id: devId("fuel-op-batch", index),
    archivoNombre: `dev-operaciones-${index}.xlsx`,
    archivoPath: `dev/fuel-operations/dev-operaciones-${index}.xlsx`,
    hashArchivo: shortHash(`dev-operaciones-${index}`),
    estado: "importado",
    periodoDesde: dateOnly(daysAgo(today, 60)),
    periodoHasta: dateOnly(daysAgo(today, 1)),
    totalFilas: 30,
    filasValidas: 29,
    filasInvalidas: 1,
    totalEquipos: vehicles.length,
    totalLitros: 6_500,
    totalMonto: 7_800_000,
    importadoPor: actors.adminUserId,
    notas: "Lote de demostración.",
    createdAt: iso(daysAgo(today, 10)),
    updatedAt: iso(daysAgo(today, 10)),
  }))
  const existingOperationBatches = await db.select().from(schema.fuelOperationBatches).limit(5)
  let usableOperationBatches: { id: string }[] = existingOperationBatches
  if (existingOperationBatches.length < 2) {
    if (apply) {
      inserted += await insertBatch(operationBatches, async (chunk) =>
        (await db.insert(schema.fuelOperationBatches).values(chunk).onConflictDoNothing().returning({ id: schema.fuelOperationBatches.id })).length,
      )
      usableOperationBatches = operationBatches
    } else {
      skipped += operationBatches.length
      usableOperationBatches = operationBatches
    }
  } else {
    skipped += operationBatches.length
  }

  const operationRecords: (typeof schema.fuelOperationRecords.$inferInsert)[] = Array.from({ length: 30 }, (_, index) => {
    const vehicle = pick(rng, vehicles)
    const at = daysAgo(today, int(rng, 0, 60))
    return {
      id: devId("fuel-op-record", index + 1),
      batchId: usableOperationBatches[index % usableOperationBatches.length]!.id,
      worksiteId: vehicle.worksiteId,
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      code: vehicle.code,
      faenaNombre: base.worksites.find((worksite) => worksite.id === vehicle.worksiteId)?.name ?? null,
      tipo: vehicle.type,
      marca: vehicle.brand,
      modelo: vehicle.model,
      anio: vehicle.year,
      fecha: dateOnly(at),
      horaCarga: `${String(int(rng, 6, 18)).padStart(2, "0")}:${String(int(rng, 0, 59)).padStart(2, "0")}`,
      horometro: int(rng, 1_000, 18_000),
      medidoPor: vehicle.performanceUnit === "liters_per_hour" ? "hora" : "km",
      liters: int(rng, 40, 260),
      operador: "Operador de demostración",
      supervisor: "Supervisor de demostración",
      proveedorNombre: suppliers[index % suppliers.length]!.name,
      fuelSupplierId: suppliers[index % suppliers.length]!.id,
      precioLitro: int(rng, 950, 1_250),
      monto: int(rng, 80_000, 350_000),
      rendimiento: null,
      tipoRendimiento: vehicle.performanceUnit === "liters_per_hour" ? "lt_hr" : "km_lt",
      rawRow: { origen: "dev-seed" },
    }
  })
  const operationRecordCount = await countRows(sql, "fuel_operation_records")
  if (operationRecordCount < 20) {
    if (apply) {
      inserted += await insertBatch(operationRecords, async (chunk) =>
        (await db.insert(schema.fuelOperationRecords).values(chunk).onConflictDoNothing().returning({ id: schema.fuelOperationRecords.id })).length,
      )
    } else {
      skipped += operationRecords.length
    }
  } else {
    skipped += operationRecords.length
  }

  const telemetry: (typeof schema.fuelTelemetryDaily.$inferInsert)[] = []
  for (const vehicle of vehicles.slice(0, 6)) {
    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const at = daysAgo(today, dayOffset)
      const operatingHours = int(rng, 4, 12)
      telemetry.push({
        id: devId("fuel-telemetry", telemetry.length + 1, 6),
        vehicleId: vehicle.id,
        source: "visionlink",
        day: dateOnly(at),
        month: monthOnly(at),
        operatingHours,
        idleHours: int(rng, 0, Math.min(2, operatingHours)),
        litersWorking: operatingHours * int(rng, 12, 28),
        litersIdle: int(rng, 0, 40),
        createdAt: iso(at),
        updatedAt: iso(at),
      })
    }
  }
  const telemetryCount = await countRows(sql, "fuel_telemetry_daily")
  if (telemetryCount < 60) {
    if (apply) {
      inserted += await insertBatch(telemetry, async (chunk) =>
        (await db.insert(schema.fuelTelemetryDaily).values(chunk).onConflictDoNothing().returning({ id: schema.fuelTelemetryDaily.id })).length,
      )
    } else {
      skipped += telemetry.length
    }
  } else {
    skipped += telemetry.length
  }

  // ── Serie canónica de cargas por equipo y anomalías ───────────────────────
  const equipmentLoads: (typeof schema.fuelEquipmentLoads.$inferInsert)[] = submissionRefs.slice(0, 40).map((submission, index) => ({
    id: devId("fuel-eq-load", index + 1),
    source: "legacy_tae",
    taeSubmissionId: submission.id,
    vehicleId: submission.vehicleId,
    worksiteId: submission.worksiteId,
    occurredAt: submission.loadedAt,
    month: submission.loadedAt.slice(0, 7),
    liters: submission.liters,
    meterType: submission.meterType,
    meterReading: submission.meterReading,
    driverWorkerId: submission.driverWorkerId,
    driverName: submission.driverName,
    supervisorWorkerId: submission.supervisorWorkerId,
    supervisorName: submission.supervisorName,
    performanceStatus: "first_load",
    reviewStatus: "ok",
    flagReasons: [],
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  }))
  const equipmentLoadCount = await countRows(sql, "fuel_equipment_loads")
  if (equipmentLoadCount < 40) {
    if (apply) {
      inserted += await insertBatch(equipmentLoads, async (chunk) =>
        (await db.insert(schema.fuelEquipmentLoads).values(chunk).onConflictDoNothing().returning({ id: schema.fuelEquipmentLoads.id })).length,
      )
    } else {
      skipped += equipmentLoads.length
    }
  } else {
    skipped += equipmentLoads.length
  }

  const rules = await db.select().from(schema.fuelAnomalyRules).limit(10)
  if (rules.length > 0) {
    const executions: (typeof schema.fuelAnomalyExecutions.$inferInsert)[] = rules.slice(0, 5).map((rule, index) => ({
      id: devId("fuel-anomaly-exec", index + 1),
      ruleId: rule.id,
      startedAt: iso(daysAgo(today, index + 1)),
      completedAt: iso(daysAgo(today, index + 1)),
      casesCreated: int(rng, 0, 4),
      casesSkipped: int(rng, 0, 2),
      totalScanned: int(rng, 10, 80),
      status: "completed",
    }))
    const executionCount = await countRows(sql, "fuel_anomaly_executions")
    if (executionCount < 3) {
      if (apply) {
        inserted += await insertBatch(executions, async (chunk) =>
          (await db.insert(schema.fuelAnomalyExecutions).values(chunk).onConflictDoNothing().returning({ id: schema.fuelAnomalyExecutions.id })).length,
        )
      } else {
        skipped += executions.length
      }
    } else {
      skipped += executions.length
    }
  }

  const cases = await db.select().from(schema.fuelAnomalyCases).limit(10)
  if (cases.length > 0) {
    const comments: (typeof schema.fuelAnomalyComments.$inferInsert)[] = cases.map((anomalyCase, index) => ({
      id: devId("fuel-anomaly-comment", index + 1),
      caseId: anomalyCase.id,
      userId: actors.adminUserId,
      body: "Comentario de demostración: se revisó la carga y se solicitó antecedente al operador.",
      createdAt: iso(daysAgo(today, index + 1)),
    }))
    const commentCount = await countRows(sql, "fuel_anomaly_comments")
    if (commentCount < 5) {
      if (apply) {
        inserted += await insertBatch(comments, async (chunk) =>
          (await db.insert(schema.fuelAnomalyComments).values(chunk).onConflictDoNothing().returning({ id: schema.fuelAnomalyComments.id })).length,
        )
      } else {
        skipped += comments.length
      }
    } else {
      skipped += comments.length
    }
  } else {
    notes.push("No hay casos de anomalía existentes para comentar.")
  }

  return { domain: "combustibles", inserted, skipped, notes }
}
