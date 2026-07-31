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

    // Telemetría de la extracción sin contenido tributario: método, señales de
    // calidad y cuántas advertencias hubo, nunca folio, RUT ni montos. Antes las
    // advertencias sólo existían en la respuesta, así que una extracción pobre no
    // dejaba rastro para diagnosticar por proveedor o layout (auditoría de OCR
    // 2026-07-30, P1).
    logger.info("[invoices/extract] Extracción de factura", {
      method: result.method,
      mimeType: validation.mimeType,
      fileSizeKb: Math.round(file.size / 1024),
      coverage: Number(result.quality.coverage.toFixed(2)),
      engineConfidence: result.quality.engineConfidence,
      totalsConsistent: result.quality.totalsConsistent,
      warningCount: result.warnings?.length ?? 0,
      itemCount: result.data?.items.length ?? 0,
    })

    return NextResponse.json({
      ok: true,
      data: result.data,
      method: result.method,
      quality: result.quality,
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
