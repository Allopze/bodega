/**
 * GET /api/reportes/export?tipo=<tipo>
 *
 * Exports a CSV file for the requested report type.
 * Requires reports:view permission.
 *
 * tipo values:
 *   - gasto_faena          → spending per worksite
 *   - items_sin_oc         → approved items not yet in a purchase order
 *   - oc_por_estado        → purchase orders grouped by status
 */

import { type NextRequest, NextResponse } from "next/server"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, purchaseOrders,
  products, worksites, suppliers,
} from "@/db/schema"
import { inArray } from "drizzle-orm"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { formatDate } from "@/lib/utils"

/* ── CSV helpers ──────────────────────────────────────────────────────────── */

function csvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      const s = v === null || v === undefined ? "" : String(v)
      // Escape double quotes and wrap in quotes if contains comma, quote, or newline
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    })
    .join(",")
}

function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [csvRow(headers), ...rows.map(csvRow)]
  return lines.join("\r\n")
}

/* ── Reports ──────────────────────────────────────────────────────────────── */

async function gastoPorFaena(session: Session | null) {
  const orders = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      totalAmount: purchaseOrders.totalAmount,
      status:      purchaseOrders.status,
      createdAt:   purchaseOrders.createdAt,
      supplierId:  purchaseOrders.supplierId,
    })
    .from(purchaseOrders)

  const wsIds  = [...new Set(orders.map((o) => o.worksiteId))]
  const supIds = [...new Set(orders.map((o) => o.supplierId))]

  const [wsRows, supRows] = await Promise.all([
    wsIds.length  ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))  : [],
    supIds.length ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supIds)) : [],
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supRows.map((s) => [s.id, s.name]))

  const visible = orders.filter((o) => !session || canAccessWorksite(session, o.worksiteId))

  const headers = ["OC", "Faena", "Proveedor", "Estado", "Monto Total", "Fecha"]
  const rows = visible.map((o) => [
    o.code,
    wsMap[o.worksiteId] ?? o.worksiteId,
    supMap[o.supplierId] ?? o.supplierId,
    o.status,
    o.totalAmount,
    formatDate(o.createdAt),
  ])

  return buildCsv(headers, rows)
}

async function itemsSinOc(session: Session | null) {
  // Items that are in approved/pending_purchase state (approved but not yet ordered)
  const ALERT_STATES = ["approved", "pending_purchase"]

  const items = await db
    .select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      status:          purchaseRequestItems.status,
      createdAt:       purchaseRequestItems.createdAt,
    })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.status, ALERT_STATES))

  if (items.length === 0) return buildCsv(["Producto", "SKU", "Faena", "Solicitud", "Cantidad", "U/M", "Estado", "Fecha creación"], [])

  const reqIds = [...new Set(items.map((i) => i.requestId))]
  const prodIds = [...new Set(items.map((i) => i.productId).filter(Boolean) as string[])]

  const [reqRows, prodRows] = await Promise.all([
    db.select({ id: purchaseRequests.id, code: purchaseRequests.code, worksiteId: purchaseRequests.worksiteId })
      .from(purchaseRequests).where(inArray(purchaseRequests.id, reqIds)),
    prodIds.length ? db.select({ id: products.id, name: products.name, sku: products.sku }).from(products).where(inArray(products.id, prodIds)) : [],
  ])

  const wsIds = [...new Set(reqRows.map((r) => r.worksiteId))]
  const wsRows = wsIds.length
    ? await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
    : []

  const reqMap  = Object.fromEntries(reqRows.map((r) => [r.id, r]))
  const prodMap = Object.fromEntries(prodRows.map((p) => [p.id, p]))
  const wsMap   = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  const visible = items.filter((i) => {
    const req = reqMap[i.requestId]
    return req && (!session || canAccessWorksite(session, req.worksiteId))
  })

  const headers = ["Producto", "SKU", "Faena", "Solicitud", "Cantidad", "U/M", "Estado", "Fecha creación"]
  const rows = visible.map((i) => {
    const req     = reqMap[i.requestId]
    const product = i.productId ? prodMap[i.productId] : null
    return [
      product?.name ?? i.productNameFree ?? "",
      product?.sku ?? "",
      req ? (wsMap[req.worksiteId] ?? req.worksiteId) : "",
      req?.code ?? "",
      i.quantity,
      i.unitOfMeasure,
      i.status,
      formatDate(i.createdAt),
    ]
  })

  return buildCsv(headers, rows)
}

async function ocPorEstado(session: Session | null) {
  const orders = await db
    .select({
      code:        purchaseOrders.code,
      status:      purchaseOrders.status,
      worksiteId:  purchaseOrders.worksiteId,
      totalAmount: purchaseOrders.totalAmount,
      issuedAt:    purchaseOrders.issuedAt,
      sentAt:      purchaseOrders.sentAt,
      confirmedAt: purchaseOrders.confirmedAt,
    })
    .from(purchaseOrders)

  const wsIds = [...new Set(orders.map((o) => o.worksiteId))]
  const wsRows = wsIds.length
    ? await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
    : []
  const wsMap = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  const visible = orders.filter((o) => !session || canAccessWorksite(session, o.worksiteId))

  const headers = ["OC", "Estado", "Faena", "Total", "Emitida", "Enviada", "Confirmada"]
  const rows = visible.map((o) => [
    o.code,
    o.status,
    wsMap[o.worksiteId] ?? o.worksiteId,
    o.totalAmount,
    o.issuedAt    ? formatDate(o.issuedAt)    : "",
    o.sentAt      ? formatDate(o.sentAt)      : "",
    o.confirmedAt ? formatDate(o.confirmedAt) : "",
  ])

  return buildCsv(headers, rows)
}

/* ── Route handler ────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "reports:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const tipo = req.nextUrl.searchParams.get("tipo") ?? "gasto_faena"

  let csv: string
  let filename: string

  try {
    switch (tipo) {
      case "items_sin_oc":
        csv      = await itemsSinOc(session)
        filename = "items-sin-oc.csv"
        break
      case "oc_por_estado":
        csv      = await ocPorEstado(session)
        filename = "oc-por-estado.csv"
        break
      case "gasto_faena":
      default:
        csv      = await gastoPorFaena(session)
        filename = "gasto-por-faena.csv"
    }
  } catch (err) {
    console.error("[reportes/export]", err)
    return NextResponse.json({ error: "Error al generar el reporte" }, { status: 500 })
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
