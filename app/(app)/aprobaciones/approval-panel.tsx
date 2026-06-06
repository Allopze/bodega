"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
import {
  CheckCircle, XCircle, ArrowCounterClockwise, Warning, CaretDown,
} from "@phosphor-icons/react"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/admin/submit-button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE } from "@/components/admin/form-state"
import {
  approveItemAction, rejectItemAction, returnItemAction, bulkApproveRequestAction,
} from "./actions"
import { formatQty, formatDate } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"

/* ── Data types (received from Server Component) ────────────────────────────── */

export interface ApprovalAttribute {
  attributeName: string
  value:         string
}

export interface ApprovalItem {
  id:            string
  productName:   string
  productSku:    string | null
  quantity:      number
  unitOfMeasure: string
  urgency:       string
  requiredDate:  string | null
  notes:         string | null
  status:        string
  attributes:    ApprovalAttribute[]
}

export interface ApprovalRequest {
  id:              string
  code:            string
  worksiteName:    string
  costCenterName:  string | null
  requesterName:   string
  requestUrgency:  string
  submittedAt:     string | null
  pendingItems:    ApprovalItem[]
  pendingCount:    number
}

/* ── Item action types ───────────────────────────────────────────────────────── */
type ItemAction = "idle" | "approving" | "rejecting" | "returning"

/* ── Urgency label ────────────────────────────────────────────────────────────── */
const URGENCY_LABEL: Record<string, string> = {
  normal:   "Normal",
  high:     "Urgente",
  critical: "Crítico",
}

const URGENCY_CLASS: Record<string, string> = {
  normal:   "text-[var(--color-text-muted)]",
  high:     "text-[oklch(0.62_0.15_56)] font-medium",
  critical: "text-[var(--color-danger)] font-semibold",
}

/* ── Single item row ─────────────────────────────────────────────────────────── */

function ItemRow({ item }: { item: ApprovalItem }) {
  const [action, setAction] = React.useState<ItemAction>("idle")
  const [decided, setDecided] = React.useState<"approved" | "rejected" | "returned" | null>(null)

  const [approveState, approveAction] = useActionState<ActionState, FormData>(
    approveItemAction, INITIAL_STATE,
  )
  const [rejectState, rejectAction] = useActionState<ActionState, FormData>(
    rejectItemAction, INITIAL_STATE,
  )
  const [returnState, returnAction] = useActionState<ActionState, FormData>(
    returnItemAction, INITIAL_STATE,
  )

  // Toast + collapse on successful action
  React.useEffect(() => {
    if (approveState.ok && approveState.message) {
      toast.success(approveState.message)
      setDecided("approved")
    } else if (approveState.ok === false && approveState.message && approveState !== INITIAL_STATE) {
      toast.error(approveState.message)
    }
  }, [approveState])

  React.useEffect(() => {
    if (rejectState.ok && rejectState.message) {
      toast.success(rejectState.message)
      setDecided("rejected")
    } else if (rejectState.ok === false && rejectState.message && rejectState !== INITIAL_STATE) {
      toast.error(rejectState.message)
    }
  }, [rejectState])

  React.useEffect(() => {
    if (returnState.ok && returnState.message) {
      toast.success(returnState.message)
      setDecided("returned")
    } else if (returnState.ok === false && returnState.message && returnState !== INITIAL_STATE) {
      toast.error(returnState.message)
    }
  }, [returnState])

  // Once a decision is made, show a collapsed "decided" state
  if (decided) {
    const label = decided === "approved" ? "Aprobado" : decided === "rejected" ? "Rechazado" : "Devuelto"
    return (
      <li className="flex items-center gap-3 py-2.5 px-3 rounded-[var(--radius)] bg-[var(--color-surface-2)] opacity-60">
        <StateBadge state={decided} entity="item" size="sm" />
        <span className="text-sm text-[var(--color-text-muted)]">
          {item.productSku && (
            <span className="font-mono text-xs text-[var(--color-text-subtle)] mr-2">
              {item.productSku}
            </span>
          )}
          {item.productName}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-subtle)]">{label}</span>
      </li>
    )
  }

  return (
    <li className="border border-[var(--color-border)] rounded-[var(--radius)] overflow-hidden">
      {/* Item header row */}
      <div className="flex items-start gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {item.productSku && (
              <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                {item.productSku}
              </span>
            )}
            <span className="text-sm font-medium text-[var(--color-text)]">
              {item.productName}
            </span>
            {!item.productSku && (
              <span className="text-[11px] text-[var(--color-text-subtle)] italic">(sin catálogo)</span>
            )}
          </div>

          {/* Attributes */}
          {item.attributes.length > 0 && (
            <div className="mt-1 flex gap-1.5 flex-wrap">
              {item.attributes.map((a, i) => (
                <span
                  key={i}
                  className="text-[11px] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded"
                >
                  {a.attributeName}: {a.value}
                </span>
              ))}
            </div>
          )}

          {/* Qty + urgency + date */}
          <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text)]">
              {formatQty(item.quantity, item.unitOfMeasure)}
            </span>
            <span className={URGENCY_CLASS[item.urgency] ?? URGENCY_CLASS.normal}>
              {URGENCY_LABEL[item.urgency] ?? item.urgency}
            </span>
            {item.requiredDate && (
              <span>Para: {formatDate(item.requiredDate)}</span>
            )}
          </div>

          {/* Notes */}
          {item.notes && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)] italic leading-snug">
              {item.notes}
            </p>
          )}
        </div>

        {/* Action buttons — only shown when idle */}
        {action === "idle" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAction("approving")}
              className="gap-1"
            >
              <CheckCircle size={13} weight="bold" />
              Aprobar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAction("returning")}
              className="gap-1 text-[var(--color-text-muted)]"
            >
              <ArrowCounterClockwise size={13} />
              Devolver
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAction("rejecting")}
              className="gap-1 text-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              <XCircle size={13} weight="bold" />
              Rechazar
            </Button>
          </div>
        )}
      </div>

      {/* Approve inline form (with optional qty change) */}
      {action === "approving" && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <form action={approveAction} className="flex flex-col gap-2">
            <input type="hidden" name="itemId" value={item.id} />
            <div className="flex items-center gap-3">
              <label className="text-xs text-[var(--color-text-muted)] shrink-0">
                Qty aprobada
              </label>
              <Input
                type="number"
                name="modifiedQty"
                step="0.01"
                min="0.01"
                placeholder={String(item.quantity)}
                className="h-7 w-28 text-sm"
              />
              <span className="text-xs text-[var(--color-text-subtle)]">
                {item.unitOfMeasure} (dejar vacío para aprobar {formatQty(item.quantity)})
              </span>
            </div>
            {approveState.ok === false && approveState.message && approveState !== INITIAL_STATE && (
              <p className="text-xs text-[var(--color-danger)] flex items-center gap-1">
                <Warning size={12} /> {approveState.message}
              </p>
            )}
            <div className="flex items-center gap-2">
              <SubmitButton
                label="Confirmar aprobación"
                loadingLabel="Aprobando..."
                variant="primary"
                size="sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAction("idle")}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Reject inline form */}
      {action === "rejecting" && (
        <ReasonForm
          itemId={item.id}
          actionFn={rejectAction}
          state={rejectState}
          onCancel={() => setAction("idle")}
          label="Motivo del rechazo"
          placeholder="Explica por qué este ítem no puede ser aprobado..."
          submitLabel="Confirmar rechazo"
          submitLoadingLabel="Rechazando..."
          colorClass="text-[var(--color-danger)]"
        />
      )}

      {/* Return inline form */}
      {action === "returning" && (
        <ReasonForm
          itemId={item.id}
          actionFn={returnAction}
          state={returnState}
          onCancel={() => setAction("idle")}
          label="Observaciones para el solicitante"
          placeholder="Qué debe corregir o aclarar el solicitante..."
          submitLabel="Devolver al solicitante"
          submitLoadingLabel="Devolviendo..."
          colorClass="text-[oklch(0.62_0.15_56)]"
        />
      )}
    </li>
  )
}

/* ── Reason form (shared for reject + return) ────────────────────────────────── */

function ReasonForm({
  itemId, actionFn, state, onCancel,
  label, placeholder, submitLabel, submitLoadingLabel, colorClass,
}: {
  itemId:             string
  // biome-ignore lint/suspicious/noExplicitAny: react dispatch type
  actionFn:           (formData: FormData) => void
  state:              ActionState
  onCancel:           () => void
  label:              string
  placeholder:        string
  submitLabel:        string
  submitLoadingLabel: string
  colorClass:         string
}) {
  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <form action={actionFn} className="flex flex-col gap-2">
        <input type="hidden" name="itemId" value={itemId} />
        <label className={`text-xs font-medium ${colorClass}`}>{label}</label>
        <Textarea
          name="reason"
          placeholder={placeholder}
          rows={2}
          className="text-sm"
          required
        />
        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="text-xs text-[var(--color-danger)] flex items-center gap-1">
            <Warning size={12} /> {state.message}
          </p>
        )}
        <div className="flex items-center gap-2">
          <SubmitButton
            label={submitLabel}
            loadingLabel={submitLoadingLabel}
            variant="destructive"
            size="sm"
          />
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}

/* ── Request group card ──────────────────────────────────────────────────────── */

function RequestGroup({ request }: { request: ApprovalRequest }) {
  const [collapsed, setCollapsed]   = React.useState(false)
  const [bulkState, bulkAction]     = useActionState<ActionState, FormData>(
    bulkApproveRequestAction, INITIAL_STATE,
  )
  const [allApproved, setAllApproved] = React.useState(false)

  React.useEffect(() => {
    if (bulkState.ok && bulkState.message) {
      toast.success(bulkState.message)
      setAllApproved(true)
    } else if (bulkState.ok === false && bulkState.message && bulkState !== INITIAL_STATE) {
      toast.error(bulkState.message)
    }
  }, [bulkState])

  const pendingIds = request.pendingItems.map((i) => i.id).join(",")

  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
      {/* Request header */}
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
          <span className="text-sm text-[var(--color-text-muted)]">·</span>
          <span className="text-sm text-[var(--color-text-muted)] truncate">
            {request.worksiteName}
            {request.costCenterName ? ` / ${request.costCenterName}` : ""}
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
          <span className="text-xs font-medium text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full px-2 py-0.5">
            {request.pendingCount} pendiente{request.pendingCount !== 1 ? "s" : ""}
          </span>

          {/* Bulk approve */}
          {!allApproved && (
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
          {allApproved && (
            <span className="text-xs text-[var(--color-success)] font-medium">Todos aprobados</span>
          )}
        </div>
      </div>

      {/* Items list */}
      {!collapsed && (
        <ul className="p-3 flex flex-col gap-2">
          {request.pendingItems.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── Main panel ──────────────────────────────────────────────────────────────── */

export function ApprovalPanel({ requests }: { requests: ApprovalRequest[] }) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckCircle size={36} weight="light" className="text-[var(--color-success)] mb-3" />
        <p className="text-sm font-medium text-[var(--color-text)]">Sin ítems pendientes</p>
        <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-xs">
          Todas las solicitudes enviadas han sido revisadas. Bien hecho.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {requests.map((req) => (
        <RequestGroup key={req.id} request={req} />
      ))}
    </div>
  )
}
