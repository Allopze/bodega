"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PPA_STATE_META } from "@/components/states/state-badge"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"
import type { getPreventionPrivacyRequestWorkbench } from "@/lib/services/prevention-privacy-rights"
import { nanoid } from "@/lib/id"
import {
  HEALTH_FITNESS_LABELS,
  HEALTH_RECORD_STATUS_LABELS,
  HEALTH_RECORD_TYPE_LABELS,
  RESERVED_CASE_CATEGORY_LABELS,
  RESERVED_CASE_STATUS_LABELS,
  SST_DOCUMENT_STATUS_LABELS,
  labelOf,
} from "@/lib/prevention/privacy-inventory"

type Bundle = NonNullable<Awaited<ReturnType<typeof getPreventionPrivacyRequestWorkbench>>>
type Domain = "health_record" | "reserved_case" | "ppa" | "document"

interface InventoryRow {
  domain: Domain
  id: string
  label: string
  status: string
}

export function PrivacyRightExecutionWorkbench({ bundle }: { bundle: Bundle }) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<InventoryRow | null>(null)
  const [reason, setReason] = React.useState("")
  const [purposeScope, setPurposeScope] = React.useState("")
  const [changesJson, setChangesJson] = React.useState("{}")
  const [busy, setBusy] = React.useState(false)

  // Quien atiende una solicitud legal decide sobre estos registros: mostrar el
  // enum crudo (`vigente · apto`, `ley_karin · en_investigacion`) le hacía
  // traducir jerga de implementación en el peor momento posible.
  const inventory: InventoryRow[] = [
    ...bundle.inventory.healthRecords.map((row) => ({
      domain: "health_record" as const,
      id: row.id,
      label: `Salud · ${labelOf(HEALTH_RECORD_TYPE_LABELS, row.recordType)}`,
      status: `${labelOf(HEALTH_RECORD_STATUS_LABELS, row.status)} · ${labelOf(HEALTH_FITNESS_LABELS, row.fitnessStatus)}`,
    })),
    ...bundle.inventory.reservedCases.map((row) => ({
      domain: "reserved_case" as const,
      id: row.id,
      label: `Caso reservado · ${row.code}`,
      status: `${labelOf(RESERVED_CASE_CATEGORY_LABELS, row.category)} · ${labelOf(RESERVED_CASE_STATUS_LABELS, row.status)}`,
    })),
    // El PPA es el único dominio cuyo vocabulario ya vive fuera de este módulo:
    // `PPA_STATE_META` es la fuente que usa `StateBadge` en toda la aplicación,
    // así que se reutiliza en vez de escribir un segundo catálogo que podría
    // divergir. Y el identificador se sustituye por la fecha: un UUID no
    // distingue dos PPA para quien atiende la solicitud.
    ...bundle.inventory.ppas.map((row) => ({
      domain: "ppa" as const,
      id: row.id,
      label: `PPA · ${formatDate(row.createdAt)}`,
      status: PPA_STATE_META[row.estado]?.label ?? row.estado,
    })),
    ...bundle.inventory.documentLinks.map((row) => ({
      domain: "document" as const,
      id: row.id,
      label: `Documento · ${row.title}`,
      status: labelOf(SST_DOCUMENT_STATUS_LABELS, row.status),
    })),
  ]
  const operation = bundle.request.rightType as "rectification" | "deletion" | "opposition" | "restriction"
  const executable = ["rectification", "deletion", "opposition", "restriction"].includes(operation)
    && bundle.request.status === "en_proceso"
    && Boolean(bundle.request.identityVerifiedAt)
    && !bundle.request.legalHold

  function openExecution(row: InventoryRow) {
    setSelected(row)
    setReason("")
    setPurposeScope("")
    const initial = operation === "deletion" && row.domain === "reserved_case"
      ? { redactedPayload: {} }
      : operation === "rectification" && row.domain === "reserved_case"
        ? { reservedPayload: {} }
        : {}
    setChangesJson(JSON.stringify(initial, null, 2))
  }

  async function execute() {
    if (!selected) return
    let changes: Record<string, unknown>
    try { changes = JSON.parse(changesJson) as Record<string, unknown> }
    catch { toast.error("El JSON de cambios no es válido."); return }
    setBusy(true)
    try {
      const response = await fetch(`/api/prevencion/privacidad/solicitudes/${bundle.request.id}/execute`, {
        method: "POST",
        // El endpoint exige Idempotency-Key (8-64 chars) y responde 400 sin él.
        headers: { "content-type": "application/json", "idempotency-key": nanoid() },
        body: JSON.stringify({
          domain: selected.domain,
          entityId: selected.id,
          operation,
          reason,
          purposeScope: purposeScope || undefined,
          changes,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? "No se pudo ejecutar el derecho.")
      }
      toast.success("Ejecución aplicada; se guardaron hashes antes/después y actor.")
      setSelected(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo ejecutar el derecho.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader><CardTitle>Inventario vinculado al titular</CardTitle></CardHeader>
        <CardContent>
          {inventory.length === 0 ? (
            <p className="text-sm text-(--color-text-muted)">No hay registros estructuralmente vinculados. Revisa el alcance antes de completar la solicitud.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Dominio</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader>
                <TableBody>{inventory.map((row) => {
                  const rectificationUnsupported = operation === "rectification" && row.domain === "document"
                  return <TableRow key={`${row.domain}:${row.id}`}>
                    <TableCell><p className="font-medium">{row.label}</p><p className="font-mono text-[10px] text-(--color-text-muted)">{row.id}</p></TableCell>
                    <TableCell><Badge variant="outline">{row.status || "Sin estado"}</Badge></TableCell>
                    <TableCell className="text-right">
                      {executable && !rectificationUnsupported ? <Button type="button" size="sm" variant="secondary" onClick={() => openExecution(row)}>Ejecutar</Button> : null}
                    </TableCell>
                  </TableRow>
                })}</TableBody>
              </Table>
            </div>
          )}
          {bundle.restrictedReservedCaseCount > 0 ? (
            // El inventario no puede mentir por omisión: quien atiende la
            // solicitud tiene que saber que existen expedientes reservados
            // aunque no pueda identificarlos ni actuar sobre ellos.
            <p className="mt-3 text-xs text-(--color-text-muted)">
              {bundle.restrictedReservedCaseCount} expediente(s) reservado(s) vinculado(s) al titular no se muestran:
              requieren acceso nominativo al caso. Derívalo a quien integre el comité investigador.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Evidencia de ejecución</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm"><strong>{bundle.executions.length}</strong> ejecución(es) · <strong>{bundle.deliveries.length}</strong> entrega(s)</p>
          {bundle.executions.length === 0 ? <p className="text-xs text-(--color-text-muted)">Aún no hay una mutación demostrable para este derecho.</p> : (
            <ul className="space-y-2">{bundle.executions.map((execution) => (
              <li key={execution.id} className="rounded-md border border-(--color-border) p-2 text-xs">
                <p className="font-medium">{execution.operation} · {execution.domain}</p>
                <p>{execution.createdAt.slice(0, 16).replace("T", " ")} · {execution.outcome}</p>
                <p className="font-mono text-[10px] text-(--color-text-muted)">{execution.beforeHash.slice(0, 10)}… → {execution.afterHash.slice(0, 10)}…</p>
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && !busy && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ejecutar {operation}</DialogTitle>
            <DialogDescription>{selected?.label}. La bitácora guardará hashes y campos afectados, nunca el contenido clínico o reservado.</DialogDescription>
          </DialogHeader>
          <Field label="Motivo y evidencia revisada" htmlFor="privacy-execution-reason" required>
            <Textarea id="privacy-execution-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} disabled={busy} />
          </Field>
          {(operation === "opposition" || operation === "restriction") ? (
            <Field label="Tratamiento o propósito restringido" htmlFor="privacy-purpose-scope" required>
              <Textarea id="privacy-purpose-scope" value={purposeScope} onChange={(event) => setPurposeScope(event.target.value)} maxLength={500} disabled={busy} />
            </Field>
          ) : (
            <Field label="Cambios JSON" htmlFor="privacy-execution-changes">
              <Textarea id="privacy-execution-changes" className="font-mono text-xs" rows={8} value={changesJson} onChange={(event) => setChangesJson(event.target.value)} disabled={busy} />
            </Field>
          )}
          <DialogFooter><Button type="button" onClick={execute} disabled={busy || reason.trim().length < 5 || ((operation === "opposition" || operation === "restriction") && purposeScope.trim().length < 5)}>{busy ? "Aplicando…" : "Aplicar y auditar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
