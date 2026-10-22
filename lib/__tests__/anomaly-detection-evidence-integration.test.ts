import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── In-memory PostgreSQL database & migrations ────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime; postgres-js difiere sólo en el tipo HKT del resultado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { syncAnomalyRuleCatalog, getAnomalyCases, updateAnomalyCaseStatus } = await import("@/lib/combustibles/anomaly-cases")
const { severityOf } = await import("@/lib/combustibles/anomaly-detector")
const { KNOWN_RULE_CODES } = await import("@/lib/combustibles/validation")

/** Rol global: estas pruebas verifican la detección, no el alcance por faena. */
const TEST_SESSION = { user: { id: "test-user", isGlobal: true, worksiteIds: [] } } as unknown as import("next-auth").Session
const { runAllBatchRules } = await import("@/lib/combustibles/anomaly-detector")

/**
 * Reglas batch de evidencia, paridad de reglas, lecturas del detalle de
 * proveedor y cierre de casos de medidor (separadas de
 * `anomaly-detection-integration.test.ts`). Cada `describe` siembra sus propios datos.
 */
beforeAll(async () => {
  await syncAnomalyRuleCatalog()
})

describe("evidencia_duplicada (batch — duplicate evidence by SHA-256)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const productId = nanoid()
  const sharedHash = "duplicate-sha256-abcdef123456"

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena evidencia duplicada", code: `ED-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DIESEL-ED-${nanoid().slice(0, 6)}`, name: "Diésel evidencias", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `ev-camion-${nanoid().slice(0, 6)}`, name: "Camión evidencias",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `EVID${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
    })
  })

  it("crea un caso cuando el mismo SHA-256 aparece en evidencias de distintas cargas", async () => {
    // Dos submissions distintas con la misma evidencia (mismo hash)
    const sub1Id = nanoid()
    const sub2Id = nanoid()
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([
      {
        id: sub1Id, clientSubmissionId: nanoid(), source: "public_pwa",
        publicResultToken: nanoid(32), worksiteId: wsId, vehicleId: vehId, productId,
        equipmentCodeSnapshot: "EVID-1", loadedAt: "2026-07-01T12:00:00.000Z",
        submittedAt: "2026-07-01T12:00:00.000Z",
        driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
        manualIdentity: false, meterType: "odometer", liters: 50, status: "validated",
      },
      {
        id: sub2Id, clientSubmissionId: nanoid(), source: "public_pwa",
        publicResultToken: nanoid(32), worksiteId: wsId, vehicleId: vehId, productId,
        equipmentCodeSnapshot: "EVID-2", loadedAt: "2026-07-02T12:00:00.000Z",
        submittedAt: "2026-07-02T12:00:00.000Z",
        driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
        manualIdentity: false, meterType: "odometer", liters: 50, status: "validated",
      },
    ])
    // Misma evidencia (mismo SHA-256) en ambas cargas
    await inMemoryDb.insert(schema.fuelTaeEvidence).values([
      {
        id: nanoid(), submissionId: sub1Id, kind: "odometer",
        fileName: "foto-sub1.jpg", filePath: "fotos/foto-sub1.jpg",
        mimeType: "image/jpeg", sha256: sharedHash,
      },
      {
        id: nanoid(), submissionId: sub2Id, kind: "odometer",
        fileName: "foto-sub2.jpg", filePath: "fotos/foto-sub2.jpg",
        mimeType: "image/jpeg", sha256: sharedHash,
      },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "evidencia_duplicada" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("evidencia_ilegible (batch — corrupt/unreadable evidence)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const productId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena evidencia ilegible", code: `EI-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DIESEL-EI-${nanoid().slice(0, 6)}`, name: "Diésel evidencia", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `ileg-camion-${nanoid().slice(0, 6)}`, name: "Camión evidencia",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `ILEG${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
    })
  })

  it("crea un caso cuando una evidencia tiene tamaño 0 bytes", async () => {
    const subId = nanoid()
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: subId, clientSubmissionId: nanoid(), source: "public_pwa",
      publicResultToken: nanoid(32), worksiteId: wsId, vehicleId: vehId, productId,
      equipmentCodeSnapshot: "ILEG-1", loadedAt: "2026-07-01T12:00:00.000Z",
      submittedAt: "2026-07-01T12:00:00.000Z",
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 50, status: "validated",
    })
    // Evidencia con fileSize = 0 y filePath no nulo (el detector filtra IS NOT NULL)
    await inMemoryDb.insert(schema.fuelTaeEvidence).values({
      id: nanoid(), submissionId: subId, kind: "odometer",
      fileName: "vacia.jpg", filePath: "fotos/vacia.jpg",
      mimeType: "image/jpeg", fileSize: 0,
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "evidencia_ilegible" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })

  it("crea un caso cuando una evidencia tiene un MIME no-imagen", async () => {
    const subId = nanoid()
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: subId, clientSubmissionId: nanoid(), source: "public_pwa",
      publicResultToken: nanoid(32), worksiteId: wsId, vehicleId: vehId, productId,
      equipmentCodeSnapshot: "ILEG-2", loadedAt: "2026-07-02T12:00:00.000Z",
      submittedAt: "2026-07-02T12:00:00.000Z",
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 50, status: "validated",
    })
    // Evidencia con mimeType no-imagen (application/pdf = no empieza con "image/")
    await inMemoryDb.insert(schema.fuelTaeEvidence).values({
      id: nanoid(), submissionId: subId, kind: "odometer",
      fileName: "documento.pdf", filePath: "docs/doc.pdf",
      mimeType: "application/pdf", fileSize: 1024,
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "evidencia_ilegible" }, TEST_SESSION)
    // Puede tener 1 o 2 casos dependiendo de si la corrida anterior dejó casos
    expect(cases.length).toBeGreaterThan(0)
  })
})

// CO-018 / CO-019: la severidad configurable no gobernaba ningún caso (cada
// detector escribía un literal) y `carga_duplicada` se sembraba activa sin
// catálogo ni detector: la pantalla mostraba una regla viva que nunca abría un
// caso. Esta prueba fija la paridad seed ↔ catálogo ↔ motor y el gobierno real
// de la severidad.
describe("paridad de reglas y severidad efectiva", () => {
  it("toda regla sembrada existe en el catálogo compartido", async () => {
    await syncAnomalyRuleCatalog()
    const seeded = await inMemoryDb.select({ code: schema.fuelAnomalyRules.code }).from(schema.fuelAnomalyRules)
    const unknown = seeded.map((rule) => rule.code).filter((code) => !(KNOWN_RULE_CODES as readonly string[]).includes(code))
    expect(unknown).toEqual([])
  })

  it("la severidad de la regla manda sobre el literal del detector", () => {
    expect(severityOf({ severity: "critical" }, "low")).toBe("critical")
    // Fallback sólo para una regla sin severidad válida.
    expect(severityOf({ severity: null }, "medium")).toBe("medium")
    expect(severityOf({ severity: "inventada" }, "high")).toBe("high")
  })
})

describe("lecturas del detalle de proveedor (fuel_meter_readings)", () => {
  // El odómetro que el operario tipea en el surtidor llega en el detalle por
  // transacción de Copec y Aramco. Es la fuente donde el error de dedo aparece
  // de verdad —en la muestra real, 27 de 249 pares consecutivos retroceden— y
  // hasta ahora ninguna regla la miraba.
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehRegId = nanoid()
  const vehJumpId = nanoid()
  const vehMixId = nanoid()
  const vehSlowId = nanoid()

  const reading = (vehicleId: string, over: Partial<typeof schema.fuelMeterReadings.$inferInsert>) => ({
    id: nanoid(),
    vehicleId,
    plate: "TEST",
    source: "copec_tct",
    sourceRef: nanoid(),
    occurredAt: "2026-06-01T12:00:00.000Z",
    meterType: "odometer",
    value: 0,
    ...over,
  })

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena lecturas", code: `FL-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `lect-camion-${nanoid().slice(0, 6)}`, name: "Camión lecturas",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values(
      [vehRegId, vehJumpId, vehMixId, vehSlowId].map((id) => ({
        id, plate: `LEC${nanoid().slice(0, 5).toUpperCase()}`, type: "camion",
        equipmentTypeId: eqTypeId, worksiteId: wsId, meterType: "odometer", isActive: true,
      })),
    )
  })

  it("crea kilometraje_regresivo cuando la boleta pierde un dígito", async () => {
    await inMemoryDb.insert(schema.fuelMeterReadings).values([
      reading(vehRegId, { occurredAt: "2026-06-01T12:00:00.000Z", value: 720_325, stationName: "RUTA 5 KM 786" }),
      reading(vehRegId, { occurredAt: "2026-06-08T12:00:00.000Z", value: 72_000, stationName: "RUTA 5 KM 786" }),
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "kilometraje_regresivo" }, TEST_SESSION)
    const found = cases.find((c) => c.referenceEntityType === "fuel_meter_reading" && c.vehicleId === vehRegId)
    expect(found).toBeDefined()
    // La estación va en el texto: es por donde el operador persigue la boleta.
    expect(found!.description).toContain("RUTA 5 KM 786")
    expect(found!.observedValue).toBe("72000")
  })

  it("crea salto_medidor_implausible cuando el medidor sube más de lo posible", async () => {
    await inMemoryDb.insert(schema.fuelMeterReadings).values([
      reading(vehJumpId, { occurredAt: "2026-06-01T12:00:00.000Z", value: 100_000 }),
      reading(vehJumpId, { occurredAt: "2026-06-02T12:00:00.000Z", value: 1_000_000 }),
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "salto_medidor_implausible" }, TEST_SESSION)
    expect(cases.some((c) => c.referenceEntityType === "fuel_meter_reading" && c.vehicleId === vehJumpId)).toBe(true)
  })

  it("no marca un avance grande repartido en meses de operación normal", async () => {
    await inMemoryDb.insert(schema.fuelMeterReadings).values([
      reading(vehSlowId, { occurredAt: "2026-01-01T12:00:00.000Z", value: 200_000 }),
      // 40.000 km en 200 días: 200 km/día, muy por debajo del techo.
      reading(vehSlowId, { occurredAt: "2026-07-20T12:00:00.000Z", value: 240_000 }),
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "salto_medidor_implausible" }, TEST_SESSION)
    expect(cases.some((c) => c.vehicleId === vehSlowId)).toBe(false)
  })

  it("no compara entre proveedores: cada portal arrastra su propio desfase", async () => {
    await inMemoryDb.insert(schema.fuelMeterReadings).values([
      reading(vehMixId, { source: "copec_tct", occurredAt: "2026-06-01T12:00:00.000Z", value: 300_000 }),
      reading(vehMixId, { source: "aramco", occurredAt: "2026-06-02T12:00:00.000Z", value: 5_000 }),
    ])

    await runAllBatchRules()

    const { cases: regresivos } = await getAnomalyCases({ ruleCode: "kilometraje_regresivo" }, TEST_SESSION)
    expect(regresivos.some((c) => c.vehicleId === vehMixId)).toBe(false)
    const { cases: saltos } = await getAnomalyCases({ ruleCode: "salto_medidor_implausible" }, TEST_SESSION)
    expect(saltos.some((c) => c.vehicleId === vehMixId)).toBe(false)
  })
})

describe("cierre de un caso de medidor: corrección vs reset", () => {
  // Cerrar un caso regresivo decide si la serie del equipo se corta ahí: Flota y
  // Mantenciones tratan como reinicio SÓLO `reset_medidor`. Antes no había forma
  // de decirlo, así que corregir un dígito mal tecleado cortaba la serie igual.
  beforeAll(async () => {
    // `TEST_SESSION` es un rol global con id fijo; para poder CERRAR casos el
    // usuario tiene que existir (`resolved_by_id` es FK).
    await inMemoryDb.insert(schema.users).values({
      id: "test-user", name: "Revisor global", email: `global-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    }).onConflictDoNothing()
  })

  it("exige declarar qué pasó con el medidor antes de cerrar el caso", async () => {
    const { cases } = await getAnomalyCases({ ruleCode: "kilometraje_regresivo" }, TEST_SESSION)
    const target = cases.find((item) => item.status === "open")
    expect(target).toBeDefined()

    await expect(
      updateAnomalyCaseStatus(TEST_SESSION, target!.id, "open", "dismissed", "Revisado con el conductor"),
    ).rejects.toThrow(/lectura se corrigió o si el medidor fue reemplazado/i)

    const closed = await updateAnomalyCaseStatus(
      TEST_SESSION, target!.id, "open", "dismissed", "Revisado con el conductor", "lectura_corregida",
    )
    expect(closed.status).toBe("dismissed")
    expect(closed.resolutionKind).toBe("lectura_corregida")
  })

  it("un salto implausible se cierra sin declarar nada: no marca reinicio de serie", async () => {
    const { cases } = await getAnomalyCases({ ruleCode: "salto_medidor_implausible" }, TEST_SESSION)
    const target = cases.find((item) => item.status === "open")
    expect(target).toBeDefined()

    const closed = await updateAnomalyCaseStatus(TEST_SESSION, target!.id, "open", "dismissed", "Odómetro verificado en terreno")
    expect(closed.status).toBe("dismissed")
    expect(closed.resolutionKind).toBeNull()
  })
})
