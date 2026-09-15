/**
 * GET /api/prevencion/campanas/evidence/[name]
 *
 * Sirve un archivo de evidencia de campaña previamente subido a
 * `storage/campaign-evidence/`. El nombre llega por URL y se valida contra
 * `isSafeStorageName` (sin traversal) y contra la base: el archivo debe estar
 * referenciado por una campaña dentro del alcance de faenas del usuario, para
 * que no se pueda descargar adivinando el nombre (IDOR). Mismo contrato que
 * `/api/prevencion/pdtp/evidence/[name]`.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { and, inArray, like } from "drizzle-orm"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolveCampaignEvidenceFile } from "@/lib/storage/config"
import { db } from "@/db"
import { preventionCampaigns } from "@/db/schema"
import { logger } from "@/lib/logger"
import { inferEvidenceContentType } from "@/lib/services/prevention-evidence-upload"

const CAMPAIGN_EVIDENCE_PREFIX = "storage/campaign-evidence/"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:campaign:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { name } = await params
  const absolutePath = resolveCampaignEvidenceFile(`${CAMPAIGN_EVIDENCE_PREFIX}${name}`)
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })

  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

  try {
    const likePattern = `%${name.replace(/[%_]/g, (m) => `\\${m}`)}%`
    const nameMatch = like(preventionCampaigns.evidenceUrl, likePattern)
    const rows = await db.select({ id: preventionCampaigns.id })
      .from(preventionCampaigns)
      .where(scope.mode === "all" ? nameMatch : and(nameMatch, inArray(preventionCampaigns.worksiteId, scope.ids)))
      .limit(1)
    if (!rows[0]) return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

    const buffer = await fs.readFile(absolutePath)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": inferEvidenceContentType(name),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    logger.error("[prevencion/campanas/evidence GET]", err)
    return NextResponse.json({ error: "Error al servir la evidencia" }, { status: 500 })
  }
}
