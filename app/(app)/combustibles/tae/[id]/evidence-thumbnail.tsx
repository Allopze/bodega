"use client"

import { useState } from "react"
import Image from "next/image"
import { X } from "@phosphor-icons/react"

const EVIDENCE_LABELS: Record<string, string> = { odometer: "Odómetro / horómetro", liter_meter: "Medidor de litros", removed_seal: "Sello retirado", installed_seal: "Sello instalado" }

interface EvidenceRecord {
  id: string
  kind: string
  fileName: string | null
  filePath: string | null
  fileSize: number | null
  mimeType: string | null
  sha256: string | null
  capturedAt: string | null
  createdAt: string | null
}

type Props = { evidence: EvidenceRecord }

export function EvidenceThumbnail({ evidence }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block w-full overflow-hidden border border-(--color-border) bg-(--color-surface-2) text-left text-sm hover:border-(--color-primary-line)"
      >
        {evidence.filePath ? (
          <Image unoptimized src={`/api/tae/evidence/${evidence.id}`} alt={EVIDENCE_LABELS[evidence.kind] ?? "Evidencia TAE"} width={640} height={420} className="aspect-[4/3] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center p-4 text-center text-(--color-text-muted)">Abrir evidencia histórica</div>
        )}
        <span className="block p-3">
          <span className="block text-xs text-[var(--color-text-muted)]">{EVIDENCE_LABELS[evidence.kind] ?? evidence.kind}</span>
          <span className="mt-1 block truncate">{evidence.fileName}</span>
          {evidence.fileSize != null && <span className="block text-xs text-[var(--color-text-muted)]">{Math.round(evidence.fileSize / 1024)} KB</span>}
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(false)}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar evidencia"
            className="absolute top-4 right-4 z-10 flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X size={18} />
          </button>

          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {evidence.filePath ? (
              <Image unoptimized src={`/api/tae/evidence/${evidence.id}`} alt={EVIDENCE_LABELS[evidence.kind] ?? "Evidencia"} width={1200} height={800} className="max-h-[85vh] w-auto rounded object-contain" />
            ) : (
              <div className="flex h-64 w-96 items-center justify-center bg-(--color-surface) text-(--color-text-muted)">Sin imagen disponible</div>
            )}

            {evidence.capturedAt && (
              <p className="mt-2 text-center text-xs text-white/60">
                Capturada: {new Date(evidence.capturedAt).toLocaleString("es-CL")}
                {evidence.fileName && <> · {evidence.fileName}</>}
                {evidence.sha256 && <span className="ml-2 font-mono text-white/40" title={`SHA-256: ${evidence.sha256}`}>SHA-256</span>}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
