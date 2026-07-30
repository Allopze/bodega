export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { extractInvoiceData } from "@/lib/services/purchasing-module/invoice-extractor"
import { logger } from "@/lib/logger"

/**
 * POST /api/purchase-orders/invoices/extract
 *
 * Receives a file (XML, PDF, or image) and returns extracted invoice data.
 * Used by the invoice form to auto-fill fields from uploaded files.
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "purchasing:send_order")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = [
      "application/xml",
      "text/xml",
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no soportado. Use XML, PDF, JPG o PNG." },
        { status: 400 },
      )
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Extract data
    const result = await extractInvoiceData(buffer, file.type, file.name)

    return NextResponse.json({
      ok: true,
      data: result.data,
      method: result.method,
      confidence: result.confidence,
    })
  } catch (err) {
    logger.error("[invoices/extract] Error extracting invoice data", err)
    return NextResponse.json(
      { error: "Error al procesar el archivo" },
      { status: 500 },
    )
  }
}
