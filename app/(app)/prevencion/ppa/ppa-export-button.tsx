"use client"

import * as React from "react"
import { DownloadSimple, Funnel } from "@phosphor-icons/react/dist/ssr"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { ESTADO_PPA_LABELS } from "@/lib/ppa/badges"

interface WorksiteOption {
  id: string
  name: string
}

interface PpaExportButtonProps {
  worksites: WorksiteOption[]
  canExport: boolean
}

export function PpaExportButton({ worksites, canExport }: PpaExportButtonProps) {
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [estado, setEstado] = React.useState("")

  if (!canExport) return null

  function buildUrl() {
    const params = new URLSearchParams()
    if (worksiteId) params.set("worksiteId", worksiteId)
    if (estado)     params.set("estado", estado)
    if (from)       params.set("dateFrom", new Date(`${from}T00:00:00`).toISOString())
    if (to)         params.set("dateTo", new Date(`${to}T23:59:59.999`).toISOString())
    return `/api/prevencion/ppa/export?${params.toString()}`
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <DownloadSimple size={14} className="mr-1" />
          Exportar XLSX
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar PPA Digital</DialogTitle>
          <DialogDescription>
            Aplica filtros para reducir el volumen de datos exportados. Sin filtros se exportan todos los PPA visibles.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ppa-export-from" className="text-xs font-medium text-[var(--color-text-subtle)]">
                Desde
              </label>
              <DatePicker
                id="ppa-export-from"
                value={from}
                onChange={setFrom}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ppa-export-to" className="text-xs font-medium text-[var(--color-text-subtle)]">
                Hasta
              </label>
              <DatePicker
                id="ppa-export-to"
                value={to}
                onChange={setTo}
              />
            </div>
          </div>

          {worksites.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ppa-export-faena" className="text-xs font-medium text-[var(--color-text-subtle)]">
                Faena
              </label>
              <Select value={worksiteId || "all"} onValueChange={(v) => setWorksiteId(v === "all" ? "" : v)}>
                <SelectTrigger id="ppa-export-faena" aria-label="Filtrar por faena">
                  <SelectValue placeholder="Todas las faenas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las faenas</SelectItem>
                  {worksites.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ppa-export-estado" className="text-xs font-medium text-[var(--color-text-subtle)]">
              Estado
            </label>
            <Select value={estado || "all"} onValueChange={(v) => setEstado(v === "all" ? "" : v)}>
              <SelectTrigger id="ppa-export-estado" aria-label="Filtrar por estado">
                <SelectValue placeholder="Todos los estados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(ESTADO_PPA_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" size="sm">Cancelar</Button>
          </DialogClose>
          <DialogClose asChild>
            <a
              href={buildUrl()}
              download
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--color-primary)] px-4 text-xs font-semibold text-white transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-strong)]"
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
