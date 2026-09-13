export const dynamic = "force-dynamic"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { attachments, feedbackReports } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { resolveFeedbackDir, resolveStorageFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"
import { canAccessFeedbackIndex, canAccessFeedbackReport } from "@/lib/services/feedback-access"

import { logger } from "@/lib/logger"

const FEEDBACK_PREFIX = "storage/feedback/"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!canAccessFeedbackIndex(session)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { id } = await params
  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, id),
  })
  if (!attachment || attachment.entityType !== "feedback_report") {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  const report = await db.query.feedbackReports.findFirst({
    where: eq(feedbackReports.id, attachment.entityId),
  })
  if (!report) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  if (!canAccessFeedbackReport(session, report)) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }

  if (!attachment.filePath.startsWith(FEEDBACK_PREFIX)) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  const storageName = attachment.filePath.slice(FEEDBACK_PREFIX.length)
  if (!storageName || storageName.includes("..") || storageName.includes("/")) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  const absolutePath = resolveStorageFile(resolveFeedbackDir(), storageName)

  try {
    const file = await fs.readFile(absolutePath)
    return new Response(file, {
      headers: {
        "Content-Type": attachment.mimeType ?? "application/octet-stream",
        "Content-Disposition": encodeContentDisposition(attachment.fileName, "inline"),
        "Cache-Control": "private, max-age=60",
      },
    })
  } catch (err) {
    logger.error(`[soporte/serve] Error al leer archivo adjunto: ${storageName}`, err)
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }
}
