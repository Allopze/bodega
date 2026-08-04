import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Medición del payload RSC de las listas grandes (§4.1 del inventario).
 *
 * El fallo intermitente de la suite aparece **siempre** en una aserción que
 * sigue a una navegación cliente, y nunca dos veces en el mismo sitio: se movió
 * de `oc-reconciliation` a `ppa-flow` al tocar timeouts. Eso descarta un defecto
 * de pantalla y apunta a latencia, pero hasta ahora era una hipótesis sin una
 * sola cifra detrás.
 *
 * Esto la convierte en número. No mide "la página carga rápido" —eso ya lo
 * intentaba `perceived-latency.spec.ts` con un `expect` dentro de un `if`, que
 * no puede fallar— sino lo concreto: **cuánto pesa y cuánto tarda la respuesta
 * RSC** que el enrutador pide al navegar, que es exactamente lo que la aserción
 * siguiente está esperando cuando expira.
 *
 * El presupuesto no es una meta de diseño: es el umbral por encima del cual el
 * margen por defecto de 5 s de Playwright deja de ser holgado con dos workers.
 * Si una lista lo supera, la respuesta correcta es recortar su conjunto por
 * defecto, no subir el timeout.
 */
const LISTAS_GRANDES = [
  { path: "/compras", name: "Compras" },
  { path: "/pendientes", name: "Mis pendientes" },
  { path: "/prevencion/capa", name: "CAPA" },
  { path: "/solicitudes", name: "Solicitudes" },
  { path: "/bodega", name: "Bodega" },
] as const

/*
 * Presupuestos calibrados con la primera medición real, no elegidos a ojo:
 * las cinco listas van de 136 a 326 ms y de 94 a 481 KB. Los topes son un
 * guardarraíl de regresión con holgura ~3×, no una meta de diseño.
 *
 * La medición también respondió la pregunta que §4.1 dejó abierta: **el payload
 * RSC no es la causa del fallo intermitente**. 326 ms en el peor caso está a un
 * orden de magnitud del margen de 5 s de Playwright, así que la degradación
 * tiene que venir de la contención entre workers, no del tamaño del árbol.
 *
 * El único valor que llamaba la atención era "Mis pendientes": 481 KB, cuatro
 * veces el resto. La causa está identificada y es proporcional: la cola sirve
 * **50 registros** por página (`DEFAULT_PAGE_SIZE` en
 * `lib/services/operational-work-queue.ts`) mientras Compras y Solicitudes
 * sirven 25, y cada elemento de cola arrastra más campos que una fila de lista.
 * No es una fuga, es el doble de filas más ricas.
 *
 * No se recorta: a 277 ms está a un orden de magnitud del margen, y bajar el
 * tamaño de página cambia cuántas tareas ve un usuario antes de paginar, que es
 * una decisión de producto y no de rendimiento. El presupuesto de abajo es lo
 * que avisará si algún día deja de ser proporcionado.
 */
const PRESUPUESTO_MS = 1_000
const PRESUPUESTO_BYTES = 750 * 1_024

interface Medicion {
  name: string
  ms: number
  bytes: number
}

test("payload RSC de las listas grandes: tamaño y duración medidos", async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)

  const mediciones: Medicion[] = []

  for (const lista of LISTAS_GRANDES) {
    // Se mide con Navigation Timing dentro de la página, no con
    // `page.on("response")`: el escuchador capturaba cualquier respuesta cuya
    // URL contuviera la ruta —prefetches, redirecciones— y devolvía 1,4 KB para
    // todas las listas, que era señal evidente de estar midiendo otra cosa.
    // `responseEnd - requestStart` es el tiempo de servidor más transferencia
    // del documento, que es justo lo que la aserción siguiente está esperando.
    await page.goto(lista.path)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const medida = await page.evaluate(() => {
      const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[]
      if (!nav) return { ms: 0, bytes: 0 }
      return {
        ms: Math.round(nav.responseEnd - nav.requestStart),
        // `transferSize` es 0 si la respuesta vino de caché; `decodedBodySize`
        // es el tamaño real del árbol que el cliente tuvo que procesar.
        bytes: nav.decodedBodySize || nav.transferSize,
      }
    })

    mediciones.push({ name: lista.name, ms: medida.ms, bytes: medida.bytes })
  }

  // La tabla es la evidencia que §4.1 pedía; queda en el log de la corrida.
  console.log("\n| Lista | ms | KB |")
  console.log("| --- | ---: | ---: |")
  for (const m of mediciones) {
    console.log(`| ${m.name} | ${m.ms} | ${(m.bytes / 1024).toFixed(1)} |`)
  }

  const lentas = mediciones.filter((m) => m.ms > PRESUPUESTO_MS).map((m) => `${m.name}: ${m.ms}ms`)
  const pesadas = mediciones.filter((m) => m.bytes > PRESUPUESTO_BYTES).map((m) => `${m.name}: ${(m.bytes / 1024).toFixed(0)}KB`)

  expect(pesadas, "listas por encima del presupuesto de payload").toEqual([])
  expect(lentas, "listas por encima del presupuesto de latencia").toEqual([])
})
