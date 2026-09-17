"use client"

import * as React from "react"
import { LockKey } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { MONTH_LABELS, chileDateParts } from "@/lib/utils"
import { closePdtpPeriodAction } from "../actions"

type PdtpPeriodCloseButtonProps = {
  programId: string
  worksiteId: string
  /** Año del programa: el cierre siempre corresponde a ese año. */
  year: number
  /** "Hoy" inyectable para fijar el mes por defecto en los tests. */
  now?: Date
}

/**
 * Mes por defecto del cierre: **el mes anterior**, en hora de Chile.
 *
 * Es el único que se cierra en la práctica —el mes en curso todavía está
 * ocurriendo— y ofrecerlo por defecto evita el error más caro del formulario:
 * congelar por accidente un mes a medias y tener que reabrirlo. En enero, el
 * mes anterior cae en el año anterior; el selector de mes queda en diciembre y
 * el año lo fija el programa, que es lo que el servicio valida.
 */
export function defaultPdtpClosureMonth(now: Date = new Date()): number {
  const { month } = chileDateParts(now)
  return month === 1 ? 12 : month - 1
}

/**
 * Cierra el mes del programa en una faena: congela la foto (RE-36,
 * indicadores, desvíos y objetivos), bloquea las escrituras manuales de ese mes
 * y, opcionalmente, lo distribuye por correo.
 *
 * El motivo es obligatorio (≥10 caracteres) y el botón queda deshabilitado
 * hasta que lo haya: el fundamento del cierre es lo que un fiscalizador lee
 * meses después junto a la foto, no un trámite.
 */
export function PdtpPeriodCloseButton({ programId, worksiteId, year, now }: PdtpPeriodCloseButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState(String(defaultPdtpClosureMonth(now)))
  const [reason, setReason] = React.useState("")
  const [distribute, setDistribute] = React.useState(true)
  const [pending, startTransition] = React.useTransition()

  function submit() {
    startTransition(async () => {
      const { toast } = await import("@/lib/toast")
      const result = await closePdtpPeriodAction({
        programId,
        worksiteId,
        year,
        month: Number(month),
        reason,
        distribute,
      })
      if (result.ok) {
        toast.success("Mes cerrado.")
        setOpen(false)
        setReason("")
      } else {
        toast.error(result.message ?? "No se pudo cerrar el mes.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          <LockKey size={14} className="mr-1" />
          Cerrar mes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar el mes de esta faena</DialogTitle>
          <DialogDescription>
            Se congela una copia del programa tal como está hoy —documento RE-36, indicadores, desvíos y avance por
            objetivo— y el mes deja de admitir cargas manuales hasta que alguien lo reabra con un motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Mes que se cierra" htmlFor="pdtp-close-month">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger id="pdtp-close-month" className="h-9 text-sm" aria-label="Mes que se cierra">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((label, index) => (
                  <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Fundamento del cierre" htmlFor="pdtp-close-reason">
            <Textarea
              id="pdtp-close-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              rows={3}
              placeholder="Evidencias revisadas con la jefatura de faena y conciliadas con los responsables."
            />
          </Field>

          <Checkbox
            id="pdtp-close-distribute"
            label="Avisar por correo a jefatura y responsables de la faena"
            checked={distribute}
            onChange={(event) => setDistribute(event.target.checked)}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
          <Button type="button" onClick={submit} disabled={pending || reason.trim().length < 10}>
            Cerrar mes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
