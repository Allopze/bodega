"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { DownloadSimple, MagnifyingGlass, X } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { SavedViews } from "@/components/ui/saved-views"

export interface FilterOption {
  value: string
  label: string
}

interface ListFiltersProps {
  /** Placeholder for the free-text search input. */
  searchPlaceholder?: string
  /** When provided, renders the status (estado) select. */
  statusOptions?: FilterOption[]
  /** When provided, renders the urgency (urgencia) select. */
  urgencyOptions?: FilterOption[]
  /** When provided, renders the worksite (faena) select. */
  worksiteOptions?: FilterOption[]
  /** When provided, renders the supplier (proveedor) select. */
  supplierOptions?: FilterOption[]
  /** When provided, renders an "Exportar Excel" button that respects the
   *  active filters. Value is the export `tipo` (e.g. "solicitudes"). */
  exportTipo?: string
  /** Right-aligned slot for primary actions (e.g. "Nueva"). */
  actions?: React.ReactNode
}

const ALL = "_all"
const DEBOUNCE_MS = 350

function createSelectHandler(setParam: (key: string, value: string) => void, key: string) {
  return (value: string) => setParam(key, value === ALL ? "" : value)
}

/**
 * Todos los parámetros de URL que recortan un listado de Adquisiciones. Es la
 * fuente única de "¿hay filtros activos?": la usan el botón "Limpiar", el
 * indicador de filtros activos y los estados vacíos de las páginas, que antes
 * mantenían su propia lista y se desincronizaban cada vez que aparecía un
 * filtro nuevo sin control propio (`factura`, el período, `solicitud`).
 */
/**
 * Los paginadores que un cambio de filtro devuelve a la primera página.
 * `pendientes` es el de la cola de Compras, que comparte pantalla con el de las
 * OC: sin resetearlo, filtrar con la cola en la página 3 dejaba una lista vacía
 * cuyo filtro sí tenía resultados en la primera.
 */
const PAGE_PARAMS = ["page", "pendientes"] as const

function resetPagination(params: URLSearchParams) {
  for (const key of PAGE_PARAMS) params.delete(key)
}

export const LIST_FILTER_PARAMS = [
  "q", "estado", "urgencia", "faena", "proveedor", "factura", "desde", "hasta", "solicitud",
] as const

/**
 * URL-synced filter bar for the Adquisiciones list screens. Writes `q`,
 * `estado` and `faena` to the URL (resetting `page`) so the server query
 * applies the filters. The free-text input is debounced; selects update
 * immediately.
 */
const ListFiltersInner = React.memo(function ListFiltersInner({
  searchPlaceholder = "Buscar por código...",
  statusOptions,
  urgencyOptions,
  worksiteOptions,
  supplierOptions,
  exportTipo,
  actions,
}: ListFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentQ = searchParams.get("q") ?? ""
  const currentEstado = searchParams.get("estado") ?? ""
  const currentUrgencia = searchParams.get("urgencia") ?? ""
  const currentFaena = searchParams.get("faena") ?? ""
  const currentProveedor = searchParams.get("proveedor") ?? ""
  // `factura=pendiente` (Compras) no se activa desde esta barra sino desde el
  // chip "Sin factura" del header, así que no tiene select propio. Sin contarlo
  // aquí, la lista quedaba filtrada sin ningún control en pantalla que lo dijera
  // ni lo apagara: "Limpiar" ni siquiera aparecía.
  const currentFactura = searchParams.get("factura") ?? ""
  // Período [desde, hasta): llega desde un KPI del dashboard (p.ej. "Inversión
  // · mes") como URL, no desde un select de la barra. Mismo tratamiento que
  // `factura`: chip removible para que se lea y se pueda quitar.
  const currentDesde = searchParams.get("desde") ?? ""
  const currentHasta = searchParams.get("hasta") ?? ""
  // `solicitud=<id>` (Aprobaciones) llega desde el CTA de /pendientes y acota la
  // cola a una sola solicitud. Sin chip ni "Limpiar" que lo tocara, aprobar ese
  // ítem dejaba la pantalla vacía diciendo "Bien hecho" con el resto de la cola
  // escondida detrás de un parámetro que nada mostraba.
  const currentSolicitud = searchParams.get("solicitud") ?? ""

  const [q, setQ] = React.useState(currentQ)

  // Keep local input in sync if the URL changes externally (e.g. "Limpiar").
  // Adjusting during render (rather than in an effect) means React re-runs this
  // component before committing, so the stale query never reaches the screen.
  const [lastSyncedQ, setLastSyncedQ] = React.useState(currentQ)
  if (lastSyncedQ !== currentQ) {
    setLastSyncedQ(currentQ)
    setQ(currentQ)
  }

  const setParam = React.useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      if (value) params.set(key, value)
      else params.delete(key)
      resetPagination(params) // any filter change returns to the first page
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const withoutFacturaHref = React.useMemo(() => {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    params.delete("factura")
    resetPagination(params)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname, searchParams])

  const withoutSolicitudHref = React.useMemo(() => {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    params.delete("solicitud")
    resetPagination(params)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname, searchParams])

  const withoutPeriodHref = React.useMemo(() => {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    params.delete("desde")
    params.delete("hasta")
    resetPagination(params)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname, searchParams])

  // Debounce the free-text query into the URL.
  const onDebouncedQChange = React.useEffectEvent((value: string) => {
    setParam("q", value.trim())
  })

  React.useEffect(() => {
    if (q === currentQ) return
    const id = setTimeout(() => onDebouncedQChange(q), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [q, currentQ])

  const handleEstadoChange = React.useMemo(() => createSelectHandler(setParam, "estado"), [setParam])
  const handleUrgenciaChange = React.useMemo(() => createSelectHandler(setParam, "urgencia"), [setParam])
  const handleFaenaChange = React.useMemo(() => createSelectHandler(setParam, "faena"), [setParam])
  const handleProveedorChange = React.useMemo(() => createSelectHandler(setParam, "proveedor"), [setParam])

  const hasActiveFilters = LIST_FILTER_PARAMS.some((key) => searchParams.get(key))

  // Export URL respects the active filters (estado→status, q/faena/proveedor passthrough).
  // Note: the URL param is "estado" for page-level filtering but "status" for the export
  // API — the export endpoint uses its own parameter naming convention.
  const exportHref = React.useMemo(() => {
    if (!exportTipo) return null
    const params = new URLSearchParams({ tipo: exportTipo })
    if (currentQ) params.set("q", currentQ)
    if (currentEstado) params.set("status", currentEstado)
    if (currentFaena) params.set("faena", currentFaena)
    if (currentProveedor) params.set("proveedor", currentProveedor)
    return `/api/reportes/export?${params.toString()}`
  }, [exportTipo, currentQ, currentEstado, currentFaena, currentProveedor])

  function clearAll() {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    for (const key of LIST_FILTER_PARAMS) params.delete(key)
    resetPagination(params)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex w-full items-center sm:w-auto">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute left-2.5 shrink-0 text-[var(--color-text-subtle)]"
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Buscar"
            className="h-11 sm:h-8 w-full sm:w-64 pl-8 text-xs"
          />
        </div>

        {statusOptions && statusOptions.length > 0 && (
          <Select
            value={currentEstado || ALL}
            onValueChange={handleEstadoChange}
          >
            <SelectTrigger className="h-11 sm:h-8 w-full sm:w-auto sm:min-w-[10rem] text-xs" aria-label="Filtrar por estado">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {urgencyOptions && urgencyOptions.length > 0 && (
          <Select
            value={currentUrgencia || ALL}
            onValueChange={handleUrgenciaChange}
          >
            <SelectTrigger className="h-11 sm:h-8 w-full sm:w-auto sm:min-w-[9rem] text-xs" aria-label="Filtrar por urgencia">
              <SelectValue placeholder="Toda urgencia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Toda urgencia</SelectItem>
              {urgencyOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {worksiteOptions && worksiteOptions.length > 0 && (
          <Select
            value={currentFaena || ALL}
            onValueChange={handleFaenaChange}
          >
            <SelectTrigger className="h-11 sm:h-8 w-full sm:w-auto sm:min-w-[10rem] text-xs" aria-label="Filtrar por faena">
              <SelectValue placeholder="Todas las faenas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las faenas</SelectItem>
              {worksiteOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {supplierOptions && supplierOptions.length > 0 && (
          <Select
            value={currentProveedor || ALL}
            onValueChange={handleProveedorChange}
          >
            <SelectTrigger className="h-11 sm:h-8 w-full sm:w-auto sm:min-w-[10rem] text-xs" aria-label="Filtrar por proveedor">
              <SelectValue placeholder="Todos los proveedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los proveedores</SelectItem>
              {supplierOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* A2: chip removible del único filtro sin select propio, para que se lea
            qué está recortando la lista y se pueda quitar sin borrar el resto. */}
        {currentFactura === "pendiente" && (
          // Enlace y no botón: `setParam` navega con `router.replace`, así que
          // antes de que el componente hidrate el clic no hacía nada y la lista
          // seguía recortada sin que el usuario supiera por qué. Un href real
          // funciona desde el primer pintado, y además permite abrirlo con el
          // teclado o en otra pestaña como cualquier otro enlace.
          <Link
            href={withoutFacturaHref}
            scroll={false}
            className="inline-flex h-11 items-center gap-1 rounded-full bg-signal-tint px-2.5 text-xs font-medium text-signal-ink transition-colors hover:bg-[var(--color-signal-line)] sm:h-8"
          >
            Sólo sin factura
            <X size={12} weight="bold" aria-hidden />
            <span className="sr-only">Quitar filtro de facturas pendientes</span>
          </Link>
        )}

        {currentSolicitud && (
          <Link
            href={withoutSolicitudHref}
            scroll={false}
            className="inline-flex h-11 items-center gap-1 rounded-full bg-signal-tint px-2.5 text-xs font-medium text-signal-ink transition-colors hover:bg-[var(--color-signal-line)] sm:h-8"
          >
            Sólo una solicitud
            <X size={12} weight="bold" aria-hidden />
            <span className="sr-only">Ver toda la cola, no sólo esta solicitud</span>
          </Link>
        )}

        {/* A2: el período llega desde un KPI del dashboard y no tiene select;
            chip removible con el mismo patrón que `factura`. */}
        {(currentDesde || currentHasta) && (
          <Link
            href={withoutPeriodHref}
            scroll={false}
            className="inline-flex h-11 items-center gap-1 rounded-full bg-[var(--color-info-tint)] px-2.5 text-xs font-medium text-[var(--color-info-ink)] transition-colors hover:bg-[var(--color-info-line)] sm:h-8"
          >
            Período {currentDesde || "…"} → {currentHasta || "…"}
            <X size={12} weight="bold" aria-hidden />
            <span className="sr-only">Quitar filtro de período</span>
          </Link>
        )}

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="gap-1 text-[var(--color-text-muted)]"
          >
            <X size={12} weight="bold" aria-hidden />
            Limpiar
          </Button>
        )}

        {/* E-2: scopeKey = pathname. Estas rutas son listados sin segmento
            dinámico (/compras, /solicitudes, ...), así que el pathname ya es
            un identificador estable por pantalla — no hace falta una prop
            nueva que cada llamador tendría que declarar. */}
        <SavedViews scopeKey={pathname} />
      </div>

      {(exportHref || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {exportHref && (
            <a
              href={exportHref}
              download
              className="inline-flex h-11 sm:h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text)] shadow-[var(--shadow-xs)] transition-colors hover:bg-[var(--color-surface-2)] hover:border-[var(--color-border-control-hover)]"
            >
              <DownloadSimple size={13} />
              Exportar Excel
            </a>
          )}
          {actions}
        </div>
      )}
    </div>
  )
})

export const ListFilters = ListFiltersInner
