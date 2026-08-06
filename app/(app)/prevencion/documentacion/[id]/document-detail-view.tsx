"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { Eye } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/lib/toast"
import { restoreSstDocumentAction } from "../actions"
import type { DetailViewProps } from "./document-detail.helpers"
import { ArchiveButton } from "./archive-button"
import { VersionsTab } from "./versions-tab"
import { DistributionTab } from "./distribution-tab"
import { DocumentLinksCard } from "./document-links-card"

export function DocumentDetailView(props: DetailViewProps) {
  const {
    bundle,
    userMap,
    canManage,
    canArchive,
    canSubmitReview,
    canReview,
    canApprove,
    canPublish,
    currentUserId,
    canDistribute,
    canAck,
    canLink,
    recipientOptions,
    onMutated,
  } = props
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const doc = bundle.doc
  const currentVersion = bundle.versions.find((v) => v.id === doc.currentVersionId) ?? null
  const isArchived = doc.status === "archivado"
  const canPreviewCurrentVersion = currentVersion
    ? currentVersion.mimeType === "application/pdf" || currentVersion.mimeType.startsWith("image/")
    : false
  const hasDistributionTab = doc.requiresAcknowledgment || bundle.distribution.length > 0

  const refresh = () => {
    router.refresh()
    onMutated?.()
  }

  // router.refresh() + loading.tsx remonta el árbol y un Tabs no controlado
  // volvía a "Resumen" tras cada acción de versiones/distribución; la pestaña
  // activa se persiste en sessionStorage para sobrevivir el remount.
  const [tab, setTab] = useState("overview")
  useEffect(() => {
    const stored = sessionStorage.getItem(`sst-doc-tab:${doc.id}`)
    if (stored && (stored !== "distribution" || hasDistributionTab)) setTab(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value)
        sessionStorage.setItem(`sst-doc-tab:${doc.id}`, value)
      }}
      className="space-y-4"
    >
      <TabsList>
        <TabsTrigger value="overview">Resumen</TabsTrigger>
        <TabsTrigger value="versions">Versiones ({bundle.versions.length})</TabsTrigger>
        {hasDistributionTab ? (
          <TabsTrigger value="distribution">Distribución ({bundle.distribution.length})</TabsTrigger>
        ) : null}
      </TabsList>

      <TabsContent value="overview">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {currentVersion ? (
              <Card>
                <CardHeader>
                  <CardTitle>Archivo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {canPreviewCurrentVersion ? (
                    <div className="overflow-hidden rounded-md border border-(--color-border) bg-(--color-chrome)">
                      <iframe
                        title={`Previsualización de ${currentVersion.fileName}`}
                        src={`/api/prevencion/documentacion/${doc.id}`}
                        sandbox=""
                        className="h-[28rem] w-full"
                      />
                    </div>
                  ) : (
                    <div className="rounded-md border border-(--color-border) bg-(--color-chrome) px-4 py-3 text-sm text-[var(--color-text-subtle)]">
                      Vista previa no disponible para este formato. Usa abrir o descargar para revisar el archivo original.
                    </div>
                  )}
                  <div className="text-sm">
                    <p><strong>Nombre:</strong> {currentVersion.fileName}</p>
                    <p><strong>Tamaño:</strong> {(currentVersion.fileSize / 1024).toFixed(1)} KB</p>
                    <p><strong>Versión:</strong> v{currentVersion.version}</p>
                    <p><strong>Subido por:</strong> {userMap[currentVersion.uploadedBy]?.name ?? currentVersion.uploadedBy}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="secondary">
                      <a href={`/api/prevencion/documentacion/${doc.id}`} target="_blank" rel="noopener noreferrer">
                        <Eye size={14} className="mr-1" /> Ver / previsualizar
                      </a>
                    </Button>
                    <Button asChild variant="secondary">
                      <a href={`/api/prevencion/documentacion/${doc.id}?download=1`}>
                        Descargar archivo
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-4">
            {(canLink || bundle.links.length > 0) && (
              <DocumentLinksCard documentId={doc.id} links={bundle.links} canLink={canLink} onMutated={onMutated} />
            )}
            {(canArchive || canManage) ? (
              <Card>
                <CardHeader><CardTitle>Acciones de archivo</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {isArchived && canArchive ? (
                    <Button variant="secondary" onClick={() => doRestore()} disabled={isPending}>
                      Restaurar documento
                    </Button>
                  ) : null}
                  {canArchive && !isArchived ? (
                    <ArchiveButton documentId={doc.id} disabled={isPending} onArchived={refresh} />
                  ) : null}
                </CardContent>
              </Card>
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
          permissions={{
            manage: canManage,
            submitReview: canSubmitReview,
            review: canReview,
            approve: canApprove,
            publish: canPublish,
          }}
          currentUserId={currentUserId}
          isArchived={isArchived}
          onUploaded={refresh}
        />
      </TabsContent>

      {hasDistributionTab ? (
        <TabsContent value="distribution">
          <DistributionTab
            documentId={doc.id}
            currentVersionId={doc.currentVersionId}
            distribution={bundle.distribution}
            acks={bundle.acks}
            userMap={userMap}
            recipientOptions={recipientOptions}
            currentUserId={currentUserId}
            canDistribute={canDistribute}
            canAck={canAck}
            isArchived={isArchived}
            onChanged={refresh}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  )

  function doRestore() {
    startTransition(async () => {
      const res = await restoreSstDocumentAction({ documentId: doc.id, comment: "Restaurado desde detalle" })
      if (res.ok) {
        toast.success(res.message ?? "Documento restaurado.")
        refresh()
      } else {
        toast.error(res.message ?? "Error al restaurar.")
      }
    })
  }
}
