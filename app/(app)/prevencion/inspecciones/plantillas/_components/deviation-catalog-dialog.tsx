"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DANO_POTENCIAL_LABELS } from "@/lib/prevention/inspections"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { promoteUnclassifiedDeviationAction, setTemplateDeviationAction } from "../../actions"
import type { DeviationEntry } from "../../_components/catalog-types"
import { InlineError } from "../../_components/form-dialog"

/* ── Creador de desviaciones ──────────────────────────────────────────────── */

/** La gravedad que corresponde a una criticidad ya registrada, para sugerirla. */
const DANO_BY_CRITICALITY: Record<string, string> = {
  low: "leve",
  medium: "moderado",
  high: "grave",
  critical: "fatal",
}

const DANO_LABELS: Record<string, string> = {
  leve: "Leve → hallazgo bajo · 30 días",
  moderado: "Moderado → hallazgo medio · 15 días",
  grave: "Grave → hallazgo alto · 7 días",
  fatal: "Fatal → hallazgo crítico · 3 días y detención",
}

/**
 * Elige qué desviaciones del catálogo maestro ofrece este instrumento.
 *
 * Es lo que permite que quien registra en terreno NO decida la gravedad: elige
 * de esta lista y el plazo de la acción correctiva sale solo. La única excepción
 * es "Otra desviación", donde sí la elige — y esas aparecen acá abajo para que
 * Prevención las incorpore y dejen de depender de un criterio individual.
 *
 * La lista en sí se mantiene en Administración; acá sólo se marca cuáles
 * aplican y, si hace falta, se ajusta la gravedad para este instrumento. La
 * selección cuelga del CÓDIGO del instrumento, así que versionarlo no la pierde.
 */
export function DeviationCatalogDialog({ templateCode, name, entries, unclassified, open, onOpenChange }: {
  templateCode: string
  name: string
  entries: DeviationEntry[]
  unclassified: { description: string; criticality: string; occurrences: number }[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = React.useState("")

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((entry) => entry.label.toLowerCase().includes(needle))
  }, [entries, query])
  // Lo ofrecido primero: es lo que se viene a revisar, y con un maestro largo
  // quedaba disperso entre decenas de casillas vacías.
  const ordered = React.useMemo(
    () => [...visible].sort((a, b) => Number(b.selected) - Number(a.selected) || a.label.localeCompare(b.label)),
    [visible],
  )
  const offered = entries.filter((entry) => entry.selected).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desviaciones · {name}</DialogTitle>
          <DialogDescription>
            Lo que este instrumento ofrece al registrar una desviación, con la gravedad que le corresponde. Quien
            registra en terreno elige de esta lista; el plazo de la acción correctiva sale de acá y no de su criterio.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar desviación…"
            aria-label="Buscar en el catálogo maestro"
            className="h-8 text-sm"
          />
          <span className="shrink-0 text-xs text-[var(--color-text-subtle)]">{offered} ofrecida(s)</span>
        </div>

        {ordered.length > 0 ? (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {ordered.map((entry) => (
              <DeviationRow key={entry.id} templateCode={templateCode} entry={entry} />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-subtle)]">
            {entries.length === 0
              ? "El catálogo maestro está vacío. Se arma en Administración → Desviaciones."
              : "Ninguna desviación coincide con la búsqueda."}
          </p>
        )}

        {unclassified.length > 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
            <p className="font-medium">Registradas como «Otra», sin catalogar</p>
            <p className="mt-1 text-[var(--color-text-subtle)]">
              Su gravedad la eligió quien registró. Incorpóralas al maestro y dejarán de depender de un criterio
              individual.
            </p>
            <ul className="mt-2 space-y-1">
              {unclassified.slice(0, 12).map((item) => (
                <UnclassifiedRow key={item.description} templateCode={templateCode} item={item} />
              ))}
            </ul>
            {unclassified.length > 12 && <p className="mt-1">…y {unclassified.length - 12} más.</p>}
          </div>
        )}

        <p className="text-xs text-[var(--color-text-subtle)]">
          La lista maestra —crear, redactar y retirar desviaciones— se mantiene en{" "}
          <Link href="/admin/desviaciones" className="underline">Administración → Desviaciones</Link>.
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** Una desviación del maestro con su casilla y su gravedad en este instrumento. */
function DeviationRow({ templateCode, entry }: { templateCode: string; entry: DeviationEntry }) {
  const operation = useOperation()
  const retirada = !entry.isActive

  return (
    <div className="rounded border border-[var(--color-border)] px-2 py-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Checkbox
          className="min-w-0"
          checked={entry.selected}
          disabled={operation.pending || retirada}
          onChange={(event) => operation.run(() => setTemplateDeviationAction({
            templateCode,
            entryId: entry.id,
            selected: event.target.checked,
            danoPotencialOverride: entry.danoPotencialOverride,
          }))}
          label={
            <span className={retirada ? "text-[var(--color-text-subtle)] line-through" : undefined}>
              {entry.label}
            </span>
          }
        />
        <span className="flex shrink-0 items-center gap-2">
          {/* Recalibrar acá no reescribe los hallazgos ya levantados: su
              criticidad es evidencia del plazo que tuvieron. */}
          <Select
            value={entry.effectiveDano}
            disabled={!entry.selected || operation.pending}
            onValueChange={(value) => operation.run(() => setTemplateDeviationAction({
              templateCode,
              entryId: entry.id,
              selected: true,
              // Volver al valor del maestro borra el ajuste en vez de fijarlo:
              // así la entrada sigue heredando futuras recalibraciones.
              danoPotencialOverride: value === entry.danoPotencial ? null : value,
            }))}
          >
            <SelectTrigger className="h-7 w-52 text-xs" aria-label={`Gravedad de ${entry.label}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {/* La consecuencia va en la etiqueta: acá salía "grave" pelado,
                  para la misma decisión. */}
              {Object.entries(DANO_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          {entry.danoPotencialOverride && (
            <span className="text-xs text-[var(--color-warning-ink)]" title={`El maestro propone ${DANO_POTENCIAL_LABELS[entry.danoPotencial] ?? entry.danoPotencial}`}>
              ajustada
            </span>
          )}
          {retirada && <span className="text-xs text-[var(--color-text-subtle)]">retirada del maestro</span>}
        </span>
      </div>
      {/* Si la acción falla la casilla vuelve a su estado: sin esto no había
          forma de saber por qué. */}
      <InlineError operation={operation} className="mt-1" />
    </div>
  )
}

/** Una desviación fuera de catálogo, con el botón que la incorpora al maestro. */
function UnclassifiedRow({ templateCode, item }: {
  templateCode: string
  item: { description: string; criticality: string; occurrences: number }
}) {
  const operation = useOperation()
  const [dano, setDano] = React.useState(DANO_BY_CRITICALITY[item.criticality] ?? "moderado")

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 flex-1">
        {item.description}
        {item.occurrences > 1 ? ` · ${item.occurrences} veces` : ""}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Select value={dano} onValueChange={setDano}>
          <SelectTrigger className="h-7 w-52 text-xs" aria-label={`Gravedad oficial de ${item.description}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(DANO_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={operation.pending}
          onClick={() => operation.run(() => promoteUnclassifiedDeviationAction({
            templateCode,
            label: item.description,
            danoPotencial: dano,
          }), () => toast.success("Desviación incorporada al maestro."))}
        >
          Incorporar
        </Button>
      </span>
      <InlineError operation={operation} className="w-full" />
    </li>
  )
}
