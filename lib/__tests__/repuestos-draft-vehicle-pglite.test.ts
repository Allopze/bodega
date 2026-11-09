/**
 * Borrador de repuestos con equipo de flota, OT y precio estimado (2026-11-07):
 * el servidor valida el vínculo (equipo activo y de la faena de la solicitud, OT
 * abierta y del mismo equipo) con los mensajes que ve quien pide, y con equipo
 * elegido no guarda Equipo/Patente/Marca/Modelo como atributos libres.
 *
 * Catálogo de repuestos (2026-11-09): un ítem puede apuntar a un repuesto del
 * catálogo (`productId`). El servidor exige que exista, sea repuesto y esté
 * activo; con producto guarda `product_id`, no copia el nombre ni el N° de parte,
 * y servicios sigue siendo texto libre.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof testDb }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/email/smtp", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock("server-only", () => ({}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const { createWorkOrderWithClient } = await import("@/lib/services/mantencion/work-orders/create")
const { createSparePartTx, setSparePartActive } = await import("@/lib/services/spare-parts-catalog")
const { persistRepuestoDraft } = await import("@/lib/services/repuestos")
const { persistServiceDraft } = await import("@/lib/services/servicios")

const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }

const session = { user: { id: IDS.jefe, email: "jefe@chome.test", name: "Alexis Morales" } } as unknown as Session

let openOtId = ""
let otherVehicleOtId = ""
const CLOSED_OT = "ot-cerrada"

function draft(item: Record<string, unknown>, worksiteId: string = IDS.wsBio, extra: Record<string, unknown> = {}) {
  return {
    worksiteId, urgency: "high" as const, requiredDate: "2099-12-01", justification: null,
    items: [{ description: "Manguera hidráulica", quantity: 2, unitOfMeasure: "unidad", ...item }],
    ...extra,
  }
}

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("Se esperaba que el borrador fuera rechazado")
}

async function savedItem(requestId: string) {
  const [item] = await testDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, requestId))
  const attributes = item
    ? await testDb.select().from(schema.requestItemAttributes).where(eq(schema.requestItemAttributes.requestItemId, item.id))
    : []
  return { item: item!, attributes: Object.fromEntries(attributes.map((attribute) => [attribute.attributeName, attribute.value])) }
}

describe("persistRepuestoDraft · equipo de flota, OT y precio estimado", () => {
  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    const actor = { userId: IDS.jefe, name: "Alexis Morales" }
    const open = await testDb.transaction((tx) => createWorkOrderWithClient(tx as never, {
      vehicleId: IDS.truckBio, inspectionFindingId: null, repair: true, maintenance: false,
      repairDescription: "Fuga hidráulica", observations: null, requesterName: "Alexis Morales",
    }, actor))
    openOtId = open.id
    const other = await testDb.transaction((tx) => createWorkOrderWithClient(tx as never, {
      vehicleId: IDS.machineBio, inspectionFindingId: null, repair: true, maintenance: false,
      repairDescription: "Cadena floja", observations: null, requesterName: "Alexis Morales",
    }, actor))
    otherVehicleOtId = other.id
    // Una OT cerrada del mismo camión: cumple los `check` del estado.
    await testDb.insert(schema.mantWorkOrders).values({
      id: CLOSED_OT, folio: "OT-TST-CERRADA", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, equipmentSnapshot: SNAPSHOT,
      repair: true, maintenance: false, requestDate: "2026-02-20", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
      repairDescription: "Falla de frenos en la cabina", status: "cerrada",
      assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-02-21T12:00:00Z",
      workshopKind: "interno", workshopEntryAt: "2026-02-22T08:00:00Z", estimatedDeliveryDate: "2026-02-25",
      startedAt: "2026-02-22T08:00:00Z", startedByUserId: IDS.mecBio,
      workshopExitAt: "2026-02-24T08:00:00Z", finishedAt: "2026-02-24T08:00:00Z", finishedByUserId: IDS.mecBio,
      receivedAt: "2026-02-24T09:00:00Z", receiverName: "Pedro Soto", receivedByUserId: IDS.jefe, receivedRecordedAt: "2026-02-24T09:00:00Z",
      faenaReceivedAt: "2026-02-25T09:00:00Z", faenaReceiverName: "Admin Contrato", faenaReceivedByUserId: IDS.jefe, closedAt: "2026-02-25T09:00:00Z",
    })
  })

  it("guarda el vehículo, la OT y el precio estimado del ítem", async () => {
    const requestId = await persistRepuestoDraft(session, draft({
      vehicleId: IDS.truckBio, workOrderId: openOtId, estimatedUnitPrice: 35_000,
    }))
    const { item } = await savedItem(requestId)
    expect(item).toMatchObject({ vehicleId: IDS.truckBio, workOrderId: openOtId, estimatedUnitPrice: 35_000, status: "draft" })
  })

  it("rechaza vehículo de otra faena", async () => {
    expect(await message(() => persistRepuestoDraft(session, draft({ vehicleId: IDS.truckCho }, IDS.wsBio))))
      .toBe("El equipo pertenece a otra faena")
  })

  it("rechaza un vehículo inexistente o dado de baja", async () => {
    expect(await message(() => persistRepuestoDraft(session, draft({ vehicleId: "v-no-existe" }))))
      .toBe("El equipo seleccionado no existe o está inactivo")
    expect(await message(() => persistRepuestoDraft(session, draft({ vehicleId: IDS.retired }))))
      .toBe("El equipo seleccionado no existe o está inactivo")
  })

  it("rechaza OT de otro vehículo", async () => {
    expect(await message(() => persistRepuestoDraft(session, draft({ vehicleId: IDS.truckBio, workOrderId: otherVehicleOtId }))))
      .toBe("La OT no corresponde al equipo elegido")
  })

  it("rechaza OT cerrada", async () => {
    expect(await message(() => persistRepuestoDraft(session, draft({ vehicleId: IDS.truckBio, workOrderId: CLOSED_OT }))))
      .toBe("La OT ya está cerrada o anulada")
  })

  it("rechaza una OT sin equipo con un mensaje legible, no con el check de la base", async () => {
    expect(await message(() => persistRepuestoDraft(session, draft({ workOrderId: openOtId }))))
      .toBe("La OT exige elegir el equipo de flota")
  })

  it("con vehículo no guarda atributos Equipo/Patente/Marca/Modelo", async () => {
    const requestId = await persistRepuestoDraft(session, draft({
      vehicleId: IDS.truckBio, partNumber: "OEM-77", equipmentName: "Camión viejo", patent: "ZZZZ-99", brand: "Otra", model: "X1",
    }))
    const { attributes } = await savedItem(requestId)
    // El N.° de parte es del repuesto, no del equipo: se conserva.
    expect(attributes).toEqual({ "N° de Parte": "OEM-77" })
  })

  it("sin vehículo conserva los campos libres como hasta ahora", async () => {
    const requestId = await persistRepuestoDraft(session, draft({
      equipmentName: "Generador", patent: "GEN-01", brand: "Honda", model: "EU70",
    }))
    const { item, attributes } = await savedItem(requestId)
    expect(item).toMatchObject({ vehicleId: null, workOrderId: null, estimatedUnitPrice: null })
    expect(attributes).toEqual({ Equipo: "Generador", "Patente/Código": "GEN-01", Marca: "Honda", Modelo: "EU70" })
  })

  it("guarda estimated_unit_price", async () => {
    const requestId = await persistRepuestoDraft(session, draft({ estimatedUnitPrice: 12_500.5 }))
    const { item } = await savedItem(requestId)
    expect(item.estimatedUnitPrice).toBe(12_500.5)
  })

  it("también aplica a servicios: vehículo de otra faena rechazado", async () => {
    expect(await message(() => persistServiceDraft(session, draft({ vehicleId: IDS.truckCho, location: "Taller" }, IDS.wsBio))))
      .toBe("El equipo pertenece a otra faena")
  })

  it("sin despacho elegido, repuestos y servicios nacen directo a faena", async () => {
    const repuestos = await persistRepuestoDraft(session, draft({}))
    const servicios = await persistServiceDraft(session, draft({ location: "Taller" }))
    const rows = await testDb.select({ id: schema.purchaseRequests.id, deliveryMode: schema.purchaseRequests.deliveryMode })
      .from(schema.purchaseRequests)
    expect(rows.find((row) => row.id === repuestos)?.deliveryMode).toBe("directo_faena")
    expect(rows.find((row) => row.id === servicios)?.deliveryMode).toBe("directo_faena")

    // Un despacho elegido por el solicitante se respeta.
    const viaOficina = await persistRepuestoDraft(session, draft({}, IDS.wsBio, { deliveryMode: "via_oficina" }))
    const [row] = await testDb.select({ deliveryMode: schema.purchaseRequests.deliveryMode })
      .from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, viaOficina))
    expect(row?.deliveryMode).toBe("via_oficina")
  })
})

describe("persistRepuestoDraft · repuesto del catálogo", () => {
  let partId = ""
  let inactivePartId = ""

  async function createPart(name: string, partNumber: string, partBrand: string | null = null) {
    return testDb.transaction((tx) => createSparePartTx(tx as unknown as Tx, {
      name, partNumber, partBrand, unitOfMeasure: "unidad", createdByUserId: IDS.jefe,
    }))
  }

  beforeAll(async () => {
    const part = await createPart("Filtro de aceite", "1R-0750", "Caterpillar")
    partId = part.id
    const inactive = await createPart("Filtro de aire", "AF-25", "Donaldson")
    inactivePartId = inactive.id
    await setSparePartActive(inactive.id, false)
    // Un producto que no es repuesto (un EPP corriente): el CHECK de la base sólo
    // impide lo contrario, así que nada lo frena si el cliente manda su id.
    await testDb.insert(schema.products).values({
      id: "prod-casco-cat", sku: "EPP-CAT-1", name: "Casco de seguridad", categoryId: "cat-repuestos",
      unitOfMeasure: "unidad", isEpp: true,
    })
  })

  it("guarda el repuesto como producto y no copia su nombre ni el N° de parte", async () => {
    const requestId = await persistRepuestoDraft(session, draft({
      productId: partId, description: "", partNumber: "OTRO-NUMERO", vehicleId: IDS.truckBio, estimatedUnitPrice: 18_900,
    }))
    const { item, attributes } = await savedItem(requestId)
    expect(item).toMatchObject({
      productId: partId, productNameFree: null, vehicleId: IDS.truckBio, estimatedUnitPrice: 18_900, status: "draft",
    })
    // El N° de parte lo dice el producto: no queda una segunda copia como atributo.
    expect(attributes).toEqual({})
  })

  it("con un repuesto conserva el resto de los campos libres del equipo", async () => {
    const requestId = await persistRepuestoDraft(session, draft({
      productId: partId, description: "", equipmentName: "Generador", patent: "GEN-01", brand: "Honda", model: "EU70",
    }))
    const { attributes } = await savedItem(requestId)
    expect(attributes).toEqual({ Equipo: "Generador", "Patente/Código": "GEN-01", Marca: "Honda", Modelo: "EU70" })
  })

  it("sin producto sigue guardando el texto libre y su N° de parte", async () => {
    const requestId = await persistRepuestoDraft(session, draft({ productId: null, description: "Manguera hidráulica", partNumber: "MH-9" }))
    const { item, attributes } = await savedItem(requestId)
    expect(item).toMatchObject({ productId: null, productNameFree: "Manguera hidráulica" })
    expect(attributes).toEqual({ "N° de Parte": "MH-9" })
  })

  it("rechaza un producto que no es un repuesto de catálogo", async () => {
    expect(await message(() => persistRepuestoDraft(session, draft({ productId: "prod-casco-cat", description: "" }))))
      .toBe("«Casco de seguridad» no es un repuesto del catálogo")
  })

  it("rechaza un repuesto inactivo diciendo cuál es y qué hacer", async () => {
    expect(await message(() => persistRepuestoDraft(session, draft({ productId: inactivePartId, description: "" }))))
      .toBe("El repuesto «Filtro de aire» (RPT-002) está inactivo: elige otro o descríbelo con texto libre")
  })

  it("rechaza un producto que ya no existe", async () => {
    expect(await message(() => persistRepuestoDraft(session, draft({ productId: "prod-no-existe", description: "" }))))
      .toBe("El repuesto elegido ya no existe en el catálogo")
  })

  it("un ítem rechazado no deja la solicitud a medias", async () => {
    const before = (await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length
    await message(() => persistRepuestoDraft(session, {
      ...draft({ productId: partId, description: "" }),
      items: [
        { description: "", productId: partId, quantity: 1, unitOfMeasure: "unidad" },
        { description: "", productId: "prod-casco-cat", quantity: 1, unitOfMeasure: "unidad" },
      ],
    }))
    const after = (await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length
    expect(after).toBe(before)
  })

  it("al editar el borrador se puede pasar de un repuesto de catálogo a texto libre", async () => {
    const requestId = await persistRepuestoDraft(session, draft({ productId: partId, description: "" }))
    await persistRepuestoDraft(session, draft({ productId: null, description: "Filtro genérico" }, IDS.wsBio, { id: requestId }))
    const { item } = await savedItem(requestId)
    expect(item).toMatchObject({ productId: null, productNameFree: "Filtro genérico" })
  })

  it("servicios no ofrece catálogo: ignora el producto y guarda el texto", async () => {
    const requestId = await persistServiceDraft(session, draft({ productId: partId, description: "Cambio de filtros", location: "Taller" }))
    const { item } = await savedItem(requestId)
    expect(item).toMatchObject({ productId: null, productNameFree: "Cambio de filtros" })
  })
})

afterAll(async () => {
  await pg.close()
})
