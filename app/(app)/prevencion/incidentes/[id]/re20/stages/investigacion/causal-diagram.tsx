"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  FACT_ROLE_LABELS,
  NODE_H,
  NODE_W,
  describeTreeAsText,
  layoutCausalTree,
  rootCauses,
  wrapLabel,
  type FactRole,
  type LayoutEdge,
  type Re20Tree,
} from "./model"

/* Diagrama de solo lectura del árbol, dibujado en vivo de izquierda (causas raíz)
 * a derecha (H1). Colores sólo con tokens `var(--color-*)`; lo que distingue a
 * cada hecho nunca es sólo el color: lleva su rótulo y el trazo cambia de grosor
 * o de forma. En móvil el SVG conserva su tamaño y hace scroll horizontal dentro
 * de su contenedor: apilarlo en vertical cambiaría el sentido de lectura (causa →
 * efecto, izquierda → derecha) y las conjunciones dejarían de verse. La lista de
 * trayectorias y el texto equivalente son la lectura sin desplazamiento. */

const NODE_STYLE: Record<FactRole, { rect: string; role: string }> = {
  final: { rect: "fill-[var(--color-primary-tint)] stroke-[var(--color-primary)]", role: "fill-[var(--color-primary-ink)]" },
  root: { rect: "fill-[var(--color-signal-tint)] stroke-[var(--color-signal)]", role: "fill-[var(--color-signal-ink)]" },
  link: { rect: "fill-[var(--color-surface)] stroke-[var(--color-border-control)]", role: "fill-[var(--color-text-muted)]" },
  context: { rect: "fill-[var(--color-surface-2)] stroke-[var(--color-border-control)]", role: "fill-[var(--color-text-muted)]" },
  loose: { rect: "fill-[var(--color-warning-tint)] stroke-[var(--color-warning)]", role: "fill-[var(--color-warning-ink)]" },
}

function edgePath(edge: LayoutEdge) {
  const dx = Math.max(24, (edge.x2 - edge.x1) / 2)
  return `M ${edge.x1} ${edge.y1} C ${edge.x1 + dx} ${edge.y1}, ${edge.x2 - dx} ${edge.y2}, ${edge.x2} ${edge.y2}`
}

export function CausalDiagram({ tree, selectedId }: { tree: Re20Tree; selectedId?: string | null }) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "")
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const markerId = `${uid}-arrow`
  const layout = React.useMemo(() => layoutCausalTree(tree), [tree])
  const sentences = React.useMemo(() => describeTreeAsText(tree), [tree])
  const roots = rootCauses(tree)

  if (tree.events.length === 0) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] px-4 py-8 text-sm text-[var(--color-text-muted)]">
        El árbol se dibuja aquí a medida que escribes el hecho final y sus antecedentes.
      </p>
    )
  }

  const summary = `Árbol de causas con ${tree.events.length} ${tree.events.length === 1 ? "hecho" : "hechos"}, ${tree.relations.length} ${tree.relations.length === 1 ? "relación" : "relaciones"} y ${roots.length} ${roots.length === 1 ? "causa raíz" : "causas raíz"}. Se lee de izquierda a derecha, de las causas raíz al hecho final H1.`

  return (
    <figure className="space-y-2">
      <div
        role="region"
        aria-label="Diagrama del árbol de causas (se desplaza hacia los lados)"
        tabIndex={0}
        className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <svg
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="block max-w-none"
        >
          <title id={titleId}>{summary}</title>
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-[var(--color-text-subtle)]" />
            </marker>
          </defs>

          {layout.looseTop !== null && (
            <text x={16} y={layout.looseTop - 10} className="fill-[var(--color-warning-ink)] text-[11px] font-semibold">Sin conectar al árbol</text>
          )}

          <g fill="none">
            {layout.edges.map((edge) => (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edgePath(edge)}
                className="stroke-[var(--color-text-subtle)]"
                strokeWidth={1.5}
                markerEnd={edge.gate ? undefined : `url(#${markerId})`}
              />
            ))}
          </g>

          {layout.gates.map((gate) => (
            <g key={`gate-${gate.to}`}>
              <line x1={gate.x} y1={gate.y} x2={gate.x + 30 - 2} y2={gate.y} className="stroke-[var(--color-text-subtle)]" strokeWidth={1.5} markerEnd={`url(#${markerId})`} />
              <circle cx={gate.x} cy={gate.y} r={10} className="fill-[var(--color-surface)] stroke-[var(--color-text-subtle)]" strokeWidth={1.5} />
              <text x={gate.x} y={gate.y + 4} textAnchor="middle" className="fill-[var(--color-text)] text-[11px] font-semibold">Y</text>
            </g>
          ))}

          {layout.splits.map((split) => (
            <circle key={`split-${split.id}`} cx={split.x} cy={split.y} r={3.5} className="fill-[var(--color-text-subtle)]" />
          ))}

          {layout.nodes.map((node) => {
            const style = NODE_STYLE[node.role]
            const lines = wrapLabel(node.description || "Sin descripción")
            const emphasised = node.role === "root" || node.role === "final"
            return (
              <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
                {selectedId === node.id && (
                  <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={12} className="fill-none stroke-[var(--color-primary)]" strokeWidth={2} />
                )}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  className={style.rect}
                  strokeWidth={emphasised ? 2.5 : 1.25}
                  strokeDasharray={node.role === "context" || node.role === "loose" ? "5 4" : undefined}
                />
                <text x={12} y={20} className="fill-[var(--color-text)] font-mono text-[12px] font-semibold">{node.id}</text>
                <text x={NODE_W - 12} y={20} textAnchor="end" className={cn("text-[11px] font-semibold", style.role)}>
                  {node.role === "link" ? "" : FACT_ROLE_LABELS[node.role]}
                </text>
                <text className={cn("text-[12px]", node.description ? "fill-[var(--color-text)]" : "fill-[var(--color-text-subtle)]")}>
                  {lines.map((line, i) => <tspan key={i} x={12} y={40 + i * 15}>{line}</tspan>)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <Legend swatch="fill-[var(--color-signal-tint)] stroke-[var(--color-signal)]" thick label="Causa raíz" />
        <Legend swatch="fill-[var(--color-primary-tint)] stroke-[var(--color-primary)]" thick label="Hecho final" />
        <Legend swatch="fill-[var(--color-surface-2)] stroke-[var(--color-border-control)]" dashed label="Contexto (no causal)" />
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" className="fill-[var(--color-surface)] stroke-[var(--color-text-subtle)]" strokeWidth="1.5" /><text x="10" y="14" textAnchor="middle" className="fill-[var(--color-text)] text-[10px] font-semibold">Y</text></svg>
          Conjunción: concurren varios hechos
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.5" className="fill-[var(--color-text-subtle)]" /></svg>
          Punto: un hecho con varias consecuencias
        </span>
      </figcaption>

      <details className="group text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center text-[var(--color-primary-ink)] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          Leer el árbol como texto
        </summary>
        <div id={descId} className="pb-2">
          <p className="text-[var(--color-text-muted)]">{summary}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--color-text)]">
            {sentences.map((sentence) => <li key={sentence}>{sentence}</li>)}
          </ul>
        </div>
      </details>
    </figure>
  )
}

function Legend({ swatch, label, thick, dashed }: { swatch: string; label: string; thick?: boolean; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg aria-hidden width="22" height="14" viewBox="0 0 22 14">
        <rect x="1.5" y="1.5" width="19" height="11" rx="3" className={swatch} strokeWidth={thick ? 2.25 : 1.25} strokeDasharray={dashed ? "3 2" : undefined} />
      </svg>
      {label}
    </span>
  )
}
