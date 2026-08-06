"use client"

import { useState, useTransition } from "react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { relateProposalToInvoiceAction, transitionProposalAction } from "./actions"
import type { ProposalStatus, ProposalTransition } from "@/lib/services/billing/proposal-rules"

/**
 * Acciones disponibles sobre una propuesta.
 *
 * Los botones se muestran según estado y permiso, pero eso es solo comodidad: la
 * autorización real y la máquina de estados viven en el servidor. Un usuario que
 * llame la acción sin el permiso correcto recibe un rechazo, no un cambio.
 *
 * Observar y rechazar exigen motivo — sin él, quien preparó la propuesta no sabe
 * qué corregir.
 */
export function ProposalActions({
  proposalId,
  code,
  status,
  hasMissingDocuments,
  canCreate,
  canReview,
  canApprove,
  canLink,
  invoiceOptions,
}: {
  proposalId: string
  code: string
  status: ProposalStatus
  hasMissingDocuments: boolean
  canCreate: boolean
  canReview: boolean
  canApprove: boolean
  canLink: boolean
  invoiceOptions: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [reasonFor, setReasonFor] = useState<ProposalTransition | null>(null)
  const [linking, setLinking] = useState(false)

  function run(transition: ProposalTransition, reason?: string) {
    startTransition(async () => {
      const result = await transitionProposalAction({ proposalId, transition, reason: reason ?? null })
      if (result.ok) {
        toast.success(result.message)
        setReasonFor(null)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  // `danger`: las salidas del flujo (rechazar, anular) no pueden leerse igual
  // que "Aprobar" — mismo peso visual invitaba al click equivocado
  // (UI/UX 2026-08-05, M5).
  const actions: { transition: ProposalTransition; label: string; show: boolean; confirm?: string; danger?: boolean }[] = [
    { transition: "submit",     label: "Enviar a revisión", show: canCreate && (status === "draft" || status === "observed") },
    { transition: "observe",    label: "Observar",          show: canReview && status === "in_review" },
    { transition: "approve",    label: "Aprobar",           show: canApprove && status === "in_review" },
    { transition: "reject",     label: "Rechazar",          show: canApprove && status === "in_review", danger: true },
    { transition: "mark_ready", label: "Marcar lista",      show: canApprove && status === "approved" },
    { transition: "reopen",     label: "Reabrir",           show: canCreate && (status === "observed" || status === "rejected") },
    {
      transition: "cancel",
      label: "Anular",
      show: canCreate && ["draft", "observed", "in_review", "approved", "ready"].includes(status),
      confirm: `¿Anular la propuesta ${code}? Queda registrada como anulada, no se borra.`,
      danger: true,
    },
  ]

  const visible = actions.filter((action) => action.show)
  const canRelate = canLink && (status === "approved" || status === "ready")

  if (visible.length === 0 && !canRelate) {
    return <span className="text-xs text-[var(--color-text-subtle)]">Sin acciones disponibles</span>
  }

  return (
    <>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {visible.map((action) => (
          <button
            key={action.transition}
            type="button"
            disabled={isPending || (action.transition === "mark_ready" && hasMissingDocuments)}
            title={
              action.transition === "mark_ready" && hasMissingDocuments
                ? "Hay documentos faltantes declarados: complétalos antes de marcarla lista"
                : undefined
            }
            onClick={() => {
              if (action.transition === "observe" || action.transition === "reject") {
                setReasonFor(action.transition)
                return
              }
              if (action.confirm && !confirm(action.confirm)) return
              run(action.transition)
            }}
            className={
              action.danger
                ? "font-medium text-[var(--color-danger-ink)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--color-text-subtle)] disabled:no-underline"
                : "font-medium text-[var(--color-primary-ink)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--color-text-subtle)] disabled:no-underline"
            }
          >
            {action.label}
          </button>
        ))}
        {canRelate && (
          <button
            type="button"
            disabled={isPending || invoiceOptions.length === 0}
            onClick={() => setLinking(true)}
            className="font-medium text-[var(--color-primary-ink)] hover:underline disabled:text-[var(--color-text-subtle)]"
          >
            Relacionar con factura
          </button>
        )}
      </div>

      {/* ── Motivo de observación o rechazo ──────────────────────────────── */}
      <Dialog open={reasonFor !== null} onOpenChange={(open) => !open && setReasonFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonFor === "reject" ? `Rechazar ${code}` : `Observar ${code}`}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            action={(formData) => {
              const reason = String(formData.get("reason") ?? "").trim()
              if (!reason) {
                toast.error("Indica el motivo")
                return
              }
              run(reasonFor!, reason)
            }}
          >
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Motivo {reasonFor === "reject" ? "del rechazo" : "de la observación"}
              </span>
              <textarea name="reason" rows={3} required maxLength={1000} className={inputClass} />
            </label>
            <button type="submit" disabled={isPending} className={cn(buttonVariants(), "w-full")}>
              {isPending ? "Guardando…" : "Confirmar"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Relacionar con una factura emitida ───────────────────────────── */}
      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Relacionar {code} con una factura</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            action={(formData) => {
              const invoiceId = String(formData.get("invoiceId") ?? "")
              if (!invoiceId) {
                toast.error("Selecciona una factura")
                return
              }
              startTransition(async () => {
                const result = await relateProposalToInvoiceAction({ proposalId, invoiceId })
                if (result.ok) {
                  toast.success(result.message)
                  setLinking(false)
                  router.refresh()
                } else {
                  toast.error(result.message)
                }
              })
            }}
          >
            <p className="text-xs text-[var(--color-text-muted)]">
              Al relacionarla, la factura queda atribuida al cliente, contrato, faena y período de la propuesta, y la
              propuesta pasa a “relacionada con factura”. Si los montos difieren, se informa la diferencia.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Factura emitida</span>
              <select name="invoiceId" required className={inputClass}>
                <option value="">Selecciona…</option>
                {invoiceOptions.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>{invoice.label}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={isPending} className={cn(buttonVariants(), "w-full")}>
              {isPending ? "Relacionando…" : "Relacionar"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"

