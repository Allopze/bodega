/**
 * PdtpEvidenceThumbnails — render compacto de las evidencias (foto/PDF)
 * asociadas a una ejecución PDTP. Los archivos se sirven vía
 * GET /api/prevencion/pdtp/evidence/[name] (auth + scope).
 */
import { FileText, FileImage } from "@phosphor-icons/react/dist/ssr"
import { Tooltip } from "@/components/ui/tooltip"

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

/** Extrae el `name` final de un path `storage/pdtp-evidence/abc.jpg`. */
function fileName(url: string): string {
  const idx = url.lastIndexOf("/")
  return idx >= 0 ? url.slice(idx + 1) : url
}

function evidenceHref(url: string): string {
  const name = fileName(url)
  return `/api/prevencion/pdtp/evidence/${encodeURIComponent(name)}`
}

export function PdtpEvidenceThumbs({
  evidenceUrl,
  evidencePhotos,
  evidenceText,
  max = 3,
}: {
  evidenceUrl: string | null
  evidencePhotos: string[]
  evidenceText: string | null
  max?: number
}) {
  const items: PdtpEvidenceItem[] = []
  if (evidenceUrl) items.push({ url: evidenceUrl, kind: classify(evidenceUrl) })
  for (const p of evidencePhotos) {
    if (p && p !== evidenceUrl) items.push({ url: p, kind: classify(p) })
  }
  if (items.length === 0 && !evidenceText) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.slice(0, max).map((item) => (
        <Tooltip key={item.url} side="top" content={fileName(item.url)}>
          <a
            href={evidenceHref(item.url)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"
          >
            {item.kind === "image" ? <FileImage size={11} /> : <FileText size={11} />}
            {item.kind === "image" ? "Imagen" : item.kind === "pdf" ? "PDF" : "Adjunto"}
          </a>
        </Tooltip>
      ))}
      {items.length > max && (
        <span className="text-[11px] text-[var(--color-text-faint)]">+{items.length - max}</span>
      )}
      {evidenceText && (
        <p className="basis-full text-[11px] italic text-[var(--color-text-muted)]">
          “{evidenceText.length > 140 ? `${evidenceText.slice(0, 140)}…` : evidenceText}”
        </p>
      )}
    </div>
  )
}
