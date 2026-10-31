"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { Worksite } from "../import-fuel-modal.helpers"
import { ImportFuelLoadsModal } from "../import-fuel-modal"
import { ImportWizard as ControlImportWizard } from "../control/importar/import-wizard"
import type { MediumOption } from "../control/importar/import-types"
import type { AddDataDialogKind } from "./add-data-kind"

/**
 * Abre el importador que pidió «Agregar datos» (`?agregar=facturas|telemetria|surtidor`)
 * sobre «Fuentes de datos». Al cerrarlo quita el parámetro de la URL para que
 * recargar la página o volver atrás no lo reabra. Las facturas necesitan las
 * faenas (para mapear las del archivo) y el surtidor, los medios de suministro:
 * la página los consulta sólo cuando el diálogo se va a abrir.
 */
export function AddDataLauncher({ kind, worksites, media }: { kind: AddDataDialogKind; worksites: Worksite[]; media: MediumOption[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const close = useCallback((open: boolean) => {
    if (open) return
    const params = new URLSearchParams(searchParams.toString())
    params.delete("agregar")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  if (kind === "facturas") return <ImportFuelLoadsModal worksites={worksites} open onOpenChange={close} />
  return <ControlImportWizard kind={kind === "telemetria" ? "telemetry" : "supply_inputs"} media={media} open onOpenChange={close} />
}
