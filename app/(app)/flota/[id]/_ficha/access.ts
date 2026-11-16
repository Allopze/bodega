import { notFound, redirect } from "next/navigation"
import type { Session } from "next-auth"
import { requireAnyPermission } from "@/lib/auth/can"
import { auth } from "@/lib/auth/auth"
import type { VehicleFichaArea } from "@/lib/routing/vehicle-ficha"
import {
  loadVehicleFichaContext,
  VEHICLE_FICHA_AREA_PERMISSIONS,
  VEHICLE_FICHA_AREA_ROUTES,
  type VehicleFichaContext,
} from "@/lib/services/vehicle-ficha"

function forbidden(from: string): never {
  redirect(`/forbidden?desde=${encodeURIComponent(from)}`)
}

/**
 * Puerta de una pestaña de área. Pide el permiso del área en el servidor (el mismo que pedía su
 * ficha anterior, con el interruptor de su módulo) y después la faena: con permiso pero fuera de
 * alcance responde 404, igual que antes, para no confirmar que el vehículo existe.
 */
export async function openVehicleFichaArea(vehicleId: string, area: VehicleFichaArea): Promise<{ session: Session; ctx: VehicleFichaContext }> {
  let session: Session
  try {
    session = await requireAnyPermission([...VEHICLE_FICHA_AREA_PERMISSIONS[area]], VEHICLE_FICHA_AREA_ROUTES[area])
  } catch {
    forbidden(VEHICLE_FICHA_AREA_ROUTES[area])
  }
  const ctx = await loadVehicleFichaContext(session, vehicleId)
  if (!ctx || !ctx.areas.includes(area)) notFound()
  return { session, ctx }
}

/**
 * Puerta del «Resumen»: basta cualquier área. Sin ninguna con permiso, «Sin permiso»; con
 * permiso pero ninguna que cubra la faena del vehículo, 404. Quien ve una sola área no tiene
 * resumen: la página lo lleva a la suya.
 */
export async function openVehicleFicha(vehicleId: string): Promise<{ session: Session; ctx: VehicleFichaContext }> {
  const session = await auth()
  if (!session) forbidden("/flota")
  const ctx = await loadVehicleFichaContext(session, vehicleId)
  if (!ctx) notFound()
  if (ctx.permittedAreas.length === 0) forbidden("/flota")
  if (ctx.areas.length === 0) notFound()
  return { session, ctx }
}
