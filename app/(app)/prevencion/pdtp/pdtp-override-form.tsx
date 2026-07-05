"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Sliders } from "@phosphor-icons/react"
import { setPdtpActivityOverrideFormAction } from "./actions"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

type Props = {
  activityId: string
  activityN: number
  activityName: string
  worksiteId: string
  year: number
  defaultMonth: number
  defaultWeek: number
  /** Cantidad override actual (si existe) — para pre-rellenar. */
  currentOverride?: number
  /** Cantidad del plan global del catálogo — referencia para el usuario. */
  globalQuantity?: number
  hoja: string
}

/**
 * Modal para fijar la cantidad planeada por (actividad, faena, mes, semana).
 * Envía un form al action `setPdtpActivityOverrideFormAction`. Si la
 * cantidad es 0 y ya hay un override, se interpreta como "borrar override"
 * y se vuelve al plan global.
 */
export function PdtpOverrideForm(props: Props) {
  const { activityId, activityN, activityName, worksiteId, year, defaultMonth, defaultWeek, currentOverride, globalQuantity, hoja } = props
  const initial = currentOverride ?? 0
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" title="Fijar meta por faena">
          <Sliders size={13} className="mr-1" />
          Meta faena
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Meta por faena · N°{activityN}</DialogTitle>
          <DialogDescription>
            {activityName}
            {globalQuantity !== undefined && (
              <>
                {" · "}Plan global del catálogo: <span className="font-mono">{globalQuantity}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          action={(fd) => {
            setPdtpActivityOverrideFormAction(fd)
            setOpen(false)
          }}
          className="space-y-3"
        >
          <input type="hidden" name="activityId" value={activityId} />
          <input type="hidden" name="worksiteId" value={worksiteId} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="hoja" value={hoja} />
          <input type="hidden" name="faena" value={worksiteId} />

          <div className="grid grid-cols-3 gap-3">
            <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
              Mes
              <Select name="month" defaultValue={String(defaultMonth)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_LABELS.map((label, index) => (
                    <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
              Semana
              <Select name="week" defaultValue={String(defaultWeek)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((week) => (
                    <SelectItem key={week} value={String(week)}>{week}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-xs text-[var(--color-text-subtle)]">
              Cantidad
              <input
                name="plannedQuantity"
                type="number"
                min="0"
                step="0.25"
                defaultValue={initial}
                className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
              />
            </label>
          </div>
          <p className="text-[11px] text-[var(--color-text-subtle)]">
            Define 0 para borrar el override y volver al plan global del catálogo.
          </p>
          <DialogFooter>
            {currentOverride !== undefined && currentOverride > 0 && (
              <Button type="submit" size="sm" variant="ghost" name="mode" value="delete">
                Quitar override
              </Button>
            )}
            <Button type="submit" size="sm" name="mode" value="set">
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
