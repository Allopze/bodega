"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import type { LegalDocument } from "@/db/schema"
import {
  createLegalDocumentAction,
  addDocumentVersionAction,
  deliverDocumentAction,
} from "./actions"

interface WorkerSummary {
  id: string
  firstName: string
  lastName: string
  rut: string | null
}

interface Props {
  documents: LegalDocument[]
  activeWorkers: WorkerSummary[]
  onDone?: () => void
}

type Mode = "create-document" | "add-version" | "deliver"

export function DocumentForm({ documents, activeWorkers, onDone }: Props) {
  const router = useRouter()
  const [mode, setMode] = React.useState<Mode>(documents.length === 0 ? "create-document" : "add-version")
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})

  const [doc, setDoc] = React.useState({ type: "", code: "", title: "", mandatory: true })
  const [version, setVersion] = React.useState({
    documentId: documents[0]?.id ?? "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
    fileUrl: "",
    changelog: "",
  })
  const [delivery, setDelivery] = React.useState({
    versionId: "",
    workerId: activeWorkers[0]?.id ?? "",
    method: "digital",
    evidenceUrl: "",
  })

  async function onSubmitDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})
    setSubmitting(true)
    const result = await createLegalDocumentAction({
      type: doc.type,
      code: doc.code,
      title: doc.title,
      mandatory: doc.mandatory,
    })
    setSubmitting(false)
    if (!result.ok) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      toast.error(result.message ?? "Error al crear el documento.")
      return
    }
    toast.success("Documento creado.")
    setDoc({ type: "", code: "", title: "", mandatory: true })
    onDone?.()
    router.refresh()
  }

  async function onSubmitVersion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})
    if (!version.documentId) {
      toast.error("Selecciona un documento.")
      return
    }
    setSubmitting(true)
    const result = await addDocumentVersionAction({
      documentId: version.documentId,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo || undefined,
      fileUrl: version.fileUrl || undefined,
      changelog: version.changelog || undefined,
    })
    setSubmitting(false)
    if (!result.ok) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      toast.error(result.message ?? "Error al registrar la versión.")
      return
    }
    toast.success("Versión registrada.")
    onDone?.()
    router.refresh()
  }

  async function onSubmitDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})
    if (!delivery.versionId || !delivery.workerId) {
      toast.error("Completa versión y trabajador.")
      return
    }
    setSubmitting(true)
    const result = await deliverDocumentAction({
      versionId: delivery.versionId,
      workerId: delivery.workerId,
      method: delivery.method || undefined,
      evidenceUrl: delivery.evidenceUrl || undefined,
    })
    setSubmitting(false)
    if (!result.ok) {
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      toast.error(result.message ?? "Error al registrar la entrega.")
      return
    }
    toast.success("Entrega registrada.")
    onDone?.()
    router.refresh()
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        <Button type="button" variant={mode === "create-document" ? "primary" : "ghost"} onClick={() => setMode("create-document")}>
          Nuevo documento
        </Button>
        <Button type="button" variant={mode === "add-version" ? "primary" : "ghost"} onClick={() => setMode("add-version")} disabled={documents.length === 0}>
          Nueva versión
        </Button>
        <Button type="button" variant={mode === "deliver" ? "primary" : "ghost"} onClick={() => setMode("deliver")} disabled={documents.length === 0}>
          Entregar a trabajador
        </Button>
      </div>

      {mode === "create-document" ? (
        <form onSubmit={onSubmitDocument}>
          <FieldGroup>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Tipo" htmlFor="ld-type" required helper="Ej: RIOHS, ODI, IRL" error={fieldErrors.type?.[0]}>
                <Input
                  id="ld-type"
                  value={doc.type}
                  onChange={(e) => setDoc((d) => ({ ...d, type: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Código" htmlFor="ld-code" required error={fieldErrors.code?.[0]}>
                <Input
                  id="ld-code"
                  value={doc.code}
                  onChange={(e) => setDoc((d) => ({ ...d, code: e.target.value }))}
                  required
                />
              </Field>
            </div>
            <Field label="Título" htmlFor="ld-title" required error={fieldErrors.title?.[0]}>
              <Input
                id="ld-title"
                value={doc.title}
                onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))}
                required
              />
            </Field>
            <Checkbox
              id="ld-mandatory"
              label="Obligatorio"
              checked={doc.mandatory}
              onChange={(e) => setDoc((d) => ({ ...d, mandatory: e.target.checked }))}
            />
            <div className="flex justify-end gap-2">
              {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creando…" : "Crear documento"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      ) : null}

      {mode === "add-version" ? (
        <form onSubmit={onSubmitVersion}>
          <FieldGroup>
            <Field label="Documento" htmlFor="lv-doc" required error={fieldErrors.documentId?.[0]}>
              <Select value={version.documentId} onValueChange={(v) => setVersion((s) => ({ ...s, documentId: v }))}>
                <SelectTrigger id="lv-doc">
                  <SelectValue placeholder="Selecciona documento" />
                </SelectTrigger>
                <SelectContent>
                  {documents.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.type} · {d.code} — {d.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Vigente desde" htmlFor="lv-from" required error={fieldErrors.effectiveFrom?.[0]}>
                <Input
                  id="lv-from"
                  type="date"
                  value={version.effectiveFrom}
                  onChange={(e) => setVersion((s) => ({ ...s, effectiveFrom: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Vigente hasta" htmlFor="lv-to" error={fieldErrors.effectiveTo?.[0]}>
                <Input
                  id="lv-to"
                  type="date"
                  value={version.effectiveTo}
                  onChange={(e) => setVersion((s) => ({ ...s, effectiveTo: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="URL del archivo" htmlFor="lv-file" error={fieldErrors.fileUrl?.[0]}>
              <Input
                id="lv-file"
                value={version.fileUrl}
                onChange={(e) => setVersion((s) => ({ ...s, fileUrl: e.target.value }))}
                placeholder="https://…"
              />
            </Field>
            <Field label="Cambios" htmlFor="lv-changelog" error={fieldErrors.changelog?.[0]}>
              <Textarea
                id="lv-changelog"
                value={version.changelog}
                onChange={(e) => setVersion((s) => ({ ...s, changelog: e.target.value }))}
                rows={3}
              />
            </Field>
            <div className="flex justify-end gap-2">
              {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Guardando…" : "Registrar versión"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      ) : null}

      {mode === "deliver" ? (
        <form onSubmit={onSubmitDelivery}>
          <FieldGroup>
            <Field label="Versión" htmlFor="dd-version" required helper="ID de la versión del documento a entregar" error={fieldErrors.versionId?.[0]}>
              <Input
                id="dd-version"
                value={delivery.versionId}
                onChange={(e) => setDelivery((s) => ({ ...s, versionId: e.target.value }))}
                required
              />
            </Field>
            <Field label="Trabajador" htmlFor="dd-worker" required error={fieldErrors.workerId?.[0]}>
              <Select value={delivery.workerId} onValueChange={(v) => setDelivery((s) => ({ ...s, workerId: v }))}>
                <SelectTrigger id="dd-worker">
                  <SelectValue placeholder="Selecciona trabajador" />
                </SelectTrigger>
                <SelectContent>
                  {activeWorkers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.firstName} {w.lastName}{w.rut ? ` · ${w.rut}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Método" htmlFor="dd-method" error={fieldErrors.method?.[0]}>
                <Select value={delivery.method} onValueChange={(v) => setDelivery((s) => ({ ...s, method: v }))}>
                  <SelectTrigger id="dd-method">
                    <SelectValue placeholder="Selecciona método" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="digital">Digital</SelectItem>
                    <SelectItem value="fisico">Físico</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="URL de evidencia" htmlFor="dd-evidence" error={fieldErrors.evidenceUrl?.[0]}>
                <Input
                  id="dd-evidence"
                  value={delivery.evidenceUrl}
                  onChange={(e) => setDelivery((s) => ({ ...s, evidenceUrl: e.target.value }))}
                  placeholder="https://…"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Registrando…" : "Registrar entrega"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      ) : null}
    </div>
  )
}
