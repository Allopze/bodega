"use client"

import { useState } from "react"
import { setPin } from "@/lib/mantencion/client/accounts"
import { PinPad } from "./pin-pad"
import { firstName } from "./ui"

/**
 * Primer ingreso: el mecánico define su PIN de 4 dígitos (dos veces). Se pide
 * antes de entrar a la app porque es lo que protege el cambio de cuenta en un
 * teléfono o tablet compartido, con o sin señal.
 */
export function PinSetup({ userId, name, onDone }: { userId: string; name: string; onDone: () => void }) {
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (pin: string) => {
    if (first === null) { setFirst(pin); setError(null); return }
    if (pin !== first) { setFirst(null); setError("Los PIN no coinciden. Escríbelos de nuevo."); return }
    setSaving(true)
    try {
      await setPin(userId, pin)
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar el PIN. Intenta de nuevo.")
      setFirst(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="scr">
      <div className="pin-full">
        <div>
          <div className="cap">Primer ingreso</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Hola, {firstName(name)}</h1>
        </div>
        <div>
          <h2 className="h2" style={{ fontSize: 21 }}>{first === null ? "Define tu PIN" : "Repite tu PIN"}</h2>
          <p className="hint" style={{ maxWidth: 320, margin: "8px auto 0" }}>
            Son 4 números. Lo vas a usar para volver a tu cuenta en este teléfono, con o sin señal.
          </p>
        </div>
        <PinPad key={first === null ? "primero" : "segundo"} onComplete={(pin) => { void submit(pin) }} error={error} disabled={saving} />
      </div>
    </div>
  )
}
