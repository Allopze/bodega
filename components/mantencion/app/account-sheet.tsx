"use client"

import { useState } from "react"
import { checkPin, setActiveAccount } from "@/lib/mantencion/client/accounts"
import { queueStats } from "@/lib/mantencion/client/queue"
import type { DeviceAccount } from "@/lib/mantencion/client/types"
import { plural } from "@/lib/mantencion/format"
import { useAppData } from "./app-context"
import { Sheet } from "./dialog"
import { PinPad } from "./pin-pad"
import { initials } from "./ui"

/**
 * «Cambiar de cuenta»: lista las cuentas que ya entraron en este equipo y exige
 * el PIN de la elegida (con o sin señal, D7). «Entrar con otra cuenta» pasa por
 * el login normal de la plataforma y agrega a alguien nuevo.
 */
export function AccountSheet({ onClose, onSwitched, onOtherAccount, onForgotPin }: {
  onClose: () => void
  onSwitched: (account: DeviceAccount) => void
  onOtherAccount: () => void
  onForgotPin: (account: DeviceAccount) => void
}) {
  const { account, accounts, queue, online, now } = useAppData()
  const [picked, setPicked] = useState<DeviceAccount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const others = accounts.filter((entry) => entry.userId !== account.userId)

  const verify = async (pin: string) => {
    if (!picked) return
    setChecking(true)
    try {
      const result = await checkPin(picked.userId, pin)
      if (result.ok) {
        await setActiveAccount(picked.userId)
        onSwitched(picked)
        return
      }
      if (result.locked) {
        const seconds = Math.max(1, Math.ceil((result.until - Date.now()) / 1000))
        setError(`Demasiados intentos. Espera ${seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`} y vuelve a intentar.`)
      } else {
        setError(result.attemptsLeft > 0 ? `PIN incorrecto. Te ${result.attemptsLeft === 1 ? "queda 1 intento" : `quedan ${result.attemptsLeft} intentos`}.` : "Esta cuenta no tiene PIN en este teléfono. Entra con su contraseña.")
      }
    } finally {
      setChecking(false)
    }
  }

  if (picked) {
    return (
      <Sheet title={`PIN de ${picked.name}`} onClose={onClose}>
        <p className="hint" style={{ margin: 0 }}>Escribe los 4 números de tu PIN para registrar como {picked.name}.</p>
        <PinPad onComplete={(pin) => { void verify(pin) }} error={error} disabled={checking} />
        <div className="banner-actions" style={{ marginTop: 0 }}>
          <button type="button" className="btns" onClick={() => { setPicked(null); setError(null) }}>Elegir otra cuenta</button>
          <button type="button" className="lnk" onClick={() => onForgotPin(picked)} disabled={!online} title={online ? undefined : "Necesitas señal para entrar con tu contraseña."}>Olvidé mi PIN</button>
        </div>
        {!online ? <p className="hint" style={{ margin: 0 }}>Para cambiar el PIN necesitas señal: se hace entrando con tu contraseña.</p> : null}
      </Sheet>
    )
  }

  return (
    <Sheet title="Cambiar de cuenta" onClose={onClose}>
      <p className="hint" style={{ margin: 0 }}>
        Estás registrando como <strong style={{ color: "var(--ink)" }}>{account.name}</strong>. Elige quién sigue: te pedimos su PIN.
      </p>
      {others.length > 0 ? (
        <div className="list" style={{ gap: 6 }}>
          {others.map((entry) => {
            const pending = queueStats(queue, entry.userId, now).pending
            return (
              <button key={entry.userId} type="button" className="eqrow" style={{ minHeight: 56 }} onClick={() => { setPicked(entry); setError(null) }}>
                <span className="avatar" aria-hidden="true">{initials(entry.name)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 16, fontWeight: 600 }}>{entry.name}</span>
                  {pending > 0 ? <span className="hint" style={{ display: "block", margin: 0 }}>{plural(pending, "registro por enviar", "registros por enviar")}</span> : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="empty">Todavía no entró nadie más en este teléfono. Con «Entrar con otra cuenta» puedes agregar a otro mecánico.</p>
      )}
      <button type="button" className="btns wide" onClick={onOtherAccount}>Entrar con otra cuenta</button>
      <button type="button" className="btns wide" onClick={onClose}>Cancelar</button>
    </Sheet>
  )
}
