"use server"

import { promises as fs } from "node:fs"
import path from "node:path"
import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { createReport, updateReportStatus, type FeedbackAttachmentInput } from "@/lib/services/feedback"
import { feedbackCreateSchema, feedbackUpdateStatusSchema } from "@/lib/validation/feedback"
import type { ActionState } from "@/lib/validation/feedback"
import { notifyAfterCommit, getUserIdsWithPermission, notifyManyUser } from "@/lib/services/notifications"
import { resolveStorageDir } from "@/lib/storage/config"
import { nanoid } from "@/lib/id"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"

const REVALIDATE = "/soporte"
const FEEDBACK_PREFIX = "storage/feedback/"

function sanitizeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "adjunto"
}

// ── createReportAction ────────────────────────────────────────────────────────

export async function createReportAction(
  input: {
    tipo: string
    titulo: string
    descripcion: string
    pagina?: string
    priority?: string
    attachment?: File | null
  }
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardPermission("feedback:create")
  if (error) return error

  const parsed = feedbackCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok:          false,
      message:     "Revisa los campos del formulario",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  let proofAttachment: FeedbackAttachmentInput | null = null
  if (input.attachment instanceof File && input.attachment.size > 0) {
    const file = input.attachment
    const MAX_MB = 20
    if (file.size > MAX_MB * 1024 * 1024) {
      return { ok: false, message: `El archivo supera el límite de ${MAX_MB} MB` }
    }

    const fileBuf = new Uint8Array(await file.arrayBuffer())
    const validation = validateFileBuffer(fileBuf, file.size, MimeType.PROOF)
    if (validation.error) {
      return { ok: false, message: validation.error }
    }

    const safeName = sanitizeFileName(file.name || "adjunto")
    const storageName = `${Date.now()}-${nanoid()}-${safeName}`
    const feedbackDir = path.join(resolveStorageDir(), "feedback")
    const relativePath = `${FEEDBACK_PREFIX}${storageName}`
    const absolutePath = path.join(feedbackDir, storageName)

    await fs.mkdir(feedbackDir, { recursive: true })
    await fs.writeFile(absolutePath, Buffer.from(fileBuf))

    proofAttachment = {
      fileName: safeName,
      filePath: relativePath,
      fileSize: file.size,
      mimeType: validation.mimeType,
    }
  }

  try {
    const report = await createReport(parsed.data, session.user.id, proofAttachment)

    notifyAfterCommit(() =>
      getUserIdsWithPermission("feedback:manage").then((ids) =>
        notifyManyUser(ids, {
          type:       "feedback_submitted",
          title:      `Nuevo ${parsed.data.tipo}: ${parsed.data.titulo}`,
          body:       `${session.user.name ?? session.user.email} envió un reporte de soporte.`,
          entityType: "feedback_report",
          entityId:   report.id,
          entityHref: `/soporte/${report.id}`,
        }),
      ),
    )

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Reporte enviado", data: { id: report.id } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al enviar el reporte" }
  }
}

// ── updateReportStatusAction ──────────────────────────────────────────────────

export async function updateReportStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardPermission("feedback:manage")
  if (error) return error

  const raw = {
    id:          formData.get("id") as string,
    estado:      formData.get("estado") as string,
    notaInterna: formData.get("notaInterna") as string | undefined,
  }

  const parsed = feedbackUpdateStatusSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok:          false,
      message:     "Datos inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    await updateReportStatus(parsed.data.id, parsed.data, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.data.id}`)
    return { ok: true, message: "Estado actualizado" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al actualizar el estado" }
  }
}
