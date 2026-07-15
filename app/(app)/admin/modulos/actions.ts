"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { setModuleToggle, setSubmoduleToggle } from "@/lib/services/module-toggles"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/modulos"

export async function toggleModuleAction(
  moduleId: string,
  enabled: boolean,
): Promise<ActionState> {
  const result = await guardPermission("admin:module_management")
  if (result.error) return result.error

  const toggleResult = await setModuleToggle(moduleId, enabled, {
    userId:    result.session.user.id,
    userEmail: result.session.user.email ?? undefined,
  })

  revalidatePath(REVALIDATE)

  return {
    ok:      toggleResult.ok,
    message: toggleResult.message,
  }
}

export async function toggleSubmoduleAction(
  moduleId: string,
  submoduleHref: string,
  enabled: boolean,
): Promise<ActionState> {
  const result = await guardPermission("admin:module_management")
  if (result.error) return result.error

  const toggleResult = await setSubmoduleToggle(moduleId, submoduleHref, enabled, {
    userId:    result.session.user.id,
    userEmail: result.session.user.email ?? undefined,
  })

  revalidatePath(REVALIDATE)

  return {
    ok:      toggleResult.ok,
    message: toggleResult.message,
  }
}
