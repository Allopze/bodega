import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { MagnifyingGlass, Path } from "@phosphor-icons/react/dist/ssr"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { DocumentChainStrip, documentStatusLabel, KIND_LABEL } from "@/components/documents/document-chain-strip"
import { StateBadge } from "@/components/states/state-badge"
import {
  chainDocuments,
  getDocumentChainByCode,
  type ChainDocument,
} from "@/lib/services/document-chain"
import { formatDate } from "@/lib/utils"

export const metadata: Metadata = { title: "Buscar documento por código" }

/**
 * Búsqueda por código: escribes cualquier correlativo y sale su expediente.
 *
 * Es la contracara de tener series independientes por libro. `OC-2026-0003` no
 * se deriva de `SOL-0004` —y no debería, cada libro tiene que poder contarse
 * solo—, así que quien tiene un número en la mano (una OC impresa, una guía, un
 * correo del proveedor) necesita un lugar donde resolverlo al resto de la
 * cadena. Acepta el código de cualquiera de los cuatro libros, no sólo el de OC.
 */
export default async function BuscarDocumentoPage({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>
}) {
  let session
  try { session = await requirePermission("traceability:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/trazabilidad")}`) }

  const { codigo } = await searchParams
  const query = codigo?.trim() ?? ""
  const result = query ? await getDocumentChainByCode(session, query) : null

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Buscar documento por código"
        description="Escribe una solicitud, una OC, una recepción o una entrega y verás su expediente completo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Trazabilidad", href: "/trazabilidad" },
            { label: "Buscar por código" },
          ]} />
        }
      />

      <div className="space-y-6">
        {/* GET y no un cliente con estado: la búsqueda queda en la URL, así que
            un expediente se puede compartir por enlace o dejar en favoritos. */}
        <form method="get" role="search" className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="codigo" className="sr-only">Código del documento</label>
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
          <Button type="submit" variant="primary" size="lg" className="text-sm">Buscar</Button>
        </form>

        {!query && (
          <EmptyState
            icon={<Path size={22} />}
            title="Escribe un código"
            description="Los números de solicitud y de orden de compra son series independientes: OC-2026-0003 no viene de SOL-0003. Acá se resuelve cualquiera de los dos —o el de una recepción o entrega— al expediente al que pertenece."
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
            <DocumentChainStrip chain={result.chain} current={result.anchor.kind === "item" ? undefined : result.anchor} />

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
                    current={result.anchor.kind !== "item" && result.anchor.kind === doc.kind && result.anchor.id === doc.id}
                  />
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </PageContainer>
  )
}

function DocumentRow({ doc, current }: { doc: ChainDocument; current: boolean }) {
  return (
    <li>
      <Link
        href={doc.href}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-(--color-primary-tint)"
      >
        <span className={current
          ? "font-mono text-sm font-semibold text-(--color-primary-ink)"
          : "font-mono text-sm text-(--color-text)"}>
          {doc.code}
        </span>
        <span className="text-xs text-(--color-text-muted)">{KIND_LABEL[doc.kind]}</span>
        {/* El estado, en el vocabulario del sistema. Solicitud y OC tienen su
            propio ciclo y su badge; recepción y entrega describen un lugar. */}
        {doc.status && (doc.kind === "request" || doc.kind === "order") ? (
          <StateBadge state={doc.status} entity={doc.kind === "request" ? "request" : "oc"} size="sm" />
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
          <span className="ml-auto text-xs tabular-nums text-(--color-text-subtle)">{formatDate(doc.at)}</span>
        )}
      </Link>
    </li>
  )
}
