"use client"

import { useActionState, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowSquareOut, CheckCircle, Scan, ShieldCheck } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import type { OperationalIntegrityCaseDto } from "@/lib/services/operational-integrity"
import {
  acknowledgeOperationalIntegrityCaseAction,
  scanOperationalIntegrityAction,
  verifyOperationalIntegrityCaseAction,
  type TraceabilityIntegrityActionState,
} from "../actions"

const INITIAL_STATE: TraceabilityIntegrityActionState = { ok: false, message: "" }

const DOMAIN_LABELS: Record<OperationalIntegrityCaseDto["domain"], string> = {
  stock: "Bodega",
  receiving: "Recepción",
  purchasing: "Compras",
}

const SEVERITY_LABELS: Record<OperationalIntegrityCaseDto["severity"], string> = {
  critical: "Crítico",
  high: "Alto",
  warning: "Advertencia",
}

const SEVERITY_VARIANTS: Record<OperationalIntegrityCaseDto["severity"], "danger" | "warning" | "neutral"> = {
  critical: "danger",
  high: "warning",
  warning: "neutral",
}

const STATE_LABELS: Record<OperationalIntegrityCaseDto["state"], string> = {
  open: "Pendiente",
  acknowledged: "Reconocido",
  verified_resolved: "Resuelto",
}

const STATE_VARIANTS: Record<OperationalIntegrityCaseDto["state"], "signal" | "warning" | "success"> = {
  open: "signal",
  acknowledged: "warning",
  verified_resolved: "success",
}

export interface OperationalIntegrityFilterState {
  faena: string
  dominio: string
  severidad: string
  estado: string
}

interface Props {
  cases: OperationalIntegrityCaseDto[]
  canReconcile: boolean
  filters: OperationalIntegrityFilterState
  worksites?: Array<{ id: string; name: string }>
}

/**
 * Los enlaces de métrica conservan la faena y la pestaña: cambiar de métrica no
 * puede sacar a nadie de su alcance ni devolverlo a la vista de seguimiento.
 */
function metricHref(filters: OperationalIntegrityFilterState, patch: Partial<Record<"estado" | "severidad" | "dominio", string>>) {
  const params = new URLSearchParams({ tab: "integridad" })
  if (filters.faena) params.set("faena", filters.faena)
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  return `/bodega/trazabilidad?${params.toString()}`
}

export function OperationalIntegrityWorkbench({ cases, canReconcile, filters, worksites = [] }: Props) {
  const { setFilter } = useUrlFilters()
  const [scanState, scanAction, scanPending] = useActionState(scanOperationalIntegrityAction, INITIAL_STATE)

  useEffect(() => {
    if (!scanState.message) return
    if (scanState.ok) toast.success(scanState.message)
    else toast.error(scanState.message)
  }, [scanState])

  const active = cases.filter((row) => row.state !== "verified_resolved")
  const metrics = [
    { key: "open", label: "Pendientes", count: cases.filter((row) => row.state === "open").length, patch: { estado: "open" } },
    // Críticos mide riesgo vivo: un caso ya resuelto no debe seguir alarmando.
    { key: "critical", label: "Críticos", count: active.filter((row) => row.severity === "critical").length, patch: { severidad: "critical", estado: "active" } },
    { key: "acknowledged", label: "Reconocidos", count: cases.filter((row) => row.state === "acknowledged").length, patch: { estado: "acknowledged" } },
    { key: "resolved", label: "Resueltos", count: cases.filter((row) => row.state === "verified_resolved").length, patch: { estado: "verified_resolved" } },
  ]

  const scanButton = canReconcile && (
    <form action={scanAction}>
      <Button size="sm" type="submit" variant="secondary" disabled={scanPending}>
        <Scan size={15} aria-hidden />
        {scanPending ? "Revisando…" : "Revisar integridad"}
      </Button>
    </form>
  )

  return (
    <section className="mb-4 rounded-(--radius-2xl) border border-(--color-border) bg-(--color-surface) p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
            <ShieldCheck weight="fill" className="h-4 w-4" aria-hidden />
            Integridad operacional
          </h2>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            Casos detectados en bodega, recepción y compras. Un caso sólo se cierra cuando el detector deja de encontrarlo.
          </p>
        </div>
        {scanButton}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((metric) => (
          <Link
            key={metric.key}
            href={metricHref(filters, metric.patch)}
            className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) px-3 py-2 transition-colors hover:border-(--color-primary)"
          >
            <span className="block text-[11px] text-(--color-text-muted)">{metric.label}</span>
            <span className="block text-lg font-semibold text-(--color-text)">{metric.count}</span>
          </Link>
        ))}
      </div>

      <div
        role="group"
        aria-label="Filtros de integridad"
        className="mt-3 grid gap-2 border-t border-(--color-border) pt-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Field label="Dominio" htmlFor="integridad-dominio">
          <OptionSelect
            id="integridad-dominio"
            value={filters.dominio}
            onValueChange={(value) => setFilter("dominio", value)}
            emptyLabel="Todos los dominios"
            options={Object.entries(DOMAIN_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Severidad" htmlFor="integridad-severidad">
          <OptionSelect
            id="integridad-severidad"
            value={filters.severidad}
            onValueChange={(value) => setFilter("severidad", value)}
            emptyLabel="Todas las severidades"
            options={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Estado" htmlFor="integridad-estado">
          <OptionSelect
            id="integridad-estado"
            value={filters.estado}
            onValueChange={(value) => setFilter("estado", value)}
            emptyLabel="Todos los estados"
            options={[
              { value: "active", label: "Sin resolver" },
              ...Object.entries(STATE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </Field>
        <Field label="Faena" htmlFor="integridad-faena">
          <OptionSelect
            id="integridad-faena"
            value={filters.faena}
            onValueChange={(value) => setFilter("faena", value)}
            emptyLabel="Todas mis faenas"
            options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
          />
        </Field>
      </div>

      {cases.length === 0 ? (
        <p className="mt-4 text-xs text-(--color-text-muted)">
          Sin casos de integridad en este alcance.{" "}
          {canReconcile
            ? "Revisa la integridad para buscar diferencias entre el kardex, las recepciones y las facturas."
            : "Se listarán aquí en cuanto alguien con permiso ejecute una revisión."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {cases.map((row) => (
            <li key={row.id} className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-(--color-text)">{row.summary}</p>
                  {row.productName && (
                    <p className="mt-0.5 truncate text-[11px] text-(--color-text-subtle)">
                      <span>{row.productName}</span>
                      {row.sku && <span> · {row.sku}</span>}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-(--color-text-subtle)">
                    {DOMAIN_LABELS[row.domain]} · observado {formatDateTime(row.observedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant={SEVERITY_VARIANTS[row.severity]}>{SEVERITY_LABELS[row.severity]}</Badge>
                  <Badge variant={STATE_VARIANTS[row.state]}>{STATE_LABELS[row.state]}</Badge>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Link
                  href={row.href}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-(--color-primary) hover:underline underline-offset-2"
                >
                  <ArrowSquareOut size={13} aria-hidden />
                  Ver evidencia
                </Link>
                {canReconcile && row.state !== "verified_resolved" && <VerifyCaseButton caseId={row.id} />}
              </div>

              {canReconcile && row.state === "open" && <AcknowledgeCaseForm caseId={row.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Verificar no cierra el caso por sí solo: vuelve a correr el detector del
 * dominio y sólo lo resuelve si la evidencia ya no aparece. Por eso el botón
 * nunca ofrece "marcar como resuelto".
 */
function VerifyCaseButton({ caseId }: { caseId: string }) {
  const [state, action, pending] = useActionState(verifyOperationalIntegrityCaseAction, INITIAL_STATE)

  useEffect(() => {
    if (!state.message) return
    if (state.ok) toast.success(state.message)
    else toast.error(state.message)
  }, [state])

  return (
    <form action={action}>
      <input name="caseId" type="hidden" value={caseId} />
      <Button size="sm" type="submit" variant="ghost" disabled={pending}>
        <CheckCircle size={14} aria-hidden />
        {pending ? "Verificando…" : "Verificar corrección"}
      </Button>
    </form>
  )
}

function AcknowledgeCaseForm({ caseId }: { caseId: string }) {
  const [state, action, pending] = useActionState(acknowledgeOperationalIntegrityCaseAction, INITIAL_STATE)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!state.message) return
    if (state.ok) {
      toast.success(state.message)
      setOpen(false)
    } else toast.error(state.message)
  }, [state])

  if (!open) {
    return (
      <div className="mt-2">
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(true)}>
          Reconocer caso
        </Button>
      </div>
    )
  }

  return (
    <form action={action} className="mt-3 grid gap-2 border-t border-(--color-border) pt-3">
      <input name="caseId" type="hidden" value={caseId} />
      <Field
        label="Motivo"
        htmlFor={`integridad-motivo-${caseId}`}
        hint="Obligatorio; queda como evidencia append-only junto a la observación vigente."
        required
      >
        <Textarea
          id={`integridad-motivo-${caseId}`}
          name="reason"
          minLength={10}
          maxLength={2000}
          required
          placeholder="Explica qué se revisó y por qué el caso queda reconocido…"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Guardando…" : "Reconocer"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
