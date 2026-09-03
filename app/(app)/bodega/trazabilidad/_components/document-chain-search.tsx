import Link from "next/link"
import { MagnifyingGlass, Path } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { DocumentChainStrip, documentStatusLabel, KIND_LABEL } from "@/components/documents/document-chain-strip"
import { StateBadge } from "@/components/states/state-badge"
import {
  chainDocuments,
  type ChainDocument,
  type ChainAnchor,
  type DocumentChain,
} from "@/lib/services/document-chain"
import { formatDate } from "@/lib/utils"

interface Props {
  query: string
  result: { anchor: ChainAnchor; chain: DocumentChain } | null
}

export function DocumentChainSearch({ query, result }: Props) {
  return (
    <div className="space-y-6">
      <form method="get" role="search" className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input type="hidden" name="tab" value="documento" />
        <label htmlFor="codigo" className="sr-only">
          Código del documento
        </label>
        <div className="relative flex-1">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-subtle)"
            aria-hidden
          />
          <input
            id="codigo"
            name="codigo"
            type="search"
            defaultValue={query}
            autoFocus
            placeholder="SOL-0004, OC-2026-0003, REC-2026-0007, ENT-2026-0002…"
            className="h-11 w-full rounded-(--radius) border border-(--color-border-control) bg-(--color-surface) pl-9 pr-3 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-subtle) focus:border-(--color-primary) focus:ring-2 focus:ring-(--color-primary-line) sm:h-10"
          />
        </div>
        <Button type="submit" variant="primary" size="lg" className="text-sm">
          Buscar
        </Button>
      </form>

      {!query && (
        <EmptyState
          icon={<Path size={22} />}
          title="Escribe un código"
          description="Escribe el correlativo de una solicitud (SOL-...), orden de compra (OC-...), recepción (REC-...) o entrega (ENT-...) para visualizar su expediente completo y trazabilidad."
        />
      )}

      {query && !result && (
        <EmptyState
          icon={<MagnifyingGlass size={22} />}
          tone="warning"
          title={`No se encontró ${query.trim().toUpperCase()}`}
          description="Revisa el código completo, con su prefijo y su año cuando lo lleve. Si el documento pertenece a una faena fuera de tu alcance, tampoco aparecerá acá."
        />
      )}

      {result && (
        <>
          <DocumentChainStrip
            chain={result.chain}
            current={result.anchor.kind === "item" ? undefined : result.anchor}
          />

          <section className="overflow-hidden rounded-(--radius-2xl) border border-(--color-border) bg-(--color-surface)">
            <div className="border-b border-(--color-border) px-4 py-3">
              <h2 className="text-h2 text-(--color-text)">Documentos del expediente</h2>
              <p className="mt-0.5 text-xs text-(--color-text-muted)">
                En orden de flujo: solicitud, orden de compra, recepción y entrega.
              </p>
            </div>
            <ul className="divide-y divide-(--color-border)">
              {chainDocuments(result.chain).map((doc) => (
                <DocumentRow
                  key={`${doc.kind}-${doc.id}`}
                  doc={doc}
                  current={
                    result.anchor.kind !== "item" &&
                    result.anchor.kind === doc.kind &&
                    result.anchor.id === doc.id
                  }
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function DocumentRow({ doc, current }: { doc: ChainDocument; current: boolean }) {
  return (
    <li>
      <Link
        href={doc.href}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-(--color-primary-tint)"
      >
        <span
          className={
            current
              ? "font-mono text-sm font-semibold text-(--color-primary-ink)"
              : "font-mono text-sm text-(--color-text)"
          }
        >
          {doc.code}
        </span>
        <span className="text-xs text-(--color-text-muted)">{KIND_LABEL[doc.kind]}</span>
        {doc.status && (doc.kind === "request" || doc.kind === "order") ? (
          <StateBadge
            state={doc.status}
            entity={doc.kind === "request" ? "request" : "oc"}
            size="sm"
          />
        ) : (
          documentStatusLabel(doc) && (
            <span className="text-xs text-(--color-text-subtle)">{documentStatusLabel(doc)}</span>
          )
        )}
        {current && (
          <span className="rounded-(--radius-sm) bg-(--color-primary-tint) px-1.5 py-0.5 text-[11px] font-medium text-(--color-primary-ink)">
            Buscado
          </span>
        )}
        {doc.at && (
          <span className="ml-auto text-xs tabular-nums text-(--color-text-subtle)">
            {formatDate(doc.at)}
          </span>
        )}
      </Link>
    </li>
  )
}
