import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { fuelImportBatches, fuelOperationBatches, fuelTaeImportBatches } from "@/db/schema"
import { FUEL_BATCH_KINDS, type FuelBatchKind } from "@/lib/combustibles/routes"
import { requireRecord } from "@/lib/routing/require-record"

/**
 * Existe sólo para fijar el 404 real: la página vive dentro de la frontera de
 * Suspense de su `loading.tsx`, y su `notFound()` llegaría con el `200 OK` ya
 * enviado. Ver `lib/routing/require-record.ts`.
 */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ tipo: string; id: string }> }) {
  const { tipo, id } = await params
  if (!(FUEL_BATCH_KINDS as readonly string[]).includes(tipo)) notFound()
  const kind = tipo as FuelBatchKind
  if (kind === "tarjeta") await requireRecord(fuelImportBatches, fuelImportBatches.id, id)
  else if (kind === "planilla") await requireRecord(fuelOperationBatches, fuelOperationBatches.id, id)
  else await requireRecord(fuelTaeImportBatches, fuelTaeImportBatches.id, id)
  return children
}
