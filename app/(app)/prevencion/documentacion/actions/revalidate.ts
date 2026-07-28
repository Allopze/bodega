"use server"

import { REVALIDATE } from "./shared"
import { guardPermission } from "@/lib/auth/can"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

/**
 * Solo invalida caché, pero una server action sin guard es invocable por
 * cualquiera que conozca su id — se pide el mismo permiso de lectura que la
 * biblioteca que está refrescando.
 */
export async function revalidateBiblioteca(documentId?: string) {
  const guard = await guardPermission("prevention:docs:view")
  if (guard.error) return
  revalidateOperationalViews([REVALIDATE, ...(documentId ? [`${REVALIDATE}/${documentId}`] : [])])
}
