"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { isValidReason, REASON_MAX_LENGTH, REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"
import { MetaBadge } from "@/components/states/state-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import type { DocumentIntegrityFinding, DocumentIntegrityResolutionAction } from "@/lib/services/prevention-documents-library"
import { regularizeSstDocumentIntegrityAction, removeSstDocumentLinkAction } from "../actions"

interface Resolution {
  action: DocumentIntegrityResolutionAction
  label: string
  requiresSelection?: boolean
  /** Etiqueta del campo de versión cuando la resolución exige elegir una. */
  selectionLabel?: string
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
    selectionLabel: "ID exacto de la versión vigente aprobada que se conservará",
  },
  REPLACED_WITHOUT_SUCCESSOR: {
    action: "link_successor",
    label: "Vincular sucesora",
    requiresSelection: true,
    selectionLabel: "ID exacto de la versión posterior que la reemplaza",
  },
}

type ResolveKind = "regularize" | "link" | "relocate"

/** Hallazgo abierto en el diálogo de resolución, con lo que se va a hacer con él. */
interface Resolving {
  kind: ResolveKind
  finding: DocumentIntegrityFinding
  key: string
}

const REASON_LABELS: Record<ResolveKind, string> = {
  regularize: "Motivo y evidencia revisada",
  link: "Motivo y evidencia para retirar el vínculo",
  relocate: "Motivo, dueño y cadena de custodia revisada",
}

const DIALOG_TITLES: Record<ResolveKind, string> = {
  regularize: "Regularizar hallazgo",
  link: "Retirar vínculo inválido",
  relocate: "Reubicar expediente cifrado",
}

export function DocumentIntegrityWorkbench({ findings }: { findings: DocumentIntegrityFinding[] }) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  // Antes cada resolución encadenaba hasta tres `window.prompt` —ID de versión,
  // destino y motivo— sin etiqueta, sin poder corregir un paso anterior y con
  // el destino escrito a mano («health» o «reserved_case»). Ahora es un solo
  // diálogo con todos los campos a la vista y un selector para el destino.
  const [resolving, setResolving] = React.useState<Resolving | null>(null)
  const [selectedVersionId, setSelectedVersionId] = React.useState("")
  const [targetDomain, setTargetDomain] = React.useState<"" | "health" | "reserved_case">("")
  const [targetEntityId, setTargetEntityId] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [dialogError, setDialogError] = React.useState<string | null>(null)

  function openResolution(kind: ResolveKind, finding: DocumentIntegrityFinding, key: string) {
    setSelectedVersionId("")
    setTargetDomain("")
    setTargetEntityId("")
    setReason("")
    setDialogError(null)
    setResolving({ kind, finding, key })
  }

  const resolution = resolving?.kind === "regularize" ? RESOLUTIONS[resolving.finding.code] : undefined
  const needsVersion = Boolean(resolution?.requiresSelection)
  const reasonOk = isValidReason(reason)
  const canSubmit = reasonOk
    && (!needsVersion || selectedVersionId.trim().length > 0)
    && (resolving?.kind !== "relocate" || (targetDomain !== "" && targetEntityId.trim().length > 0))

  async function submit() {
    if (!resolving || !canSubmit) return
    const { kind, finding, key } = resolving
    setPendingKey(key)
    setDialogError(null)
    const ok = kind === "regularize"
      ? await regularize(finding)
      : kind === "link"
        ? await removeInvalidLink(finding)
        : await relocateSensitiveDocument(finding)
    setPendingKey(null)
    if (ok) {
      setResolving(null)
      router.refresh()
    }
  }

  async function regularize(finding: DocumentIntegrityFinding): Promise<boolean> {
    const current = RESOLUTIONS[finding.code]
    if (!current) return false
    const result = await regularizeSstDocumentIntegrityAction({
      documentId: finding.documentId,
      findingCode: finding.code,
      action: current.action,
      versionId: finding.versionId,
      selectedVersionId: current.requiresSelection ? selectedVersionId.trim() : null,
      reason: reason.trim(),
    })
    if (!result.ok) {
      setDialogError(result.message ?? "No se pudo regularizar el hallazgo.")
      return false
    }
    toast.success(result.message ?? "Regularización aplicada.")
    return true
  }

  async function removeInvalidLink(finding: DocumentIntegrityFinding): Promise<boolean> {
    if (!finding.linkId) return false
    const result = await removeSstDocumentLinkAction({ documentId: finding.documentId, linkId: finding.linkId, reason: reason.trim() })
    if (!result.ok) {
      setDialogError(result.message ?? "No se pudo retirar el vínculo.")
      return false
    }
    toast.success(result.message ?? "Vínculo retirado.")
    return true
  }

  async function relocateSensitiveDocument(finding: DocumentIntegrityFinding): Promise<boolean> {
    if (!finding.versionId) {
      setDialogError("El hallazgo no identifica una versión para reubicar.")
      return false
    }
    try {
      const response = await fetch(`/api/prevencion/documentacion/${finding.documentId}/relocate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versionId: finding.versionId,
          targetDomain,
          targetEntityId: targetEntityId.trim(),
          reason: reason.trim(),
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? "No se pudo reubicar el expediente.")
      }
      toast.success("Copia cifrada verificada y fuente general restringida.")
      return true
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "No se pudo reubicar el expediente.")
      return false
    }
  }

  const busy = Boolean(resolving && pendingKey === resolving.key)

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
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(pendingKey)} onClick={() => openResolution("regularize", finding, key)}>
                      {pendingKey === key ? "Aplicando…" : resolution.label}
                    </Button>
                  ) : removableLink ? (
                    <Button type="button" size="sm" variant="destructive" disabled={Boolean(pendingKey)} onClick={() => openResolution("link", finding, key)}>
                      {pendingKey === key ? "Retirando…" : "Retirar vínculo"}
                    </Button>
                  ) : relocatable ? (
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(pendingKey)} onClick={() => openResolution("relocate", finding, key)}>
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

      <Dialog open={resolving !== null} onOpenChange={(value) => { if (!value && !busy) setResolving(null) }}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => { event.preventDefault(); void submit() }}
          >
            <DialogHeader>
              <DialogTitle>{resolving ? DIALOG_TITLES[resolving.kind] : ""}</DialogTitle>
              <DialogDescription>
                {resolving ? `${resolving.finding.documentTitle} · ${resolving.finding.detail}` : ""}
              </DialogDescription>
            </DialogHeader>
            {needsVersion ? (
              <Field label={resolution?.selectionLabel ?? "ID de versión"} htmlFor="integrity-version-id" required>
                <Input id="integrity-version-id" value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)} maxLength={160} autoComplete="off" />
              </Field>
            ) : null}
            {resolving?.kind === "relocate" ? (
              <>
                <Field label="Destino seguro" htmlFor="integrity-target-domain" required>
                  <Select value={targetDomain} onValueChange={(value) => setTargetDomain(value as "health" | "reserved_case")}>
                    <SelectTrigger id="integrity-target-domain"><SelectValue placeholder="Selecciona el destino" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="health">Registro de salud</SelectItem>
                      <SelectItem value="reserved_case">Caso reservado</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="ID exacto del registro de destino" htmlFor="integrity-target-entity" required>
                  <Input id="integrity-target-entity" value={targetEntityId} onChange={(event) => setTargetEntityId(event.target.value)} maxLength={160} autoComplete="off" />
                </Field>
              </>
            ) : null}
            <Field
              label={resolving ? REASON_LABELS[resolving.kind] : "Motivo"}
              htmlFor="integrity-reason"
              required
              hint={`Mínimo ${REASON_MIN_LENGTH} caracteres.`}
            >
              <Textarea id="integrity-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={REASON_MAX_LENGTH} />
            </Field>
            {dialogError ? <p role="alert" className="text-sm text-[var(--color-danger)]">{dialogError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setResolving(null)} disabled={busy}>Cancelar</Button>
              <Button
                type="submit"
                variant={resolving?.kind === "link" ? "destructive" : "primary"}
                loading={busy}
                disabled={!canSubmit}
              >
                {resolving?.kind === "regularize" ? (resolution?.label ?? "Aplicar") : resolving?.kind === "link" ? "Retirar vínculo" : "Reubicar cifrado"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
