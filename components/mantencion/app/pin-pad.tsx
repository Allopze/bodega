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

  const push = (digit: string) => {
    if (disabled) return
    setDigits((current) => {
      if (current.length >= 4) return current
      const next = current + digit
      if (next.length === 4) {
        // Se vacía en el siguiente turno para que el cuarto punto alcance a verse.
        setTimeout(() => { setDigits(""); completeRef.current(next) }, 120)
      }
      return next
    })
  }
  const erase = () => { if (!disabled) setDigits((current) => current.slice(0, -1)) }

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
