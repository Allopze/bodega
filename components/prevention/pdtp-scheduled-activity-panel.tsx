"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight, CalendarBlank, CheckCircle, Clock, Play } from "@phosphor-icons/react"
import { startPdtpScheduledInstanceAction } from "@/app/(app)/prevencion/pdtp/actions/scheduled-instances"
import type { PdtpExecutableInstanceRow } from "@/lib/services/pdtp/executable-instances"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/ui/empty-state"
import { MetaBadge } from "@/components/states/state-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { useSafeShellHeader } from "@/components/layout/header-context"

type PeriodFilter = "all" | "7" | "30"

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  submitted: "Enviada",
  overdue: "Vencida",
  reported: "Reportada",
}

function statusVariant(status: string): "default" | "success" | "warning" | "danger" | "outline" {
  if (status === "overdue") return "danger"
  if (status === "in_progress" || status === "submitted" || status === "reported") return "warning"
  if (status === "completed") return "success"
  return "default"
}

function chileToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
}

function addCivilDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function StartButton({ row }: { row: PdtpExecutableInstanceRow }) {
  const [pending, setPending] = React.useState(false)

  async function start() {
    if (row.kind === "obligation") {
      window.location.assign(row.href)
      return
    }
    setPending(true)
    try {
      const result = await startPdtpScheduledInstanceAction({ instanceId: row.id, connectorKey: row.connectorKey, instrumentId: row.instrumentId })
      if (result.ok && result.data && typeof result.data === "object" && "href" in result.data && typeof result.data.href === "string") {
        window.location.assign(result.data.href)
      } else {
        toast.error(result.message ?? "No se pudo abrir la actividad programada.")
      }
    } catch {
      toast.error("No se pudo abrir la actividad programada.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button type="button" size="sm" variant="primary" onClick={start} loading={pending}>
      <Play size={14} weight="fill" />
      {row.kind === "obligation" ? "Atender" : "Iniciar"}
    </Button>
  )
}

export function PdtpScheduledActivityPanel({
  rows,
  connectorLabel,
  searchQuery: searchOverride,
}: {
  rows: PdtpExecutableInstanceRow[]
  connectorLabel: string
  /**
   * Búsqueda de texto de la pantalla que monta el bloque.
   *
   * Por defecto el bloque lee el buscador del shell, pero en las rutas de
   * `ROUTES_WITH_OWN_SEARCH` (`/prevencion/inspecciones` entre ellas) la
   * cabecera no pinta ese input: el valor llegaba siempre vacío y el buscador
   * que el usuario sí veía no filtraba este bloque. Esas pantallas pasan su
   * propia búsqueda por acá, y así el bloque nunca depende de un valor
   * ambiente que puede no existir.
   */
  searchQuery?: string
}) {
  const [worksite, setWorksite] = React.useState("all")
  const [status, setStatus] = React.useState("all")
  const [period, setPeriod] = React.useState<PeriodFilter>("30")
  const [assignedToMe, setAssignedToMe] = React.useState(false)
  const { searchQuery: shellSearchQuery } = useSafeShellHeader()
  const searchQuery = searchOverride ?? shellSearchQuery
  const needle = searchQuery.trim().toLocaleLowerCase("es-CL")
  const today = chileToday()
  const periodEnd = period === "all" ? null : addCivilDays(today, Number(period))
  const worksites = React.useMemo(
    () => [...new Map(rows.map((row) => [row.worksiteId, row.worksiteName] as const)).entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es-CL")),
    [rows],
  )
  function resetFilters() {
    setWorksite("all")
    setStatus("all")
    setPeriod("all")
    setAssignedToMe(false)
  }
  function matchesSearch(row: PdtpExecutableInstanceRow) {
    if (!needle) return true
    return `${row.activityName} ${row.worksiteName} ${row.responsibleName ?? ""} ${row.statusLabel}`
      .toLocaleLowerCase("es-CL").includes(needle)
  }
  /** Cuántas sobreviven a la búsqueda de la pantalla, sin los filtros del bloque. */
  const searchMatchCount = rows.filter(matchesSearch).length
  const visibleRows = rows.filter((row) => {
    if (!matchesSearch(row)) return false
    if (worksite !== "all" && row.worksiteId !== worksite) return false
    if (status !== "all" && row.status !== status) return false
    if (assignedToMe && !row.assignedToMe) return false
    if (periodEnd && row.dueAt && row.dueAt > periodEnd) return false
    return true
  })

  // Sin nada programado el bloque ocupaba media pantalla —encabezado, tres
  // filtros y un estado vacío ilustrado— para empujar hacia abajo la lista que
  // es el objeto de la página. Colapsado dice lo mismo en un renglón, y no
  // ofrece filtros para un conjunto vacío.
  if (rows.length === 0) {
    return (
      <section
        aria-labelledby={`pdtp-programmed-${connectorLabel}`}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-xs"
      >
        <h2 id={`pdtp-programmed-${connectorLabel}`} className="text-sm font-semibold text-[var(--color-text)]">Actividades programadas</h2>
        <p className="text-sm text-[var(--color-text-subtle)]">
          Sin trabajo del Programa Preventivo pendiente en {connectorLabel.toLocaleLowerCase("es-CL")}.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby={`pdtp-programmed-${connectorLabel}`} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`pdtp-programmed-${connectorLabel}`} className="text-h3 text-[var(--color-text)]">Actividades programadas</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Trabajo del Programa Preventivo que se ejecuta en {connectorLabel.toLocaleLowerCase("es-CL")}.</p>
        </div>
        <MetaBadge meta={{ label: `${visibleRows.length} pendiente${visibleRows.length === 1 ? "" : "s"}`, variant: visibleRows.length > 0 ? "warning" : "default" }} />
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filtros de actividades programadas">
        <Select value={worksite} onValueChange={setWorksite}>
          <SelectTrigger aria-label="Faena"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Estado"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(value) => setPeriod(value as PeriodFilter)}>
          <SelectTrigger aria-label="Período"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Próximos 7 días</SelectItem>
            <SelectItem value="30">Próximos 30 días</SelectItem>
            <SelectItem value="all">Todo el período</SelectItem>
          </SelectContent>
        </Select>
        <Checkbox
          label="Asignadas a mí"
          checked={assignedToMe}
          onChange={(event) => setAssignedToMe(event.target.checked)}
          className="ml-1"
        />
      </div>

      {visibleRows.length === 0 ? (
        searchMatchCount === 0 ? (
          <EmptyState
            compact
            icon={<CheckCircle size={20} />}
            title={`Ninguna actividad coincide con «${searchQuery.trim()}»`}
            description={`La búsqueda de la pantalla también acota este bloque. Bórrala para volver a ver ${rows.length === 1 ? "la actividad programada" : `las ${rows.length} actividades programadas`}.`}
          />
        ) : (
          <EmptyState
            compact
            icon={<CheckCircle size={20} />}
            title="Ninguna actividad coincide con estos filtros"
            description={`Hay ${searchMatchCount} ${searchMatchCount === 1 ? "actividad programada" : "actividades programadas"} en este bloque, pero los filtros de arriba las dejan todas fuera.`}
            action={<Button type="button" size="sm" variant="secondary" onClick={resetFilters}>Quitar filtros del bloque</Button>}
          />
        )
      ) : (
        <div className="space-y-2">
          {visibleRows.map((row) => (
            <article key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-[var(--color-text)]">{row.activityName}</p>
                  <MetaBadge meta={{ label: row.statusLabel || STATUS_LABELS[row.status] || row.status, variant: statusVariant(row.status) }} />
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.worksiteName} · Responsable: {row.responsibleName ?? "Equipo responsable"}</p>
                <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-subtle)]">
                  {row.dueAt && <span className="inline-flex items-center gap-1"><CalendarBlank size={13} />{formatDate(row.dueAt)}</span>}
                  <span className="inline-flex items-center gap-1"><Clock size={13} />{row.kind === "scheduled" ? "Instancia fechada" : "Obligación"}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {row.kind === "obligation" ? <Button asChild size="sm" variant="secondary"><Link href={row.href}>Ver obligación <ArrowRight size={14} /></Link></Button> : <StartButton row={row} />}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
