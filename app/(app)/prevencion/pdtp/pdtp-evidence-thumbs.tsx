/**
 * PdtpEvidenceThumbnails — render compacto de las evidencias (foto/PDF)
 * asociadas a una ejecución PDTP.
 *
 * Cada referencia va a su destino (PREV-I05, `pdtpEvidenceHref`): los archivos
 * del directorio PDTP se sirven vía GET /api/prevencion/pdtp/evidence/[name]
 * (auth + scope); la evidencia de otro módulo (capacitación, alcotest,
 * simulacros) se muestra como el chip "En el módulo de origen", sin enlace
 * (D12), porque la ruta PDTP no la sirve y respondía 404.
 */
import { ArrowSquareOut, FileText, FileImage, LinkSimple, Robot } from "@phosphor-icons/react/dist/ssr"
import { Tooltip } from "@/components/ui/tooltip"
import { pdtpEvidenceFileName, pdtpEvidenceHref, pdtpSyntheticEvidenceLabel } from "@/lib/services/pdtp/evidence-href"

export type PdtpEvidenceItem = {
  url: string
  kind: "image" | "pdf" | "other"
}

const EXT_KIND: Record<string, "image" | "pdf" | "other"> = {
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image",
  pdf: "pdf",
}

function classify(url: string): "image" | "pdf" | "other" {
  const lower = url.toLowerCase()
  for (const [ext, kind] of Object.entries(EXT_KIND)) {
    if (lower.endsWith(`.${ext}`)) return kind
  }
  return "other"
}

const CHIP_CLASS = "inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]"

export function PdtpEvidenceThumbs({
  evidenceUrl,
  evidencePhotos,
  evidenceText,
  max = 3,
  origin = null,
}: {
  evidenceUrl: string | null
  evidencePhotos: string[]
  evidenceText: string | null
  max?: number
  /**
   * C-04: con `integration`, la observación la escribió el módulo de origen, no
   * una persona, y se muestra como rótulo automático en vez de como cita.
   */
  origin?: string | null
}) {
  const items: PdtpEvidenceItem[] = []
  if (evidenceUrl) items.push({ url: evidenceUrl, kind: classify(evidenceUrl) })
  for (const p of evidencePhotos) {
    if (p && p !== evidenceUrl) items.push({ url: p, kind: classify(p) })
  }
  if (items.length === 0 && !evidenceText) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.slice(0, max).map((item) => {
        const link = pdtpEvidenceHref(item.url)
        if (!link) return null
        if (link.kind === "source_module") {
          return (
            <Tooltip key={item.url} side="top" content="Esta evidencia llegó por integración: ábrela en el módulo que la registró.">
              <span tabIndex={0} className={`${CHIP_CLASS} cursor-default`}>
                <ArrowSquareOut size={11} aria-hidden="true" />
                En el módulo de origen
              </span>
            </Tooltip>
          )
        }
        if (link.kind === "note") {
          // C-04: una referencia de texto la genera siempre el módulo de origen.
          return <SyntheticLabel key={item.url} text={link.text} />
        }
        const isExternal = link.kind === "external"
        return (
          <Tooltip key={item.url} side="top" content={isExternal ? link.href : pdtpEvidenceFileName(item.url)}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${CHIP_CLASS} hover:bg-[var(--color-surface)]`}
            >
              {isExternal ? <LinkSimple size={11} /> : item.kind === "image" ? <FileImage size={11} /> : <FileText size={11} />}
              {isExternal ? "Enlace" : item.kind === "image" ? "Imagen" : item.kind === "pdf" ? "PDF" : "Adjunto"}
            </a>
          </Tooltip>
        )
      })}
      {items.length > max && (
        <span className="text-[11px] text-[var(--color-text-faint)]">+{items.length - max}</span>
      )}
      {evidenceText && (origin === "integration"
        ? <SyntheticLabel text={evidenceText} />
        : (
          <p className="basis-full text-[11px] italic text-[var(--color-text-muted)]">
            “{evidenceText.length > 140 ? `${evidenceText.slice(0, 140)}…` : evidenceText}”
          </p>
        ))}
    </div>
  )
}

/** Rótulo que escribió un módulo de origen: se distingue de una observación de persona (C-04). */
function SyntheticLabel({ text }: { text: string }) {
  const label = pdtpSyntheticEvidenceLabel(text)
  return (
    <Tooltip side="top" content="Rótulo automático del módulo que registró el hecho.">
      <span tabIndex={0} className={`${CHIP_CLASS} cursor-default`}>
        <Robot size={11} aria-hidden="true" />
        <span className="sr-only">Automático: </span>
        {label.length > 80 ? `${label.slice(0, 80)}…` : label}
      </span>
    </Tooltip>
  )
}
