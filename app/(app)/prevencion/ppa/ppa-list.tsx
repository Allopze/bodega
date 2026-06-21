"use client"

import * as React from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { ShieldCheck } from "@phosphor-icons/react"
import type { PpaRow } from "@/lib/services/ppa"
import { estadoPpaLabel, estadoPpaBadgeVariant } from "@/lib/ppa/badges"
import { ESTADO_PPA_LABELS } from "@/lib/ppa/badges"
import { tipoTrabajoLabel } from "@/lib/ppa/types"

const ESTADO_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos los estados" },
  ...Object.entries(ESTADO_PPA_LABELS).map(([value, label]) => ({ value, label })),
]

const selectCls =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) }
  catch { return iso }
}

export function PpaList({ initialRows, canReview }: { initialRows: PpaRow[]; canReview: boolean }) {
  const [estado, setEstado] = React.useState("")
  const [query, setQuery] = React.useState("")

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return initialRows.filter((r) => {
      if (estado && r.estado !== estado) return false
      if (q && !`${r.workerName} ${r.worksiteName ?? ""}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [initialRows, estado, query])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={selectCls} value={estado} onChange={(e) => setEstado(e.target.value)}>
          {ESTADO_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <Input
          placeholder="Buscar por trabajador o faena…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        {canReview && (
          <span className="ml-auto text-xs text-[var(--color-text-subtle)]">
            Haz clic en un PPA detenido para revisarlo.
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="Sin registros"
          description="No hay PPA que coincidan con el filtro."
        />
      ) : (
        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Trabajador</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Tarea</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/prevencion/ppa/${r.id}`} className="block">{fmtDate(r.createdAt)}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/prevencion/ppa/${r.id}`} className="block">
                      {r.workerName}
                      {r.manualIdentificacion && (
                        <Badge variant="warning" size="sm" className="ml-2">Manual</Badge>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/prevencion/ppa/${r.id}`} className="block">{r.worksiteName ?? "—"}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/prevencion/ppa/${r.id}`} className="block">{tipoTrabajoLabel(r.tipoTrabajo)}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/prevencion/ppa/${r.id}`} className="block">
                      <Badge variant={estadoPpaBadgeVariant(r.estado)} size="sm">
                        {estadoPpaLabel(r.estado)}
                      </Badge>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </div>
  )
}
