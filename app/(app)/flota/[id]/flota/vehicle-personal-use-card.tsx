"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { useOperation } from "@/lib/hooks/use-operation"
import type { PersonalUsePeriod } from "@/lib/fleet/personal-use"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"
import { deletePersonalUsePeriodAction } from "../../actions"
import { PersonalUseSheet } from "./personal-use-sheet"

interface VehiclePersonalUseCardProps {
  vehicleId: string
  /** Los períodos del equipo, el más reciente primero. */
  periods: PersonalUsePeriod[]
  /** `flota:personal_use` y alcance de la faena del equipo. Las acciones lo vuelven a exigir en el servidor. */
  canMark: boolean
  /** Hoy en Chile (`YYYY-MM-DD`): el día por defecto de «Desde» y el tope de las fechas. */
  today: string
}

/** «12-10-2026 → 19-10-2026», o «03-11-2026 → (en curso)» si el equipo aún no vuelve. */
function rangeLabel(period: Pick<PersonalUsePeriod, "startedOn" | "endedOn">): string {
  return `${formatDate(period.startedOn)} → ${period.endedOn ? formatDate(period.endedOn) : "(en curso)"}`
}

/** Qué hoja está abierta: una nueva marca o la edición de un período. */
type SheetTarget = { period: PersonalUsePeriod | null }

/**
 * Tarjeta «Uso personal» de la pestaña Flota: los períodos en que el dueño se llevó el equipo.
 * Verlos no pide permiso; marcarlos, editarlos y quitarlos sí (`canMark`). En esos días el equipo
 * no suma costos ni consumo en las cifras de gestión; los pagos y los registros no cambian.
 *
 * Mismo patrón que «Contrato»: lista de intervalos y una hoja para escribir. Las acciones
 * revalidan la ficha, así que no hace falta `router.refresh()`.
 */
export function VehiclePersonalUseCard({ vehicleId, periods, canMark, today }: VehiclePersonalUseCardProps) {
  const [sheet, setSheet] = React.useState<SheetTarget | null>(null)
  const [removing, setRemoving] = React.useState<PersonalUsePeriod | null>(null)
  const removal = useOperation()

  function confirmRemoval() {
    if (!removing) return
    const target = removing
    removal.run(
      () => deletePersonalUsePeriodAction(target.id),
      (result) => {
        toast.success(result.message ?? "Uso personal quitado")
        setRemoving(null)
      },
    )
  }

  return (
    <Card id="uso-personal" className="scroll-mt-4">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle as="h2" className="text-base">Uso personal</CardTitle>
        {/* Sin períodos, el botón del estado vacío es el que marca: dos iguales a la vista no aportan. */}
        {canMark && periods.length > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setSheet({ period: null })}>Marcar uso personal</Button>
        )}
      </CardHeader>
      <CardContent>
        {periods.length === 0 ? (
          <EmptyState
            as="p"
            compact
            align="start"
            title="Este equipo no tiene uso personal marcado"
            description={canMark
              ? "Márcalo cuando el dueño se lleve el equipo; esos días no cuentan en costos ni consumo."
              : "Quien administra equipos puede marcar los días en que el dueño se lleva el equipo."}
            action={canMark ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setSheet({ period: null })}>Marcar uso personal</Button>
            ) : undefined}
          />
        ) : (
          <ol className="divide-y divide-[var(--color-border)]">
            {periods.map((period) => {
              const range = rangeLabel(period)
              return (
                <li key={period.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                  <div>
                    <p className="font-mono">{range}</p>
                    {period.note ? <p className="text-xs text-[var(--color-text-muted)]">{period.note}</p> : null}
                  </div>
                  {canMark && (
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" aria-label={`Editar ${range}`} onClick={() => setSheet({ period })}>Editar</Button>
                      <span aria-hidden className="text-[var(--color-text-muted)]">·</span>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Quitar ${range}`} onClick={() => { removal.setMessage(""); setRemoving(period) }}>Quitar</Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>

      {canMark && (
        <>
          {/* `key` remonta la hoja por período: el formulario parte siempre de los datos que toca. */}
          <PersonalUseSheet
            key={sheet?.period?.id ?? "nuevo"}
            open={sheet !== null}
            onClose={() => setSheet(null)}
            vehicleId={vehicleId}
            period={sheet?.period ?? null}
            today={today}
          />
          <ConfirmDialog
            open={removing !== null}
            onOpenChange={(open) => { if (!open) setRemoving(null) }}
            title="Quitar uso personal"
            description={removing
              ? `Vas a quitar el uso personal del ${rangeLabel(removing)}. Esos días vuelven a contar en costos y consumo.`
              : ""}
            confirmLabel="Quitar"
            variant="destructive"
            loading={removal.pending}
            error={removal.messageTone === "error" ? removal.message : undefined}
            onConfirm={confirmRemoval}
          />
        </>
      )}
    </Card>
  )
}
