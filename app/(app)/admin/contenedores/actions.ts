"use server"

import { revalidatePath } from "next/cache"
import { safeActionMessage } from "@/lib/action-error"
import { can, requireAuth } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import {
  createContainer,
  deleteContainer,
  updateContainer,
  type ContainerAccess,
} from "@/lib/services/prevention-containers"

const PERMISSION = "admin:containers" as const
const BASE = "/admin/contenedores"

export interface ContainerActionState {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
}

/**
 * El catálogo se refleja en tres lugares: acá, en el selector de sujeto de una
 * inspección nueva y en el de "agregar sujeto" del PDTP. Revalidar sólo esta
 * ruta dejaría a los otros dos ofreciendo un padrón viejo.
 */
function revalidateContainerViews() {
  revalidatePath(BASE)
  revalidatePath("/prevencion/inspecciones")
  revalidatePath("/prevencion/inspecciones/programacion")
  revalidatePath("/prevencion/pdtp/[programId]/ejecucion/[executionId]", "page")
}

async function run(operation: (access: ContainerAccess) => Promise<unknown>): Promise<ContainerActionState> {
  let session
  try {
    session = await requireAuth()
    if (!can(session, PERMISSION)) return { ok: false, message: "Sin permisos" }
  }
  catch { return { ok: false, message: "Sin permisos" } }

  try {
    const result = await operation({
      userId: session.user.id,
      permissions: session.user.permissions,
      scope: serviceWorksiteScope(session),
    })
    revalidateContainerViews()
    return { ok: true, data: (result ?? undefined) as Record<string, unknown> | undefined }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo completar la operación.") }
  }
}

export async function createContainerAction(input: unknown): Promise<ContainerActionState> {
  return run((access) => createContainer(input, access))
}

export async function updateContainerAction(input: unknown): Promise<ContainerActionState> {
  return run((access) => updateContainer(input, access))
}

export async function deleteContainerAction(input: unknown): Promise<ContainerActionState> {
  return run((access) => deleteContainer(input, access))
}
