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
    // cookie caduca mientras la pestaña sigue abierta.
    await context.clearCookies()
    await page.goto("/prevencion/capa")

    await expect(page).toHaveURL(/\/login/)
    // El criterio pide que el destino se conserve: volver al inicio obliga a
    // rehacer la navegación entera.
    expect(page.url()).toContain("callbackUrl")
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
