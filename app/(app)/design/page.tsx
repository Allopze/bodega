import type { Metadata } from "next"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { SkeletonRow } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { DataList } from "@/components/ui/data-list"
import { Avatar } from "@/components/ui/avatar"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import {
  Table, TableRoot, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { StateBadge } from "@/components/states/state-badge"
import { ITEM_STATE_META, REQUEST_STATE_META, OC_STATE_META } from "@/components/states/state-badge"
import { Package, WarningCircle } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Galería de diseño" }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-6 border-b border-[var(--color-border)] last:border-0">
      <h2 className="font-display text-base font-semibold text-[var(--color-text)] mb-4">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-3">
      <span className="text-xs text-[var(--color-text-subtle)] min-w-28 shrink-0">{label}</span>
      {children}
    </div>
  )
}

export default function DesignGallery() {
  const itemStates   = Object.keys(ITEM_STATE_META)
  const requestStates = Object.keys(REQUEST_STATE_META)
  const ocStates      = Object.keys(OC_STATE_META)

  return (
    <>
      <PageHeader
        title="Galería de diseño"
        description="Todos los componentes en todos sus estados. Herramienta de verificación del sistema de diseño."
        breadcrumb={
          <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Galería de diseño" }]} />
        }
      />

      {/* ── Buttons ── */}
      <Section title="Botones">
        <Row label="primary">
          <Button variant="primary">Guardar</Button>
          <Button variant="primary" loading>Guardando...</Button>
          <Button variant="primary" disabled>Deshabilitado</Button>
          <Button variant="primary" size="sm">Pequeño</Button>
          <Button variant="primary" size="lg">Grande</Button>
        </Row>
        <Row label="secondary">
          <Button variant="secondary">Cancelar</Button>
          <Button variant="secondary" disabled>Deshabilitado</Button>
        </Row>
        <Row label="ghost">
          <Button variant="ghost">Editar</Button>
          <Button variant="ghost" disabled>Deshabilitado</Button>
        </Row>
        <Row label="destructive">
          <Button variant="destructive">Eliminar</Button>
        </Row>
        <Row label="signal (alert)">
          <Button variant="signal">Pendiente revisión</Button>
        </Row>
      </Section>

      {/* ── State Badges — Item lifecycle (the core of the product) ── */}
      <Section title="Badges de estado: ítem de solicitud">
        <div className="flex flex-wrap gap-2">
          {itemStates.map((s) => <StateBadge key={s} state={s} entity="item" />)}
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
          Naranja = señal de alerta para pendiente de compra. Verde = éxito. Rojo = peligro. Azul = en progreso. Ámbar = parcial.
        </p>
      </Section>

      <Section title="Badges de estado: solicitud">
        <div className="flex flex-wrap gap-2">
          {requestStates.map((s) => <StateBadge key={s} state={s} entity="request" />)}
        </div>
      </Section>

      <Section title="Badges de estado: orden de compra">
        <div className="flex flex-wrap gap-2">
          {ocStates.map((s) => <StateBadge key={s} state={s} entity="oc" />)}
        </div>
      </Section>

      {/* ── Generic badges ── */}
      <Section title="Badges genéricos">
        <Row label="variants">
          <Badge variant="default" dot>Default</Badge>
          <Badge variant="primary" dot>Primario</Badge>
          <Badge variant="success" dot>Éxito</Badge>
          <Badge variant="warning" dot>Advertencia</Badge>
          <Badge variant="signal" dot>Alerta</Badge>
          <Badge variant="info" dot>Info</Badge>
          <Badge variant="danger" dot>Peligro</Badge>
          <Badge variant="outline">Sin fondo</Badge>
        </Row>
        <Row label="sizes">
          <Badge size="sm">Pequeño</Badge>
          <Badge size="default">Normal</Badge>
          <Badge size="lg">Grande</Badge>
        </Row>
      </Section>

      {/* ── Form fields ── */}
      <Section title="Campos de formulario">
        <div className="grid gap-4 max-w-lg">
          <Field label="Nombre del producto" htmlFor="ex-name" required helper="Nombre tal como aparece en catálogo">
            <Input id="ex-name" placeholder="Casco blanco clase A" />
          </Field>
          <Field label="Con error" htmlFor="ex-err" required error="Este campo es obligatorio">
            <Input id="ex-err" placeholder="..." error />
          </Field>
          <Field label="Observaciones" htmlFor="ex-obs">
            <Textarea id="ex-obs" placeholder="Observaciones adicionales..." rows={3} />
          </Field>
          <Field label="Deshabilitado" htmlFor="ex-dis">
            <Input id="ex-dis" value="Lectura solamente" readOnly />
          </Field>
        </div>
      </Section>

      {/* ── Avatars ── */}
      <Section title="Avatares">
        <Row label="sizes">
          {["Rodrigo Fuentes", "Camila Araya", "Jorge Sepúlveda", "Ana Vásquez", "P"].map((name) => (
            <Avatar key={name} name={name} size="xs" />
          ))}
          {["Rodrigo Fuentes", "Camila Araya"].map((name) => (
            <Avatar key={name} name={name} size="sm" />
          ))}
          {["Rodrigo Fuentes", "Camila Araya"].map((name) => (
            <Avatar key={name} name={name} size="default" />
          ))}
          {["Rodrigo Fuentes"].map((name) => (
            <Avatar key={name} name={name} size="lg" />
          ))}
        </Row>
      </Section>

      {/* ── Table ── */}
      <Section title="Tabla">
        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Cant.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { code: "SOL-2026-0042", product: "Casco blanco clase A", faena: "Faena Norte", status: "approved",         qty: 10 },
                { code: "SOL-2026-0043", product: "Guantes anticorte",     faena: "Faena Norte", status: "pending_purchase",  qty: 20 },
                { code: "SOL-2026-0044", product: "Zapatos de seguridad",   faena: "Faena Sur",   status: "in_purchase_order", qty: 5  },
                { code: "SOL-2026-0045", product: "Lentes de seguridad",    faena: "Faena Centro", status: "rejected",         qty: 30 },
              ].map((row) => (
                <TableRow key={row.code}>
                  <TableCell><span className="font-mono text-xs">{row.code}</span></TableCell>
                  <TableCell>{row.product}</TableCell>
                  <TableCell className="text-[var(--color-text-muted)]">{row.faena}</TableCell>
                  <TableCell><StateBadge state={row.status} /></TableCell>
                  <TableCellNum>{row.qty}</TableCellNum>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      </Section>

      {/* ── Data list ── */}
      <Section title="DataList (detalle)">
        <div className="max-w-lg">
          <DataList items={[
            { label: "OC",          value: <span className="font-mono">OC-2026-0017</span>, mono: false },
            { label: "Proveedor",   value: "Ferretería Industrial Cáceres" },
            { label: "Faena",       value: "Faena Norte — Antofagasta" },
            { label: "Total neto",  value: "$2.483.700", mono: true },
            { label: "Estado",      value: <StateBadge state="sent" entity="oc" /> },
          ]} />
        </div>
      </Section>

      {/* ── Skeletons ── */}
      <Section title="Skeleton (estado de carga)">
        <div className="max-w-xl border border-[var(--color-border)] rounded-[var(--radius)]">
          <SkeletonRow cols={4} />
          <SkeletonRow cols={4} />
          <SkeletonRow cols={4} />
        </div>
      </Section>

      {/* ── Empty states ── */}
      <Section title="Estado vacío">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)]">
            <EmptyState
              icon={<Package size={22} />}
              title="Sin órdenes de compra"
              description="Las órdenes de compra aparecerán aquí cuando apruebes ítems y los asignes a una OC."
              action={<Button size="sm">Crear primera OC</Button>}
            />
          </div>
          <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)]">
            <EmptyState
              icon={<WarningCircle size={22} />}
              title="Sin diferencias pendientes"
              description="Todas las facturas están conciliadas."
              compact
            />
          </div>
        </div>
      </Section>

      {/* ── Motion reference ── */}
      <Section title="Motion">
        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          Tres velocidades: rápido (150ms) para feedback inmediato, normal (200ms) para transiciones estándar, lento (300ms) para drawers y overlays.
          Reduced-motion: todas las animaciones se deshabilitan globalmente vía <code className="font-mono">@media (prefers-reduced-motion: reduce)</code>.
        </p>

        {/* Duration tokens */}
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)] mb-3">Duraciones</p>
        <div className="flex flex-col gap-2 mb-6 max-w-sm">
          {[
            { label: "fast  — 150ms", w: "w-[30%]" },
            { label: "normal — 200ms", w: "w-[50%]" },
            { label: "slow  — 300ms", w: "w-[80%]" },
          ].map(({ label, w }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-xs font-mono text-[var(--color-text-subtle)] w-32 shrink-0">{label}</span>
              <div className="flex-1 h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                <div className={`h-full bg-[var(--color-primary)] rounded-full ${w}`} />
              </div>
            </div>
          ))}
        </div>

        {/* Easing curves */}
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)] mb-3">Curvas de easing</p>
        <div className="flex flex-wrap gap-3 mb-6">
          {[
            { name: "--ease-out",    desc: "Feedback inmediato" },
            { name: "--ease-in-out", desc: "Transiciones UI" },
            { name: "--ease-drawer", desc: "Drawers y sheets" },
          ].map(({ name, desc }) => (
            <div key={name} className="flex flex-col gap-0.5 px-3 py-2.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
              <span className="font-mono text-[10px] text-[var(--color-primary)]">{name}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{desc}</span>
            </div>
          ))}
        </div>

        {/* Skeleton shimmer — live demo */}
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)] mb-3">Shimmer de carga</p>
        <div className="flex flex-col gap-2 max-w-lg border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden p-3 bg-[var(--color-surface)]">
          <SkeletonRow cols={4} />
          <SkeletonRow cols={4} />
          <SkeletonRow cols={4} />
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
          Overlays, dialogs y sheets usan <span className="font-mono">fade-in-0 + zoom-in-95</span> vía tw-animate-css. Abre cualquier Sheet o Dialog para verlo en acción.
        </p>
      </Section>

      {/* ── Color reference ── */}
      <Section title="Paleta de colores">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {[
            { name: "primary",      color: "var(--color-primary)",     dark: true  },
            { name: "primary-50",   color: "var(--color-primary-50)",  dark: false },
            { name: "signal",       color: "var(--color-signal)",      dark: true  },
            { name: "signal-50",    color: "var(--color-signal-50)",   dark: false },
            { name: "warning",      color: "var(--color-warning)",     dark: false },
            { name: "info",         color: "var(--color-info)",        dark: true  },
            { name: "danger",       color: "var(--color-danger)",      dark: true  },
            { name: "bg",           color: "var(--color-bg)",          dark: false },
            { name: "surface-2",    color: "var(--color-surface-2)",   dark: false },
            { name: "border",       color: "var(--color-border)",      dark: false },
            { name: "text",         color: "var(--color-text)",        dark: true  },
            { name: "brand-surface", color: "var(--color-brand-surface)", dark: true },
          ].map(({ name, color }) => (
            <div key={name} className="rounded-[var(--radius)] overflow-hidden border border-[var(--color-border)]">
              <div
                className="h-12"
                style={{ backgroundColor: color }}
              />
              <p className="px-2 py-1 text-[10px] font-mono text-[var(--color-text-subtle)] bg-[var(--color-surface)]">
                {name}
              </p>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}
