export const dynamic = "force-dynamic"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { repuestoQuotations, purchaseRequests } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { resolveQuotationAttachmentFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "repuestos:view_own") && !can(session, "repuestos:view_all")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { id } = await params

  const quotation = await db.query.repuestoQuotations.findFirst({
    where: eq(repuestoQuotations.id, id),
  })
  if (!quotation) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  // Verify access via the parent request's worksite
  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, quotation.requestId),
    columns: { worksiteId: true, requesterId: true },
  })
  const canViewAll = can(session, "repuestos:view_all")
  if (!request || !canAccessWorksite(session, request.worksiteId) || (!canViewAll && request.requesterId !== session.user.id)) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  const absolutePath = resolveQuotationAttachmentFile(quotation.filePath)
  if (!absolutePath) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  try {
    const file = await fs.readFile(absolutePath)
    const mimeType = quotation.filePath.endsWith(".pdf")
      ? "application/pdf"
      : "application/octet-stream"

    return new Response(file, {
      headers: {
        "Content-Type":        mimeType,
        "Content-Disposition": encodeContentDisposition(quotation.fileName, "inline"),
        "Cache-Control":       "private, max-age=60",
      },
    })
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }
}
