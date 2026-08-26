import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cn } from "@/lib/utils"

/* ── Label ───────────────────────────────────────────────────────────────── */
const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "block text-sm font-medium text-[var(--color-text)]",
      "leading-tight mb-1.5",
      className,
    )}
    {...props}
  >
    {children}
    {required && (
      <span className="ml-0.5 text-[var(--color-danger)]" aria-hidden>*</span>
    )}
  </LabelPrimitive.Root>
))
Label.displayName = "Label"

/* ── Field ───────────────────────────────────────────────────────────────── */
// Composes Label (always above) + helper text + error message per the design laws.
interface FieldProps {
  label:       string
  htmlFor?:    string
  required?:   boolean
  helper?:     string
  hint?:       string
  error?:      string
  className?:  string
  children:    React.ReactNode
}

function Field({ label, htmlFor, required, helper, hint, error, className, children }: FieldProps) {
  const helperText = helper || hint
  const descriptionId = htmlFor && (error || helperText)
    ? `${htmlFor}-${error ? "error" : "helper"}`
    : undefined
  const labelId = htmlFor ? `${htmlFor}-label` : undefined
  const content = labelId || descriptionId
    ? addLabelAndDescriptionToSingleControl(children, labelId, descriptionId, !!error)
    : children

  // Sin `htmlFor` ni mensajes de error/ayuda, y con UN solo control, el label
  // envuelve al control: asociación implícita como `<label>` nativo. Antes los
  // workbenches reimplementaban este patrón a mano (Field local); centralizarlo
  // devuelve el nombre accesible a ~400 usos de Field sin ids explícitos.
  if (!htmlFor && !(error || helperText)) {
    const childArray = React.Children.toArray(children)
    if (childArray.length === 1) {
      return (
        <label className={cn("flex flex-col gap-0", className)}>
          <Label required={required}>{label}</Label>
          {children}
        </label>
      )
    }
  }

  return (
    <div className={cn("flex flex-col gap-0", className)}>
      <Label htmlFor={htmlFor} required={required} id={labelId}>
        {label}
      </Label>
      {content}
      {error ? (
        <p id={descriptionId} className="mt-1.5 text-xs text-[var(--color-danger)] leading-tight" role="alert">
          {error}
        </p>
      ) : helperText ? (
        <p id={descriptionId} className="mt-1.5 text-xs text-[var(--color-text-subtle)] leading-tight">
          {helperText}
        </p>
      ) : null}
    </div>
  )
}

function addLabelAndDescriptionToSingleControl(
  children: React.ReactNode,
  labelId: string | undefined,
  descriptionId: string | undefined,
  hasError: boolean,
) {
  if (!labelId && !descriptionId) return children

  const childArray = React.Children.toArray(children)
  if (childArray.length !== 1 || !React.isValidElement<Record<string, unknown>>(childArray[0])) {
    return children
  }

  const child = childArray[0]
  const patch: Record<string, unknown> = {}

  if (labelId) {
    const existing = typeof child.props["aria-labelledby"] === "string" ? child.props["aria-labelledby"] : ""
    patch["aria-labelledby"] = cn(existing, labelId)
  }

  if (descriptionId) {
    const existing = typeof child.props["aria-describedby"] === "string" ? child.props["aria-describedby"] : ""
    patch["aria-describedby"] = cn(existing, descriptionId)
    patch["aria-invalid"] = hasError || child.props["aria-invalid"]
  }

  return React.cloneElement(child, patch)
}

/* ── FieldGroup ───────────────────────────────────────────────────────────── */
// Wraps multiple fields with consistent gap-4 vertical rhythm.
function FieldGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {children}
    </div>
  )
}

export { Label, Field, FieldGroup }
