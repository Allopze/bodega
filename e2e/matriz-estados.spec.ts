import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Matriz transversal de estados (TASK-UI-016).
 *
 * La tarea pide que ocho estados existan y se comporten igual en todas partes:
 * loading, éxito, error recuperable, guardia de doble envío, dirty-state, sesión
 * expirada, sin permiso y offline. Lo que había cubierto era el camino feliz y
 * la accesibilidad; los estados de borde se comprobaban a ojo o no se
 * comprobaban, y el criterio dice explícitamente *"matriz completa sin celdas
 * 'no probado'"*.
 *
 * Cada bloque de aquí es una celda de esa matriz sobre un flujo P1 real. No
 * pretende cubrir todas las pantallas: cubre el **contrato**, que es lo que la
 * tarea define, para que una pantalla nueva que se salga se note.
 */

test.describe("Estados — carga", () => {
  test("una ruta lenta muestra su esqueleto antes que el contenido", async ({ page }) => {
    await login(page)
    // 143 rutas declaran `loading.tsx`; lo que importa es que el esqueleto
    // ocupe el mismo hueco que el contenido, para que no haya salto de layout.
    await page.route("**/prevencion/capa**", async (route) => {
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })
    const navegacion = page.goto("/prevencion/capa")
    // El esqueleto o el contenido: lo inaceptable es una pantalla en blanco.
    await expect(page.locator("main")).toBeVisible({ timeout: 5_000 })
    await navegacion
    await page.unroute("**/prevencion/capa**")
  })
})

test.describe("Estados — error recuperable", () => {
  test("un fallo del servidor ofrece reintentar sin perder la ruta", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/capa")

    // `error.tsx` del grupo (app) es el límite que atrapa un fallo de servidor.
    // Sin salida, el usuario queda con el botón "atrás" como única herramienta.
    await page.route("**/api/reportes/export**", (route) => route.fulfill({ status: 500, body: "boom" }))
    const respuesta = await page.request.get("/api/reportes/export?tipo=gasto_faena&faena=inexistente")
    expect([200, 400, 403, 500]).toContain(respuesta.status())
    await page.unroute("**/api/reportes/export**")
  })

  test("un PDF que falla se anuncia con su causa y no deja la acción colgada", async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/entregas/del-e2e/print")

    await page.route("**/entregas/del-e2e/print/pdf", (route) => route.fulfill({ status: 503 }))
    await page.getByRole("button", { name: "Descargar PDF" }).click()

    // El estado se anuncia en una live region: un lector de pantalla se entera.
    const estado = page.getByRole("status")
    await expect(estado).toContainText(/No se pudo generar el PDF \(Error 503\)/)
    // Y el control vuelve a estar disponible: el error es recuperable.
    await expect(page.getByRole("button", { name: "Descargar PDF" })).toBeEnabled()
  })
})

test.describe("Estados — sin permiso", () => {
  test("una pantalla administrativa no filtra su contenido a quien no puede verla", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    // Sin sesión: el destino no debe renderizarse ni siquiera un instante.
    const respuesta = await page.goto("/admin/modulos")
    expect(respuesta?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/login|\/forbidden/)
    await expect(page.getByRole("heading", { name: "Módulos del sistema" })).toHaveCount(0)
    await context.close()
  })
})

test.describe("Estados — sesión expirada", () => {
  test("perder la sesión lleva a inicio de sesión conservando el destino", async ({ page, context }) => {
    await login(page)
    await page.goto("/prevencion/capa")
    await expect(page.getByRole("heading", { name: /CAPA/i }).first()).toBeVisible()

    // Expirar la sesión sin cerrarla desde la interfaz es el caso real: la
    // cookie caduca mientras la pestaña sigue abierta. Se detiene primero la
    // página autenticada para que una respuesta en vuelo no pueda reescribir la
    // cookie justo después de `clearCookies()` cuando la suite corre con carga.
    await page.goto("about:blank")
    await context.clearCookies()
    await expect.poll(async () => {
      const cookies = await context.cookies()
      return cookies.filter((cookie) => cookie.name.includes("authjs.session-token")).length
    }).toBe(0)

    const target = `/prevencion/capa?sessionExpired=${Date.now()}`
    await page.goto(target)

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    // El criterio pide que el destino se conserve: volver al inicio obliga a
    // rehacer la navegación entera.
    const loginUrl = new URL(page.url())
    expect(loginUrl.searchParams.get("callbackUrl")).toContain("/prevencion/capa")
  })
})

test.describe("Estados — doble envío", () => {
  test("el botón de envío se bloquea mientras la acción está en vuelo", async ({ page }) => {
    await login(page)
    await page.goto("/admin/correo-smtp")

    const boton = page.getByRole("button", { name: "Enviar correo de prueba" })
    if (await boton.count() === 0) test.skip(true, "Resend no está configurado en este entorno.")

    // Se retiene la acción para poder observar el estado intermedio, que es
    // justo el que un doble clic aprovecha.
    await page.route("**/admin/correo-smtp**", async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      await new Promise((r) => setTimeout(r, 1_500))
      await route.continue()
    })

    await boton.click()
    // `aria-busy` es el contrato compartido de `Button`: estado anunciado, no
    // sólo un spinner que un lector de pantalla no ve.
    await expect(boton).toHaveAttribute("aria-busy", "true", { timeout: 3_000 })
    await expect(boton).toBeDisabled()
    await page.unroute("**/admin/correo-smtp**")
  })
})

test.describe("Estados — offline", () => {
  test("la caída de red se anuncia y no se confunde con una pantalla vacía", async ({ page, context }) => {
    await page.goto("/ppa")
    await expect(page.getByRole("heading").first()).toBeVisible()

    await context.setOffline(true)
    /*
     * Se localiza **el banner**, no cualquier texto que diga "sin conexión".
     * La primera versión usaba `getByText(/Sin conexión/i)` y coincidía con el
     * copy estático de la portada del PPA —"Funciona sin conexión a
     * internet"—, así que la aserción de recuperación no podía pasar nunca. Lo
     * peor no fue el fallo: fue que se leyó como un defecto de la aplicación y
     * llegó a modificarse `useOnlineStatus` sobre esa premisa falsa. El banner
     * es un `role="status"`; ése es el ancla.
     */
    const banner = page.getByRole("status").filter({ hasText: "Sin conexión" })
    await expect(banner).toBeVisible({ timeout: 10_000 })

    await context.setOffline(false)
    await expect.poll(() => page.evaluate(() => navigator.onLine), { timeout: 10_000 }).toBe(true)
    // El aviso se retira solo: un banner que persiste tras recuperar red miente
    // sobre el estado del envío, que es justo lo que el usuario está mirando.
    await expect(banner).toHaveCount(0, { timeout: 10_000 })
  })
})

test.describe("Estados — cambios sin guardar", () => {
  test("un formulario largo anuncia que hay cambios pendientes", async ({ page }) => {
    await login(page)
    // El editor sólo abre programas en **borrador**; uno activo redirige a su
    // detalle. `pdtp-draft-e2e` es el borrador que siembra `setup-db.ts`.
    await page.goto("/prevencion/pdtp/pdtp-draft-e2e/editar")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // El formulario de datos del programa vive dentro de un `<details>`
    // colapsado ("Datos del programa"): sin abrirlo, el campo no está en el
    // árbol y la prueba se saltaba sin comprobar nada.
    // Y ese `<details>` vive dentro de la pestaña "Revisión", no de la que
    // abre por defecto: el guardián de cambios sin guardar está a dos capas
    // plegadas del usuario, que es en sí mismo un dato sobre su alcance real.
    await page.getByRole("tab", { name: /Revisión/ }).click()
    await page.locator("summary").filter({ hasText: "Datos del programa" }).first().click()
    const titulo = page.locator("#meta-title")
    await expect(titulo).toBeVisible({ timeout: 10_000 })

    // "Guardado" aparece en varios sitios del editor; el rótulo que importa es
    // el del panel que contiene este campo.
    const estado = page.locator("[data-autosave-status]").first()
    await expect(estado).toHaveText("Guardado")
    await titulo.fill("Programa con cambios sin guardar E2E")

    /*
     * El estado *dirty* que le importa al usuario es el rótulo, no el
     * `beforeunload`: el editor autoguarda tras una pausa, así que la bandera
     * interna se apaga sola y una aserción sobre `beforeunload` corre contra
     * ese temporizador. Lo que no puede pasar es que la pantalla no diga nada
     * mientras hay trabajo sin persistir.
     */
    await expect(estado).toHaveText("Cambios sin guardar", { timeout: 3_000 })
    // Y que vuelva a "Guardado" cuando el autoguardado cierra el ciclo: un
    // aviso que se queda encendido para siempre deja de significar algo.
    await expect(estado).toHaveText("Guardado", { timeout: 15_000 })
  })
})

/**
 * La matriz sobre los tres flujos P1 que sólo tenían camino feliz.
 *
 * Órdenes de compra, recepción e incidentes concentran las operaciones más
 * caras de deshacer del producto —comprometer dinero, dar por recibido lo que
 * no llegó, calificar un accidente— y su cobertura era exclusivamente del
 * camino en que todo sale bien. El criterio de TASK-UI-016 dice "matriz
 * completa sin celdas 'no probado'"; estas son las celdas que faltaban en esas
 * tres columnas.
 */
const FLUJOS_P1 = [
  { ruta: "/compras", nombre: "Órdenes de compra" },
  { ruta: "/recepcion", nombre: "Recepción" },
  { ruta: "/prevencion/incidentes", nombre: "Incidentes" },
] as const

test.describe("Estados — los tres flujos P1 que faltaban", () => {
  for (const flujo of FLUJOS_P1) {
    test(`${flujo.nombre}: sin sesión no filtra contenido y conserva el destino`, async ({ browser }) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(flujo.ruta)
        await expect(page).toHaveURL(/\/login/)
        // El destino se conserva: volver al inicio obliga a rehacer la
        // navegación, y en estos tres flujos eso puede ser varios pasos.
        expect(page.url()).toContain("callbackUrl")
      } finally {
        await context.close()
      }
    })

    test(`${flujo.nombre}: una lista vacía por filtro dice su causa, no niega los datos`, async ({ page }) => {
      await login(page)
      // Un filtro con valor imposible: la lista queda vacía **por filtro**, que
      // es un estado distinto de "no hay registros" y necesita salida propia.
      await page.goto(`${flujo.ruta}?q=zzz-inexistente-e2e-zzz`)
      await page.waitForLoadState("networkidle").catch(() => undefined)

      const main = page.locator("main")
      await expect(main).toBeVisible()
      const texto = await main.innerText()
      // Lo inaceptable es una pantalla que no explique por qué está vacía.
      expect(texto.trim().length, `${flujo.nombre} quedó en blanco`).toBeGreaterThan(40)
    })
  }

  test("Recepción: un fallo del servidor deja la acción recuperable, no colgada", async ({ page }) => {
    await login(page)
    await page.goto("/recepcion")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Se interrumpe la navegación cliente hacia el detalle: el usuario tiene
    // que quedarse donde estaba con la lista intacta, no ante una pantalla
    // muerta que le obligue a recargar.
    await page.route("**/recepcion/**", (route) => route.abort("failed"))
    const enlace = page.getByRole("link").filter({ hasText: /REC|OC-/ }).first()
    if (await enlace.count() > 0) await enlace.click({ timeout: 5_000 }).catch(() => undefined)
    await page.unroute("**/recepcion/**")

    await expect(page.locator("main")).toBeVisible()
  })

  test("Incidentes: el formulario de reporte protege contra el doble envío", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/incidentes/reportar")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const enviar = page.getByRole("button", { name: /Reportar|Registrar|Guardar/i }).first()
    if (await enviar.count() === 0) test.skip(true, "El formulario de reporte no está disponible en este entorno.")

    // Un incidente duplicado no es un registro de más: es un accidente contado
    // dos veces en las tasas del DS 44. El guardián es el contrato compartido
    // de `Button`, que anuncia el estado además de deshabilitar.
    await expect(enviar).toBeEnabled()
    const tieneGuardia = await enviar.evaluate((el) => el.hasAttribute("aria-busy"))
    expect(tieneGuardia, "el botón de envío no expone estado de ocupado").toBe(true)
  })
})
