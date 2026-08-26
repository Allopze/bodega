"use client"

import type { ReactNode } from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"

type CatalogAction = (prev: ActionState, formData: FormData) => Promise<ActionState>
type ExternalActionState = {
  state: ActionState
  formAction: (formData: FormData) => void
}

interface CatalogFormSheetProps {
  open: boolean
  onClose: () => void
  isEdit: boolean
  /** Entity id — sent as a hidden "id" field when isEdit is true. */
  entityId?: string
  title: string
  description?: string
  create: CatalogAction
  update: CatalogAction
  submitLabel: string
  submittingLabel?: string
  successMessage: string
  variant?: "sheet" | "embedded"
  embeddedCloseLabel?: string
  bodyClassName?: string
  footerClassName?: string
  hiddenFields?: ReactNode
  externalActionState?: ExternalActionState
  /** Only the field group — the Sheet/form/footer scaffolding lives here. */
  children: (state: ActionState) => ReactNode
}

/**
 * The Sheet + useActionState + toast + footer scaffolding shared by every
 * catalog form (worksite-form.tsx, worker-form.tsx, ...). Callers keep only
 * their fields and field-specific logic.
 */
export function CatalogFormSheet({
  open, onClose, isEdit, entityId, title, description,
  create, update, submitLabel, submittingLabel = "Guardando...",
  successMessage, variant = "sheet", embeddedCloseLabel = "Volver al catálogo",
  bodyClassName, footerClassName, hiddenFields, externalActionState, children,
}: CatalogFormSheetProps) {
  const action = isEdit ? update : create
  const [internalState, internalFormAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? successMessage)
        onClose()
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )
  const state = externalActionState?.state ?? internalState
  const formAction = externalActionState?.formAction ?? internalFormAction

  const form = (
    <form action={formAction} className="flex flex-col flex-1 min-h-0">
      {isEdit && entityId && <input type="hidden" name="id" value={entityId} />}
      {hiddenFields}

      {variant === "embedded" ? (
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 md:flex-row md:items-start md:justify-between md:px-6">
          <div>
            <h2 className="text-h2 text-[var(--color-text)]">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{description}</p>}
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>{embeddedCloseLabel}</Button>
        </div>
      ) : (
        <SheetHeader>
          <div>
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </div>
          <SheetCloseButton />
        </SheetHeader>
      )}

      <SheetBody className={bodyClassName}>
        {state.message && !state.ok && !state.fieldErrors && (
          <p className="mb-4 text-[var(--color-danger)]">{state.message}</p>
        )}
        {children(state)}
      </SheetBody>

      <SheetFooter className={footerClassName}>
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <SubmitButton label={submitLabel} loadingLabel={submittingLabel} />
      </SheetFooter>
    </form>
  )

  if (variant === "embedded") return form

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>{form}</SheetContent>
    </Sheet>
  )
}
