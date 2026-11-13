"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { GeoJSONSource, Map as MapLibreMap, Popup } from "maplibre-gl"
import { maplibreWorkerUrl, resolveMapStyleUrl } from "@/lib/maps/map-style"
import type { FleetGpsPosition } from "@/lib/services/fleet-gps"
import { FleetGpsVehiclePopup } from "./fleet-gps-vehicle-popup"

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
  "Popup.Close": "Cerrar",
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

const SOURCE_ID = "fleet-gps"
const CLUSTER_LAYER = "fleet-gps-clusters"
const POINT_LAYER = "fleet-gps-points"

function featureCollection(positions: FleetGpsPosition[]) {
  return {
    type: "FeatureCollection" as const,
    features: positions.map((position) => ({
      type: "Feature" as const,
      properties: { id: position.id, ignition: position.ignition, ignitionKnown: position.ignitionKnown },
      geometry: { type: "Point" as const, coordinates: [position.longitude, position.latitude] },
    })),
  }
}

export function FleetGpsMap({ positions }: { positions: FleetGpsPosition[] }) {
  const element = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<Popup | null>(null)
  // Las posiciones vigentes para los handlers del mapa, que se registran una sola vez.
  const positionsRef = useRef(positions)
  const [loaded, setLoaded] = useState(false)
  const [popupNode, setPopupNode] = useState<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const style = resolveMapStyleUrl()
  const hasPositions = positions.length > 0
  const selected = selectedId ? positions.find((position) => position.id === selectedId) ?? null : null

  // El mapa se crea una vez. La página se recarga (hasta cada 10 s) con posiciones
  // nuevas (refresco en vivo): rearmarlo perdería el zoom, el encuadre y el
  // popup abierto, así que los datos nuevos entran por `setData` (abajo).
  // Falso positivo de React Doctor: los `nextMap.on(...)` se liberan con
  // `map.remove()` en el cleanup, que según MapLibre desregistra todos los
  // handlers y el WebGL del mapa. `disposed` cubre el import async.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!element.current || !style || !hasPositions) return
    let disposed = false
    let isLoaded = false
    const timeout = setTimeout(() => {
      if (!disposed && !isLoaded) setError(MAP_UNAVAILABLE)
    }, MAP_LOAD_TIMEOUT_MS)
    void (async () => {
      try {
        const maplibregl = await import("maplibre-gl")
        if (disposed || !element.current) return
        maplibregl.setWorkerUrl(maplibreWorkerUrl(maplibregl.getVersion()))
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
        mapRef.current = nextMap
        nextMap.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right")

        // `closeOnClick: false`: el clic en el mapa lo decide el handler de
        // abajo. Con el cierre automático, un clic sobre el mismo punto cerraba
        // el popup y la selección no cambiaba, así que no se volvía a abrir.
        const popup = new maplibregl.Popup({ closeOnClick: false, offset: 14, maxWidth: "320px", className: "fleet-gps-popup" })
        const node = document.createElement("div")
        popup.setDOMContent(node)
        popup.on("close", () => { if (!disposed) setSelectedId(null) })
        popupRef.current = popup
        setPopupNode(node)

        // Antes de `load`, un error (estilo bloqueado, proveedor caído) deja el
        // mapa sin nada que dibujar. Después, un tile suelto que falla no lo
        // invalida y no se avisa.
        nextMap.on("error", () => {
          if (!disposed && !isLoaded) setError(MAP_UNAVAILABLE)
        })
        nextMap.on("load", () => {
          isLoaded = true
          clearTimeout(timeout)
          if (disposed) return
          setError(null)
          const initial = positionsRef.current
          nextMap.addSource(SOURCE_ID, { type: "geojson", data: featureCollection(initial), cluster: true, clusterMaxZoom: 12, clusterRadius: 45 })
          nextMap.addLayer({ id: CLUSTER_LAYER, type: "circle", source: SOURCE_ID, filter: ["has", "point_count"], paint: { "circle-color": "#005c3f", "circle-radius": 18 } })
          nextMap.addLayer({ id: "fleet-gps-cluster-count", type: "symbol", source: SOURCE_ID, filter: ["has", "point_count"], layout: { "text-field": "{point_count_abbreviated}", "text-font": CLUSTER_COUNT_FONT, "text-size": 12 }, paint: { "text-color": "#ffffff" } })
          nextMap.addLayer({ id: POINT_LAYER, type: "circle", source: SOURCE_ID, filter: ["!", ["has", "point_count"]], paint: { "circle-color": ["case", ["!", ["get", "ignitionKnown"]], "#94a3b8", ["get", "ignition"], "#005c3f", "#64748b"], "circle-radius": 7, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } })

          nextMap.on("click", (event) => {
            const [feature] = nextMap.queryRenderedFeatures(event.point, { layers: [POINT_LAYER, CLUSTER_LAYER] })
            if (!feature) { setSelectedId(null); return }
            if (feature.layer.id === POINT_LAYER) {
              const id = feature.properties?.id
              setSelectedId(typeof id === "string" ? id : null)
              return
            }
            // Un grupo se abre acercando hasta donde sus vehículos se separan.
            const clusterId = Number(feature.properties?.cluster_id)
            const center = feature.geometry.type === "Point" ? feature.geometry.coordinates as [number, number] : null
            const source = nextMap.getSource<GeoJSONSource>(SOURCE_ID)
            if (!source || !center || !Number.isFinite(clusterId)) return
            void source.getClusterExpansionZoom(clusterId)
              .then((zoom) => { if (!disposed) nextMap.easeTo({ center, zoom }) })
              .catch(() => undefined)
          })
          for (const layer of [POINT_LAYER, CLUSTER_LAYER]) {
            nextMap.on("mouseenter", layer, () => { nextMap.getCanvas().style.cursor = "pointer" })
            nextMap.on("mouseleave", layer, () => { nextMap.getCanvas().style.cursor = "" })
          }

          const bounds = new maplibregl.LngLatBounds()
          for (const position of initial) bounds.extend([position.longitude, position.latitude])
          const onlyPosition = initial[0]
          if (onlyPosition && initial.length === 1) nextMap.jumpTo({ center: [onlyPosition.longitude, onlyPosition.latitude], zoom: 13 })
          else nextMap.fitBounds(bounds, { padding: 42, maxZoom: 13, animate: false })
          setLoaded(true)
        })
      } catch {
        if (!disposed) setError(MAP_UNAVAILABLE)
      }
    })()
    return () => {
      disposed = true
      clearTimeout(timeout)
      popupRef.current?.remove()
      popupRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      setPopupNode(null)
      setLoaded(false)
    }
  }, [style, hasPositions])

  // Datos nuevos del refresco: se reemplazan los puntos sin tocar la vista.
  useEffect(() => {
    positionsRef.current = positions
    if (!loaded) return
    mapRef.current?.getSource<GeoJSONSource>(SOURCE_ID)?.setData(featureCollection(positions))
  }, [positions, loaded])

  // El popup sigue al vehículo seleccionado: se mueve con él y se cierra si
  // deja de venir en los datos.
  const selectedLng = selected?.longitude
  const selectedLat = selected?.latitude
  useEffect(() => {
    const map = mapRef.current
    const popup = popupRef.current
    if (!map || !popup || !loaded) return
    if (selectedLng === undefined || selectedLat === undefined) {
      if (popup.isOpen()) popup.remove()
      return
    }
    popup.setLngLat([selectedLng, selectedLat])
    if (!popup.isOpen()) popup.addTo(map)
  }, [selectedId, selectedLng, selectedLat, loaded])

  if (!style) return <p className="rounded-xl border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">El mapa requiere un proveedor aprobado configurado en producción.</p>
  if (!hasPositions) return null
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
      {popupNode && selected ? createPortal(<FleetGpsVehiclePopup position={selected} />, popupNode) : null}
    </section>
  )
}
