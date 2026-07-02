"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTransition, useState } from "react"
import { ArrowClockwise, CheckCircle, Eye, FileX, ThumbsDown, ThumbsUp, Trash, UploadSimple, Warning, X } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import {
  uploadSstDocumentVersionAction,
  changeSstDocumentStatusAction,
  approveSstDocumentAction,
  observeSstDocumentAction,
  archiveSstDocumentAction,
  acknowledgeSstDocumentAction,
  linkSstDocumentAction,
  unlinkSstDocumentAction,
} from "../actions"
import type { SstDocumentStatus } from "@/lib/services/prevention-documents-library"

interface DocumentBundle {
  doc: {
    id: string
    title: string
    description: string | null
    internalCode: string | null
    categorySlug: string
    status: string
    confidentiality: string
    worksiteId: string | null
    effectiveFrom: string | null
    expiresAt: string | null
    currentVersionId: string | null
    requiresAcknowledgment: boolean
    uploadedBy: string
    reviewedBy: string | null
    approvedBy: string | null
    responsibleUserId: string | null
    tags: unknown
    updatedAt: string
  }
  versions: Array<{
    id: string
    version: number
    status: string
    fileName: string
    filePath: string
    fileSize: number
    mimeType: string
    checksum: string
    effectiveFrom: string | null
    effectiveTo: string | null
    changelog: string | null
    uploadedBy: string
    reviewedBy: string | null
    approvedBy: string | null
    approvedAt: string | null
    createdAt: string
  }>
  links: Array<{
    id: string
    entityType: string
    entityId: string
    notes: string | null
  }>
  acks: Array<{
    id: string
    versionId: string
    userId: string
    signature: string
    acknowledgedAt: string
  }>
  audit: Array<{
    id: string
    action: string
    fromStatus: string | null
    toStatus: string | null
    comment: string | null
    userId: string | null
    versionId: string | null
    createdAt: string
  }>
}

interface Props {
  bundle: DocumentBundle
  userMap: Record<string, { id: string; name: string; email: string }>
  worksiteMap: Record<string, { id: string; name: string }>
  linkEnrichment: Record<string, Record<string, string>>
  canManage: boolean
  canApprove: boolean
  canArchive: boolean
  canAck: boolean
  canLink: boolean
  currentUserId: string
  currentUserName: string
}

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  observado: "Observado",
  aprobado: "Aprobado",
  vigente: "Vigente",
  vencido: "Vencido",
  reemplazado: "Reemplazado",
  archivado: "Archivado",
}

const STATUS_TONES: Record<string, "default" | "info" | "success" | "warning" | "danger" | "outline"> = {
  borrador: "default",
  en_revision: "info",
  observado: "warning",
  aprobado: "info",
  vigente: "success",
  vencido: "danger",
  reemplazado: "outline",
  archivado: "outline",
}

const LINK_TYPE_LABELS: Record<string, string> = {
  worker: "Trabajador",
  worksite: "Faena",
  vehicle: "Vehículo",
  equipment: "Equipo / maquinaria",
  incident: "Incidente / accidente",
  training: "Capacitación",
  committee: "Comité Paritario",
  epp_delivery: "Entrega EPP",
  corrective_action: "Acción correctiva",
  emergency_plan: "Plan de emergencia",
}

export function DocumentDetailView(props: Props) {
  const { bundle, userMap, worksiteMap, linkEnrichment, canManage, canApprove, canArchive, canAck, canLink, currentUserId, currentUserName } = props
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const doc = bundle.doc
  const currentVersion = bundle.versions.find((v) => v.id === doc.currentVersionId) ?? null
  const isArchived = doc.status === "archivado"

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList>
        <TabsTrigger value="overview">Resumen</TabsTrigger>
        <TabsTrigger value="versions">Versiones ({bundle.versions.length})</TabsTrigger>
        <TabsTrigger value="links">Asociaciones ({bundle.links.length})</TabsTrigger>
        <TabsTrigger value="ack">Acuses ({bundle.acks.length})</TabsTrigger>
        <TabsTrigger value="audit">Bitácora</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Metadata</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Categoría">{doc.categorySlug}</Field>
                <Field label="Estado"><Badge variant={STATUS_TONES[doc.status] ?? "default"}>{STATUS_LABELS[doc.status] ?? doc.status}</Badge></Field>
                <Field label="Confidencialidad">{doc.confidentiality}</Field>
                <Field label="Código interno">{doc.internalCode ?? "—"}</Field>
                <Field label="Faena">{doc.worksiteId ? worksiteMap[doc.worksiteId]?.name ?? doc.worksiteId : "—"}</Field>
                <Field label="Responsable">{doc.responsibleUserId ? userMap[doc.responsibleUserId]?.name ?? "—" : "—"}</Field>
                <Field label="Vigencia desde">{doc.effectiveFrom ?? "—"}</Field>
                <Field label="Vence">{doc.expiresAt ?? "—"}</Field>
                <Field label="Subido por">{userMap[doc.uploadedBy]?.name ?? doc.uploadedBy}</Field>
                <Field label="Aprobado por">{doc.approvedBy ? userMap[doc.approvedBy]?.name ?? doc.approvedBy : "—"}</Field>
                <Field label="Requiere acuse">{doc.requiresAcknowledgment ? "Sí" : "No"}</Field>
                <Field label="Versión vigente">{currentVersion ? `v${currentVersion.version}` : "—"}</Field>
                <Field label="Etiquetas" className="md:col-span-2">
                  {(() => {
                    const tags = Array.isArray(doc.tags) ? (doc.tags as unknown[]).filter((t): t is string => typeof t === "string") : []
                    return tags.length === 0 ? "—" : tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)
                  })()}
                </Field>
                {doc.description ? (
                  <Field label="Descripción" className="md:col-span-2">
                    <p className="text-sm text-[var(--color-text)]">{doc.description}</p>
                  </Field>
                ) : null}
              </CardContent>
            </Card>

            {currentVersion ? (
              <Card>
                <CardHeader>
                  <CardTitle>Archivo vigente · v{currentVersion.version}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm">
                    <p><strong>Nombre:</strong> {currentVersion.fileName}</p>
                    <p><strong>MIME:</strong> {currentVersion.mimeType}</p>
                    <p><strong>Tamaño:</strong> {(currentVersion.fileSize / 1024).toFixed(1)} KB</p>
                    <p><strong>Checksum:</strong> <code className="text-xs">{currentVersion.checksum.slice(0, 32)}…</code></p>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="secondary">
                      <a href={`/api/prevencion/biblioteca/${doc.id}`} target="_blank" rel="noopener noreferrer">
                        <Eye size={14} className="mr-1" /> Ver / previsualizar
                      </a>
                    </Button>
                    <Button asChild variant="secondary">
                      <a href={`/api/prevencion/biblioteca/${doc.id}/version/${currentVersion.id}`} download>
                        Descargar
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-4">
            {canManage && !isArchived ? (
              <Card>
                <CardHeader><CardTitle>Acciones</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {canApprove ? (
                    <>
                      <Button
                        onClick={() => doApprove()}
                        disabled={isPending}
                      >
                        <ThumbsUp size={14} className="mr-1" /> Aprobar y marcar vigente
                      </Button>
                      <ObserveButton documentId={doc.id} onSubmit={doObserve} disabled={isPending} />
                    </>
                  ) : null}
                  {canManage && doc.status === "borrador" ? (
                    <Button
                      variant="secondary"
                      onClick={() => doSendToReview()}
                      disabled={isPending}
                    >
                      <ArrowClockwise size={14} className="mr-1" /> Enviar a revisión
                    </Button>
                  ) : null}
                  {canArchive && !isArchived ? (
                    <ArchiveButton documentId={doc.id} disabled={isPending} onArchived={() => router.refresh()} />
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {canAck && doc.requiresAcknowledgment && currentVersion && !isArchived ? (
              <AckPanel
                documentId={doc.id}
                versionId={currentVersion.id}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                acked={bundle.acks.some((a) => a.versionId === currentVersion.id && a.userId === currentUserId)}
                onAcked={() => router.refresh()}
              />
            ) : null}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="versions">
        <VersionsTab
          versions={bundle.versions}
          userMap={userMap}
          currentVersionId={doc.currentVersionId}
          documentId={doc.id}
          canManage={canManage}
          isArchived={isArchived}
          onUploaded={() => router.refresh()}
        />
      </TabsContent>

      <TabsContent value="links">
        <LinksTab
          documentId={doc.id}
          links={bundle.links}
          linkEnrichment={linkEnrichment}
          worksiteMap={worksiteMap}
          canLink={canLink}
          onChanged={() => router.refresh()}
        />
      </TabsContent>

      <TabsContent value="ack">
        <AcksTab
          versions={bundle.versions}
          acks={bundle.acks}
          userMap={userMap}
          documentId={doc.id}
        />
      </TabsContent>

      <TabsContent value="audit">
        <Card>
          <CardHeader><CardTitle>Bitácora de auditoría</CardTitle></CardHeader>
          <CardContent>
            {bundle.audit.length === 0 ? (
              <EmptyState title="Sin eventos" description="Aún no hay acciones registradas." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>De</TableHead>
                    <TableHead>A</TableHead>
                    <TableHead>Comentario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bundle.audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{a.createdAt.slice(0, 19).replace("T", " ")}</TableCell>
                      <TableCell><Badge variant="outline">{a.action}</Badge></TableCell>
                      <TableCell className="text-xs">{a.userId ? userMap[a.userId]?.name ?? a.userId : "—"}</TableCell>
                      <TableCell className="text-xs">{a.fromStatus ?? "—"}</TableCell>
                      <TableCell className="text-xs">{a.toStatus ?? "—"}</TableCell>
                      <TableCell className="text-xs">{a.comment ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )

  function doObserve(comment: string) {
    if (!comment.trim()) {
      toast.error("El comentario es obligatorio al observar.")
      return
    }
    startTransition(async () => {
      const res = await observeSstDocumentAction({ documentId: doc.id, comment })
      if (res.ok) {
        toast.success(res.message ?? "Documento observado.")
        router.refresh()
      } else {
        toast.error(res.message ?? "Error al observar.")
      }
    })
  }

  function doApprove() {
    startTransition(async () => {
      const res = await approveSstDocumentAction({ documentId: doc.id, comment: "Aprobado desde detalle" })
      if (res.ok) {
        toast.success(res.message ?? "Documento aprobado y vigente.")
        router.refresh()
      } else {
        toast.error(res.message ?? "Error al aprobar.")
      }
    })
  }

  function doSendToReview() {
    startTransition(async () => {
      const res = await changeSstDocumentStatusAction({ documentId: doc.id, toStatus: "en_revision", comment: "Enviado a revisión" })
      if (res.ok) {
        toast.success("Enviado a revisión.")
        router.refresh()
      } else {
        toast.error(res.message ?? "Error al enviar a revisión.")
      }
    })
  }
}

function ArchiveButton({ documentId, disabled, onArchived }: { documentId: string; disabled: boolean; onArchived: () => void }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <Trash size={14} className="mr-1" /> Archivar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Archivar documento"
        description="El documento se marca como archivado. Las versiones aprobadas y vigentes se mantienen como evidencia histórica."
        variant="destructive"
        confirmLabel="Archivar"
        onConfirm={() => {
          startTransition(async () => {
            const res = await archiveSstDocumentAction({ documentId, comment: "Archivado" })
            if (res.ok) {
              toast.success(res.message ?? "Documento archivado.")
              setOpen(false)
              onArchived()
            } else {
              toast.error(res.message ?? "Error al archivar.")
            }
          })
        }}
        loading={isPending}
      />
    </>
  )
}

function ObserveButton({ documentId, onSubmit, disabled }: { documentId: string; onSubmit: (c: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState("")
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <ThumbsDown size={14} className="mr-1" /> Observar
      </Button>
    )
  }
  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Motivo de la observación (obligatorio)"
        rows={3}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSubmit(comment)}>Enviar observación</Button>
        <Button size="sm" variant="secondary" onClick={() => { setOpen(false); setComment("") }}>Cancelar</Button>
      </div>
    </div>
  )
}

function AckPanel({ documentId, versionId, currentUserId, currentUserName, acked, onAcked }: { documentId: string; versionId: string; currentUserId: string; currentUserName: string; acked: boolean; onAcked: () => void }) {
  const [signature, setSignature] = useState(currentUserName)
  const [isPending, startTransition] = useTransition()

  if (acked) {
    return (
      <Card>
        <CardHeader><CardTitle>Acuse de lectura</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm flex items-center gap-2 text-[var(--color-success)]">
            <CheckCircle size={16} /> Acuse registrado para esta versión.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle>Acuse de lectura</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[var(--color-text-subtle)]">
          Al registrar el acuse confirmas que has leído y comprendido este documento.
        </p>
        <Field label="Firma" htmlFor="ack-signature" required>
          <Input id="ack-signature" value={signature} onChange={(e) => setSignature(e.target.value)} />
        </Field>
        <Button
          disabled={isPending || signature.trim().length < 2}
          onClick={() => startTransition(async () => {
            const res = await acknowledgeSstDocumentAction({ versionId, signature: signature.trim() })
            if (res.ok) {
              toast.success(res.message ?? "Acuse registrado.")
              onAcked()
            } else {
              toast.error(res.message ?? "Error al registrar el acuse.")
            }
          })}
        >
          Registrar acuse
        </Button>
      </CardContent>
    </Card>
  )
}

function VersionsTab({ versions, userMap, currentVersionId, documentId, canManage, isArchived, onUploaded }: {
  versions: DocumentBundle["versions"]
  userMap: Props["userMap"]
  currentVersionId: string | null
  documentId: string
  canManage: boolean
  isArchived: boolean
  onUploaded: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [changelog, setChangelog] = useState("")

  return (
    <div className="space-y-4">
      {canManage && !isArchived ? (
        <Card>
          <CardHeader><CardTitle>Subir nueva versión</CardTitle></CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!file) {
                  toast.error("Selecciona un archivo.")
                  return
                }
                const fd = new FormData()
                fd.set("file", file)
                fd.set("documentId", documentId)
                fd.set("changelog", changelog)
                startTransition(async () => {
                  const res = await uploadSstDocumentVersionAction(fd)
                  if (res.ok) {
                    toast.success(res.message ?? "Versión subida.")
                    setFile(null)
                    setChangelog("")
                    onUploaded()
                  } else {
                    toast.error(res.message ?? "Error al subir la versión.")
                  }
                })
              }}
            >
              <Field label="Archivo" htmlFor="version-file" required>
                <Input
                  id="version-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,application/xml"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              <Field label="Motivo del cambio" htmlFor="version-changelog">
                <Textarea
                  id="version-changelog"
                  rows={2}
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  placeholder="Qué cambió respecto a la versión anterior"
                />
              </Field>
              <Button type="submit" disabled={isPending}>
                <UploadSimple size={14} className="mr-1" /> {isPending ? "Subiendo..." : "Subir versión"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Historial de versiones</CardTitle></CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <EmptyState title="Sin versiones" description="Sube la primera versión del documento." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versión</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Subido por</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Changelog</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <span className="font-mono">v{v.version}</span>
                      {v.id === currentVersionId ? <Badge variant="success" className="ml-2">Vigente</Badge> : null}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_TONES[v.status] ?? "default"}>{STATUS_LABELS[v.status] ?? v.status}</Badge></TableCell>
                    <TableCell className="text-xs">{v.fileName}</TableCell>
                    <TableCell className="text-xs">{userMap[v.uploadedBy]?.name ?? v.uploadedBy}</TableCell>
                    <TableCell className="text-xs">{v.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-xs">{v.changelog ?? "—"}</TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="secondary">
                        <a href={`/api/prevencion/biblioteca/${documentId}/version/${v.id}`} download>Descargar</a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LinksTab({ documentId, links, linkEnrichment, worksiteMap, canLink, onChanged }: {
  documentId: string
  links: DocumentBundle["links"]
  linkEnrichment: Props["linkEnrichment"]
  worksiteMap: Props["worksiteMap"]
  canLink: boolean
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [entityType, setEntityType] = useState("worker")
  const [entityId, setEntityId] = useState("")
  const [notes, setNotes] = useState("")

  function labelFor(entityType: string, entityId: string) {
    if (entityType === "worksite") return worksiteMap[entityId]?.name ?? entityId
    return linkEnrichment[entityType]?.[entityId] ?? entityId
  }

  return (
    <div className="space-y-4">
      {canLink ? (
        <Card>
          <CardHeader><CardTitle>Asociar a una entidad</CardTitle></CardHeader>
          <CardContent>
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (!entityId) {
                  toast.error("Indica el id de la entidad.")
                  return
                }
                startTransition(async () => {
                  const res = await linkSstDocumentAction({
                    documentId,
                    entityType: entityType as "worker" | "worksite" | "vehicle" | "equipment" | "incident" | "training" | "committee" | "epp_delivery" | "corrective_action" | "emergency_plan",
                    entityId,
                    notes,
                  })
                  if (res.ok) {
                    toast.success("Asociación creada.")
                    setEntityId("")
                    setNotes("")
                    onChanged()
                  } else {
                    toast.error(res.message ?? "Error al asociar.")
                  }
                })
              }}
            >
              <Field label="Tipo de entidad">
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LINK_TYPE_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ID de la entidad">
                <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="id interno" />
              </Field>
              <Field label="Notas" className="md:col-span-2">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="md:col-span-4 flex justify-end">
                <Button type="submit" disabled={isPending}>Asociar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Entidades asociadas</CardTitle></CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <EmptyState title="Sin asociaciones" description="Asocia este documento a trabajadores, vehículos, faenas, etc." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Entidad</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{LINK_TYPE_LABELS[l.entityType] ?? l.entityType}</TableCell>
                    <TableCell className="text-xs">{labelFor(l.entityType, l.entityId)}</TableCell>
                    <TableCell className="text-xs">{l.notes ?? "—"}</TableCell>
                    <TableCell>
                      {canLink ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => startTransition(async () => {
                            const res = await unlinkSstDocumentAction({ linkId: l.id })
                            if (res.ok) { toast.success("Asociación eliminada."); onChanged() }
                            else { toast.error(res.message ?? "Error") }
                          })}
                        >
                          <X size={12} className="mr-1" /> Quitar
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AcksTab({ versions, acks, userMap, documentId }: {
  versions: DocumentBundle["versions"]
  acks: DocumentBundle["acks"]
  userMap: Props["userMap"]
  documentId: string
}) {
  if (versions.length === 0) {
    return <EmptyState title="Sin versiones" description="No hay acuses registrados." />
  }
  return (
    <Card>
      <CardHeader><CardTitle>Acuses de lectura</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          {versions.map((v) => {
            const vAcks = acks.filter((a) => a.versionId === v.id)
            return (
              <div key={v.id} className="rounded-md border border-[var(--color-border)] p-3">
                <p className="font-medium">v{v.version} — {v.fileName}</p>
                {vAcks.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-subtle)]">Sin acuses.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {vAcks.map((a) => (
                      <li key={a.id}>
                        <strong>{userMap[a.userId]?.name ?? a.userId}</strong> · {a.signature} · {a.acknowledgedAt.slice(0, 19).replace("T", " ")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// (sin tipos pendientes al final del archivo — los tipos están arriba)
