export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { MANT_PHOTO_MAX_BYTES } from "@/lib/mantencion/contracts"
import { UNTRUSTED_FILE_HEADERS } from "@/lib/security/file-response"
import { encodeContentDisposition } from "@/lib/utils"
import { loadSyncPhotoFile, savePhoto } from "@/lib/services/mantencion/photos"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { invalidResponse, jsonResponse } from "@/lib/services/mantencion/sync-http"

/** El multipart suma el JSON de `meta` y los separadores a los 10 MB de la foto. */
const MULTIPART_OVERHEAD_BYTES = 256 * 1024

/**
 * PUT /api/mantencion/sync/fotos/{id} — sube una foto (multipart: `file` +
 * `meta` JSON). Idempotente por id: el mismo contenido del mismo autor vuelve a
 * contestar 200; otro contenido con el mismo id es un 409. Autenticación: sólo
 * `Authorization: Bearer`.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSyncRequest(request, { pathname: new URL(request.url).pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  const declared = Number(request.headers.get("content-length") ?? "0")
  if (declared > MANT_PHOTO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) return invalidResponse("La foto pesa más de 10 MB.")

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return invalidResponse("El envío debe ser multipart/form-data con los campos «file» y «meta».")
  }
  const file = form.get("file")
  const meta = form.get("meta")

  try {
    const { id } = await params
    const outcome = await savePhoto(
      { photoId: id, file: file instanceof File ? file : null, metaRaw: typeof meta === "string" ? meta : null },
      auth.context,
    )
    return jsonResponse(outcome.body, outcome.status)
  } catch (error) {
    return syncErrorResponse("fotos", error)
  }
}

/**
 * GET /api/mantencion/sync/fotos/{id}[?v=thumb] — foto de un registro del
 * historial de la flota, para la app. Sólo `Authorization: Bearer`. Se entrega
 * únicamente si la foto pertenece a un registro vigente (de cualquier faena);
 * huérfana, anulada o inexistente contestan el mismo 404. `?v=thumb` trae una
 * miniatura JPEG de 480 px de ancho. Siempre `attachment` + `nosniff`: la app
 * la pinta desde un blob, el navegador nunca la abre como página.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = new URL(request.url)
  const auth = await authenticateSyncRequest(request, { pathname: url.pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  const variant = url.searchParams.get("v")
  if (variant !== null && variant !== "thumb" && variant !== "full") return invalidResponse("La variante pedida no existe (usa «thumb» o «full»).", "v")

  try {
    const { id } = await params
    const photo = await loadSyncPhotoFile(id, variant === "thumb" ? "thumb" : "full")
    if (!photo) return Response.json({ ok: false, code: "not_found", message: "La foto no existe." }, { status: 404, headers: { "Cache-Control": "no-store" } })
    return new Response(new Uint8Array(photo.buffer), {
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Disposition": encodeContentDisposition(photo.fileName, "attachment"),
        // El id nunca cambia de contenido (el PUT con otro contenido es un 409): se puede guardar un día.
        "Cache-Control": "private, max-age=86400",
        ...UNTRUSTED_FILE_HEADERS,
      },
    })
  } catch (error) {
    return syncErrorResponse("fotos", error)
  }
}
