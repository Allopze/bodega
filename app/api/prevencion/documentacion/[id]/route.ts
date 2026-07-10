export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { resolveSstDocumentFile } from "@/lib/storage/config"
import { db } from "@/db"
import { sstDocumentVersions, sstDocuments } from "@/db/schema"
import { eq } from "drizzle-orm"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { recordDocumentDownload, recordDocumentView } from "@/lib/services/prevention-documents-library"
import { promises as fs } from "node:fs"

interface RouteCtx {
  params: Promise<{ id: string }>
}

/**
 * GET /api/prevencion/documentacion/[id]
 *
 * Sirve el archivo de la versión VIGENTE del documento. Solo para
 * prevencionistas con permiso `prevention:docs:view` y, si el documento
 * pertenece a una faena, con acceso a esa faena.
 *
 * El response incluye la cabecera `Cache-Control: private, max-age=30`
 * para permitir revalidación rápida en el cliente sin exponer el archivo
 * a caches públicos.
 */
export async function GET(request: Request, ctx: RouteCtx) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:docs:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { id } = await ctx.params
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  if (doc.status === "archivado") {
    return NextResponse.json({ error: "Documento archivado" }, { status: 410 })
  }
  if (doc.worksiteId && !canAccessWorksite(session, doc.worksiteId)) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  }

  if (!doc.currentVersionId) {
    return NextResponse.json({ error: "El documento no tiene versión vigente" }, { status: 404 })
  }
  const [version] = await db
    .select()
    .from(sstDocumentVersions)
    .where(eq(sstDocumentVersions.id, doc.currentVersionId))
    .limit(1)
  if (!version) return NextResponse.json({ error: "Versión no encontrada" }, { status: 404 })

  const absolutePath = resolveSstDocumentFile(version.filePath)
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const shouldDownload = searchParams.get("download") === "1"

  // Registrar la visualización o descarga.
  try {
    const auditArgs = {
      documentId: id,
      versionId: version.id,
      userId: session.user.id,
      source: "api",
    }
    if (shouldDownload) await recordDocumentDownload(auditArgs)
    else await recordDocumentView(auditArgs)
  } catch (err) {
    logger.warn("[documentacion/serve] no se pudo registrar auditoría documental", err)
  }

  try {
    const file = await fs.readFile(absolutePath)
    return new Response(file, {
      headers: {
        "Content-Type": version.mimeType ?? "application/octet-stream",
        "Content-Disposition": encodeContentDisposition(version.fileName, shouldDownload ? "attachment" : "inline"),
        "Cache-Control": "private, max-age=30",
      },
    })
  } catch (err) {
    logger.error(`[documentacion/serve] Error al leer archivo: ${version.filePath}`, err)
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }
}
