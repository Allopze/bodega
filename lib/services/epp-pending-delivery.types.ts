/**
 * Ítem de solicitud EPP ya recibido en faena al que todavía le queda saldo por
 * entregar a un trabajador y que tiene stock físico en esa bodega. Vive aquí (y
 * no en `app/(app)/entregas`) para que la página, el servicio y quienes sólo
 * necesitan el tipo lo importen sin ciclos.
 */
export interface DeliverableEppOption {
  requestItemId: string
  requestCode: string
  worksiteId: string
  productId: string
  productName: string
  productSku: string | null
  quantity: number
  deliveredQuantity: number
  receivedAtFaena: number
  remainingQuantity: number
  stockQuantity: number
  unitOfMeasure: string
}

/** Alcance de faenas: lista explícita de ids, o "all" sin restricción. */
export type DeliverableEppScope = { worksiteIds: string[] | "all" }
