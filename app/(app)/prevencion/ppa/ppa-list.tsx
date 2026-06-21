"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldCheck, MagnifyingGlass } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Pagination } from "@/components/ui/pagination"
import { cn } from "@/lib/utils"
import type { PpaRow } from "@/lib/services/ppa"
import { estadoPpaLabel, estadoPpaBadgeVariant, ESTADO_PPA_LABELS } from "@/lib/ppa/badges"
import { tipoTrabajoLabel } from "@/lib/ppa/types"
import { listPpaAction, type PpaListClientFilters } from "./actions"

const QUICK_FILTERS: { value: string; label: string; tone?: "signal" }[] = [
  { value: "",            label: "Todos" },
  { value: "pendientes",  label: "Por revisar", tone: "signal" },
  { value: "detenido",    label: "Detenidos",   tone: "signal" },
  { value: "autorizado",  label: "Autorizados" },
  { value: "rechazado",   label: "Rechazados" },
]

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) }
  catch { return iso }
}

interface Props {
  initialRows: PpaRow[]
  total: number
  pageSize: number
  worksiteOptions: { id: string; name: string }[]
  canReview: boolean
}

export function PpaList({ initialRows, total: initialTotal, pageSize, worksiteOptions, canReview }: Props) {
  const [rows, setRows] = React.useState(initialRows)
  const [total, setTotal] = React.useState(initialTotal)
  const [page, setPage] = React.useState(1)
  const [pending, startTransition] = React.useTransition()

  const [estado, setEstado] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")

  const filtersActive = !!(estado || worksiteId || search.trim() || dateFrom || dateTo)
  const firstRender = React.useRef(true)

  const filters = React.useMemo<PpaListClientFilters>(() => ({
    estado: estado || undefined,
    worksiteId: worksiteId || undefined,
    search: search.trim() || undefined,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
    // Incluye todo el día final (hasta 23:59:59.999).
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
  }), [estado, worksiteId, search, dateFrom, dateTo])

  // Re-consulta server-side cuando cambian filtros (con debounce) o página.
  React.useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    const handle = setTimeout(() => {
      startTransition(async () => {
        const res = await listPpaAction(filters, pageSize, (page - 1) * pageSize)
        if (res.ok && res.data) {
          setRows(res.data.rows)
          setTotal(res.data.total)
        }
      })
    }, 250)
    return () => clearTimeout(handle)
  }, [filters, page, pageSize])

  // Cambiar un filtro vuelve a la primera página.
  function onFilterChange(fn: () => void) {
    setPage(1)
    fn()
  }

  function clearFilters() {
    setPage(1)
    setEstado(""); setWorksiteId(""); setSearch(""); setDateFrom(""); setDateTo("")
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Quick-filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK_FILTERS.map((f) => {
          const active = estado === f.value
          return (
            <button
              key={f.value || "all"}
              type="button"
              data-pressable
              onClick={() => onFilterChange(() => setEstado(f.value))}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-[var(--duration-fast)]",
                active
                  ? f.tone === "signal"
                    ? "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)] ring-1 ring-[var(--color-signal-line)]"
                    : "bg-[var(--color-text)] text-[var(--color-bg)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]",
              )}
              aria-pressed={active}
            >
              {f.label}
            </button>
          )
        })}
        {canReview && (
          <span className="ml-auto hidden text-xs text-[var(--color-text-subtle)] sm:inline">
            Abre un PPA detenido para revisarlo.
          </span>
        )}
      </div>

      {/* Filtros detallados */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input
            placeholder="Trabajador o faena…"
            value={search}
            onChange={(e) => onFilterChange(() => setSearch(e.target.value))}
            className="max-w-xs pl-8"
            aria-label="Buscar por trabajador o faena"
          />
        </div>

        <Select value={estado || "all"} onValueChange={(v) => onFilterChange(() => setEstado(v === "all" ? "" : v))}>
          <SelectTrigger className="w-44" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="pendientes">Por revisar</SelectItem>
            {Object.entries(ESTADO_PPA_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {worksiteOptions.length > 1 && (
          <Select value={worksiteId || "all"} onValueChange={(v) => onFilterChange(() => setWorksiteId(v === "all" ? "" : v))}>
            <SelectTrigger className="w-44" aria-label="Filtrar por faena">
              <SelectValue placeholder="Faena" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las faenas</SelectItem>
              {worksiteOptions.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => onFilterChange(() => setDateFrom(e.target.value))}
          className="w-[9.5rem]"
          aria-label="Desde"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => onFilterChange(() => setDateTo(e.target.value))}
          className="w-[9.5rem]"
          aria-label="Hasta"
        />

        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={<ShieldCheck />}
            title="Sin coincidencias"
            description="Ningún PPA coincide con los filtros aplicados."
            action={
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                Limpiar filtros
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<ShieldCheck />}
            title="Aún no hay PPA registrados"
            description="Comparte el enlace o QR del formulario con tu equipo en terreno para empezar a recibir evaluaciones."
            tone="neutral"
          />
        )
      ) : (
        <>
          {/* Tabla (md+) */}
          <TableRoot className={cn("hidden md:block", pending && "opacity-60 transition-opacity")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Trabajador</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Tarea</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const href = `/prevencion/ppa/${r.id}`
                  return (
                    <TableRow key={r.id} className="cursor-pointer">
                      <TableCell><Link href={href} className="block">{fmtDate(r.createdAt)}</Link></TableCell>
                      <TableCell>
                        <Link href={href} className="block">
                          {r.workerName}
                          {r.manualIdentificacion && (
                            <Badge variant="warning" size="sm" className="ml-2">Manual</Badge>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell><Link href={href} className="block">{r.worksiteName ?? "—"}</Link></TableCell>
                      <TableCell><Link href={href} className="block">{tipoTrabajoLabel(r.tipoTrabajo)}</Link></TableCell>
                      <TableCell>
                        <Link href={href} className="block">
                          {r.resultado === "detenido"
                            ? <span className="text-[var(--color-danger-ink)]">Detenido</span>
                            : <span className="text-[var(--color-text-muted)]">Auto</span>}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={href} className="block">
                          <Badge variant={estadoPpaBadgeVariant(r.estado)} size="sm">
                            {estadoPpaLabel(r.estado)}
                          </Badge>
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination page={page} total={total} perPage={pageSize} onPage={setPage} />
          </TableRoot>

          {/* Cards (mobile) */}
          <div className={cn("flex flex-col gap-2 md:hidden", pending && "opacity-60 transition-opacity")}>
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/prevencion/ppa/${r.id}`}
                data-pressable
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">
                    {r.workerName}
                    {r.manualIdentificacion && (
                      <Badge variant="warning" size="sm" className="ml-2">Manual</Badge>
                    )}
                  </span>
                  <Badge variant={estadoPpaBadgeVariant(r.estado)} size="sm">
                    {estadoPpaLabel(r.estado)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {tipoTrabajoLabel(r.tipoTrabajo)} · {r.worksiteName ?? "—"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{fmtDate(r.createdAt)}</p>
              </Link>
            ))}
            <Pagination page={page} total={total} perPage={pageSize} onPage={setPage} />
          </div>
        </>
      )}
    </div>
  )
}
