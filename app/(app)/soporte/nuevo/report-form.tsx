"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createReportAction } from "@/app/(app)/soporte/actions"
import type { FeedbackPrioridad, FeedbackTipo } from "@/lib/validation/feedback"

const TIPO_OPTIONS: { value: FeedbackTipo; label: string; description: string }[] = [
  { value: "bug",        label: "🐛 Bug",        description: "Algo no funciona como debería" },
  { value: "consulta",   label: "❓ Consulta",   description: "Tengo una duda sobre la plataforma" },
  { value: "sugerencia", label: "💡 Sugerencia", description: "Tengo una idea para mejorar algo" },
]

const PRIORITY_OPTIONS: { value: FeedbackPrioridad; label: string }[] = [
  { value: "baja", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
]

export function ReportForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [tipo, setTipo]             = useState<FeedbackTipo | "">("")
  const [titulo, setTitulo]         = useState("")
  const [descripcion, setDesc]      = useState("")
  const [pagina, setPagina]         = useState("")
  const [priority, setPriority]     = useState<FeedbackPrioridad>("normal")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [errors, setErrors]         = useState<Record<string, string>>({})

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!tipo)             next.tipo        = "Selecciona el tipo de reporte"
    if (!titulo.trim())    next.titulo      = "El título es obligatorio"
    if (titulo.length > 160) next.titulo   = "El título no puede superar 160 caracteres"
    if (!descripcion.trim()) next.descripcion = "La descripción es obligatoria"
    if (descripcion.length > 4000) next.descripcion = "La descripción no puede superar 4000 caracteres"
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    startTransition(async () => {
      const result = await createReportAction({
        tipo:        tipo as FeedbackTipo,
        titulo:      titulo.trim(),
        descripcion: descripcion.trim(),
        pagina:      pagina.trim() || undefined,
        priority,
        attachment,
      })

      if (!result.ok) {
        toast.error(result.message ?? "Error al enviar el reporte")
        if (result.fieldErrors) {
          const next: Record<string, string> = {}
          for (const [key, msgs] of Object.entries(result.fieldErrors)) {
            next[key] = (msgs as string[])[0] ?? ""
          }
          setErrors(next)
        }
        return
      }

      toast.success("Reporte enviado correctamente")
      router.push("/soporte")
    })
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <FieldGroup>
        <Field
          label="Tipo de reporte"
          htmlFor="tipo"
          required
          error={errors.tipo}
        >
          <Select value={tipo} onValueChange={(v) => setTipo(v as FeedbackTipo)}>
            <SelectTrigger id="tipo" error={!!errors.tipo}>
              <SelectValue placeholder="Selecciona el tipo..." />
            </SelectTrigger>
            <SelectContent>
              {TIPO_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="font-medium">{opt.label}</span>
                  <span className="ml-2 text-sub text-xs">{opt.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Prioridad"
          htmlFor="priority"
        >
          <Select value={priority} onValueChange={(v) => setPriority(v as FeedbackPrioridad)}>
            <SelectTrigger id="priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Título"
          htmlFor="titulo"
          required
          helper="Resumen breve del problema o sugerencia (máx. 160 caracteres)"
          error={errors.titulo}
        >
          <Input
            id="titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ej: El botón de exportar no responde"
            error={!!errors.titulo}
            maxLength={160}
          />
        </Field>

        <Field
          label="Descripción"
          htmlFor="descripcion"
          required
          helper="Explica con detalle: qué ocurrió, qué esperabas y cómo reproducirlo (si es bug)"
          error={errors.descripcion}
        >
          <Textarea
            id="descripcion"
            value={descripcion}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Describe el problema o sugerencia con el mayor detalle posible..."
            rows={6}
            error={!!errors.descripcion}
          />
        </Field>

        <Field
          label="Página / sección (opcional)"
          htmlFor="pagina"
          helper="URL o nombre de la sección donde ocurrió (útil para bugs)"
          error={errors.pagina}
        >
          <Input
            id="pagina"
            value={pagina}
            onChange={(e) => setPagina(e.target.value)}
            placeholder="Ej: /compras/OC-2026-0012 o 'Módulo de bodega'"
            error={!!errors.pagina}
          />
        </Field>

        <Field
          label="Adjunto (opcional)"
          htmlFor="attachment"
          helper="PDF, JPG o PNG. Máx. 20 MB."
        >
          <Input
            id="attachment"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
          />
        </Field>
      </FieldGroup>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={isPending}>
          {isPending ? "Enviando…" : "Enviar reporte"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push("/soporte")}
          disabled={isPending}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
