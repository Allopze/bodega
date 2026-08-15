export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import path from "node:path"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { resolveRiskMapDir, createRiskMapPath } from "@/lib/storage/config"
import { logger } from "@/lib/logger"
import { uploadRiskMapLayout } from "@/lib/services/prevention-risk-map"

const MAX_FILE_SIZE = 10 * 1024 * 1024

/**
 * POST /api/prevencion/miper/mapa
 *
 * Sube el plano de planta (imagen) sobre el que se ubican los marcadores del
 * mapa de riesgos. Acepta multipart/form-data con `file` (JPEG/PNG) y
 * `worksiteId` y `title`. La ruta escribe el archivo y registra su layout en
 * una sola operación compensable: si la base rechaza el registro, elimina el
 * archivo para no dejar residuos sin referencia.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  const session = guard.session
  const scope = resolveWorksiteScope(session)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo (file)." }, { status: 400 })
  }

  const worksiteId = String(form.get("worksiteId") ?? "")
  if (!worksiteId) {
    return NextResponse.json({ error: "Falta la faena (worksiteId)." }, { status: 400 })
  }
  if (scope.mode === "none" || (scope.mode === "some" && !scope.ids.includes(worksiteId))) {
    return NextResponse.json({ error: "Sin acceso a la faena." }, { status: 403 })
  }

  const title = String(form.get("title") ?? "").trim()
  if (title.length < 3 || title.length > 200) {
    return NextResponse.json({ error: "El título debe tener entre 3 y 200 caracteres." }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `El archivo supera el máximo permitido de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    }, { status: 400 })
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const validated = validateFileBuffer(buffer, file.size, MimeType.IMAGE)
  if (validated.error) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  let absolutePath: string | null = null
  let registered = false
  try {
    const extension = validated.mimeType === "image/png" ? ".png" : ".jpg"
    const storageName = generateStorageName(`risk-map${extension}`)
    const dir = resolveRiskMapDir()
    await mkdirp(dir)
    absolutePath = path.join(/*turbopackIgnore: true*/ dir, storageName)
    await writeBuffer(absolutePath, Buffer.from(buffer))
    const relativePath = createRiskMapPath(storageName)
    const layout = await uploadRiskMapLayout({
      worksiteId,
      title,
      imagePath: relativePath,
      imageMimeType: validated.mimeType,
    }, {
      userId: session.user.id,
      scope,
      permissions: session.user.permissions,
    })
    registered = true
    revalidatePath("/prevencion/miper")
    return NextResponse.json({
      ok: true,
      layoutId: layout.id,
      path: relativePath,
      mimeType: validated.mimeType,
    }, { status: 201 })
  } catch (err) {
    if (absolutePath && !registered) {
      await removeFile(absolutePath).catch((cleanupError) => {
        logger.error("[miper/mapa] no se pudo compensar el archivo", cleanupError)
      })
    }
    logger.error("[miper/mapa]", err)
    return NextResponse.json({ error: "No se pudo cargar el plano de riesgos." }, { status: 400 })
  }
}
