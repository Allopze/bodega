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
  error?:      string
  className?:  string
  children:    React.ReactNode
}

function Field({ label, htmlFor, required, helper, error, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-0", className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-[var(--color-danger)] leading-tight" role="alert">
          {error}
        </p>
      ) : helper ? (
        <p className="mt-1.5 text-xs text-[var(--color-text-subtle)] leading-tight">
          {helper}
        </p>
      ) : null}
    </div>
  )
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
