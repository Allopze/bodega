"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import {
  getOperationalSettings,
  updateOperationalSettings,
  type OperationalSettings,
} from "@/lib/services/system-settings"
import { setOfficeWorksite } from "@/lib/services/dispatch-guides"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/parametros-operativos"

function errorState(message: string): ActionState {
  return { ok: false, message }
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
    // Va aparte de los numéricos: `updateOperationalSettings` sólo conoce
    // enteros con rango, y esta clave es una FK a `worksites` que se valida
    // contra la tabla. Primero, porque es la que puede rechazar el envío.
    const officeWorksiteId = formData.get("officeWorksiteId")
    if (typeof officeWorksiteId === "string") {
      await setOfficeWorksite(officeWorksiteId, {
        userId:    session.user.id,
        userEmail: session.user.email ?? undefined,
      })
    }

    await updateOperationalSettings({
      exportMaxRows:              readNumber(formData, "exportMaxRows"),
      notificationRetentionDays:  readNumber(formData, "notificationRetentionDays"),
      feedbackAttachmentMaxMb:    readNumber(formData, "feedbackAttachmentMaxMb"),
      pdtpEvidenceMaxMb:           readNumber(formData, "pdtpEvidenceMaxMb"),
      pdtpEvidenceRetentionDays:  readNumber(formData, "pdtpEvidenceRetentionDays"),
    }, {
      userId:    session.user.id,
      userEmail: session.user.email ?? undefined,
    })

    revalidatePath(REVALIDATE)
    // La bodega de origen la leen Recepción y Guías, no sólo esta pantalla.
    revalidatePath("/recepcion")
    revalidatePath("/bodega/guias")
    return { ok: true, message: "Parámetros operativos guardados" }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
