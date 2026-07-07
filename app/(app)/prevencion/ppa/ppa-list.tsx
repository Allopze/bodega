"use client"

import * as React from "react"
import Link from "next/link"
import { MagnifyingGlass, ShieldCheck } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Pagination } from "@/components/ui/pagination"
import { cn, formatDateTime } from "@/lib/utils"
import type { PpaRow } from "@/lib/services/ppa"
import { estadoPpaLabel, estadoPpaBadgeVariant, ESTADO_PPA_LABELS } from "@/lib/ppa/badges"
import { tipoTrabajoLabel } from "@/lib/ppa/types"
import { listPpaAction, type PpaListClientFilters } from "./actions"
import { buildPpaListFilters } from "./list-filters"

const QUICK_FILTERS: { value: string; label: string; tone?: "signal" }[] = [
  { value: "",            label: "Todos" },
  { value: "pendientes",  label: "Por revisar", tone: "signal" },
  { value: "detenido",    label: "Detenidos",   tone: "signal" },
  { value: "autorizado",  label: "Autorizados" },
  { value: "rechazado",   label: "Rechazados" },
]

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

  const [search, setSearch] = React.useState("")
  const [estado, setEstado] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")

  const filtersActive = !!(estado || worksiteId || search.trim() || dateFrom || dateTo)
  const firstRender = React.useRef(true)

  const filters = React.useMemo<PpaListClientFilters>(
    () => buildPpaListFilters({ estado, worksiteId, search, dateFrom, dateTo }),
    [estado, worksiteId, search, dateFrom, dateTo],
  )

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
    setEstado(""); setWorksiteId(""); setDateFrom(""); setDateTo(""); setSearch("")
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Quick-filters — underline tabs */}
      <div className="flex items-end gap-0 border-b border-[var(--color-border)]">
        {QUICK_FILTERS.map((f) => {
          const active = estado === f.value
          return (
            <button
              key={f.value || "all"}
              type="button"
              onClick={() => onFilterChange(() => setEstado(f.value))}
              className={cn(
                "-mb-px px-3.5 pb-2.5 pt-1 text-sm font-medium",
                "border-b-2 transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                active
                  ? f.tone === "signal"
                    ? "border-[var(--color-signal)] text-[var(--color-signal-ink)]"
                    : "border-[var(--color-text)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]",
              )}
              aria-pressed={active}
            >
              {f.label}
            </button>
          )
        })}
        {canReview && (
          <span className="ml-auto hidden pb-2.5 text-xs text-[var(--color-text-subtle)] sm:inline">
            Abre un PPA detenido para revisarlo.
          </span>
        )}
      </div>

      {/* Filtros detallados */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute left-2.5 shrink-0 text-[var(--color-text-subtle)]"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => onFilterChange(() => setSearch(e.target.value))}
            placeholder="Buscar por trabajador o tarea..."
            aria-label="Buscar"
            className="h-8 w-48 pl-8 text-xs sm:w-64"
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

        <DatePicker
          value={dateFrom}
          onChange={(iso) => onFilterChange(() => setDateFrom(iso))}
          className="w-[9.5rem]"
          placeholder="Desde"
        />
        <DatePicker
          value={dateTo}
          onChange={(iso) => onFilterChange(() => setDateTo(iso))}
          className="w-[9.5rem]"
          placeholder="Hasta"
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
          <TableRoot className={cn("hidden md:block", pending && "opacity-60 transition-opacity duration-[var(--duration-default)] ease-[var(--ease-out)]")}>
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
                    <TableRow key={r.id} className="cursor-pointer hover:bg-[var(--color-primary-tint)]">
                      <TableCell><Link href={href} className="block">{formatDateTime(r.createdAt)}</Link></TableCell>
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
          <div className={cn("flex flex-col gap-2 md:hidden", pending && "opacity-60 transition-opacity duration-[var(--duration-default)] ease-[var(--ease-out)]")}>
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/prevencion/ppa/${r.id}`}
                data-pressable
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3 transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
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
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{formatDateTime(r.createdAt)}</p>
              </Link>
            ))}
            <Pagination page={page} total={total} perPage={pageSize} onPage={setPage} />
          </div>
        </>
      )}
    </div>
  )
}
