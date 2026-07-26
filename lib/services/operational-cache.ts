import { revalidatePath, revalidateTag } from "next/cache"

/**
 * Invalida el centro operacional después de una mutación que puede crear,
 * resolver o cambiar la prioridad de una etapa. Mantiene el shell, dashboard
 * y cola coherentes sin obligar a cada flujo a recordar todas las rutas.
 */
export function revalidateOperationalViews(paths: Iterable<string> = []) {
  revalidatePath("/dashboard")
  revalidatePath("/pendientes")
  revalidateTag("badge-counts", { expire: 0 })
  for (const path of paths) revalidatePath(path)
}
