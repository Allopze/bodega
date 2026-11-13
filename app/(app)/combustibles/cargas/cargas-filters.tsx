"use client"

import * as React from "react"
import { CaretDown } from "@phosphor-icons/react"
import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import {
  FUEL_LOAD_ORIGIN_LABEL,
  FUEL_LOAD_ORIGIN_SLUGS,
  FUEL_LOAD_STATE_LABEL,
  FUEL_LOAD_STATE_SLUGS,
  parseFuelLoadOrigins,
  parseFuelLoadState,
  type FuelLoadOriginSlug,
} from "@/lib/combustibles/fuel-log-shared"
import { CARGAS_ADVANCED_FILTER_KEYS } from "@/lib/combustibles/fuel-log-params"
import { ANOMALY_RULE_SEVERITIES, ANOMALY_RULE_SEVERITY_LABELS, FUEL_VEHICLE_STATUSES, FUEL_VEHICLE_STATUS_LABELS } from "@/lib/combustibles/validation"

const ALL = "_all"
const PAGE_KEYS = ["pagina", "page"]

/**
 * El estado en UN solo control (A5). Además de los estados de la carga, el select ofrece los tres
 * «pendientes» que antes eran casillas aparte (`pendiente=si`, `anomalia=si`, `revision=si`). Las
 * URL antiguas siguen valiendo: el servidor lee los mismos parámetros y aquí sólo se decide cuál
 * de ellos muestra el select (el primero que esté puesto).
 */
const PENDING_STATE_OPTIONS = [
  { value: "con-algo-pendiente", label: "Con algo pendiente", param: "pendiente" },
  { value: "con-caso-abierto", label: "Con un caso abierto", param: "anomalia" },
  { value: "con-pedido-abierto", label: "Con un pedido de revisión abierto", param: "revision" },
] as const

/**
 * Lo que busca el cuadro de búsqueda (`fuel-log.ts`): código de equipo, patente y, en las
 * facturas, el proveedor; conductor y supervisor sólo con `combustibles:view_personal`. El
 * rótulo dice lo mismo que la consulta, sin ofrecer buscar personas a quien no puede.
 */
const SEARCH_LABEL = "Buscar equipo, patente o proveedor"
const SEARCH_LABEL_WITH_PERSONAL = "Buscar equipo, patente, proveedor o persona"

export interface CargasFilterOption {
  value: string
  label: string
}

export interface CargasFilterLookups {
  worksites: CargasFilterOption[]
  suppliers: CargasFilterOption[]
  products: CargasFilterOption[]
  equipmentTypes: CargasFilterOption[]
  loadingPoints: CargasFilterOption[]
  anomalyRules: CargasFilterOption[]
  anomalyAssignees: CargasFilterOption[]
  /** Rótulo del equipo del filtro `equipo` (la URL trae su id). */
  equipmentLabel: string | null
}

const EVIDENCE_KIND_OPTIONS: CargasFilterOption[] = [
  { value: "odometer", label: "Foto del odómetro o horómetro" },
  { value: "liter_meter", label: "Foto del medidor de litros" },
  { value: "removed_seal", label: "Foto del sello retirado" },
  { value: "installed_seal", label: "Foto del sello nuevo" },
]

const PERFORMANCE_UNIT_OPTIONS: CargasFilterOption[] = [
  { value: "km_per_liter", label: "km/L (con odómetro)" },
  { value: "liters_per_hour", label: "L/h (con horómetro)" },
]

function SelectFilter({ value, onValue, allLabel, ariaLabel, options, className }: {
  value: string
  onValue: (next: string) => void
  allLabel: string
  ariaLabel: string
  options: CargasFilterOption[]
  className?: string
}) {
  return (
    <Select value={value || ALL} onValueChange={onValue}>
      <SelectTrigger className={className ?? "h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]"} aria-label={ariaLabel}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** Un texto libre que se aplica a la URL cuando la persona deja de escribir. */
function TextParamInput({ param, ariaLabel, placeholder }: { param: string; ariaLabel: string; placeholder: string }) {
  const { searchParams, setFilter } = useUrlFilters({ resetPageKeys: PAGE_KEYS })
  const current = searchParams.get(param) ?? ""
  const [value, setValue] = React.useState(current)
  const [lastSynced, setLastSynced] = React.useState(current)
  if (lastSynced !== current) {
    setLastSynced(current)
    setValue(current)
  }
  React.useEffect(() => {
    if (value.trim() === current) return
    const timer = window.setTimeout(() => setFilter(param, value.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [value, current, param, setFilter])
  return <Input value={value} onChange={(event) => setValue(event.target.value)} aria-label={ariaLabel} placeholder={placeholder} className="h-11 text-xs sm:h-8" />
}

function CheckboxParam({ param, label }: { param: string; label: string }) {
  const { searchParams, setFilter } = useUrlFilters({ resetPageKeys: PAGE_KEYS })
  // `sello` y `evidencia` conservan el valor `faltante` de la lista de registros en terreno de antes.
  const on = param === "sello" || param === "evidencia" ? "faltante" : "si"
  const checked = searchParams.get(param) === on
  return <Checkbox id={`cargas-${param}`} label={label} checked={checked} onChange={(event) => setFilter(param, event.target.checked ? on : null)} />
}

/** «Cómo llegó»: varios orígenes a la vez (`como=qr,app`). */
function OriginFilter({ selected, onChange }: { selected: FuelLoadOriginSlug[]; onChange: (next: FuelLoadOriginSlug[]) => void }) {
  const summary = selected.length === 0 ? "Cómo llegó: todas" : selected.length === 1 ? FUEL_LOAD_ORIGIN_LABEL[selected[0]!] : `Cómo llegó (${selected.length})`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className="h-11 w-full justify-between text-xs sm:h-8 sm:w-auto sm:min-w-[11rem]" aria-label="Filtrar por cómo llegó la carga">
          <span className="truncate">{summary}</span>
          <CaretDown size={12} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <p className="mb-2 text-eyebrow">Cómo llegó</p>
        <div className="space-y-1.5">
          {FUEL_LOAD_ORIGIN_SLUGS.map((slug) => (
            <Checkbox
              key={slug}
              id={`cargas-como-${slug}`}
              label={FUEL_LOAD_ORIGIN_LABEL[slug]}
              checked={selected.includes(slug)}
              onChange={(event) => onChange(FUEL_LOAD_ORIGIN_SLUGS.filter((item) => (item === slug ? event.target.checked : selected.includes(item))))}
            />
          ))}
        </div>
        {selected.length > 0 && <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => onChange([])}>Quitar este filtro</Button>}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Filtros de «Cargas a equipos». El período vive en la cabecera; aquí van los de
 * uso diario (buscar, faena, cómo llegó, estado —incluidos los «con algo pendiente»,
 * «con un caso abierto» y «con un pedido de revisión abierto»—) y, en «Más filtros (N)», el resto. Cada filtro activo tiene su chip. Se aplican al
 * instante: la URL cambia con `router.replace` sin saltar el scroll.
 */
export function CargasFilters({ lookups, canViewPersonal }: { lookups: CargasFilterLookups; canViewPersonal: boolean }) {
  useWorksiteFilterPresence(lookups.worksites.length > 0)
  const { searchParams, setFilter, setFilters, isPending } = useUrlFilters({ resetPageKeys: PAGE_KEYS })
  const get = (key: string) => searchParams.get(key) ?? ""

  const origins = parseFuelLoadOrigins(get("como"))
  const stateSlug = parseFuelLoadState(get("estado"))
  const pendingOnly = get("pendiente") === "si"
  // Qué muestra el control de estado: un estado de la carga o, si no hay, el primer «pendiente» puesto en la URL.
  const pendingState = PENDING_STATE_OPTIONS.find((option) => get(option.param) === "si")
  const stateValue = stateSlug ?? pendingState?.value ?? ""
  function changeState(next: string) {
    const pending = PENDING_STATE_OPTIONS.find((option) => option.value === next)
    setFilters({
      estado: pending || next === ALL ? null : next,
      ...Object.fromEntries(PENDING_STATE_OPTIONS.map((option) => [option.param, option === pending ? "si" : null])),
    })
  }
  const searchLabel = canViewPersonal ? SEARCH_LABEL_WITH_PERSONAL : SEARCH_LABEL

  // `anomalia` y `revision` son opciones del control de estado, no de «Más filtros»: no suman a su contador.
  const inStateControl = new Set<string>(PENDING_STATE_OPTIONS.map((option) => option.param))
  const advancedKeys = CARGAS_ADVANCED_FILTER_KEYS.filter((key) => (canViewPersonal || (key !== "conductor" && key !== "supervisor")) && !inStateControl.has(key))
  const advancedActive = advancedKeys.filter((key) => Boolean(get(key)))

  const label = (options: CargasFilterOption[], value: string) => options.find((option) => option.value === value)?.label ?? value

  const chips: ActiveFilterChip[] = []
  const addChip = (key: string, chipLabel: string, value: string) => { if (value) chips.push({ key, label: chipLabel, value, displayValue: value }) }
  if (get("faena")) addChip("faena", "Faena", label(lookups.worksites, get("faena")))
  if (origins.length > 0) addChip("como", "Cómo llegó", origins.map((slug) => FUEL_LOAD_ORIGIN_LABEL[slug]).join(", "))
  if (stateSlug) addChip("estado", "Estado", FUEL_LOAD_STATE_LABEL[stateSlug])
  if (pendingOnly) addChip("pendiente", "Estado", "Con algo pendiente")
  if (get("equipo")) addChip("equipo", "Equipo", lookups.equipmentLabel ?? "Equipo elegido")
  if (get("tipo")) addChip("tipo", "Tipo de equipo", label(lookups.equipmentTypes, get("tipo")))
  if (get("marca")) addChip("marca", "Marca", get("marca"))
  if (get("modelo")) addChip("modelo", "Modelo", get("modelo"))
  if (get("estado_operativo")) addChip("estado_operativo", "Estado del equipo", FUEL_VEHICLE_STATUS_LABELS[get("estado_operativo") as keyof typeof FUEL_VEHICLE_STATUS_LABELS] ?? get("estado_operativo"))
  if (get("unidad_rendimiento")) addChip("unidad_rendimiento", "Rendimiento", label(PERFORMANCE_UNIT_OPTIONS, get("unidad_rendimiento")))
  if (canViewPersonal && get("conductor")) addChip("conductor", "Conductor", get("conductor"))
  if (canViewPersonal && get("supervisor")) addChip("supervisor", "Supervisor", get("supervisor"))
  if (get("sello_retirado")) addChip("sello_retirado", "Sello retirado", get("sello_retirado"))
  if (get("sello_instalado")) addChip("sello_instalado", "Sello nuevo", get("sello_instalado"))
  if (get("sello") === "faltante") addChip("sello", "Sellos", "Sello incompleto")
  if (get("evidencia") === "faltante") addChip("evidencia", "Fotos", "Menos de 4 fotos")
  if (get("evidencia_tipo")) addChip("evidencia_tipo", "Con", label(EVIDENCE_KIND_OPTIONS, get("evidencia_tipo")))
  if (get("proveedor")) addChip("proveedor", "Proveedor", label(lookups.suppliers, get("proveedor")))
  if (get("producto")) addChip("producto", "Combustible", label(lookups.products, get("producto")))
  if (get("punto_carga") || get("punto")) addChip(get("punto_carga") ? "punto_carga" : "punto", "Punto de carga", label(lookups.loadingPoints, get("punto_carga") || get("punto")))
  if (get("mias") === "si") addChip("mias", "Registradas", "Registradas por mí")
  if (get("observaciones") === "si") addChip("observaciones", "Observaciones", "Sólo con observaciones")
  if (get("anomalia") === "si") addChip("anomalia", "Estado", "Con un caso abierto")
  if (get("anomalia_tipo")) addChip("anomalia_tipo", "Tipo de caso", label(lookups.anomalyRules, get("anomalia_tipo")))
  if (get("anomalia_severidad")) addChip("anomalia_severidad", "Gravedad", ANOMALY_RULE_SEVERITY_LABELS[get("anomalia_severidad") as keyof typeof ANOMALY_RULE_SEVERITY_LABELS] ?? get("anomalia_severidad"))
  if (get("anomalia_responsable")) addChip("anomalia_responsable", "Responsable", label(lookups.anomalyAssignees, get("anomalia_responsable")))
  if (get("revision") === "si") addChip("revision", "Estado", "Con un pedido de revisión abierto")

  // El conteo de «Más filtros» incluye el alias antiguo `punto` (que se lee como `punto_carga`).
  const advancedCount = advancedActive.length + (get("punto") && !get("punto_carga") ? 1 : 0)

  function clearAll() {
    setFilters(Object.fromEntries(["q", "faena", "como", "estado", "pendiente", "equipo", "punto", ...CARGAS_ADVANCED_FILTER_KEYS].map((key) => [key, null])))
  }

  const overflowFilters = (
    <div className="flex flex-col gap-5 py-2">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-eyebrow">Orden</legend>
        <SelectFilter
          value={get("orden") === "asc" ? "asc" : ""}
          onValue={(next) => setFilter("orden", next === ALL ? null : next)}
          allLabel="Más reciente primero"
          ariaLabel="Ordenar por fecha"
          options={[{ value: "asc", label: "Más antigua primero" }]}
          className="h-11 w-full text-xs sm:h-9"
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-eyebrow">Equipo</legend>
        <SelectFilter value={get("tipo")} onValue={(next) => setFilter("tipo", next)} allLabel="Cualquier tipo de equipo" ariaLabel="Filtrar por tipo de equipo" options={lookups.equipmentTypes} className="h-11 w-full text-xs sm:h-9" />
        <TextParamInput param="marca" ariaLabel="Marca del equipo" placeholder="Marca del equipo" />
        <TextParamInput param="modelo" ariaLabel="Modelo del equipo" placeholder="Modelo del equipo" />
        <SelectFilter value={get("estado_operativo")} onValue={(next) => setFilter("estado_operativo", next)} allLabel="Cualquier estado del equipo" ariaLabel="Filtrar por estado del equipo" options={FUEL_VEHICLE_STATUSES.map((status) => ({ value: status, label: FUEL_VEHICLE_STATUS_LABELS[status] }))} className="h-11 w-full text-xs sm:h-9" />
        <SelectFilter value={get("unidad_rendimiento")} onValue={(next) => setFilter("unidad_rendimiento", next)} allLabel="Km/L y L/h" ariaLabel="Filtrar por tipo de rendimiento" options={PERFORMANCE_UNIT_OPTIONS} className="h-11 w-full text-xs sm:h-9" />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-eyebrow">Personas</legend>
        {canViewPersonal ? (
          <>
            <TextParamInput param="conductor" ariaLabel="Nombre del conductor" placeholder="Conductor" />
            <TextParamInput param="supervisor" ariaLabel="Nombre del supervisor" placeholder="Supervisor" />
          </>
        ) : (
          <p className="text-xs text-[var(--color-text-subtle)]">Filtrar por personas requiere el permiso de datos personales.</p>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-eyebrow">Sellos y fotos</legend>
        <TextParamInput param="sello_retirado" ariaLabel="N.º de sello retirado" placeholder="N.º de sello retirado" />
        <TextParamInput param="sello_instalado" ariaLabel="N.º de sello nuevo" placeholder="N.º de sello nuevo" />
        <CheckboxParam param="sello" label="Sello incompleto" />
        <CheckboxParam param="evidencia" label="Le faltan fotos (menos de 4)" />
        <SelectFilter value={get("evidencia_tipo")} onValue={(next) => setFilter("evidencia_tipo", next)} allLabel="Con cualquier foto" ariaLabel="Filtrar por tipo de foto" options={EVIDENCE_KIND_OPTIONS} className="h-11 w-full text-xs sm:h-9" />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-eyebrow">Origen y casos</legend>
        <SelectFilter value={get("proveedor")} onValue={(next) => setFilter("proveedor", next)} allLabel="Cualquier proveedor" ariaLabel="Filtrar por proveedor" options={lookups.suppliers} className="h-11 w-full text-xs sm:h-9" />
        <SelectFilter value={get("producto")} onValue={(next) => setFilter("producto", next)} allLabel="Cualquier combustible" ariaLabel="Filtrar por combustible" options={lookups.products} className="h-11 w-full text-xs sm:h-9" />
        <SelectFilter value={get("punto_carga") || get("punto")} onValue={(next) => setFilters({ punto_carga: next === ALL ? null : next, punto: null })} allLabel="Cualquier punto de carga" ariaLabel="Filtrar por punto de carga" options={lookups.loadingPoints} className="h-11 w-full text-xs sm:h-9" />
        <CheckboxParam param="mias" label="Sólo las que registré yo" />
        <CheckboxParam param="observaciones" label="Sólo con observaciones" />
        <SelectFilter value={get("anomalia_tipo")} onValue={(next) => setFilter("anomalia_tipo", next)} allLabel="Cualquier tipo de caso" ariaLabel="Filtrar por tipo de caso" options={lookups.anomalyRules} className="h-11 w-full text-xs sm:h-9" />
        <SelectFilter value={get("anomalia_severidad")} onValue={(next) => setFilter("anomalia_severidad", next)} allLabel="Cualquier gravedad" ariaLabel="Filtrar por gravedad del caso" options={ANOMALY_RULE_SEVERITIES.map((item) => ({ value: item, label: ANOMALY_RULE_SEVERITY_LABELS[item] }))} className="h-11 w-full text-xs sm:h-9" />
        <SelectFilter value={get("anomalia_responsable")} onValue={(next) => setFilter("anomalia_responsable", next)} allLabel="Cualquier responsable" ariaLabel="Filtrar por responsable del caso" options={lookups.anomalyAssignees} className="h-11 w-full text-xs sm:h-9" />
      </fieldset>
    </div>
  )

  return (
    <div aria-busy={isPending}>
      <FilterToolbar
        hasActiveFilters={chips.length > 0 || Boolean(get("q"))}
        activeChips={chips}
        onRemoveChip={(key) => setFilter(key, null)}
        onClearAll={clearAll}
        activeCount={advancedCount}
        overflowFilters={overflowFilters}
        overflowTitle="Más filtros"
        overflowDescription="Equipo, personas, sellos y fotos, y casos. Cada filtro activo aparece como un chip bajo la barra."
      >
        {/* `sm:w-80` y no `sm:w-64`: con «… o persona…» el placeholder mide ~240 px a 12 px y en 256 px de campo sólo caben ~212. */}
        <FilterSearchInput
          param="q"
          placeholder={`${searchLabel}…`}
          ariaLabel={searchLabel}
          pageKeys={PAGE_KEYS}
          className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-80"
        />
        <SelectFilter value={get("faena")} onValue={(next) => setFilter("faena", next)} allLabel="Todas tus faenas" ariaLabel="Filtrar por faena" options={lookups.worksites} />
        <OriginFilter selected={origins} onChange={(next) => setFilter("como", next.length > 0 ? next.join(",") : null)} />
        <SelectFilter
          value={stateValue}
          onValue={changeState}
          allLabel="Cualquier estado"
          ariaLabel="Filtrar por estado"
          options={[
            ...(Object.keys(FUEL_LOAD_STATE_SLUGS) as Array<keyof typeof FUEL_LOAD_STATE_SLUGS>).map((slug) => ({ value: slug, label: FUEL_LOAD_STATE_LABEL[slug] })),
            ...PENDING_STATE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
          ]}
        />
      </FilterToolbar>
    </div>
  )
}
