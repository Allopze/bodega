"use client"

import * as React from "react"
import Link from "next/link"
import { Plus, ArrowRight, Warning } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/utils"

export interface RepuestoRow {
  id:           string
  code:         string
  worksiteName: string
  urgency:      string
  status:       string
  itemCount:    number
  submittedAt:  string | null
  createdAt:    string
}

const COLUMNS = [
  { key: "code",         label: "Código",   sortable: true, width: "w-40" },
  { key: "worksiteName", label: "Faena",    sortable: true },
  { key: "urgency",      label: "Urgencia", sortable: true, width: "w-28" },
  { key: "itemCount",    label: "Ítems",    sortable: true, numeric: true, width: "w-20" },
  { key: "status",       label: "Estado",   sortable: true, width: "w-36" },
  { key: "createdAt",    label: "Fecha",    sortable: true, width: "w-32" },
  { key: "",             label: "",         sortable: false, width: "w-12" },
]

const URGENCY_LABELS: Record<string, string> = {
  normal:   "Normal",
  high:     "Alta",
  critical: "Crítica",
}

const URGENCY_DOT: Record<string, string> = {
  normal:   "text-[var(--color-text-subtle)]",
  high:     "text-[var(--color-warning)]",
  critical: "text-[var(--color-danger)]",
}

export function RepuestoList({
  requests,
  canCreate,
  hasWorksites = true,
}: {
  requests: RepuestoRow[]
  canCreate: boolean
  hasWorksites?: boolean
}) {
  const [showWarningModal, setShowWarningModal] = React.useState(false)

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={requests as unknown as Record<string, unknown>[]}
        searchKeys={["code", "worksiteName", "status"]}
        pageSize={25}
        searchPlaceholder="Buscar solicitud, faena, código..."
        emptyTitle="Sin solicitudes de repuestos"
        emptyDescription="Las solicitudes de repuestos de vehículos y maquinaria aparecerán aquí."
        emptyAction={
          canCreate ? (
            hasWorksites ? (
              <Button variant="primary" size="sm" asChild>
                <Link href="/repuestos/nueva">
                  <Plus weight="bold" size={16} />
                  Nueva solicitud
                </Link>
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setShowWarningModal(true)}>
                <Plus weight="bold" size={16} />
                Nueva solicitud
              </Button>
            )
          ) : undefined
        }
        actions={
          canCreate ? (
            hasWorksites ? (
              <Button variant="primary" size="sm" asChild>
                <Link href="/repuestos/nueva">
                  <Plus weight="bold" size={16} />
                  Nueva solicitud
                </Link>
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setShowWarningModal(true)}>
                <Plus weight="bold" size={16} />
                Nueva solicitud
              </Button>
            )
          ) : undefined
        }
        renderMobileCard={(row) => {
          const r = row as unknown as RepuestoRow
          return (
            <Link href={`/repuestos/${r.id}`} className="block">
              <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 active:scale-[0.99] transition-transform">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-[var(--color-text-subtle)]">{r.code}</p>
                    <span className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${URGENCY_DOT[r.urgency] ?? ""}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {URGENCY_LABELS[r.urgency] ?? r.urgency}
                    </span>
                  </div>
                  <StateBadge state={r.status} entity="request" size="sm" />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Faena</dt>
                    <dd className="text-[var(--color-text-muted)] truncate">{r.worksiteName}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Repuestos</dt>
                    <dd className="font-mono tabular-nums text-[var(--color-text)]">{r.itemCount}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-[var(--color-text-subtle)]">Fecha</dt>
                    <dd className="text-[var(--color-text-muted)]">{formatDate(r.submittedAt ?? r.createdAt)}</dd>
                  </div>
                </dl>
              </article>
            </Link>
          )
        }}
        renderRow={(row) => {
          const r = row as unknown as RepuestoRow
          return (
            <TableRow key={r.id} className="group">
              <TableCell>
                <span className="font-mono text-xs text-[var(--color-text)]">{r.code}</span>
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {r.worksiteName}
              </TableCell>
              <TableCell>
                <span className={`text-xs font-medium ${URGENCY_DOT[r.urgency] ?? ""}`}>
                  {URGENCY_LABELS[r.urgency] ?? r.urgency}
                </span>
              </TableCell>
              <TableCell className="tabular-nums text-sm text-[var(--color-text-muted)] text-right pr-6">
                {r.itemCount}
              </TableCell>
              <TableCell>
                <StateBadge state={r.status} entity="request" size="sm" />
              </TableCell>
              <TableCell className="text-xs text-[var(--color-text-subtle)]">
                {formatDate(r.submittedAt ?? r.createdAt)}
              </TableCell>
              <TableCell className="text-right pr-3">
                <Link
                  href={`/repuestos/${r.id}`}
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 h-9 w-9 rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] opacity-100 transition-[background-color,color,opacity,transform] duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] active:scale-[0.97] sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  aria-label={`Ver solicitud ${r.code}`}
                >
                  <ArrowRight size={16} />
                </Link>
              </TableCell>
            </TableRow>
          )
        }}
      />

      <Dialog open={showWarningModal} onOpenChange={setShowWarningModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)] mb-3">
              <Warning size={24} weight="bold" />
            </div>
            <DialogTitle>Sin faenas asignadas</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-center">
              No tienes faenas activas asignadas a tu cuenta. Contacta a un administrador para que te asigne una faena antes de poder crear una solicitud de repuestos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">Entendido</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
