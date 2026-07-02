"use client"

import * as React from "react"
import { CaretDown } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { SubmitButton } from "@/components/admin/submit-button"
import { formatDate } from "@/lib/utils"
import { REQUEST_TYPE_LABELS, REQUEST_TYPE_VARIANTS } from "./types"
import type { ApprovalRequest } from "./types"
import { ItemRow } from "./item-row"
import { useBulkApproveAction } from "./use-approval-actions"

export function RequestGroup({ request, canApproveEpp }: { request: ApprovalRequest; canApproveEpp: boolean }) {
  const [collapsed, setCollapsed] = React.useState(false)
  const { bulkState, bulkAction } = useBulkApproveAction()

  const pendingIds = request.pendingItems.map((i) => i.id).join(",")
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
          {allApproved && (
            <span className="text-xs text-[var(--color-success)] font-medium">Todos aprobados</span>
          )}
        </div>
      </div>

      {!collapsed && (
        <ul className="p-3 flex flex-col gap-2">
          {request.pendingItems.map((item) => (
            <ItemRow key={item.id} item={item} canApprove={canApproveThisRequest} />
          ))}
        </ul>
      )}
    </div>
  )
}
