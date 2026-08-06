/**
 * Alcance por faena, paginación y agregación por moneda del modelo de lectura,
 * contra Postgres real (PGlite).
 *
 * El punto central: **el permiso se aplica en el backend**, no ocultando
 * botones. Un rol acotado por faena que consulta directamente el servicio
 * recibe cero filas, no las filas de otra faena.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const {
  listInvoices, getBillingSummary, getInvoiceDetail, listUnlinkedInvoices, computeSourceDifferences,
  canReachInvoice, canReachProposal,
} = await import("../queries")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

/** Sesión mínima con el shape que leen los helpers de alcance. */
function session(overrides: {
  isGlobal: boolean
  worksiteIds?: string[]
  roles?: string[]
}): Session {
  return {
    user: {
      id: "u1",
      name: "Usuario",
      email: "u1@test",
      permissions: ["billing:view"],
      roles: overrides.roles ?? [],
      worksiteIds: overrides.worksiteIds ?? [],
      isGlobal: overrides.isGlobal,
    },
    expires: "2099-01-01",
  } as unknown as Session
}

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
const PERIOD = TODAY.slice(0, 7)

function daysFromToday(days: number): string {
  const date = new Date(`${TODAY}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.billingInvoicePayments)
  await inMemoryDb.delete(schema.billingInvoiceLinks)
  await inMemoryDb.delete(schema.billingExternalRefs)
  await inMemoryDb.delete(schema.billingInvoiceEvents)
  await inMemoryDb.delete(schema.billingInvoices)
  await inMemoryDb.delete(schema.billingProposalItems)
  await inMemoryDb.delete(schema.billingProposals)
  await inMemoryDb.delete(schema.contracts)
  await inMemoryDb.delete(schema.clients)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "u1", name: "Usuario", email: "u1@test", hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "w-norte", name: "Faena Norte", code: "FN-001", isActive: true },
    { id: "w-sur", name: "Faena Sur", code: "FN-002", isActive: true },
  ])
  await inMemoryDb.insert(schema.clients).values([
    { id: "cli-a", rut: "76111111-1", name: "Cliente A" },
    { id: "cli-b", rut: "76222222-2", name: "Cliente B" },
  ])

  // Tres facturas: una de Faena Norte, una de Faena Sur, una sin vínculo.
  await inMemoryDb.insert(schema.billingInvoices).values([
    {
      id: "inv-norte", direction: "sale", docType: "33", folio: 1001,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76111111-1", receiverName: "Cliente A",
      issueDate: `${PERIOD}-05`, dueDate: daysFromToday(-10),
      currency: "CLP", totalAmount: 1000000, paidAmount: 0,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "factura_en_linea",
    },
    {
      id: "inv-sur", direction: "sale", docType: "33", folio: 1002,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76222222-2", receiverName: "Cliente B",
      issueDate: `${PERIOD}-06`, dueDate: daysFromToday(30),
      currency: "CLP", totalAmount: 2000000, paidAmount: 500000,
      documentStatus: "accepted", paymentStatus: "partial", source: "factura_en_linea",
    },
    {
      id: "inv-huerfana", direction: "sale", docType: "33", folio: 1003,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76222222-2", receiverName: "Cliente B",
      issueDate: `${PERIOD}-07`, currency: "USD", totalAmount: 3000,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "manual",
    },
    {
      id: "inv-anulada", direction: "sale", docType: "33", folio: 1004,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76111111-1", receiverName: "Cliente A",
      issueDate: `${PERIOD}-08`, currency: "CLP", totalAmount: 9999999,
      documentStatus: "void", paymentStatus: "unpaid", source: "factura_en_linea",
    },
  ])

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.billingInvoiceLinks).values([
    {
      id: "lnk-norte", invoiceId: "inv-norte", clientId: "cli-a", worksiteId: "w-norte",
      status: "confirmed", matchedBy: "user", confirmedBy: "u1", confirmedAt: now,
    },
    {
      id: "lnk-sur", invoiceId: "inv-sur", clientId: "cli-b", worksiteId: "w-sur",
      status: "confirmed", matchedBy: "user", confirmedBy: "u1", confirmedAt: now,
    },
  ])
})

describe("alcance por faena", () => {
  it("un rol global ve todas las facturas vigentes", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale")
    expect(result.rows.map((row) => row.folio).sort()).toEqual([1001, 1002, 1003])
  })

  it("un rol acotado solo ve las facturas vinculadas a SUS faenas", async () => {
    const result = await listInvoices(session({ isGlobal: false, worksiteIds: ["w-norte"] }), "sale")
    expect(result.rows.map((row) => row.folio)).toEqual([1001])
    expect(result.total).toBe(1)
  })

  it("un rol sin faenas asignadas no ve nada", async () => {
    const result = await listInvoices(session({ isGlobal: false, worksiteIds: [] }), "sale")
    expect(result.rows).toEqual([])
    expect(result.total).toBe(0)
  })

  it("una sesión nula no ve nada", async () => {
    expect((await listInvoices(null, "sale")).rows).toEqual([])
  })

  it("un vínculo SUGERIDO no otorga visibilidad: solo el confirmado", async () => {
    await inMemoryDb.insert(schema.billingInvoiceLinks).values({
      id: "lnk-sugerido", invoiceId: "inv-huerfana", worksiteId: "w-norte",
      status: "suggested", matchedBy: "auto", confidence: "medium",
    })
    const result = await listInvoices(session({ isGlobal: false, worksiteIds: ["w-norte"] }), "sale")
    expect(result.rows.map((row) => row.folio)).toEqual([1001])
  })

  it("el detalle también aplica el alcance, no solo el listado", async () => {
    const scoped = session({ isGlobal: false, worksiteIds: ["w-norte"] })
    expect(await getInvoiceDetail(scoped, "inv-norte")).not.toBeNull()
    expect(await getInvoiceDetail(scoped, "inv-sur")).toBeNull()
  })

  it("el resumen respeta el alcance", async () => {
    const scoped = await getBillingSummary(session({ isGlobal: false, worksiteIds: ["w-norte"] }), { period: PERIOD })
    expect(scoped.invoiceCount).toBe(1)

    const global = await getBillingSummary(session({ isGlobal: true }), { period: PERIOD })
    expect(global.invoiceCount).toBe(3)
  })
})

/**
 * El libro de ventas es mensual por norma, pero el tablero ofrece trimestre y
 * año. `getBillingSummary` acepta una ventana `[from, to)` explícita para eso.
 */
describe("ventana de emisión explícita", () => {
  /** Primer día del mes N meses antes del período ancla. */
  function monthStart(monthsBack: number): string {
    const [year, month] = PERIOD.split("-").map(Number) as [number, number]
    return new Date(Date.UTC(year, month - 1 - monthsBack, 1)).toISOString().slice(0, 10)
  }

  beforeEach(async () => {
    // Una factura de hace dos meses: fuera del mes ancla, dentro del trimestre.
    await inMemoryDb.insert(schema.billingInvoices).values({
      id: "inv-vieja", direction: "sale", docType: "33", folio: 1005,
      issuerTaxId: "78023530-6", issuerName: "CHOME",
      receiverTaxId: "76111111-1", receiverName: "Cliente A",
      issueDate: `${monthStart(2).slice(0, 7)}-15`,
      currency: "CLP", totalAmount: 500000, paidAmount: 0,
      documentStatus: "accepted", paymentStatus: "unpaid", source: "factura_en_linea",
    })
  })

  it("sin ventana sigue siendo el mes de `period`", async () => {
    const summary = await getBillingSummary(session({ isGlobal: true }), { period: PERIOD })
    expect(summary.invoiceCount).toBe(3)
    expect(summary.invoicedByCurrency.find((m) => m.currency === "CLP")?.amount).toBe(3000000)
  })

  it("una ventana de tres meses alcanza la factura anterior", async () => {
    const summary = await getBillingSummary(session({ isGlobal: true }), {
      period: PERIOD, from: monthStart(2), to: monthStart(-1),
    })
    expect(summary.invoiceCount).toBe(4)
    expect(summary.invoicedByCurrency.find((m) => m.currency === "CLP")?.amount).toBe(3500000)
  })

  /*
   * `to` es **exclusivo**, como `currentEnd` de `getOperationalCalendarBounds`.
   * Con un fin inclusivo, un documento del último día se contaría en el período
   * que termina y otra vez en el que empieza.
   */
  it("`to` excluye su propio día: no hay doble conteo entre períodos contiguos", async () => {
    const soloViejas = await getBillingSummary(session({ isGlobal: true }), {
      period: PERIOD, from: monthStart(2), to: monthStart(0),
    })
    expect(soloViejas.invoiceCount).toBe(1)
    expect(soloViejas.invoicedByCurrency.find((m) => m.currency === "CLP")?.amount).toBe(500000)
  })

  // La ventana alcanza a lo que **es** del período. El saldo abierto y la
  // antigüedad son de todas las facturas vivas y no dependen de ella.
  it("no toca el saldo pendiente ni la antigüedad de la deuda", async () => {
    const mes = await getBillingSummary(session({ isGlobal: true }), { period: PERIOD })
    const trimestre = await getBillingSummary(session({ isGlobal: true }), {
      period: PERIOD, from: monthStart(2), to: monthStart(-1),
    })
    expect(trimestre.outstandingByCurrency).toEqual(mes.outstandingByCurrency)
    expect(trimestre.aging).toEqual(mes.aging)
  })

  it("los clientes principales siguen la misma ventana que el facturado", async () => {
    const trimestre = await getBillingSummary(session({ isGlobal: true }), {
      period: PERIOD, from: monthStart(2), to: monthStart(-1),
    })
    // "inv-vieja" no tiene vínculo a cliente, así que el ranking no cambia; lo
    // que se fija es que consulte la ventana y no reviente al ensancharla.
    expect(trimestre.topClients.every((row) => row.amount > 0)).toBe(true)
  })
})

describe("facturas anuladas", () => {
  it("no cuentan como facturación válida", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale")
    expect(result.rows.some((row) => row.folio === 1004)).toBe(false)

    const clp = (await getBillingSummary(session({ isGlobal: true }), { period: PERIOD }))
      .invoicedByCurrency.find((money) => money.currency === "CLP")
    expect(clp?.amount).toBe(3000000)  // 1.000.000 + 2.000.000, sin la anulada
  })

  it("se pueden consultar explícitamente sin borrarlas", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale", { documentStatus: "void" })
    expect(result.rows.map((row) => row.folio)).toEqual([1004])
  })
})

describe("monedas", () => {
  it("los totales vienen separados por moneda, nunca sumados", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale")
    expect(result.totalsByCurrency).toEqual([
      { currency: "CLP", amount: 3000000 },
      { currency: "USD", amount: 3000 },
    ])
  })

  it("el saldo pendiente descuenta lo cobrado, por moneda", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale")
    expect(result.outstandingByCurrency).toEqual([
      { currency: "CLP", amount: 2500000 },  // 3.000.000 − 500.000 cobrados
      { currency: "USD", amount: 3000 },
    ])
  })
})

describe("filtros", () => {
  it("filtra por cliente a través del vínculo", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale", { clientId: "cli-a" })
    expect(result.rows.map((row) => row.folio)).toEqual([1001])
  })

  it("filtra solo vencidas y excluye las pagadas", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale", { overdueOnly: true })
    expect(result.rows.map((row) => row.folio)).toEqual([1001])
    expect(result.rows[0]!.daysOverdue).toBe(10)
    expect(result.rows[0]!.agingBucket).toBe("d1_30")
  })

  it("busca por folio y por RUT", async () => {
    expect((await listInvoices(session({ isGlobal: true }), "sale", { search: "1002" })).rows.map((r) => r.folio))
      .toEqual([1002])
    expect((await listInvoices(session({ isGlobal: true }), "sale", { search: "76111111" })).rows.map((r) => r.folio))
      .toEqual([1001])
  })

  it("filtra por fuente", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale", { source: "manual" })
    expect(result.rows.map((row) => row.folio)).toEqual([1003])
  })

  it("no devuelve facturas de compra en el listado de venta", async () => {
    await inMemoryDb.insert(schema.billingInvoices).values({
      id: "inv-compra", direction: "purchase", docType: "33", folio: 5001,
      issuerTaxId: "76999999-9", issuerName: "Proveedor",
      receiverTaxId: "78023530-6", receiverName: "CHOME",
      issueDate: `${PERIOD}-05`, currency: "CLP", totalAmount: 100000,
      documentStatus: "unknown", paymentStatus: "unpaid", source: "factura_en_linea",
    })
    const sales = await listInvoices(session({ isGlobal: true }), "sale")
    expect(sales.rows.some((row) => row.folio === 5001)).toBe(false)

    const purchases = await listInvoices(session({ isGlobal: true }), "purchase")
    expect(purchases.rows.map((row) => row.folio)).toEqual([5001])
  })
})

describe("paginación", () => {
  it("acota la página y mantiene el total del conjunto completo", async () => {
    const first = await listInvoices(session({ isGlobal: true }), "sale", { page: 1, pageSize: 2 })
    expect(first.rows).toHaveLength(2)
    expect(first.total).toBe(3)

    const second = await listInvoices(session({ isGlobal: true }), "sale", { page: 2, pageSize: 2 })
    expect(second.rows).toHaveLength(1)
    expect(second.total).toBe(3)

    const ids = [...first.rows, ...second.rows].map((row) => row.id)
    expect(new Set(ids).size).toBe(3)
  })

  it("acota el tamaño de página para impedir una descarga masiva", async () => {
    const result = await listInvoices(session({ isGlobal: true }), "sale", { pageSize: 100_000 })
    expect(result.pageSize).toBe(200)
  })
})

describe("facturas sin relación operacional", () => {
  it("lista las que ningún vínculo confirmado atribuyó", async () => {
    const orphans = await listUnlinkedInvoices(session({ isGlobal: true }))
    expect(orphans.map((row) => row.folio)).toEqual([1003])
  })

  it("un rol acotado por faena no las ve: por definición no están en su alcance", async () => {
    expect(await listUnlinkedInvoices(session({ isGlobal: false, worksiteIds: ["w-norte"] }))).toEqual([])
  })
})

// H-08 (AUDITORIA_BUGS_2026-08-05.md): la guarda de escritura vivía privada en
// Cobranza, así que las acciones de facturas y propuestas modificaban sin
// verificar el alcance del registro. Ahora es la contraparte puntual del
// predicado de lectura y se prueba con la misma regla.
describe("guarda de escritura por alcance", () => {
  it("un rol global alcanza cualquier factura", async () => {
    const global = session({ isGlobal: true })
    expect(await canReachInvoice(global, "inv-norte")).toBe(true)
    expect(await canReachInvoice(global, "inv-sur")).toBe(true)
    expect(await canReachInvoice(global, "inv-huerfana")).toBe(true)
  })

  it("un rol acotado sólo alcanza las facturas vinculadas a sus faenas", async () => {
    const norte = session({ isGlobal: false, worksiteIds: ["w-norte"] })
    expect(await canReachInvoice(norte, "inv-norte")).toBe(true)
    expect(await canReachInvoice(norte, "inv-sur")).toBe(false)
    // Sin vínculo confirmado no hay alcance: es la misma regla que impide
    // verla en el listado, aplicada a la escritura.
    expect(await canReachInvoice(norte, "inv-huerfana")).toBe(false)
  })

  it("un rol sin faenas no alcanza ninguna factura", async () => {
    const sinFaenas = session({ isGlobal: false, worksiteIds: [] })
    expect(await canReachInvoice(sinFaenas, "inv-norte")).toBe(false)
  })

  it("coincide con el modelo de lectura: lo que no se puede ver, no se puede escribir", async () => {
    const norte = session({ isGlobal: false, worksiteIds: ["w-norte"] })
    for (const invoiceId of ["inv-norte", "inv-sur", "inv-huerfana"]) {
      const visible = (await getInvoiceDetail(norte, invoiceId)) !== null
      expect(await canReachInvoice(norte, invoiceId)).toBe(visible)
    }
  })

  it("una propuesta se alcanza por su faena, y sin faena sólo la ve un rol global", async () => {
    await inMemoryDb.insert(schema.billingProposals).values([
      {
        id: "prop-norte", code: "PF-2026-9001", clientId: "cli-a", worksiteId: "w-norte",
        servicePeriod: PERIOD, currency: "CLP", status: "draft", createdBy: "u1",
      },
      {
        id: "prop-sin-faena", code: "PF-2026-9002", clientId: "cli-a", worksiteId: null,
        servicePeriod: PERIOD, currency: "CLP", status: "draft", createdBy: "u1",
      },
    ])

    const norte = session({ isGlobal: false, worksiteIds: ["w-norte"] })
    expect(await canReachProposal(norte, "prop-norte")).toBe(true)
    expect(await canReachProposal(norte, "prop-sin-faena")).toBe(false)
    expect(await canReachProposal(session({ isGlobal: true }), "prop-sin-faena")).toBe(true)
  })
})

describe("resumen", () => {
  it("separa facturado de cobrado y de vencido", async () => {
    const summary = await getBillingSummary(session({ isGlobal: true }), { period: PERIOD })

    expect(summary.invoicedByCurrency).toEqual([
      { currency: "CLP", amount: 3000000 },
      { currency: "USD", amount: 3000 },
    ])
    expect(summary.collectedByCurrency.find((m) => m.currency === "CLP")?.amount).toBe(500000)
    expect(summary.overdueByCurrency.find((m) => m.currency === "CLP")?.amount).toBe(1000000)
    expect(summary.overdueCount).toBe(1)
  })

  it("clasifica la antigüedad de la deuda", async () => {
    const summary = await getBillingSummary(session({ isGlobal: true }), { period: PERIOD })
    const overdue = summary.aging.find((bucket) => bucket.bucket === "d1_30")
    expect(overdue?.count).toBe(1)
    expect(overdue?.byCurrency).toEqual([{ currency: "CLP", amount: 1000000 }])

    const notDue = summary.aging.find((bucket) => bucket.bucket === "not_due")
    expect(notDue?.count).toBe(2)   // la de Faena Sur y la huérfana sin vencimiento
  })

  it("sin facturas pagadas no inventa un promedio de días de pago", async () => {
    const summary = await getBillingSummary(session({ isGlobal: true }), { period: PERIOD })
    expect(summary.averageDaysToPay).toBeNull()
  })

  it("atribuye facturación por cliente y por faena solo cuando hay vínculo", async () => {
    const summary = await getBillingSummary(session({ isGlobal: true }), { period: PERIOD })
    expect(summary.topClients.map((row) => row.clientName).sort()).toEqual(["Cliente A", "Cliente B"])
    expect(summary.byWorksite.map((row) => row.worksiteName).sort()).toEqual(["Faena Norte", "Faena Sur"])
    // La huérfana no aparece en ninguno de los dos.
    const worksiteTotal = summary.byWorksite.reduce((sum, row) => sum + row.amount, 0)
    expect(worksiteTotal).toBe(3000000)
  })
})

describe("computeSourceDifferences", () => {
  it("no reporta diferencias con una sola fuente", () => {
    expect(computeSourceDifferences([{ provider: "factura_en_linea", snapshot: { totalAmount: 100 } }])).toEqual([])
  })

  it("detecta el campo en que dos fuentes no coinciden", () => {
    const differences = computeSourceDifferences([
      { provider: "factura_en_linea", snapshot: { totalAmount: 100, dueDate: "2026-08-14" } },
      { provider: "chipax", snapshot: { totalAmount: 120, dueDate: "2026-08-14" } },
    ])
    expect(differences).toHaveLength(1)
    expect(differences[0]!.field).toBe("totalAmount")
    expect(differences[0]!.values).toEqual([
      { provider: "factura_en_linea", value: "100" },
      { provider: "chipax", value: "120" },
    ])
  })

  it("no decide quién tiene razón: solo reporta ambas versiones", () => {
    const differences = computeSourceDifferences([
      { provider: "factura_en_linea", snapshot: { documentStatus: "accepted" } },
      { provider: "chipax", snapshot: { documentStatus: "issued" } },
    ])
    expect(differences[0]!.values).toHaveLength(2)
  })
})
