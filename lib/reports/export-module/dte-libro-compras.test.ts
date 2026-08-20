import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireDteCodEmp: vi.fn(),
  rows: [] as unknown[],
}))

vi.mock("@/lib/services/dte-portal/require-cod-emp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/dte-portal/require-cod-emp")>(
    "@/lib/services/dte-portal/require-cod-emp",
  )
  return { ...actual, requireDteCodEmp: () => mocks.requireDteCodEmp() }
})
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(mocks.rows) }),
        }),
      }),
    }),
  },
}))
vi.mock("@/db/schema", () => ({ dteDocuments: {} }))
vi.mock("./utils", () => ({ buildDateFilter: () => undefined }))

const { dteLibroCompras } = await import("./dte-libro-compras")
const { DteCodEmpMissingError } = await import("@/lib/services/dte-portal/require-cod-emp")

const BASE = {
  tipoDte: "33",
  folio: 12715,
  fechaEmision: "2026-08-04",
  rutEmisor: "76987654-3",
  razonSocialEmisor: "Señalética Ñuble SpA",
  montoNeto: null as number | null,
  iva: null as number | null,
  montoTotal: 119000,
  estadoPlataforma: null as string | null,
}

/** Índices de columna: Neto, IVA, Origen montos, Estado plataforma. */
const NETO = 5, IVA = 6, ORIGEN = 8, ESTADO = 9

describe("dteLibroCompras", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireDteCodEmp.mockResolvedValue("433")
    mocks.rows = []
  })

  it("falla ruidosamente en vez de exportar un libro vacío cuando no hay codEmp configurado", async () => {
    mocks.requireDteCodEmp.mockRejectedValue(new DteCodEmpMissingError())

    await expect(dteLibroCompras(null, {}, 10)).rejects.toBeInstanceOf(DteCodEmpMissingError)
  })

  it("marca como leído del XML lo que la descarga ya persistió", async () => {
    mocks.rows = [{ ...BASE, montoNeto: 100000, iva: 19000 }]

    const report = await dteLibroCompras(null, {}, 10)

    expect(report.rows[0]![NETO]).toBe(100000)
    expect(report.rows[0]![IVA]).toBe(19000)
    expect(report.rows[0]![ORIGEN]).toBe("XML")
  })

  it("deriva neto e IVA de una factura afecta sin XML y lo declara derivado", async () => {
    // La ingesta escribe monto_neto/iva en null: sin esto el libro salía en
    // blanco en casi todas las filas.
    mocks.rows = [{ ...BASE }]

    const report = await dteLibroCompras(null, {}, 10)

    expect(report.rows[0]![NETO]).toBe(100000)
    expect(report.rows[0]![IVA]).toBe(19000)
    expect(report.rows[0]![ORIGEN]).toBe("Derivado (IVA 19%)")
  })

  it("no inventa IVA en una factura exenta: el neto es el total", async () => {
    mocks.rows = [{ ...BASE, tipoDte: "34", montoTotal: 50000 }]

    const report = await dteLibroCompras(null, {}, 10)

    expect(report.rows[0]![NETO]).toBe(50000)
    expect(report.rows[0]![IVA]).toBe(0)
    expect(report.rows[0]![ORIGEN]).toBe("Derivado (exento)")
  })

  it("deja en blanco los tipos cuya condición no se conoce (NC, guías)", async () => {
    mocks.rows = [{ ...BASE, tipoDte: "61", montoTotal: -119000 }]

    const report = await dteLibroCompras(null, {}, 10)

    expect(report.rows[0]![NETO]).toBeNull()
    expect(report.rows[0]![IVA]).toBeNull()
    expect(report.rows[0]![ORIGEN]).toBe("Sin XML")
  })

  it("completa el IVA por resta cuando sólo falta él", async () => {
    mocks.rows = [{ ...BASE, tipoDte: "61", montoNeto: 90000, montoTotal: 107100 }]

    const report = await dteLibroCompras(null, {}, 10)

    expect(report.rows[0]![IVA]).toBe(17100)
    expect(report.rows[0]![ORIGEN]).toBe("Derivado (total − neto)")
  })

  it("informa el estado de plataforma, la única columna de estado que llega poblada", async () => {
    mocks.rows = [{ ...BASE, estadoPlataforma: "Pendiente de envio a la Plataforma" }]

    const report = await dteLibroCompras(null, {}, 10)

    expect(report.headers).toContain("Estado plataforma")
    expect(report.headers).not.toContain("Estado SII")
    expect(report.rows[0]![ESTADO]).toBe("Pendiente de envio a la Plataforma")
  })
})
