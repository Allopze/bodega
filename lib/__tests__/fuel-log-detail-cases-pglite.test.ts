import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

// ── PostgreSQL en memoria con las migraciones reales ──────────────────────
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

// Los cargadores de la ficha miran permisos con `can`; la sesión de la prueba ya trae los suyos.
vi.mock("@/lib/auth/can", async () => {
  const scope = await import("@/lib/auth/scope")
  const has = (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission) ?? false
  return { can: has, canAny: (session: Session | null, ...permissions: string[]) => permissions.some((permission) => has(session, permission)), isGlobalRole: scope.isGlobalRole }
})

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { loadTerrenoDetail, loadPlanillaDetail, loadFacturaDetail } = await import("@/lib/combustibles/fuel-log-detail")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

/**
 * Los casos abiertos de una carga, en su ficha (`openCases`), contra PostgreSQL
 * real: sólo los abiertos de ESA carga —por tipo de entidad e id—, los más graves
 * primero y a igual gravedad el más antiguo, con tope, sin nombres de personas y
 * dentro del alcance de faenas (una carga ajena sigue siendo 404 sin consultarlos).
 */
describe("ficha de una carga: casos abiertos (PostgreSQL)", () => {
  const wsA = nanoid()
  const wsB = nanoid()
  const viewerId = nanoid()
  const assigneeId = nanoid()
  const resolverId = nanoid()
  const productId = nanoid()
  const supplierId = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleId = nanoid()
  const batchId = nanoid()
  const taeId = nanoid()
  const taeOtherId = nanoid()
  const recordId = nanoid()
  const recordCapId = nanoid()
  const recordCleanId = nanoid()
  const invoiceId = nanoid()

  /** Una regla por código: la ficha toma el nombre de la fila de `fuel_anomaly_rules`. */
  const RULES: Record<string, string> = {
    litros_supera_capacidad: "Litros superiores a capacidad del estanque",
    kilometraje_regresivo: "Kilometraje inferior al anterior",
    evidencia_faltante: "Evidencia faltante en carga TAE",
    sello_repetido: "Sello repetido",
    horometro_regresivo: "Horómetro inferior al anterior",
    identidad_incompleta: "Conductor o supervisor no verificado en catálogo",
  }
  const ruleId = (code: string) => `rule-${code}`

  const sessionFor = (options: { global?: boolean; worksiteIds?: string[] } = {}): Session => ({
    user: {
      id: viewerId, name: "Revisora", email: "revisora@example.com", roles: [], permissions: ["combustibles:view"],
      worksiteIds: options.worksiteIds ?? [wsA], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: options.global ?? false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session)

  type CaseSeed = Partial<typeof schema.fuelAnomalyCases.$inferInsert> & { id: string; ruleCode: string; referenceEntityType: string; referenceEntityId: string }
  const caseRow = (seed: CaseSeed): typeof schema.fuelAnomalyCases.$inferInsert => ({
    ruleId: ruleId(seed.ruleCode in RULES ? seed.ruleCode : "sello_repetido"),
    severity: "medium",
    status: "open",
    worksiteId: wsA,
    vehicleId,
    description: `Descripción de ${seed.id}`,
    detectedAt: "2026-10-01T10:00:00.000Z",
    ...seed,
  })

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: wsA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: wsB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values([
      { id: viewerId, name: "Revisora", email: `rev-${nanoid()}@example.com`, hashedPassword: "x", isActive: true },
      { id: assigneeId, name: "Ana Asignada", email: `ana-${nanoid()}@example.com`, hashedPassword: "x", isActive: true },
      { id: resolverId, name: "Luis Resolutor", email: `luis-${nanoid()}@example.com`, hashedPassword: "x", isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `D-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: `Copec ${nanoid().slice(0, 4)}` })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `cam-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `CS${nanoid().slice(0, 4).toUpperCase()}`, code: "CA-14", type: "camion", equipmentTypeId, worksiteId: wsA, isActive: true })

    // Las tres entidades a las que apuntan los casos de una carga: terreno, planilla y factura.
    const tae = (id: string, loadedAt: string) => ({
      id, clientSubmissionId: nanoid(), source: "internal_app" as const, publicResultToken: nanoid(32), registeredBy: viewerId,
      worksiteId: wsA, vehicleId, productId, equipmentCodeSnapshot: "CA-14", loadedAt, submittedAt: loadedAt,
      driverNameSnapshot: "Marcelo Conductor", supervisorNameSnapshot: "Rodrigo Supervisor", meterType: "odometer", meterReading: 182310, liters: 185, status: "submitted" as const,
    })
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([tae(taeId, "2026-10-05T12:00:00.000Z"), tae(taeOtherId, "2026-10-06T12:00:00.000Z")])
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "consolidado.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-10-01", periodoHasta: "2026-10-31", importadoPor: viewerId, totalFilas: 3, filasInvalidas: 0,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values(
      [recordId, recordCapId, recordCleanId].map((id, index) => ({ id, batchId, worksiteId: wsA, vehicleId, plate: "OPKM11", code: "CA-14", fecha: `2026-10-1${index}`, liters: 50 })),
    )
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: invoiceId, loadDate: "2026-10-08", month: "2026-10", serviceType: "TCT", vehicleId, fuelSupplierId: supplierId, worksiteId: wsA,
      product: "PETROLEO DIESEL", productId, liters: 120, baseAmount: 1000, totalAmount: 1190, createdBy: viewerId,
    })

    await inMemoryDb.insert(schema.fuelAnomalyRules).values([
      ...Object.entries(RULES).map(([code, name]) => ({ id: ruleId(code), code, name, severity: "high" })),
      // Las 21 reglas del caso del tope: el índice único exige una regla distinta por caso abierto de una misma carga.
      ...Array.from({ length: 21 }, (_, index) => ({ id: `rule-cap-${index}`, code: `cap_rule_${index}`, name: `Regla del tope ${index}`, severity: "low" })),
    ])

    const onTae = (seed: Omit<CaseSeed, "referenceEntityType" | "referenceEntityId">) => caseRow({ ...seed, referenceEntityType: "fuel_tae_submission", referenceEntityId: taeId })
    await inMemoryDb.insert(schema.fuelAnomalyCases).values([
      // ── Abiertos sobre la carga de terreno (cada estado abierto aparece al menos una vez) ──
      onTae({ id: "c-med-old", ruleCode: "sello_repetido", severity: "medium", status: "open", detectedAt: "2026-10-01T10:00:00.000Z" }),
      onTae({ id: "c-crit", ruleCode: "litros_supera_capacidad", severity: "critical", status: "in_review", assigneeId, detectedAt: "2026-10-10T10:00:00.000Z" }),
      onTae({ id: "c-high-new", ruleCode: "kilometraje_regresivo", severity: "high", status: "reopened", detectedAt: "2026-10-12T10:00:00.000Z" }),
      onTae({ id: "c-high-old", ruleCode: "evidencia_faltante", severity: "high", status: "open", detectedAt: "2026-10-05T10:00:00.000Z" }),
      // Del caso mismo, no de la carga: otra faena (inconsistente a propósito: la bandeja no se lo mostraría a quien sólo ve la A).
      onTae({ id: "c-foreign-worksite", ruleCode: "identidad_incompleta", severity: "low", status: "open", worksiteId: wsB }),
      // ── Cerrados: no cuentan como abiertos ──
      onTae({ id: "c-resolved", ruleCode: "horometro_regresivo", severity: "critical", status: "resolved", resolvedById: resolverId, resolvedAt: "2026-10-20T10:00:00.000Z", resolution: "Lectura corregida" }),
      onTae({ id: "c-dismissed", ruleCode: "identidad_incompleta", severity: "high", status: "dismissed", resolvedById: resolverId, resolvedAt: "2026-10-21T10:00:00.000Z", resolution: "Falso positivo" }),
      // ── De otra carga, o de otro tipo de entidad con el mismo id ──
      caseRow({ id: "c-other-tae", ruleCode: "litros_supera_capacidad", severity: "critical", referenceEntityType: "fuel_tae_submission", referenceEntityId: taeOtherId }),
      caseRow({ id: "c-wrong-type", ruleCode: "litros_supera_capacidad", severity: "critical", referenceEntityType: "fuel_tae_submission", referenceEntityId: invoiceId }),
      // ── Planilla ──
      caseRow({ id: "c-record", ruleCode: "kilometraje_regresivo", severity: "high", referenceEntityType: "fuel_operation_record", referenceEntityId: recordId }),
      // ── Factura: gravedad media y baja, la baja detectada antes ──
      caseRow({ id: "c-invoice-low", ruleCode: "evidencia_faltante", severity: "low", referenceEntityType: "fuel_load", referenceEntityId: invoiceId, detectedAt: "2026-10-02T10:00:00.000Z" }),
      caseRow({ id: "c-invoice-med", ruleCode: "sello_repetido", severity: "medium", referenceEntityType: "fuel_load", referenceEntityId: invoiceId, detectedAt: "2026-10-09T10:00:00.000Z" }),
    ])

    // El tope: una carga con 21 casos abiertos —20 de gravedad baja y UNO crítico detectado el último— y, además,
    // 5 críticos YA CERRADOS: si el filtro de estado no actuara en la consulta, ocuparían los primeros puestos del tope.
    await inMemoryDb.insert(schema.fuelAnomalyCases).values([
      ...Array.from({ length: 5 }, (_, index) => caseRow({
        id: `cap-closed-${index}`, ruleCode: "cap_rule_0", ruleId: "rule-cap-0", severity: "critical", status: index % 2 === 0 ? "resolved" : "dismissed",
        referenceEntityType: "fuel_operation_record", referenceEntityId: recordCapId, detectedAt: `2026-09-0${index + 1}T08:00:00.000Z`,
        resolvedById: resolverId, resolvedAt: `2026-09-1${index}T08:00:00.000Z`, resolution: "Cerrado",
      })),
      ...Array.from({ length: 20 }, (_, index) => caseRow({
        id: `cap-low-${String(index).padStart(2, "0")}`, ruleCode: `cap_rule_${index}`, ruleId: `rule-cap-${index}`, severity: "low",
        referenceEntityType: "fuel_operation_record", referenceEntityId: recordCapId, detectedAt: `2026-10-${String(index + 1).padStart(2, "0")}T08:00:00.000Z`,
      })),
      caseRow({
        id: "cap-critical", ruleCode: "cap_rule_20", ruleId: "rule-cap-20", severity: "critical",
        referenceEntityType: "fuel_operation_record", referenceEntityId: recordCapId, detectedAt: "2026-10-28T08:00:00.000Z",
      }),
    ])
  })

  describe("registro en terreno", () => {
    it("trae sólo los abiertos de esa carga, de más a menos graves y, a igual gravedad, el más antiguo primero", async () => {
      const detail = await loadTerrenoDetail(sessionFor(), taeId)

      expect(detail!.openCases.map((item) => item.id)).toEqual(["c-crit", "c-high-old", "c-high-new", "c-med-old"])
    })

    it("cada caso trae regla, gravedad, estado y fecha; el nombre de la regla sale de la regla", async () => {
      const detail = await loadTerrenoDetail(sessionFor(), taeId)

      expect(detail!.openCases).toEqual([
        { id: "c-crit", ruleCode: "litros_supera_capacidad", ruleName: "Litros superiores a capacidad del estanque", severity: "critical", status: "in_review", detectedAt: expect.stringContaining("2026-10-10") },
        { id: "c-high-old", ruleCode: "evidencia_faltante", ruleName: "Evidencia faltante en carga TAE", severity: "high", status: "open", detectedAt: expect.stringContaining("2026-10-05") },
        { id: "c-high-new", ruleCode: "kilometraje_regresivo", ruleName: "Kilometraje inferior al anterior", severity: "high", status: "reopened", detectedAt: expect.stringContaining("2026-10-12") },
        { id: "c-med-old", ruleCode: "sello_repetido", ruleName: "Sello repetido", severity: "medium", status: "open", detectedAt: expect.stringContaining("2026-10-01") },
      ])
    })

    it("no trae los resueltos ni los descartados", async () => {
      const ids = (await loadTerrenoDetail(sessionFor({ global: true }), taeId))!.openCases.map((item) => item.id)

      expect(ids).not.toContain("c-resolved")
      expect(ids).not.toContain("c-dismissed")
    })

    it("no mezcla los casos de otra carga ni los de otro tipo de entidad con el mismo id", async () => {
      const ids = (await loadTerrenoDetail(sessionFor({ global: true }), taeId))!.openCases.map((item) => item.id)

      expect(ids).not.toContain("c-other-tae")
      expect(ids).not.toContain("c-wrong-type")
      expect(ids).not.toContain("c-record")
      expect((await loadTerrenoDetail(sessionFor(), taeOtherId))!.openCases.map((item) => item.id)).toEqual(["c-other-tae"])
    })

    it("no lleva nombres de personas: ni de quien tomó el caso ni de quien cerró otros", async () => {
      const detail = await loadTerrenoDetail(sessionFor({ global: true }), taeId)

      expect(Object.keys(detail!.openCases[0]!).sort()).toEqual(["detectedAt", "id", "ruleCode", "ruleName", "severity", "status"])
      expect(JSON.stringify(detail!.openCases)).not.toMatch(/Ana Asignada|Luis Resolutor/)
    })

    it("sin casos abiertos, la lista va vacía", async () => {
      const detail = await loadPlanillaDetail(sessionFor(), recordCleanId)

      expect(detail).not.toBeNull()
      expect(detail!.openCases).toEqual([])
    })
  })

  describe("planilla y factura", () => {
    it("planilla: los casos de la fila de la planilla", async () => {
      const detail = await loadPlanillaDetail(sessionFor(), recordId)

      expect(detail!.openCases).toMatchObject([{ id: "c-record", ruleName: "Kilometraje inferior al anterior", severity: "high", status: "open" }])
    })

    it("factura: los casos de la carga facturada, la media antes que la baja aunque la baja sea más antigua", async () => {
      const detail = await loadFacturaDetail(sessionFor(), invoiceId)

      expect(detail!.openCases.map((item) => item.id)).toEqual(["c-invoice-med", "c-invoice-low"])
    })
  })

  describe("tope", () => {
    it("trae como máximo 20, y el tope corta lo menos grave: el crítico más reciente no se pierde", async () => {
      const detail = await loadPlanillaDetail(sessionFor(), recordCapId)
      const ids = detail!.openCases.map((item) => item.id)

      expect(ids).toHaveLength(20)
      expect(ids[0]).toBe("cap-critical")
      // De los 20 de gravedad baja entra el más antiguo; queda fuera el último.
      expect(ids).toContain("cap-low-00")
      expect(ids).not.toContain("cap-low-19")
    })

    it("los casos ya cerrados, aunque sean críticos, no ocupan puestos del tope", async () => {
      const ids = (await loadPlanillaDetail(sessionFor(), recordCapId))!.openCases.map((item) => item.id)

      expect(ids.filter((id) => id.startsWith("cap-closed-"))).toEqual([])
      expect(ids.filter((id) => id.startsWith("cap-low-"))).toHaveLength(19)
    })
  })

  describe("alcance de faenas", () => {
    it("el caso mismo se acota por faena como en la bandeja: un rol global lo ve, uno de la faena A no", async () => {
      const global = await loadTerrenoDetail(sessionFor({ global: true, worksiteIds: [] }), taeId)
      const scoped = await loadTerrenoDetail(sessionFor({ worksiteIds: [wsA] }), taeId)

      expect(global!.openCases.map((item) => item.id)).toEqual(["c-crit", "c-high-old", "c-high-new", "c-med-old", "c-foreign-worksite"])
      expect(scoped!.openCases.map((item) => item.id)).toEqual(["c-crit", "c-high-old", "c-high-new", "c-med-old"])
    })

    it("una carga fuera de las faenas de la sesión sigue siendo nula, en los tres orígenes, y ni se consultan los casos", async () => {
      const otherWorksite = sessionFor({ worksiteIds: [wsB] })
      // Cualquier `select` es una lectura de casos, de la línea de tiempo o de nombres: antes del alcance no hay ninguna.
      const select = vi.spyOn(inMemoryDb, "select")
      try {
        expect(await loadTerrenoDetail(otherWorksite, taeId)).toBeNull()
        expect(await loadPlanillaDetail(otherWorksite, recordId)).toBeNull()
        expect(await loadFacturaDetail(otherWorksite, invoiceId)).toBeNull()
        expect(select).not.toHaveBeenCalled()
      } finally {
        select.mockRestore()
      }
    })

    it("una sesión sin ninguna faena tampoco recibe la carga ni sus casos", async () => {
      expect(await loadTerrenoDetail(sessionFor({ worksiteIds: [] }), taeId)).toBeNull()
    })
  })
})
