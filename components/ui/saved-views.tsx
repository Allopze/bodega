"use client"

import * as React from "react"
import { BookmarkSimple, Trash, FloppyDisk } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { useSavedViews } from "@/lib/hooks/use-saved-views"
import { cn } from "@/lib/utils"

/**
 * E-2 · Botón "Vistas" para `ListFilters`/`FilterToolbar`: guarda la URL
 * actual (con sus filtros) bajo un nombre y permite volver a ella con un
 * clic. Persistido en `localStorage` por `scopeKey` — ver `useSavedViews`.
 */
export function SavedViews({ scopeKey, className }: { scopeKey: string; className?: string }) {
  const { views, saveCurrent, remove, apply } = useSavedViews(scopeKey)
  const [open, setOpen] = React.useState(false)
  const [naming, setNaming] = React.useState(false)
  const [name, setName] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  function startNaming() {
    setName("")
    setNaming(true)
    // El popover ya está abierto (startNaming sólo se llama desde su
    // contenido); el foco espera al próximo tick a que el input exista.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function confirmSave(e: React.FormEvent) {
    e.preventDefault()
    saveCurrent(name)
    setNaming(false)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setNaming(false) }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className={cn("relative", className)}>
          <BookmarkSimple size={14} />
          Vistas
          {views.length > 0 && (
            <span className="ml-1 rounded-full bg-[var(--color-surface-2)] px-1.5 font-mono text-[10px] tabular-nums">
              {views.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        {naming ? (
          <form onSubmit={confirmSave} className="flex flex-col gap-2">
            <label htmlFor={`saved-view-name-${scopeKey}`} className="text-xs font-medium text-[var(--color-text-muted)]">
              Nombre de la vista
            </label>
            <Input
              ref={inputRef}
              id={`saved-view-name-${scopeKey}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Pendientes Faena Mininco"
              maxLength={60}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(false)}>Cancelar</Button>
              <Button type="submit" size="sm" disabled={!name.trim()}>Guardar</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-eyebrow">Vistas guardadas</span>
              <Button type="button" variant="ghost" size="sm" onClick={startNaming} className="gap-1 text-xs">
                <FloppyDisk size={13} />
                Guardar actual
              </Button>
            </div>
            {views.length === 0 ? (
              <p className="px-1 py-2 text-xs text-[var(--color-text-subtle)]">
                Sin vistas guardadas todavía. Ajusta los filtros y usa &quot;Guardar actual&quot;.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {views.map((v) => (
                  <li key={v.id} className="group flex items-center gap-1 rounded-(--radius) px-1">
                    <button
                      type="button"
                      onClick={() => { apply(v); setOpen(false) }}
                      className="flex-1 truncate rounded-(--radius) px-1.5 py-1.5 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                      title={v.name}
                    >
                      {v.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(v.id)}
                      aria-label={`Eliminar vista ${v.name}`}
                      className="shrink-0 rounded-(--radius) p-1.5 text-[var(--color-text-subtle)] opacity-0 hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)] group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
