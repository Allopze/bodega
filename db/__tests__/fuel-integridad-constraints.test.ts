/**
 * E · Auditoría de combustibles 2026-11-05 (`qa/reports/2026-11-05-auditoria-combustibles-codigo.md`).
 *
 * Prueba contra PGlite migrado —no contra el schema en memoria— las claves e
 * integridad que agregaron las migraciones 0372 y 0373:
 *
 * - E1 `fuel_supply_inputs`: único por despacho `(medio, folio, faena, mes)`
 *   (2.2: el upsert movía la fila de una faena a otra).
 * - E2 `fuel_operation_records`: único por identidad natural con `coalesce`
 *   (2.3: un mensual y un consolidado duplicaban las mismas cargas).
 * - E3 `fuel_reconciliation_links`: único parcial de los vínculos abiertos
 *   (2.5: con destinos NULL el único de targets no impedía duplicados).
 * - E4 `fuel_seal_movements`: `submission_id` opcional, FK `ON DELETE SET NULL`
 *   y columnas de retractación (2.4/2.6: revertir un lote borraba el historial
 *   de sellos, incluido `evidence_sha256`).
 * - E5 `fuel_cycle_movements`: `source_plate`/`source_product` y único parcial
 *   de Copec TAE (2.9: el proveedor reutiliza la guía entre vehículos).
 * - E6 `fuel_provider_period_coverage`: estado `closed_with_issues` (4.1: un mes
 *   con filas inválidas no podía cerrarse nunca).
 * - E7 `fuel_loads.statement_id` con FK, único `(mes, proveedor)` de cuentas
 *   corrientes e índices de FK faltantes.
 */
import path from "node:path"
import { eq } from "drizzle-orm"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema })

const ACTOR = "e-auditor"
const WORKSITE_A = "e-faena-a"
const WORKSITE_B = "e-faena-b"
const PRODUCT = "e-producto"
const SUPPLIER = "e-proveedor"
const EQUIPMENT_TYPE = "e-tipo-equipo"
const VEHICLE = "e-equipo"
const MEDIUM = "e-medio"
const OPERATION_BATCH = "e-lote-operaciones"
const SYNC_RUN = "e-corrida-copec"

/**
 * El error de Drizzle trae el SQL; el nombre del índice/constraint viaja en la
 * causa que levanta Postgres. Sin mirarla, la prueba pasaría con cualquier
 * fallo de inserción y no probaría qué restricción actuó.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ?? error) as { constraint?: string; message?: string }
    return `${cause.constraint ?? ""} ${cause.message ?? ""}`
  }
  throw new Error("La base aceptó una fila que debía rechazar")
}

async function indexDefinition(name: string): Promise<string> {
  const { rows } = await pg.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where indexname = $1",
    [name],
  )
  return rows[0]?.indexdef ?? ""
}

function supplyInput(id: string, worksiteId: string, month: string, extra: Record<string, unknown> = {}) {
  return {
    id, supplyMediumId: MEDIUM, worksiteId, reference: "1", month,
    occurredAt: "2026-03-12T12:00:00.000Z", liters: 5_000, ...extra,
  } as typeof schema.fuelSupplyInputs.$inferInsert
}

function operationRecord(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, batchId: OPERATION_BATCH, worksiteId: WORKSITE_A, plate: "KA-1", fecha: "2026-03-12",
    horaCarga: null, horometro: null, liters: 100, ...extra,
  } as typeof schema.fuelOperationRecords.$inferInsert
}

function cycleMovement(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, eventType: "direct_delivery", worksiteId: WORKSITE_A, productId: PRODUCT,
    quantity: 500, occurredAt: "2026-03-12T10:00:00.000Z", vehicleId: VEHICLE,
    supplierId: SUPPLIER, createdBy: ACTOR, ...extra,
  } as typeof schema.fuelCycleMovements.$inferInsert
}

function taeSubmission(id: string, token: string) {
  return {
    id, clientSubmissionId: `cliente-${id}`, publicResultToken: token, worksiteId: WORKSITE_A,
    vehicleId: VEHICLE, productId: PRODUCT, equipmentCodeSnapshot: "KA-1",
    loadedAt: "2026-03-12T10:00:00.000Z", submittedAt: "2026-03-12T10:05:00.000Z",
    driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
    meterType: "odometer", meterReading: 1_000, liters: 200, status: "validated",
  } as typeof schema.fuelTaeSubmissions.$inferInsert
}

function fuelLoad(id: string, statementId: string | null) {
  return {
    id, statementId, loadDate: "2026-05-04", month: "2026-05", serviceType: "TCT",
    vehicleId: VEHICLE, fuelSupplierId: SUPPLIER, worksiteId: WORKSITE_A,
    product: "PETROLEO DIESEL", productId: PRODUCT, liters: 100,
    baseAmount: 1_000, totalAmount: 1_190, createdBy: ACTOR,
  } as typeof schema.fuelLoads.$inferInsert
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await db.insert(schema.users).values({
    id: ACTOR, name: "Operador E", email: "operador-e@example.test", hashedPassword: "x",
  })
  await db.insert(schema.worksites).values([
    { id: WORKSITE_A, name: "Faena A", code: "E-FAENA-A", isActive: true },
    { id: WORKSITE_B, name: "Faena B", code: "E-FAENA-B", isActive: true },
  ])
  await db.insert(schema.fuelProducts).values({
    id: PRODUCT, code: "E-DIESEL", name: "Diésel E", category: "diesel", unit: "liter",
  })
  await db.insert(schema.fuelSuppliers).values({ id: SUPPLIER, name: "Proveedor E" })
  await db.insert(schema.fuelEquipmentTypes).values({
    id: EQUIPMENT_TYPE, slug: "e-camion", name: "Camión E",
  })
  await db.insert(schema.fuelVehicles).values({
    id: VEHICLE, plate: "E-EQ-01", type: "camion", equipmentTypeId: EQUIPMENT_TYPE,
    worksiteId: WORKSITE_A, isActive: true,
  })
  await db.insert(schema.fuelSupplyMedia).values({
    id: MEDIUM, slug: "e-surtidor", name: "Surtidor E", kind: "mandante_dispenser",
  })
  await db.insert(schema.fuelOperationBatches).values({
    id: OPERATION_BATCH, archivoNombre: "E-operaciones.xlsx", hashArchivo: "hash-e-operaciones",
    periodoDesde: "2026-03-01", periodoHasta: "2026-03-31", importadoPor: ACTOR,
  })
  await db.insert(schema.fuelProviderSyncRuns).values({
    id: SYNC_RUN, provider: "copec", trigger: "manual", requestedFrom: "2026-03",
    requestedTo: "2026-03", correlationId: "e-corrida", actorUserId: ACTOR,
  })
})

describe("E1 · fuel_supply_inputs: un despacho se identifica por medio, folio, faena y mes", () => {
  it("acepta el mismo folio en dos faenas: ya no hay una fila que se mueva de faena", async () => {
    await db.insert(schema.fuelSupplyInputs).values(supplyInput("e1-faena-a", WORKSITE_A, "2026-03"))
    await db.insert(schema.fuelSupplyInputs).values(supplyInput("e1-faena-b", WORKSITE_B, "2026-03"))

    const filas = await db.select().from(schema.fuelSupplyInputs)
      .where(eq(schema.fuelSupplyInputs.reference, "1"))
    expect(filas.map((fila) => fila.worksiteId).sort()).toEqual([WORKSITE_A, WORKSITE_B])
  })

  it("acepta el mismo folio en el mismo surtidor y faena si cambia el mes", async () => {
    await db.insert(schema.fuelSupplyInputs).values(supplyInput("e1-mes-siguiente", WORKSITE_A, "2026-04"))
    expect(await db.select().from(schema.fuelSupplyInputs)
      .where(eq(schema.fuelSupplyInputs.worksiteId, WORKSITE_A))).toHaveLength(2)
  })

  it("rechaza el despacho repetido: el replay del archivo no puede duplicar litros", async () => {
    expect(await rejectionOf(db.insert(schema.fuelSupplyInputs)
      .values(supplyInput("e1-duplicado", WORKSITE_A, "2026-03"))))
      .toContain("fuel_supply_inputs_dispatch_unique")
  })

  it("el índice único viejo por (medio, folio) ya no existe", async () => {
    expect(await indexDefinition("fuel_supply_inputs_reference_unique")).toBe("")
    expect(await indexDefinition("fuel_supply_inputs_dispatch_unique"))
      .toContain("(supply_medium_id, reference, worksite_id, month)")
  })
})

describe("E2 · fuel_operation_records: identidad natural de la carga operacional", () => {
  it("rechaza la carga repetida aunque falten hora y horómetro", async () => {
    await db.insert(schema.fuelOperationRecords).values(operationRecord("e2-base"))
    expect(await rejectionOf(db.insert(schema.fuelOperationRecords)
      .values(operationRecord("e2-repetida"))))
      .toContain("fuel_operation_records_identity_unique")
  })

  it("normaliza el equipo sin faena: dos filas sin faena también chocan", async () => {
    await db.insert(schema.fuelOperationRecords).values(operationRecord("e2-sin-faena-1", {
      worksiteId: null, plate: "KA-9",
    }))
    expect(await rejectionOf(db.insert(schema.fuelOperationRecords)
      .values(operationRecord("e2-sin-faena-2", { worksiteId: null, plate: "KA-9" }))))
      .toContain("fuel_operation_records_identity_unique")
  })

  it("acepta la carga del mismo día cuando cambia la hora, los litros o el horómetro", async () => {
    await db.insert(schema.fuelOperationRecords).values(operationRecord("e2-con-hora", { horaCarga: "08:00" }))
    await db.insert(schema.fuelOperationRecords).values(operationRecord("e2-otros-litros", { liters: 101 }))
    await db.insert(schema.fuelOperationRecords).values(operationRecord("e2-con-horometro", { horometro: 5_000 }))

    expect(await db.select().from(schema.fuelOperationRecords)
      .where(eq(schema.fuelOperationRecords.plate, "KA-1"))).toHaveLength(4)
  })
})

describe("E3 · fuel_reconciliation_links: un solo vínculo abierto por transacción y tipo", () => {
  beforeAll(async () => {
    await db.insert(schema.fuelProviderTransactions).values([
      {
        id: "e-tx-1", syncRunId: SYNC_RUN, provider: "copec", sourceAccount: "tct:diesel",
        identityKey: "guia:1", fingerprint: "fp-1", sourceRowKey: "row-1", status: "pending",
        payloadHash: "hash-1", documentNumber: "1", sourcePlate: "E-EQ-01",
      },
      {
        id: "e-tx-2", syncRunId: SYNC_RUN, provider: "copec", sourceAccount: "tct:diesel",
        identityKey: "guia:2", fingerprint: "fp-2", sourceRowKey: "row-2", status: "pending",
        payloadHash: "hash-2", documentNumber: "2", sourcePlate: "E-EQ-01",
      },
    ])
  })

  it("rechaza dos `unmatched` para la misma transacción y tipo de vínculo", async () => {
    await db.insert(schema.fuelReconciliationLinks).values({
      id: "e3-abierto", providerTransactionId: "e-tx-1", linkType: "fuel_load", status: "unmatched",
    })
    expect(await rejectionOf(db.insert(schema.fuelReconciliationLinks).values({
      id: "e3-abierto-repetido", providerTransactionId: "e-tx-1", linkType: "fuel_load", status: "unmatched",
    }))).toContain("fuel_reconciliation_links_open_unique")
  })

  it("`ambiguous` cuenta como abierto: el índice cubre ambos estados", async () => {
    expect(await rejectionOf(db.insert(schema.fuelReconciliationLinks).values({
      id: "e3-ambiguo", providerTransactionId: "e-tx-1", linkType: "fuel_load", status: "ambiguous",
    }))).toContain("fuel_reconciliation_links_open_unique")
  })

  it("permite abrir una fila por tipo de vínculo y por transacción", async () => {
    await db.insert(schema.fuelReconciliationLinks).values([
      { id: "e3-dte", providerTransactionId: "e-tx-1", linkType: "dte", status: "unmatched" },
      { id: "e3-otra-transaccion", providerTransactionId: "e-tx-2", linkType: "fuel_load", status: "unmatched" },
    ])
    expect(await db.select().from(schema.fuelReconciliationLinks)
      .where(eq(schema.fuelReconciliationLinks.status, "unmatched"))).toHaveLength(3)
  })

  it("conserva el único de destinos", async () => {
    expect(await indexDefinition("fuel_reconciliation_links_target_unique")).toContain("UNIQUE INDEX")
  })
})

describe("E4 · fuel_seal_movements: el historial de sellos sobrevive a la reversa del lote", () => {
  beforeAll(async () => {
    await db.insert(schema.fuelTaeSubmissions).values([
      taeSubmission("e-sub-a", "token-e-a"),
      taeSubmission("e-sub-b", "token-e-b"),
    ])
  })

  it("acepta movimientos con la misma submission, tipo y sello sólo una vez", async () => {
    await db.insert(schema.fuelSealMovements).values({
      id: "e4-removido-a", submissionId: "e-sub-a", sealNumber: "S-1", movementType: "removed",
      changedBy: ACTOR, evidenceSha256: "sha256-de-la-foto-a",
    })
    expect(await rejectionOf(db.insert(schema.fuelSealMovements).values({
      id: "e4-removido-a-repetido", submissionId: "e-sub-a", sealNumber: "S-1", movementType: "removed",
    }))).toContain("fuel_seal_movements_submission_type_seal_unique")
  })

  it("la FK borra en cascada el vínculo, no la fila: revertir deja el movimiento con submission_id NULL", async () => {
    await db.insert(schema.fuelSealMovements).values({
      id: "e4-removido-b", submissionId: "e-sub-b", sealNumber: "S-1", movementType: "removed",
      changedBy: ACTOR, evidenceSha256: "sha256-de-la-foto-b",
    })
    // Lo que hace la reversa del lote (carril B): marcar y luego borrar la carga.
    await db.update(schema.fuelSealMovements)
      .set({
        revertedAt: "2026-11-05T12:00:00.000Z",
        revertedBy: ACTOR,
        revertedReason: "Reversa del lote TAE importado por error",
      })
      .where(eq(schema.fuelSealMovements.submissionId, "e-sub-b"))
    await db.delete(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, "e-sub-b"))

    const [movimiento] = await db.select().from(schema.fuelSealMovements)
      .where(eq(schema.fuelSealMovements.id, "e4-removido-b"))
    expect(movimiento!.submissionId).toBeNull()
    expect(movimiento!.revertedAt).not.toBeNull()
    expect(movimiento!.revertedBy).toBe(ACTOR)
    expect(movimiento!.revertedReason).toContain("Reversa del lote")
    // `evidence_sha256` es el único registro del hash de la foto del sello.
    expect(movimiento!.evidenceSha256).toBe("sha256-de-la-foto-b")
  })

  it("la FK de la base declara ON DELETE SET NULL (no action era el drift de 0053)", async () => {
    const { rows } = await pg.query<{ confdeltype: string }>(
      `select confdeltype from pg_constraint
        where conrelid = 'fuel_seal_movements'::regclass
          and conname = 'fuel_seal_movements_submission_id_fuel_tae_submissions_id_fk'`,
    )
    expect(rows[0]?.confdeltype).toBe("n")
  })

  it("sin submission, el movimiento retractado puede repetir sello y tipo", async () => {
    await db.insert(schema.fuelSealMovements).values({
      id: "e4-removido-huerfano-1", submissionId: null, sealNumber: "S-1", movementType: "removed",
      revertedAt: "2026-11-05T12:00:00.000Z", revertedReason: "Reversa del lote TAE",
    })
    await db.insert(schema.fuelSealMovements).values({
      id: "e4-removido-huerfano-2", submissionId: null, sealNumber: "S-1", movementType: "removed",
      revertedAt: "2026-11-05T12:00:00.000Z", revertedReason: "Reversa del lote TAE",
    })
    expect(await db.select().from(schema.fuelSealMovements)
      .where(eq(schema.fuelSealMovements.sealNumber, "S-1"))).toHaveLength(4)
  })

  it("el único de (submission, tipo, sello) sigue vigente para las filas con carga", async () => {
    expect(await indexDefinition("fuel_seal_movements_submission_type_seal_unique"))
      .toContain("WHERE (submission_id IS NOT NULL)")
  })
})

describe("E5 · fuel_cycle_movements: la guía Copec se identifica con patente y producto", () => {
  it("acepta la misma guía para dos equipos distintos", async () => {
    await db.insert(schema.fuelCycleMovements).values(cycleMovement("e5-camion", {
      sourceType: "copec_tae", sourceId: "660150998", sourcePlate: "E-EQ-01", sourceProduct: "diesel",
    }))
    await db.insert(schema.fuelCycleMovements).values(cycleMovement("e5-otro-equipo", {
      sourceType: "copec_tae", sourceId: "660150998", sourcePlate: "E-EQ-02", sourceProduct: "diesel",
    }))
    expect(await db.select().from(schema.fuelCycleMovements)
      .where(eq(schema.fuelCycleMovements.sourceId, "660150998"))).toHaveLength(2)
  })

  it("rechaza la reimportación del mismo movimiento Copec TAE", async () => {
    expect(await rejectionOf(db.insert(schema.fuelCycleMovements).values(cycleMovement("e5-repetido", {
      sourceType: "copec_tae", sourceId: "660150998", sourcePlate: "E-EQ-01", sourceProduct: "diesel",
    })))).toContain("fuel_cycle_movements_copec_tae_source_unique")
  })

  it("acepta la misma guía con otro producto", async () => {
    await db.insert(schema.fuelCycleMovements).values(cycleMovement("e5-otro-producto", {
      sourceType: "copec_tae", sourceId: "660150998", sourcePlate: "E-EQ-01", sourceProduct: "bluemax",
    }))
    expect(await db.select().from(schema.fuelCycleMovements)
      .where(eq(schema.fuelCycleMovements.sourceId, "660150998"))).toHaveLength(3)
  })

  it("sigue siendo idempotente por referencia externa en las fuentes que no son Copec TAE", async () => {
    await db.insert(schema.fuelCycleMovements).values(cycleMovement("e5-otra-fuente", {
      sourceType: "tct_detalle", sourceId: "G-1",
    }))
    expect(await rejectionOf(db.insert(schema.fuelCycleMovements).values(cycleMovement("e5-otra-fuente-2", {
      sourceType: "tct_detalle", sourceId: "G-1",
    })))).toContain("fuel_cycle_movements_source_unique")
  })
})

describe("E6 · fuel_provider_period_coverage: el mes con incidencias puede cerrarse", () => {
  it("acepta `closed_with_issues`", async () => {
    await db.insert(schema.fuelProviderPeriodCoverage).values({
      id: "e6-cerrado-con-issues", provider: "copec", sourceAccount: "tct:diesel", channel: "TCT",
      product: "diesel", periodMonth: "2026-03-01", status: "closed_with_issues",
      sourceAvailability: "available", rowsReceived: 12, rowsRejected: 1,
      evidence: "Una fila con patente vacía; se cerró el mes con las 11 válidas.",
      evidenceActorUserId: ACTOR,
    })
    const [fila] = await db.select().from(schema.fuelProviderPeriodCoverage)
      .where(eq(schema.fuelProviderPeriodCoverage.id, "e6-cerrado-con-issues"))
    expect(fila!.status).toBe("closed_with_issues")
  })

  it("sigue rechazando un estado fuera del catálogo", async () => {
    expect(await rejectionOf(db.insert(schema.fuelProviderPeriodCoverage).values({
      id: "e6-estado-invalido", provider: "copec", sourceAccount: "tct:diesel", channel: "TCT",
      product: "diesel", periodMonth: "2026-04-01", status: "cerrado_ok",
    }))).toContain("fuel_provider_coverage_status_valid")
  })
})

describe("E7 · fuel_loads.statement_id y cuentas corrientes", () => {
  beforeAll(async () => {
    await db.insert(schema.fuelMonthlyStatements).values({
      id: "e-statement-mayo", month: "2026-05", fuelSupplierId: SUPPLIER, createdBy: ACTOR,
    })
  })

  it("rechaza dos cuentas corrientes para el mismo mes y proveedor", async () => {
    expect(await rejectionOf(db.insert(schema.fuelMonthlyStatements).values({
      id: "e-statement-mayo-2", month: "2026-05", fuelSupplierId: SUPPLIER, createdBy: ACTOR,
    }))).toContain("fuel_statements_month_supplier_unique")
  })

  it("acepta la carga imputada a la cuenta corriente del mes", async () => {
    await db.insert(schema.fuelLoads).values(fuelLoad("e-carga-imputada", "e-statement-mayo"))
    const [carga] = await db.select().from(schema.fuelLoads)
      .where(eq(schema.fuelLoads.id, "e-carga-imputada"))
    expect(carga!.statementId).toBe("e-statement-mayo")
  })

  it("rechaza una carga imputada a una cuenta corriente inexistente", async () => {
    expect(await rejectionOf(db.insert(schema.fuelLoads)
      .values(fuelLoad("e-carga-huerfana", "e-statement-fantasma"))))
      .toContain("fuel_loads_statement_id_fuel_monthly_statements_id_fk")
  })

  it("los índices de FK que faltaban existen", async () => {
    for (const nombre of [
      "fuel_provider_transactions_storage_location_idx",
      "fuel_reconciliation_links_fuel_load_idx",
      "fuel_reconciliation_links_cycle_movement_idx",
      "fuel_tae_submissions_driver_idx",
      "fuel_tae_submissions_supervisor_idx",
      "fuel_provider_event_revisions_file_idx",
    ]) {
      expect(await indexDefinition(nombre), `falta el índice ${nombre}`).toContain("USING btree")
    }
  })
})
