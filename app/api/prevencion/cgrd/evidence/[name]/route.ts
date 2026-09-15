/**
 * GET /api/prevencion/cgrd/evidence/[name]
 *
 * Sirve un archivo de evidencia del CGRD subido a `storage/cgrd-evidence/`.
 * El nombre se valida contra `isSafeStorageName` (sin traversal) y contra la
 * base: el archivo debe estar referenciado por un comité, una designación de
 * coordinador, una matriz o un acta dentro del alcance de faenas del usuario,
 * para que no se pueda descargar adivinando el nombre (IDOR). Mismo contrato
 * que `/api/prevencion/pdtp/evidence/[name]`.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { and, eq, inArray, like, type SQL } from "drizzle-orm"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope, type WorksiteScope } from "@/lib/auth/scope"
import { resolveCgrdEvidenceFile } from "@/lib/storage/config"
import { db } from "@/db"
import {
  preventionGrdCommittees,
  preventionGrdCoordinators,
  preventionGrdMatrices,
  preventionGrdMeetings,
} from "@/db/schema"
import { logger } from "@/lib/logger"
import { inferEvidenceContentType } from "@/lib/services/prevention-evidence-upload"

const CGRD_EVIDENCE_PREFIX = "storage/cgrd-evidence/"

/** Acota por faena salvo que el alcance sea total. */
function scoped(match: SQL, column: Parameters<typeof inArray>[0], scope: WorksiteScope): SQL {
  if (scope.mode === "all") return match
  return and(match, inArray(column, scope.ids))!
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:cgrd:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { name } = await params
  const absolutePath = resolveCgrdEvidenceFile(`${CGRD_EVIDENCE_PREFIX}${name}`)
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })

  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

  try {
    const likePattern = `%${name.replace(/[%_]/g, (m) => `\\${m}`)}%`

    /* Los cuatro dominios que guardan evidencia del CGRD. Se consultan en
     * paralelo y basta con que uno la reclame: el archivo pertenece al módulo,
     * no a una tabla en particular. */
    const [committees, coordinators, matrices, meetings] = await Promise.all([
      db.select({ id: preventionGrdCommittees.id }).from(preventionGrdCommittees)
        .where(scoped(like(preventionGrdCommittees.evidenceUrl, likePattern), preventionGrdCommittees.worksiteId, scope)).limit(1),
      db.select({ id: preventionGrdCoordinators.id }).from(preventionGrdCoordinators)
        .where(scoped(like(preventionGrdCoordinators.evidenceUrl, likePattern), preventionGrdCoordinators.worksiteId, scope)).limit(1),
      db.select({ id: preventionGrdMatrices.id }).from(preventionGrdMatrices)
        .where(scoped(like(preventionGrdMatrices.evidenceUrl, likePattern), preventionGrdMatrices.worksiteId, scope)).limit(1),
      // El acta cuelga del comité, así que la faena se alcanza por el join.
      db.select({ id: preventionGrdMeetings.id }).from(preventionGrdMeetings)
        .innerJoin(preventionGrdCommittees, eq(preventionGrdMeetings.committeeId, preventionGrdCommittees.id))
        .where(scoped(like(preventionGrdMeetings.evidenceUrl, likePattern), preventionGrdCommittees.worksiteId, scope)).limit(1),
    ])

    const found = committees[0] ?? coordinators[0] ?? matrices[0] ?? meetings[0]
    if (!found) return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

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
    logger.error("[prevencion/cgrd/evidence GET]", err)
    return NextResponse.json({ error: "Error al servir la evidencia" }, { status: 500 })
  }
}
