export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { extractInvoiceData } from "@/lib/services/purchasing-module/invoice-extractor"
import { logger } from "@/lib/logger"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"

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

    const maxMb = await getPdfMaxSizeMb()
    if (file.size > maxMb * 1024 * 1024) {
      return NextResponse.json({ error: `El archivo supera el límite de ${maxMb} MB` }, { status: 400 })
    }

    // La preextracción tiene los mismos límites y validación binaria que la
    // carga definitiva: no confiar en file.type del navegador.
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const validation = validateFileBuffer(new Uint8Array(buffer), file.size, MimeType.INVOICE)
    if (validation.error) return NextResponse.json({ error: validation.error }, { status: 400 })

    // Extract data
    const result = await extractInvoiceData(buffer, validation.mimeType, file.name)

    return NextResponse.json({
      ok: true,
      data: result.data,
      method: result.method,
      confidence: result.confidence,
      warnings: result.warnings ?? [],
    })
  } catch (err) {
    logger.error("[invoices/extract] Error extracting invoice data", err)
    return NextResponse.json(
      { error: "Error al procesar el archivo" },
      { status: 500 },
    )
  }
}
