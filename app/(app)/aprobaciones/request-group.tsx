"use client"

import * as React from "react"
import { useActionState } from "react"
import { CaretDown } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { SubmitButton } from "@/components/admin/submit-button"
import { formatDate } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { REQUEST_TYPE_LABELS, REQUEST_TYPE_VARIANTS } from "./types"
import type { ApprovalRequest } from "./types"
import { ItemRow } from "./item-row"
import { useBulkApproveAction } from "./use-approval-actions"
import { updateDeliveryModeAction } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

const EMPTY_SELECTED_IDS: string[] = []

export function RequestGroup({
  request, canApproveEpp, canSetDispatch, canAssignWork,
  selectedIds = EMPTY_SELECTED_IDS, onToggleItem, onToggleMany,
}: {
  request: ApprovalRequest
  canApproveEpp: boolean
  canSetDispatch: boolean
  canAssignWork: boolean
  /** E-3 · selección en lote, gestionada por ApprovalPanel. */
  selectedIds?: string[]
  onToggleItem?: (id: string) => void
  onToggleMany?: (ids: string[], select: boolean) => void
}) {
  const [collapsed, setCollapsed] = React.useState(false)
  const { bulkState, bulkAction, bulkPending } = useBulkApproveAction()
  const [modeState, modeAction] = useActionState(updateDeliveryModeAction, INITIAL_STATE)
  const modeFormRef = React.useRef<HTMLFormElement>(null)
  // Controlled value: React 19 auto-resets *uncontrolled* form fields after a successful
  // action, which would snap an uncontrolled select back to its (stale) defaultValue.
  // Seeding local state keeps the picked value visible; revert to server truth on failure.
  const [mode, setMode] = React.useState(request.deliveryMode)

  React.useEffect(() => {
    if (modeState.message && !modeState.ok) {
      toast.error(modeState.message)
      setMode(request.deliveryMode)
    }
  }, [modeState, request.deliveryMode])

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
      <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
          aria-expanded={!collapsed}
        >
          <CaretDown
            size={14}
            className={`text-[var(--color-text-subtle)] transition-transform duration-[var(--duration-fast)] ${collapsed ? "-rotate-90" : ""}`}
          />
          <span className="font-mono text-sm font-semibold text-[var(--color-text)]">
            {request.code}
          </span>
          <Badge variant={REQUEST_TYPE_VARIANTS[request.requestType] ?? "default"} size="sm" className="shrink-0">
            {REQUEST_TYPE_LABELS[request.requestType] ?? request.requestType}
          </Badge>
          <span className="text-sm text-[var(--color-text-muted)]">·</span>
          <span className="text-sm text-[var(--color-text-muted)] truncate">
            {request.worksiteName}
          </span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
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
            <form ref={modeFormRef} action={modeAction} className="flex items-center gap-1">
              <input type="hidden" name="requestId" value={request.id} />
              <Select
                name="mode"
                value={mode}
                onValueChange={(value) => {
                  setMode(value as ApprovalRequest["deliveryMode"])
                  modeFormRef.current?.requestSubmit()
                }}
              >
                <SelectTrigger
                  id={`mode-${request.id}`}
                  aria-label="Modo de despacho"
                  className="h-7 w-[9.5rem] px-2 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="via_oficina">Vía oficina</SelectItem>
                  <SelectItem value="directo_faena">Directo a faena</SelectItem>
                </SelectContent>
              </Select>
            </form>
          ) : (
            <Badge variant="outline" size="sm" className="shrink-0 text-xs">
              {mode === "directo_faena" ? "Directo a faena" : "Vía oficina"}
            </Badge>
          )}

          {!allApproved && canApproveThisRequest && onToggleMany && (
            <Checkbox
              id={`select-all-${request.id}`}
              label={allSelected ? "Quitar todos" : "Seleccionar todos"}
              checked={allSelected}
              onChange={() => onToggleMany(groupItemIds, !allSelected)}
            />
          )}
          {!allApproved && canApproveThisRequest && (
            <form action={bulkAction}>
              <input type="hidden" name="itemIds" value={pendingIds} />
              <SubmitButton
                label="Aprobar todos"
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
              canAssignWork={canAssignWork}
              selected={selectedSet.has(item.id)}
              onToggleSelect={canApproveThisRequest && onToggleItem ? onToggleItem : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
