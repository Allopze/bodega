"use client"

import * as React from "react"
import { MetaBadge, metaFor, type StateMetaInput } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { FileText } from "@phosphor-icons/react"
import { formatDate, formatQty } from "@/lib/utils"
import type { StockDocumentRow, StockCountDetailItem } from "@/lib/services/stock-documents"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

/** Label + variante en un solo mapa (MetaBadge): el color lo decide el tipo. */
const KIND_META: Record<string, StateMetaInput> = {
  ajuste:     { label: "Ajuste",     variant: "neutral" },
  desecho:    { label: "Baja",       variant: "warning" },
  devolucion: { label: "Devolución", variant: "success" },
  conteo:     { label: "Conteo",     variant: "info"    },
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
        <TableRoot className="rounded-none border-0">
        <Table className="text-sm">
          <caption className="sr-only">Documentos manuales de bodega ordenados del más reciente al más antiguo</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Folio</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead><TableHead>Faena</TableHead>
              <TableHead>Detalle</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead>Responsable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => {
              const meta = metaFor(KIND_META, doc.kind)
              const isCount = doc.kind === "conteo"
              const isOpen = expanded === doc.id
              return (
                <React.Fragment key={doc.id}>
                  <TableRow
                    className={[
                      "transition-colors hover:bg-[var(--color-surface-2)]",
                      doc.id === highlightId ? "bg-[var(--color-primary-tint)]" : "",
                    ].join(" ")}
                  >
                    <TableCell className="font-mono text-xs font-semibold text-[var(--color-text)]">
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
                    </TableCell>
                    <TableCell>
                      <MetaBadge meta={meta} />
                      {/*
                        STK-003 (auditoría 2026-09-14), patrón P7: un conteo en
                        borrador no movió nada y se listaba idéntico a los
                        documentos que sí. Quien usara esta bitácora como
                        evidencia de qué se movió contaba de más.
                      */}
                      {!doc.applied && (
                        <MetaBadge
                          meta={{ label: "Borrador · no aplicado", variant: "neutral" }}
                          className="ml-1"
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-[var(--color-text-muted)]">{formatDate(doc.at)}</TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">{doc.worksiteName}</TableCell>
                    <TableCell className="text-xs text-[var(--color-text-subtle)]">
                      {doc.productName && <span className="text-[var(--color-text)]">{doc.productName}</span>}
                      {doc.productName && doc.reason && " · "}
                      {doc.reason}
                      {isCount && doc.itemCount !== null && (
                        <span className="text-[var(--color-text-faint)]">
                          {doc.reason ? " · " : ""}{doc.itemCount} {doc.itemCount === 1 ? "producto" : "productos"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums text-[var(--color-text)]">
                      {doc.quantity === null ? "—" : `${doc.quantity > 0 ? "+" : ""}${doc.quantity}`}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">{doc.authorName ?? "—"}</TableCell>
                  </TableRow>
                  {isCount && isOpen && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-[var(--color-surface-2)]">
                        {detail && detail.id === doc.id ? (
                          detail.items.length === 0 ? (
                            <p className="text-xs text-[var(--color-text-muted)]">Este conteo no registró productos.</p>
                          ) : (
                            <Table className="text-xs">
                              <TableHeader>
                                <TableRow className="text-left text-[var(--color-text-subtle)]">
                                  <TableHead>Producto</TableHead><TableHead className="text-right">Sistema</TableHead>
                                  <TableHead className="text-right">Contado</TableHead><TableHead className="text-right">Diferencia</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {detail.items.map((item) => (
                                  <TableRow key={item.productName} className="border-t border-[var(--color-border)]">
                                    <TableCell className="text-[var(--color-text)]">
                                      {item.productName}
                                      {item.productSku && (
                                        <span className="ml-1.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{item.productSku}</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right font-mono tabular-nums">{formatQty(item.expectedQuantity)}</TableCell>
                                    <TableCell className="text-right font-mono tabular-nums">{formatQty(item.countedQuantity)}</TableCell>
                                    <TableCell className={[
                                      "py-1.5 text-right font-mono font-semibold tabular-nums",
                                      item.difference === 0
                                        ? "text-[var(--color-text-faint)]"
                                        : item.difference > 0
                                          ? "text-[var(--color-success)]"
                                          : "text-[var(--color-danger)]",
                                    ].join(" ")}>
                                      {item.difference > 0 ? "+" : ""}{item.difference}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )
                        ) : (
                          <p className="text-xs text-[var(--color-text-muted)]">
                            Abre el documento desde su enlace para ver el detalle del conteo.
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
        </TableRoot>
      </div>

      <div className="grid gap-3 p-5 md:hidden">
        {documents.map((doc) => {
          const meta = metaFor(KIND_META, doc.kind)
          return (
            <article key={doc.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-[var(--color-text)]">{doc.folio}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{doc.worksiteName}</p>
                </div>
                <MetaBadge meta={meta} className="shrink-0" />
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
