"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { CheckCircle, Plus, FileText } from "@phosphor-icons/react"
import type { LegalDocument, LegalDocumentVersion, DocumentDelivery } from "@/db/schema"
import { formatDateSafe } from "@/lib/sst/date"
import {
  createLegalDocumentAction,
  addDocumentVersionAction,
  deliverDocumentAction,
  acknowledgeDeliveryAction,
} from "./actions"

interface WorkerSummary {
  id: string
  firstName: string
  lastName: string
  rut: string | null
}

interface EnrichedDelivery extends DocumentDelivery {
  worker: Omit<WorkerSummary, "id"> | null
}

interface Props {
  documents: LegalDocument[]
  versions: LegalDocumentVersion[]
  deliveries: EnrichedDelivery[]
  activeWorkers: WorkerSummary[]
  canManage: boolean
  canSign: boolean
  showForm: boolean
  onShowFormChange: (open: boolean) => void
}

const DOC_TYPE_LABELS: Record<string, string> = {
  RIOH: "Reglamento Interno (RIOH)",
  ODI: "Obligación de Informar (ODI)",
  IRL: "Investigación de Riesgos (IRL)",
}

export function DocumentacionList({ documents, versions, deliveries, activeWorkers, canManage, canSign, showForm, onShowFormChange }: Props) {
  const router = useRouter()
  const [activeDocId, setActiveDocId] = React.useState<string | null>(null)
  const [createType, setCreateType] = React.useState<"RIOH" | "ODI" | "IRL">("ODI")
  const [createTitle, setCreateTitle] = React.useState("")
  const [createCode, setCreateCode] = React.useState("")
  const [addVersionDoc, setAddVersionDoc] = React.useState<string | null>(null)
  const [addVersionFrom, setAddVersionFrom] = React.useState(new Date().toISOString().slice(0, 10))
  const [addVersionChangelog, setAddVersionChangelog] = React.useState("")
  const [deliverDoc, setDeliverDoc] = React.useState<string | null>(null)
  const [deliverWorker, setDeliverWorker] = React.useState("")
  const [signDelivery, setSignDelivery] = React.useState<string | null>(null)
  const [signature, setSignature] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const docsByType = React.useMemo(() => {
    const map: Record<string, LegalDocument[]> = {}
    for (const d of documents) {
      (map[d.type] ||= []).push(d)
    }
    return map
  }, [documents])

  const versionsByDoc = React.useMemo(() => {
    const map: Record<string, LegalDocumentVersion[]> = {}
    for (const v of versions) {
      (map[v.documentId] ||= []).push(v)
    }
    return map
  }, [versions])

  const activeDoc = addVersionDoc ?? deliverDoc ?? activeDocId
  const activeDocVersions = activeDoc ? versionsByDoc[activeDoc] ?? [] : []
  const activeDocDeliveries = activeDoc ? deliveries.filter((d) => activeDocVersions.some((v) => v.id === d.versionId)) : []

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    const result = await createLegalDocumentAction({ type: createType, code: createCode, title: createTitle })
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message ?? "Error al crear documento.")
      return
    }
    toast.success("Documento creado.")
    setCreateTitle("")
    setCreateCode("")
    onShowFormChange(false)
    router.refresh()
  }

  async function onAddVersion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!addVersionDoc) return
    setBusy(true)
    const result = await addDocumentVersionAction({
      documentId: addVersionDoc,
      effectiveFrom: addVersionFrom,
      changelog: addVersionChangelog || undefined,
    })
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message ?? "Error al agregar versión.")
      return
    }
    toast.success("Versión agregada.")
    setAddVersionDoc(null)
    setAddVersionChangelog("")
    router.refresh()
  }

  async function onDeliver(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deliverDoc || !deliverWorker) return
    setBusy(true)
    const [version] = activeDocVersions
    if (!version) {
      toast.error("Agrega primero una versión del documento.")
      setBusy(false)
      return
    }
    const result = await deliverDocumentAction({
      versionId: version.id,
      workerId: deliverWorker,
    })
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message ?? "Error al entregar el documento.")
      return
    }
    toast.success("Documento entregado. Pendiente de firma del trabajador.")
    setDeliverDoc(null)
    setDeliverWorker("")
    router.refresh()
  }

  async function onSign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!signDelivery) return
    setBusy(true)
    const result = await acknowledgeDeliveryAction(signDelivery, signature)
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message ?? "Error al firmar el acuse.")
      return
    }
    toast.success("Acuse de recibo firmado.")
    setSignDelivery(null)
    setSignature("")
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {canManage && showForm ? (
        <form onSubmit={onCreate} className="rounded-[var(--radius-2xl)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Tipo" htmlFor="doc-type" required>
                <Select value={createType} onValueChange={(v) => setCreateType(v as "RIOH" | "ODI" | "IRL")}>
                  <SelectTrigger id="doc-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RIOH">RIOH</SelectItem>
                    <SelectItem value="ODI">ODI</SelectItem>
                    <SelectItem value="IRL">IRL</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Código" htmlFor="doc-code" required>
                <Input
                  id="doc-code"
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  placeholder="DOC-FA-2026"
                  required
                />
              </Field>
              <Field label="Título" htmlFor="doc-title" required>
                <Input
                  id="doc-title"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onShowFormChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Creando…" : "Crear documento"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText size={28} />}
          title="Sin documentos legales"
          description="Crea RIOHS, ODI o IRL para empezar a registrar versiones y entregas."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {Object.entries(docsByType).map(([type, docs]) => (
            <div key={type} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                {DOC_TYPE_LABELS[type] ?? type} ({docs.length})
              </h3>
              {docs.map((d) => {
                const isActive = activeDoc === d.id
                const docVersions = versionsByDoc[d.id] ?? []
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActiveDocId(isActive ? null : d.id)}
                    className={[
                      "block w-full rounded-[var(--radius)] border p-3 text-left transition-colors",
                      isActive
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]",
                    ].join(" ")}
                  >
                    <p className="text-sm font-medium text-[var(--color-text)]">{d.title}</p>
                    <p className="text-xs text-[var(--color-text-subtle)]">{d.code} · {docVersions.length} versión(es)</p>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {activeDoc ? (
        <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
          <h4 className="text-sm font-semibold">Versiones y entregas</h4>
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versión</TableHead>
                  <TableHead>Vigente desde</TableHead>
                  <TableHead>Entregas</TableHead>
                  <TableHead>Firmadas</TableHead>
                  {canManage ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeDocVersions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canManage ? 5 : 4}>
                      <EmptyState compact title="Sin versiones" description="Agrega la primera versión del documento." />
                    </TableCell>
                  </TableRow>
                ) : activeDocVersions.map((v) => {
                  const versionDeliveries = deliveries.filter((d) => d.versionId === v.id)
                  const signed = versionDeliveries.filter((d) => d.acknowledgedAt).length
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">v{v.version}</TableCell>
                      <TableCell>{formatDateSafe(v.effectiveFrom)}</TableCell>
                      <TableCell>{versionDeliveries.length}</TableCell>
                      <TableCell>
                        <Badge variant={signed === versionDeliveries.length && versionDeliveries.length > 0 ? "success" : "outline"}>
                          {signed} / {versionDeliveries.length}
                        </Badge>
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setAddVersionDoc(activeDoc)}>
                            <Plus size={12} className="mr-1" />Versión
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableRoot>

          {addVersionDoc ? (
            <form onSubmit={onAddVersion} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
              <FieldGroup>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Field label="Vigente desde" htmlFor="v-from" required>
                    <Input
                      id="v-from"
                      type="date"
                      value={addVersionFrom}
                      onChange={(e) => setAddVersionFrom(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Changelog (opcional)" htmlFor="v-cl">
                    <Input id="v-cl" value={addVersionChangelog} onChange={(e) => setAddVersionChangelog(e.target.value)} />
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setAddVersionDoc(null)}>Cancelar</Button>
                  <Button type="submit" disabled={busy}>{busy ? "Agregando…" : "Agregar versión"}</Button>
                </div>
              </FieldGroup>
            </form>
          ) : null}

          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDeliverDoc(activeDoc)}>
                Entregar versión activa
              </Button>
            </div>
          ) : null}

          {deliverDoc ? (
            <form onSubmit={onDeliver} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
              <FieldGroup>
                <Field label="Trabajador" htmlFor="dv-worker" required>
                  <Select value={deliverWorker} onValueChange={setDeliverWorker}>
                    <SelectTrigger id="dv-worker"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                    <SelectContent>
                      {activeWorkers.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} {w.rut ? `(${w.rut})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setDeliverDoc(null)}>Cancelar</Button>
                  <Button type="submit" disabled={busy}>{busy ? "Entregando…" : "Entregar"}</Button>
                </div>
              </FieldGroup>
            </form>
          ) : null}

          {activeDocDeliveries.length > 0 ? (
            <div className="space-y-1">
              <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Acuses de recibo</h5>
              {activeDocDeliveries.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] p-2 text-xs">
                  <div>
                    <span className="font-medium">{d.worker ? `${d.worker.firstName} ${d.worker.lastName}` : "—"}</span>
                    <span className="ml-2 text-[var(--color-text-subtle)]">
                      entregado {formatDateSafe(d.deliveredAt)}
                    </span>
                    {d.acknowledgedAt ? (
                      <span className="ml-2 text-[var(--color-success-ink)]">
                        firmado {formatDateSafe(d.acknowledgedAt)}
                      </span>
                    ) : null}
                  </div>
                  {canSign && !d.acknowledgedAt ? (
                    <Button size="sm" variant="ghost" onClick={() => setSignDelivery(d.id)}>
                      <CheckCircle size={12} className="mr-1" />Firmar acuse
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {signDelivery ? (
            <form onSubmit={onSign} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
              <FieldGroup>
                <Field label="Firma (texto)" htmlFor="sig" required>
                  <Textarea id="sig" rows={2} value={signature} onChange={(e) => setSignature(e.target.value)} required />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setSignDelivery(null)}>Cancelar</Button>
                  <Button type="submit" disabled={busy}>{busy ? "Firmando…" : "Firmar"}</Button>
                </div>
              </FieldGroup>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
