"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useRef, useState } from "react"
import type { FleetGpsPosition } from "@/lib/services/fleet-gps"

const developmentStyle = "https://tiles.openfreemap.org/styles/liberty"

function mapStyleUrl() {
  const configured = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim()
  if (configured) return configured
  return process.env.NODE_ENV === "production" ? null : developmentStyle
}

export function FleetGpsMap({ positions }: { positions: FleetGpsPosition[] }) {
  const element = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<FleetGpsPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const style = mapStyleUrl()

  useEffect(() => {
    if (!element.current || !style || positions.length === 0) return
    let disposed = false
    let map: { remove: () => void } | null = null
    void (async () => {
      try {
        const maplibregl = await import("maplibre-gl")
        if (disposed || !element.current) return
        const features = positions.map((position) => ({
          type: "Feature" as const,
          properties: { id: position.id, plate: position.plate, speedKph: position.speedKph, ignition: position.ignition },
          geometry: { type: "Point" as const, coordinates: [position.longitude, position.latitude] },
        }))
        const nextMap = new maplibregl.Map({ container: element.current, style, center: [-70.65, -33.45], zoom: 4.5 })
        map = nextMap
        nextMap.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right")
        nextMap.on("load", () => {
          nextMap.addSource("fleet-gps", { type: "geojson", data: { type: "FeatureCollection", features }, cluster: true, clusterMaxZoom: 12, clusterRadius: 45 })
          nextMap.addLayer({ id: "fleet-gps-clusters", type: "circle", source: "fleet-gps", filter: ["has", "point_count"], paint: { "circle-color": "#005c3f", "circle-radius": 18 } })
          nextMap.addLayer({ id: "fleet-gps-cluster-count", type: "symbol", source: "fleet-gps", filter: ["has", "point_count"], layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 }, paint: { "text-color": "#ffffff" } })
          nextMap.addLayer({ id: "fleet-gps-points", type: "circle", source: "fleet-gps", filter: ["!", ["has", "point_count"]], paint: { "circle-color": ["case", ["get", "ignition"], "#005c3f", "#64748b"], "circle-radius": 7, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } })
          nextMap.on("click", "fleet-gps-points", (event) => {
            const id = event.features?.[0]?.properties?.id
            const row = positions.find((position) => position.id === id)
            if (row) setSelected(row)
          })
          const bounds = new maplibregl.LngLatBounds()
          for (const position of positions) bounds.extend([position.longitude, position.latitude])
          const onlyPosition = positions[0]
          if (onlyPosition && positions.length === 1) nextMap.flyTo({ center: [onlyPosition.longitude, onlyPosition.latitude], zoom: 13 })
          else nextMap.fitBounds(bounds, { padding: 42, maxZoom: 13 })
        })
      } catch {
        if (!disposed) setError("No se pudo cargar el mapa. La tabla mantiene el monitoreo accesible.")
      }
    })()
    return () => { disposed = true; map?.remove() }
  }, [positions, style])

  if (!style) return <p className="rounded-xl border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">El mapa requiere un proveedor aprobado configurado en producción.</p>
  if (positions.length === 0) return null
  return (
    <section aria-label="Mapa de posiciones GPS" className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
      <div ref={element} className="h-[360px] w-full" />
      {error && <p role="status" className="border-t border-[var(--color-border)] p-3 text-sm text-[var(--color-warning-ink)]">{error}</p>}
      {selected && <p role="status" className="border-t border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]"><strong className="text-[var(--color-text)]">{selected.plate}</strong> · {Math.round(selected.speedKph)} km/h · GPS {selected.gpsReportedAt ?? "sin hora del dispositivo"}</p>}
    </section>
  )
}
