"use client"

import * as React from "react"
import { DownloadSimple, Funnel } from "@phosphor-icons/react/dist/ssr"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { WorksiteSelect, type WorksiteOption } from "@/components/ui/worksite-select"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

export interface StatusOption {
  value: string
  label: string
}

export interface ExportDialogProps {
  tipo?: string
  endpoint?: string
  title?: string
  label?: string
  description?: string
  worksites?: WorksiteOption[]
  statuses?: StatusOption[]
  tone?: "neutral" | "signal"
  paramNames?: {
    worksite?: string
    from?: string
    to?: string
    status?: string
  }
  isoDateISOFormat?: boolean
  canExport?: boolean
  trigger?: React.ReactNode
}

const ExportDialogInner = React.memo(function ExportDialogInner({
  tipo,
  endpoint = "/api/reportes/export",
  title,
  label = "Excel",
  description = "Aplica filtros para reducir el volumen de datos exportados.",
  worksites = [],
  statuses = [],
  tone = "neutral",
  paramNames = {},
  isoDateISOFormat = false,
  canExport = true,
  trigger,
}: ExportDialogProps) {
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [faena, setFaena] = React.useState("")
  const [status, setStatus] = React.useState("")

  if (!canExport) return null

  const worksiteParam = paramNames.worksite ?? (endpoint.includes("/api/reportes/export") ? "faena" : "faena")
  const fromParam = paramNames.from ?? (endpoint.includes("/api/reportes/export") ? "from" : "from")
  const toParam = paramNames.to ?? (endpoint.includes("/api/reportes/export") ? "to" : "to")
  const statusParam = paramNames.status ?? "status"

  function buildUrl() {
    const params = new URLSearchParams()
    if (tipo) params.set("tipo", tipo)
    if (faena) params.set(worksiteParam, faena)
    if (status) params.set(statusParam, status)

    if (from) {
      const formattedFrom = isoDateISOFormat ? new Date(`${from}T00:00:00`).toISOString() : from
      params.set(fromParam, formattedFrom)
    }
    if (to) {
      const formattedTo = isoDateISOFormat ? new Date(`${to}T23:59:59.999`).toISOString() : to
      params.set(toParam, formattedTo)
    }

    const queryString = params.toString()
    return queryString ? `${endpoint}?${queryString}` : endpoint
  }

  const baseClass = tone === "signal"
    ? "border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)] hover:opacity-80"
    : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"

  const dialogTitle = title ?? `Exportar ${label}`

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm" className={tone === "signal" ? baseClass : undefined}>
            <DownloadSimple size={14} className="mr-1" />
            Exportar {label}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <DateRangePicker
            fromValue={from}
            toValue={to}
            onFromChange={setFrom}
            onToChange={setTo}
            fromId={`from-${tipo || "export"}`}
            toId={`to-${tipo || "export"}`}
          />

          {worksites.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`faena-${tipo || "export"}`} className="text-xs font-medium text-[var(--color-text-subtle)]">
                Faena
              </label>
              <WorksiteSelect
                id={`faena-${tipo || "export"}`}
                worksites={worksites}
                value={faena}
                onChange={setFaena}
              />
            </div>
          )}

          {statuses.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`status-${tipo || "export"}`} className="text-xs font-medium text-[var(--color-text-subtle)]">
                Estado
              </label>
              <Select value={status || "_all"} onValueChange={(v) => setStatus(v === "_all" ? "" : v)}>
                <SelectTrigger id={`status-${tipo || "export"}`} aria-label="Filtrar por estado">
                  <SelectValue placeholder="Todos los estados" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos los estados</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" size="sm">Cancelar</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button asChild size="sm">
              <a href={buildUrl()} download>
                <Funnel size={13} className="mr-1.5" />
                Descargar
              </a>
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export const ExportDialog = ExportDialogInner
