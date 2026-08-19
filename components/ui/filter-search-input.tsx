"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"

export interface FilterSearchInputProps {
  /** Parámetro de URL que escribe. */
  param?: string
  placeholder?: string
  ariaLabel?: string
  /** Parámetros de paginación que se borran al cambiar la búsqueda. */
  pageKeys?: string[]
  debounceMs?: number
  className?: string
}

/**
 * Input de búsqueda sincronizado con la URL, con rebote.
 *
 * Existe porque el buscador del `TopBar` filtra en memoria **la página que el
 * servidor ya mandó**: una coincidencia que vive en la página 3 no aparece
 * nunca, y "no lo encuentro" se vuelve indistinguible de "no existe". Las
 * pantallas que consultan con `textSearchSql` usan este input y se registran en
 * `ROUTES_WITH_OWN_SEARCH` para no mostrar dos buscadores con semánticas
 * distintas.
 */
export function FilterSearchInput({
  param = "q",
  placeholder = "Buscar...",
  ariaLabel = "Buscar",
  pageKeys = ["page"],
  debounceMs = 350,
  className = "h-11 sm:h-8 w-full sm:w-64 pl-8 text-xs",
}: FilterSearchInputProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = searchParams.get(param) ?? ""

  const [value, setValue] = React.useState(current)
  // Sincroniza durante el render y no en un efecto: React vuelve a correr el
  // componente antes de pintar, así que el valor viejo nunca llega a pantalla
  // cuando la URL cambia por fuera (p. ej. al pulsar "Limpiar").
  const [lastSynced, setLastSynced] = React.useState(current)
  if (lastSynced !== current) {
    setLastSynced(current)
    setValue(current)
  }

  // Como cadena y no como array: el padre construye una lista nueva en cada
  // render y usarla de dependencia reiniciaría el temporizador a cada rato.
  const pageKeysKey = pageKeys.join(",")

  React.useEffect(() => {
    if (value === current) return
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      if (value) params.set(param, value)
      else params.delete(param)
      for (const key of pageKeysKey.split(",").filter(Boolean)) params.delete(key)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [value, current, param, pageKeysKey, debounceMs, router, pathname, searchParams])

  return (
    <div className="relative flex w-full items-center sm:w-auto">
      <MagnifyingGlass
        size={14}
        aria-hidden
        className="pointer-events-none absolute left-2.5 shrink-0 text-[var(--color-text-subtle)]"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={className}
      />
    </div>
  )
}
