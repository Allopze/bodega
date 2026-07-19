"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DownloadSimple, ShieldWarning } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

interface PrivacyRequestRow {
  id: string
  subjectWorkerId: string
  subjectName: string
  subjectRut: string | null
  worksiteName: string
  rightType: string
  status: string
  requestScope: string
  receivedAt: string
  dueAt: string | null
  legalHold: boolean
  legalHoldReason: string | null
  identityVerifiedAt: string | null
}

interface Props {
  rows: PrivacyRequestRow[]
  canExport: boolean
  canExportClinical: boolean
}

const STATUS: Record<string, { label: string; variant: "default" | "warning" | "success" | "danger" | "info" }> = {
  recibida: { label: "Recibida", variant: "default" },
  validando_identidad: { label: "Validando identidad", variant: "warning" },
  en_proceso: { label: "En proceso", variant: "info" },
  suspendida_retencion: { label: "Retención legal", variant: "danger" },
  completada: { label: "Completada", variant: "success" },
  rechazada: { label: "Rechazada", variant: "danger" },
}

const RIGHTS: Record<string, string> = {
  access: "Acceso",
  rectification: "Rectificación",
  deletion: "Supresión",
  opposition: "Oposición",
  portability: "Portabilidad",
  restriction: "Restricción",
}

type PendingAction = {
  row: PrivacyRequestRow
  toStatus: string
  title: string
  description: string
  releaseLegalHold?: boolean
  reasonRequired?: boolean
}

export function PrivacyRequestsWorkbench({ rows, canExport, canExportClinical }: Props) {
  const router = useRouter()
  const { searchQuery } = useSafeShellHeader()
  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null)
  const [reason, setReason] = React.useState("")
  const [exportRow, setExportRow] = React.useState<PrivacyRequestRow | null>(null)
  const [exportPurpose, setExportPurpose] = React.useState("")
  const [includeClinical, setIncludeClinical] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("es")
    if (!query) return rows
    return rows.filter((row) => [row.id, row.subjectName, row.subjectRut, row.worksiteName, RIGHTS[row.rightType], STATUS[row.status]?.label]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase("es").includes(query)))
  }, [rows, searchQuery])

  function quickAction(row: PrivacyRequestRow): PendingAction | null {
    if (row.status === "recibida") return {
      row, toStatus: "validando_identidad", title: "Iniciar validación de identidad",
      description: "La solicitud no podrá procesarse ni exportarse hasta confirmar la identidad.",
    }
    if (row.status === "validando_identidad") return {
      row, toStatus: "en_proceso", title: "Confirmar identidad",
      description: "Esta acción registra tu usuario y la fecha como evidencia de verificación.",
    }
    if (row.status === "suspendida_retencion") return {
      row, toStatus: "en_proceso", title: "Liberar retención legal",
      description: "Confirma que terminó la causal de retención antes de continuar.", releaseLegalHold: true, reasonRequired: true,
    }
    return null
  }

  async function transition() {
    if (!pendingAction) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/prevencion/privacidad/solicitudes/${pendingAction.row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toStatus: pendingAction.toStatus,
          reason: reason.trim() || undefined,
          releaseLegalHold: pendingAction.releaseLegalHold,
        }),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar la solicitud.")
      setPendingAction(null)
      setReason("")
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar la solicitud.")
    } finally {
      setBusy(false)
    }
  }

  function openTerminal(row: PrivacyRequestRow, toStatus: "completada" | "rechazada" | "suspendida_retencion") {
    const config: readonly [string, string] = toStatus === "completada"
      ? ["Completar solicitud", "Registra cómo se ejecutó el derecho y entregó la respuesta."]
      : toStatus === "rechazada"
        ? ["Rechazar solicitud", "Fundamenta el rechazo sin copiar datos sensibles al motivo."]
        : ["Aplicar retención legal", "Fundamenta por qué el tratamiento o eliminación debe suspenderse."]
    setReason("")
    setError(null)
    setPendingAction({ row, toStatus, title: config[0], description: config[1], reasonRequired: true })
  }

  function startExport() {
    if (!exportRow || exportPurpose.trim().length < 3) return
    const query = new URLSearchParams({ purpose: exportPurpose.trim() })
    if (includeClinical) query.set("includeClinical", "1")
    window.location.assign(`/api/prevencion/privacidad/solicitudes/${exportRow.id}/export?${query}`)
    setExportRow(null)
    setExportPurpose("")
    setIncludeClinical(false)
  }

  if (rows.length === 0) {
    return <EmptyState icon={<ShieldWarning size={24} />} title="No hay solicitudes registradas" description="Registra la primera solicitud desde la acción del encabezado; comenzará en validación pendiente." />
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Titular</TableHead><TableHead>Derecho</TableHead><TableHead>Estado</TableHead>
            <TableHead>Recepción</TableHead><TableHead>Alcance</TableHead><TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>{filtered.map((row) => {
            const next = quickAction(row)
            const exportable = canExport && row.identityVerifiedAt && ["en_proceso", "completada"].includes(row.status)
              && ["access", "portability"].includes(row.rightType)
            return (
              <TableRow key={row.id}>
                <TableCell><div className="font-medium">{row.subjectName}</div><div className="text-xs text-[var(--color-text-subtle)]">{row.subjectRut ?? "Sin RUT"} · {row.worksiteName}</div></TableCell>
                <TableCell>{RIGHTS[row.rightType] ?? row.rightType}</TableCell>
                <TableCell><Badge variant={STATUS[row.status]?.variant ?? "default"}>{STATUS[row.status]?.label ?? row.status}</Badge></TableCell>
                <TableCell className="text-xs">{row.receivedAt.slice(0, 10)}{row.dueAt ? <div>Vence {row.dueAt.slice(0, 10)}</div> : null}</TableCell>
                <TableCell className="max-w-sm text-xs">{row.requestScope}</TableCell>
                <TableCell><div className="flex justify-end gap-1.5">
                  <Button asChild type="button" size="sm" variant="ghost"><Link href={`/prevencion/privacidad/solicitudes/${row.id}`}>Gestionar</Link></Button>
                  {next && <Button type="button" size="sm" variant="secondary" onClick={() => { setReason(""); setError(null); setPendingAction(next) }}>{next.title}</Button>}
                  {row.status === "en_proceso" && !row.legalHold && <Button type="button" size="sm" variant="secondary" onClick={() => openTerminal(row, "suspendida_retencion")}>Retener</Button>}
                  {row.status === "en_proceso" && <Button type="button" size="sm" onClick={() => openTerminal(row, "completada")}>Completar</Button>}
                  {["recibida", "validando_identidad", "en_proceso", "suspendida_retencion"].includes(row.status) && <Button type="button" size="sm" variant="ghost" onClick={() => openTerminal(row, "rechazada")}>Rechazar</Button>}
                  {exportable && <Button type="button" size="sm" variant="secondary" onClick={() => { setExportRow(row); setExportPurpose(""); setIncludeClinical(false) }}><DownloadSimple size={15} className="mr-1" />Exportar</Button>}
                </div></TableCell>
              </TableRow>
            )
          })}</TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(pendingAction)} onOpenChange={(open) => !open && !busy && setPendingAction(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{pendingAction?.title}</DialogTitle><DialogDescription>{pendingAction?.description}</DialogDescription></DialogHeader>
          {pendingAction?.reasonRequired && <Field label="Motivo" htmlFor="privacy-transition-reason" required>
            <Textarea id="privacy-transition-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} disabled={busy} />
          </Field>}
          {error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
          <DialogFooter><Button type="button" onClick={transition} disabled={busy || Boolean(pendingAction?.reasonRequired && reason.trim().length < 5)}>{busy ? "Guardando…" : "Confirmar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(exportRow)} onOpenChange={(open) => !open && setExportRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Exportar datos del titular</DialogTitle><DialogDescription>La identidad ya fue validada. La entrega se registrará con checksum y quedará fuera de caché.</DialogDescription></DialogHeader>
          <Field label="Propósito de la entrega" htmlFor="privacy-export-purpose" required>
            <Textarea id="privacy-export-purpose" value={exportPurpose} onChange={(event) => setExportPurpose(event.target.value)} maxLength={300} />
          </Field>
          {canExportClinical && <Checkbox id="privacy-export-clinical" label="Incluir contenido clínico (requiere canal de entrega reforzado)" checked={includeClinical} onChange={(event) => setIncludeClinical(event.target.checked)} />}
          <DialogFooter><Button type="button" onClick={startExport} disabled={exportPurpose.trim().length < 3}>Generar XLSX auditado</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
