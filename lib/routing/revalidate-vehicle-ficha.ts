import { revalidatePath } from "next/cache"
import { VEHICLE_FICHA_TABS, vehicleFichaHref } from "./vehicle-ficha"

/**
 * Refresca las cuatro pestañas de la ficha de un vehículo. Lo llama toda acción que cambia algo
 * que una de ellas muestra (documentos, OT, la ficha de mantención): con rutas literales, como
 * pide `revalidatePath` para una página concreta, y sin tocar las fichas de otros vehículos.
 */
export function revalidateVehicleFicha(vehicleId: string): void {
  for (const tab of VEHICLE_FICHA_TABS) revalidatePath(vehicleFichaHref(vehicleId, tab))
}
