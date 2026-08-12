import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { DteDocumentPdfError, getDteDocumentPdf } from "@/lib/services/dte-portal/purchase-document-pdf"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PDF de un DTE de proveedor. Los DTE no están asignados a una faena hasta que
 * se usan en una OC, así que el acceso sigue la política explícita vigente de
 * `purchasing:view`: hoy sus roles son globales. Si ese permiso se delega a
 * roles de faena, esta ruta deberá ganar una asociación/alcance antes del grant.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "purchasing:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { id } = await params
  try {
    const pdf = await getDteDocumentPdf(id)
    const body = new Uint8Array(pdf.buffer.length)
    body.set(pdf.buffer)
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": encodeContentDisposition(pdf.fileName, "inline"),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const code = error instanceof DteDocumentPdfError ? error.code : "UNAVAILABLE"
    logger.error("[purchase-order-dte-pdf] retrieval failed", { code })
    if (code === "NOT_FOUND" || code === "INVALID_DOCUMENT") {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
    }
    return NextResponse.json({ error: "No se pudo obtener el PDF de la factura" }, { status: 502 })
  }
}
