import { revalidateTag } from "next/cache"
import { revalidateFuel } from "@/lib/combustibles/revalidate"
import { BADGE_COUNTS_TAG } from "@/lib/services/operational-cache"

/**
 * Lo que sigue a toda escritura de «Por revisar»: refresca las pantallas de
 * Combustible y vacía la caché de 30 s de los contadores del menú. Sin lo
 * segundo, la persona decide la última carga y el menú sigue diciendo «1»
 * hasta medio minuto después.
 *
 * Vacía la etiqueta general (no la de una faena) porque una decisión puede
 * tocar varias faenas a la vez y el costo de recalcular un contador es una
 * consulta liviana.
 */
export function revalidateInbox(): void {
  revalidateFuel()
  revalidateTag(BADGE_COUNTS_TAG, { expire: 0 })
}
