"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import type { DocumentIntegrityFinding, DocumentIntegrityResolutionAction } from "@/lib/services/prevention-documents-library"
import { regularizeSstDocumentIntegrityAction, removeSstDocumentLinkAction } from "../actions"

interface Resolution {
  action: DocumentIntegrityResolutionAction
  label: string
  requiresSelection?: boolean
  selectionPrompt?: string
}

const RESOLUTIONS: Partial<Record<DocumentIntegrityFinding["code"], Resolution>> = {
  DRAFT_WITH_PUBLISHED_VERSION: { action: "restore_published_document", label: "Restaurar publicación" },
  PUBLISHED_WITHOUT_APPROVER: { action: "retire_unapproved_version", label: "Retirar versión" },
  CURRENT_VERSION_MISSING: { action: "clear_invalid_current_version", label: "Limpiar referencia" },
  CURRENT_VERSION_NOT_PUBLISHED: { action: "clear_invalid_current_version", label: "Limpiar referencia" },
  MULTIPLE_PUBLISHED_VERSIONS: {
    action: "choose_authoritative_version",
    label: "Elegir versión válida",
    requiresSelection: true,
    selectionPrompt: "ID exacto de la versión vigente aprobada que se conservará:",
  },
  REPLACED_WITHOUT_SUCCESSOR: {
    action: "link_successor",
    label: "Vincular sucesora",
    requiresSelection: true,
    selectionPrompt: "ID exacto de la versión posterior que reemplaza a esta versión:",
  },
}

export function DocumentIntegrityWorkbench({ findings }: { findings: DocumentIntegrityFinding[] }) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)

  async function regularize(finding: DocumentIntegrityFinding) {
    const resolution = RESOLUTIONS[finding.code]
    if (!resolution) return
    const selectedVersionId = resolution.requiresSelection
      ? window.prompt(resolution.selectionPrompt ?? "ID de versión:")?.trim()
      : null
    if (resolution.requiresSelection && !selectedVersionId) return
    const reason = window.prompt("Motivo y evidencia revisada para esta regularización:")?.trim()
    if (!reason) return
    const key = `${finding.documentId}:${finding.code}:${finding.versionId ?? ""}`
    setPendingKey(key)
    const result = await regularizeSstDocumentIntegrityAction({
      documentId: finding.documentId,
      findingCode: finding.code,
      action: resolution.action,
      versionId: finding.versionId,
      selectedVersionId,
      reason,
    })
    setPendingKey(null)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo regularizar el hallazgo.")
      return
    }
    toast.success(result.message ?? "Regularización aplicada.")
    router.refresh()
  }

  async function removeInvalidLink(finding: DocumentIntegrityFinding) {
    if (!finding.linkId) return
    const reason = window.prompt("Motivo y evidencia para retirar el vínculo inválido:")?.trim()
    if (!reason) return
    const key = `${finding.documentId}:${finding.code}:${finding.linkId}`
    setPendingKey(key)
    const result = await removeSstDocumentLinkAction({ documentId: finding.documentId, linkId: finding.linkId, reason })
    setPendingKey(null)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo retirar el vínculo.")
      return
    }
    toast.success(result.message ?? "Vínculo retirado.")
    router.refresh()
  }

  async function relocateSensitiveDocument(finding: DocumentIntegrityFinding) {
    if (!finding.versionId) {
      toast.error("El hallazgo no identifica una versión para reubicar.")
      return
    }
    const targetDomainInput = window.prompt("Destino seguro: escribe health o reserved_case")?.trim()
    if (!targetDomainInput || !["health", "reserved_case"].includes(targetDomainInput)) return
    const targetEntityId = window.prompt("ID exacto del registro de salud o caso reservado de destino:")?.trim()
    if (!targetEntityId) return
    const reason = window.prompt("Motivo, dueño y cadena de custodia revisada para la reubicación:")?.trim()
    if (!reason) return
    const key = `${finding.documentId}:${finding.code}:${finding.versionId}`
    setPendingKey(key)
    try {
      const response = await fetch(`/api/prevencion/documentacion/${finding.documentId}/relocate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versionId: finding.versionId,
          targetDomain: targetDomainInput,
          targetEntityId,
          reason,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? "No se pudo reubicar el expediente.")
      }
      toast.success("Copia cifrada verificada y fuente general restringida.")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo reubicar el expediente.")
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Severidad</TableHead>
            <TableHead>Documento</TableHead>
            <TableHead>Hallazgo</TableHead>
            <TableHead>Acción requerida</TableHead>
            <TableHead className="text-right">Resolver</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {findings.map((finding, index) => {
            const key = `${finding.documentId}:${finding.code}:${finding.versionId ?? finding.linkId ?? index}`
            const resolution = RESOLUTIONS[finding.code]
            const removableLink = ["LINKED_ENTITY_MISSING", "LINK_TARGET_UNVERIFIED", "LINK_TARGET_SCOPE_MISMATCH"].includes(finding.code)
            const relocatable = ["PROHIBITED_SENSITIVE_CONTENT", "SENSITIVE_GENERAL_LIBRARY_REVIEW"].includes(finding.code)
            return (
              <TableRow key={key}>
                <TableCell>
                  <MetaBadge meta={{ label: `${finding.severity === "critico" ? "Crítico" : "Alto"}`, variant: finding.severity === "critico" ? "danger" : "warning" }} />
                </TableCell>
                <TableCell className="min-w-56">
                  <Link className="font-medium text-[var(--color-primary)] hover:underline" href={`/prevencion/documentacion/${finding.documentId}`}>
                    {finding.documentTitle}
                  </Link>
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">{finding.code}</p>
                </TableCell>
                <TableCell className="min-w-80 text-sm">{finding.detail}</TableCell>
                <TableCell className="min-w-96 text-sm text-[var(--color-text-muted)]">{finding.recommendedAction}</TableCell>
                <TableCell className="min-w-44 text-right">
                  {resolution ? (
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(pendingKey)} onClick={() => regularize(finding)}>
                      {pendingKey === key ? "Aplicando…" : resolution.label}
                    </Button>
                  ) : removableLink ? (
                    <Button type="button" size="sm" variant="destructive" disabled={Boolean(pendingKey)} onClick={() => removeInvalidLink(finding)}>
                      {pendingKey === key ? "Retirando…" : "Retirar vínculo"}
                    </Button>
                  ) : relocatable ? (
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(pendingKey)} onClick={() => relocateSensitiveDocument(finding)}>
                      {pendingKey === key ? "Cifrando…" : "Reubicar cifrado"}
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="ghost"><Link href={`/prevencion/documentacion/${finding.documentId}`}>Abrir expediente</Link></Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
