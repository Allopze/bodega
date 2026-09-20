export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { promises as fs } from "node:fs"
import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import {
  drillEvidenceContentDisposition,
  getDrillEvidenceForDownload,
} from "@/lib/services/prevention-emergency"
import { resolvePreventionDrillEvidenceFile } from "@/lib/storage/config"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:emergency:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  const { name } = await params
  const absolutePath = resolvePreventionDrillEvidenceFile(`storage/prevention-drill-evidence/${name}`)
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })

  try {
    const row = await getDrillEvidenceForDownload(name, {
      userId: session.user.id,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    if (!row) return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

    const buffer = await fs.readFile(absolutePath)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": row.evidence.mimeType,
        "Content-Disposition": encodeContentDisposition(
          row.evidence.fileName,
          drillEvidenceContentDisposition(row.evidence.mimeType),
        ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    logger.error("[prevencion/emergencias/simulacros/evidencia GET]", error)
    return NextResponse.json({ error: "No se pudo servir la evidencia." }, { status: 500 })
  }
}
