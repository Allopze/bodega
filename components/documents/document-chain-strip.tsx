import * as React from "react"
import Link from "next/link"
import { CaretRight, Path } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { DISPATCH_GUIDE_STATE_META, OC_STATE_META, REQUEST_STATE_META } from "@/components/states/state-badge"
import {
  chainDocuments,
  isChainEmpty,
  type ChainDocument,
  type DocumentChain,
  type DocumentKind,
} from "@/lib/services/document-chain"

/**
 * Migas de expediente: la cadena de documentos a la que pertenece el que estás
 * mirando, en una línea.
 *
 * No reemplaza al `Breadcrumbs` del `PageHeader`, que es navegación estructural
 * ("Inicio / Órdenes de compra / OC-2026-0003"). Esto es otra cosa: el recorrido
 * del pedido a través de los libros. Existe porque los correlativos son series
 * independientes —`OC-2026-0003` no se deriva de `SOL-0004`— y sin el vínculo
 * explícito no hay forma de saber de dónde viene un documento mirando su número.
 */

export const KIND_LABEL: Record<DocumentKind, string> = {
  request:  "Solicitud",
  order:    "Orden de compra",
  receipt:  "Recepción",
  dispatchGuide: "GDI",
  delivery: "Entrega",
}

/**
 * Recepciones y entregas no tienen estado propio: la columna que los describe es
 * dónde llegó (`locationType`) o a quién se entregó (`destinationType`).
 */
const PLACE_LABEL: Record<string, string> = {
  office: "Oficina",
  faena:  "Faena",
  worker: "Trabajador",
}

/**
 * El estado en el vocabulario del sistema, no el valor crudo de la columna.
 *
 * Reutiliza los mapas de `StateBadge` en vez de repetirlos: son la única
 * definición de cómo se llama cada estado de cara al usuario, y una copia acá
 * sería la primera en quedar desactualizada ("in_purchasing" en vez de "En
 * proceso" es exactamente lo que se veía antes de esto).
 */
export function documentStatusLabel(doc: ChainDocument): string | null {
  if (!doc.status) return null
  switch (doc.kind) {
    case "request":  return REQUEST_STATE_META[doc.status as keyof typeof REQUEST_STATE_META]?.label ?? doc.status
    case "order":    return OC_STATE_META[doc.status as keyof typeof OC_STATE_META]?.label ?? doc.status
    case "receipt":
    case "delivery": return PLACE_LABEL[doc.status] ?? doc.status
    case "dispatchGuide": return DISPATCH_GUIDE_STATE_META[doc.status as keyof typeof DISPATCH_GUIDE_STATE_META]?.label ?? doc.status
  }
}

export function documentTitle(doc: ChainDocument): string {
  const status = documentStatusLabel(doc)
  return status ? `${KIND_LABEL[doc.kind]} · ${status}` : KIND_LABEL[doc.kind]
}

/** Cuántos códigos por libro caben antes de resumir. Más que esto deja de leerse de un vistazo. */
const MAX_PER_KIND = 3

function capped(docs: ChainDocument[]): { shown: ChainDocument[]; hidden: number } {
  return { shown: docs.slice(0, MAX_PER_KIND), hidden: Math.max(0, docs.length - MAX_PER_KIND) }
}

function ChainCode({ doc, current }: { doc: ChainDocument; current: boolean }) {
  const className = cn(
    "rounded-(--radius-sm) px-1.5 py-0.5 font-mono text-[11px] transition-colors duration-(--duration-fast)",
    current
      ? "bg-(--color-primary-tint) font-semibold text-(--color-primary-ink)"
      : "bg-(--color-surface-2) text-(--color-text-muted) hover:bg-(--color-primary-tint) hover:text-(--color-primary-ink)",
  )

  // El documento en el que ya estás no se enlaza a sí mismo.
  if (current) {
    return (
      <span
        className={cn(className, doc.voided && "opacity-60 line-through")}
        title={documentTitle(doc)}
        aria-current="page"
      >
        {doc.voided ? `${doc.code} · Anulada` : doc.code}
      </span>
    )
  }
  return (
    <Link
      href={doc.href}
      className={cn(className, doc.voided && "opacity-60 line-through")}
      title={documentTitle(doc)}
    >
      {doc.voided ? `${doc.code} · Anulada` : doc.code}
    </Link>
  )
}

interface DocumentChainStripProps {
  chain: DocumentChain
  /** El documento que se está mirando, para marcarlo y no enlazarlo. */
  current?: { kind: DocumentKind; id: string }
  /** Código del documento actual: habilita el enlace al expediente completo. */
  currentCode?: string
  className?: string
}

export async function DocumentChainStrip({ chain, current, currentCode, className }: DocumentChainStripProps) {
  if (isChainEmpty(chain)) return null

  const groups = [chain.requests, chain.orders, chain.receipts, chain.dispatchGuides, chain.deliveries].filter((g) => g.length > 0)

  // Un solo documento y es el que ya estás mirando: la miga no aporta nada.
  const total = chainDocuments(chain).length
  if (total <= 1 && current) return null

  // El expediente completo vive detrás de `warehouse:view_traceability`, permiso que no
  // tienen los roles de faena que sí ven solicitudes y recepciones. Sin él el
  // enlace sólo lleva a /forbidden, así que no se pinta. Se resuelve después de
  // los early-returns para no pagar `auth()` cuando la tira ni se muestra.
  const dossierHref = currentCode && can(await auth(), "warehouse:view_traceability")
    ? `/bodega/trazabilidad?tab=documento&codigo=${encodeURIComponent(currentCode)}`
    : null

  return (
    <nav
      aria-label="Expediente del documento"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) px-3 py-2",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-(--color-text-subtle)">
        <Path size={13} aria-hidden />
        Expediente
      </span>

      {groups.map((group, groupIndex) => {
        const { shown, hidden } = capped(group)
        return (
          <React.Fragment key={group[0]!.kind}>
            {groupIndex > 0 && (
              <CaretRight size={11} className="text-(--color-text-faint)" aria-hidden />
            )}
            <span className="flex flex-wrap items-center gap-1">
              {shown.map((doc) => (
                <ChainCode
                  key={doc.id}
                  doc={doc}
                  current={current?.kind === doc.kind && current.id === doc.id}
                />
              ))}
              {hidden > 0 && (
                <span
                  className="text-[11px] text-(--color-text-subtle)"
                  title={`${hidden} ${KIND_LABEL[group[0]!.kind].toLowerCase()}(s) más en el expediente`}
                >
                  +{hidden}
                </span>
              )}
            </span>
          </React.Fragment>
        )
      })}

      {dossierHref && (
        <Link
          href={dossierHref}
          className="ml-auto text-[11px] font-medium text-(--color-primary) hover:underline underline-offset-2"
        >
          Ver expediente
        </Link>
      )}
    </nav>
  )
}
