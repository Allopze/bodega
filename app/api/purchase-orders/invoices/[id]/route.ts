import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderInvoices, purchaseOrders } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { resolveInvoiceAttachmentFile } from "@/lib/storage/config"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "purchasing:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { id } = await params
  const invoice = await db.query.purchaseOrderInvoices.findFirst({
    where: eq(purchaseOrderInvoices.id, id),
  })
  if (!invoice) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, invoice.purchaseOrderId),
    columns: { worksiteId: true },
  })
  if (!order?.worksiteId || !canAccessWorksite(session, order.worksiteId)) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  const absolutePath = resolveInvoiceAttachmentFile(invoice.filePath)
  if (!absolutePath) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  try {
    const file = await fs.readFile(absolutePath)
    return new Response(file, {
      headers: {
        "Content-Type": invoice.mimeType ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${sanitizeHeaderValue(invoice.fileName)}"`,
        "Cache-Control": "private, max-age=60",
      },
    })
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/["\r\n]/g, "_")
}
