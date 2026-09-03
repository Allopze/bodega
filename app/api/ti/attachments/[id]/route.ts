export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { guardPermission } from "@/lib/auth/can"
import { db } from "@/db"
import { attachments } from "@/db/schema"
import { resolveTiFile, resolveDeliveryAttachmentFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"

const TI_ENTITY_TYPES = new Set(["it_asset", "it_assignment", "it_maintenance", "it_ticket", "it_retirement", "it_license"])

/**
 * GET /api/ti/attachments/[id] — sirve documentos adjuntos del módulo TI
 * (facturas, órdenes de compra, documentos de mantención). Verifica que el
 * adjunto pertenezca a una entidad TI (anti-IDOR) antes de leer el disco.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardPermission("ti:view")
  if (guard.error) return new NextResponse("No autorizado", { status: 403 })

  const { id } = await params
  const [attachment] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1)
  if (!attachment) return new NextResponse("No encontrado", { status: 404 })
  if (!TI_ENTITY_TYPES.has(attachment.entityType)) {
    return new NextResponse("No encontrado", { status: 404 })
  }

  // Los adjuntos TI se guardan en storage/ti/; algunos legacy pueden vivir en
  // el prefijo de entregas. Se resuelve con el helper que corresponda.
  const absolutePath = resolveTiFile(attachment.filePath) ?? resolveDeliveryAttachmentFile(attachment.filePath)
  if (!absolutePath) return new NextResponse("No encontrado", { status: 404 })

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
    return new NextResponse("No encontrado", { status: 404 })
  }
}
