"use client"

import * as React from "react"
import { useActionState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { deleteRequestAction } from "@/app/(app)/solicitudes/actions"
import { DELETABLE_REQUEST_STATUSES } from "@/lib/services/requests-delete.constants"
import { INITIAL_STATE } from "@/lib/form-state"
import type { ActionState } from "@/lib/validation/operations"

interface DeleteRequestButtonProps {
  requestId:       string
  requestCode:     string
  requestStatus:   string
  requesterId:     string
  currentUserId:   string
  canDeleteAny:    boolean
  redirectTo?:     string
}

const DeleteRequestButtonInner = React.memo(function DeleteRequestButtonInner({
  requestId,
  requestCode,
  requestStatus,
  requesterId,
  currentUserId,
  canDeleteAny,
  redirectTo = "/solicitudes",
}: DeleteRequestButtonProps) {
  const router = useRouter()
  const [state, action] = useActionState<ActionState, FormData>(deleteRequestAction, INITIAL_STATE)
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = React.useState(false)

  const isOwner   = requesterId === currentUserId
  const deletable = (isOwner || canDeleteAny)
    && (DELETABLE_REQUEST_STATUSES as readonly string[]).includes(requestStatus)

  React.useEffect(() => {
    if (!state.message) return
    if (state.ok) {
      toast.success(state.message)
      router.push(redirectTo)
    } else {
      toast.error(state.message)
    }
  }, [state, router, redirectTo])

  if (!deletable) return null

  function handleConfirm() {
    const fd = new FormData()
    fd.set("requestId", requestId)
    startTransition(() => action(fd))
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-danger hover:text-danger"
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        <Trash size={14} className="mr-1" />
        Eliminar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Eliminar solicitud?"
        description={`La solicitud ${requestCode} será eliminada permanentemente junto con todos sus ítems y archivos adjuntos. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="destructive"
        loading={pending}
        onConfirm={handleConfirm}
      />
    </>
  )
})

export const DeleteRequestButton = DeleteRequestButtonInner
