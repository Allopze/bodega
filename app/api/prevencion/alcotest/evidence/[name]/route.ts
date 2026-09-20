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
  alcotestEvidenceContentDisposition,
  getAlcotestSlotEvidenceForDownload,
} from "@/lib/services/prevention-alcotest-slots"
import { resolvePreventionAlcotestEvidenceFile } from "@/lib/storage/config"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:alcotest:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  const { name } = await params
  const absolutePath = resolvePreventionAlcotestEvidenceFile(`storage/prevention-alcotest-evidence/${name}`)
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })

  try {
    const scope = resolveWorksiteScope(session)
    const row = await getAlcotestSlotEvidenceForDownload(
      name,
      scope.mode === "all" ? "all" : (scope.ids ?? []),
    )
    if (!row) return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

    const buffer = await fs.readFile(absolutePath)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": row.evidence.mimeType,
        "Content-Disposition": encodeContentDisposition(
          row.evidence.fileName,
          alcotestEvidenceContentDisposition(row.evidence.mimeType),
        ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    logger.error("[prevencion/alcotest/evidence GET]", error)
    return NextResponse.json({ error: "No se pudo servir la evidencia." }, { status: 500 })
  }
}
