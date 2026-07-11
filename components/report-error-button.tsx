"use client"

import * as React from "react"
import { Bug } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { toast } from "@/lib/toast"
import { createReportAction } from "@/app/(app)/soporte/actions"

interface ReportErrorButtonProps {
  /** The error from the error boundary (for context) */
  error?: Error & { digest?: string }
  /** Optional variant for the trigger button. Defaults to "ghost". */
  variant?: "secondary" | "ghost" | "link"
}

/**
 * Compact "Reportar error" button for error boundaries.
 *
 * Opens a small dialog with a textarea so the user can describe what happened
 * before sending the report. The page URL and error digest are auto-included.
 *
 * Usage (in error.tsx):
 *   <div className="flex gap-2">
 *     <Button variant="secondary" onClick={reset}>Intentar de nuevo</Button>
 *     <ReportErrorButton error={error} />
 *   </div>
 */
export function ReportErrorButton({
  error,
  variant = "ghost",
}: ReportErrorButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [description, setDescription] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  const pageUrl = React.useMemo(() => {
    if (typeof window === "undefined") return ""
    return window.location.pathname + window.location.search
  }, [])

  const errorDigest = error?.digest
  const errorMessage = error?.message

  function handleOpenChange(next: boolean) {
    if (!next) setDescription("")
    setOpen(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) return

    setSubmitting(true)
    try {
      const title = `Error en ${pageUrl || "página desconocida"}`
      const fullDescription = [
        description.trim(),
        errorDigest ? `\n\nCódigo de error: ${errorDigest}` : "",
        errorMessage ? `\nMensaje original: ${errorMessage}` : "",
        `\nURL: ${pageUrl}`,
      ].filter(Boolean).join("")

      const result = await createReportAction({
        tipo: "bug",
        titulo: title.slice(0, 160),
        descripcion: fullDescription.slice(0, 4000),
        pagina: pageUrl,
        priority: "normal",
      })

      if (!result.ok) {
        toast.error(result.message ?? "Error al enviar el reporte")
        return
      }

      toast.success("Reporte enviado. Gracias por tu ayuda.")
      handleOpenChange(false)
    } catch {
      toast.error("Error al enviar el reporte. Intenta nuevamente.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button type="button" variant={variant} size="sm" onClick={() => setOpen(true)}>
        <Bug size={14} />
        Reportar error
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Reportar error</DialogTitle>
              <DialogDescription>
                Cuéntanos qué estabas haciendo cuando ocurrió el error. El equipo de soporte
                revisará el reporte para solucionarlo.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {errorMessage && (
                <div className="rounded-[var(--radius)] bg-[var(--color-danger-tint)] px-3 py-2 text-xs text-[var(--color-danger)] font-mono break-words">
                  {errorMessage}
                </div>
              )}
              {errorDigest && (
                <p className="text-xs text-[var(--color-text-faint)] font-mono">
                  Código: {errorDigest}
                </p>
              )}

              <Field
                label="¿Qué estabas haciendo?"
                htmlFor="error-desc"
                required
                helper="Describe brevemente la acción que realizabas cuando ocurrió el error."
              >
                <Textarea
                  id="error-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej: Estaba intentando exportar un reporte de combustibles..."
                  rows={4}
                  maxLength={4000}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                loading={submitting}
                disabled={!description.trim()}
              >
                Enviar reporte
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
