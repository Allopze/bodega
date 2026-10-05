"use client"

import * as React from "react"
import { FileXls } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { WorksiteSelect, type WorksiteOption } from "@/components/ui/worksite-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ExportButton } from "@/components/ui/export-button"
import { exportTiReport, type TiReportFilters, type TiReportType } from "./actions"

interface TiExportDialogProps {
  type: TiReportType
  title: string
  worksites: WorksiteOption[]
  /** Sistemas de acceso para filtrar; se omite si el reporte no los tiene. */
  systems?: { id: string; name: string }[]
  withPeriod?: boolean
}

/**
 * Diálogo de filtros de los reportes TI. `ExportDialog` descarga por un
 * endpoint GET; estos reportes viajan por la server action `exportTiReport`
 * (permiso `ti:export` y alcance de faena se resuelven allí), así que se
 * reutilizan sus mismos controles (`WorksiteSelect`, `DateRangePicker`) y
 * `ExportButton` para la descarga.
 */
export function TiExportDialog({ type, title, worksites, systems, withPeriod = false }: TiExportDialogProps) {
  const [worksiteId, setWorksiteId] = React.useState("")
  const [systemId, setSystemId] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const uid = React.useId()

  const filters: TiReportFilters = {
    worksiteId: worksiteId || undefined,
    systemId: systemId || undefined,
    from: from || undefined,
    to: to || undefined,
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="w-full">
          <FileXls className="mr-1.5 h-4 w-4" /> Exportar con filtros
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Elige qué incluir. Sin filtros se exporta todo lo que puedes ver.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {withPeriod && (
            <DateRangePicker fromValue={from} toValue={to} onFromChange={setFrom} onToChange={setTo}
              fromId={`${uid}-from`} toId={`${uid}-to`} />
          )}
          {worksites.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-faena`} className="text-xs font-medium text-[var(--color-text-subtle)]">Faena</label>
              <WorksiteSelect id={`${uid}-faena`} worksites={worksites} value={worksiteId} onChange={setWorksiteId} />
            </div>
          )}
          {systems && systems.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-sistema`} className="text-xs font-medium text-[var(--color-text-subtle)]">Sistema</label>
              <Select value={systemId || "_all"} onValueChange={(v) => setSystemId(v === "_all" ? "" : v)}>
                <SelectTrigger id={`${uid}-sistema`} aria-label="Filtrar por sistema">
                  <SelectValue placeholder="Todos los sistemas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos los sistemas</SelectItem>
                  {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="secondary" size="sm">Cerrar</Button></DialogClose>
          <ExportButton variant="primary" action={() => exportTiReport(type, undefined, filters)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
