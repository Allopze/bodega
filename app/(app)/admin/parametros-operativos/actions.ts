"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import {
  getOperationalSettings,
  updateOperationalSettings,
  updatePdfEngineSettings,
  validatePdfEngineSettings,
  type OperationalSettings,
} from "@/lib/services/system-settings"
import { PDF_DOCUMENT_LIST } from "@/lib/pdf/engines"
import { setOfficeWorksite } from "@/lib/services/dispatch-guides"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/parametros-operativos"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

/**
 * Los selectores de motor viajan como `pdfEngine.<documento>`. Se leen aparte de
 * los numéricos porque su validación vive en el catálogo de `lib/pdf/engines.ts`.
 */
function readPdfEngines(form: FormData): Record<string, string> {
  const partial: Record<string, string> = {}
  for (const spec of PDF_DOCUMENT_LIST) {
    const raw = form.get(`pdfEngine.${spec.id}`)
    if (typeof raw !== "string") continue
    const trimmed = raw.trim()
    if (trimmed) partial[spec.id] = trimmed
  }
  return partial
}

function readNumber(form: FormData, key: string): string | undefined {
  const raw = form.get(key)
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  return trimmed.length ? trimmed : undefined
}

export async function getOperationalSettingsAction(): Promise<OperationalSettings> {
  return getOperationalSettings()
}

export async function saveOperationalSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:ops_settings")
  } catch {
    return errorState("Sin permisos")
  }

  try {
    const pdfEngines = readPdfEngines(formData)
    // Valida antes de cualquier escritura; las validaciones de FK y rangos que
    // dependen de la base quedan protegidas por la transacción de abajo.
    validatePdfEngineSettings(pdfEngines)

    await db.transaction(async (tx) => {
      // Los tres grupos comparten una transacción: cualquier validación fallida
      // deja intactos los parámetros anteriores y sus auditorías.
      const officeWorksiteId = formData.get("officeWorksiteId")
      if (typeof officeWorksiteId === "string") {
        await setOfficeWorksite(officeWorksiteId, {
          userId:    session.user.id,
          userEmail: session.user.email ?? undefined,
        }, tx)
      }

      await updateOperationalSettings({
        exportMaxRows:              readNumber(formData, "exportMaxRows"),
        notificationRetentionDays:  readNumber(formData, "notificationRetentionDays"),
        feedbackAttachmentMaxMb:    readNumber(formData, "feedbackAttachmentMaxMb"),
        pdtpEvidenceMaxMb:           readNumber(formData, "pdtpEvidenceMaxMb"),
        pdtpEvidenceRetentionDays:  readNumber(formData, "pdtpEvidenceRetentionDays"),
        purchasingClpTolerance:     readNumber(formData, "purchasingClpTolerance"),
      }, {
        userId:    session.user.id,
        userEmail: session.user.email ?? undefined,
      }, tx)

      await updatePdfEngineSettings(pdfEngines, {
        userId:    session.user.id,
        userEmail: session.user.email ?? undefined,
      }, tx)
    })

    revalidatePath(REVALIDATE)
    // La bodega de origen la leen Recepción y Guías, no sólo esta pantalla.
    revalidatePath("/recepcion")
    revalidatePath("/bodega/guias")
    // El motor de PDF no necesita revalidación: las rutas que lo consultan son
    // `force-dynamic` y leen el ajuste en cada petición.
    return { ok: true, message: "Parámetros operativos guardados" }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
