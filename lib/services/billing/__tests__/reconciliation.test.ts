import { describe, it, expect } from "vitest"
import {
  proposeMatches,
  mentionsFolio,
  namesLookAlike,
  assertAllocationFits,
  type InvoiceForMatching,
  type TransactionForMatching,
} from "../reconciliation"
import { classifyCollection } from "../collections"

const OPTIONS = { amountTolerance: 1000, dateWindowDays: 60 }

function invoice(overrides: Partial<InvoiceForMatching> = {}): InvoiceForMatching {
  return {
    id: "inv-1",
    folio: 1234,
    counterpartyTaxId: "76543210-K",
    counterpartyName: "MINERA EJEMPLO SPA",
    issueDate: "2026-07-15",
    dueDate: "2026-08-14",
    currency: "CLP",
    totalAmount: 4998000,
    paidAmount: 0,
    ...overrides,
  }
}

function transaction(overrides: Partial<TransactionForMatching> = {}): TransactionForMatching {
  return {
    id: "tx-1",
    transactionDate: "2026-08-14",
    amount: 4998000,
    currency: "CLP",
    description: "TRANSFERENCIA MINERA EJEMPLO",
    counterpartyName: "MINERA EJEMPLO SPA",
    counterpartyTaxId: "76543210-K",
    allocatedAmount: 0,
    ...overrides,
  }
}

describe("proposeMatches — cuándo propone", () => {
  it("propone con monto exacto y RUT coincidente, con confianza alta", () => {
    const [candidate] = proposeMatches([invoice()], [transaction()], OPTIONS)
    expect(candidate).toBeDefined()
    expect(candidate!.confidence).toBe("high")
    expect(candidate!.matchedAmount).toBe(4998000)
    expect(candidate!.remainingAmount).toBe(0)
    expect(candidate!.evidence.join(" ")).toMatch(/RUT/)
  })

  it("propone cuando la glosa menciona el folio, aunque el monto no calce", () => {
    const [candidate] = proposeMatches(
      [invoice()],
      [transaction({ amount: 2000000, description: "ABONO FACT 1234", counterpartyTaxId: null })],
      OPTIONS,
    )
    expect(candidate).toBeDefined()
    expect(candidate!.evidence.join(" ")).toMatch(/folio 1234/)
    // Es un abono parcial: se propone imputar solo lo disponible.
    expect(candidate!.matchedAmount).toBe(2000000)
    expect(candidate!.remainingAmount).toBe(2998000)
  })

  it("NO propone nada si solo coincide la fecha o el cliente", () => {
    const candidates = proposeMatches(
      [invoice()],
      [transaction({ amount: 123456, description: "PAGO PROVEEDORES" })],
      OPTIONS,
    )
    expect(candidates).toEqual([])
  })

  it("nunca cruza monedas distintas", () => {
    const candidates = proposeMatches(
      [invoice({ currency: "USD" })],
      [transaction({ currency: "CLP" })],
      OPTIONS,
    )
    expect(candidates).toEqual([])
  })

  it("ignora un movimiento ya imputado por completo", () => {
    const candidates = proposeMatches(
      [invoice()],
      [transaction({ allocatedAmount: 4998000 })],
      OPTIONS,
    )
    expect(candidates).toEqual([])
  })

  it("ignora una factura sin saldo", () => {
    const candidates = proposeMatches([invoice({ paidAmount: 4998000 })], [transaction()], OPTIONS)
    expect(candidates).toEqual([])
  })

  it("respeta la tolerancia de monto configurada", () => {
    const dentro = proposeMatches([invoice()], [transaction({ amount: 4997500 })], OPTIONS)
    expect(dentro).toHaveLength(1)

    const fuera = proposeMatches([invoice()], [transaction({ amount: 4990000, description: "PAGO" })], OPTIONS)
    expect(fuera).toEqual([])
  })
})

describe("proposeMatches — dirección del movimiento", () => {
  // Un cargo (plata que salió) no paga una factura de venta. Antes se comparaban
  // magnitudes: cualquier cargo de monto parecido daba por cobrada la factura, y
  // la persona que confirma no ve en pantalla el signo del movimiento.
  it("no propone un cargo bancario contra una factura de venta", () => {
    const candidates = proposeMatches([invoice()], [transaction({ amount: -4998000 })], OPTIONS)
    expect(candidates).toEqual([])
  })

  it("tampoco cuando la glosa menciona el folio", () => {
    const candidates = proposeMatches(
      [invoice()],
      [transaction({ amount: -2000000, description: "PAGO PROVEEDOR FACT 1234" })],
      OPTIONS,
    )
    expect(candidates).toEqual([])
  })

  it("en compras es al revés: el cargo sí paga y el abono no", () => {
    const compra = { ...OPTIONS, direction: "purchase" as const }
    expect(proposeMatches([invoice()], [transaction({ amount: -4998000 })], compra)).toHaveLength(1)
    expect(proposeMatches([invoice()], [transaction()], compra)).toEqual([])
  })

  it("una nota de crédito de venta (saldo negativo) se cubre con un cargo", () => {
    const nota = invoice({ totalAmount: -4998000 })
    expect(proposeMatches([nota], [transaction({ amount: -4998000 })], OPTIONS)).toHaveLength(1)
    expect(proposeMatches([nota], [transaction()], OPTIONS)).toEqual([])
  })
})

describe("proposeMatches — confianza", () => {
  it("baja la confianza cuando el RUT no coincide", () => {
    const [candidate] = proposeMatches(
      [invoice()],
      [transaction({ counterpartyTaxId: "77999999-9" })],
      OPTIONS,
    )
    expect(candidate!.confidence).not.toBe("high")
    expect(candidate!.warnings.join(" ")).toMatch(/RUT/)
  })

  it("da confianza media cuando calza el monto y la fecha pero no hay RUT", () => {
    const [candidate] = proposeMatches(
      [invoice()],
      [transaction({ counterpartyTaxId: null, counterpartyName: null })],
      OPTIONS,
    )
    expect(candidate!.confidence).toBe("medium")
  })

  it("advierte cuando el movimiento es anterior a la emisión de la factura", () => {
    const [candidate] = proposeMatches(
      [invoice()],
      [transaction({ transactionDate: "2026-07-01" })],
      OPTIONS,
    )
    expect(candidate!.warnings.join(" ")).toMatch(/anterior a la emisión/i)
    // Una advertencia degrada la confianza: no se presenta como certeza.
    expect(candidate!.confidence).toBe("medium")
  })

  it("advierte cuando el movimiento cae fuera de la ventana de fechas", () => {
    const [candidate] = proposeMatches(
      [invoice()],
      [transaction({ transactionDate: "2027-06-01" })],
      OPTIONS,
    )
    expect(candidate!.warnings.join(" ")).toMatch(/fuera de la ventana/i)
  })

  it("ordena primero lo más confiable", () => {
    const candidates = proposeMatches(
      [invoice({ id: "inv-a" }), invoice({ id: "inv-b", counterpartyTaxId: "77999999-9" })],
      [transaction()],
      OPTIONS,
    )
    expect(candidates[0]!.invoiceId).toBe("inv-a")
    expect(candidates[0]!.confidence).toBe("high")
  })
})

describe("proposeMatches — pagos parciales y múltiples", () => {
  it("un movimiento grande se propone contra varias facturas", () => {
    const candidates = proposeMatches(
      [
        invoice({ id: "inv-a", folio: 1001, totalAmount: 1000000 }),
        invoice({ id: "inv-b", folio: 1002, totalAmount: 1000000 }),
      ],
      [transaction({ amount: 1000000, description: "PAGO FACTURAS" })],
      OPTIONS,
    )
    expect(candidates).toHaveLength(2)
    expect(candidates.map((candidate) => candidate.invoiceId).sort()).toEqual(["inv-a", "inv-b"])
  })

  it("nunca propone imputar más que el saldo de la factura", () => {
    const [candidate] = proposeMatches(
      [invoice({ totalAmount: 1000000 })],
      [transaction({ amount: 5000000, description: "ABONO FACT 1234" })],
      OPTIONS,
    )
    expect(candidate!.matchedAmount).toBe(1000000)
    expect(candidate!.remainingAmount).toBe(0)
  })

  it("descuenta lo ya imputado del movimiento", () => {
    const [candidate] = proposeMatches(
      [invoice({ totalAmount: 1000000 })],
      [transaction({ amount: 3000000, allocatedAmount: 2500000, description: "ABONO FACT 1234" })],
      OPTIONS,
    )
    expect(candidate!.matchedAmount).toBe(500000)
  })

  it("considera lo ya pagado de la factura", () => {
    const [candidate] = proposeMatches(
      [invoice({ totalAmount: 1000000, paidAmount: 600000 })],
      [transaction({ amount: 400000 })],
      OPTIONS,
    )
    expect(candidate!.matchedAmount).toBe(400000)
    expect(candidate!.remainingAmount).toBe(0)
  })
})

describe("mentionsFolio", () => {
  it("reconoce el folio delimitado", () => {
    expect(mentionsFolio("PAGO FACT 1234", 1234)).toBe(true)
    expect(mentionsFolio("1234", 1234)).toBe(true)
    expect(mentionsFolio("REF:1234/ABONO", 1234)).toBe(true)
  })

  it("no confunde el folio con parte de otro número", () => {
    expect(mentionsFolio("TRANSFER 51234", 1234)).toBe(false)
    expect(mentionsFolio("12345", 1234)).toBe(false)
  })

  it("tolera una glosa vacía", () => {
    expect(mentionsFolio(null, 1234)).toBe(false)
    expect(mentionsFolio("", 1234)).toBe(false)
  })
})

describe("namesLookAlike", () => {
  it("ignora tildes, sufijos societarios y puntuación", () => {
    expect(namesLookAlike("MINERA EJEMPLO S.A.", "Minera Ejemplo SA")).toBe(true)
    expect(namesLookAlike("CONSTRUCTORA ÑUÑOA LTDA", "Constructora Nunoa Limitada")).toBe(true)
  })

  it("no empareja nombres distintos", () => {
    expect(namesLookAlike("MINERA EJEMPLO", "TRANSPORTES DEL SUR")).toBe(false)
  })

  it("no empareja fragmentos demasiado cortos", () => {
    expect(namesLookAlike("SA", "SALFA")).toBe(false)
    expect(namesLookAlike(null, "MINERA")).toBe(false)
  })
})

describe("assertAllocationFits", () => {
  it("acepta imputar dentro de lo disponible", () => {
    expect(() => assertAllocationFits(1000000, 400000, 600000)).not.toThrow()
  })

  it("rechaza sobregirar un movimiento", () => {
    expect(() => assertAllocationFits(1000000, 400000, 700000)).toThrow(/disponibles/i)
  })

  it("trata montos negativos por su magnitud (notas de crédito)", () => {
    expect(() => assertAllocationFits(-1000000, 0, -1000000)).not.toThrow()
    expect(() => assertAllocationFits(-1000000, -900000, -200000)).toThrow()
  })
})

describe("classifyCollection", () => {
  const base = { paymentStatus: "unpaid", collectionStatus: "none", daysOverdue: null, daysSinceLastAction: null }

  it("una factura pagada siempre cae en pagadas", () => {
    expect(classifyCollection({ ...base, paymentStatus: "paid", daysOverdue: 90 })).toBe("paid")
  })

  it("la disputa manda sobre el vencimiento", () => {
    expect(classifyCollection({ ...base, collectionStatus: "disputed", daysOverdue: 40 })).toBe("disputed")
  })

  it("el compromiso manda sobre el vencimiento", () => {
    expect(classifyCollection({ ...base, collectionStatus: "committed", daysOverdue: 10 })).toBe("committed")
  })

  it("clasifica vencidas, próximas a vencer y en plazo", () => {
    expect(classifyCollection({ ...base, daysOverdue: 1 })).toBe("overdue")
    expect(classifyCollection({ ...base, daysOverdue: -3 })).toBe("due_soon")
    expect(classifyCollection({ ...base, daysOverdue: -30 })).toBe("pending")
  })

  it("un pago parcial dentro de plazo se muestra como parcial", () => {
    expect(classifyCollection({ ...base, paymentStatus: "partial", daysOverdue: -30 })).toBe("partial")
  })

  it("marca las abandonadas por falta de gestión", () => {
    expect(classifyCollection({ ...base, daysOverdue: -60, daysSinceLastAction: 45 })).toBe("no_recent_activity")
    expect(classifyCollection({ ...base, daysOverdue: -60, daysSinceLastAction: 10 })).toBe("pending")
  })

  // Una sobrepagada está cubierta: dejarla en "vencidas" la mostraba como deuda
  // del cliente cuando en realidad hay que devolverle plata, y su saldo negativo
  // neteaba el subtotal del grupo.
  it("una sobrepagada cae en pagadas, no en vencidas", () => {
    expect(classifyCollection({ ...base, paymentStatus: "overpaid", daysOverdue: 5 })).toBe("paid")
  })

  it("una factura sin vencimiento no se declara vencida", () => {
    expect(classifyCollection({ ...base, daysOverdue: null })).toBe("pending")
  })
})
