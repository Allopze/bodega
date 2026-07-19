"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { closePpaAction } from "../actions"

/** Cierra un caso autorizado cuya acción correctiva ya fue verificada. */
export function CloseCaseButton({ ppaId, ppaVersion }: { ppaId: string; ppaVersion: number }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function confirm() {
    startTransition(async () => {
      const res = await closePpaAction({
        ppaId,
        expectedPpaVersion: ppaVersion,
        comment: "Cierre administrativo posterior a verificación satisfactoria.",
      })
      if (res.ok) {
        toast.success(res.message ?? "Caso cerrado")
        setOpen(false)
        router.refresh()
      } else {
        toast.error(res.message ?? "No se pudo cerrar el caso")
      }
    })
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="w-full">
        Cerrar caso
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cerrar caso"
        description="La acción correctiva ya fue verificada. El PPA quedará cerrado y ya no podrá modificarse. ¿Deseas continuar?"
        confirmLabel="Cerrar caso"
        cancelLabel="Cancelar"
        onConfirm={confirm}
        loading={pending}
      />
    </>
  )
}
