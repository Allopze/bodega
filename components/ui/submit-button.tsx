"use client"

import { useFormStatus } from "react-dom"
import { Button, type ButtonProps } from "@/components/ui/button"

interface SubmitButtonProps extends Omit<ButtonProps, "type"> {
  label:        string
  loadingLabel?: string
  /**
   * Estado de envío explícito. `useFormStatus` sólo lo ve en un `<form action>`; un formulario
   * que envía por `onSubmit` (para que React no le vacíe los campos al rechazarse) lo pasa aquí.
   */
  pending?:     boolean
}

/**
 * A submit button that automatically shows a loading state while
 * the parent Server Action is pending (reads useFormStatus, or `pending` when given).
 */
export function SubmitButton({ label, loadingLabel, children, disabled, pending: pendingProp, ...props }: SubmitButtonProps) {
  const status = useFormStatus()
  const pending = pendingProp ?? status.pending
  return (
    <Button type="submit" loading={pending} disabled={pending || disabled} {...props}>
      {children}
      {pending && loadingLabel ? loadingLabel : label}
    </Button>
  )
}
