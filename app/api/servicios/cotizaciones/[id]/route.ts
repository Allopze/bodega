export const dynamic = "force-dynamic"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { serviceQuotations, purchaseRequests } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { resolveServiceQuotationFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"
import { resolveQuotationContentType } from "@/lib/storage/quotation-content-type"


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "servicios:view_own") && !can(session, "servicios:view_all")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { id } = await params

  const quotation = await db.query.serviceQuotations.findFirst({
    where: eq(serviceQuotations.id, id),
  })
  if (!quotation) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  // Verify access via the parent request's worksite
  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, quotation.requestId),
    columns: { worksiteId: true, requesterId: true },
  })
  const canViewAll = can(session, "servicios:view_all")
  if (!request || !canAccessWorksite(session, request.worksiteId) || (!canViewAll && request.requesterId !== session.user.id)) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  const absolutePath = resolveServiceQuotationFile(quotation.filePath)
  if (!absolutePath) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  try {
    const file = await fs.readFile(absolutePath)
    // COT-004: el tipo servido es el MIME que la validación por bytes mágicos
    // declaró al cargar. Antes se decidía por la extensión de la ruta interna
    // —derivada del nombre que mandó el cliente—, así que un JPG o un PNG
    // legítimos salían como `application/octet-stream` y el visor no los abría.
    const served = resolveQuotationContentType(quotation.mimeType, quotation.filePath)

    return new Response(file, {
      headers: {
        "Content-Type":        served.contentType,
        "Content-Disposition": encodeContentDisposition(quotation.fileName, served.disposition),
        "Cache-Control":       "private, max-age=60",
        // El tipo declarado manda: sin esto el navegador podría olfatear el
        // contenido de un archivo de usuario y ejecutarlo en nuestro origen.
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }
}
