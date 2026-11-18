"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { listTransferCandidatesAction } from "@/app/(app)/flota/traslados/actions"
import { toast } from "@/lib/toast"
import { TransferDialog } from "./transfer-dialog"

type Loaded = Extract<Awaited<ReturnType<typeof listTransferCandidatesAction>>, { ok: true }>["data"]

/**
 * Entrada de «Trasladar equipos». La lista de equipos se pide al abrir (no al pintar la página): así
 * refleja el estado de ese momento y la página no carga toda la flota para un botón que casi nadie
 * toca a la vez. Mientras carga, el botón queda ocupado. `initialVehicleId` (desde la ficha de un
 * equipo) abre el modal con ese equipo ya marcado.
 */
export function TransferButton({ initialVehicleId, label = "Trasladar equipos", variant }: {
  initialVehicleId?: string
  label?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [loaded, setLoaded] = React.useState<{ data: Loaded; key: number } | null>(null)

  async function openDialog() {
    setLoading(true)
    try {
      const result = await listTransferCandidatesAction()
      if (!result.ok) { toast.error(result.message); return }
      // Cada apertura monta el modal de cero (`key`): no hereda marcas, filtros ni errores de la anterior.
      setLoaded((current) => ({ data: result.data, key: (current?.key ?? 0) + 1 }))
      setOpen(true)
    } catch {
      toast.error("No se pudieron cargar los equipos. Inténtalo de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant={variant} onClick={openDialog} loading={loading}>{label}</Button>
      {loaded && (
        <TransferDialog
          key={loaded.key} open={open} onOpenChange={setOpen}
          candidates={loaded.data.candidates} worksites={loaded.data.worksites} window={loaded.data.window}
          initialVehicleId={initialVehicleId}
        />
      )}
    </>
  )
}
