"use client"

import * as React from "react"
import QRCode from "qrcode"
import { QrCode, Copy, DownloadSimple, CaretDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"

/**
 * Panel de acceso del trabajador en terreno: enlace directo + QR por faena.
 * El trabajador escanea/abre y llega al formulario público sin login, con la
 * faena precargada. Compacto y colapsable para no competir con el historial.
 */
export function PpaAccessPanel({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState("")
  const [origin, setOrigin] = React.useState("")
  const [qr, setQr] = React.useState("")

  React.useEffect(() => { setOrigin(window.location.origin) }, [])

  const link = React.useMemo(() => {
    if (!origin) return ""
    return worksiteId ? `${origin}/ppa?faena=${worksiteId}` : `${origin}/ppa`
  }, [origin, worksiteId])

  React.useEffect(() => {
    if (!open || !link) { setQr(""); return }
    let active = true
    QRCode.toDataURL(link, { width: 320, margin: 2 })
      .then((url) => { if (active) setQr(url) })
      .catch(() => { if (active) setQr("") })
    return () => { active = false }
  }, [open, link])

  const faenaName = worksites.find((w) => w.id === worksiteId)?.name ?? "Acceso general"

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      toast.success("Enlace copiado")
    } catch {
      toast.error("No se pudo copiar el enlace")
    }
  }

  function downloadQr() {
    if (!qr) return
    const a = document.createElement("a")
    a.href = qr
    a.download = worksiteId ? `ppa-qr-${worksiteId}.png` : "ppa-qr-general.png"
    a.click()
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <QrCode size={16} className="text-[var(--color-text-muted)]" />
        <span className="text-sm font-semibold">Acceso para el trabajador (QR / enlace)</span>
        <CaretDown
          size={14}
          className={cn(
            "ml-auto text-[var(--color-text-subtle)] transition-transform duration-[var(--duration-fast)]",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-[var(--color-border)] p-4 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-eyebrow">Faena (precarga el formulario)</span>
              <Select value={worksiteId || "all"} onValueChange={(v) => setWorksiteId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue placeholder="Faena" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">General (sin faena)</SelectItem>
                  {worksites.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-eyebrow">Enlace directo</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 font-mono text-xs">
                  {link || "…"}
                </code>
                <Button type="button" variant="secondary" size="sm" onClick={copyLink} disabled={!link}>
                  <Copy size={14} /> Copiar
                </Button>
              </div>
            </div>

            <p className="text-xs text-[var(--color-text-subtle)]">
              Imprime el QR y colócalo en terreno. Al escanearlo, el trabajador abre el PPA con la faena
              «{faenaName}» precargada, sin necesidad de iniciar sesión.
            </p>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex h-40 w-40 items-center justify-center rounded-md border border-[var(--color-border)] bg-white p-2">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt={`Código QR del PPA para ${faenaName}`} className="h-full w-full" />
              ) : (
                <QrCode size={48} className="text-[var(--color-text-faint)]" />
              )}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={downloadQr} disabled={!qr} className="w-40">
              <DownloadSimple size={14} /> Descargar QR
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
