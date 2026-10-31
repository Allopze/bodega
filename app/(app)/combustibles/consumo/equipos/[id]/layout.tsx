import type { ReactNode } from "react"
import { fuelVehicles } from "@/db/schema"
import { requireRecord } from "@/lib/routing/require-record"

/**
 * Existe sólo para fijar el 404 real: la página vive dentro de la frontera de
 * Suspense de su `loading.tsx`, y su `notFound()` llegaría con el `200 OK` ya
 * enviado. Ver `lib/routing/require-record.ts`.
 */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireRecord(fuelVehicles, fuelVehicles.id, id)
  return children
}
