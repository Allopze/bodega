"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import {
  getOperationalSettings,
  updateOperationalSettings,
  type OperationalSettings,
} from "@/lib/services/system-settings"
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
    return { ok: true, message: "Parámetros operativos guardados" }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
