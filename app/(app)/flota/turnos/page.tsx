import type { ReactNode } from "react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PeriodControl } from "@/components/ui/period-control"
import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import {
  getEquipmentGridView,
  getOperatorRankingView,
  getShiftDayView,
  listShiftFormOptions,
  MAX_GRID_DAYS,
} from "@/lib/services/fleet-shifts-views"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { DayControl } from "./day-control"
import { EquipmentGridView } from "./equipment-grid-view"
import { OperatorRankingView } from "./operator-ranking-view"
import { ShiftDayView } from "./shift-day-view"
import { isShiftView, ShiftViewsTabs, type ShiftView } from "./shift-views-tabs"

export const metadata: Metadata = { title: "Turnos y ralentí" }

type SearchParams = Record<string, string | string[] | undefined>

const PATH = "/flota/turnos"
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const isPlainDate = (value: unknown): value is string =>
  typeof value === "string" && PLAIN_DATE.test(value) && addDaysToPlainDate(value, 0) === value

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

/** Un rango válido de la URL, o el de la vista cuando falta, está roto o viene invertido. */
function resolveRange(params: SearchParams, defaults: { from: string; to: string }): { from: string; to: string } {
  const from = first(params.desde)
  const to = first(params.hasta)
  const range = { from: isPlainDate(from) ? from : defaults.from, to: isPlainDate(to) ? to : defaults.to }
  return range.from <= range.to ? range : defaults
}

/** Los parámetros que viajan al cambiar de vista: lo que la persona ya eligió (día, período, equipo). */
function carriedParams(params: SearchParams): Record<string, string> {
  const carried: Record<string, string> = {}
  for (const key of ["dia", "desde", "hasta", "equipo"]) {
    const value = first(params[key])
    if (value) carried[key] = value
  }
  return carried
}

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("flota:view_shifts") }
  catch { redirect("/forbidden") }
  // Apagado de fábrica: lo enciende un administrador. Sin el interruptor la pantalla no existe para nadie.
  if (!(await isRouteOperational(PATH))) redirect("/flota")

  const params = await searchParams
  const scope = serviceWorksiteScope(session)
  const canManage = can(session, "flota:manage_shifts")
  const today = todayInChile()
  const yesterday = addDaysToPlainDate(today, -1)
  const requestedView = first(params.vista)
  const vista: ShiftView = isShiftView(requestedView) ? requestedView : "dia"

  let actions: ReactNode
  let content: ReactNode

  if (vista === "dia") {
    const requestedDay = first(params.dia)
    // Un día roto o del futuro en la URL vuelve a «ayer»: no hay telemetría que mirar adelante.
    const day = isPlainDate(requestedDay) && requestedDay <= today ? requestedDay : yesterday
    const [view, options] = await Promise.all([
      getShiftDayView(scope, day),
      canManage ? listShiftFormOptions(scope, day) : Promise.resolve({ vehicles: [], operators: [] }),
    ])
    actions = <DayControl day={day} max={today} defaultDay={yesterday} />
    content = (
      <ShiftDayView
        key={day}
        day={day}
        target={view.target}
        vehicles={view.vehicles}
        shifts={view.shifts}
        formVehicles={options.vehicles}
        formOperators={options.operators}
        canManage={canManage}
      />
    )
  } else if (vista === "operadores") {
    const defaults = { from: `${today.slice(0, 8)}01`, to: today }
    const { from, to } = resolveRange(params, defaults)
    const { vehicles } = await listShiftFormOptions(scope, to)
    // Un equipo fuera del alcance (o inventado en la URL) se ignora.
    const requested = first(params.equipo) ?? ""
    const vehicleId = vehicles.some((vehicle) => vehicle.id === requested) ? requested : ""
    const { target, ranking } = await getOperatorRankingView(scope, { from, to, ...(vehicleId ? { vehicleId } : {}) })
    actions = <PeriodControl mode="range" from={from} to={to} defaultRange={{ ...defaults, label: "este mes" }} />
    content = (
      <OperatorRankingView
        ranking={ranking}
        target={target}
        vehicleId={vehicleId}
        vehicles={vehicles.map((vehicle) => ({ id: vehicle.id, code: vehicle.code }))}
        dayHref={PATH}
      />
    )
  } else {
    const defaults = { from: addDaysToPlainDate(yesterday, -13), to: yesterday }
    const range = resolveRange(params, defaults)
    // La grilla no pasa de dos meses: más ancha no se lee. Se acota por el principio, que es lo más viejo.
    const earliest = addDaysToPlainDate(range.to, -(MAX_GRID_DAYS - 1))
    const from = range.from < earliest ? earliest : range.from
    const grid = await getEquipmentGridView(scope, { from, to: range.to })
    actions = <PeriodControl mode="range" from={from} to={range.to} defaultRange={{ ...defaults, label: "los últimos 14 días" }} />
    content = <EquipmentGridView grid={grid} canManage={canManage} dayHref={PATH} />
  }

  return (
    <PageContainer>
      <PageHeader
        title="Turnos y ralentí"
        description="Turnos de operación de los equipos y su % de ralentí por turno, operador y equipo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Control operacional", href: "/control-operacional" },
            { label: "Turnos y ralentí" },
          ]} />
        }
        actions={actions}
      />
      <div className="space-y-5">
        <ShiftViewsTabs current={vista} params={carriedParams(params)} />
        {content}
      </div>
    </PageContainer>
  )
}
