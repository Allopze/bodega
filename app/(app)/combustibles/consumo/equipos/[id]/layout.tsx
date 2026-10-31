import type { ReactNode } from "react"
import { notFound, redirect } from "next/navigation"
import { fuelVehicles } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { getEquipmentVehicle } from "@/lib/combustibles/equipment/get-equipment-file"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { requireRecord } from "@/lib/routing/require-record"

/**
 * Existe sólo para fijar el 404 real: la página vive dentro de la frontera de
 * Suspense de su `loading.tsx`, y su `notFound()` llegaría con el `200 OK` ya
 * enviado. Ver `lib/routing/require-record.ts`.
 *
 * Un equipo fuera de la faena de quien consulta da el mismo 404 que uno que no
 * existe (no confirma que exista). La página vuelve a comprobarlo: un layout no
 * se vuelve a ejecutar en cada navegación, y el alcance no se delega a él.
 */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireRecord(fuelVehicles, fuelVehicles.id, id)
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.consumo) } catch { redirect("/forbidden") }
  if (!(await getEquipmentVehicle(session, id))) notFound()
  return children
}
