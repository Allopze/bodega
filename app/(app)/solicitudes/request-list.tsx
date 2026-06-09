"use client"

import * as React from "react"
import Link from "next/link"
import { Plus, ArrowRight, Warning } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"

export interface RequestRow {
  id:            string
  code:          string
  requestType:   string
  worksiteName:  string
  urgency:       string
  status:        string
  itemCount:     number
  submittedAt:   string | null
  createdAt:     string
}

const COLUMNS = [
  { key: "code",          label: "Código",     sortable: true,  width: "w-36" },
  { key: "requestType",   label: "Tipo",       sortable: true,  width: "w-28" },
  { key: "worksiteName",  label: "Faena",      sortable: true  },
  { key: "urgency",       label: "Urgencia",   sortable: true,  width: "w-28" },
  { key: "itemCount",     label: "Ítems",      sortable: true,  numeric: true, width: "w-20" },
  { key: "status",        label: "Estado",     sortable: true,  width: "w-36" },
  { key: "createdAt",     label: "Fecha",      sortable: true,  width: "w-32" },
  { key: "",              label: "",           sortable: false, width: "w-12" },
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

const REQUEST_TYPE_LABELS: Record<string, string> = {
  epp:        "EPP",
  stock:      "Stock",
  mantencion: "Mantención",
  otro:       "Otro",
}

const REQUEST_TYPE_VARIANTS: Record<string, "info" | "success" | "warning" | "default"> = {
  epp:        "info",
  stock:      "success",
  mantencion: "warning",
  otro:       "default",
}

export function RequestList({
  requests,
  canCreate,
  hasWorksites = true,
}: {
  requests: RequestRow[]
  canCreate: boolean
  hasWorksites?: boolean
}) {
  const [showWarningModal, setShowWarningModal] = React.useState(false)

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={requests as unknown as Record<string, unknown>[]}
        searchKeys={["code", "worksiteName", "status", "requestType"]}
        pageSize={25}
        searchPlaceholder="Buscar solicitud, faena, código..."
        emptyTitle="Sin solicitudes"
        emptyDescription="Las solicitudes de compra aparecerán aquí."
        emptyAction={
          canCreate ? (
            hasWorksites ? (
              <Button variant="primary" size="sm" asChild>
                <Link href="/solicitudes/nueva">
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
                <Link href="/solicitudes/nueva">
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
        renderRow={(row) => {
          const r = row as unknown as RequestRow
          return (
            <TableRow key={r.id} className="group">
              <TableCell>
                <span className="font-mono text-xs text-[var(--color-text)]">{r.code}</span>
              </TableCell>
              <TableCell>
                <Badge variant={REQUEST_TYPE_VARIANTS[r.requestType] ?? "default"} size="sm">
                  {REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType}
                </Badge>
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
                  href={`/solicitudes/${r.id}`}
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
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-warning-50)] text-[var(--color-warning-700)] mb-3">
              <Warning size={24} weight="bold" />
            </div>
            <DialogTitle>Sin faenas asignadas</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-center">
              No tienes faenas activas asignadas a tu cuenta o no existen faenas en el sistema. Contacta a un administrador para que te asigne una faena antes de poder crear una solicitud.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Entendido
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
