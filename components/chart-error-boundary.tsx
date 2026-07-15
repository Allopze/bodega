"use client"

import React from "react"
import { ChartLineUp } from "@phosphor-icons/react"

interface Props {
  children: React.ReactNode
  /** Etiqueta del gráfico para el mensaje de error (ej. "Evolución mensual"). */
  chartName?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ChartErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-64 flex-col items-center justify-center border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-6 text-center">
          <ChartLineUp size={24} className="mb-2 text-[var(--color-warning-ink)]" aria-hidden />
          <p className="max-w-64 text-sm leading-5 text-[var(--color-text-muted)]">
            No se pudo dibujar {this.props.chartName ?? "este gráfico"}. Los datos siguen disponibles en la tabla.
          </p>
        </div>
      )
    }

    return this.props.children
  }
}
