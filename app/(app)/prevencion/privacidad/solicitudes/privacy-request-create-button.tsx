"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

interface Props { workers: Array<{ id: string; label: string }> }

const RIGHTS = [
  ["access", "Acceso"],
  ["rectification", "Rectificación"],
  ["deletion", "Supresión"],
  ["opposition", "Oposición"],
  ["portability", "Portabilidad"],
  ["restriction", "Restricción del tratamiento"],
] as const

export function PrivacyRequestCreateButton({ workers }: Props) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [workerId, setWorkerId] = React.useState("")
  const [rightType, setRightType] = React.useState("")
  const [requestScope, setRequestScope] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!workerId || !rightType || requestScope.trim().length < 3) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/prevencion/privacidad/solicitudes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectWorkerId: workerId, rightType, requestScope }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? "No se pudo crear la solicitud.")
      }
      setOpen(false)
      setWorkerId("")
      setRightType("")
      setRequestScope("")
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo crear la solicitud.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button type="button" size="sm"><Plus size={16} className="mr-1" />Nueva solicitud</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva solicitud de privacidad</DialogTitle>
            <DialogDescription>Registra al titular y el alcance exacto antes de validar su identidad.</DialogDescription>
          </DialogHeader>
          <Field label="Titular" htmlFor="privacy-subject" required>
            <Select value={workerId} onValueChange={setWorkerId} disabled={busy}>
              <SelectTrigger id="privacy-subject"><SelectValue placeholder="Seleccionar trabajador" /></SelectTrigger>
              <SelectContent>{workers.map((worker) => (
                <SelectItem key={worker.id} value={worker.id}>{worker.label}</SelectItem>
              ))}</SelectContent>
            </Select>
          </Field>
          <Field label="Derecho ejercido" htmlFor="privacy-right" required>
            <Select value={rightType} onValueChange={setRightType} disabled={busy}>
              <SelectTrigger id="privacy-right"><SelectValue placeholder="Seleccionar derecho" /></SelectTrigger>
              <SelectContent>{RIGHTS.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}</SelectContent>
            </Select>
          </Field>
          <Field label="Alcance solicitado" htmlFor="privacy-scope" required helper="Describe qué datos, período o tratamiento solicita el titular.">
            <Textarea id="privacy-scope" value={requestScope} onChange={(event) => setRequestScope(event.target.value)} maxLength={2000} disabled={busy} />
          </Field>
          {error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !workerId || !rightType || requestScope.trim().length < 3}>
              {busy ? "Registrando…" : "Registrar solicitud"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
