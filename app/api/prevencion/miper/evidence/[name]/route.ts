/**
 * GET /api/prevencion/miper/evidence/[name]
 *
 * Descarga la evidencia de una ocurrencia del Programa de Trabajo (RE-04.1,
 * §7.6). Mismo contrato que `/api/prevencion/higiene/evidence/[name]`: nombre
 * sin traversal y la subida tiene que estar registrada como evidencia de un
 * registro de una actividad de una faena del alcance de quien pide (igualdad
 * exacta de ruta); si no, 404 sin distinguir «no existe» de «no es tuya».
 *
 * Defensa del archivo, sin CSP propia (el proxy la reescribe, ver
 * `lib/security/file-response.ts`): sólo PDF e imágenes se abren en el
 * navegador; Word, Excel y lo demás van siempre como `attachment`, y toda
 * respuesta lleva `nosniff`. Retirada o anulada se sirve igual: nada se borra.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { logger } from "@/lib/logger"
import { MIPER_EVIDENCE_PATH_PREFIX } from "@/lib/prevention/miper/evidence-url"
import { fileDisposition, UNTRUSTED_FILE_HEADERS } from "@/lib/security/file-response"
import { findMiperEvidenceForDownload } from "@/lib/services/miper/evidence-access"
import { resolveMiperEvidenceFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:risk:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { name } = await params
  const storedPath = `${MIPER_EVIDENCE_PATH_PREFIX}${name}`
  const absolutePath = resolveMiperEvidenceFile(storedPath)
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })

  try {
    const found = await findMiperEvidenceForDownload(db, storedPath, resolveWorksiteScope(session))
    if (!found) return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })

    const mime = found.mimeType ?? "application/octet-stream"
    const disposition = fileDisposition(mime, new URL(request.url).searchParams.get("descargar") === "1")
    const buffer = await fs.readFile(absolutePath)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": encodeContentDisposition(name, disposition),
        "Cache-Control": "private, max-age=300",
        ...UNTRUSTED_FILE_HEADERS,
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    logger.error("[prevencion/miper/evidence GET]", err)
    return NextResponse.json({ error: "Error al servir la evidencia" }, { status: 500 })
  }
}
