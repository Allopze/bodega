import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

import {
  listTraceabilityIntegrityCases,
  resolveTraceabilityIntegrityCase,
  scanTraceabilityIntegrity,
  scanTraceabilityIntegrityAsSystem,
} from "@/lib/services/traceability-integrity-cases"

const now = "2026-08-09T12:00:00.000Z"
const session = {
  expires: "2099-01-01T00:00:00.000Z",
  user: {
    id: "integrity-user",
    email: "integrity@test.local",
    roles: ["administrador"],
    isGlobal: true,
    worksiteIds: [],
    primaryWorksiteId: null,
    avatarColor: null,
    isActive: true,
    permissions: ["warehouse:reconcile_integrity"],
  },
} as Session

describe("traceability integrity case resolution", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.users).values({
      id: "integrity-user", name: "Integrity User", email: "integrity@test.local", hashedPassword: "x",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: "integrity-ws", name: "Faena íntegra", code: "INT", isActive: true, createdAt: now, updatedAt: now },
      { id: "integrity-ws-other", name: "Faena ajena", code: "INT-OTHER", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.productCategories).values({ id: "integrity-cat", name: "Integridad", slug: "integridad", sortOrder: 1 })
    await inMemoryDb.insert(schema.products).values({
      id: "integrity-product", sku: "INT-001", name: "Casco integridad", categoryId: "integrity-cat",
      unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now,
    })
    // Producto distinto para OP-04: un ajuste de otro material no compensa un
    // exceso de cascos.
    await inMemoryDb.insert(schema.products).values({
      id: "integrity-product-other", sku: "INT-002", name: "Bota de seguridad", categoryId: "integrity-cat",
      unitOfMeasure: "par", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "integrity-request", code: "SOL-INTEGRITY", worksiteId: "integrity-ws", requesterId: "integrity-user",
      requestType: "epp", urgency: "normal", status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "integrity-request-item", requestId: "integrity-request", productId: "integrity-product", quantity: 1,
      unitOfMeasure: "unidad", status: "received", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.traceabilityIntegrityCases).values([
      {
        id: "integrity-case-wrong-adjustment", findingKey: "integrity-case-wrong-adjustment-key",
        requestItemId: "integrity-request-item", worksiteId: "integrity-ws",
        findingCode: "DELIVERY_EXCEEDS_FAENA_RECEIPT", snapshot: { receivedAtFaena: 0, delivered: 1 }, detectedAt: now,
      },
      {
        id: "integrity-case-resolve-once", findingKey: "integrity-case-resolve-once-key",
        requestItemId: "integrity-request-item", worksiteId: "integrity-ws",
        findingCode: "DELIVERY_BEFORE_FAENA_RECEIPT", snapshot: { firstFaenaReceiptAt: now }, detectedAt: now,
      },
      {
        // OP-04 (auditoría 2026-09-05): el ajuste compensatorio debe reparar
        // materialmente el caso — mismo producto y magnitud suficiente. La
        // reproducción vincula un ajuste de botas a un exceso de cascos y el
        // caso quedaba regularizado pese a no compensar nada.
        id: "integrity-case-excess", findingKey: "integrity-case-excess-key",
        requestItemId: "integrity-request-item", worksiteId: "integrity-ws",
        findingCode: "DELIVERY_EXCEEDS_FAENA_RECEIPT",
        snapshot: { receivedAtFaena: 0, delivered: 10, excessQuantity: 10 }, detectedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "integrity-adjustment-other", worksiteId: "integrity-ws-other", productId: "integrity-product", type: "ajuste",
        quantity: 1, stockBefore: 0, stockAfter: 1, performedBy: "integrity-user", performedAt: now, reason: "Ajuste otra faena",
      },
      {
        id: "integrity-adjustment-own", worksiteId: "integrity-ws", productId: "integrity-product", type: "ajuste",
        quantity: 1, stockBefore: 0, stockAfter: 1, performedBy: "integrity-user", performedAt: now, reason: "Ajuste de conciliación",
      },
      {
        id: "integrity-adjustment-wrong-product", worksiteId: "integrity-ws", productId: "integrity-product-other", type: "ajuste",
        quantity: 10, stockBefore: 0, stockAfter: 10, performedBy: "integrity-user", performedAt: now, reason: "Ajuste de botas",
      },
      {
        id: "integrity-adjustment-insufficient", worksiteId: "integrity-ws", productId: "integrity-product", type: "ajuste",
        quantity: 3, stockBefore: 0, stockAfter: 3, performedBy: "integrity-user", performedAt: now, reason: "Ajuste insuficiente",
      },
    ])
  })

  afterAll(async () => {
    await pg.close()
    testGlobal.__db = undefined
  })

  it("rejects an adjustment from another worksite without appending a resolution", async () => {
    await expect(resolveTraceabilityIntegrityCase({
      caseId: "integrity-case-wrong-adjustment",
      action: "compensating_movement",
      compensatingMovementId: "integrity-adjustment-other",
      reason: "El ajuste pertenece a otra faena y no puede usarse.",
      userId: "integrity-user",
      userEmail: "integrity@test.local",
      session,
    })).rejects.toThrow("misma faena")

    const resolutions = await inMemoryDb.select().from(schema.traceabilityIntegrityResolutions)
    expect(resolutions).toHaveLength(0)
  })

  // TRZ-002: la unicidad pasó a ser por ocurrencia. Esta prueba sigue siendo
  // válida —cerrar dos veces la MISMA ocurrencia sigue prohibido— y lo que ya
  // no consagra es que el caso quede cerrado para siempre.
  it("appends one resolution and prevents a second resolution for the same case", async () => {
    const input = {
      caseId: "integrity-case-resolve-once",
      action: "compensating_movement" as const,
      compensatingMovementId: "integrity-adjustment-own",
      reason: "Se vincula el ajuste ya registrado para documentar la excepción.",
      userId: "integrity-user",
      userEmail: "integrity@test.local",
      session,
    }
    await resolveTraceabilityIntegrityCase(input)
    await expect(resolveTraceabilityIntegrityCase(input)).rejects.toThrow("ya fue regularizado")

    const resolutions = await inMemoryDb.select().from(schema.traceabilityIntegrityResolutions)
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]).toMatchObject({
      caseId: "integrity-case-resolve-once",
      action: "compensating_movement",
      compensatingMovementId: "integrity-adjustment-own",
    })
  })

  it("excludes a free stock delivery without requestItemId from findings", async () => {
    await inMemoryDb.insert(schema.deliveries).values({
      id: "integrity-free-delivery", code: "ENT-INTEGRITY-FREE", deliveredBy: "integrity-user",
      deliveredAt: now, destinationType: "faena", worksiteId: "integrity-ws", createdAt: now,
    })
    await inMemoryDb.insert(schema.deliveryItems).values({
      id: "integrity-free-delivery-item", deliveryId: "integrity-free-delivery", requestItemId: null,
      productId: "integrity-product", productNameFree: null, quantity: 1, unitOfMeasure: "unidad",
    })

    const result = await scanTraceabilityIntegrity(session)
    expect(result.findings).toEqual([])
    expect(result.recordedCount).toBe(0)
  })

  // TR-02 (auditoría 2026-09-05): una entrega anulada no entregó nada y no
  // puede abastecer el balance trazable. El detector SIGUE contándola porque
  // su consulta no filtra `voidedAt`, así que una entrega de 10 anulada sin
  // recepción genera `DELIVERY_EXCEEDS_FAENA_RECEIPT` con exceso 10 y guarda
  // un caso falso que contamina los pendientes de integridad. Este test
  // describe el comportamiento esperado tras el arreglo: encontrar 0.
  it("no trata una entrega anulada como material entregado (TR-02)", async () => {
    await inMemoryDb.insert(schema.deliveries).values({
      id: "integrity-voided-delivery", code: "ENT-INTEGRITY-VOIDED", deliveredBy: "integrity-user",
      deliveredAt: now, destinationType: "faena", worksiteId: "integrity-ws", createdAt: now,
      voidedAt: now, voidedBy: "integrity-user", voidReason: "Error de digitación en la entrega",
    })
    await inMemoryDb.insert(schema.deliveryItems).values({
      id: "integrity-voided-delivery-item", deliveryId: "integrity-voided-delivery",
      requestItemId: "integrity-request-item", productId: "integrity-product", quantity: 10,
      unitOfMeasure: "unidad",
    })

    const result = await scanTraceabilityIntegrity(session)
    expect(result.findings).toEqual([])
    expect(result.recordedCount).toBe(0)
  })

  // OP-04 (auditoría 2026-09-05): el ajuste compensatorio debe reparar
  // materialmente el caso. Antes bastaba con la misma faena y un tipo
  // `ajuste`: un ajuste de botas "compensaba" un exceso de cascos y el caso
  // quedaba regularizado con evidencia que no respaldaba la corrección.
  it("rechaza un ajuste compensatorio de otro producto (OP-04)", async () => {
    await expect(resolveTraceabilityIntegrityCase({
      caseId: "integrity-case-excess",
      action: "compensating_movement",
      compensatingMovementId: "integrity-adjustment-wrong-product",
      reason: "Se intenta compensar el exceso con un ajuste de botas, no de cascos.",
      userId: "integrity-user",
      userEmail: "integrity@test.local",
      session,
    })).rejects.toThrow("mismo producto")

    const resolutions = await inMemoryDb.select().from(schema.traceabilityIntegrityResolutions)
    expect(resolutions.some((r) => r.compensatingMovementId === "integrity-adjustment-wrong-product")).toBe(false)
  })

  it("rechaza un ajuste compensatorio de magnitud insuficiente (OP-04)", async () => {
    await expect(resolveTraceabilityIntegrityCase({
      caseId: "integrity-case-excess",
      action: "compensating_movement",
      compensatingMovementId: "integrity-adjustment-insufficient",
      reason: "Se intenta compensar un exceso de 10 unidades con un ajuste de 3.",
      userId: "integrity-user",
      userEmail: "integrity@test.local",
      session,
    })).rejects.toThrow("al menos el exceso")

    const resolutions = await inMemoryDb.select().from(schema.traceabilityIntegrityResolutions)
    expect(resolutions.some((r) => r.compensatingMovementId === "integrity-adjustment-insufficient")).toBe(false)
  })

  it("acepta un ajuste compensatorio del mismo producto con magnitud suficiente (OP-04)", async () => {
    // `integrity-adjustment-own` es del mismo producto y cantidad 1; para
    // cubrir un exceso de 10 hace falta uno mayor. Se usa un ajuste propio
    // del mismo producto con cantidad 10, que sí compensa.
    await inMemoryDb.insert(schema.inventoryMovements).values({
      id: "integrity-adjustment-sufficient", worksiteId: "integrity-ws", productId: "integrity-product", type: "ajuste",
      quantity: 10, stockBefore: 0, stockAfter: 10, performedBy: "integrity-user", performedAt: now, reason: "Ajuste que compensa el exceso",
    })

    await resolveTraceabilityIntegrityCase({
      caseId: "integrity-case-excess",
      action: "compensating_movement",
      compensatingMovementId: "integrity-adjustment-sufficient",
      reason: "Se vincula el ajuste de 10 unidades que compensa el exceso detectado.",
      userId: "integrity-user",
      userEmail: "integrity@test.local",
      session,
    })

    const resolutions = await inMemoryDb.select().from(schema.traceabilityIntegrityResolutions)
    expect(resolutions.some((r) => r.compensatingMovementId === "integrity-adjustment-sufficient")).toBe(true)
  })

  /**
   * TRZ-001 (auditoría 2026-09-14): el escaneo recortaba por el alcance de
   * quien pulsaba el botón, de modo que una persona de faena sólo revisaba las
   * suyas y la cobertura global dependía de que un usuario global entrara a la
   * pantalla. La variante de sistema existe justamente para eso.
   */
  describe("TRZ-001 — cobertura del escaneo programado", () => {
    async function seedFindingInOtherWorksite() {
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: "trz-request-other", code: "SOL-TRZ-OTHER", worksiteId: "integrity-ws-other",
        requesterId: "integrity-user", requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: "trz-item-other", requestId: "trz-request-other", productId: "integrity-product",
        quantity: 5, unitOfMeasure: "unidad", status: "received", createdAt: now, updatedAt: now,
      })
      // Entrega sin recepción en faena: es el hallazgo que este libro detecta y
      // que el libro nuevo (el que sí tenía cron) no mira.
      await inMemoryDb.insert(schema.deliveries).values({
        id: "trz-delivery-other", code: "ENT-TRZ-OTHER", deliveredBy: "integrity-user",
        deliveredAt: now, destinationType: "faena", worksiteId: "integrity-ws-other", createdAt: now,
      })
      await inMemoryDb.insert(schema.deliveryItems).values({
        id: "trz-delivery-item-other", deliveryId: "trz-delivery-other",
        requestItemId: "trz-item-other", productId: "integrity-product",
        quantity: 5, unitOfMeasure: "unidad",
      })
    }

    it("una sesión acotada a su faena no ve el problema de la faena vecina", async () => {
      await seedFindingInOtherWorksite()
      const deFaena = {
        ...session,
        user: { ...session.user, isGlobal: false, worksiteIds: ["integrity-ws"] },
      } as Session

      const result = await scanTraceabilityIntegrity(deFaena)
      expect(result.findings.some((f) => f.worksiteId === "integrity-ws-other")).toBe(false)
    })

    it("el escaneo de sistema sí lo ve: no depende de quién lo dispare", async () => {
      const result = await scanTraceabilityIntegrityAsSystem()
      expect(result.findings.some((f) => f.worksiteId === "integrity-ws-other")).toBe(true)
    })

    it("registra el caso una vez: correr el cron a diario no acumula duplicados", async () => {
      const primera = await scanTraceabilityIntegrityAsSystem()
      const segunda = await scanTraceabilityIntegrityAsSystem()
      expect(primera.findings.length).toBe(segunda.findings.length)
      expect(segunda.recordedCount).toBe(0)
    })
  })

  /**
   * TRZ-002 (auditoría 2026-09-14): un caso se cerraba por declaración
   * (`acknowledge`, sólo un motivo) y quedaba cerrado **para siempre**: el
   * índice único por caso impedía una segunda resolución y `finding_key`
   * único impedía que el escaneo lo recreara. Si el descuadre persistía, el
   * libro decía "regularizado" sobre algo que seguía roto.
   *
   * Antes de la corrección, la última aserción de la primera prueba fallaba
   * (`reopenedCount` era estructuralmente 0) y la resolución posterior
   * lanzaba "Este caso ya fue regularizado".
   */
  describe("TRZ-002 — reapertura de un caso que sigue descuadrado", () => {
    beforeAll(async () => {
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: "trz002-request", code: "SOL-TRZ002", worksiteId: "integrity-ws",
        requesterId: "integrity-user", requestType: "epp", urgency: "normal",
        status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: "trz002-item", requestId: "trz002-request", productId: "integrity-product",
        quantity: 3, unitOfMeasure: "unidad", status: "received", createdAt: now, updatedAt: now,
      })
      // Entrega trazable sin recepción en faena: el descuadre no se repara
      // solo, así que cada escaneo lo vuelve a encontrar.
      await inMemoryDb.insert(schema.deliveries).values({
        id: "trz002-delivery", code: "ENT-TRZ002", deliveredBy: "integrity-user",
        deliveredAt: now, destinationType: "faena", worksiteId: "integrity-ws", createdAt: now,
      })
      await inMemoryDb.insert(schema.deliveryItems).values({
        id: "trz002-delivery-item", deliveryId: "trz002-delivery",
        requestItemId: "trz002-item", productId: "integrity-product",
        quantity: 3, unitOfMeasure: "unidad",
      })
    })

    async function caseRow() {
      const [row] = await inMemoryDb.select().from(schema.traceabilityIntegrityCases)
        .where(eq(schema.traceabilityIntegrityCases.requestItemId, "trz002-item"))
      return row
    }

    it("el escaneo reabre un caso ya regularizado cuando el detector lo vuelve a encontrar", async () => {
      await scanTraceabilityIntegrityAsSystem()
      const abierto = await caseRow()
      expect(abierto).toBeDefined()
      expect(abierto!.occurrence).toBe(1)

      await resolveTraceabilityIntegrityCase({
        caseId: abierto!.id,
        action: "acknowledge",
        reason: "Se cierra por declaración sin reparar el descuadre material.",
        userId: "integrity-user",
        userEmail: "integrity@test.local",
        session,
      })

      // El descuadre sigue ahí: el detector lo encuentra otra vez.
      const segunda = await scanTraceabilityIntegrityAsSystem()
      expect(segunda.reopenedCount).toBeGreaterThanOrEqual(1)
      const reabierto = await caseRow()
      expect(reabierto!.occurrence).toBe(2)
    })

    it("un caso reabierto vuelve a figurar como pendiente y admite una resolución nueva", async () => {
      const reabierto = await caseRow()
      expect(reabierto!.occurrence).toBe(2)

      const listado = await listTraceabilityIntegrityCases(session)
      const fila = listado.find((row) => row.id === reabierto!.id)
      // Antes de TRZ-002 la pantalla lo seguía mostrando "Regularizado".
      expect(fila?.resolutionId).toBeNull()

      await resolveTraceabilityIntegrityCase({
        caseId: reabierto!.id,
        action: "acknowledge",
        reason: "Segunda regularización tras la reapertura del caso persistente.",
        userId: "integrity-user",
        userEmail: "integrity@test.local",
        session,
      })

      const resoluciones = await inMemoryDb.select().from(schema.traceabilityIntegrityResolutions)
        .where(eq(schema.traceabilityIntegrityResolutions.caseId, reabierto!.id))
      // La resolución anterior no se reescribe: queda atada a su ocurrencia.
      expect(resoluciones.map((row) => row.occurrence).sort()).toEqual([1, 2])
    })
  })

})
