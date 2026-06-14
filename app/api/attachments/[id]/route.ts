import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { attachments, deliveries } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { canAccessWorksite } from "@/lib/auth/can"
import { resolveDeliveryAttachmentFile } from "@/lib/storage/config"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const { id } = await params
  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, id),
  })
  if (!attachment || attachment.entityType !== "delivery") {
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
        "Content-Disposition": `inline; filename="${sanitizeHeaderValue(attachment.fileName)}"`,
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
