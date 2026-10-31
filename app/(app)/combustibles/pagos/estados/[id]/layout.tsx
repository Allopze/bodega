import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { fuelMonthlyStatements } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { requireRecord } from "@/lib/routing/require-record"

/**
 * Existe sólo para fijar el 404 real: la página vive dentro de la frontera de
 * Suspense de su `loading.tsx`, y su `notFound()` llegaría con el `200 OK` ya
 * enviado. Ver `lib/routing/require-record.ts`.
 */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission("combustibles:view")
    assertFuelCostAccess(session, { global: true })
  } catch { redirect("/forbidden") }

  const { id } = await params
  await requireRecord(fuelMonthlyStatements, fuelMonthlyStatements.id, id)
  return children
}
