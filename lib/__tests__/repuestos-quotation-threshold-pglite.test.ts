/**
 * Umbral de cotizaciones de repuestos y aprobación sin cotización (2026-11-07).
 *
 * - `submitRequest` aplica `evaluateQuotationRequirement` dentro de la
 *   transacción: bajo el umbral (`ops.repuestos.quotation_threshold_clp`) basta
 *   el precio estimado; sobre él vuelve la regla de 3 cotizaciones o
 *   justificación; la urgencia crítica con equipo detenido o con OT permite la
 *   vía rápida con justificación. Servicios conserva la regla legada.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof testDb }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const { createWorkOrderWithClient } = await import("@/lib/services/mantencion/work-orders/create")
const { submitRequest } = await import("@/lib/requests/request-service-module/submit-request")
const { quotationRequirementMessage } = await import("@/lib/requests/quotation-requirement")
const { OPS_SETTING_KEYS } = await import("@/lib/services/system-settings")

const repuestos = { requestType: "repuestos", quotationsTable: schema.repuestoQuotations } as const
const servicios = { requestType: "servicios", quotationsTable: schema.serviceQuotations } as const

const now = new Date().toISOString()
let workOrderId = ""
let counter = 0

interface DraftOptions {
  type?: "repuestos" | "servicios"
  urgency?: "normal" | "high" | "critical"
  notes?: string | null
  items: Array<{ quantity?: number; price?: number | null; vehicleId?: string; workOrderId?: string; supplierId?: string }>
  quotations?: number[]
  worksiteId?: string
}

/** Una solicitud en borrador con sus ítems `draft` y sus cotizaciones `pending`. */
async function draftRequest(options: DraftOptions): Promise<string> {
  counter += 1
  const id = `req-thr-${counter}`
  const type = options.type ?? "repuestos"
  await testDb.insert(schema.purchaseRequests).values({
    id, code: `${type === "repuestos" ? "REP" : "SER"}-THR-${counter}`, worksiteId: options.worksiteId ?? IDS.wsBio,
    requesterId: IDS.jefe, requestType: type, status: "draft", urgency: options.urgency ?? "normal",
    deliveryMode: "directo_faena", notes: options.notes ?? null, createdAt: now, updatedAt: now,
  })
  await testDb.insert(schema.purchaseRequestItems).values(options.items.map((item, index) => ({
    id: `${id}-i${index}`, requestId: id, productNameFree: `Repuesto ${index}`, quantity: item.quantity ?? 1, status: "draft",
    estimatedUnitPrice: item.price === undefined ? null : item.price,
    vehicleId: item.vehicleId ?? null, workOrderId: item.workOrderId ?? null,
    suggestedSupplierId: item.supplierId ?? null, sortOrder: index, createdAt: now, updatedAt: now,
  })))
  for (const [index, total] of (options.quotations ?? []).entries()) {
    const quotation = {
      id: `${id}-q${index}`, requestId: id, supplierNameFree: `Proveedor ${index}`, fileName: `cot-${index}.pdf`,
      filePath: `storage/cot-${index}.pdf`, totalAmount: total, status: "pending",
    }
    if (type === "repuestos") await testDb.insert(schema.repuestoQuotations).values(quotation)
    else await testDb.insert(schema.serviceQuotations).values(quotation)
  }
  return id
}

const submit = (requestId: string, config: typeof repuestos | typeof servicios = repuestos) =>
  submitRequest(config, { requestId, userId: IDS.jefe })

async function statusOf(requestId: string) {
  const [row] = await testDb.select({ status: schema.purchaseRequests.status }).from(schema.purchaseRequests)
    .where(eq(schema.purchaseRequests.id, requestId))
  return row?.status
}

async function itemStatuses(requestId: string) {
  const rows = await testDb.select({ status: schema.purchaseRequestItems.status }).from(schema.purchaseRequestItems)
    .where(eq(schema.purchaseRequestItems.requestId, requestId))
  return rows.map((row) => row.status)
}

async function setThreshold(value: number | null) {
  const key = OPS_SETTING_KEYS.repuestosQuotationThresholdClp
  await testDb.delete(schema.systemSettings).where(eq(schema.systemSettings.key, key))
  if (value !== null) await testDb.insert(schema.systemSettings).values({ key, value: String(value), updatedAt: now })
}

beforeAll(async () => {
  await seedMantFixtures(testDb as unknown as DB)
  await testDb.insert(schema.suppliers).values({
    id: "sup-thr", name: "Repuestos del Sur", rut: "76.000.222-2", isActive: true, createdAt: now, updatedAt: now,
  })
  const created = await testDb.transaction((tx) => createWorkOrderWithClient(tx as never, {
    vehicleId: IDS.truckBio, inspectionFindingId: null, repair: true, maintenance: false,
    repairDescription: "Fuga hidráulica", observations: null, requesterName: "Alexis Morales",
  }, { userId: IDS.jefe, name: "Alexis Morales" }))
  workOrderId = created.id
})

afterAll(async () => {
  await pg.close()
})

describe("submitRequest · umbral de cotizaciones de repuestos", () => {
  it("submit bajo umbral sin cotización pasa", async () => {
    await setThreshold(null) // sin ajuste guardado: rige el predeterminado de $500.000
    const id = await draftRequest({ items: [{ quantity: 2, price: 20_000 }] })

    await submit(id)

    expect(await statusOf(id)).toBe("submitted")
    expect(await itemStatuses(id)).toEqual(["requested"])
  })

  it("el monto estimado es la suma de cantidad por precio de todos los ítems", async () => {
    await setThreshold(100_000)
    // 3 × 20.000 + 1 × 50.000 = 110.000 > 100.000
    const id = await draftRequest({ items: [{ quantity: 3, price: 20_000 }, { quantity: 1, price: 50_000 }] })

    await expect(submit(id)).rejects.toThrow(quotationRequirementMessage("needs_quotation", 100_000))
    expect(await statusOf(id)).toBe("draft")
    expect(await itemStatuses(id)).toEqual(["draft", "draft"])
  })

  it("submit sobre umbral sin cotización falla con el monto en el mensaje", async () => {
    await setThreshold(null)
    const id = await draftRequest({ items: [{ price: 900_000 }] })

    const error = await submit(id).then(() => null, (e: Error) => e)

    expect(error?.message).toBe(quotationRequirementMessage("needs_quotation", 500_000))
    expect(error?.message).toContain("500.000")
    expect(await statusOf(id)).toBe("draft")
  })

  it("sin cotización ni precio estimado en todos los ítems falla", async () => {
    await setThreshold(null)
    // Al segundo ítem le falta el precio: no hay cómo medir el monto.
    const id = await draftRequest({ items: [{ price: 10_000 }, { price: null }] })

    await expect(submit(id)).rejects.toThrow(quotationRequirementMessage("no_quotation_or_estimate", 500_000))
    expect(await statusOf(id)).toBe("draft")
  })

  it("umbral 0 nunca exime", async () => {
    await setThreshold(0)
    const id = await draftRequest({ items: [{ price: 1_000 }] })

    await expect(submit(id)).rejects.toThrow(quotationRequirementMessage("needs_quotation", 0))
    expect(await statusOf(id)).toBe("draft")
  })

  it("un umbral más alto exime lo que antes se bloqueaba", async () => {
    await setThreshold(1_000_000)
    const id = await draftRequest({ items: [{ price: 900_000 }] })

    await submit(id)

    expect(await statusOf(id)).toBe("submitted")
  })

  it("bajo el umbral una sola cotización basta, sin justificación", async () => {
    await setThreshold(null)
    const id = await draftRequest({ items: [{ price: null }], quotations: [150_000] })

    await submit(id)

    expect(await statusOf(id)).toBe("submitted")
  })

  it("manda la mayor de las cotizaciones: una sobre el umbral exige las tres o justificación", async () => {
    await setThreshold(null)
    const id = await draftRequest({ items: [{ price: 10_000 }], quotations: [200_000, 800_000] })

    await expect(submit(id)).rejects.toThrow(quotationRequirementMessage("needs_three", 500_000))
    expect(await statusOf(id)).toBe("draft")
  })

  it("sobre el umbral con una cotización y notas pasa", async () => {
    await setThreshold(null)
    const id = await draftRequest({ items: [{ price: null }], quotations: [800_000], notes: "Proveedor único de la pieza" })

    await submit(id)

    expect(await statusOf(id)).toBe("submitted")
  })

  it("sobre el umbral con tres cotizaciones pasa sin notas", async () => {
    await setThreshold(null)
    const id = await draftRequest({ items: [{ price: null }], quotations: [800_000, 900_000, 950_000] })

    await submit(id)

    expect(await statusOf(id)).toBe("submitted")
  })

  describe("vía rápida", () => {
    it("urgencia crítica con el equipo detenido exige justificación para enviar sin cotización", async () => {
      await setThreshold(null)
      await testDb.update(schema.fuelVehicles).set({ operationalStatus: "detenido" })
        .where(eq(schema.fuelVehicles.id, IDS.machineBio))
      const id = await draftRequest({ urgency: "critical", items: [{ price: 900_000, vehicleId: IDS.machineBio }] })

      await expect(submit(id)).rejects.toThrow(quotationRequirementMessage("needs_justification", 500_000))
      expect(await statusOf(id)).toBe("draft")
    })

    it("urgencia crítica con el equipo detenido y justificación envía sin cotización", async () => {
      await setThreshold(null)
      const id = await draftRequest({
        urgency: "critical", notes: "Máquina detenida en faena, sin repuesto en bodega",
        items: [{ price: 900_000, vehicleId: IDS.machineBio }],
      })

      await submit(id)

      expect(await statusOf(id)).toBe("submitted")
    })

    it("urgencia crítica con una OT vinculada es vía rápida aunque el equipo esté operativo", async () => {
      await setThreshold(null)
      const sinNotas = await draftRequest({
        urgency: "critical", items: [{ price: 900_000, vehicleId: IDS.truckBio, workOrderId }],
      })
      await expect(submit(sinNotas)).rejects.toThrow(quotationRequirementMessage("needs_justification", 500_000))

      const conNotas = await draftRequest({
        urgency: "critical", notes: "OT detenida esperando la pieza",
        items: [{ price: 900_000, vehicleId: IDS.truckBio, workOrderId }],
      })
      await submit(conNotas)
      expect(await statusOf(conNotas)).toBe("submitted")
    })

    it("la urgencia alta no habilita la vía rápida, aunque haya equipo detenido", async () => {
      await setThreshold(null)
      const id = await draftRequest({
        urgency: "high", notes: "Urgente", items: [{ price: 900_000, vehicleId: IDS.machineBio }],
      })

      await expect(submit(id)).rejects.toThrow(quotationRequirementMessage("needs_quotation", 500_000))
    })

    it("urgencia crítica con el equipo operativo y sin OT no es vía rápida", async () => {
      await setThreshold(null)
      const id = await draftRequest({
        urgency: "critical", notes: "Lo necesito ya", items: [{ price: 900_000, vehicleId: IDS.truckBio }],
      })

      await expect(submit(id)).rejects.toThrow(quotationRequirementMessage("needs_quotation", 500_000))
    })
  })

  describe("servicios conserva la regla de siempre", () => {
    it("sin cotización falla aunque haya precios estimados bajo el umbral", async () => {
      await setThreshold(null)
      const id = await draftRequest({ type: "servicios", items: [{ price: 10_000 }] })

      await expect(submit(id, servicios)).rejects.toThrow(quotationRequirementMessage("needs_quotation", null))
      expect(await statusOf(id)).toBe("draft")
    })

    it("con menos de 3 cotizaciones exige justificación, sin importar el monto", async () => {
      await setThreshold(null)
      const id = await draftRequest({ type: "servicios", items: [{ price: null }], quotations: [20_000, 30_000] })

      await expect(submit(id, servicios)).rejects.toThrow(quotationRequirementMessage("needs_three", null))

      await testDb.update(schema.purchaseRequests).set({ notes: "Único taller de la zona" })
        .where(eq(schema.purchaseRequests.id, id))
      await submit(id, servicios)
      expect(await statusOf(id)).toBe("submitted")
    })
  })
})
