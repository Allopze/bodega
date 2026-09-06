export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { readSstDocument } from "@/lib/storage/sst-backend"
import { db } from "@/db"
import { sstDocumentVersions, sstDocuments } from "@/db/schema"
import { eq } from "drizzle-orm"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { recordDocumentDownload, recordDocumentView } from "@/lib/services/prevention-documents-library"
import { canReadDocumentConfidentiality } from "@/lib/services/prevention-documents/utils"

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
  if (!canReadDocumentConfidentiality(doc.confidentiality, session.user.permissions)) {
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
  if (version.documentId !== doc.id || version.status !== "vigente") {
    return NextResponse.json({ error: "La publicación vigente es inconsistente" }, { status: 409 })
  }

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
    const file = await readSstDocument(version.filePath)
    return new Response(new Blob([new Uint8Array(file)], { type: version.mimeType ?? "application/octet-stream" }), {
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
