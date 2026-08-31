/**
 * GET /api/prevencion/inspecciones/evidence/[name]
 *
 * Sirve una foto de evidencia previamente subida a
 * `storage/inspection-evidence/`. El nombre llega por URL y se valida contra
 * `isSafeStorageName` (sin traversal) y contra la BD: el archivo debe estar
 * referenciado por una respuesta de una inspección dentro del alcance de faenas
 * del usuario. Sin esa segunda comprobación, adivinar el nombre bastaría para
 * descargar evidencia de otra faena (IDOR).
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
import {
  preventionInspectionAnswerEvidence,
  preventionInspectionAnswers,
  preventionInspectionFindingEvidence,
  preventionInspectionFindings,
  preventionInspectionRuns,
} from "@/db/schema"
import { logger } from "@/lib/logger"

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
    return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
  }

  try {
    // Comparación exacta por `path`, no `LIKE`: el nombre es un nanoid con
    // extensión y la ruta completa está almacenada tal cual.
    const [answerRow] = await db.select({ worksiteId: preventionInspectionRuns.worksiteId })
      .from(preventionInspectionAnswerEvidence)
      .innerJoin(preventionInspectionAnswers, eq(preventionInspectionAnswers.id, preventionInspectionAnswerEvidence.answerId))
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionAnswers.runId))
      .where(scope.mode === "all"
        ? eq(preventionInspectionAnswerEvidence.path, relativePath)
        : and(
            eq(preventionInspectionAnswerEvidence.path, relativePath),
            inArray(preventionInspectionRuns.worksiteId, scope.ids),
          ))
      .limit(1)

    const [findingRow] = answerRow ? [] : await db.select({ worksiteId: preventionInspectionRuns.worksiteId })
      .from(preventionInspectionFindingEvidence)
      .innerJoin(preventionInspectionFindings, eq(preventionInspectionFindings.id, preventionInspectionFindingEvidence.findingId))
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
      .where(scope.mode === "all"
        ? eq(preventionInspectionFindingEvidence.path, relativePath)
        : and(
            eq(preventionInspectionFindingEvidence.path, relativePath),
            inArray(preventionInspectionRuns.worksiteId, scope.ids),
          ))
      .limit(1)

    if (!answerRow && !findingRow) {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }

    const buffer = await fs.readFile(absolutePath)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": inferContentType(name),
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    logger.error("[inspecciones/evidence GET]", err)
    return NextResponse.json({ error: "Error al servir la evidencia" }, { status: 500 })
  }
}

function inferContentType(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  return "application/octet-stream"
}
