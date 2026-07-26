"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { nanoid } from "@/lib/id"

/**
 * E-2 · Vistas guardadas de filtros.
 *
 * Persistidas en `localStorage`, por navegador/dispositivo — no por usuario en
 * BD ni compartibles entre personas. Es la mitad barata del valor (que cada
 * operador recupere *su* combinación diaria de filtros) sin migración de
 * esquema; si en el futuro se pide compartir vistas entre personas, eso sí
 * requiere una tabla y queda fuera de este alcance.
 *
 * Guarda la URL completa (querystring), no los valores de filtro por separado:
 * cada página ya sincroniza sus filtros con la URL (`ListFilters`), así que
 * "la vista" simplemente ES esa URL. Aplicar una vista es navegar a ella.
 */

export interface SavedView {
  id:        string
  name:      string
  /** Incluye el "?" inicial, o cadena vacía si no hay filtros activos. */
  search:    string
  createdAt: string
}

const EVENT_PREFIX = "saved-views-change:"
const MAX_VIEWS_PER_SCOPE = 20

function storageKey(scopeKey: string) {
  return `saved-views:${scopeKey}`
}

// useSyncExternalStore exige que getSnapshot devuelva la MISMA referencia
// mientras el dato no cambie — si no, el compare `Object.is` de cada render
// falla, React vuelve a suscribirse, y entra en bucle infinito (lo disparó
// el propio test: "Maximum update depth exceeded"). Cachear por scope el
// último JSON crudo + su array ya parseado evita crear un array nuevo en
// cada lectura cuando el contenido no cambió.
const snapshotCache = new Map<string, { raw: string | null; views: SavedView[] }>()
const EMPTY: SavedView[] = []

function readViews(scopeKey: string): SavedView[] {
  if (typeof window === "undefined") return EMPTY
  const raw = localStorage.getItem(storageKey(scopeKey))
  const cached = snapshotCache.get(scopeKey)
  if (cached && cached.raw === raw) return cached.views

  let views: SavedView[] = EMPTY
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) views = parsed
    } catch {
      // localStorage corrupto: degradar a "sin vistas" en vez de romper la
      // página que las consume.
      views = EMPTY
    }
  }
  snapshotCache.set(scopeKey, { raw, views })
  return views
}

function writeViews(scopeKey: string, views: SavedView[]) {
  localStorage.setItem(storageKey(scopeKey), JSON.stringify(views))
  window.dispatchEvent(new Event(`${EVENT_PREFIX}${scopeKey}`))
}

function subscribe(scopeKey: string, onChange: () => void) {
  function handler(event: StorageEvent) {
    if (event.key === null || event.key === storageKey(scopeKey)) onChange()
  }
  window.addEventListener("storage", handler)
  window.addEventListener(`${EVENT_PREFIX}${scopeKey}`, onChange)
  return () => {
    window.removeEventListener("storage", handler)
    window.removeEventListener(`${EVENT_PREFIX}${scopeKey}`, onChange)
  }
}

/**
 * @param scopeKey Identificador estable del listado (p. ej. `"compras"`,
 *   `"solicitudes"`). Vistas de scopes distintos nunca se mezclan.
 */
export function useSavedViews(scopeKey: string) {
  const router = useRouter()
  const pathname = usePathname()

  const views = React.useSyncExternalStore(
    (onChange) => subscribe(scopeKey, onChange),
    () => readViews(scopeKey),
    () => [] as SavedView[],
  )

  const saveCurrent = React.useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const current = readViews(scopeKey)
    const view: SavedView = {
      id: nanoid(10),
      name: trimmed,
      search: typeof window !== "undefined" ? window.location.search : "",
      createdAt: new Date().toISOString(),
    }
    // FIFO: si se llega al tope, la vista más antigua cede el lugar a la
    // nueva en vez de bloquear silenciosamente el guardado.
    const next = [...current, view].slice(-MAX_VIEWS_PER_SCOPE)
    writeViews(scopeKey, next)
  }, [scopeKey])

  const remove = React.useCallback((id: string) => {
    writeViews(scopeKey, readViews(scopeKey).filter((v) => v.id !== id))
  }, [scopeKey])

  const apply = React.useCallback((view: SavedView) => {
    router.replace(view.search ? `${pathname}${view.search}` : pathname, { scroll: false })
  }, [router, pathname])

  return { views, saveCurrent, remove, apply }
}
