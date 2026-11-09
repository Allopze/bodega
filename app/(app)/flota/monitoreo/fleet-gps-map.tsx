"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useRef, useState } from "react"
import { maplibreWorkerUrl, resolveMapStyleUrl } from "@/lib/maps/map-style"
import type { FleetGpsPosition } from "@/lib/services/fleet-gps"

/**
 * Sin `load` en este plazo el mapa se da por caído. El estilo y los primeros
 * tiles llegan en uno o dos segundos; un bloqueo (CSP, worker, proveedor) no
 * siempre emite `error`, y sin aviso quedaba un rectángulo en blanco.
 */
const MAP_LOAD_TIMEOUT_MS = 20_000
const MAP_UNAVAILABLE = "No se pudo cargar el mapa. La tabla de abajo mantiene el monitoreo disponible."

/** Textos propios de MapLibre (títulos y nombres accesibles de los controles). */
const MAP_LOCALE_ES = {
  "Map.Title": "Mapa",
  "NavigationControl.ZoomIn": "Acercar",
  "NavigationControl.ZoomOut": "Alejar",
  "NavigationControl.ResetBearing": "Arrastra para rotar el mapa; haz clic para volver al norte",
  "AttributionControl.ToggleAttribution": "Mostrar u ocultar la atribución",
  "CooperativeGesturesHandler.WindowsHelpText": "Usa Ctrl + rueda para acercar o alejar el mapa",
  "CooperativeGesturesHandler.MacHelpText": "Usa ⌘ + rueda para acercar o alejar el mapa",
  "CooperativeGesturesHandler.MobileHelpText": "Usa dos dedos para mover el mapa",
}

/**
 * El número de cada grupo necesita una fuente que el estilo sirva: sin
 * `text-font`, MapLibre pide «Open Sans Regular», OpenFreeMap responde 404 y la
 * consola se llena de avisos. Liberty trae Noto Sans.
 */
const CLUSTER_COUNT_FONT = ["Noto Sans Bold"]

export function FleetGpsMap({ positions }: { positions: FleetGpsPosition[] }) {
  const element = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<FleetGpsPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const style = resolveMapStyleUrl()

  // Falso positivo de React Doctor: los `nextMap.on(...)` se liberan con
  // `map.remove()` en el cleanup de abajo, que según MapLibre desregistra
  // todos los handlers y el WebGL del mapa. `disposed` cubre el import async.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!element.current || !style || positions.length === 0) return
    let disposed = false
    let loaded = false
    let map: { remove: () => void } | null = null
    const timeout = setTimeout(() => {
      if (!disposed && !loaded) setError(MAP_UNAVAILABLE)
    }, MAP_LOAD_TIMEOUT_MS)
    void (async () => {
      try {
        const maplibregl = await import("maplibre-gl")
        if (disposed || !element.current) return
        maplibregl.setWorkerUrl(maplibreWorkerUrl(maplibregl.getVersion()))
        const features = positions.map((position) => ({
          type: "Feature" as const,
          properties: { id: position.id, plate: position.plate, speedKph: position.speedKph, ignition: position.ignition },
          geometry: { type: "Point" as const, coordinates: [position.longitude, position.latitude] },
        }))
        const nextMap = new maplibregl.Map({
          container: element.current,
          style,
          center: [-70.65, -33.45],
          zoom: 4.5,
          locale: MAP_LOCALE_ES,
          // El mapa ocupa buena parte de la pantalla: sin esto, la rueda (o un
          // dedo en el teléfono) mueve el mapa en vez de bajar a la tabla.
          cooperativeGestures: true,
        })
        map = nextMap
        nextMap.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right")
        // Antes de `load`, un error (estilo bloqueado, proveedor caído) deja el
        // mapa sin nada que dibujar. Después, un tile suelto que falla no lo
        // invalida y no se avisa.
        nextMap.on("error", () => {
          if (!disposed && !loaded) setError(MAP_UNAVAILABLE)
        })
        nextMap.on("load", () => {
          loaded = true
          clearTimeout(timeout)
          if (!disposed) setError(null)
          nextMap.addSource("fleet-gps", { type: "geojson", data: { type: "FeatureCollection", features }, cluster: true, clusterMaxZoom: 12, clusterRadius: 45 })
          nextMap.addLayer({ id: "fleet-gps-clusters", type: "circle", source: "fleet-gps", filter: ["has", "point_count"], paint: { "circle-color": "#005c3f", "circle-radius": 18 } })
          nextMap.addLayer({ id: "fleet-gps-cluster-count", type: "symbol", source: "fleet-gps", filter: ["has", "point_count"], layout: { "text-field": "{point_count_abbreviated}", "text-font": CLUSTER_COUNT_FONT, "text-size": 12 }, paint: { "text-color": "#ffffff" } })
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
        if (!disposed) setError(MAP_UNAVAILABLE)
      }
    })()
    return () => { disposed = true; clearTimeout(timeout); map?.remove() }
  }, [positions, style])

  if (!style) return <p className="rounded-xl border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">El mapa requiere un proveedor aprobado configurado en producción.</p>
  if (positions.length === 0) return null
  return (
    <section aria-label="Mapa de posiciones GPS" className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
      <div className="relative">
        {/* Alto ligado a la ventana: con 360 px fijos el mapa quedaba en 4:1 a lo
            ancho de la página y la flota se veía como una franja. */}
        <div ref={element} className="h-[clamp(320px,65svh,760px)] w-full" />
        {error ? (
          <p role="status" className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface-2)] p-6 text-center text-sm text-[var(--color-text-muted)]">
            {error}
          </p>
        ) : null}
      </div>
      {selected && <p role="status" className="border-t border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]"><strong className="text-[var(--color-text)]">{selected.plate}</strong> · {Math.round(selected.speedKph)} km/h · GPS {selected.gpsReportedAt ?? "sin hora del dispositivo"}</p>}
    </section>
  )
}
