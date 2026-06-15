"use client"

import * as React from "react"
import { DownloadSimple, Funnel } from "@phosphor-icons/react/dist/ssr"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface WorksiteOption {
  id: string
  name: string
}

interface ExportDialogProps {
  tipo: string
  label: string
  worksites: WorksiteOption[]
  statuses: { value: string; label: string }[]
  tone?: "neutral" | "signal"
}

export function ExportDialog({ tipo, label, worksites, statuses, tone = "neutral" }: ExportDialogProps) {
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [faena, setFaena] = React.useState("")
  const [status, setStatus] = React.useState("")

  function buildUrl() {
    const params = new URLSearchParams({ tipo })
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    if (faena) params.set("faena", faena)
    if (status) params.set("status", status)
    return `/api/reportes/export?${params.toString()}`
  }

  const baseClass = tone === "signal"
    ? "border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)] hover:opacity-80"
    : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-full)] border px-3 text-xs font-medium transition-colors ${baseClass}`}
        >
          <DownloadSimple size={13} />
          Exportar {label}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar {label}</DialogTitle>
          <DialogDescription>
            Aplica filtros para reducir el volumen de datos exportados.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`from-${tipo}`} className="text-xs font-medium text-[var(--color-text-subtle)]">
                Desde
              </label>
              <input
                id={`from-${tipo}`}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`to-${tipo}`} className="text-xs font-medium text-[var(--color-text-subtle)]">
                Hasta
              </label>
              <input
                id={`to-${tipo}`}
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`faena-${tipo}`} className="text-xs font-medium text-[var(--color-text-subtle)]">
              Faena
            </label>
            <select
              id={`faena-${tipo}`}
              value={faena}
              onChange={(e) => setFaena(e.target.value)}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            >
              <option value="">Todas las faenas</option>
              {worksites.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          </div>

          {statuses.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`status-${tipo}`} className="text-xs font-medium text-[var(--color-text-subtle)]">
                Estado
              </label>
              <select
                id={`status-${tipo}`}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              >
                <option value="">Todos los estados</option>
                {statuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" size="sm">Cancelar</Button>
          </DialogClose>
          <DialogClose asChild>
            <a
              href={buildUrl()}
              download
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-full)] bg-[var(--color-primary)] px-4 text-xs font-semibold text-white transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-strong)]"
            >
              <Funnel size={13} />
              Descargar
            </a>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
