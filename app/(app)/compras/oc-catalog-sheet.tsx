"use client"

import * as React from "react"
import { LinkSimple, Package } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { useOperation } from "@/lib/hooks/use-operation"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import {
  createSparePartForOcAction,
  linkSparePartForOcAction,
  searchSparePartsForOcAction,
  type SearchSparePartsResult,
  type SparePartChoice,
} from "./actions"
import { sparePartDraftFromLine, sparePartTag } from "./oc-form.helpers"
import type { LinkedSparePart, PendingItemOption } from "./oc-form.types"

type View = "link" | "create"

/** Por qué un repuesto sube en la lista: ya se compró para este equipo, o para uno igual. */
const MATCH_BADGES: Record<NonNullable<SparePartChoice["vehicleMatch"]>, { label: string; variant: "success" | "info" }> = {
  vehicle: { label: "Ya se compró para este equipo", variant: "success" },
  model: { label: "Se compró para un equipo igual", variant: "info" },
}

interface OcCatalogSheetProps {
  /** La línea que se cataloga; `null` = hoja cerrada. */
  item: PendingItemOption | null
  /** `repuestos:catalog`: sin él sólo se puede vincular a un repuesto que ya existe. */
  canCreate: boolean
  onOpenChange: (open: boolean) => void
  onLink: (itemId: string, part: LinkedSparePart) => void
}

/**
 * «Catalogar»: Compras arma la OC con una línea de repuesto que el solicitante
 * escribió en texto libre y la ata a un repuesto del catálogo, para que su
 * precio y su historial queden donde corresponde. Dos caminos: vincular uno que
 * ya existe (con sugerencia por N° de parte) o crearlo prellenado desde la línea.
 *
 * El vínculo no se guarda aquí: vive en el formulario y se escribe al crear la OC.
 */
export function OcCatalogSheet({ item, canCreate, onOpenChange, onLink }: OcCatalogSheetProps) {
  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      {/* `stableHeight`: alternar entre «vincular» y «crear» no debe mover la caja. */}
      <SheetContent stableHeight className="sm:max-w-xl sm:h-[min(80vh,40rem)]">
        {item && (
          // `key`: cada línea abre con búsqueda y borrador propios.
          <CatalogBody key={item.id} item={item} canCreate={canCreate} onClose={() => onOpenChange(false)} onLink={onLink} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function CatalogBody({
  item, canCreate, onClose, onLink,
}: {
  item: PendingItemOption
  canCreate: boolean
  onClose: () => void
  onLink: OcCatalogSheetProps["onLink"]
}) {
  const [view, setView] = React.useState<View>("link")
  const lineName = (item.productNameFree ?? item.productName).trim()

  return (
    <>
      <SheetHeader>
        <div className="min-w-0">
          <SheetTitle>Catalogar repuesto</SheetTitle>
          <SheetDescription>
            «{lineName}» · {formatQty(item.quantity, item.unitOfMeasure)}
            {item.requestedPartNumber ? ` · N° de parte ${item.requestedPartNumber}` : ""}
          </SheetDescription>
        </div>
        <SheetCloseButton />
      </SheetHeader>

      {canCreate && (
        <div className="shrink-0 border-b border-[var(--color-border)] px-6 py-3">
          <SegmentedControl
            ariaLabel="Cómo catalogar la línea"
            items={[
              { key: "link", label: "Vincular a uno existente", active: view === "link", onClick: () => setView("link") },
              { key: "create", label: "Crear uno nuevo", active: view === "create", onClick: () => setView("create") },
            ]}
          />
        </div>
      )}

      {view === "link" || !canCreate ? (
        <LinkView
          item={item}
          canCreate={canCreate}
          onCreateInstead={() => setView("create")}
          onChosen={(part) => { onLink(item.id, part); onClose() }}
        />
      ) : (
        <CreateView
          item={item}
          onCancel={onClose}
          onCreated={(part) => { onLink(item.id, part); onClose() }}
        />
      )}
    </>
  )
}

/* ── Camino 1: vincular a un repuesto que ya existe ─────────────────────────── */

function LinkView({
  item, canCreate, onCreateInstead, onChosen,
}: {
  item: PendingItemOption
  canCreate: boolean
  onCreateInstead: () => void
  onChosen: (part: LinkedSparePart) => void
}) {
  const [query, setQuery] = React.useState("")
  const [debounced, setDebounced] = React.useState("")
  const [result, setResult] = React.useState<{ key: string; data: SearchSparePartsResult } | null>(null)
  const [suggestion, setSuggestion] = React.useState<SparePartChoice | null>(null)
  const op = useOperation()

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const requestedPartNumber = item.requestedPartNumber
  const vehicleId = item.vehicleId
  React.useEffect(() => {
    let cancelled = false
    void searchSparePartsForOcAction({
      query: debounced,
      vehicleId,
      // La sugerencia por N° de parte se pide sólo con el catálogo completo a la vista.
      partNumber: debounced === "" ? requestedPartNumber : null,
    })
      .then((data) => {
        if (cancelled) return
        setResult({ key: debounced, data })
        if (debounced === "") setSuggestion(data.ok ? data.suggestion : null)
      })
      .catch(() => {
        if (!cancelled) setResult({ key: debounced, data: { ok: false, message: "No se pudo buscar en el catálogo. Inténtalo de nuevo." } })
      })
    return () => { cancelled = true }
  }, [debounced, vehicleId, requestedPartNumber])

  const loading = result === null || result.key !== debounced
  const data = result?.data
  const parts = data?.ok
    ? data.parts.filter((part) => debounced !== "" || part.id !== suggestion?.id)
    : []

  function choose(part: SparePartChoice) {
    op.run(
      async () => {
        const linked = await linkSparePartForOcAction({ productId: part.id, unitOfMeasure: item.unitOfMeasure })
        return linked.ok ? { ok: true, data: { part: linked.part } } : { ok: false, message: linked.message }
      },
      (done) => onChosen(done.data!.part as LinkedSparePart),
    )
  }

  return (
    <SheetBody className="flex flex-col gap-4">
      {suggestion && (
        <Callout tone="info" role="status" icon={<LinkSimple size={16} weight="bold" />} title="Coincide por N° de parte">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{suggestion.name}</div>
              <div className="text-xs">{sparePartTag(suggestion)}{suggestion.partBrand ? ` · ${suggestion.partBrand}` : ""}</div>
            </div>
            <Button type="button" size="sm" variant="primary" onClick={() => choose(suggestion)} disabled={op.pending}>
              Vincular este
            </Button>
          </div>
        </Callout>
      )}

      <Field label="Buscar en el catálogo" htmlFor="oc-catalog-search">
        <Input
          id="oc-catalog-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nombre, SKU o N° de parte"
          autoComplete="off"
        />
      </Field>

      {op.message && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{op.message}</p>
      )}

      {data && !data.ok ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{data.message}</p>
      ) : loading && result === null ? (
        <p role="status" className="text-sm text-[var(--color-text-muted)]">Buscando repuestos…</p>
      ) : parts.length === 0 && !suggestion ? (
        <EmptyState
          compact
          icon={<Package size={22} weight="light" />}
          title={debounced ? `Ningún repuesto coincide con «${debounced}»` : "El catálogo de repuestos está vacío"}
          description={canCreate
            ? "Créalo ahora con los datos de la línea y quedará vinculado a esta compra."
            : "Pídele a quien administra el catálogo que cree el repuesto y vuelve a intentarlo."}
          action={canCreate ? <Button type="button" variant="secondary" size="sm" onClick={onCreateInstead}>Crear repuesto nuevo</Button> : undefined}
        />
      ) : (
        <>
          {data?.ok && data.total > data.parts.length && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Mostrando {data.parts.length} de {data.total}. Escribe para afinar la búsqueda.
            </p>
          )}
          <ul aria-label="Repuestos del catálogo" aria-busy={loading} className="flex flex-col gap-2">
            {parts.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => choose(part)}
                  disabled={op.pending}
                  className="flex w-full items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--color-text)]">{part.name}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {sparePartTag(part)}{part.partBrand ? ` · ${part.partBrand}` : ""}
                    </span>
                    {part.vehicleMatch && (
                      <MetaBadge meta={MATCH_BADGES[part.vehicleMatch]} size="sm" className="mt-1.5" />
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs text-[var(--color-text-muted)]">
                    {part.lastPrice !== null ? (
                      <span className="block font-medium tabular-nums text-[var(--color-text)]">{formatCLP(part.lastPrice)}</span>
                    ) : (
                      <span className="block">Sin precio</span>
                    )}
                    {part.lastPurchasedAt && <span className="block">Comprado {formatDate(part.lastPurchasedAt)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </SheetBody>
  )
}

/* ── Camino 2: crear un repuesto nuevo, prellenado desde la línea ───────────── */

function CreateView({
  item, onCancel, onCreated,
}: {
  item: PendingItemOption
  onCancel: () => void
  onCreated: (part: LinkedSparePart) => void
}) {
  const draft = React.useMemo(() => sparePartDraftFromLine(item), [item])
  const [name, setName] = React.useState(draft.name)
  const [partNumber, setPartNumber] = React.useState(draft.partNumber)
  const [partBrand, setPartBrand] = React.useState("")
  const op = useOperation()

  function submit(event: React.FormEvent) {
    // La hoja vive en un portal dentro del formulario de la OC: este envío no
    // puede llegar a él.
    event.preventDefault()
    event.stopPropagation()
    op.run(
      async () => {
        const created = await createSparePartForOcAction({
          name, partNumber, partBrand, unitOfMeasure: item.unitOfMeasure,
        })
        return created.ok ? { ok: true, data: { part: created.part } } : { ok: false, message: created.message }
      },
      (done) => onCreated(done.data!.part as LinkedSparePart),
    )
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="flex flex-col gap-4">
        <p className="text-sm text-[var(--color-text-muted)]">
          Se agrega al catálogo de repuestos con un código RPT y queda vinculado a esta línea. Revisa el nombre y los datos del fabricante.
        </p>
        <Field label="Nombre del repuesto" htmlFor="oc-catalog-name" required>
          <Input id="oc-catalog-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="N° de parte"
            htmlFor="oc-catalog-part-number"
            helper="Evita duplicados: un mismo N° de parte y marca es un solo repuesto."
          >
            <Input id="oc-catalog-part-number" value={partNumber} onChange={(event) => setPartNumber(event.target.value)} maxLength={100} />
          </Field>
          <Field label="Marca del repuesto" htmlFor="oc-catalog-part-brand" helper="Del fabricante, no del equipo.">
            <Input id="oc-catalog-part-brand" value={partBrand} onChange={(event) => setPartBrand(event.target.value)} maxLength={100} />
          </Field>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Unidad de medida: {item.unitOfMeasure}</p>
        {op.message && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">{op.message}</p>
        )}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={op.pending}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={op.pending} disabled={name.trim() === ""}>
          Crear y vincular
        </Button>
      </SheetFooter>
    </form>
  )
}
