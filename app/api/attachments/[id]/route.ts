export const dynamic = "force-dynamic"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { attachments, deliveries } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { resolveDeliveryAttachmentFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"

/**
 * S-08: this endpoint serves ONLY delivery proof attachments. Every other
 * attachment entityType (`purchase_order_invoice`, `repuesto_quotation`,
 * `servicio_quotation`) is served by its own route with its own worksite/
 * permission scoping. Anything that is not a delivery is denied by default.
 * If a new servable entityType is ever added here, give it an explicit
 * branch with its own access check — never widen this guard blindly.
 */
const SERVED_ENTITY_TYPE = "delivery" as const


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "deliveries:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { id } = await params
  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, id),
  })
  if (!attachment || attachment.entityType !== SERVED_ENTITY_TYPE) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  const delivery = await db.query.deliveries.findFirst({
    where: eq(deliveries.id, attachment.entityId),
  })
  if (!delivery?.worksiteId || !canAccessWorksite(session, delivery.worksiteId)) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  const absolutePath = resolveDeliveryAttachmentFile(attachment.filePath)
  if (!absolutePath) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  try {
    const file = await fs.readFile(absolutePath)
    return new Response(file, {
      headers: {
        "Content-Type": attachment.mimeType ?? "application/octet-stream",
        "Content-Disposition": encodeContentDisposition(attachment.fileName, "inline"),
        "Cache-Control": "private, max-age=60",
      },
    })
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }
}

