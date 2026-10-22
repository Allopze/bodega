import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { validateRut } from "@/lib/rut"
import { findTaeWorkerByRut } from "@/lib/services/fuel-tae"

export const runtime = "nodejs"

/**
 * Verifica por RUT a un conductor o supervisor de la faena elegida. Mismo
 * formato de respuesta que `/api/tae/identity`, pero con sesión en lugar de
 * enlace: quien ya inició sesión y puede registrar cargas puede ver el nombre
 * (con la misma minimización: nombre y la inicial del apellido).
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ ok: false, message: "Tu sesión expiró. Vuelve a ingresar." }, { status: 401 })
  if (!can(session, "combustibles:register_load")) {
    return NextResponse.json({ ok: false, message: "No tienes permiso para registrar cargas." }, { status: 403 })
  }
  const { worksiteId, rut } = await request.json().catch(() => ({})) as { worksiteId?: unknown; rut?: unknown }
  if (typeof worksiteId !== "string" || !canAccessWorksite(session, worksiteId)) {
    return NextResponse.json({ ok: false, message: "No tienes acceso a esta faena." }, { status: 403 })
  }
  if (typeof rut !== "string" || !validateRut(rut)) {
    return NextResponse.json({ ok: false, message: "RUT inválido. Debe tener formato 12345678-9 o similar." }, { status: 400 })
  }
  const worker = await findTaeWorkerByRut(rut, worksiteId)
  if (!worker) return NextResponse.json({ ok: false, message: "No se pudo verificar el RUT" }, { status: 404 })
  return NextResponse.json({ ok: true, data: { id: worker.id, name: `${worker.firstName} ${worker.lastName?.[0] ?? ""}.` } })
}
