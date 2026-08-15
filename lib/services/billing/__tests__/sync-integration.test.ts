/**
 * Prueba de integración de la sincronización de facturación contra Postgres
 * real (PGlite en memoria, migraciones completas).
 *
 * Lo que se demuestra acá y no se puede demostrar con mocks:
 * - la sincronización es idempotente contra las restricciones reales;
 * - dos fuentes describen la misma factura sin duplicarla;
 * - una decisión humana sobrevive a una sincronización posterior;
 * - dos corridas simultáneas del mismo período no compiten;
 * - el estado de pago se deriva de pagos confirmados, no de sugerencias.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { BillingProvider, ProviderBankTransaction, ProviderInvoice, ProviderPage, ProviderPeriodQuery } from "../providers/types"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

/* ── Proveedor falso, controlado por la prueba ────────────────────────────── */

let issuedPages: ProviderPage<ProviderInvoice>[] = []
let issuedPageFactory: ((query: ProviderPeriodQuery) => ProviderPage<ProviderInvoice>) | null = null
let bankPages: ProviderPage<ProviderBankTransaction>[] = []
let bankPageFactory: ((query: ProviderPeriodQuery) => ProviderPage<ProviderBankTransaction>) | null = null
let configured = true

function fakeProvider(id: "factura_en_linea" | "chipax"): BillingProvider {
  let call = 0
  let bankCall = 0
  return {
    id,
    label: `Fake ${id}`,
    capabilities: {
      canListIssuedInvoices: true,
      canListReceivedInvoices: false,
      canRetrieveXml: false,
      canRetrievePdf: false,
      canListPayments: false,
      canListBankTransactions: true,
      canListClients: false,
      canCreateInvoices: false,
      canCreateExpenses: false,
    },
    isConfigured: async () => configured,
    healthCheck: async () => ({ ok: true, detail: "fake", checkedAt: new Date().toISOString() }),
    listIssuedInvoices: async (query) => issuedPageFactory?.(query) ?? issuedPages[call++] ?? { items: [], nextCursor: null, reportedTotal: 0 },
    listBankTransactions: async (query) => bankPageFactory?.(query) ?? bankPages[bankCall++] ?? { items: [], nextCursor: null, reportedTotal: 0 },
  }
}

vi.mock("../providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../providers")>()
  return {
    ...actual,
    isProviderEnabled: () => true,
    // Solo se sustituyen los proveedores externos: "manual" sigue siendo el real
    // para que las pruebas de capacidad se midan contra su declaración auténtica.
    getBillingProvider: (id: "factura_en_linea" | "chipax" | "manual") =>
      id === "manual" ? actual.getBillingProvider(id) : fakeProvider(id),
  }
})

/**
 * PGlite y postgres-js son compatibles en runtime pero sus tipos de sesión no
 * son asignables entre sí. El cast está en un solo lugar para que las llamadas
 * a los servicios se lean como en producción.
 */
const serviceDb = inMemoryDb as unknown as typeof import("@/db").db

const { syncBillingInvoices, syncBankTransactions } = await import("../sync")
const {
  upsertProviderInvoice,
  recomputeInvoicePaymentStatus,
  BillingExternalReferenceConflict,
  BillingExternalReferenceInvalid,
} = await import("../invoices")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  issuedPages = []
  issuedPageFactory = null
  bankPages = []
  bankPageFactory = null
  configured = true
  await inMemoryDb.delete(schema.billingInvoicePayments)
  await inMemoryDb.delete(schema.billingBankTransactions)
  await inMemoryDb.delete(schema.billingInvoiceItems)
  await inMemoryDb.delete(schema.billingInvoiceLinks)
  await inMemoryDb.delete(schema.billingExternalRefs)
  await inMemoryDb.delete(schema.billingInvoiceEvents)
  await inMemoryDb.delete(schema.billingInvoices)
  await inMemoryDb.delete(schema.billingSyncRuns)
  await inMemoryDb.delete(schema.systemSettings)
  await inMemoryDb.delete(schema.contracts)
  await inMemoryDb.delete(schema.clients)
  await inMemoryDb.delete(schema.users)
})

function sale(overrides: Partial<ProviderInvoice> = {}): ProviderInvoice {
  return {
    externalId: "fel:sale:433:33:1234:78023530-6",
    direction: "sale",
    docType: "33",
    folio: 1234,
    issuerTaxId: "78023530-6",
    issuerName: "CHOME",
    receiverTaxId: "76543210-K",
    receiverName: "MINERA EJEMPLO SPA",
    issueDate: "2026-07-15",
    dueDate: "2026-08-14",
    currency: "CLP",
    netAmount: 4200000,
    taxAmount: 798000,
    exemptAmount: null,
    totalAmount: 4998000,
    documentStatus: "accepted",
    externalStatus: "Enviado",
    documentUrl: null,
    xmlUrl: null,
    accountRef: "433",
    items: [],
    ...overrides,
  }
}

async function countInvoices(): Promise<number> {
  return (await inMemoryDb.select().from(schema.billingInvoices)).length
}

describe("syncBillingInvoices — idempotencia", () => {
  it("dos corridas con los mismos datos no crean duplicados", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    const first = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(first.status).toBe("success")
    expect(first.recordsCreated).toBe(1)

    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    const second = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(second.recordsCreated).toBe(0)
    expect(second.recordsUnchanged).toBe(1)
    expect(await countInvoices()).toBe(1)
  })

  it("converge 121+ XML candidates in resumable runs without losing the tail", async () => {
    const all = Array.from({ length: 121 }, (_, index) => sale({
      externalId: `fel:sale:433:33:${String(index + 1).padStart(4, "0")}:78023530-6`,
      folio: index + 1,
    }))
    issuedPageFactory = (query) => query.cursor === "120"
      ? { items: [all[120]!], nextCursor: null, reportedTotal: null, managedCursor: true, deferred: false }
      : { items: all.slice(0, 120), nextCursor: "120", reportedTotal: 121, managedCursor: true, deferred: true }

    const first = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(first.status).toBe("partial")
    expect(await countInvoices()).toBe(120)
    const [cursor] = await inMemoryDb.select().from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "billing.sync_cursor.factura_en_linea.sales_invoices.2026-07"))
    expect(cursor?.value).toBe("120")

    const second = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(second.status).toBe("success")
    expect(await countInvoices()).toBe(121)
    expect(await inMemoryDb.select().from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "billing.sync_cursor.factura_en_linea.sales_invoices.2026-07"))).toHaveLength(0)
  })

  it("un cambio de estado en la fuente actualiza sin duplicar", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    issuedPages = [{ items: [sale({ documentStatus: "void", externalStatus: "Anulado" })], nextCursor: null, reportedTotal: 1 }]
    const result = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    expect(result.recordsUpdated).toBe(1)
    expect(await countInvoices()).toBe(1)
    const [invoice] = await inMemoryDb.select().from(schema.billingInvoices)
    expect(invoice!.documentStatus).toBe("void")
  })

  it("cuenta como duplicado una fila repetida dentro de la misma respuesta", async () => {
    issuedPages = [{ items: [sale(), sale()], nextCursor: null, reportedTotal: 2 }]
    const result = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(result.duplicatesDetected).toBe(1)
    expect(await countInvoices()).toBe(1)
  })

  it("no inserta un documento sin RUT de contraparte: lo reporta como conflicto", async () => {
    issuedPages = [{ items: [sale({ receiverTaxId: null })], nextCursor: null, reportedTotal: 1 }]
    const result = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    expect(result.conflictsDetected).toBe(1)
    expect(result.status).toBe("partial")
    expect(result.errorSummary).toMatch(/sin RUT de contraparte/i)
    expect(await countInvoices()).toBe(0)
  })

  it("el modo simulación no escribe nada", async () => {
    await inMemoryDb.insert(schema.systemSettings).values({
      key: "billing.sync_cursor.factura_en_linea.sales_invoices.2026-07",
      value: "cursor-previo",
    })
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    const result = await syncBillingInvoices({
      provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07", dryRun: true,
    })
    expect(result.recordsFetched).toBe(1)
    expect(result.recordsCreated).toBe(0)
    expect(await countInvoices()).toBe(0)
    expect(result.runId).toBe("")
    expect(await inMemoryDb.select().from(schema.billingSyncRuns)).toHaveLength(0)
    const [cursor] = await inMemoryDb.select().from(schema.systemSettings)
    expect(cursor?.value).toBe("cursor-previo")
  })

  it("sigue el cursor entre páginas", async () => {
    issuedPages = [
      { items: [sale()], nextCursor: "p2", reportedTotal: 2 },
      { items: [sale({ folio: 1235, externalId: "fel:sale:433:33:1235:78023530-6" })], nextCursor: null, reportedTotal: 2 },
    ]
    const result = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(result.recordsFetched).toBe(2)
    expect(result.recordsCreated).toBe(2)
  })

  it("avisa cuando el proveedor declara un total distinto al entregado", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 47 }]
    const result = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(result.status).toBe("partial")
    expect(result.errorSummary).toMatch(/declaró 47/)
  })

  it("no arranca si el proveedor no está configurado", async () => {
    configured = false
    const result = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(result.status).toBe("skipped")
    expect(await inMemoryDb.select().from(schema.billingSyncRuns)).toHaveLength(0)
  })

  it("rechaza un período anterior al piso histórico y uno futuro", async () => {
    await expect(syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2019-01" }))
      .rejects.toThrow(/piso histórico/i)
    await expect(syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2099-01" }))
      .rejects.toThrow(/futuro/i)
    await expect(syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-13" }))
      .rejects.toThrow(/Período inválido/i)
  })

  // H-13 (AUDITORIA_BUGS_2026-08-05.md): la guarda dejaba pasar el futuro
  // justo en el trigger que menos lo necesita. Un backfill recupera historia
  // hacia atrás; pedirle un mes que aún no ocurrió sólo generaba corridas
  // `success` vacías contra períodos inexistentes.
  it("un backfill tampoco puede pedir un período futuro", async () => {
    await expect(syncBillingInvoices({
      provider: "factura_en_linea", scope: "sales_invoices", period: "2099-01", trigger: "backfill",
    })).rejects.toThrow(/futuro/i)
    await expect(syncBankTransactions({ provider: "chipax", period: "2099-01", trigger: "backfill" }))
      .rejects.toThrow(/futuro/i)
  })

  it("una segunda corrida concurrente del mismo período se salta en vez de competir", async () => {
    // Se simula la corrida en curso dejando una fila `running` del período.
    await inMemoryDb.insert(schema.billingSyncRuns).values({
      id: "run-activa",
      provider: "factura_en_linea",
      scope: "sales_invoices",
      status: "running",
      periodFrom: "2026-07",
      periodTo: "2026-07",
      correlationId: "corr-activa",
    })

    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    const result = await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    expect(result.status).toBe("skipped")
    expect(result.errorSummary).toMatch(/en curso/i)
    expect(await countInvoices()).toBe(0)
  })

  // H-09 (AUDITORIA_BUGS_2026-08-05.md): el catch asumía que cualquier fallo
  // al abrir la corrida era el índice único. Una FK rota, un timeout o una
  // base caída se reportaban como "ya hay una sincronización en curso" con
  // `ok: true` — un diagnóstico falso justo donde más se necesita el real.
  it("un fallo de base al abrir la corrida se propaga en vez de disfrazarse de 'ya en curso'", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    // `triggeredBy` apunta a un usuario inexistente: viola la FK, no el índice
    // único parcial de corridas activas.
    await expect(syncBillingInvoices({
      provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07",
      triggeredBy: "usuario-que-no-existe",
    })).rejects.toThrow()

    expect(await countInvoices()).toBe(0)
  })
})

describe("dos fuentes, una factura", () => {
  it("FacturaEnLínea y Chipax describen el mismo documento sin duplicarlo", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    // La misma factura, reportada por otro proveedor con su propio id externo.
    issuedPages = [{
      items: [sale({ externalId: "chipax:dte:99887", externalStatus: "pagado" })],
      nextCursor: null,
      reportedTotal: 1,
    }]
    await syncBillingInvoices({ provider: "chipax", scope: "sales_invoices", period: "2026-07" })

    expect(await countInvoices()).toBe(1)
    const refs = await inMemoryDb.select().from(schema.billingExternalRefs)
    expect(refs).toHaveLength(2)
    expect(refs.map((ref) => ref.provider).sort()).toEqual(["chipax", "factura_en_linea"])
  })

  it("guarda el snapshot de cada fuente para poder comparar diferencias", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    issuedPages = [{ items: [sale({ externalId: "chipax:dte:99887", totalAmount: 4998000, netAmount: 4200000 })], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "chipax", scope: "sales_invoices", period: "2026-07" })

    const refs = await inMemoryDb.select().from(schema.billingExternalRefs)
    for (const ref of refs) {
      expect((ref.snapshot as { totalAmount: number }).totalAmount).toBe(4998000)
    }
  })
})

describe("la decisión humana manda", () => {
  it("un vencimiento puesto a mano sobrevive a la sincronización", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    // Una persona corrige el vencimiento.
    await inMemoryDb.update(schema.billingInvoices)
      .set({ dueDate: "2026-09-30", dueDateSource: "manual" })
      .where(eq(schema.billingInvoices.folio, 1234))

    // La fuente insiste con su fecha y con un cambio real de estado.
    issuedPages = [{ items: [sale({ dueDate: "2026-08-14", documentStatus: "issued" })], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    const [invoice] = await inMemoryDb.select().from(schema.billingInvoices)
    expect(invoice!.dueDate).toBe("2026-09-30")
    expect(invoice!.dueDateSource).toBe("manual")
  })

  it("no toca los datos internos: responsable, notas ni estado de cobranza", async () => {
    await inMemoryDb.insert(schema.users).values({
      id: "u-cobranza", name: "Cobranza", email: "cobranza@test", hashedPassword: "x", isActive: true,
    })
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    await inMemoryDb.update(schema.billingInvoices).set({
      ownerUserId: "u-cobranza",
      collectionStatus: "committed",
      notes: "El cliente comprometió pago el 30.",
    }).where(eq(schema.billingInvoices.folio, 1234))

    issuedPages = [{ items: [sale({ documentStatus: "issued" })], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    const [invoice] = await inMemoryDb.select().from(schema.billingInvoices)
    expect(invoice!.ownerUserId).toBe("u-cobranza")
    expect(invoice!.collectionStatus).toBe("committed")
    expect(invoice!.notes).toBe("El cliente comprometió pago el 30.")
  })
})

describe("vencimiento derivado del maestro comercial", () => {
  it("usa el plazo del contrato cuando el documento no trae FchVenc", async () => {
    await inMemoryDb.insert(schema.clients).values({
      id: "cli-1", rut: "76543210-K", name: "MINERA EJEMPLO SPA", paymentTermsDays: 60,
    })
    await inMemoryDb.insert(schema.contracts).values({
      id: "ctr-1", code: "CTR-2026-0001", clientId: "cli-1", name: "Aseo industrial",
      status: "active", paymentTermsDays: 30,
    })

    issuedPages = [{ items: [sale({ dueDate: null })], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    const [invoice] = await inMemoryDb.select().from(schema.billingInvoices)
    expect(invoice!.dueDate).toBe("2026-08-14")     // 15-07 + 30
    expect(invoice!.dueDateSource).toBe("contract")
  })

  it("con dos contratos con plazos distintos no adivina: usa el plazo del cliente", async () => {
    await inMemoryDb.insert(schema.clients).values({
      id: "cli-1", rut: "76543210-K", name: "MINERA EJEMPLO SPA", paymentTermsDays: 45,
    })
    await inMemoryDb.insert(schema.contracts).values([
      { id: "ctr-1", code: "CTR-2026-0001", clientId: "cli-1", name: "Aseo", status: "active", paymentTermsDays: 30 },
      { id: "ctr-2", code: "CTR-2026-0002", clientId: "cli-1", name: "Mantención", status: "active", paymentTermsDays: 60 },
    ])

    issuedPages = [{ items: [sale({ dueDate: null })], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    const [invoice] = await inMemoryDb.select().from(schema.billingInvoices)
    expect(invoice!.dueDate).toBe("2026-08-29")     // 15-07 + 45 (cliente)
    expect(invoice!.dueDateSource).toBe("client")
  })
})

describe("estado de pago derivado", () => {
  async function seedInvoice(): Promise<string> {
    const result = await serviceDb.transaction((tx) =>
      upsertProviderInvoice(tx, sale(), "factura_en_linea"),
    )
    return result.invoiceId
  }

  it("una sugerencia no cuenta como cobrado", async () => {
    const invoiceId = await seedInvoice()
    await inMemoryDb.insert(schema.billingInvoicePayments).values({
      id: "p1", invoiceId, paymentDate: "2026-08-10", amount: 4998000, verificationStatus: "suggested",
    })

    const snapshot = await recomputeInvoicePaymentStatus(serviceDb, invoiceId)
    expect(snapshot.paymentStatus).toBe("unpaid")
    expect(snapshot.paidAmount).toBe(0)
  })

  it("dos pagos confirmados que suman el total dejan la factura pagada", async () => {
    await inMemoryDb.insert(schema.users).values({
      id: "u-fin", name: "Finanzas", email: "fin@test", hashedPassword: "x", isActive: true,
    })
    const invoiceId = await seedInvoice()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.billingInvoicePayments).values([
      { id: "p1", invoiceId, paymentDate: "2026-08-10", amount: 2000000, verificationStatus: "confirmed", confirmedBy: "u-fin", confirmedAt: now },
      { id: "p2", invoiceId, paymentDate: "2026-08-20", amount: 2998000, verificationStatus: "confirmed", confirmedBy: "u-fin", confirmedAt: now },
    ])

    const snapshot = await recomputeInvoicePaymentStatus(serviceDb, invoiceId)
    expect(snapshot.paymentStatus).toBe("paid")
    expect(snapshot.outstandingAmount).toBe(0)

    const [invoice] = await inMemoryDb.select().from(schema.billingInvoices)
    expect(invoice!.paymentStatus).toBe("paid")
    expect(invoice!.paidAmount).toBe(4998000)
  })

  it("revertir una confirmación devuelve la factura a pendiente", async () => {
    await inMemoryDb.insert(schema.users).values({
      id: "u-fin", name: "Finanzas", email: "fin@test", hashedPassword: "x", isActive: true,
    })
    const invoiceId = await seedInvoice()
    await inMemoryDb.insert(schema.billingInvoicePayments).values({
      id: "p1", invoiceId, paymentDate: "2026-08-10", amount: 4998000,
      verificationStatus: "confirmed", confirmedBy: "u-fin", confirmedAt: new Date().toISOString(),
    })
    await recomputeInvoicePaymentStatus(serviceDb, invoiceId)

    await inMemoryDb.update(schema.billingInvoicePayments)
      .set({ verificationStatus: "rejected", confirmedBy: null, confirmedAt: null })
      .where(eq(schema.billingInvoicePayments.id, "p1"))
    const snapshot = await recomputeInvoicePaymentStatus(serviceDb, invoiceId)

    expect(snapshot.paymentStatus).toBe("unpaid")
    expect(snapshot.paidAmount).toBe(0)
  })
})

describe("historial", () => {
  it("registra la importación y las actualizaciones del proveedor", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    issuedPages = [{ items: [sale({ documentStatus: "void" })], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })

    const events = await inMemoryDb.select().from(schema.billingInvoiceEvents)
    expect(events.map((event) => event.eventType)).toEqual([
      "invoice.imported",
      "invoice.updated_from_provider",
    ])
    expect(events.every((event) => event.actorKind === "provider")).toBe(true)
  })

  it("no guarda credenciales en el detalle del evento", async () => {
    issuedPages = [{ items: [sale()], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    const events = await inMemoryDb.select().from(schema.billingInvoiceEvents)
    const serialized = JSON.stringify(events)
    expect(serialized).not.toMatch(/clave|password|rut_usr/i)
  })
})

describe("ítems", () => {
  it("una fuente que solo trae totales no borra los ítems que otra sí trajo", async () => {
    issuedPages = [{
      items: [sale({
        items: [{
          externalItemId: "1", description: "Aseo industrial julio", quantity: 1, unit: "SERV",
          unitPrice: 4200000, discountAmount: null, netAmount: 4200000, taxAmount: null,
          totalAmount: 4200000, sortOrder: 0,
        }],
      })],
      nextCursor: null,
      reportedTotal: 1,
    }]
    await syncBillingInvoices({ provider: "factura_en_linea", scope: "sales_invoices", period: "2026-07" })
    expect(await inMemoryDb.select().from(schema.billingInvoiceItems)).toHaveLength(1)

    // Otro proveedor reporta el mismo documento pero sin desglose.
    issuedPages = [{ items: [sale({ externalId: "chipax:dte:1", items: [] })], nextCursor: null, reportedTotal: 1 }]
    await syncBillingInvoices({ provider: "chipax", scope: "sales_invoices", period: "2026-07" })

    expect(await inMemoryDb.select().from(schema.billingInvoiceItems)).toHaveLength(1)
  })
})

describe("aislamiento por dirección", () => {
  it("una venta y una compra con el mismo folio son documentos distintos", async () => {
    await serviceDb.transaction((tx) => upsertProviderInvoice(tx, sale(), "factura_en_linea"))
    await serviceDb.transaction((tx) => upsertProviderInvoice(tx, sale({
      direction: "purchase",
      externalId: "fel:purchase:433:33:1234:76543210-K",
      issuerTaxId: "76543210-K",
      receiverTaxId: "78023530-6",
    }), "factura_en_linea"))

    expect(await countInvoices()).toBe(2)
    const sales = await inMemoryDb.select().from(schema.billingInvoices)
      .where(and(eq(schema.billingInvoices.direction, "sale"), eq(schema.billingInvoices.folio, 1234)))
    expect(sales).toHaveLength(1)
  })

  it("rechaza reasignar un externalId existente a otra factura interna", async () => {
    await serviceDb.transaction((tx) => upsertProviderInvoice(tx, sale(), "factura_en_linea"))

    await expect(serviceDb.transaction((tx) => upsertProviderInvoice(tx, sale({
      direction: "purchase",
      externalId: sale().externalId,
      issuerTaxId: "76543210-K",
      receiverTaxId: "78023530-6",
    }), "factura_en_linea"))).rejects.toBeInstanceOf(BillingExternalReferenceConflict)

    expect(await countInvoices()).toBe(1)
  })

  it("no crea una factura sin referencia externa estable", async () => {
    await expect(serviceDb.transaction((tx) => upsertProviderInvoice(tx, sale({ externalId: "   " }), "factura_en_linea")))
      .rejects.toBeInstanceOf(BillingExternalReferenceInvalid)
    expect(await countInvoices()).toBe(0)
  })
})

describe("sincronización de movimientos bancarios", () => {
  function movimiento(overrides: Partial<ProviderBankTransaction> = {}): ProviderBankTransaction {
    return {
      externalId: "chipax:cartola:1",
      transactionDate: "2026-07-14",
      amount: 4998000,
      currency: "CLP",
      description: "TRANSFERENCIA FACT 1234",
      counterpartyName: null,
      counterpartyTaxId: null,
      accountRef: "cc:7",
      ...overrides,
    }
  }

  it("importa las cartolas del período", async () => {
    bankPages = [{ items: [movimiento()], nextCursor: null, reportedTotal: 1 }]
    const result = await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    expect(result.status).toBe("success")
    expect(result.recordsCreated).toBe(1)
    const rows = await inMemoryDb.select().from(schema.billingBankTransactions)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.provider).toBe("chipax")
    expect(rows[0]!.allocatedAmount).toBe(0)
  })

  it("es idempotente: repetirla no duplica ni pisa lo ya imputado", async () => {
    bankPages = [{ items: [movimiento()], nextCursor: null, reportedTotal: 1 }]
    await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    // Alguien confirmó una imputación parcial sobre ese movimiento.
    await inMemoryDb.update(schema.billingBankTransactions).set({ allocatedAmount: 1000000 })

    bankPages = [{ items: [movimiento()], nextCursor: null, reportedTotal: 1 }]
    const segunda = await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    expect(segunda.recordsCreated).toBe(0)
    expect(segunda.recordsUnchanged).toBe(1)
    const rows = await inMemoryDb.select().from(schema.billingBankTransactions)
    expect(rows).toHaveLength(1)
    // Lo imputado sobrevive: la sincronización no puede borrar una decisión.
    expect(rows[0]!.allocatedAmount).toBe(1000000)
  })

  it("sigue el cursor entre páginas", async () => {
    bankPages = [
      { items: [movimiento()], nextCursor: "2", reportedTotal: 2 },
      { items: [movimiento({ externalId: "chipax:cartola:2" })], nextCursor: null, reportedTotal: 2 },
    ]
    const result = await syncBankTransactions({ provider: "chipax", period: "2026-07" })
    expect(result.recordsCreated).toBe(2)
  })

  it("se salta el proveedor que no entrega movimientos bancarios", async () => {
    const result = await syncBankTransactions({ provider: "manual", period: "2026-07" })
    expect(result.status).toBe("skipped")
    expect(result.errorSummary).toMatch(/no entrega movimientos bancarios/i)
  })

  // H-07 (AUDITORIA_BUGS_2026-08-05.md): `syncBankTransactions` no limpiaba
  // corridas colgadas, así que una fila `running` de un proceso muerto
  // bloqueaba ese período para siempre vía el índice único parcial.
  it("una corrida de cartolas colgada no bloquea el período para siempre", async () => {
    const dosHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    await inMemoryDb.insert(schema.billingSyncRuns).values({
      id: "run-cartolas-colgada",
      provider: "chipax",
      scope: "bank_transactions",
      status: "running",
      periodFrom: "2026-07",
      periodTo: "2026-07",
      correlationId: "corr-colgada",
      startedAt: dosHorasAtras,
    })

    bankPages = [{ items: [movimiento()], nextCursor: null, reportedTotal: 1 }]
    const result = await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    expect(result.status).toBe("success")
    expect(result.recordsCreated).toBe(1)
    const colgada = await inMemoryDb.select().from(schema.billingSyncRuns)
      .where(eq(schema.billingSyncRuns.id, "run-cartolas-colgada"))
    expect(colgada[0]!.status).toBe("failed")
  })

  // H-14: la columna `payload_hash` se calculaba y nunca se leía. Ahora una
  // rectificación del banco sobre un movimiento ya importado se reporta como
  // conflicto en vez de pasar inadvertida (y sin pisar lo ya imputado).
  it("detecta que el proveedor rectificó el monto de un movimiento ya importado", async () => {
    bankPages = [{ items: [movimiento()], nextCursor: null, reportedTotal: 1 }]
    await syncBankTransactions({ provider: "chipax", period: "2026-07" })
    await inMemoryDb.update(schema.billingBankTransactions).set({ allocatedAmount: 1000000 })

    // Mismo externalId, monto distinto: el banco corrigió la cartola.
    bankPages = [{ items: [movimiento({ amount: 4990000 })], nextCursor: null, reportedTotal: 1 }]
    const segunda = await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    expect(segunda.conflictsDetected).toBe(1)
    expect(segunda.recordsUnchanged).toBe(0)
    expect(segunda.errorSummary).toMatch(/cambió en el proveedor/i)

    // No se pisa: ni el monto original ni la imputación acumulada.
    const rows = await inMemoryDb.select().from(schema.billingBankTransactions)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount).toBe(4998000)
    expect(rows[0]!.allocatedAmount).toBe(1000000)
  })

  it("una reimportación idéntica no se reporta como conflicto", async () => {
    bankPages = [{ items: [movimiento()], nextCursor: null, reportedTotal: 1 }]
    await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    bankPages = [{ items: [movimiento()], nextCursor: null, reportedTotal: 1 }]
    const segunda = await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    expect(segunda.conflictsDetected).toBe(0)
    expect(segunda.recordsUnchanged).toBe(1)
  })

  it("marca partial cuando una cartola rectificada genera conflicto", async () => {
    bankPages = [{ items: [movimiento()], nextCursor: null, reportedTotal: 1 }]
    await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    bankPages = [{ items: [movimiento({ amount: 4990000 })], nextCursor: null, reportedTotal: 1 }]
    const result = await syncBankTransactions({ provider: "chipax", period: "2026-07" })

    expect(result.conflictsDetected).toBe(1)
    expect(result.status).toBe("partial")
  })

  it("reanuda ventas Chipax desde system_settings después de superar 50 páginas", async () => {
    const pages = Array.from({ length: 63 }, (_, index) => ({
      items: [sale({
        externalId: `chipax:dte:${index + 1}`,
        folio: index + 1,
      })],
      nextCursor: index < 62 ? String(index + 2) : null,
      reportedTotal: 63,
    }))
    issuedPageFactory = (query) => pages[Number(query.cursor ?? "1") - 1]!

    const first = await syncBillingInvoices({ provider: "chipax", scope: "sales_invoices", period: "2026-07" })
    expect(first.status).toBe("partial")
    expect(first.recordsCreated).toBe(50)
    const [cursor] = await inMemoryDb.select().from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "billing.sync_cursor.chipax.sales_invoices.2026-07"))
    expect(cursor?.value).toBe("51")

    const second = await syncBillingInvoices({ provider: "chipax", scope: "sales_invoices", period: "2026-07" })
    expect(second.status).toBe("success")
    expect(await countInvoices()).toBe(63)
    expect(await inMemoryDb.select().from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "billing.sync_cursor.chipax.sales_invoices.2026-07"))).toHaveLength(0)
  })

  it("reanuda cartolas Chipax y conserva el cursor si una página falla", async () => {
    const pages = Array.from({ length: 55 }, (_, index) => ({
      items: [movimiento({ externalId: `chipax:cartola:${index + 1}` })],
      nextCursor: index < 54 ? String(index + 2) : null,
      reportedTotal: 55,
    }))
    let failPage = true
    bankPageFactory = (query) => {
      const page = Number(query.cursor ?? "1")
      if (page === 2 && failPage) {
        failPage = false
        throw new Error("interrupción simulada")
      }
      return pages[page - 1]!
    }

    const first = await syncBankTransactions({ provider: "chipax", period: "2026-07" })
    expect(first.status).toBe("failed")
    const [cursor] = await inMemoryDb.select().from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "billing.sync_cursor.chipax.bank_transactions.2026-07"))
    expect(cursor?.value).toBe("2")
    const second = await syncBankTransactions({ provider: "chipax", period: "2026-07" })
    expect(second.status).toBe("partial")
    const third = await syncBankTransactions({ provider: "chipax", period: "2026-07" })
    expect(third.status).toBe("success")
    expect(await inMemoryDb.select().from(schema.billingBankTransactions)).toHaveLength(55)
  })
})
