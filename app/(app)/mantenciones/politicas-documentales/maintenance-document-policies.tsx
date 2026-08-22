"use client"

import { useActionState, useState } from "react"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { useOperation } from "@/lib/hooks/use-operation"
import type { ActionState } from "@/lib/validation/masters"
import type { listMaintenanceDocumentPolicies } from "@/lib/services/maintenance"
import { saveMaintenanceDocumentPolicyAction, setMaintenanceDocumentPolicyActiveAction } from "../actions"

type Data = Awaited<ReturnType<typeof listMaintenanceDocumentPolicies>>
const TYPES = [{ value: "quote", label: "Cotización" }, { value: "diagnosis", label: "Diagnóstico" }, { value: "work_order", label: "Orden / acta de taller" }, { value: "invoice", label: "Factura" }, { value: "evidence", label: "Evidencia" }, { value: "other", label: "Otro antecedente" }]
const MOMENTS = [{ value: "before_start", label: "Antes de iniciar la OT" }, { value: "before_complete", label: "Antes de completar la OT" }]

export function MaintenanceDocumentPolicies({ data, canEdit }: { data: Data; canEdit: boolean }) {
  return <PageContainer width="workbench"><PageHeader title="Políticas documentales" description="Documentos obligatorios por clase de activo y momento del flujo de la OT." breadcrumb={<Breadcrumbs items={[{ label: "Mantenciones", href: "/mantenciones" }, { label: "Políticas documentales" }]} />} />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"><Card><CardHeader><CardTitle>Reglas vigentes e históricas</CardTitle></CardHeader><CardContent><div className="space-y-2">{data.policies.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No hay documentos obligatorios configurados.</p> : data.policies.map((policy) => <PolicyRow key={policy.id} policy={policy} canEdit={canEdit} />)}</div></CardContent></Card>{canEdit && <PolicyForm equipmentTypes={data.equipmentTypes} />}</div>
  </PageContainer>
}

function PolicyRow({ policy, canEdit }: { policy: Data["policies"][number]; canEdit: boolean }) {
  const operation = useOperation()
  return <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2"><div><p className="text-sm font-medium">{policy.equipmentType.name} · {TYPES.find((item) => item.value === policy.documentType)?.label ?? policy.documentType}</p><p className="text-xs text-[var(--color-text-muted)]">{MOMENTS.find((item) => item.value === policy.requiredAt)?.label ?? policy.requiredAt}</p></div><div className="flex items-center gap-2"><Badge variant={policy.isActive ? "success" : "outline"}>{policy.isActive ? "Activa" : "Pausada"}</Badge>{canEdit && <Button size="sm" variant="ghost" disabled={operation.pending} onClick={() => operation.run(() => setMaintenanceDocumentPolicyActiveAction({ id: policy.id, active: !policy.isActive }))}>{policy.isActive ? "Pausar" : "Activar"}</Button>}</div></div>
}

function PolicyForm({ equipmentTypes }: { equipmentTypes: Data["equipmentTypes"] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMaintenanceDocumentPolicyAction, { ok: false, message: "" })
  const [equipmentTypeId, setEquipmentTypeId] = useState(equipmentTypes[0]?.id ?? "")
  const [documentType, setDocumentType] = useState("diagnosis")
  const [requiredAt, setRequiredAt] = useState("before_complete")
  return <Card><CardHeader><CardTitle>Nueva regla</CardTitle></CardHeader><CardContent><form action={action} className="space-y-4"><Field label="Clase de activo" htmlFor="policy-equipment"><OptionSelect id="policy-equipment" name="equipmentTypeId" value={equipmentTypeId} onValueChange={setEquipmentTypeId} options={equipmentTypes.map((item) => ({ value: item.id, label: item.name }))} /></Field><Field label="Documento" htmlFor="policy-document"><OptionSelect id="policy-document" name="documentType" value={documentType} onValueChange={setDocumentType} options={TYPES} /></Field><Field label="Obligatorio" htmlFor="policy-moment"><OptionSelect id="policy-moment" name="requiredAt" value={requiredAt} onValueChange={setRequiredAt} options={MOMENTS} /></Field>{state.message && <p role={state.ok ? "status" : "alert"} className="text-sm">{state.message}</p>}<Button type="submit" disabled={pending || !equipmentTypeId}>{pending ? "Guardando…" : "Guardar regla"}</Button></form></CardContent></Card>
}
