"use client"

import * as React from "react"
import { Wine, CheckCircle, Warning, XCircle } from "@phosphor-icons/react"
import { Field, FieldGroup } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "@/lib/toast"
import type { AlcoholTest } from "@/db/schema"
import { formatDateSafe } from "@/lib/sst/date"
import { registerAlcoholTestAction, markAlcoholTestSentAction } from "./actions"

interface WorkerOption {
  id: string
  firstName: string
  lastName: string
}

interface Props {
  tests: AlcoholTest[]
  worksites: { id: string; name: string }[]
  workers: WorkerOption[]
  canManage: boolean
}

const RESULT_LABEL: Record<string, string> = {
  negativo: "Negativo",
  positivo: "Positivo",
  rechazado: "Rechazado",
  no_concluyente: "No concluyente",
}

const RESULT_VARIANT: Record<string, "default" | "warning" | "danger" | "outline" | "primary" | "success" | "signal" | "info"> = {
  negativo: "success",
  positivo: "danger",
  rechazado: "warning",
  no_concluyente: "outline",
}

const RESULT_ICON: Record<string, React.ReactNode> = {
  negativo: <CheckCircle size={14} />,
  positivo: <Warning size={14} />,
  rechazado: <XCircle size={14} />,
  no_concluyente: <XCircle size={14} />,
}

const SHIFT_OPTIONS = [
  { value: "D", label: "Día" },
  { value: "T", label: "Tarde" },
  { value: "N", label: "Noche" },
] as const

export function AlcotestPanel({ tests, worksites, workers, canManage }: Props) {
  const [open, setOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState({
    worksiteId: worksites[0]?.id ?? "",
    testedWorkerId: "",
    shift: "D",
    result: "negativo",
    evidenceUrl: "",
  })
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({})

  const workerName = (id: string | null) => {
    if (!id) return null
    const w = workers.find((x) => x.id === id)
    return w ? `${w.firstName} ${w.lastName}` : null
  }
  const wsName = (id: string) => worksites.find((w) => w.id === id)?.name ?? id

  function resetError(field: string) {
    setErrors((prev) => {
      if (!prev[field]) return prev
      const { [field]: _drop, ...rest } = prev
      return rest
    })
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setErrors({})
    const result = await registerAlcoholTestAction({
      worksiteId: form.worksiteId,
      testedWorkerId: form.testedWorkerId || undefined,
      shift: form.shift,
      result: form.result,
      evidenceUrl: form.evidenceUrl || undefined,
    })
    setSubmitting(false)
    if (!result.ok) {
      const fe = (result as { fieldErrors?: Record<string, string[]> }).fieldErrors
      if (fe) {
        setErrors(fe)
        const firstField = Object.keys(fe)[0]
        const firstMsg = firstField ? fe[firstField]?.[0] : undefined
        toast.error(firstMsg ? `${firstField}: ${firstMsg}` : (result.message ?? "Revisa los campos."))
      } else {
        toast.error(result.message ?? "Error al registrar el test.")
      }
      return
    }
    toast.success("Test de alcotest registrado.")
    setForm({ worksiteId: form.worksiteId, testedWorkerId: "", shift: "D", result: "negativo", evidenceUrl: "" })
    setOpen(false)
  }

  async function markSent(testId: string) {
    const result = await markAlcoholTestSentAction(testId)
    if (!result.ok) {
      toast.error(result.message ?? "Error al marcar como enviado.")
      return
    }
    toast.success("Marcado como enviado al MINSAL.")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wine size={20} className="text-[var(--color-text-subtle)]" />
          <h2 className="text-lg font-semibold">Historial de tests</h2>
        </div>
        {canManage && worksites.length > 0 ? (
          <Button onClick={() => setOpen(!open)} variant={open ? "ghost" : "primary"}>
            {open ? "Cancelar" : "Registrar test"}
          </Button>
        ) : null}
      </div>

      {open ? (
        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4"
        >
          <FieldGroup>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Faena" htmlFor="alc-ws" required error={errors.worksiteId?.[0]}>
                <Select
                  value={form.worksiteId}
                  onValueChange={(v) => { resetError("worksiteId"); setForm((f) => ({ ...f, worksiteId: v })) }}
                >
                  <SelectTrigger id="alc-ws" aria-invalid={!!errors.worksiteId}>
                    <SelectValue placeholder="Selecciona faena" />
                  </SelectTrigger>
                  <SelectContent>
                    {worksites.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Trabajador (opcional)" htmlFor="alc-worker" error={errors.testedWorkerId?.[0]}>
                <Select
                  value={form.testedWorkerId}
                  onValueChange={(v) => { resetError("testedWorkerId"); setForm((f) => ({ ...f, testedWorkerId: v })) }}
                >
                  <SelectTrigger id="alc-worker" aria-invalid={!!errors.testedWorkerId}>
                    <SelectValue placeholder="Sin trabajador asignado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— Sin asignar —</SelectItem>
                    {workers.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Turno" htmlFor="alc-shift" required error={errors.shift?.[0]}>
                <Select
                  value={form.shift}
                  onValueChange={(v) => { resetError("shift"); setForm((f) => ({ ...f, shift: v })) }}
                >
                  <SelectTrigger id="alc-shift" aria-invalid={!!errors.shift}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIFT_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Resultado" htmlFor="alc-result" required error={errors.result?.[0]}>
                <Select
                  value={form.result}
                  onValueChange={(v) => { resetError("result"); setForm((f) => ({ ...f, result: v })) }}
                >
                  <SelectTrigger id="alc-result" aria-invalid={!!errors.result}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RESULT_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="URL evidencia (opcional)" htmlFor="alc-ev" error={errors.evidenceUrl?.[0]}>
              <Input
                id="alc-ev"
                value={form.evidenceUrl}
                onChange={(e) => { resetError("evidenceUrl"); setForm((f) => ({ ...f, evidenceUrl: e.target.value })) }}
                placeholder="https://storage/…"
                aria-invalid={!!errors.evidenceUrl}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Registrando…" : "Registrar"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      ) : null}

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Trabajador</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Enviado MINSAL</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 6}>
                  <EmptyState compact title="Sin tests registrados" description="Aún no se han registrado controles de alcotest en esta faena." />
                </TableCell>
              </TableRow>
            ) : tests.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{formatDateSafe(t.performedAt)}</TableCell>
                <TableCell>{wsName(t.worksiteId)}</TableCell>
                <TableCell className="font-medium">
                  {t.testedWorkerId ? workerName(t.testedWorkerId) ?? <span className="font-mono text-xs text-[var(--color-text-subtle)]">{t.testedWorkerId}</span> : <span className="text-[var(--color-text-subtle)]">—</span>}
                </TableCell>
                <TableCell>{t.shift}</TableCell>
                <TableCell>
                  <Badge variant={RESULT_VARIANT[t.result] ?? "outline"} className="inline-flex items-center gap-1">
                    {RESULT_ICON[t.result]}
                    {RESULT_LABEL[t.result] ?? t.result}
                  </Badge>
                </TableCell>
                <TableCell>{t.sentAt ? formatDateSafe(t.sentAt) : <span className="text-[var(--color-text-subtle)]">Pendiente</span>}</TableCell>
                {canManage ? (
                  <TableCell>
                    {t.sentAt ? null : (
                      <Button size="sm" variant="ghost" onClick={() => markSent(t.id)}>
                        Marcar enviado
                      </Button>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}
