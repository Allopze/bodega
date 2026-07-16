"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

const STATUS_OPTIONS = [
  ["borrador", "Borrador"],
  ["en_revision", "En revisión"],
  ["observado", "Observado"],
  ["aprobado", "Aprobado"],
  ["vigente", "Vigente"],
  ["vencido", "Vencido"],
  ["reemplazado", "Reemplazado"],
  ["archivado", "Archivado"],
] as const

export interface DocumentacionQuery {
  q?: string
  category?: string
  status?: string
  worksiteId?: string
  folder?: string
  page?: string
}

function buildHref(values: Record<string, string>, folder?: string) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value.trim()) params.set(key, value.trim())
  }
  if (folder) params.set("folder", folder)
  const query = params.toString()
  return `/prevencion/documentacion${query ? `?${query}` : ""}`
}

export function DocumentacionFilters({
  query,
  categories,
  worksites,
  total,
  page,
  pageSize,
}: {
  query: DocumentacionQuery
  categories: Array<{ slug: string; name: string }>
  worksites: Array<{ id: string; name: string }>
  total: number
  page: number
  pageSize: number
}) {
  const router = useRouter()
  const [q, setQ] = React.useState(query.q ?? "")
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const hasFilters = Boolean(query.q || query.category || query.status || query.worksiteId)

  React.useEffect(() => setQ(query.q ?? ""), [query.q])

  function navigate(values: Record<string, string>) {
    router.push(buildHref(values, query.folder))
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    navigate({
      q: String(data.get("q") ?? ""),
      category: String(data.get("category") ?? ""),
      status: String(data.get("status") ?? ""),
      worksiteId: String(data.get("worksiteId") ?? ""),
    })
  }

  return (
    <div className="space-y-2 border-y border-(--color-border) py-3">
      <form onSubmit={submit} className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_11rem_10rem_12rem_auto]">
        <label className="relative block">
          <span className="sr-only">Buscar documentos</span>
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-subtle)" />
          <input
            name="q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Buscar por título, código o descripción"
            className="control h-9 w-full pl-9"
          />
        </label>
        <label className="sr-only" htmlFor="document-category">Categoría</label>
        <select id="document-category" name="category" defaultValue={query.category ?? ""} className="control h-9">
          <option value="">Todas las categorías</option>
          {categories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="document-status">Estado</label>
        <select id="document-status" name="status" defaultValue={query.status ?? ""} className="control h-9">
          <option value="">Todos los estados</option>
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="sr-only" htmlFor="document-worksite">Faena</label>
        <select id="document-worksite" name="worksiteId" defaultValue={query.worksiteId ?? ""} className="control h-9">
          <option value="">Todas las faenas</option>
          {worksites.map((worksite) => <option key={worksite.id} value={worksite.id}>{worksite.name}</option>)}
        </select>
        <Button type="submit" size="sm">Aplicar</Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-(--color-text-muted)" aria-live="polite">
        <span>{total} documento{total === 1 ? "" : "s"} encontrado{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          {hasFilters && <Button type="button" size="sm" variant="ghost" onClick={() => navigate({})}>Limpiar filtros</Button>}
          {pageCount > 1 && <>
            <span>Página {page} de {pageCount}</span>
            <Button type="button" size="sm" variant="ghost" disabled={page <= 1} onClick={() => navigate({ q: query.q ?? "", category: query.category ?? "", status: query.status ?? "", worksiteId: query.worksiteId ?? "", page: String(page - 1) })}>Anterior</Button>
            <Button type="button" size="sm" variant="ghost" disabled={page >= pageCount} onClick={() => navigate({ q: query.q ?? "", category: query.category ?? "", status: query.status ?? "", worksiteId: query.worksiteId ?? "", page: String(page + 1) })}>Siguiente</Button>
          </>}
        </div>
      </div>
    </div>
  )
}
