"use client"

import * as React from "react"
import { useActionState } from "react"
import Link from "next/link"
import { ArrowUpRight, CaretDown } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { SubmitButton } from "@/components/ui/submit-button"
import { formatDate } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { REQUEST_TYPE_LABELS, REQUEST_TYPE_VARIANTS } from "./types"
import type { ApprovalRequest } from "./types"
import { ItemRow } from "./item-row"
import { useBulkApproveAction } from "./use-approval-actions"
import { updateDeliveryModeAction } from "./actions"
import { INITIAL_STATE } from "@/lib/form-state"

const EMPTY_SELECTED_IDS: string[] = []

export function RequestGroup({
  request, canApproveEpp, canSetDispatch,
  selectedIds = EMPTY_SELECTED_IDS, onToggleItem, onToggleMany,
}: {
  request: ApprovalRequest
  canApproveEpp: boolean
  canSetDispatch: boolean
  /** E-3 · selección en lote, gestionada por ApprovalPanel. */
  selectedIds?: string[]
  onToggleItem?: (id: string) => void
  onToggleMany?: (ids: string[], select: boolean) => void
}) {
  const [collapsed, setCollapsed] = React.useState(false)
  const { bulkState, bulkAction, bulkPending } = useBulkApproveAction()
  const [modeState, modeAction] = useActionState(updateDeliveryModeAction, INITIAL_STATE)
  // Controlled value: React 19 auto-resets *uncontrolled* form fields after a successful
  // action, which would snap an uncontrolled select back to its (stale) defaultValue.
  // Seeding local state keeps the picked value visible; revert to server truth on failure.
  const [mode, setMode] = React.useState(request.deliveryMode)
  // Último valor confirmado por el servidor: el cambio ya no se envía al elegir
  // (un toque accidental en móvil reencaminaba la compra), sino con "Guardar".
  const [savedMode, setSavedMode] = React.useState(request.deliveryMode)
  const modeDirty = mode !== savedMode
  const handledMode = React.useRef(modeState)

  React.useEffect(() => {
    if (modeState === handledMode.current || !modeState.message) return
    handledMode.current = modeState
    if (modeState.ok) {
      setSavedMode(mode)
      toast.success(modeState.message)
    } else {
      toast.error(modeState.message)
      setMode(savedMode)
    }
  }, [modeState, mode, savedMode])

  const pendingIds = request.pendingItems.map((i) => i.id).join(",")
  // E-3 · estado de la casilla maestra de este grupo
  const groupItemIds = request.pendingItems.map((i) => i.id)
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedInGroup = groupItemIds.filter((id) => selectedSet.has(id)).length
  const allSelected = groupItemIds.length > 0 && selectedInGroup === groupItemIds.length
  const allApproved = bulkState.ok === true
  const canApproveThisRequest = request.requestType !== "epp" || canApproveEpp

  return (
    <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
      {/* `flex-wrap`: el bloque de la derecha es `shrink-0` y mide ~500px, así que
          a 390px comprimía el botón del código hasta que el texto se solapaba con
          el del solicitante y el Select se salía de la tarjeta. Envolviendo, los
          controles bajan a su propia línea en móvil (auditoría UI/UX 2026-07-29,
          A-01). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
        <div className="flex min-h-11 min-w-0 flex-1 basis-full items-center gap-1 sm:min-h-9 sm:basis-auto">
          {/* El código lleva al detalle; plegar la tarjeta es un botón aparte
              (antes el código sólo plegaba y nadie sabía que no era un enlace). */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--color-text-subtle)] hover:bg-[var(--color-surface)] sm:size-9"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expandir" : "Contraer"} ítems de ${request.code}`}
          >
            <CaretDown
              size={14}
              aria-hidden
              className={`transition-transform duration-[var(--duration-fast)] ${collapsed ? "-rotate-90" : ""}`}
            />
          </button>
          <Link
            href={`/solicitudes/${request.id}`}
            aria-label={`Ver solicitud ${request.code}`}
            title="Ver solicitud"
            className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] font-mono text-sm font-semibold text-[var(--color-text)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            {request.code}
            <ArrowUpRight size={12} aria-hidden className="text-[var(--color-text-subtle)]" />
          </Link>
          <MetaBadge meta={{ label: `${REQUEST_TYPE_LABELS[request.requestType] ?? request.requestType}`, variant: REQUEST_TYPE_VARIANTS[request.requestType] ?? "default" }} className="shrink-0" />
          <span className="text-sm text-[var(--color-text-muted)]">·</span>
          <span className="text-sm text-[var(--color-text-muted)] truncate">
            {request.worksiteName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-text-subtle)]">
            {request.requesterName}
          </span>
          {request.submittedAt && (
            <span className="text-xs text-[var(--color-text-subtle)]">
              · {formatDate(request.submittedAt)}
            </span>
          )}
          <span className="text-xs font-medium text-[var(--color-signal-ink)] bg-[var(--color-signal-tint)] rounded-full px-2 py-0.5">
            {request.pendingCount} pendiente{request.pendingCount !== 1 ? "s" : ""}
          </span>

          {canSetDispatch ? (
            <form action={modeAction} className="flex items-center gap-1">
              <input type="hidden" name="requestId" value={request.id} />
              <Select
                name="mode"
                value={mode}
                onValueChange={(value) => setMode(value as ApprovalRequest["deliveryMode"])}
              >
                <SelectTrigger
                  id={`mode-${request.id}`}
                  aria-label="Modo de despacho"
                  className="h-11 w-[9.5rem] px-2 text-xs sm:h-8"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="via_oficina">Vía oficina</SelectItem>
                  <SelectItem value="directo_faena">Directo a faena</SelectItem>
                </SelectContent>
              </Select>
              {modeDirty && (
                <>
                  <SubmitButton label="Guardar" loadingLabel="Guardando..." variant="secondary" size="sm" className="h-11 sm:h-8" />
                  <button
                    type="button"
                    onClick={() => setMode(savedMode)}
                    className="h-11 rounded-[var(--radius)] px-2 text-xs text-[var(--color-text-muted)] hover:underline sm:h-8"
                  >
                    Cancelar
                  </button>
                </>
              )}
              {/* El resultado se anuncia también a lectores de pantalla. */}
              <span className="sr-only" role="status" aria-live="polite">
                {modeState.message ?? ""}
              </span>
            </form>
          ) : (
            <MetaBadge meta={{ label: savedMode === "directo_faena" ? "Directo a faena" : "Vía oficina", variant: "outline" }} className="shrink-0 text-xs" />
          )}

          {!allApproved && canApproveThisRequest && onToggleMany && (
            <Checkbox
              id={`select-all-${request.id}`}
              label={allSelected ? "Quitar todos" : "Seleccionar todos"}
              checked={allSelected}
              onChange={() => onToggleMany(groupItemIds, !allSelected)}
            />
          )}
          {/* "Aprobar todos" envía el grupo completo e ignora la selección: con un
              ítem marcado, pulsarlo aprobaba los demás igual, sobre una acción
              irreversible. Convive con la barra en lote sólo mientras no haya
              nada marcado; en cuanto hay selección, manda la barra, que dice
              exactamente cuántos va a aprobar (auditoría UI/UX 2026-07-29, A-23). */}
          {!allApproved && canApproveThisRequest && selectedInGroup === 0 && (
            <form action={bulkAction}>
              <input type="hidden" name="itemIds" value={pendingIds} />
              <SubmitButton
                label={`Aprobar todos (${groupItemIds.length})`}
                loadingLabel="Aprobando..."
                variant="secondary"
                size="sm"
              />
            </form>
          )}
          {!bulkPending && allApproved && (
            <span className="text-xs text-[var(--color-success)] font-medium">Todos aprobados</span>
          )}
        </div>
      </div>

      {!collapsed && (
        <ul className="p-3 flex flex-col gap-2">
          {request.pendingItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              canApprove={canApproveThisRequest}
              selected={selectedSet.has(item.id)}
              onToggleSelect={canApproveThisRequest && onToggleItem ? onToggleItem : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
