"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { db } from "@/db"
import { users } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { recordAudit } from "@/lib/audit"
import type { ActionState } from "@/lib/validation/masters"

export async function updateEmailNotifications(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, message: "No autenticado" }

  const enabled = formData.get("emailNotifications") === "true"

  await db
    .update(users)
    .set({ emailNotifications: enabled, updatedAt: new Date().toISOString() })
    .where(eq(users.id, session.user.id))

  revalidatePath("/perfil")
  return { ok: true, message: enabled ? "Notificaciones por correo activadas." : "Notificaciones por correo desactivadas." }
}

// ── Change password ─────────────────────────────────────────────────────────

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingresa tu contraseña actual"),
    newPassword:     z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
    confirmPassword: z.string().min(1, "Confirma la nueva contraseña"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "La nueva contraseña debe ser diferente a la actual",
    path: ["newPassword"],
  })

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, message: "No autenticado" }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword:     formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { hashedPassword: true },
  })

  if (!user) return { ok: false, message: "Usuario no encontrado" }

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.hashedPassword)
  if (!valid) {
    return { ok: false, message: "La contraseña actual es incorrecta" }
  }

  const hashedPassword = await bcrypt.hash(parsed.data.newPassword, 12)
  await db
    .update(users)
    .set({ hashedPassword, updatedAt: new Date().toISOString() })
    .where(eq(users.id, session.user.id))

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "update",
    entityType: "user",
    entityId: session.user.id,
    newState: { field: "hashedPassword" },
  })

  revalidatePath("/perfil")
  return { ok: true, message: "Contraseña actualizada correctamente." }
}
