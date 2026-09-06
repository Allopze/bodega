export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite, canAny } from "@/lib/auth/can"
import { readSstDocument } from "@/lib/storage/sst-backend"
import { db } from "@/db"
import { sstDocumentVersions, sstDocuments } from "@/db/schema"
import { eq } from "drizzle-orm"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { recordDocumentDownload } from "@/lib/services/prevention-documents-library"
import { canReadDocumentConfidentiality } from "@/lib/services/prevention-documents/utils"

interface RouteCtx {
  params: Promise<{ id: string; versionId: string }>
}

/**
 * GET /api/prevencion/documentacion/[id]/version/[versionId]
 *
 * Sirve una versión específica del documento (no necesariamente la vigente).
 * Útil para descargar la versión histórica durante una fiscalización o
 * para ver el archivo vigente sin la lógica de "versión actual" del endpoint
 * principal.
 */
export async function GET(_request: Request, ctx: RouteCtx) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:docs:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { id, versionId } = await ctx.params

  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, id))
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  if (doc.worksiteId && !canAccessWorksite(session, doc.worksiteId)) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  }
  if (!canReadDocumentConfidentiality(doc.confidentiality, session.user.permissions)) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  }

  const [version] = await db
    .select()
    .from(sstDocumentVersions)
    .where(eq(sstDocumentVersions.id, versionId))
    .limit(1)
  if (!version) return NextResponse.json({ error: "Versión no encontrada" }, { status: 404 })
  if (version.documentId !== doc.id) {
    return NextResponse.json({ error: "Versión no corresponde al documento" }, { status: 400 })
  }
  const isPublishedCurrent = version.id === doc.currentVersionId && version.status === "vigente"
  const canInspectWorkflow = canAny(
    session,
    "prevention:docs:manage",
    "prevention:docs:review",
    "prevention:docs:approve",
    "prevention:docs:publish",
  )
  if (!isPublishedCurrent && !canInspectWorkflow) {
    return NextResponse.json({ error: "Versión no encontrada" }, { status: 404 })
  }

  try {
    await recordDocumentDownload({
      documentId: id,
      versionId: version.id,
      userId: session.user.id,
      source: "api-version",
    })
  } catch (err) {
    logger.warn("[documentacion/version] no se pudo registrar download", err)
  }

  try {
    const file = await readSstDocument(version.filePath)
    return new Response(new Blob([new Uint8Array(file)], { type: version.mimeType ?? "application/octet-stream" }), {
      headers: {
        "Content-Type": version.mimeType ?? "application/octet-stream",
        "Content-Disposition": encodeContentDisposition(version.fileName, "attachment"),
        "Cache-Control": "private, max-age=0, no-cache",
      },
    })
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }
}
