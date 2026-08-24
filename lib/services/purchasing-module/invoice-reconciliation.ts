export const CLP_RECONCILIATION_TOLERANCE = 1
export const INVOICE_RECONCILIATION_VERSION = 1

export type InvoiceReconciliationStatus = "no_invoices" | "matched" | "needs_review" | "accepted_exception"
export type InvoiceReconciliationIssueCode =
  | "unlinked_line"
  | "missing_unit"
  | "unit_mismatch"
  | "price_variance"
  | "pending_oc_cost"
  | "invoice_without_lines"
  | "quantity_under"
  | "quantity_over"
  | "quantity_over_received"
  | "supplier_unverified"
  | "total_mismatch"

export interface InvoiceReconciliationOrderItem {
  id: string
  productId?: string | null
  productName: string
  quantity: number
  unitOfMeasure?: string | null
  unitPrice?: number | null
  subtotal?: number | null
  currentSupplierPrice?: number | null
  supplierReceivedQuantity?: number | null
}

export interface InvoiceReconciliationInvoiceItem {
  id?: string
  purchaseOrderItemId: string | null
  productName?: string
  unitOfMeasure?: string | null
  quantity: number
  unitPrice?: number | null
  subtotal?: number | null
}

export interface InvoiceReconciliationInvoice {
  id: string
  invoiceNumber: string
  amount: number | null
  issueDate?: string | null
  uploadedAt?: string | null
  items?: InvoiceReconciliationInvoiceItem[]
  supplierIdentityStatus?: "unknown" | "verified" | "unverified"
  documentSupplierRut?: string | null
  supplierIdentitySource?: string | null
}

export interface InvoiceReconciliationReview {
  id: string
  fingerprint: string
  reason: string
  reviewedByName?: string | null
  createdAt: string
  evidence?: unknown
}

export interface InvoiceReconciliationIssue {
  code: InvoiceReconciliationIssueCode
  orderItemId?: string
  invoiceId?: string
  invoiceItemId?: string
  expected?: number | string | null
  actual?: number | string | null
  difference?: number
  percentage?: number | null
}

export type MoneyReconciliationStatus = "no_invoices" | "matched" | "mismatch"
export type LineReconciliationStatus = "not_evaluable" | "unlinked" | "partial" | "covered"
export type ReceiptReconciliationStatus = "no_invoices" | "not_evaluable" | "covered" | "over_invoiced"

export interface ReconciledOrderItem {
  ocItemId: string
  productId: string | null
  productName: string
  unitOfMeasure: string | null
  ocQuantity: number
  invoicedQty: number
  supplierReceivedQty: number
  invoiceVsReceivedDifference: number
  receiptStatus: "not_evaluable" | "not_invoiced" | "covered" | "over_invoiced"
  difference: number
  matched: boolean
  status: "not_evaluable" | "not_covered" | "partial" | "covered" | "over_invoiced"
  ocEffectiveUnitPrice: number | null
  invoiceEffectiveUnitPrice: number | null
  priceDifference: number | null
  pricePercentage: number | null
  currentSupplierPrice: number | null
  linkedInvoiceItemIds: string[]
}

export interface InvoiceEvidenceStatus {
  invoiceId: string
  invoiceNumber: string
  status: "without_lines" | "unlinked_lines" | "partial" | "linked_lines"
  linkedLineCount: number
  unlinkedLineCount: number
}

export interface InvoiceReconciliationEvidence {
  version: number
  status: InvoiceReconciliationStatus
  fingerprint: string
  hasInvoices: boolean
  totalInvoiced: number
  totalOC: number
  money: { status: MoneyReconciliationStatus; tolerance: number; difference: number }
  lines: { status: LineReconciliationStatus; invoicesWithoutLines: number; linkedLineCount: number; unlinkedLineCount: number }
  receipt: { status: ReceiptReconciliationStatus; overInvoicedLineCount: number }
  items: ReconciledOrderItem[]
  invoices: InvoiceEvidenceStatus[]
  issues: InvoiceReconciliationIssue[]
  currentReview: InvoiceReconciliationReview | null
  previousReview: InvoiceReconciliationReview | null
}

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function nullableFinite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function effectiveUnitPrice(subtotal: number | null | undefined, quantity: number) {
  const normalizedSubtotal = nullableFinite(subtotal)
  return normalizedSubtotal === null || quantity <= 0 ? null : normalizedSubtotal / quantity
}

function normalizeUnit(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase("es-CL").replace(/[._]/g, "")
  if (!normalized) return null
  const aliases: Record<string, string> = {
    u: "unidad", un: "unidad", und: "unidad", unidad: "unidad", unidades: "unidad",
    kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
    g: "g", gr: "g", gramo: "g", gramos: "g",
    l: "l", lt: "l", lts: "l", litro: "l", litros: "l",
    ml: "ml", mililitro: "ml", mililitros: "ml",
    m: "m", mt: "m", mts: "m", metro: "m", metros: "m",
    caja: "caja", cajas: "caja", par: "par", pares: "par",
    servicio: "servicio", servicios: "servicio",
  }
  return aliases[normalized] ?? normalized
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return value
}

/** Browser-safe SHA-256 so the same canonical contract can also render client-side. */
function sha256(value: string) {
  const source = new TextEncoder().encode(value)
  const bitLength = source.length * 8
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(source)
  padded[source.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 4, bitLength, false)
  const words = new Uint32Array(64)
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const constants = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ])
  const rotate = (input: number, bits: number) => (input >>> bits) | (input << (32 - bits))

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index++) {
      const previous = words[index - 15]!
      const before = words[index - 2]!
      const sigma0 = rotate(previous, 7) ^ rotate(previous, 18) ^ (previous >>> 3)
      const sigma1 = rotate(before, 17) ^ rotate(before, 19) ^ (before >>> 10)
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index++) {
      const sum1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)
      const choice = (e! & f!) ^ (~e! & g!)
      const temp1 = (h! + sum1 + choice + constants[index]! + words[index]!) >>> 0
      const sum0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!)
      const temp2 = (sum0 + majority) >>> 0
      h = g; g = f; f = e; e = (d! + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    hash[0] = (hash[0]! + a!) >>> 0; hash[1] = (hash[1]! + b!) >>> 0
    hash[2] = (hash[2]! + c!) >>> 0; hash[3] = (hash[3]! + d!) >>> 0
    hash[4] = (hash[4]! + e!) >>> 0; hash[5] = (hash[5]! + f!) >>> 0
    hash[6] = (hash[6]! + g!) >>> 0; hash[7] = (hash[7]! + h!) >>> 0
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("")
}

function fingerprintFor(value: unknown) {
  return `v${INVOICE_RECONCILIATION_VERSION}:${sha256(JSON.stringify(stableValue(value)))}`
}

export function reconcileInvoiceEvidence({
  totalOC,
  orderItems,
  invoices,
  reviews = [],
}: {
  totalOC: number
  orderItems: InvoiceReconciliationOrderItem[]
  invoices: InvoiceReconciliationInvoice[]
  reviews?: InvoiceReconciliationReview[]
}): InvoiceReconciliationEvidence {
  const sortedOrderItems = [...orderItems].sort((a, b) => a.id.localeCompare(b.id))
  const sortedInvoices = [...invoices]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((invoice) => ({ ...invoice, items: [...(invoice.items ?? [])].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")) }))
  const totalInvoiced = sortedInvoices.reduce((sum, invoice) => sum + finite(invoice.amount), 0)
  const moneyDifference = totalInvoiced - totalOC
  const hasInvoices = sortedInvoices.length > 0
  const orderItemById = new Map(sortedOrderItems.map((item) => [item.id, item]))
  const linkedLinesByOrderItem = new Map<string, Array<InvoiceReconciliationInvoiceItem & { invoiceId: string }>>()
  const issues: InvoiceReconciliationIssue[] = []
  let invoicesWithoutLines = 0
  let linkedLineCount = 0
  let unlinkedLineCount = 0

  const perInvoice = sortedInvoices.map((invoice) => {
    if (invoice.supplierIdentityStatus === "unverified") {
      issues.push({ code: "supplier_unverified", invoiceId: invoice.id })
    }
    const lines = invoice.items ?? []
    if (lines.length === 0) {
      invoicesWithoutLines += 1
      issues.push({ code: "invoice_without_lines", invoiceId: invoice.id })
      return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, status: "without_lines" as const, linkedLineCount: 0, unlinkedLineCount: 0 }
    }
    let invoiceLinked = 0
    let invoiceUnlinked = 0
    for (const line of lines) {
      const orderItem = line.purchaseOrderItemId ? orderItemById.get(line.purchaseOrderItemId) : null
      if (!orderItem) {
        invoiceUnlinked += 1
        unlinkedLineCount += 1
        issues.push({ code: "unlinked_line", invoiceId: invoice.id, invoiceItemId: line.id })
        continue
      }
      invoiceLinked += 1
      linkedLineCount += 1
      const linked = linkedLinesByOrderItem.get(orderItem.id) ?? []
      linked.push({ ...line, invoiceId: invoice.id })
      linkedLinesByOrderItem.set(orderItem.id, linked)

      const ocUnit = normalizeUnit(orderItem.unitOfMeasure)
      const invoiceUnit = normalizeUnit(line.unitOfMeasure)
      if (!ocUnit || !invoiceUnit) {
        issues.push({ code: "missing_unit", orderItemId: orderItem.id, invoiceId: invoice.id, invoiceItemId: line.id, expected: orderItem.unitOfMeasure ?? null, actual: line.unitOfMeasure ?? null })
        continue
      }
      if (ocUnit !== invoiceUnit) {
        issues.push({ code: "unit_mismatch", orderItemId: orderItem.id, invoiceId: invoice.id, invoiceItemId: line.id, expected: orderItem.unitOfMeasure ?? null, actual: line.unitOfMeasure ?? null })
        continue
      }
      const ocPrice = effectiveUnitPrice(orderItem.subtotal, orderItem.quantity)
      const invoicePrice = effectiveUnitPrice(line.subtotal, line.quantity)
      if (ocPrice !== null && invoicePrice !== null) {
        const difference = invoicePrice - ocPrice
        if (Math.abs(difference) > CLP_RECONCILIATION_TOLERANCE) {
          issues.push({
            code: "price_variance", orderItemId: orderItem.id, invoiceId: invoice.id, invoiceItemId: line.id,
            expected: ocPrice, actual: invoicePrice, difference,
            percentage: ocPrice === 0 ? null : difference / ocPrice * 100,
          })
        }
      }
    }
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoiceLinked === 0 ? "unlinked_lines" as const : invoiceUnlinked > 0 ? "partial" as const : "linked_lines" as const,
      linkedLineCount: invoiceLinked,
      unlinkedLineCount: invoiceUnlinked,
    }
  })

  if (hasInvoices && Math.abs(moneyDifference) > CLP_RECONCILIATION_TOLERANCE) {
    issues.push({ code: "total_mismatch", expected: totalOC, actual: totalInvoiced, difference: moneyDifference })
  }

  const noLineEvidence = !hasInvoices || (linkedLineCount === 0 && unlinkedLineCount === 0)
  const items = sortedOrderItems.map((item): ReconciledOrderItem => {
    const linkedLines = linkedLinesByOrderItem.get(item.id) ?? []
    const invoicedQty = linkedLines.reduce((sum, line) => sum + finite(line.quantity), 0)
    const receiptEvaluable = nullableFinite(item.supplierReceivedQuantity) !== null
    const supplierReceivedQty = finite(item.supplierReceivedQuantity)
    const invoiceVsReceivedDifference = invoicedQty - supplierReceivedQty
    const invoiceSubtotal = linkedLines.reduce((sum, line) => sum + finite(line.subtotal), 0)
    const difference = item.quantity - invoicedQty
    const matched = Math.abs(difference) < 0.01
    const ocEffectiveUnitPrice = effectiveUnitPrice(item.subtotal, item.quantity)
    const invoiceEffectiveUnitPrice = effectiveUnitPrice(invoiceSubtotal, invoicedQty)
    const priceDifference = ocEffectiveUnitPrice === null || invoiceEffectiveUnitPrice === null ? null : invoiceEffectiveUnitPrice - ocEffectiveUnitPrice

    if (hasInvoices && !matched) {
      issues.push({ code: difference < 0 ? "quantity_over" : "quantity_under", orderItemId: item.id, expected: item.quantity, actual: invoicedQty, difference: -difference })
    }
    if (hasInvoices && receiptEvaluable && invoiceVsReceivedDifference > 0.01) {
      issues.push({
        code: "quantity_over_received",
        orderItemId: item.id,
        expected: supplierReceivedQty,
        actual: invoicedQty,
        difference: invoiceVsReceivedDifference,
      })
    }
    if (hasInvoices && item.unitPrice === null) issues.push({ code: "pending_oc_cost", orderItemId: item.id })

    return {
      ocItemId: item.id,
      productId: item.productId ?? null,
      productName: item.productName,
      unitOfMeasure: item.unitOfMeasure ?? null,
      ocQuantity: item.quantity,
      invoicedQty,
      supplierReceivedQty,
      invoiceVsReceivedDifference,
      receiptStatus: !receiptEvaluable ? "not_evaluable" : invoicedQty === 0 ? "not_invoiced" : invoiceVsReceivedDifference > 0.01 ? "over_invoiced" : "covered",
      difference,
      matched,
      status: noLineEvidence ? "not_evaluable" : invoicedQty === 0 ? "not_covered" : matched ? "covered" : difference < 0 ? "over_invoiced" : "partial",
      ocEffectiveUnitPrice,
      invoiceEffectiveUnitPrice,
      priceDifference,
      pricePercentage: priceDifference === null || ocEffectiveUnitPrice === null || ocEffectiveUnitPrice === 0 ? null : priceDifference / ocEffectiveUnitPrice * 100,
      currentSupplierPrice: nullableFinite(item.currentSupplierPrice),
      linkedInvoiceItemIds: linkedLines.flatMap((line) => line.id ? [line.id] : []),
    }
  })

  const allItemsCovered = items.length > 0 && items.every((item) => item.status === "covered")
  const lineStatus: LineReconciliationStatus = noLineEvidence
    ? "not_evaluable"
    : linkedLineCount === 0
      ? "unlinked"
      : allItemsCovered && invoicesWithoutLines === 0 && unlinkedLineCount === 0
        ? "covered"
        : "partial"
  // El precio vigente del catálogo es contexto visual, no evidencia documental.
  // Una actualización del catálogo no debe invalidar una revisión ya aceptada.
  const fingerprintOrderItems = sortedOrderItems.map(({ currentSupplierPrice: _catalogPrice, supplierReceivedQuantity: _receipt, ...item }) => item)
  const fingerprintInvoices = sortedInvoices.map(({ supplierIdentityStatus: _identityStatus, documentSupplierRut: _supplierRut, supplierIdentitySource: _identitySource, ...invoice }) => invoice)
  const fingerprint = fingerprintFor({ version: INVOICE_RECONCILIATION_VERSION, totalOC, orderItems: fingerprintOrderItems, invoices: fingerprintInvoices })
  const sortedReviews = [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const currentReview = sortedReviews.find((review) => review.fingerprint === fingerprint) ?? null
  const previousReview = sortedReviews.find((review) => review.fingerprint !== fingerprint) ?? null
  const baseStatus: InvoiceReconciliationStatus = !hasInvoices ? "no_invoices" : issues.length === 0 ? "matched" : "needs_review"
  const hasBlockingReceiptIssue = issues.some((issue) => issue.code === "quantity_over_received")
  const overInvoicedLineCount = items.filter((item) => item.receiptStatus === "over_invoiced").length
  const receiptEvaluable = items.some((item) => item.receiptStatus !== "not_evaluable")

  return {
    version: INVOICE_RECONCILIATION_VERSION,
    status: baseStatus === "needs_review" && currentReview && !hasBlockingReceiptIssue ? "accepted_exception" : baseStatus,
    fingerprint,
    hasInvoices,
    totalInvoiced,
    totalOC,
    money: { status: !hasInvoices ? "no_invoices" : Math.abs(moneyDifference) <= CLP_RECONCILIATION_TOLERANCE ? "matched" : "mismatch", tolerance: CLP_RECONCILIATION_TOLERANCE, difference: moneyDifference },
    lines: { status: lineStatus, invoicesWithoutLines, linkedLineCount, unlinkedLineCount },
    receipt: {
      status: !hasInvoices ? "no_invoices" : !receiptEvaluable ? "not_evaluable" : overInvoicedLineCount > 0 ? "over_invoiced" : "covered",
      overInvoicedLineCount,
    },
    items,
    invoices: perInvoice,
    issues,
    currentReview,
    previousReview,
  }
}

export function formatInvoiceReconciliationIssues(evidence: InvoiceReconciliationEvidence) {
  const labels: Record<InvoiceReconciliationIssueCode, string> = {
    unlinked_line: "Hay una línea de factura sin vínculo con la OC.",
    missing_unit: "Falta la unidad documental para comparar una línea.",
    unit_mismatch: "La unidad de la factura no equivale a la unidad de la OC.",
    price_variance: "El precio efectivo de factura difiere del precio acordado en la OC.",
    pending_oc_cost: "Una línea de la OC todavía tiene el costo pendiente.",
    invoice_without_lines: "Hay una factura sin líneas documentales.",
    quantity_under: "La cantidad facturada es menor que la cantidad de la OC.",
    quantity_over: "La cantidad facturada excede la cantidad de la OC.",
    quantity_over_received: "La cantidad facturada excede lo aceptado del proveedor.",
    supplier_unverified: "No se pudo verificar el RUT del proveedor en una factura manual.",
    total_mismatch: "El total facturado difiere del total de la OC.",
  }
  return [...new Set(evidence.issues.map((issue) => labels[issue.code]))]
}
