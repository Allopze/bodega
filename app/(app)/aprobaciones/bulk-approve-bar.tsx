"use client"

import * as React from "react"
import { useActionState } from "react"
import { CheckCircle, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { bulkApproveRequestAction } from "./actions"
import { pluralize } from "@/lib/utils"

/**
 * E-3 · Barra de acciones en lote de la bandeja de aprobaciones.
 *
 * Aparece sólo cuando hay selección, y colapsa N decisiones en una. Se apoya en
 * `bulkApproveRequestAction`, que **valida el alcance ítem por ítem**
 * (`canAccessWorksite` + rol para EPP) y descarta los no permitidos informando
 * cuántos quedaron fuera — por eso es seguro seleccionar a través de varias
 * solicitudes y no sólo dentro de una.
 *
 * Es `sticky` al pie y no `fixed`: la selección se hace recorriendo la lista, así
 * que la barra tiene que seguir visible — pero `fixed` se posiciona respecto al
 * viewport y se metería debajo del sidebar en desktop. `sticky` dentro del
 * contenedor de scroll respeta su ancho sin necesidad de conocerlo.
 */
export function BulkApproveBar({
  selectedIds,
  onClear,
}: {
  selectedIds: string[]
  onClear: () => void
}) {
  const [state, action] = useActionState(bulkApproveRequestAction, INITIAL_STATE)
  const prevMessage = React.useRef<string | undefined>(undefined)

  React.useEffect(() => {
    // La guarda de "mismo mensaje" existe para no repetir el toast cuando el
    // efecto se re-dispara sin que haya un envío nuevo. En un fallo se limpia,
    // porque reintentar y volver a fallar con el mismo texto se veía como que
    // el botón no hacía nada.
    if (!state.message || state.message === prevMessage.current) return
    prevMessage.current = state.ok ? state.message : undefined
    if (state.ok) {
      toast.success(state.message)
      onClear()
    } else {
      toast.error(state.message)
    }
  }, [state, onClear])

  if (selectedIds.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Acciones sobre la selección"
      className="sticky bottom-0 z-30 -mx-4 mt-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-lg)] md:-mx-8"
    >
      <div className="mx-auto flex max-w-440 flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text)]">
          <span className="font-mono font-semibold tabular-nums">{selectedIds.length}</span>
          {" "}{pluralize(selectedIds.length, "ítem seleccionado", "ítems seleccionados")}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X size={14} />
            Quitar selección
          </Button>
          <form action={action}>
            <input type="hidden" name="itemIds" value={selectedIds.join(",")} />
            <SubmitButton
              label={`Aprobar ${selectedIds.length}`}
              loadingLabel="Aprobando..."
              variant="primary"
              size="sm"
            >
              <CheckCircle size={14} weight="bold" />
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  )
}
