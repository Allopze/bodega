"use client"

import { useState, useTransition } from "react"
import { LockKey } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { closeSafetyIndicatorPeriodAction } from "./actions"

export function IndicatorPeriodCloseButton({ worksiteId, year, month }: { worksiteId: string; year: number; month: number }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()

  function closePeriod() {
    startTransition(async () => {
      const result = await closeSafetyIndicatorPeriodAction({ worksiteId, year, month, reason })
      if (result.ok) {
        toast.success("Período cerrado")
        setOpen(false)
      } else {
        toast.error(result.message ?? "No se pudo cerrar el período")
      }
    })
  }

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={pending}>
        <LockKey size={14} /> Cerrar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar período de indicadores</DialogTitle>
            <DialogDescription>
              El cierre sólo avanzará si denominadores, clasificaciones y fuentes canónicas están conciliados. El motivo quedará en el historial.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`indicator-close-reason-${month}`}>Fundamento del cierre</Label>
            <Textarea
              id={`indicator-close-reason-${month}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              rows={3}
              placeholder="Fuentes revisadas y conciliadas con Prevención"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
            <Button type="button" onClick={closePeriod} disabled={pending || reason.trim().length < 10}>Cerrar período</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
