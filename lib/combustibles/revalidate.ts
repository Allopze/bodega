import { revalidatePath } from "next/cache"

/**
 * Invalida todas las pantallas de Combustible. Una escritura en el módulo suele
 * cambiar cifras de varias secciones a la vez (Panel, Por revisar, Consumo), y
 * enumerar rutas sueltas fue lo que dejó pantallas viejas tras el rediseño de
 * rutas. Invalidar el layout de `/combustibles` las cubre todas.
 */
export function revalidateFuel(): void {
  revalidatePath("/combustibles", "layout")
}
