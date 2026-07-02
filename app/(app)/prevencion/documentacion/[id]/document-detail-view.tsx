"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { ArrowClockwise, Eye, ThumbsUp } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/lib/toast"
import {
  approveSstDocumentAction,
  changeSstDocumentStatusAction,
  observeSstDocumentAction,
} from "../actions"
import type { DetailViewProps } from "./document-detail.helpers"
import { STATUS_LABELS, STATUS_TONES } from "./document-detail.helpers"
import { ArchiveButton } from "./archive-button"
import { ObserveButton } from "./observe-button"
import { AckPanel } from "./ack-panel"
import { VersionsTab } from "./versions-tab"
import { LinksTab } from "./links-tab"
import { AcksTab } from "./acks-tab"

export function DocumentDetailView(props: DetailViewProps) {
  const { bundle, userMap, worksiteMap, canManage, canApprove, canArchive, canAck, canLink, currentUserId, currentUserName } = props
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
                      <a href={`/api/prevencion/documentacion/${doc.id}`} target="_blank" rel="noopener noreferrer">
                        <Eye size={14} className="mr-1" /> Ver / previsualizar
                      </a>
                    </Button>
                    <Button asChild variant="secondary">
                      <a href={`/api/prevencion/documentacion/${doc.id}/version/${currentVersion.id}`} download>
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
                      <Button onClick={() => doApprove()} disabled={isPending}>
                        <ThumbsUp size={14} className="mr-1" /> Aprobar y marcar vigente
                      </Button>
                      <ObserveButton documentId={doc.id} onSubmit={doObserve} disabled={isPending} />
                    </>
                  ) : null}
                  {canManage && doc.status === "borrador" ? (
                    <Button variant="secondary" onClick={() => doSendToReview()} disabled={isPending}>
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
          linkEnrichment={props.linkEnrichment}
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
