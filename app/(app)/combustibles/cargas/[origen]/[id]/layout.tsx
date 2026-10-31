import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { fuelLoads, fuelOperationRecords, fuelTaeSubmissions } from "@/db/schema"
import { isFuelLoadOrigin } from "@/lib/combustibles/routes"
import { requireRecord } from "@/lib/routing/require-record"

/**
 * Existe sólo para fijar el 404 real: la página vive dentro de la frontera de
 * Suspense de su `loading.tsx`, y su `notFound()` llegaría con el `200 OK` ya
 * enviado. Ver `lib/routing/require-record.ts`.
 */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ origen: string; id: string }> }) {
  const { origen, id } = await params
  if (!isFuelLoadOrigin(origen)) notFound()
  if (origen === "terreno") await requireRecord(fuelTaeSubmissions, fuelTaeSubmissions.id, id)
  else if (origen === "planilla") await requireRecord(fuelOperationRecords, fuelOperationRecords.id, id)
  else await requireRecord(fuelLoads, fuelLoads.id, id)
  return children
}
