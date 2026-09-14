import { describe, it, expect } from "vitest"
import {
  computePayloadHash,
  derivePaymentStatus,
  outstandingAmountFor,
  resolveDueDate,
  addDays,
  daysOverdue,
} from "../invoices"
import { agingBucketFor, AGING_BUCKETS } from "../config"
import type { ProviderInvoice } from "../providers/types"

function invoice(overrides: Partial<ProviderInvoice> = {}): ProviderInvoice {
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

describe("computePayloadHash", () => {
  it("es determinista: el mismo documento produce el mismo hash", () => {
    expect(computePayloadHash(invoice())).toBe(computePayloadHash(invoice()))
  })

  it("no depende de campos que no son del documento", () => {
    // La URL del PDF o los ítems no cambian la identidad ni el contenido
    // tributario reportado, así que no deben provocar un falso "cambió".
    expect(computePayloadHash(invoice({ documentUrl: "pdf_dte.php?post=abc" })))
      .toBe(computePayloadHash(invoice()))
  })

  it("cambia cuando cambia el estado o un monto", () => {
    const base = computePayloadHash(invoice())
    expect(computePayloadHash(invoice({ documentStatus: "void" }))).not.toBe(base)
    expect(computePayloadHash(invoice({ totalAmount: 4998001 }))).not.toBe(base)
    expect(computePayloadHash(invoice({ dueDate: "2026-09-14" }))).not.toBe(base)
  })

  it("distingue null de cero en los montos opcionales", () => {
    expect(computePayloadHash(invoice({ exemptAmount: 0 })))
      .not.toBe(computePayloadHash(invoice({ exemptAmount: null })))
  })
})

describe("resolveDueDate — precedencia de fuentes", () => {
  const base = {
    existingDueDate: null,
    existingSource: null,
    providerDueDate: null,
    issueDate: "2026-07-15",
    contractTermsDays: null,
    clientTermsDays: null,
  } as const

  it("una fecha puesta a mano nunca se sobrescribe", () => {
    const result = resolveDueDate({
      ...base,
      existingDueDate: "2026-09-30",
      existingSource: "manual",
      providerDueDate: "2026-08-14",
      contractTermsDays: 30,
    })
    expect(result).toEqual({ dueDate: "2026-09-30", source: "manual" })
  })

  it("el documento (FchVenc) gana sobre el contrato", () => {
    expect(resolveDueDate({ ...base, providerDueDate: "2026-08-14", contractTermsDays: 60 }))
      .toEqual({ dueDate: "2026-08-14", source: "provider" })
  })

  it("el contrato gana sobre el cliente", () => {
    expect(resolveDueDate({ ...base, contractTermsDays: 30, clientTermsDays: 60 }))
      .toEqual({ dueDate: "2026-08-14", source: "contract" })
  })

  it("cae al plazo del cliente cuando no hay contrato con plazo", () => {
    expect(resolveDueDate({ ...base, clientTermsDays: 45 }))
      .toEqual({ dueDate: "2026-08-29", source: "client" })
  })

  it("sin ninguna fuente deja el vencimiento en blanco en vez de inventarlo", () => {
    expect(resolveDueDate(base)).toEqual({ dueDate: null, source: null })
  })

  it("un plazo de 0 días es válido y significa contado", () => {
    expect(resolveDueDate({ ...base, clientTermsDays: 0 }))
      .toEqual({ dueDate: "2026-07-15", source: "client" })
  })
})

describe("addDays / daysOverdue", () => {
  it("cruza fin de mes y año sin desplazar el día", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29") // bisiesto
  })

  it("cuenta atraso positivo y adelanto negativo", () => {
    expect(daysOverdue("2026-08-14", "2026-08-20")).toBe(6)
    expect(daysOverdue("2026-08-14", "2026-08-14")).toBe(0)
    expect(daysOverdue("2026-08-14", "2026-08-01")).toBe(-13)
  })
})

describe("agingBucketFor", () => {
  it("clasifica los tramos declarados", () => {
    expect(agingBucketFor(-5)).toBe("not_due")
    expect(agingBucketFor(0)).toBe("not_due")
    expect(agingBucketFor(1)).toBe("d1_30")
    expect(agingBucketFor(30)).toBe("d1_30")
    expect(agingBucketFor(31)).toBe("d31_60")
    expect(agingBucketFor(60)).toBe("d31_60")
    expect(agingBucketFor(61)).toBe("d61_90")
    expect(agingBucketFor(90)).toBe("d61_90")
    expect(agingBucketFor(91)).toBe("d90_plus")
    expect(agingBucketFor(3650)).toBe("d90_plus")
  })

  it("los tramos del catálogo cubren todo sin solaparse", () => {
    for (let days = 1; days <= 200; days++) {
      const bucketId = agingBucketFor(days)
      const bucket = AGING_BUCKETS.find((candidate) => candidate.id === bucketId)!
      expect(days).toBeGreaterThanOrEqual(bucket.minDays!)
      if (bucket.maxDays !== null) expect(days).toBeLessThanOrEqual(bucket.maxDays)
    }
  })
})

describe("derivePaymentStatus", () => {
  it("sin pagos confirmados la factura está impaga", () => {
    expect(derivePaymentStatus(1190000, [])).toEqual({
      paidAmount: 0, paymentStatus: "unpaid", outstandingAmount: 1190000,
    })
  })

  it("un pago menor deja pago parcial con saldo exacto", () => {
    expect(derivePaymentStatus(1190000, [500000])).toEqual({
      paidAmount: 500000, paymentStatus: "partial", outstandingAmount: 690000,
    })
  })

  it("varios pagos parciales que suman el total dejan la factura pagada", () => {
    expect(derivePaymentStatus(1190000, [500000, 690000])).toEqual({
      paidAmount: 1190000, paymentStatus: "paid", outstandingAmount: 0,
    })
  })

  it("suma decimales sin deriva de punto flotante", () => {
    const result = derivePaymentStatus(0.3, [0.1, 0.2])
    expect(result.paymentStatus).toBe("paid")
    expect(result.paidAmount).toBe(0.3)
  })

  it("detecta sobrepago en vez de esconderlo como pagado", () => {
    const result = derivePaymentStatus(1190000, [1200000])
    expect(result.paymentStatus).toBe("overpaid")
  })

  // FVE-003. Esta prueba AFIRMABA LO CONTRARIO —`toBe(-10000)`—, consagrando el
  // defecto: el sobrepago devolvía un pendiente negativo mientras el caso
  // `paid` devolvía 0, y cualquier cartera que sumara ese saldo restaba de más
  // y compensaba deuda real de otras facturas. Lo pendiente de un documento
  // cubierto de sobra es cero; el exceso se lee en `paidAmount`.
  it("una factura sobrepagada no informa pendiente negativo", () => {
    const result = derivePaymentStatus(1190000, [1200000])
    expect(result.paidAmount).toBe(1200000)
    expect(result.outstandingAmount).toBe(0)
  })

  // El recorte del sobrepago no puede tapar el caso inverso: una cobertura de
  // signo contrario HACE CRECER lo pendiente y eso se conserva.
  it("recorta el sobrepago sin recortar el pendiente que crece", () => {
    expect(outstandingAmountFor(1190000, 1200000)).toBe(0)
    expect(outstandingAmountFor(-1190000, -1200000)).toBe(0)
    expect(outstandingAmountFor(1190000, -1190000)).toBe(2380000)
    expect(outstandingAmountFor(1190000, 500000)).toBe(690000)
  })

  it("trata una nota de crédito (total negativo) por su magnitud", () => {
    expect(derivePaymentStatus(-1190000, [-1190000]).paymentStatus).toBe("paid")
    expect(derivePaymentStatus(-1190000, [-500000]).paymentStatus).toBe("partial")
  })

  // Un ajuste negativo (devolución) sobre una factura POSITIVA no la cubre: se
  // comparaba |suma de pagos| contra |total| y la magnitud coincidía, así que la
  // factura quedaba "pagada" y desaparecía de la cobranza con el cobro vivo.
  it("un pago negativo no marca pagada una factura positiva", () => {
    expect(derivePaymentStatus(1190000, [-1190000])).toEqual({
      paidAmount: -1190000, paymentStatus: "unpaid", outstandingAmount: 2380000,
    })
  })

  it("tampoco cuando la suma de pagos queda negativa", () => {
    const result = derivePaymentStatus(1000000, [600000, -1600000])
    expect(result.paymentStatus).toBe("unpaid")
    expect(result.outstandingAmount).toBe(2000000)
  })

  it("una nota de crédito no se cubre con un pago positivo", () => {
    expect(derivePaymentStatus(-1190000, [1190000]).paymentStatus).toBe("unpaid")
  })

  it("una diferencia menor a un centavo no impide marcar pagada", () => {
    expect(derivePaymentStatus(1190000, [1189999.999]).paymentStatus).toBe("paid")
  })
})
