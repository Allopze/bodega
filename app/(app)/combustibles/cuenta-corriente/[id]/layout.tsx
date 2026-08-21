import type { ReactNode } from "react"
import { requireRecord } from "@/lib/routing/require-record"
import { fuelMonthlyStatements } from "@/db/schema"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"

/**
 * Existe sólo para fijar el 404 real.
 *
 * La página de detalle vive dentro de la frontera de Suspense que crea su
 * `loading.tsx`, así que su `notFound()` llega cuando la cabecera `200 OK` ya
 * se envió. Este layout se renderiza por fuera de esa frontera: comprueba la
 * existencia primero y el estado HTTP dice la verdad, sin sacrificar el
 * esqueleto de carga. Ver `lib/routing/require-record.ts`.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  let session
  try {
    session = await requirePermission("combustibles:view")
    assertFuelCostAccess(session, { global: true })
  }
  catch { redirect("/forbidden") }

  const { id } = await params
  await requireRecord(fuelMonthlyStatements, fuelMonthlyStatements.id, id)
  return children
}
