"use server"

import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { codeSequences } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { setCodeSequenceNextValue } from "@/lib/code-sequences"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/folios"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

export async function correctCodeSequenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:folios")
  } catch {
    return errorState("Sin permisos")
  }

  const prefix = (formData.get("prefix") as string | null)?.trim() ?? ""
  const yearRaw = (formData.get("year") as string | null)?.trim() ?? ""
  const confirmation = (formData.get("confirmation") as string | null)?.trim() ?? ""
  const expectedConfirmation = `${prefix}-${yearRaw}`
  const nextValueRaw = (formData.get("nextValue") as string | null)?.trim() ?? ""

  if (!prefix) return errorState("Prefijo requerido")
  if (!/^\d{4}$/.test(yearRaw)) return errorState("El año debe tener 4 dígitos")
  const year = Number(yearRaw)
  const nextValue = Number(nextValueRaw)

  if (!Number.isInteger(nextValue) || nextValue < 1) {
    return errorState("El siguiente folio debe ser un entero mayor o igual a 1")
  }
  if (confirmation !== expectedConfirmation) {
    return errorState(`Para confirmar, escribe exactamente: ${expectedConfirmation}`)
  }

  // Capture original value for audit.
  const beforeRows = await db
    .select()
    .from(codeSequences)
    .where(and(eq(codeSequences.prefix, prefix), eq(codeSequences.year, year)))
    .limit(1)
  const before = beforeRows[0]

  try {
    const diff = await setCodeSequenceNextValue({ prefix, year, nextValue })

    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "update",
      entityType: "code_sequence",
      entityId:   `${prefix}-${year}`,
      oldState:   { nextValue: before?.nextValue ?? null },
      newState:   { nextValue: diff.after },
      reason:     "Admin correction of desynchronized folio",
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: `Secuencia ${prefix}-${year} corregida al folio ${nextValue}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
