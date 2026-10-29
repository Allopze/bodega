export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardAnyPermission } from "@/lib/auth/can"
import { fileDisposition, UNTRUSTED_FILE_HEADERS } from "@/lib/security/file-response"
import { encodeContentDisposition } from "@/lib/utils"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadPhotoFile } from "@/lib/services/mantencion/photos"

/**
 * GET /api/mantencion/fotos/[id] — sirve una foto de respaldo. Con SESIÓN (no es
 * pública): sólo si quien la pide puede ver el registro al que pertenece, y una
 * foto aún sin registro sólo para quien la subió. Nunca revela si el id existe:
 * «no existe» y «no puedes verla» contestan igual.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAnyPermission(["mant:records:view_own", "mant:records:view_worksite", "mant:records:view_all"])
  if (guard.error || !guard.session) return new NextResponse("No autorizado", { status: 403 })

  const { id } = await params
  const photo = await loadPhotoFile(id, viewerFromSession(guard.session))
  if (!photo) return new NextResponse("No encontrada", { status: 404 })

  return new Response(new Uint8Array(photo.buffer), {
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Disposition": encodeContentDisposition(photo.fileName, fileDisposition(photo.mimeType, false)),
      "Cache-Control": "private, max-age=300",
      ...UNTRUSTED_FILE_HEADERS,
    },
  })
}
