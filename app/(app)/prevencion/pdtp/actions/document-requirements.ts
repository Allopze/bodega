"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { setPdtpActivityDocumentRequirements } from "@/lib/services/prevention-pdtp"
import { pdtpActivityDocumentRequirementsSchema } from "@/lib/validation/prevention-module/pdtp"
import type { ActionState } from "@/lib/validation/prevention"

const ROOT = "/prevencion/pdtp"

/** Reemplaza la carpeta documental (N°19) de una actividad del programa en borrador. */
export async function setPdtpActivityDocumentRequirementsAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const parsed = parseZ(pdtpActivityDocumentRequirementsSchema, input)
  if (!parsed.ok) return parsed
  try {
    await setPdtpActivityDocumentRequirements({
      programId: parsed.data.programId,
      activityId: parsed.data.activityId,
      requirements: parsed.data.requirements.map((requirement) => ({
        documentTypeId: requirement.documentTypeId,
        scope: requirement.scope,
        mustFollowDocumentTypeId: requirement.mustFollowDocumentTypeId ?? null,
      })),
      userId: guard.session.user.id,
    })
    revalidatePath(ROOT)
    revalidatePath(`${ROOT}/${parsed.data.programId}`)
    revalidatePath(`${ROOT}/${parsed.data.programId}/editar`)
    return { ok: true, message: "Carpeta documental guardada." }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo guardar la carpeta documental.") }
  }
}
