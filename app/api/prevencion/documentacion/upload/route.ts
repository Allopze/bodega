export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  uploadDocumentVersion,
} from "@/lib/services/prevention-documents-library"
import { sstDocumentVersionCreateSchema } from "@/lib/validation/prevention"
import { logger } from "@/lib/logger"

/**
 * POST /api/prevencion/documentacion/upload
 *
 * Sube una nueva versión a un documento existente. Acepta multipart/form-data
 * con los campos:
 *   - file: el archivo (obligatorio)
 *   - documentId: id del documento (obligatorio)
 *   - effectiveFrom: fecha ISO 'YYYY-MM-DD' (opcional)
 *   - effectiveTo:   fecha ISO 'YYYY-MM-DD' (opcional)
 *   - changelog:      motivo del cambio (opcional)
 *
 * Validación: la Zod schema valida campos, y el servicio valida magic bytes
 * y tamaño. Devuelve 201 con { id, version } o 4xx con detalle.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("prevention:docs:manage")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })

  const session = guard.session
  const scope = resolveWorksiteScope(session)

  let form: FormData
  try {
    form = await request.formData()
  } catch (err) {
    return NextResponse.json({ error: "Body inválido: se esperaba multipart/form-data." }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo (file)." }, { status: 400 })
  }

  const raw = {
    documentId:    String(form.get("documentId") ?? ""),
    effectiveFrom: form.get("effectiveFrom") ? String(form.get("effectiveFrom")) : undefined,
    effectiveTo:   form.get("effectiveTo") ? String(form.get("effectiveTo")) : undefined,
    changelog:     form.get("changelog") ? String(form.get("changelog")) : undefined,
  }
  const parsed = sstDocumentVersionCreateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({
      error: "Datos inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }, { status: 400 })
  }

  try {
    const version = await uploadDocumentVersion({
      input: {
        documentId: parsed.data.documentId,
        file,
        effectiveFrom: parsed.data.effectiveFrom || undefined,
        effectiveTo: parsed.data.effectiveTo || undefined,
        changelog: parsed.data.changelog || undefined,
        supersedesId: parsed.data.supersedesId || undefined,
      },
      ctx: { userId: session.user.id, userEmail: session.user.email ?? undefined },
      scope,
      permissions: session.user.permissions,
    })
    return NextResponse.json({ id: version.id, version: version.version }, { status: 201 })
  } catch (err) {
    logger.error("[documentacion/upload]", err)
    const message = err instanceof Error ? err.message : "Error al subir el archivo."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
