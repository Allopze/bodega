/**
 * GET /api/prevencion/inspecciones/documento/[name]
 *
 * Sirve la foto de una planilla previamente subida a
 * `storage/inspection-evidence/`. Misma defensa que el equivalente de
 * evidencia por respuesta: el nombre se valida contra `isSafeStorageName` (sin
 * traversal) **y** contra la BD —el archivo debe estar referenciado por una
 * inspección dentro del alcance de faenas del usuario—. Sin esa segunda
 * comprobación, adivinar el nombre bastaría para descargar la planilla de otra
 * faena (IDOR).
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { and, eq, inArray } from "drizzle-orm"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolveInspectionEvidenceFile } from "@/lib/storage/config"
import { db } from "@/db"
import { preventionInspectionRunDocuments, preventionInspectionRuns } from "@/db/schema"
import { logger } from "@/lib/logger"
import { encodeContentDisposition } from "@/lib/utils"

const INSPECTION_EVIDENCE_PREFIX = "storage/inspection-evidence/"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:inspections:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { name } = await params
  const relativePath = `${INSPECTION_EVIDENCE_PREFIX}${name}`
  const absolutePath = resolveInspectionEvidenceFile(relativePath)
  if (!absolutePath) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") {
    return NextResponse.json({ error: "Planilla no encontrada" }, { status: 404 })
  }

  try {
    const [row] = await db.select({
      worksiteId: preventionInspectionRuns.worksiteId,
      fileName: preventionInspectionRunDocuments.fileName,
      mimeType: preventionInspectionRunDocuments.mimeType,
    })
      .from(preventionInspectionRunDocuments)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionRunDocuments.runId))
      .where(scope.mode === "all"
        ? eq(preventionInspectionRunDocuments.path, relativePath)
        : and(
            eq(preventionInspectionRunDocuments.path, relativePath),
            inArray(preventionInspectionRuns.worksiteId, scope.ids),
          ))
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: "Planilla no encontrada" }, { status: 404 })
    }

    const buffer = await fs.readFile(absolutePath)
    const mimeType = row.mimeType ?? inferContentType(row.fileName ?? name)
    const inline = mimeType === "application/pdf" || mimeType.startsWith("image/")
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": encodeContentDisposition(row.fileName ?? name, inline ? "inline" : "attachment"),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Planilla no encontrada" }, { status: 404 })
    }
    logger.error("[inspecciones/documento GET]", err)
    return NextResponse.json({ error: "Error al servir la planilla" }, { status: 500 })
  }
}

function inferContentType(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  return "application/octet-stream"
}
