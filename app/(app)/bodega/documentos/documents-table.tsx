"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { FileText } from "@phosphor-icons/react"
import { formatDate, formatQty } from "@/lib/utils"
import type { StockDocumentRow, StockCountDetailItem } from "@/lib/services/stock-documents"

const KIND_META: Record<string, { label: string; variant: "neutral" | "warning" | "success" | "info" }> = {
  ajuste:     { label: "Ajuste",      variant: "neutral" },
  desecho:    { label: "Baja",        variant: "warning" },
  devolucion: { label: "Devolución",  variant: "success" },
  conteo:     { label: "Conteo",      variant: "info" },
}

export interface DocumentsTableProps {
  documents: StockDocumentRow[]
  /** Detalle precargado del documento pedido por `?doc=`. */
  detail: { id: string; items: StockCountDetailItem[] } | null
  highlightId?: string
}

export function DocumentsTable({ documents, detail, highlightId }: DocumentsTableProps) {
  const [expanded, setExpanded] = React.useState<string | null>(highlightId ?? null)

  if (documents.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <EmptyState
          icon={<FileText size={24} />}
          title="Sin documentos de bodega"
          description="Los ajustes, bajas, devoluciones y conteos aparecerán aquí con su folio en cuanto se registren."
        />
      </section>
    )
  }

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-h2 text-[var(--color-text)]">Documentos de bodega</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          Ajustes, bajas, devoluciones y conteos físicos, con su folio
        </p>
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Documentos manuales de bodega ordenados del más reciente al más antiguo</caption>
          <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <tr>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Folio</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Tipo</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Fecha</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Faena</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Detalle</th>
              <th scope="col" className="px-5 py-2.5 text-right th-type w-28">Cantidad</th>
              <th scope="col" className="px-5 py-2.5 text-left th-type">Responsable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {documents.map((doc) => {
              const meta = KIND_META[doc.kind] ?? { label: doc.kind, variant: "neutral" as const }
              const isCount = doc.kind === "conteo"
              const isOpen = expanded === doc.id
              return (
                <React.Fragment key={doc.id}>
                  <tr
                    className={[
                      "transition-colors hover:bg-[var(--color-surface-2)]",
                      doc.id === highlightId ? "bg-[var(--color-primary-tint)]" : "",
                    ].join(" ")}
                  >
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-[var(--color-text)]">
                      {isCount ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setExpanded(isOpen ? null : doc.id)}
                          className="underline-offset-2 hover:underline"
                        >
                          {doc.folio}
                        </button>
                      ) : doc.folio}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs tabular-nums text-[var(--color-text-muted)]">{formatDate(doc.at)}</td>
                    <td className="px-5 py-3 text-xs text-[var(--color-text-muted)]">{doc.worksiteName}</td>
                    <td className="px-5 py-3 text-xs text-[var(--color-text-subtle)]">
                      {doc.productName && <span className="text-[var(--color-text)]">{doc.productName}</span>}
                      {doc.productName && doc.reason && " · "}
                      {doc.reason}
                      {isCount && doc.itemCount !== null && (
                        <span className="text-[var(--color-text-faint)]">
                          {doc.reason ? " · " : ""}{doc.itemCount} {doc.itemCount === 1 ? "producto" : "productos"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-text)]">
                      {doc.quantity === null ? "—" : `${doc.quantity > 0 ? "+" : ""}${doc.quantity}`}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--color-text-muted)]">{doc.authorName ?? "—"}</td>
                  </tr>
                  {isCount && isOpen && (
                    <tr>
                      <td colSpan={7} className="bg-[var(--color-surface-2)] px-5 py-3">
                        {detail && detail.id === doc.id ? (
                          detail.items.length === 0 ? (
                            <p className="text-xs text-[var(--color-text-muted)]">Este conteo no registró productos.</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-[var(--color-text-subtle)]">
                                  <th scope="col" className="py-1 font-semibold">Producto</th>
                                  <th scope="col" className="py-1 text-right font-semibold">Sistema</th>
                                  <th scope="col" className="py-1 text-right font-semibold">Contado</th>
                                  <th scope="col" className="py-1 text-right font-semibold">Diferencia</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.items.map((item) => (
                                  <tr key={item.productName} className="border-t border-[var(--color-border)]">
                                    <td className="py-1.5 text-[var(--color-text)]">
                                      {item.productName}
                                      {item.productSku && (
                                        <span className="ml-1.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{item.productSku}</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 text-right font-mono tabular-nums">{formatQty(item.expectedQuantity)}</td>
                                    <td className="py-1.5 text-right font-mono tabular-nums">{formatQty(item.countedQuantity)}</td>
                                    <td className={[
                                      "py-1.5 text-right font-mono font-semibold tabular-nums",
                                      item.difference === 0
                                        ? "text-[var(--color-text-faint)]"
                                        : item.difference > 0
                                          ? "text-[var(--color-success)]"
                                          : "text-[var(--color-danger)]",
                                    ].join(" ")}>
                                      {item.difference > 0 ? "+" : ""}{item.difference}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )
                        ) : (
                          <p className="text-xs text-[var(--color-text-muted)]">
                            Abre el documento desde su enlace para ver el detalle del conteo.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-5 md:hidden">
        {documents.map((doc) => {
          const meta = KIND_META[doc.kind] ?? { label: doc.kind, variant: "neutral" as const }
          return (
            <article key={doc.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-[var(--color-text)]">{doc.folio}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{doc.worksiteName}</p>
                </div>
                <Badge variant={meta.variant} className="shrink-0">{meta.label}</Badge>
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {doc.productName ? `${doc.productName} · ` : ""}{doc.reason ?? "—"}
              </p>
              <div className="mt-2 flex items-center justify-between text-xs text-[var(--color-text-subtle)]">
                <span>{formatDate(doc.at)}{doc.authorName ? ` · ${doc.authorName}` : ""}</span>
                {doc.quantity !== null && (
                  <span className="font-mono font-semibold tabular-nums text-[var(--color-text)]">
                    {doc.quantity > 0 ? "+" : ""}{doc.quantity}
                  </span>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
