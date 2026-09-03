export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { resolveTiFile } from "@/lib/storage/config"
import { deletePendingPhoto, getPhotoById } from "@/lib/services/ti/assignment-photos"
import { removeFile } from "@/lib/storage/helpers"
import { encodeContentDisposition } from "@/lib/utils"

/**
 * GET /api/ti/photos/[id] — sirve la evidencia fotográfica autenticada.
 * Verifica que la foto exista en la BD (anti-IDOR) y que el usuario tenga
 * permiso sobre la faena de la asignación dueña.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardPermission("ti:view")
  if (guard.error) return new NextResponse("No autorizado", { status: 403 })

  const { id } = await params
  const photo = await getPhotoById(id)
  if (!photo) return new NextResponse("No encontrada", { status: 404 })

  // Una carga pendiente todavía no es evidencia ni debe ser descargable.
  if (!photo.assignmentId) return new NextResponse("No encontrada", { status: 404 })

  // La faena se valida para la asignación que contiene la evidencia.
  if (photo.worksiteId && !canAccessWorksite(guard.session, photo.worksiteId)) {
    return new NextResponse("No encontrada", { status: 404 })
  }

  const absolutePath = resolveTiFile(photo.filePath)
  if (!absolutePath) return new NextResponse("No encontrada", { status: 404 })

  try {
    const file = await fs.readFile(absolutePath)
    return new Response(file, {
      headers: {
        "Content-Type": photo.mimeType ?? "image/jpeg",
        "Content-Disposition": encodeContentDisposition(photo.fileName, "inline"),
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch {
    return new NextResponse("No encontrada", { status: 404 })
  }
}

/** Elimina solo una carga pendiente del mismo técnico; la evidencia confirmada
 * permanece append-only junto al acta. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardPermission("ti:manage_assets")
  if (guard.error) return new NextResponse("No autorizado", { status: 403 })

  const { id } = await params
  try {
    const filePath = await deletePendingPhoto(id, guard.session!.user.id)
    const absolutePath = resolveTiFile(filePath)
    if (absolutePath) await removeFile(absolutePath).catch(() => undefined)
    return new NextResponse(null, { status: 204 })
  } catch {
    return new NextResponse("No encontrada", { status: 404 })
  }
}
