export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { MANT_PHOTO_MAX_BYTES } from "@/lib/mantencion/contracts"
import { UNTRUSTED_FILE_HEADERS } from "@/lib/security/file-response"
import { encodeContentDisposition } from "@/lib/utils"
import { loadSyncPhotoFile, savePhoto } from "@/lib/services/mantencion/photos"
import { authenticateSyncRequest, syncErrorResponse, syncFailureResponse } from "@/lib/services/mantencion/sync-auth"
import { invalidResponse, jsonResponse, payloadTooLargeResponse } from "@/lib/services/mantencion/sync-http"

/** El multipart suma el JSON de `meta` y los separadores a los 10 MB de la foto. */
const MULTIPART_OVERHEAD_BYTES = 256 * 1024

/** Lee el cuerpo completo cortando apenas supera `limit` bytes. */
async function readBodyWithLimit(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | "too_large"> {
  if (!request.body) return new Uint8Array(new ArrayBuffer(0))
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      // Se suelta el lector sin cancelar: cancelar cerraba el flujo mientras su productor
      // seguía escribiendo («ReadableStream is already closed», rechazo sin manejar).
      try { reader.releaseLock() } catch { /* ya liberado */ }
      return "too_large"
    }
    chunks.push(value)
  }
  const out = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

/**
 * PUT /api/mantencion/sync/fotos/{id} — sube una foto (multipart: `file` +
 * `meta` JSON). Idempotente por id: el mismo contenido del mismo autor vuelve a
 * contestar 200; otro contenido con el mismo id es un 409. Autenticación: sólo
 * `Authorization: Bearer`.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSyncRequest(request, { pathname: new URL(request.url).pathname })
  if (!auth.ok) return syncFailureResponse(auth.failure)

  // El tope se decide SIN leer todo a memoria: con `Content-Length` se corta antes de leer; sin
  // él (un túnel o proxy puede reenviar el cuerpo en modo chunked) se lee el flujo contando bytes
  // y se corta apenas pasa el tope. Exigir la cabecera (411) habría dejado «Por corregir» todas las
  // fotos si algún tramo la quita (revisión final 2026-11-11).
  const limit = MANT_PHOTO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES
  const lengthHeader = request.headers.get("content-length")
  const declared = lengthHeader !== null && /^\d+$/.test(lengthHeader.trim()) ? Number(lengthHeader) : null
  if (declared !== null && declared > limit) return payloadTooLargeResponse("La foto pesa más de 10 MB.")
  const body = await readBodyWithLimit(request, limit)
  if (body === "too_large") return payloadTooLargeResponse("La foto pesa más de 10 MB.")

  let form: FormData
  try {
    form = await new Request(request.url, {
      method: "PUT",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body,
    }).formData()
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
