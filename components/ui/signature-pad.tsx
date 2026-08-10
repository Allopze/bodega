"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"

interface SignaturePadProps {
  name?: string
  disabled?: boolean
  onSignatureChange?: (hasSignature: boolean) => void
}

export function SignaturePad({
  name = "signatureFile",
  disabled = false,
  onSignatureChange,
}: SignaturePadProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  // El trazo no altera la UI hasta que termina; un ref evita renders por cada
  // inicio/fin y está disponible de inmediato para el primer mousemove/touchmove.
  const isDrawingRef = React.useRef(false)
  const [isEmpty, setIsEmpty] = React.useState(true)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas dimensions
    canvas.width = canvas.offsetWidth || 350
    canvas.height = 140

    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#0f172a"
  }, [])

  const updateFileInput = React.useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !fileInputRef.current) return

    if (isEmpty) {
      fileInputRef.current.value = ""
      onSignatureChange?.(false)
      return
    }

    canvas.toBlob((blob) => {
      if (!blob || !fileInputRef.current) return
      const file = new File([blob], "firma-trabajador.png", { type: "image/png" })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      fileInputRef.current.files = dataTransfer.files
      onSignatureChange?.(true)
    }, "image/png")
  }, [isEmpty, onSignatureChange])

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    if ("touches" in e) {
      const touch = e.touches[0]
      if (!touch) return { x: 0, y: 0 }
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function startDrawing(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (disabled) return
    isDrawingRef.current = true
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || disabled) return
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    if (isEmpty) {
      setIsEmpty(false)
    }
  }

  function stopDrawing() {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    updateFileInput()
  }

  function handleClear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
    if (fileInputRef.current) fileInputRef.current.value = ""
    onSignatureChange?.(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className={`w-full touch-none ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-crosshair"}`}
        />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[var(--color-text-subtle)]">
            Firme aquí (mouse o pantalla táctil)
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <input ref={fileInputRef} type="file" name={name} className="hidden" accept="image/png" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={isEmpty || disabled}
          className="px-2 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
        >
          Limpiar firma
        </Button>
        {!isEmpty && <span className="text-xs text-[var(--color-success)] font-medium">Firma capturada ✓</span>}
      </div>
    </div>
  )
}
