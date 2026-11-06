"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CheckCircle, IdentificationCard, Info, Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { PageHeader } from "@/components/ui/page-header"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DriverCandidate, DriverRosterRow } from "@/lib/services/driver-licenses-contract"
import { toast } from "@/lib/toast"
import { cn, countOf } from "@/lib/utils"
import { exportDriversXlsxAction } from "./actions"
import { DriverLicenseSheet, subjectFromCandidate, subjectFromRow, type LicenseSheetTarget } from "./driver-license-sheet"
import { DriversTable, toDriverTableRow } from "./drivers-table"
import {
  DRIVER_ESTADOS,
  DRIVER_ESTADO_LABEL,
  countDriversByEstado,
  filterDriversByEstado,
  type DriverEstado,
  type DriverExportFilters,
} from "./drivers-view"

export interface DriversWorkbenchProps {
  /** Todas las filas del alcance (con el filtro de faena ya aplicado); la vista por estado se filtra acá. */
  rows: DriverRosterRow[]
  candidates: DriverCandidate[]
  worksites: Array<{ id: string; name: string }>
  today: string
  warningDays: number
  unclassifiedWorkers: number
  canAssignPositions: boolean
  /** `?estado=` tal como vino en la URL (null si faltaba o no se reconoció). */
  estadoParam: DriverEstado | null
  /** Con qué vista abre si la URL no dice ninguna. */
  defaultEstado: DriverEstado
  /** `?faena=` ya validada contra las faenas del alcance. */
  faenaParam: string | null
  /** `?editar=`: trabajador cuya hoja se abre sola (el destino del correo de aviso). */
  editarWorkerId: string | null
  editRow: DriverRosterRow | null
}

/** Radix no admite `value=""` en un `SelectItem`: «todas las faenas» lleva un centinela propio. */
const ALL_WORKSITES = "_all"

/**
 * Estado local que sigue a un parámetro de la URL. Cambia al instante cuando la
 * persona actúa (sin esperar el viaje al servidor) y se realinea si el
 * parámetro cambia por otro camino: un enlace, el botón de atrás.
 *
 * Sólo reacciona al **parámetro**, no al valor por omisión: si la vista por
 * omisión cambiara sola —se renueva la última licencia de «Requieren atención»
 * y «todos» pasa a ser el valor por omisión—, la pantalla saltaría a la lista
 * completa justo cuando la persona ve «Todos los conductores tienen su licencia
 * al día».
 */
function useUrlParamState<T>(param: T | null, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = React.useState<T>(param ?? fallback)
  const [seen, setSeen] = React.useState<T | null>(param)
  if (seen !== param) {
    setSeen(param)
    setValue(param ?? fallback)
  }
  return [value, setValue]
}

interface SheetState {
  open: boolean
  /** Se conserva al cerrar: el contenido no se vacía mientras la hoja se anima hacia afuera. */
  target: LicenseSheetTarget | null
}

export function DriversWorkbench({
  rows,
  candidates,
  worksites,
  today,
  warningDays,
  unclassifiedWorkers,
  canAssignPositions,
  estadoParam,
  defaultEstado,
  faenaParam,
  editarWorkerId,
  editRow,
}: DriversWorkbenchProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = React.useTransition()

  const [estado, setEstado] = useUrlParamState<DriverEstado>(estadoParam, defaultEstado)
  const [faena, setFaena] = useUrlParamState<string | null>(faenaParam, null)
  // El fundido es de quien cambia de vista, no de la carga de la página (que ya tiene el suyo).
  const [animateList, setAnimateList] = React.useState(false)

  // A quién abre `?editar=`: alguien de la lista o, si todavía no tiene licencia ni su cargo la exige, un candidato.
  const editSubject = React.useMemo(() => {
    if (!editarWorkerId) return null
    if (editRow) return subjectFromRow(editRow)
    const candidate = candidates.find((item) => item.workerId === editarWorkerId)
    return candidate ? subjectFromCandidate(candidate) : null
  }, [candidates, editRow, editarWorkerId])

  const [sheet, setSheet] = React.useState<SheetState>(() => (
    editSubject
      ? { open: true, target: { kind: "edit", subject: editSubject } }
      : { open: false, target: null }
  ))
  // `?editar=` que llega con la pantalla ya abierta (un enlace del correo): se abre la hoja de esa persona.
  const [seenEditar, setSeenEditar] = React.useState(editarWorkerId)
  if (seenEditar !== editarWorkerId) {
    setSeenEditar(editarWorkerId)
    if (editSubject) setSheet({ open: true, target: { kind: "edit", subject: editSubject } })
  }

  /** Cambia parámetros de la vista: `replace` y sin saltar al inicio, igual que el resto de los filtros. */
  const replaceParams = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      const query = params.toString()
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
      })
    },
    [pathname, router, searchParams],
  )

  const changeEstado = React.useCallback(
    (next: DriverEstado) => {
      setEstado(next)
      setAnimateList(true)
      replaceParams((params) => params.set("estado", next))
    },
    [replaceParams, setEstado],
  )

  const changeFaena = React.useCallback(
    (next: string | null) => {
      setFaena(next)
      replaceParams((params) => {
        if (next) params.set("faena", next)
        else params.delete("faena")
      })
    },
    [replaceParams, setFaena],
  )

  const openRegister = React.useCallback(() => setSheet({ open: true, target: { kind: "register" } }), [])
  const openEdit = React.useCallback(
    (row: DriverRosterRow) => setSheet({ open: true, target: { kind: "edit", subject: subjectFromRow(row) } }),
    [],
  )
  const hasEditarParam = searchParams.has("editar")
  const closeSheet = React.useCallback(() => {
    setSheet((current) => ({ ...current, open: false }))
    // El parámetro sólo sirvió para llegar acá; si se queda, recargar reabriría la hoja.
    if (hasEditarParam) replaceParams((params) => params.delete("editar"))
  }, [hasEditarParam, replaceParams])

  // Un `?editar=` que no lleva a nadie (la persona ya no está activa o no es de tus faenas) se avisa una vez y se limpia.
  const warnedEditar = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!editarWorkerId || editSubject || warnedEditar.current === editarWorkerId) return
    warnedEditar.current = editarWorkerId
    toast.error("No encontramos a esa persona entre los trabajadores activos de tus faenas.")
    replaceParams((params) => params.delete("editar"))
  }, [editarWorkerId, editSubject, replaceParams])

  const counts = React.useMemo(() => countDriversByEstado(rows), [rows])
  const visibleRows = React.useMemo(() => filterDriversByEstado(rows, estado), [rows, estado])
  const tableRows = React.useMemo(() => visibleRows.map(toDriverTableRow), [visibleRows])

  const exportFilters = React.useMemo<DriverExportFilters>(() => ({ estado, faena }), [estado, faena])
  const headerActions = React.useMemo(
    () => (
      <div className="flex items-center gap-2">
        <ExportButton action={exportDriversXlsxAction} filters={exportFilters} />
        <Button type="button" size="sm" onClick={openRegister}>
          <Plus size={14} weight="bold" aria-hidden />
          Registrar licencia
        </Button>
      </div>
    ),
    [exportFilters, openRegister],
  )

  const estadoItems = DRIVER_ESTADOS.map((key) => ({
    key,
    label: `${DRIVER_ESTADO_LABEL[key]} · ${counts[key]}`,
    active: estado === key,
    onClick: () => changeEstado(key),
  }))

  const activeChips: ActiveFilterChip[] = []
  if (faena) {
    activeChips.push({
      key: "faena",
      label: "Faena",
      value: faena,
      displayValue: worksites.find((worksite) => worksite.id === faena)?.name ?? "Faena seleccionada",
    })
  }

  return (
    <>
      <PageHeader title="Conductores" description="Licencias de conducir por faena" actions={headerActions} />

      <div className="flex flex-col gap-3">
        <FilterToolbar
          className="mb-0"
          activeChips={activeChips}
          onRemoveChip={() => changeFaena(null)}
        >
          <SegmentedControl ariaLabel="Estado de las licencias" items={estadoItems} />
          {(worksites.length > 1 || faena) && (
            <Select value={faena ?? ALL_WORKSITES} onValueChange={(value) => changeFaena(value === ALL_WORKSITES ? null : value)}>
              <SelectTrigger className="w-full text-xs sm:w-56" aria-label="Faena">
                <SelectValue placeholder="Todas las faenas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_WORKSITES}>Todas las faenas</SelectItem>
                {worksites.map((worksite) => (
                  <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FilterToolbar>

        {unclassifiedWorkers > 0 && (
          <Callout tone="info" icon={<Info size={16} weight="fill" />}>
            <p>
              {unclassifiedWorkers === 1
                ? "1 trabajador de tus faenas no tiene cargo, así que no sabemos si conduce."
                : `${countOf(unclassifiedWorkers, "trabajador")} de tus faenas no tienen cargo, así que no sabemos si conducen.`}{" "}
              {canAssignPositions ? (
                <Link
                  href="/admin/trabajadores?vista=sin-cargo"
                  className="font-semibold underline underline-offset-2 hover:no-underline"
                >
                  Asignar cargos
                </Link>
              ) : (
                "Pide a administración que les asigne cargo."
              )}
            </p>
          </Callout>
        )}

        {/* Al cambiar de vista la lista entra con un fundido corto (sin movimiento con `prefers-reduced-motion`). */}
        <div
          key={estado}
          aria-busy={isPending}
          className={cn(
            animateList && "animate-in fade-in duration-[var(--duration-default)] motion-reduce:animate-none",
            "transition-opacity motion-reduce:transition-none",
            isPending && "opacity-60",
          )}
        >
          {rows.length === 0 ? (
            <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <EmptyState
                icon={<IdentificationCard size={28} aria-hidden />}
                title="Aún no hay licencias registradas en tus faenas"
                description="Registra la licencia de quienes conducen para ver aquí qué vence y a quién le falta."
                action={
                  <Button type="button" onClick={openRegister}>
                    <Plus size={14} weight="bold" aria-hidden />
                    Registrar licencia
                  </Button>
                }
              />
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              {estado === "atencion" ? (
                <EmptyState
                  tone="success"
                  icon={<CheckCircle size={28} weight="fill" aria-hidden />}
                  title="Todos los conductores tienen su licencia al día"
                  description="No hay licencias vencidas, por vencer ni por registrar."
                  action={<Button type="button" variant="secondary" onClick={() => changeEstado("todos")}>Ver todos</Button>}
                />
              ) : (
                <EmptyState
                  icon={<IdentificationCard size={28} aria-hidden />}
                  title="Ninguna licencia vigente por ahora"
                  description="Cuando se renueven o se registren, aparecerán en esta vista."
                  action={<Button type="button" variant="secondary" onClick={() => changeEstado("todos")}>Ver todos</Button>}
                />
              )}
            </div>
          ) : (
            <DriversTable rows={tableRows} today={today} warningDays={warningDays} onEdit={openEdit} />
          )}
        </div>
      </div>

      <DriverLicenseSheet
        open={sheet.open}
        target={sheet.target}
        candidates={candidates}
        today={today}
        warningDays={warningDays}
        onClose={closeSheet}
      />
    </>
  )
}
