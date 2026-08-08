"use client"

import * as React from "react"
import { CheckCircle, XCircle } from "@phosphor-icons/react"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { formatQty, formatDate } from "@/lib/utils"
import { PriorityBadge } from "@/components/ui/priority-badge"
import type { ApprovalItem } from "./types"
import { ApproveForm } from "./approve-form"
import { ReasonForm } from "./reason-form"
import { useItemActions } from "./use-approval-actions"
import { WorkAssignmentControl } from "../pendientes/work-assignment-control"

type ItemAction = "idle" | "approving" | "rejecting"

export function ItemRow({
  item, canApprove = true, canAssignWork = false, selected = false, onToggleSelect,
}: {
  item: ApprovalItem
  canApprove?: boolean
  canAssignWork?: boolean
  /** E-3 · selección en lote. Sin `onToggleSelect` no se renderiza la casilla. */
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const [action, setAction] = React.useState<ItemAction>("idle")
  const {
    approveState, approveAction, approvePending,
    rejectState, rejectAction, rejectPending,
    decided,
  } = useItemActions()
  const prevDecidedRef = React.useRef(decided)

  React.useEffect(() => {
    const wasPending = prevDecidedRef.current === null
    const nowResolved = decided !== null
    if (wasPending && nowResolved) {
      setAction("idle")
    }
    prevDecidedRef.current = decided
  }, [decided])

  if (decided) {
    const label = decided === "approved" ? "Aprobado" : "Rechazado"
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

  const showLoading = approvePending || rejectPending

  return (
    <li
      data-selected={selected || undefined}
      className="rounded-[var(--radius-xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden data-[selected]:ring-2 data-[selected]:ring-[var(--color-primary-line)]"
    >
      {/* Mismo problema que el header del grupo: los grupos de acción son
          `shrink-0` y en móvil dejaban al contenido ~90px, con el nombre del
          producto y el código superpuestos a los botones. Envolviendo, las
          acciones bajan a su línea (A-01). */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 p-3">
        {onToggleSelect && (
          <Checkbox
            labelHidden
            label={`Seleccionar ${item.productName}`}
            checked={selected}
            onChange={() => onToggleSelect(item.id)}
            className="mt-1"
          />
        )}
        <div className="flex-1 basis-[min(100%,18rem)] min-w-0">
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

          {item.attributes.length > 0 && (
            <div className="mt-1 flex gap-1.5 flex-wrap">
              {item.attributes.map((a) => (
                <span
                  key={a.attributeName}
                  className="text-[11px] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded"
                >
                  {a.attributeName}: {a.value}
                </span>
              ))}
            </div>
          )}

          {/* Metadato informativo, no una advertencia: `warning` lo pintaba en
              ámbar mono-mayúsculas, con más peso visual que el propio nombre del
              producto. `default` es prose y neutro. */}
          {(item.suggestedSupplierName || item.supplierHint) && (
            <div className="mt-1 flex gap-1.5 flex-wrap items-center">
              <Badge variant="default" size="sm" className="shrink-0">
                Sugerido: {item.suggestedSupplierName || item.supplierHint}
              </Badge>
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text)]">
              {formatQty(item.quantity, item.unitOfMeasure)}
            </span>
            <PriorityBadge priority={item.urgency} size="sm" />
            {item.requiredDate && (
              <span>Para: {formatDate(item.requiredDate)}</span>
            )}
          </div>

          {item.notes && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)] italic leading-snug">
              {item.notes}
            </p>
          )}
        </div>

        {action === "idle" && !showLoading && canApprove && (
          <div className="flex items-center gap-2.5 shrink-0 ms-auto">
            {/* Aprobar es la acción esperada de esta pantalla: debe ser el único
                punto focal Nivel 1 de la fila. Antes era `secondary`, con lo que
                la bandeja de aprobación no tenía ninguna acción primaria. */}
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAction("approving")}
              className="gap-1"
            >
              <CheckCircle size={13} weight="bold" />
              Aprobar
            </Button>
            {/* `ghost` con sólo texto rojo dejaba a la decisión negativa sin
                afordancia de botón frente al verde sólido de Aprobar. */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAction("rejecting")}
              className="gap-1 border-[var(--color-danger-line)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
            >
              <XCircle size={13} weight="bold" />
              Rechazar
            </Button>
          </div>
        )}
        {action === "idle" && !canApprove && !showLoading && (
          <span className="text-[11px] text-[var(--color-text-subtle)] italic shrink-0 max-w-[140px] text-right leading-tight">
            Requiere Jefatura, Secretaría o Prevención
          </span>
        )}
        {canAssignWork && item.operationalItem && (
          <div className="shrink-0">
            <WorkAssignmentControl item={item.operationalItem} showAssignee />
          </div>
        )}
      </div>

      {action === "approving" && canApprove && (
        <ApproveForm
          item={item}
          approveAction={approveAction}
          approveState={approveState}
          onCancel={() => setAction("idle")}
        />
      )}

      {action === "rejecting" && canApprove && (
        <ReasonForm
          itemId={item.id}
          actionFn={rejectAction}
          state={rejectState}
          onCancel={() => setAction("idle")}
          label="Motivo del rechazo"
          placeholder="Explica por qué este ítem no puede ser aprobado..."
          note="Una vez confirmado, el rechazo no se puede revertir desde aquí. El resto de los ítems sigue su curso a compras."
          submitLabel="Confirmar rechazo"
          submitLoadingLabel="Rechazando..."
          colorClass="text-[var(--color-danger)]"
        />
      )}
    </li>
  )
}
