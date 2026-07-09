"use client"

import { useFormStatus } from "react-dom"
import { Button, type ButtonProps } from "@/components/ui/button"

interface SubmitButtonProps extends Omit<ButtonProps, "type"> {
  label:        string
  loadingLabel?: string
}

/**
 * A submit button that automatically shows a loading state while
 * the parent Server Action is pending (reads useFormStatus).
 */
export function SubmitButton({ label, loadingLabel, children, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending} disabled={pending} {...props}>
      {children}
      {pending && loadingLabel ? loadingLabel : label}
    </Button>
  )
}
