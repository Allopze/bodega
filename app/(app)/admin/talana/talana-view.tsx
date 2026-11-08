"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CheckCircle, ClockCounterClockwise, Users } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { TableCell, TableCellNum, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { DifferenceFixIn } from "@/lib/integrations/talana/talana-differences"
import type { TalanaItemKind, TalanaItemOutcome } from "@/lib/integrations/talana/talana-read"
import { formatDateTime } from "@/lib/utils"
import {
  FIX_IN_VARIANT, RUN_MODE_LABELS, itemOutcomeMeta, runStatusMeta,
} from "./talana-labels"

/* Filas ya resueltas por el servidor: la vista no conoce códigos ni tablas. */

export type DifferenceTableRow = {
  id: string
  personLabel: string
  rut: string
  codeLabel: string
  detail: string
  fixIn: DifferenceFixIn
  fixInLabel: string
}

export type ChangeTableRow = {
  id: string
  displayName: string
  rut: string
  worksiteName: string
  kind: TalanaItemKind
  kindLabel: string
  beforeLabel: string
  afterLabel: string
  outcome: TalanaItemOutcome
  reasonLabel: string
}

export type RunTableRow = {
  id: string
  startedAt: string
  mode: string
  status: string
  activeContracts: number
  /** Altas y reactivaciones. */
  altas: number
  bajas: number
  /** Traslados, cargos, jefes y sexos completados. */
  changes: number
  skipped: number
  reason: string
  /** Hay detalle persona por persona que ver. */
  hasItems: boolean
}

export interface TalanaViewProps {
  differences: DifferenceTableRow[]
  changes: ChangeTableRow[]
  runs: RunTableRow[]
  /** La corrida cuyos cambios se listan. */
  selectedRun: { id: string; startedAt: string; mode: string; isLatest: boolean } | null
  /** Hay al menos una descarga buena de Talana. */
  hasSyncedData: boolean
  /** La sesión puede abrir Administración › Trabajadores (destino del CTA de los estados vacíos). */
  canViewWorkers: boolean
}

/**
 * Las tres vistas viajan en la URL (`?vista=`) y la corrida elegida en
 * `?corrida=`, para que volver atrás conserve la pestaña. «Diferencias» es la
 * vista base y no escribe parámetro.
 */
const VISTAS = ["diferencias", "cambios", "corridas"] as const
type Vista = (typeof VISTAS)[number]

function parseVista(raw: string | null): Vista {
  return (VISTAS as readonly string[]).includes(raw ?? "") ? (raw as Vista) : "diferencias"
}

const DIFFERENCE_COLUMNS: ColumnDef[] = [
  { key: "personLabel", label: "Trabajador", sortable: true },
  { key: "rut", label: "RUT", sortable: true, width: "w-32" },
  { key: "codeLabel", label: "Diferencia", sortable: true },
  { key: "detail", label: "Detalle" },
  { key: "fixInLabel", label: "Corregir en", sortable: true, width: "w-32" },
]
const DIFFERENCE_SEARCH_KEYS: (keyof DifferenceTableRow)[] = ["personLabel", "rut", "codeLabel", "detail", "fixInLabel"]

const CHANGE_COLUMNS: ColumnDef[] = [
  { key: "displayName", label: "Trabajador", sortable: true },
  { key: "rut", label: "RUT", sortable: true, width: "w-32" },
  { key: "kindLabel", label: "Cambio", sortable: true },
  { key: "change", label: "Antes → después" },
  { key: "outcome", label: "Resultado", sortable: true, sortValue: (row: ChangeTableRow) => itemOutcomeMeta(row.outcome).label },
]
const CHANGE_SEARCH_KEYS: (keyof ChangeTableRow)[] = ["displayName", "rut", "kindLabel", "beforeLabel", "afterLabel", "worksiteName", "reasonLabel"]

const RUN_COLUMNS: ColumnDef[] = [
  { key: "startedAt", label: "Fecha", sortable: true },
  { key: "mode", label: "Modo", sortable: true },
  { key: "status", label: "Estado", sortable: true },
  { key: "activeContracts", label: "Activos", sortable: true, numeric: true },
  { key: "altas", label: "Altas", sortable: true, numeric: true },
  { key: "bajas", label: "Bajas", sortable: true, numeric: true },
  { key: "changes", label: "Cambios", sortable: true, numeric: true },
  { key: "skipped", label: "Omitidos", sortable: true, numeric: true },
  { key: "reason", label: "Motivo" },
  { key: "", label: "", width: "w-32" },
]
const RUN_SEARCH_KEYS: (keyof RunTableRow)[] = ["mode", "status", "reason"]

/** «Antes → después»: sólo las puntas que existen (un alta no tiene «antes»). */
function changeText(row: ChangeTableRow): string {
  if (row.kind === "sexo") return "Completado desde Talana"
  if (row.beforeLabel && row.afterLabel) return `${row.beforeLabel} → ${row.afterLabel}`
  return row.afterLabel || row.beforeLabel || "—"
}

export function TalanaView({ differences, changes, runs, selectedRun, hasSyncedData, canViewWorkers }: TalanaViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // La pestaña sale de la URL, pero se cambia de inmediato: `useOptimistic`
  // sostiene la elegida mientras el servidor resuelve la navegación.
  const urlVista = parseVista(searchParams.get("vista"))
  const [, startTransition] = React.useTransition()
  const [vista, setOptimisticVista] = React.useOptimistic(urlVista)

  function navigate(mutate: (params: URLSearchParams) => void, next: Vista) {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const query = params.toString()
    startTransition(() => {
      setOptimisticVista(next)
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    })
  }

  function changeVista(next: Vista) {
    navigate((params) => {
      if (next === "diferencias") params.delete("vista")
      else params.set("vista", next)
    }, next)
  }

  /** Abre los cambios de una corrida; `null` vuelve a la última. */
  function showRun(runId: string | null) {
    navigate((params) => {
      params.set("vista", "cambios")
      if (runId) params.set("corrida", runId)
      else params.delete("corrida")
    }, "cambios")
  }

  const workersLink = canViewWorkers
    ? { href: "/admin/trabajadores", label: "Ver trabajadores" }
    : { href: "/admin", label: "Volver a Administración" }
  const linkAction = (
    <Button asChild variant="secondary" size="sm">
      <Link href={workersLink.href}>{workersLink.label}</Link>
    </Button>
  )
  const historyAction = (
    <Button type="button" variant="secondary" size="sm" onClick={() => changeVista("corridas")}>
      Ver historial de corridas
    </Button>
  )
  const noDataDescription = "La sincronización corre todos los días a las 06:30 y guarda una copia de los contratos y ausencias de Talana. Cuando termine la primera corrida, lo verás acá."

  const renderDifferenceRow = (row: DifferenceTableRow) => (
    <TableRow>
      <TableCell className="font-medium">{row.personLabel}</TableCell>
      <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">{row.rut || "—"}</TableCell>
      <TableCell><MetaBadge meta={{ label: row.codeLabel, variant: "neutral" }} className="whitespace-normal" /></TableCell>
      <TableCell className="max-w-[48ch] text-[var(--color-text-muted)]">{row.detail}</TableCell>
      <TableCell><Badge variant={FIX_IN_VARIANT[row.fixIn]} size="sm">{row.fixInLabel}</Badge></TableCell>
    </TableRow>
  )

  const renderDifferenceCard = (row: DifferenceTableRow) => (
    <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-[var(--color-text)]">{row.personLabel}</h2>
          <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{row.rut || "—"}</p>
        </div>
        <Badge variant={FIX_IN_VARIANT[row.fixIn]} size="sm" className="shrink-0">{row.fixInLabel}</Badge>
      </div>
      <p className="mt-3 text-xs font-medium text-[var(--color-text)]">{row.codeLabel}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.detail}</p>
    </article>
  )

  const renderChangeRow = (row: ChangeTableRow) => (
    <TableRow>
      <TableCell>
        <p className="font-medium">{row.displayName}</p>
        {row.worksiteName && <p className="text-xs text-[var(--color-text-subtle)]">{row.worksiteName}</p>}
      </TableCell>
      <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">{row.rut || "—"}</TableCell>
      <TableCell>{row.kindLabel}</TableCell>
      <TableCell className="max-w-[44ch] text-[var(--color-text-muted)]">{changeText(row)}</TableCell>
      <TableCell>
        <MetaBadge meta={itemOutcomeMeta(row.outcome)} size="sm" />
        {row.reasonLabel && <p className="mt-1 max-w-[32ch] text-xs text-[var(--color-text-muted)]">{row.reasonLabel}</p>}
      </TableCell>
    </TableRow>
  )

  const renderChangeCard = (row: ChangeTableRow) => (
    <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-[var(--color-text)]">{row.displayName}</h2>
          <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{row.rut || "—"}{row.worksiteName ? ` · ${row.worksiteName}` : ""}</p>
        </div>
        <MetaBadge meta={itemOutcomeMeta(row.outcome)} size="sm" className="shrink-0" />
      </div>
      <p className="mt-3 text-xs font-medium text-[var(--color-text)]">{row.kindLabel}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{changeText(row)}</p>
      {row.reasonLabel && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.reasonLabel}</p>}
    </article>
  )

  const renderRunRow = (row: RunTableRow) => (
    <TableRow>
      <TableCell nowrap>{formatDateTime(row.startedAt)}</TableCell>
      <TableCell className="whitespace-nowrap text-[var(--color-text-muted)]">{RUN_MODE_LABELS[row.mode] ?? row.mode}</TableCell>
      <TableCell><MetaBadge meta={runStatusMeta(row.status)} size="sm" /></TableCell>
      <TableCellNum>{row.activeContracts}</TableCellNum>
      <TableCellNum title="Incluye reactivaciones">{row.altas}</TableCellNum>
      <TableCellNum>{row.bajas}</TableCellNum>
      <TableCellNum title="Traslados de faena, cargos, jefes y sexos completados">{row.changes}</TableCellNum>
      <TableCellNum>{row.skipped}</TableCellNum>
      <TableCell className="max-w-[40ch] text-xs text-[var(--color-text-muted)]">{row.reason || "—"}</TableCell>
      <TableCell>
        {row.hasItems ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => showRun(row.id)} aria-label={`Ver los cambios de la corrida del ${formatDateTime(row.startedAt)}`}>
            Ver cambios
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )

  return (
    <Tabs value={vista} onValueChange={(next) => changeVista(parseVista(next))}>
      <TabsList className="mb-3">
        <TabsTrigger value="diferencias">
          Diferencias
          <span className="ml-1.5 text-xs text-text-subtle">{differences.length}</span>
        </TabsTrigger>
        <TabsTrigger value="cambios">
          Cambios de la corrida
          <span className="ml-1.5 text-xs text-text-subtle">{changes.length}</span>
        </TabsTrigger>
        <TabsTrigger value="corridas">
          Corridas
          <span className="ml-1.5 text-xs text-text-subtle">{runs.length}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="diferencias">
        {differences.length === 0 ? (
          hasSyncedData ? (
            <EmptyState
              tone="success"
              icon={<CheckCircle size={22} weight="bold" aria-hidden />}
              title="Talana y Chome coinciden"
              description="No hay diferencias que revisar con la última descarga. Se vuelven a calcular cada día, después de la sincronización."
              action={historyAction}
            />
          ) : (
            <EmptyState
              icon={<Users size={22} weight="bold" aria-hidden />}
              title="Aún no hay datos de Talana"
              description={noDataDescription}
              action={linkAction}
            />
          )
        ) : (
          <DataTable
            caption="Diferencias entre Talana y Chome"
            columns={DIFFERENCE_COLUMNS}
            rows={differences}
            searchKeys={DIFFERENCE_SEARCH_KEYS}
            pageSize={25}
            emptyTitle="Sin resultados"
            emptyDescription="Ninguna diferencia coincide con la búsqueda."
            renderRow={renderDifferenceRow}
            renderMobileCard={renderDifferenceCard}
          />
        )}
      </TabsContent>

      <TabsContent value="cambios">
        {!selectedRun ? (
          <EmptyState
            icon={<ClockCounterClockwise size={22} weight="bold" aria-hidden />}
            title="Todavía no hay corridas"
            description={noDataDescription}
            action={linkAction}
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-muted)]">
              <span>
                Corrida del <span className="tabular-nums">{formatDateTime(selectedRun.startedAt)}</span>
                {" · "}{RUN_MODE_LABELS[selectedRun.mode]?.toLowerCase() ?? selectedRun.mode}
                {selectedRun.mode === "simulate" && ": nada de esto se aplicó en Chome."}
              </span>
              {!selectedRun.isLatest && (
                <Button type="button" variant="ghost" size="sm" onClick={() => showRun(null)}>
                  Ver la última corrida
                </Button>
              )}
            </div>
            {changes.length === 0 ? (
              <EmptyState
                tone="success"
                icon={<CheckCircle size={22} weight="bold" aria-hidden />}
                title="Esta corrida no propuso cambios"
                description="Lo que Talana informó ya coincidía con Chome en todo lo que la sincronización maneja: altas, bajas, faenas, cargos y jefes."
                action={historyAction}
              />
            ) : (
              <DataTable
                caption="Cambios de la corrida"
                columns={CHANGE_COLUMNS}
                rows={changes}
                searchKeys={CHANGE_SEARCH_KEYS}
                pageSize={25}
                emptyTitle="Sin resultados"
                emptyDescription="Ningún cambio coincide con la búsqueda."
                renderRow={renderChangeRow}
                renderMobileCard={renderChangeCard}
              />
            )}
          </>
        )}
      </TabsContent>

      <TabsContent value="corridas">
        {runs.length === 0 ? (
          <EmptyState
            icon={<ClockCounterClockwise size={22} weight="bold" aria-hidden />}
            title="Sin corridas registradas"
            description={noDataDescription}
            action={linkAction}
          />
        ) : (
          <DataTable
            caption="Corridas de la sincronización con Talana"
            columns={RUN_COLUMNS}
            rows={runs}
            searchKeys={RUN_SEARCH_KEYS}
            pageSize={25}
            emptyTitle="Sin resultados"
            emptyDescription="Ninguna corrida coincide con la búsqueda."
            renderRow={renderRunRow}
          />
        )}
      </TabsContent>
    </Tabs>
  )
}
