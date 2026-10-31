import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requireAnyPermission } from "@/lib/auth/can"
import { FUEL_BATCH_KINDS, FUEL_PATHS, type FuelBatchKind } from "@/lib/combustibles/routes"
import { PlanillaDetail } from "./planilla-detail"
import { SellosDetail } from "./sellos-detail"
import { TarjetaDetail } from "./tarjeta-detail"

export const metadata: Metadata = { title: "Archivo importado" }

/**
 * Ficha de un archivo importado: `tipo` dice de cuál de los tres orígenes es.
 * La puerta es la de la sección; cada ficha vuelve a exigir el permiso de su
 * importador (y el alcance por faena) antes de leer el lote.
 */
export default async function ArchivoImportadoPage({ params }: { params: Promise<{ tipo: string; id: string }> }) {
  let session
  try { session = await requireAnyPermission(["combustibles:import", "combustibles:tae_import", "combustibles:sync_integrations"], FUEL_PATHS.fuentes) } catch { redirect("/forbidden") }

  const { tipo, id } = await params
  if (!(FUEL_BATCH_KINDS as readonly string[]).includes(tipo)) notFound()
  const kind = tipo as FuelBatchKind
  if (kind === "tarjeta") return <TarjetaDetail session={session} id={id} />
  if (kind === "planilla") return <PlanillaDetail session={session} id={id} />
  return <SellosDetail session={session} id={id} />
}
