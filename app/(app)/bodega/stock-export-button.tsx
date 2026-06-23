"use client"

import * as React from "react"
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

interface WorksiteOption {
  id: string
  name: string
}

interface StockExportButtonProps {
  worksites: WorksiteOption[]
  canExport: boolean
}

export function StockExportButton({ worksites, canExport }: StockExportButtonProps) {
  const [worksiteId, setWorksiteId] = React.useState("")

  if (!canExport) return null

  function buildUrl() {
    const params = new URLSearchParams()
    if (worksiteId) params.set("faena", worksiteId)
    return `/api/bodega/stock/export?${params.toString()}`
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <DownloadSimple size={14} className="mr-1" />
          Exportar XLSX
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Exportar stock</DialogTitle>
          <DialogDescription>
            Descarga el inventario actual como archivo Excel. Puedes filtrar por faena.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {worksites.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="stock-export-faena" className="text-xs font-medium text-[var(--color-text-subtle)]">
                Faena
              </label>
              <Select value={worksiteId || "all"} onValueChange={(v) => setWorksiteId(v === "all" ? "" : v)}>
                <SelectTrigger id="stock-export-faena" aria-label="Filtrar por faena">
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
              <DownloadSimple size={13} />
              Descargar
            </a>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
