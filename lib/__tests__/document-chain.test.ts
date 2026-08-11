import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const { findDocumentByCode, getDocumentChain, getDocumentChainByCode } =
  await import("@/lib/services/document-chain")

const now = new Date().toISOString()
const ALL_PERMISSIONS = ["requests:view_all", "purchasing:view", "receiving:view", "warehouse:view_guides", "deliveries:view"]

function session(overrides: {
  permissions?: string[]
  worksiteIds?: string[]
  isGlobal?: boolean
} = {}): Session {
  return {
    user: {
      id: "user-chain",
      permissions: overrides.permissions ?? ALL_PERMISSIONS,
      worksiteIds: overrides.worksiteIds ?? [],
      isGlobal: overrides.isGlobal ?? true,
    },
  } as unknown as Session
}

const codes = (docs: { code: string }[]) => docs.map((doc) => doc.code)

/**
 * El expediente se resuelve desde cualquier eslabón, y la relación entre libros
 * es N:M en casi cada salto. Los datos montan justamente esa forma:
 *
 *   SOL-0001 ─┬─ ítem A ──┬─ OC-2026-0001 ── REC-2026-0001
 *             │           └─ ENT-2026-0001
 *             └─ ítem B ──── (sin OC: muere en la solicitud)
 *   SOL-0002 ─── ítem C ──── OC-2026-0001   ← la misma OC, otra solicitud
 *   SOL-0003 ─── ítem D ──── (nunca llega a OC)
 *   OC-2026-0002 ── ítem sin solicitud (compra directa) ── REC-2026-0002
 */
describe("expediente de documentos", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

    await inMemoryDb.insert(schema.users).values([
      { id: "user-chain", name: "Operador", email: "chain@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
      // SOL-0002 es de un compañero: la OC mezcla líneas de ambos, que es lo que
      // pone a prueba `requests:view_own` en la cadena.
      { id: "user-otro",  name: "Compañero", email: "otro@local.invalid",  hashedPassword: "hash", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-norte", name: "Faena Norte", code: "FN", createdAt: now, updatedAt: now },
      { id: "ws-sur",   name: "Faena Sur",   code: "FS", createdAt: now, updatedAt: now },
      { id: "ws-office", name: "Oficina CHOME", code: "OF", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-1", name: "Proveedor", rut: "76000000-0", createdAt: now, updatedAt: now,
    })

    await inMemoryDb.insert(schema.purchaseRequests).values([
      { id: "req-1", code: "SOL-0001", worksiteId: "ws-norte", requesterId: "user-chain", requestType: "epp", urgency: "normal", status: "approved", createdAt: now, updatedAt: now },
      { id: "req-2", code: "SOL-0002", worksiteId: "ws-norte", requesterId: "user-otro",  requestType: "epp", urgency: "normal", status: "approved", createdAt: now, updatedAt: now },
      { id: "req-3", code: "SOL-0003", worksiteId: "ws-sur",   requesterId: "user-chain", requestType: "epp", urgency: "normal", status: "submitted", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      { id: "item-a", requestId: "req-1", quantity: 2, unitOfMeasure: "unidad", status: "in_purchase_order", createdAt: now, updatedAt: now },
      { id: "item-b", requestId: "req-1", quantity: 1, unitOfMeasure: "unidad", status: "approved", createdAt: now, updatedAt: now },
      { id: "item-c", requestId: "req-2", quantity: 3, unitOfMeasure: "unidad", status: "in_purchase_order", createdAt: now, updatedAt: now },
      { id: "item-d", requestId: "req-3", quantity: 1, unitOfMeasure: "unidad", status: "approved", createdAt: now, updatedAt: now },
    ])

    await inMemoryDb.insert(schema.purchaseOrders).values([
      { id: "oc-1", code: "OC-2026-0001", worksiteId: "ws-norte", supplierId: "sup-1", createdBy: "user-chain", status: "received", createdAt: now, updatedAt: now },
      { id: "oc-2", code: "OC-2026-0002", worksiteId: "ws-norte", supplierId: "sup-1", createdBy: "user-chain", status: "received", createdAt: now, updatedAt: now },
    ])
    // ARQ-12: purchase_order_items.status sólo es 'issued'/'cancelled' — la
    // recepción de estas líneas la representan los receiptItems de abajo.
    await inMemoryDb.insert(schema.purchaseOrderItems).values([
      { id: "oci-a", purchaseOrderId: "oc-1", requestItemId: "item-a", quantity: 2, unitOfMeasure: "unidad", unitPrice: 100, subtotal: 200, status: "issued" },
      { id: "oci-c", purchaseOrderId: "oc-1", requestItemId: "item-c", quantity: 3, unitOfMeasure: "unidad", unitPrice: 100, subtotal: 300, status: "issued" },
      // Compra directa: la OC no nace de ninguna solicitud.
      { id: "oci-x", purchaseOrderId: "oc-2", requestItemId: null, productNameFree: "Insumo directo", quantity: 1, unitOfMeasure: "unidad", unitPrice: 500, subtotal: 500, status: "issued" },
    ])

    await inMemoryDb.insert(schema.receipts).values([
      { id: "rec-1", code: "REC-2026-0001", purchaseOrderId: "oc-1", receivedBy: "user-chain", receivedAt: now, locationType: "faena", worksiteId: "ws-norte", createdAt: now },
      { id: "rec-2", code: "REC-2026-0002", purchaseOrderId: "oc-2", receivedBy: "user-chain", receivedAt: now, locationType: "faena", worksiteId: "ws-norte", createdAt: now },
    ])
    await inMemoryDb.insert(schema.receiptItems).values([
      { id: "reci-1", receiptId: "rec-1", purchaseOrderItemId: "oci-a", quantityReceived: 2, status: "received" },
      { id: "reci-2", receiptId: "rec-2", purchaseOrderItemId: "oci-x", quantityReceived: 1, status: "received" },
    ])

    await inMemoryDb.insert(schema.dispatchGuides).values({
      id: "gdi-chain-1",
      code: "GDI-2026-0001",
      status: "received",
      originWorksiteId: "ws-office",
      destinationWorksiteId: "ws-norte",
      purchaseOrderId: "oc-1",
      receiptId: "rec-1",
      issuedBy: "user-chain",
      issuedAt: now,
      dispatchedAt: now,
      dispatchedBy: "user-chain",
      receivedAt: now,
      receivedBy: "user-chain",
      createdAt: now,
      updatedAt: now,
    })

    await inMemoryDb.insert(schema.deliveries).values({
      id: "ent-1", code: "ENT-2026-0001", deliveredBy: "user-chain", deliveredAt: now,
      destinationType: "faena", worksiteId: "ws-norte", createdAt: now,
    })
    await inMemoryDb.insert(schema.deliveryItems).values({
      id: "enti-1", deliveryId: "ent-1", requestItemId: "item-a", quantity: 2, unitOfMeasure: "unidad",
    })
  })

  afterAll(async () => { await pg.close() })

  it("resuelve un código de cualquiera de los cuatro libros", async () => {
    await expect(findDocumentByCode("SOL-0001")).resolves.toEqual({ kind: "request", id: "req-1" })
    await expect(findDocumentByCode("OC-2026-0001")).resolves.toEqual({ kind: "order", id: "oc-1" })
    await expect(findDocumentByCode("REC-2026-0001")).resolves.toEqual({ kind: "receipt", id: "rec-1" })
    await expect(findDocumentByCode("GDI-2026-0001")).resolves.toEqual({ kind: "dispatchGuide", id: "gdi-chain-1" })
    await expect(findDocumentByCode("ENT-2026-0001")).resolves.toEqual({ kind: "delivery", id: "ent-1" })
    // Sin prefijo conocido y con espacios/minúsculas: se normaliza igual.
    await expect(findDocumentByCode("  oc-2026-0001 ")).resolves.toEqual({ kind: "order", id: "oc-1" })
    await expect(findDocumentByCode("OC-2026-9999")).resolves.toBeNull()
    await expect(findDocumentByCode("   ")).resolves.toBeNull()
  })

  it("desde la OC muestra TODAS las solicitudes que la alimentaron, no sólo una", async () => {
    const chain = await getDocumentChain(session(), { kind: "order", id: "oc-1" })
    expect(codes(chain.requests)).toEqual(["SOL-0001", "SOL-0002"])
    expect(codes(chain.orders)).toEqual(["OC-2026-0001"])
    expect(codes(chain.receipts)).toEqual(["REC-2026-0001"])
    expect(codes(chain.dispatchGuides)).toEqual(["GDI-2026-0001"])
    expect(codes(chain.deliveries)).toEqual(["ENT-2026-0001"])
  })

  it("desde la solicitud llega hasta la entrega", async () => {
    const chain = await getDocumentChain(session(), { kind: "request", id: "req-1" })
    expect(codes(chain.requests)).toEqual(["SOL-0001"])
    expect(codes(chain.orders)).toEqual(["OC-2026-0001"])
    expect(codes(chain.receipts)).toEqual(["REC-2026-0001"])
    expect(codes(chain.dispatchGuides)).toEqual(["GDI-2026-0001"])
    expect(codes(chain.deliveries)).toEqual(["ENT-2026-0001"])
  })

  it("una solicitud sin OC no inventa eslabones río abajo", async () => {
    const chain = await getDocumentChain(session(), { kind: "request", id: "req-3" })
    expect(codes(chain.requests)).toEqual(["SOL-0003"])
    expect(chain.orders).toEqual([])
    expect(chain.receipts).toEqual([])
    expect(chain.deliveries).toEqual([])
  })

  it("una compra directa sin solicitud conserva su cadena hacia la recepción", async () => {
    const chain = await getDocumentChain(session(), { kind: "order", id: "oc-2" })
    expect(chain.requests).toEqual([])
    expect(codes(chain.orders)).toEqual(["OC-2026-0002"])
    expect(codes(chain.receipts)).toEqual(["REC-2026-0002"])
  })

  it("desde la recepción reconstruye la cadena hacia arriba", async () => {
    const chain = await getDocumentChain(session(), { kind: "receipt", id: "rec-1" })
    expect(codes(chain.requests)).toEqual(["SOL-0001"])
    expect(codes(chain.orders)).toEqual(["OC-2026-0001"])
    expect(codes(chain.receipts)).toEqual(["REC-2026-0001"])
    expect(codes(chain.dispatchGuides)).toEqual(["GDI-2026-0001"])
  })

  it("desde la GDI conserva el vínculo con la recepción y la OC de origen", async () => {
    const chain = await getDocumentChain(session(), { kind: "dispatchGuide", id: "gdi-chain-1" })
    expect(codes(chain.requests)).toEqual(["SOL-0001", "SOL-0002"])
    expect(codes(chain.orders)).toEqual(["OC-2026-0001"])
    expect(codes(chain.receipts)).toEqual(["REC-2026-0001"])
    expect(codes(chain.dispatchGuides)).toEqual(["GDI-2026-0001"])
  })

  it("desde la entrega reconstruye la cadena hacia arriba", async () => {
    const chain = await getDocumentChain(session(), { kind: "delivery", id: "ent-1" })
    expect(codes(chain.requests)).toEqual(["SOL-0001"])
    expect(codes(chain.orders)).toEqual(["OC-2026-0001"])
    expect(codes(chain.deliveries)).toEqual(["ENT-2026-0001"])
  })

  it("omite los libros que el usuario no puede ver, en vez de mostrarlos sin enlace", async () => {
    const chain = await getDocumentChain(
      session({ permissions: ["requests:view_all"] }),
      { kind: "request", id: "req-1" },
    )
    expect(codes(chain.requests)).toEqual(["SOL-0001"])
    expect(chain.orders).toEqual([])
    expect(chain.receipts).toEqual([])
    expect(chain.deliveries).toEqual([])
  })

  it("respeta el alcance de faena documento por documento", async () => {
    const scoped = session({ isGlobal: false, worksiteIds: ["ws-sur"] })
    // La solicitud de su faena sí; nada de la faena Norte se cuela por la cadena.
    const own = await getDocumentChain(scoped, { kind: "request", id: "req-3" })
    expect(codes(own.requests)).toEqual(["SOL-0003"])

    const foreign = await getDocumentChain(scoped, { kind: "order", id: "oc-1" })
    expect(foreign.requests).toEqual([])
    expect(foreign.orders).toEqual([])
    expect(foreign.receipts).toEqual([])
  })

  it("una cadena vacía por alcance se responde como 'no encontrado'", async () => {
    const scoped = session({ isGlobal: false, worksiteIds: ["ws-sur"] })
    // El código existe, pero es de otra faena: no se confirma su existencia.
    await expect(getDocumentChainByCode(scoped, "OC-2026-0001")).resolves.toBeNull()
    await expect(getDocumentChainByCode(scoped, "SOL-0003")).resolves.not.toBeNull()
  })

  it("con sólo view_own no filtra las solicitudes de otros por la cadena", async () => {
    // OC-2026-0001 mezcla SOL-0001 (suya) y SOL-0002 (de un compañero): la miga
    // entregaba código, estado y fecha de la ajena, que es justo lo que
    // /solicitudes/[id] le niega con notFound.
    const own = session({ permissions: ["requests:view_own", "purchasing:view"] })
    const chain = await getDocumentChain(own, { kind: "order", id: "oc-1" })
    expect(codes(chain.requests)).toEqual(["SOL-0001"])
    expect(codes(chain.orders)).toEqual(["OC-2026-0001"])

    // Y por código: buscar la solicitud ajena no confirma su estado.
    const foreign = await getDocumentChainByCode(own, "SOL-0002")
    expect(foreign?.chain.requests ?? []).toEqual([])
  })

  it("desde una línea de solicitud arma la cadena de esa línea", async () => {
    const chain = await getDocumentChain(session(), { kind: "item", id: "item-b" })
    // item-b se quedó en la solicitud: comparte SOL con item-a pero no su OC.
    expect(codes(chain.requests)).toEqual(["SOL-0001"])
    expect(chain.orders).toEqual([])
    expect(chain.deliveries).toEqual([])
  })
})
