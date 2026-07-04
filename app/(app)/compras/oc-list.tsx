"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { CheckCircle, Plus, Warning } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { StateBadge, OC_STATE_META } from "@/components/states/state-badge"
import { ListFilters, type FilterOption } from "@/components/adquisiciones/list-filters"
import { OnboardingHint } from "@/components/adquisiciones/onboarding-hint"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/admin/submit-button"
import { TableRow, TableCell } from "@/components/ui/table"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { formatCLP, formatDate } from "@/lib/utils"
import { issueOrderAction, sendOrderAction, deleteOrderAction, resumeItemAction } from "./actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Trash } from "@phosphor-icons/react"
import { useTransition } from "react"
import { DELETABLE_ORDER_STATUSES } from "@/lib/services/purchasing.constants"
import type { ActionState } from "@/lib/validation/operations"

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface OcRow {
  id:              string
  code:            string
  worksiteName:    string
  supplierName:    string
  status:          string
  itemCount:       number
  totalAmount:     number
  invoiceCount:    number
  issuedAt:        string | null
  sentAt:          string | null
  createdAt:       string
}

export interface PendingItem {
  id:            string
  requestId:     string
  requestCode:   string
  worksiteId:    string
  worksiteName:  string
  productName:   string
  productSku:    string | null
  quantity:      number
  unitOfMeasure: string
  urgency:       string
  notes:         string | null
}

const COLUMNS = [
  { key: "code",          label: "Código OC",  sortable: true,  width: "w-36" },
  { key: "worksiteName",  label: "Faena",      sortable: true  },
  { key: "supplierName",  label: "Proveedor",  sortable: true  },
  { key: "itemCount",     label: "Ítems",      sortable: true,  numeric: true, width: "w-20" },
  { key: "totalAmount",   label: "Total",      sortable: true,  numeric: true, width: "w-32" },
  { key: "status",        label: "Estado",     sortable: true,  width: "w-36" },
  { key: "invoiceCount",  label: "Facturas",   sortable: false, numeric: true, width: "w-24" },
  { key: "createdAt",     label: "Fecha",      sortable: true,  width: "w-32" },
]

/* ── Row with inline actions ─────────────────────────────────────────────────── */

function OcTableRow({ row, canDelete = false }: { row: OcRow; canDelete?: boolean }) {
  const router = useRouter()
  const [issueState, issueAction] = useActionState<ActionState, FormData>(
    issueOrderAction, INITIAL_STATE,
  )
  const [sendState, sendAction] = useActionState<ActionState, FormData>(
    sendOrderAction, INITIAL_STATE,
  )
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteOrderAction, INITIAL_STATE,
  )
  const [deletePending, startDeleteTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  React.useEffect(() => {
    if (!deleteState.message) return
    if (deleteState.ok) toast.success(deleteState.message)
    else toast.error(deleteState.message)
  }, [deleteState])

  React.useEffect(() => {
    if (issueState.ok && issueState.message) toast.success(issueState.message)
    else if (issueState.ok === false && issueState.message && issueState !== INITIAL_STATE) {
      toast.error(issueState.message)
    }
  }, [issueState])

  React.useEffect(() => {
    if (sendState.ok && sendState.message) toast.success(sendState.message)
    else if (sendState.ok === false && sendState.message && sendState !== INITIAL_STATE) {
      toast.error(sendState.message)
    }
  }, [sendState])

  const href = `/compras/${row.id}`

  return (
    <TableRow
      className="cursor-pointer hover:bg-[var(--color-primary-tint)]"
      role="link"
      tabIndex={0}
      aria-label={`Ver OC ${row.code}`}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          router.push(href)
        }
      }}
    >
      <TableCell>
        <span className="font-mono text-xs text-[var(--color-text)]">{row.code}</span>
      </TableCell>
      <TableCell className="text-sm text-[var(--color-text-muted)]">
        {row.worksiteName}
      </TableCell>
      <TableCell className="text-sm text-[var(--color-text-muted)]">
        {row.supplierName}
      </TableCell>
      <TableCell className="tabular-nums text-sm text-[var(--color-text-muted)] text-right pr-6">
        {row.itemCount}
      </TableCell>
      <TableCell className="tabular-nums text-sm text-right pr-6 font-medium">
        {formatCLP(row.totalAmount)}
      </TableCell>
      <TableCell className="text-right pr-6">
        {row.invoiceCount > 0 ? (
          <span className="inline-flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-muted)] text-xs font-medium px-2 py-0.5 tabular-nums">
            {row.invoiceCount}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-subtle)]">—</span>
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <StateBadge state={row.status} entity="oc" size="sm" />
          {/* Inline issue button for draft OCs */}
          {row.status === "draft" && (
            <form action={issueAction}>
              <input type="hidden" name="orderId" value={row.id} />
              <SubmitButton
                label="Emitir"
                loadingLabel="Emitiendo…"
                variant="secondary"
                size="sm"
              />
            </form>
          )}
          {/* Inline send button for issued OCs */}
          {row.status === "issued" && (
            <form action={sendAction}>
              <input type="hidden" name="orderId" value={row.id} />
              <SubmitButton
                label="Marcar enviada"
                loadingLabel="Enviando…"
                variant="secondary"
                size="sm"
              />
            </form>
          )}
          {canDelete && (DELETABLE_ORDER_STATUSES as readonly string[]).includes(row.status) && (
            <>
              <button
                type="button"
                disabled={deletePending}
                onClick={(e) => { e.stopPropagation(); setDeleteOpen(true) }}
                className="inline-flex items-center justify-center rounded p-1 text-text-subtle hover:text-danger hover:bg-danger-tint transition-colors disabled:opacity-40"
                title="Eliminar orden"
                aria-label={`Eliminar OC ${row.code}`}
              >
                <Trash size={15} />
              </button>
              <ConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title="¿Eliminar orden de compra?"
                description={`La orden ${row.code} será eliminada permanentemente junto con sus ítems y facturas adjuntas. Los ítems de la solicitud original volverán a estado pendiente. Esta acción no se puede deshacer.`}
                confirmLabel="Eliminar"
                variant="destructive"
                loading={deletePending}
                onConfirm={() => {
                  const fd = new FormData()
                  fd.set("orderId", row.id)
                  startDeleteTransition(() => deleteAction(fd))
                  setDeleteOpen(false)
                }}
              />
            </>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs text-[var(--color-text-subtle)]">
        {formatDate(row.sentAt ?? row.issuedAt ?? row.createdAt)}
      </TableCell>
    </TableRow>
  )
}

function PostponedItemRow({ item }: { item: PendingItem }) {
  const [resumeState, resumeAction] = useActionState<ActionState, FormData>(
    resumeItemAction, INITIAL_STATE,
  )

  React.useEffect(() => {
    if (resumeState.ok && resumeState.message) toast.success(resumeState.message)
    else if (resumeState.ok === false && resumeState.message && resumeState !== INITIAL_STATE) {
      toast.error(resumeState.message)
    }
  }, [resumeState])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-[var(--color-border)] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/solicitudes/${item.requestId}`} className="font-mono text-xs text-[var(--color-primary)] hover:underline">
            {item.requestCode}
          </Link>
          <span className="text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-[var(--color-text)]">{item.productName}</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {item.quantity} {item.unitOfMeasure}{item.notes ? ` · ${item.notes}` : ""}
        </p>
      </div>
      <form action={resumeAction} className="self-center">
        <input type="hidden" name="itemId" value={item.id} />
        <SubmitButton
          label="Reanudar"
          loadingLabel="Reanudando…"
          variant="secondary"
          size="sm"
        />
      </form>
    </div>
  )
}

/* ── OC List component ───────────────────────────────────────────────────────── */

const OC_STATUS_OPTIONS: FilterOption[] = Object.entries(OC_STATE_META).map(
  ([value, meta]) => ({ value, label: meta.label }),
)

export function OcList({
  orders,
  pendingCount,
  postponedItems = [],
  canCreate,
  canDelete = false,
  createdCount = 0,
  worksiteOptions = [],
  supplierOptions = [],
}: {
  orders:       OcRow[]
  pendingCount: number
  postponedItems?: PendingItem[]
  canCreate:    boolean
  canDelete?:   boolean
  createdCount?: number
  worksiteOptions?: FilterOption[]
  supplierOptions?: FilterOption[]
}) {
  const nuevaButton = canCreate ? (
    <Button variant="primary" size="sm" asChild>
      <Link href="/compras/nueva">
        <Plus weight="bold" size={14} />
        Nueva OC
      </Link>
    </Button>
  ) : undefined

  return (
    <div className="flex flex-col gap-4">
      <OnboardingHint
        storageKey="hint_compras_v1"
        title="Órdenes de compra"
        body="Aquí se generan las OC a partir de los ítems aprobados. El sistema las agrupa automáticamente por proveedor. Una vez emitida, márcala como enviada para que pase a Recepción."
      />
      {createdCount > 1 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] bg-[var(--color-success-tint)] border border-[var(--color-success-line)]">
          <CheckCircle size={16} className="text-[var(--color-success-ink)] shrink-0" />
          <p className="text-sm text-[var(--color-success-ink)] flex-1">
            Se crearon <span className="font-semibold">{createdCount} órdenes de compra</span>, separadas por proveedor.
          </p>
        </div>
      )}

      {/* Never-miss alert for approved items not on any OC */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] bg-[var(--color-signal-tint)] border border-[var(--color-signal-line)]">
          <Warning size={16} className="text-[var(--color-signal-ink)] shrink-0" />
          <p className="text-sm text-[var(--color-signal-ink)] flex-1">
            <span className="font-semibold">{pendingCount} ítem{pendingCount !== 1 ? "s" : ""}</span>
            {" "}aprobado{pendingCount !== 1 ? "s" : ""} sin incluir en ninguna OC.
          </p>
          {canCreate && (
            <Button variant="signal" size="sm" asChild>
              <Link href="/compras/nueva">
                <Plus weight="bold" size={14} />
                Crear OC
              </Link>
            </Button>
          )}
        </div>
      )}

      {postponedItems.length > 0 && (
        <section className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Ítems postergados</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Reanúdalos para que vuelvan al consolidado de OC.</p>
            </div>
          </div>
          <div>
            {postponedItems.map((item) => (
              <PostponedItemRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Filtros server-side (URL-synced) */}
      <ListFilters
        searchPlaceholder="Buscar por código o proveedor..."
        statusOptions={OC_STATUS_OPTIONS}
        worksiteOptions={worksiteOptions}
        supplierOptions={supplierOptions}
        exportTipo="compras"
        actions={nuevaButton}
      />

      {/* OC table */}
      <DataTable
        columns={COLUMNS}
        rows={orders as unknown as Record<string, unknown>[]}
        searchKeys={["code", "worksiteName", "supplierName", "status"]}
        disableInternalSearch
        pageSize={25}
        emptyTitle="Sin órdenes de compra"
        emptyDescription="No hay órdenes que coincidan con los filtros."
        emptyAction={nuevaButton}
        renderRow={(row) => <OcTableRow key={(row as unknown as OcRow).id} row={row as unknown as OcRow} canDelete={canDelete} />}
      />
    </div>
  )
}
