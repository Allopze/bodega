"use client"

/**
 * Selección de período: tres patrones, uno por pregunta (hallazgo UX-07 de la
 * auditoría 2026-11-07). Antes cada pantalla armaba el suyo —un `<form>` GET con
 * dos fechas y «Aplicar período», un `Select` de meses, filtros con «Filtrar»— y
 * el mismo gesto se hacía de cuatro maneras distintas.
 *
 * - **Período de calendario** (un mes o un rango de fechas que la persona elige)
 *   → `PeriodControl`. Va en `PageHeader.actions`, cambia la URL con
 *   `router.replace(..., { scroll: false })` y no tiene botón «Aplicar»: cada
 *   gesto aplica. La única excepción es el rango personalizado, que son dos
 *   campos y por eso trae su propio «Aplicar rango».
 * - **Granularidad** de un mismo corte (Inicio: Mes / Trimestre / Año)
 *   → `SegmentedControl`.
 * - **Ventana móvil** relativa a hoy (Mantención: 7 días / 30 días / Este mes /
 *   Todo) → `SegmentedControl`.
 *
 * Si la pregunta es «¿qué fechas?» es un `PeriodControl`; si es «¿cómo lo
 * agrupo?» o «¿cuánto hacia atrás desde hoy?», es un `SegmentedControl`.
 *
 * Hay dos capas. `PeriodControlCore<P>` es el motor (flechas ‹ ›, accesos
 * rápidos, grilla de meses, rango personalizado) para cualquier tipo de período
 * `P`: lo usa Combustible, que además de meses tiene semanas, trimestres y años.
 * `PeriodControl` es la entrada para el resto de las pantallas: `mode="range"`
 * (`desde`/`hasta`) o `mode="month"` (`periodo=YYYY-MM`).
 *
 * El motor NO toca `window.history` ni cookies: persistir el período es una
 * decisión de cada módulo y se pide con `onSelect`. (En Next 16, tras un
 * `history.replaceState`, un `revalidatePath` + `router.refresh` produce una
 * recarga completa; por eso el único `replaceState` vive en el envoltorio de
 * Combustible y no aquí.)
 */

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarBlank, CaretDown, CaretLeft, CaretRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { addDaysToPlainDate, cn, MONTH_LABELS, MONTH_NAMES, todayInChile } from "@/lib/utils"

/* ---------- Motor genérico ---------- */

/** Cómo un tipo de período `P` se compara, se arma a partir de un mes o un rango y viaja en la URL. */
export interface PeriodControlModel<P> {
  same(a: P, b: P): boolean
  /** El período de un mes calendario (`month` es 1–12). */
  month(year: number, month: number): P
  /** El período de un rango personalizado. Sin esto el control no ofrece rango. */
  range?(from: string, to: string): P
  /** Parámetros de URL que representan el período. */
  toParams(period: P): Record<string, string>
}

export interface PeriodControlPreset<P> {
  key: string
  label: string
  period: P
}

export interface PeriodControlCoreProps<P> {
  model: PeriodControlModel<P>
  /** Texto del botón central: «Octubre 2026», «15 sep – 15 oct». */
  label: string
  value: P
  /** Primer y último día del período vigente: año inicial de la grilla y valor inicial del rango. */
  from: string
  to: string
  /** `null` desactiva la flecha. */
  prev?: P | null
  next?: P | null
  presets?: ReadonlyArray<PeriodControlPreset<P>>
  /** `false` oculta el rango personalizado (los estados de cuenta sólo admiten meses). */
  allowRange?: boolean
  /** Parámetros de período de la URL: se limpian al elegir uno nuevo, cualquiera sea su forma. */
  clearParams: readonly string[]
  /** Parámetros de paginación: vuelven a la primera página al cambiar el período. */
  pageParams?: readonly string[]
  /** Efecto previo a navegar (Combustible recuerda el período en una cookie). Recibe el período elegido. */
  onSelect?: (period: P) => void
  /** Con esto aparece «Volver a …»: quita el período de la URL y la pantalla vuelve a su valor por defecto. */
  reset?: { label: string }
  /** Nota al pie del panel. */
  hint?: string
  groupLabel?: string
  /** Sólo para pruebas: el «hoy» que fija la grilla de meses y el tope de las flechas. */
  today?: string
  className?: string
}

const DEFAULT_PAGE_PARAMS = ["page", "pagina"] as const

function yearOf(plainDate: string, fallback: string): number {
  const year = Number(plainDate.slice(0, 4))
  return Number.isInteger(year) && year > 0 ? year : Number(fallback.slice(0, 4))
}

export function PeriodControlCore<P>({
  model,
  label,
  value,
  from,
  to,
  prev,
  next,
  presets = [],
  allowRange = true,
  clearParams,
  pageParams = DEFAULT_PAGE_PARAMS,
  onSelect,
  reset,
  hint,
  groupLabel = "Período",
  today: todayProp,
  className,
}: PeriodControlCoreProps<P>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const today = todayProp ?? todayInChile()
  const [gridYear, setGridYear] = React.useState(() => yearOf(from, today))
  const [range, setRange] = React.useState({ from, to })
  const fieldId = React.useId()
  const showRange = allowRange && model.range !== undefined

  // Al abrir, la grilla y el rango parten del período vigente y no de lo que
  // quedó tecleado la vez anterior (tras las flechas ‹ › el rango viejo ya no
  // describe nada).
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setGridYear(yearOf(from, today))
      setRange({ from, to })
    }
    setOpen(nextOpen)
  }

  /** `null` quita el período de la URL y deja que la pantalla use el suyo por defecto. */
  function navigate(period: P | null) {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of [...clearParams, ...pageParams]) params.delete(key)
    if (period !== null) {
      for (const [key, paramValue] of Object.entries(model.toParams(period))) params.set(key, paramValue)
      onSelect?.(period)
    }
    setOpen(false)
    const query = params.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  const currentYear = Number(today.slice(0, 4))
  const currentMonthKey = today.slice(0, 7)

  return (
    <div className={cn("inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border-control)] bg-[var(--color-surface)]", className)} role="group" aria-label={groupLabel} aria-busy={pending || undefined}>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${groupLabel} anterior`} disabled={!prev} onClick={() => prev && navigate(prev)}>
        <CaretLeft aria-hidden="true" />
      </Button>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-11 min-w-[10.5rem] items-center justify-center gap-2 border-x border-[var(--color-border)] px-3 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-2)] sm:h-[34px]">
            <CalendarBlank aria-hidden="true" className="size-4 text-[var(--color-text-muted)]" />
            <span>{label}</span>
            <CaretDown aria-hidden="true" className="size-3.5 text-[var(--color-text-muted)]" />
            <span className="sr-only">. Cambiar {groupLabel.toLowerCase()}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" aria-label={`Elegir ${groupLabel.toLowerCase()}`} className="w-[min(23rem,calc(100vw-2rem))] space-y-4 p-4">
          {presets.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Accesos rápidos</h2>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => {
                  const active = model.same(preset.period, value)
                  return (
                    <Button key={preset.key} type="button" size="sm" variant={active ? "primary" : "secondary"} aria-pressed={active} onClick={() => navigate(preset.period)}>
                      {preset.label}
                    </Button>
                  )
                })}
              </div>
            </section>
          ) : null}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Un mes</h2>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Año anterior" onClick={() => setGridYear((y) => y - 1)}><CaretLeft aria-hidden="true" /></Button>
                <span className="w-12 text-center font-mono text-sm tabular-nums">{gridYear}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Año siguiente" disabled={gridYear >= currentYear} onClick={() => setGridYear((y) => y + 1)}><CaretRight aria-hidden="true" /></Button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTH_LABELS.map((monthLabel, index) => {
                const month = index + 1
                const key = `${gridYear}-${String(month).padStart(2, "0")}`
                const period = model.month(gridYear, month)
                const active = model.same(period, value)
                return (
                  <Button key={key} type="button" size="sm" variant={active ? "primary" : "secondary"} aria-pressed={active} disabled={key > currentMonthKey} onClick={() => navigate(period)}>
                    {monthLabel}
                  </Button>
                )
              })}
            </div>
          </section>
          {showRange ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Rango de fechas</h2>
              <DateRangePicker
                fromId={`${fieldId}-desde`}
                toId={`${fieldId}-hasta`}
                fromValue={range.from}
                toValue={range.to}
                onFromChange={(rangeFrom) => setRange((r) => ({ ...r, from: rangeFrom }))}
                onToChange={(rangeTo) => setRange((r) => ({ ...r, to: rangeTo }))}
              />
              <Button type="button" size="sm" className="mt-2" disabled={!range.from || !range.to} onClick={() => model.range && navigate(model.range(range.from, range.to))}>
                Aplicar rango
              </Button>
            </section>
          ) : null}
          {reset ? (
            <Button type="button" variant="ghost" size="sm" className="-ml-2.5" onClick={() => navigate(null)}>
              {reset.label}
            </Button>
          ) : null}
          {hint ? <p className="text-xs text-[var(--color-text-subtle)]">{hint}</p> : null}
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${groupLabel} siguiente`} disabled={!next} onClick={() => next && navigate(next)}>
        <CaretRight aria-hidden="true" />
      </Button>
    </div>
  )
}

/* ---------- Fechas civiles ("YYYY-MM-DD"), sin zona horaria ---------- */

export interface DateRange {
  from: string
  to: string
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, "0")
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Una fecha civil real: `2026-02-30` y `garbage` no lo son (el rango llega de la URL, sin validar). */
export function isPlainDate(value: string | undefined | null): value is string {
  if (!value || !PLAIN_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isValidRange(range: DateRange): boolean {
  return isPlainDate(range.from) && isPlainDate(range.to) && range.from <= range.to
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** El rango de un mes calendario completo. */
export function monthRange(year: number, month: number): DateRange {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` }
}

function wholeMonthOf(range: DateRange): { year: number; month: number } | null {
  const year = Number(range.from.slice(0, 4))
  const month = Number(range.from.slice(5, 7))
  const whole = monthRange(year, month)
  return whole.from === range.from && whole.to === range.to ? { year, month } : null
}

/** El rango anterior (`-1`) o siguiente (`+1`): el mes de al lado si es un mes completo; si no, uno del mismo largo. */
export function shiftDateRange(range: DateRange, direction: -1 | 1): DateRange {
  const whole = wholeMonthOf(range)
  if (whole) {
    const index = whole.year * 12 + (whole.month - 1) + direction
    return monthRange(Math.floor(index / 12), (index % 12) + 1)
  }
  const length = daysBetween(range.from, range.to) + 1
  return direction < 0
    ? { from: addDaysToPlainDate(range.from, -length), to: addDaysToPlainDate(range.from, -1) }
    : { from: addDaysToPlainDate(range.to, 1), to: addDaysToPlainDate(range.to, length) }
}

/** Las flechas de un rango: la de adelante se apaga cuando el siguiente empezaría después de hoy. */
export function rangeNeighbours(range: DateRange, today: string): { prev: DateRange | null; next: DateRange | null } {
  if (!isValidRange(range)) return { prev: null, next: null }
  const following = shiftDateRange(range, 1)
  return { prev: shiftDateRange(range, -1), next: following.from > today ? null : following }
}

function shortDate(plainDate: string, withYear: boolean): string {
  const month = Number(plainDate.slice(5, 7))
  return `${Number(plainDate.slice(8, 10))} ${(MONTH_LABELS[month - 1] ?? "").toLowerCase()}${withYear ? ` ${plainDate.slice(0, 4)}` : ""}`
}

/** «Octubre 2026» para un mes completo; «15 sep – 15 oct» (con año si no es el actual) para el resto. */
export function rangePeriodLabel(range: DateRange, today: string): string {
  if (!isValidRange(range)) return "Elegir período"
  const whole = wholeMonthOf(range)
  if (whole) return `${capitalize(MONTH_NAMES[whole.month - 1] ?? "")} ${whole.year}`
  const otherYear = range.from.slice(0, 4) !== today.slice(0, 4) || range.from.slice(0, 4) !== range.to.slice(0, 4)
  return `${shortDate(range.from, otherYear)} – ${shortDate(range.to, otherYear)}`
}

/** Accesos rápidos del modo rango: lo que más se pide, todo relativo a hoy. */
export function defaultRangePresets(today: string): PeriodControlPreset<DateRange>[] {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const previous = shiftDateRange(monthRange(year, month), -1)
  return [
    { key: "30d", label: "Últimos 30 días", period: { from: addDaysToPlainDate(today, -29), to: today } },
    { key: "90d", label: "Últimos 90 días", period: { from: addDaysToPlainDate(today, -89), to: today } },
    { key: "mes", label: "Este mes", period: monthRange(year, month) },
    { key: "mes-anterior", label: "Mes anterior", period: previous },
    { key: "12m", label: "Últimos 12 meses", period: { from: addDaysToPlainDate(today, -364), to: today } },
  ]
}

/* ---------- Entrada para las pantallas: rango o mes ---------- */

interface PeriodControlBaseProps {
  /** Parámetros de paginación que vuelven a la primera página al cambiar el período (por defecto `page` y `pagina`). */
  pageParams?: readonly string[]
  hint?: string
  groupLabel?: string
  /** Sólo para pruebas. */
  today?: string
  className?: string
}

export interface RangePeriodControlProps extends PeriodControlBaseProps {
  mode: "range"
  from: string
  to: string
  /** Parámetro de URL del inicio (por defecto `desde`). */
  fromParam?: string
  /** Parámetro de URL del término (por defecto `hasta`). */
  toParam?: string
  /**
   * El rango que la pantalla usa sin parámetros. Con él, y mientras el rango
   * vigente sea otro, el panel ofrece «Volver a {label}» (`label`: «los últimos
   * 90 días»).
   */
  defaultRange?: DateRange & { label: string }
  /** Accesos rápidos propios; por defecto `defaultRangePresets`. */
  presets?: ReadonlyArray<PeriodControlPreset<DateRange>>
}

export interface MonthPeriodControlProps extends PeriodControlBaseProps {
  mode: "month"
  /** «YYYY-MM». */
  month: string
  /** Parámetro de URL del mes (por defecto `periodo`). */
  periodParam?: string
}

export type PeriodControlProps = RangePeriodControlProps | MonthPeriodControlProps

const rangeEquals = (a: DateRange, b: DateRange) => a.from === b.from && a.to === b.to

function RangePeriodControl({
  from,
  to,
  fromParam = "desde",
  toParam = "hasta",
  defaultRange,
  presets,
  today: todayProp,
  ...rest
}: Omit<RangePeriodControlProps, "mode">) {
  const today = todayProp ?? todayInChile()
  const model = React.useMemo<PeriodControlModel<DateRange>>(() => ({
    same: rangeEquals,
    month: monthRange,
    range: (rangeFrom, rangeTo) => ({ from: rangeFrom, to: rangeTo }),
    toParams: (period) => ({ [fromParam]: period.from, [toParam]: period.to }),
  }), [fromParam, toParam])
  const valid = isValidRange({ from, to })
  // Un rango que llegó roto en la URL no se dibuja ni se desplaza: el control
  // ofrece elegir uno nuevo en vez de caerse con una fecha imposible.
  const value: DateRange = valid ? { from, to } : { from: "", to: "" }
  const { prev, next } = rangeNeighbours(value, today)
  const isDefault = defaultRange ? valid && rangeEquals(value, defaultRange) : true

  return (
    <PeriodControlCore
      {...rest}
      model={model}
      label={rangePeriodLabel(value, today)}
      value={value}
      from={value.from}
      to={value.to}
      prev={prev}
      next={next}
      presets={presets ?? defaultRangePresets(today)}
      clearParams={[fromParam, toParam]}
      {...(defaultRange && !isDefault ? { reset: { label: `Volver a ${defaultRange.label}` } } : {})}
      today={today}
    />
  )
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

function shiftMonthKey(key: string, direction: -1 | 1): string {
  const [year = 0, month = 1] = key.split("-").map(Number)
  const index = year * 12 + (month - 1) + direction
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

function MonthPeriodControl({ month, periodParam = "periodo", today: todayProp, ...rest }: Omit<MonthPeriodControlProps, "mode">) {
  const today = todayProp ?? todayInChile()
  const model = React.useMemo<PeriodControlModel<string>>(() => ({
    same: (a, b) => a === b,
    month: (year, monthNumber) => `${year}-${pad(monthNumber)}`,
    toParams: (period) => ({ [periodParam]: period }),
  }), [periodParam])
  const valid = MONTH_KEY.test(month)
  const currentKey = today.slice(0, 7)
  const nextKey = valid ? shiftMonthKey(month, 1) : null
  const [year = 0, monthNumber = 1] = month.split("-").map(Number)
  const bounds = valid ? monthRange(year, monthNumber) : { from: `${currentKey}-01`, to: today }
  const presets: PeriodControlPreset<string>[] = [
    { key: "mes", label: "Este mes", period: currentKey },
    { key: "mes-anterior", label: "Mes anterior", period: shiftMonthKey(currentKey, -1) },
  ]

  return (
    <PeriodControlCore
      {...rest}
      model={model}
      label={valid ? `${capitalize(MONTH_NAMES[monthNumber - 1] ?? "")} ${year}` : "Elegir período"}
      value={month}
      from={bounds.from}
      to={bounds.to}
      prev={valid ? shiftMonthKey(month, -1) : null}
      next={nextKey !== null && nextKey <= currentKey ? nextKey : null}
      presets={presets}
      allowRange={false}
      clearParams={[periodParam]}
      today={today}
    />
  )
}

/**
 * El selector de período de las pantallas (ver la regla al inicio del archivo):
 * ‹ período anterior · período vigente ▾ · período siguiente ›, con accesos
 * rápidos, grilla de meses y —en modo `range`— rango personalizado.
 *
 * ```tsx
 * <PageHeader actions={<PeriodControl mode="range" from={from} to={to} defaultRange={{ ...defaults, label: "los últimos 90 días" }} />} />
 * <PageHeader actions={<PeriodControl mode="month" month={periodo} />} />
 * ```
 */
export function PeriodControl(props: PeriodControlProps) {
  if (props.mode === "month") {
    const { mode: _mode, ...rest } = props
    return <MonthPeriodControl {...rest} />
  }
  const { mode: _mode, ...rest } = props
  return <RangePeriodControl {...rest} />
}
