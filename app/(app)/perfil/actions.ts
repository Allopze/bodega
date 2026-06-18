"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
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
