"use client"

import * as React from "react"
import QRCode from "qrcode"
import { QrCode, Copy, DownloadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { toast } from "@/lib/toast"

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <QrCode size={15} />
          QR / Enlace
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Acceso para el trabajador</DialogTitle>
          <DialogDescription>
            Comparte el QR o el enlace directo. El trabajador abre el formulario
            sin iniciar sesión, con la faena precargada.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Selector de faena */}
          <label className="flex flex-col gap-1.5">
            <span className="text-eyebrow">Faena (precarga el formulario)</span>
            <Select value={worksiteId || "all"} onValueChange={(v) => setWorksiteId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full">
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

          {/* QR */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-(--color-border) bg-white p-2">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr}
                  alt={`Código QR del PPA para ${faenaName}`}
                  className="h-full w-full animate-[fade-in_var(--duration-default)_var(--ease-out)]"
                />
              ) : (
                <QrCode size={52} className="text-text-faint" />
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={downloadQr}
              disabled={!qr}
              className="w-44"
            >
              <DownloadSimple size={14} /> Descargar QR
            </Button>
          </div>

          {/* Enlace directo */}
          <div className="flex flex-col gap-1.5">
            <span className="text-eyebrow">Enlace directo</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-(--color-border) bg-surface-2 px-2.5 py-1.5 font-mono text-xs">
                {link || "…"}
              </code>
              <Button type="button" variant="secondary" size="sm" onClick={copyLink} disabled={!link}>
                <Copy size={14} /> Copiar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
