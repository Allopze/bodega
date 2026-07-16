"use client"

import { useState, useTransition } from "react"
import { LockKey } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { closeSafetyIndicatorPeriodAction } from "./actions"

export function IndicatorPeriodCloseButton({ worksiteId, year, month }: { worksiteId: string; year: number; month: number }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function closePeriod() {
    startTransition(async () => {
      const result = await closeSafetyIndicatorPeriodAction({ worksiteId, year, month })
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
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cerrar período de indicadores"
        description="El período quedará protegido. Solo Jefatura de Prevención o Administración podrá corregirlo."
        confirmLabel="Cerrar período"
        cancelLabel="Cancelar"
        onConfirm={closePeriod}
        loading={pending}
      />
    </>
  )
}
