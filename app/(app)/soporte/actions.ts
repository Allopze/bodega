"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { createReport, updateReportStatus } from "@/lib/services/feedback"
import { feedbackCreateSchema, feedbackUpdateStatusSchema } from "@/lib/validation/feedback"
import type { ActionState } from "@/lib/validation/feedback"
import { notifyAfterCommit, getUserIdsWithPermission, notifyManyUser } from "@/lib/services/notifications"

const REVALIDATE = "/soporte"

// ── createReportAction ────────────────────────────────────────────────────────

export async function createReportAction(
  input: {
    tipo: string
    titulo: string
    descripcion: string
    pagina?: string
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

  try {
    const report = await createReport(parsed.data, session.user.id)

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
