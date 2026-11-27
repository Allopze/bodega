import { Fragment, type ReactNode } from "react"
import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { isPartsNoteOpen } from "@/lib/mantencion/contracts"
import { formatNumber, plural } from "@/lib/mantencion/format"
import type { EquipmentConsumption, EquipmentList, EquipmentNote } from "@/lib/services/mantencion/equipment-parts"
import { formatDate, formatQty } from "@/lib/utils"
import { consumptionMeta, NOTE_STATUS_TEXT, NOTE_STATUS_TONE } from "../notas-pedido/parts-notes-format"
import { SectionCard } from "../shared/section-card"
import type { EquipmentPartsData } from "./equipment-detail-types"

/** Filas que se ven de entrada en cada lista; el resto queda tras «Mostrar N más» (la ficha no es un muro de filas). */
export const PARTS_VISIBLE_ROWS = 5
/** Líneas de una nota que se resumen en su fila. */
const NOTE_LINES_SHOWN = 3

const LINK = "inline-flex min-h-11 items-center font-mono text-xs font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline sm:min-h-0"
const MUTED = "text-xs text-[var(--color-text-muted)]"

/** Código con enlace sólo si quien mira puede abrir el destino: un enlace que da 403/404 es peor que ninguno. */
function Code({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span className="font-mono text-xs font-semibold text-[var(--color-text)]">{children}</span>
  return <Link href={href} className={LINK}>{children}</Link>
}

function NoteRow({ note, canOpenNotes, canOpenWorkOrders }: { note: EquipmentNote; canOpenNotes: boolean; canOpenWorkOrders: boolean }) {
  const shown = note.lines.slice(0, NOTE_LINES_SHOWN)
  const hidden = note.lines.length - shown.length
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Code href={canOpenNotes ? `/mantencion/notas-pedido/${note.id}` : null}>{note.code}</Code>
        <Badge variant={NOTE_STATUS_TONE[note.status]} size="sm">{NOTE_STATUS_TEXT[note.status]}</Badge>
        {note.urgent && isPartsNoteOpen(note.status) && <Badge variant="signal" size="sm">Urgente</Badge>}
        <span className="ml-auto font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDate(note.createdAt)}</span>
      </div>
      <p className={`mt-0.5 ${MUTED}`}>
        {note.workOrderId && note.workOrderFolio
          ? (canOpenWorkOrders
            ? <Link href={`/mantencion/ot/${note.workOrderId}`} className="font-mono text-[var(--color-primary-ink)] underline-offset-2 hover:underline">{note.workOrderFolio}</Link>
            : <span className="font-mono">{note.workOrderFolio}</span>)
          : "Sin OT"}
        {note.otherChargeLines > 0 && <> · {plural(note.otherChargeLines, "línea más con otro cargo", "líneas más con otro cargo")}</>}
      </p>
      <p className="mt-1 text-sm text-[var(--color-text)]">
        {shown.map((line, index) => (
          <Fragment key={line.id}>
            {index > 0 && " · "}
            <span className={line.resolution === "rechazada" ? "text-[var(--color-text-muted)] line-through" : undefined} title={line.resolution === "rechazada" ? "Línea rechazada" : undefined}>
              <span className="tabular-nums">{formatQty(line.quantity)}</span> × {line.description}
            </span>
          </Fragment>
        ))}
        {hidden > 0 && <span className="text-[var(--color-text-muted)]"> · y {formatNumber(hidden)} más</span>}
      </p>
    </li>
  )
}

function ConsumptionRow({ row }: { row: EquipmentConsumption }) {
  const meta = consumptionMeta(row.stockStatus)
  return (
    <li className="py-2.5">
      <p className="text-sm text-[var(--color-text)]">
        <span className="font-medium">{row.description}</span>
        <span className="ml-2 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">× {formatQty(row.quantity, row.unitOfMeasure ?? undefined)}</span>
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDate(row.workDate)}</span>
        <Link href={`/mantencion/registros/${row.recordId}`} className={LINK}>{row.recordFolio ?? "Registro"}</Link>
        {row.sku && <span className={`font-mono ${MUTED}`}>{row.sku}</span>}
        {meta && <MetaBadge meta={meta} size="sm" title={row.stockNote ?? undefined} />}
      </div>
    </li>
  )
}

/**
 * Una lista corta de entrada: las primeras `PARTS_VISIBLE_ROWS` filas y, si hay más, el resto tras un «Mostrar N más»
 * nativo (`<details>`, sin JavaScript). Con el tope del servicio, 50 filas por lista no caben a la vista de una ficha.
 */
function FoldedRows<T extends { id: string }>({ label, rows, renderRow }: { label: string; rows: T[]; renderRow: (row: T) => ReactNode }) {
  const head = rows.slice(0, PARTS_VISIBLE_ROWS)
  const rest = rows.slice(PARTS_VISIBLE_ROWS)
  const listClass = "divide-y divide-[var(--color-border)]"
  return (
    <>
      <ul aria-label={label} className={listClass}>{head.map(renderRow)}</ul>
      {rest.length > 0 && (
        <details className="group border-t border-[var(--color-border)]">
          <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8">
            <span className="group-open:hidden">Mostrar {formatNumber(rest.length)} más</span>
            <span className="hidden group-open:inline">Mostrar menos</span>
          </summary>
          <ul aria-label={`${label} (continuación)`} className={listClass}>{rest.map(renderRow)}</ul>
        </details>
      )}
    </>
  )
}

/** «Mostrando las últimas 50 de 120.» sólo cuando el tope dejó filas fuera. */
function CountNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null
  return <p className={`mt-2 ${MUTED}`}>Mostrando las últimas {formatNumber(shown)} de {formatNumber(total)}.</p>
}

function Section({ title, total, children }: { title: string; total: number; children: ReactNode }) {
  return (
    <section className="first:mt-0 mt-4" aria-label={title}>
      <h3 className="mb-1 text-sm font-semibold text-[var(--color-text)]">
        {title}
        <span className="ml-1.5 font-normal tabular-nums text-[var(--color-text-muted)]">{formatNumber(total)}</span>
      </h3>
      {children}
    </section>
  )
}

/**
 * «Notas de pedido y repuestos usados» de la ficha del equipo (R9, «Notas de pedido ERP»): las notas que se le imputan
 * —con su estado, su OT y sus líneas— y los repuestos que sus mantenciones declararon usar, con el estado de stock de
 * cada línea. Cada lista llega ya recortada al alcance de quien mira (`loadEquipmentParts`); `null` en una de ellas
 * significa «sin permiso» y su sección no se dibuja. Con las dos en `null` no se dibuja nada.
 */
export function EquipmentPartsCard({ parts }: { parts: EquipmentPartsData | null | undefined }) {
  if (!parts || (!parts.notes && !parts.consumptions)) return null
  const { notes, consumptions, canOpenNotes, canOpenWorkOrders } = parts
  return (
    <SectionCard title="Notas de pedido y repuestos usados" description="Lo que se pidió para este equipo y lo que sus mantenciones declararon usar.">
      {notes && <NotesSection notes={notes} canOpenNotes={canOpenNotes} canOpenWorkOrders={canOpenWorkOrders} />}
      {consumptions && <ConsumptionsSection consumptions={consumptions} />}
    </SectionCard>
  )
}

function NotesSection({ notes, canOpenNotes, canOpenWorkOrders }: { notes: EquipmentList<EquipmentNote>; canOpenNotes: boolean; canOpenWorkOrders: boolean }) {
  return (
    <Section title="Notas de pedido" total={notes.total}>
      {notes.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Este equipo no tiene notas de pedido. Se piden desde su orden de trabajo
          {canOpenNotes ? <> o desde <Link href="/mantencion/notas-pedido" className="font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline">Notas de pedido</Link></> : null}.
        </p>
      ) : (
        <>
          <FoldedRows label="Notas de pedido del equipo" rows={notes.rows} renderRow={(note) => <NoteRow key={note.id} note={note} canOpenNotes={canOpenNotes} canOpenWorkOrders={canOpenWorkOrders} />} />
          <CountNote shown={notes.rows.length} total={notes.total} />
        </>
      )}
    </Section>
  )
}

function ConsumptionsSection({ consumptions }: { consumptions: EquipmentList<EquipmentConsumption> }) {
  return (
    <Section title="Repuestos usados en mantenciones" total={consumptions.total}>
      {consumptions.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Ninguna mantención vigente de este equipo declara repuestos. Aparecen cuando el mecánico firma un trabajo con repuestos.
        </p>
      ) : (
        <>
          <FoldedRows label="Repuestos usados en mantenciones del equipo" rows={consumptions.rows} renderRow={(row) => <ConsumptionRow key={row.id} row={row} />} />
          <CountNote shown={consumptions.rows.length} total={consumptions.total} />
        </>
      )}
    </Section>
  )
}
