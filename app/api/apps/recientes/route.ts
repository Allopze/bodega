/**
 * GET /api/apps/recientes — las apps que la persona abrió hace poco, para el
 * lanzador de la barra superior. Devuelve sólo ids; qué apps puede ver lo
 * resuelve el cliente con sus permisos (`getLauncherApps`).
 */
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { getRecentAppIds } from "@/lib/services/app-visits"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ appIds: await getRecentAppIds(session.user.id) })
}
