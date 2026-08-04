"use client"

import { useState, useTransition } from "react"
import { FileXls, Receipt } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCLP } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { dteTipoLabel } from "@/lib/services/dte-portal/labels"
import { downloadDteDocumentXml, type DteXmlDetail } from "../actions/dte-download-xml"

export interface DteReceivedRow {
  id: string
  tipoDte: string
  folio: number
  rutEmisor: string
  razonSocialEmisor: string
  montoTotal: number
  estadoSii: string | null
}

const ESTADO_SII_LABEL: Record<string, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  aceptado: { label: "Aceptado SII", variant: "success" },
  enviado: { label: "Enviado SII", variant: "neutral" },
  pendiente_envio: { label: "Pendiente envío SII", variant: "warning" },
  rechazado: { label: "Rechazado SII", variant: "danger" },
  anulado: { label: "Anulado", variant: "danger" },
  manual: { label: "Manual", variant: "neutral" },
}

/**
 * Muestra los DTE recibidos del portal (Bandeja de Entrada) ya vinculados a
 * las facturas de esta OC. Vive junto a InvoicesSection: el DTE es la
 * contracara oficial (SII) de la factura que el proveedor ya subió acá.
 */
export function DteReceivedCard({ docs }: { docs: DteReceivedRow[] }) {
  return (
    <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
      <h2 className="text-sm font-semibold text-(--color-text)">DTE recibido (portal tributario)</h2>

      {docs.length === 0 ? (
        <EmptyState
          compact
          icon={<Receipt size={28} />}
          title="Sin DTE vinculado a esta OC"
          description="Aún no llega desde el portal DTE un documento del proveedor que calce por RUT y folio con las facturas de esta orden."
        />
      ) : (
        <ul className="mt-3 divide-y divide-(--color-border)">
          {docs.map((doc) => <DteReceivedRow key={doc.id} doc={doc} />)}
        </ul>
      )}
    </section>
  )
}

function DteReceivedRow({ doc }: { doc: DteReceivedRow }) {
  const [isPending, startTransition] = useTransition()
  const [detail, setDetail] = useState<DteXmlDetail | null>(null)

  const estadoSii = doc.estadoSii ? ESTADO_SII_LABEL[doc.estadoSii] : null

  function handleViewXml() {
    startTransition(async () => {
      const result = await downloadDteDocumentXml(doc.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setDetail(result.detail)
    })
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-(--color-text)">
            {dteTipoLabel(doc.tipoDte)} · Folio {doc.folio}
          </p>
          <p className="mt-0.5 truncate text-xs text-(--color-text-subtle)">
            {doc.razonSocialEmisor} · {doc.rutEmisor}
          </p>
          {estadoSii && (
            <Badge variant={estadoSii.variant} size="sm" className="mt-1.5">{estadoSii.label}</Badge>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums text-(--color-text)">
            {formatCLP(doc.montoTotal)}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleViewXml}
            disabled={isPending}
          >
            <FileXls size={14} />
            {isPending ? "Descargando…" : detail ? "Ver de nuevo" : "Ver XML"}
          </Button>
        </div>
      </div>

      {detail && (
        <div className="mt-3 rounded-(--radius-lg) bg-(--color-surface-2) p-3 text-xs">
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono tabular-nums text-(--color-text-muted)">
            <span>Neto: {formatCLP(detail.netAmount)}</span>
            <span>IVA: {formatCLP(detail.taxAmount)}</span>
            <span>Total: {formatCLP(detail.totalAmount)}</span>
          </div>
          {detail.items.length > 0 && (
            <ul className="mt-2 space-y-1 text-(--color-text-subtle)">
              {detail.items.map((item) => (
                <li key={item.lineNumber} className="flex justify-between gap-3">
                  <span className="truncate">{item.productName}</span>
                  <span className="shrink-0 font-mono tabular-nums">{item.quantity} × {formatCLP(item.unitPrice)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
