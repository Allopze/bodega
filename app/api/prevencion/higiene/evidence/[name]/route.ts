/**
 * GET /api/prevencion/higiene/evidence/[name]
 *
 * PRV-21 (auditoría de production readiness 2026-09-28): los informes de
 * laboratorio de higiene se subían (POST) pero no había cómo abrirlos, así que
 * la evidencia de la N°45 no la podía revisar nadie desde la plataforma.
 *
 * Mismo contrato que `/api/prevencion/campanas/evidence/[name]`: nombre sin
 * traversal, y el archivo tiene que estar registrado como evidencia activa de
 * una medición de una faena del alcance del usuario (igualdad exacta de ruta).
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { and, eq, inArray } from "drizzle-orm"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolveHygieneEvidenceFile } from "@/lib/storage/config"
import { db } from "@/db"
import { preventionExposureGroups, preventionExposureMeasurements, preventionHygieneMeasurementEvidence } from "@/db/schema"
import { logger } from "@/lib/logger"
import { UNTRUSTED_FILE_HEADERS } from "@/lib/security/file-response"
import { inferEvidenceContentType } from "@/lib/services/prevention-evidence-upload"

const HYGIENE_EVIDENCE_PREFIX = "storage/hygiene-evidence/"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:hygiene:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { name } = await params
  const storedPath = `${HYGIENE_EVIDENCE_PREFIX}${name}`
  const absolutePath = resolveHygieneEvidenceFile(storedPath)
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })

  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

  try {
    const [found] = await db.select({ id: preventionHygieneMeasurementEvidence.id })
      .from(preventionHygieneMeasurementEvidence)
      .innerJoin(preventionExposureMeasurements, eq(preventionExposureMeasurements.id, preventionHygieneMeasurementEvidence.measurementId))
      .innerJoin(preventionExposureGroups, eq(preventionExposureGroups.id, preventionExposureMeasurements.groupId))
      .where(and(
        eq(preventionHygieneMeasurementEvidence.storagePath, storedPath),
        eq(preventionHygieneMeasurementEvidence.state, "active"),
        scope.mode === "all" ? undefined : inArray(preventionExposureGroups.worksiteId, scope.ids),
      ))
      .limit(1)
    if (!found) return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

    const buffer = await fs.readFile(absolutePath)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": inferEvidenceContentType(name),
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "private, max-age=300",
        ...UNTRUSTED_FILE_HEADERS,
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    logger.error("[prevencion/higiene/evidence GET]", err)
    return NextResponse.json({ error: "Error al servir la evidencia" }, { status: 500 })
  }
}
