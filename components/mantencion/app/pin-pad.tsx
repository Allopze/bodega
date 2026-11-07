"use client"

import { useEffect, useRef, useState } from "react"
import { IconBackspace } from "./icons"
import { FieldError } from "./ui"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

/**
 * Teclado de PIN de 4 dígitos con teclas grandes (guantes). Además de tocar, se
 * puede escribir con un teclado físico. Al completar el cuarto dígito avisa y se
 * vacía solo: quien decide si el PIN sirve es la pantalla que lo pidió.
 */
export function PinPad({ onComplete, error, disabled = false }: { onComplete: (pin: string) => void; error?: string | null; disabled?: boolean }) {
  const [digits, setDigits] = useState("")
  const completeRef = useRef(onComplete)
  useEffect(() => { completeRef.current = onComplete })

  // Los actualizadores son puros (sólo calculan el valor siguiente): React puede
  // ejecutarlos dos veces (modo estricto, render concurrente), y un `setTimeout` o un
  // aviso a la pantalla dentro de ellos se dispararía dos veces. Quien avisa del PIN
  // completo es el efecto de abajo, que depende del valor.
  const push = (digit: string) => {
    if (disabled) return
    setDigits((current) => (current.length >= 4 ? current : current + digit))
  }
  // Con el cuarto dígito ya puesto el teclado queda cerrado: el PIN completo se entrega
  // sí o sí, así que borrar en esa fracción de segundo no cambia nada.
  const erase = () => { if (!disabled) setDigits((current) => (current.length >= 4 ? current : current.slice(0, -1))) }

  useEffect(() => {
    if (digits.length !== 4) return
    // Se vacía en el siguiente turno para que el cuarto punto alcance a verse. Si la
    // pantalla se desmonta antes, el temporizador se cancela y no se entrega un PIN a nadie.
    const timer = setTimeout(() => { setDigits(""); completeRef.current(digits) }, 120)
    return () => clearTimeout(timer)
  }, [digits])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (/^\d$/.test(event.key)) push(event.key)
      else if (event.key === "Backspace") erase()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  // `push` y `erase` sólo dependen de `disabled`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled])

  return (
    <div className="pinbox">
      <div className="pindots" role="img" aria-label={`${digits.length} de 4 dígitos escritos`}>
        {[0, 1, 2, 3].map((index) => <span key={index} className={index < digits.length ? "on" : ""} />)}
      </div>
      <FieldError message={error ?? undefined} />
      <div className="pinpad" role="group" aria-label="Teclado numérico">
        {KEYS.map((key) => <button key={key} type="button" onClick={() => push(key)} disabled={disabled}>{key}</button>)}
        <span aria-hidden="true" />
        <button type="button" onClick={() => push("0")} disabled={disabled}>0</button>
        <button type="button" className="fn" onClick={erase} disabled={disabled} aria-label="Borrar"><IconBackspace /></button>
      </div>
    </div>
  )
}
