import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Dashboard de inicio.
 *
 * Cubre las regresiones de la auditoría 2026-07-30 —en particular la que motivó
 * el resto: mezclar conteos de población completa con una página de filas
 * cargadas sin decirlo (D-01)— y el contrato nuevo de la auditoría de cobertura
 * 2026-07-31: alcance global en la URL y fila superior por ranura semántica.
 */

/** Contadores de la cola: viven en el bloque Hoy, nunca en el panorama. */
const WORK_SLOT_LABELS = ["Tareas vencidas", "Por aprobar", "Tareas pendientes"]

test.describe("Dashboard operacional", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")
  })

  /**
   * Ancla para los tests que dependen del selector de faena.
   *
   * `locator.count()` **no auto-espera**, así que contarlo apenas carga la
   * página devolvía 0 por una carrera y el `test.skip` de abajo lo disfrazaba de
   * "este usuario tiene una sola faena". Dos tests del alcance global pasaron
   * así, saltados, sin afirmar nada. Esperar al grupo de período —que renderiza
   * siempre, con una faena o con diez— hace que un conteo en 0 signifique de
   * verdad "no hay selector".
   */
  async function worksitePicker(page: Page) {
    await expect(page.getByRole("group", { name: "Período del tablero" })).toBeVisible()
    return page.getByRole("combobox", { name: "Faena del tablero" })
  }

  test("el saludo es el único título y no repite el total de la cola", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Hola, /)

    await expect(page.getByText(/Tienes \d+ tareas? pendientes?/)).toHaveCount(0)
    await expect(page.getByText(/No tienes acciones pendientes/)).toHaveCount(0)
  })

  /*
   * "Hoy arriba, panorama abajo": el bloque Hoy abre el Resumen —primero en el
   * DOM y en pantalla— y lleva UN enlace a Mis pendientes, el único nombre de
   * la cola. La vista "Mi trabajo" ya no existe.
   */
  test("Hoy abre el Resumen, antes que los indicadores, con un solo enlace a Mis pendientes", async ({ page }) => {
    const hoy = page.getByRole("region", { name: "Hoy" })
    await expect(hoy).toBeVisible()

    const indicadores = page.getByRole("region", { name: "Indicadores Operacionales" })
    const [hoyBox, indicadoresBox] = [await hoy.boundingBox(), await indicadores.boundingBox()]
    expect(hoyBox!.y).toBeLessThan(indicadoresBox!.y)

    // Un solo enlace, con el nombre de la cola tal como lo llama el sidebar.
    const enlace = hoy.getByRole("link", { name: /^Ver (todos )?mis pendientes/ })
    await expect(enlace).toHaveCount(1)
    await expect(enlace).toHaveAttribute("href", /^\/pendientes/)
    await expect(page.getByText(/Cola de trabajo|Mi trabajo|Tareas pendientes/)).toHaveCount(0)

    // Hasta cinco filas de la cola, cada una con su vencimiento en palabras.
    const filas = hoy.getByRole("list", { name: "Lo más urgente de tus pendientes" }).getByRole("listitem")
    expect(await filas.count()).toBeLessThanOrEqual(5)
    for (const texto of await filas.allTextContents()) {
      expect(texto).toMatch(/Vencida hace|Vence|Sin fecha de vencimiento/)
    }
  })

  test("en Hoy, cada alerta enlaza a su subconjunto y dice su severidad en texto", async ({ page }) => {
    const alertas = page.getByRole("region", { name: "Hoy" }).getByRole("list", { name: /Requiere atención/ })
    if ((await alertas.count()) === 0) test.skip(true, "Sin alertas activas para este usuario")

    for (const alerta of await alertas.getByRole("link").all()) {
      await expect(alerta).toHaveAttribute("href", /^\/(pendientes|prevencion)/)
      await expect(alerta).toContainText(/Crítica|Atención|Pendiente/)
    }
    // Decisión de producto: el sistema de asignación se retira de Inicio.
    await expect(page.getByText(/sin responsable/i)).toHaveCount(0)
  })

  test("?vista=trabajo redirige a /pendientes y conserva la faena", async ({ page }) => {
    await page.goto("/dashboard?vista=trabajo")
    await expect(page).toHaveURL(/\/pendientes$/)

    await page.goto("/dashboard?vista=trabajo&faena=ws-que-no-existe")
    await expect(page).toHaveURL(/\/pendientes\?worksiteId=ws-que-no-existe/)
  })

  test("Inicio no ofrece el filtro de la shell: ya no hay una lista que filtrar", async ({ page }) => {
    await expect(page.getByRole("searchbox", { name: "Filtrar en esta página" })).toHaveCount(0)
  })


  test("el panorama no repite lo que ya dice Hoy", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })
    await expect(strip).toBeVisible()

    // La ranura de trabajo propio se fue a Hoy: ningún contador de la cola.
    const stripText = (await strip.textContent()) ?? ""
    for (const label of [...WORK_SLOT_LABELS, "Tareas críticas"]) expect(stripText).not.toContain(label)
  })
  /*
   * G-01: el admin del seed tiene `purchasing:view`, así que la ranura de dinero
   * se llena. Con el corte anterior este tile era el candidato 8 y **nunca** se
   * renderizaba — el test lo habría dado por correcto igual.
   */
  test("la ranura de dinero se renderiza para quien la tiene autorizada", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })
    await expect(strip.getByText("Gasto en OC", { exact: true })).toBeVisible()
  })


  // L-01: PageHeader ya emite el <h1> de la página; el saludo no debe ser otro.
  test("la página tiene un solo h1", async ({ page }) => {
    await expect(page.locator("h1")).toHaveCount(1)
  })

  test("la pantalla tiene dos controles de alcance y ningún orden de cola", async ({ page }) => {
    await expect(page.getByRole("group", { name: "Período del tablero" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Ordenar por" })).toHaveCount(0)
    await expect(page.getByText("Quitar filtro de faena")).toHaveCount(0)
  })
  test("el período viaja en la URL y reencuadra el rótulo del flujo", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Flujo del mes" })).toBeVisible()

    // Siempre acotado al grupo: el nombre accesible del tile de dinero incluye
    // su descripción ("OC emitidas · trimestre en curso"), así que un
    // `getByRole("link", { name: "Trimestre" })` suelto empata dos elementos.
    const periodo = page.getByRole("group", { name: "Período del tablero" })
    await periodo.getByRole("link", { name: "Trimestre" }).click()
    await expect(page).toHaveURL(/periodo=trimestre/)

    // El rótulo sigue al período: con "Flujo del mes" fijo habría mentido.
    await expect(page.getByRole("region", { name: "Flujo del trimestre" })).toBeVisible()
    await expect(periodo.getByRole("link", { name: "Trimestre" })).toHaveAttribute("aria-current", "page")
  })

  test("elegir faena reencuadra el tablero y sobrevive al recargar", async ({ page }) => {
    const picker = await worksitePicker(page)
    if ((await picker.count()) === 0) test.skip(true, "El usuario tiene una sola faena autorizada")

    await picker.click()
    const firstWorksite = page.getByRole("option").filter({ hasNotText: "Todas las faenas" }).first()
    const worksiteName = ((await firstWorksite.textContent()) ?? "").trim()
    await firstWorksite.click()

    await expect(page).toHaveURL(/faena=/)
    // El alcance lo declara el **propio selector**. Antes lo repetían además el
    // saludo y una línea de contexto: tres veces la misma palabra.
    await expect(picker).toHaveText(new RegExp(worksiteName))

    // Está en la URL, así que un recargue no lo pierde (un estado sólo en React
    // sí; hasta 2026-09-24 además lo borraba cada `router.refresh()`).
    await page.reload()
    await expect(page.getByText(worksiteName).first()).toBeVisible()
  })


  test("el admin ve Resumen como pestaña y sus áreas en el desplegable, con su descripción", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    await expect(tabs).toBeVisible()

    const modos = (await tabs.getByRole("link").allTextContents()).map((t) => t.trim())
    expect(modos).toEqual(["Resumen"])

    await tabs.getByRole("button", { name: "Por área" }).click()
    // Cada ítem trae su título y una línea que dice qué cifras contiene.
    const titulos = await page.getByRole("menuitem").evaluateAll((items) => items.map((item) => item.querySelector("span")?.textContent ?? ""))
    // Finanzas al frente: es el área que abre para quien mira la plata.
    expect(titulos.slice(0, 2)).toEqual(["Finanzas", "Adquisiciones"])
    // Los nombres son los del sidebar, no los del código.
    expect(titulos).toContain("Control operacional")
    for (const antiguo of ["Flota", "Terreno", "Gobernanza"]) expect(titulos).not.toContain(antiguo)
    for (const item of await page.getByRole("menuitem").all()) {
      expect(((await item.textContent()) ?? "").length).toBeGreaterThan(20)
    }
  })
  test("Inicio abre en Resumen y sólo esa vista está montada", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
    // La cola ya no vive en Inicio: no hay tabla, sólo el resumen de Hoy.
    await expect(page.locator("#cola-de-trabajo")).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Adquisiciones" })).toHaveCount(0)
  })
  test("elegir una vista la pinta y deja las otras fuera del DOM", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    // El disparador es el único `button` de la barra: sin hidratar no abre nada,
    // así que la espera del `menuitem` es la que hace determinista el clic.
    await tabs.getByRole("button").click()
    await page.getByRole("menuitem", { name: /^Prevención Programa/ }).click()

    await expect(page).toHaveURL(/vista=prevencion/)
    await expect(page.getByRole("region", { name: "Prevención" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Adquisiciones" })).toHaveCount(0)
    // El desplegable dice qué es y cuál está elegida, y lo marca como actual.
    await expect(tabs.getByRole("button")).toHaveText("Por área: Prevención")
    await expect(tabs.getByRole("button")).toHaveAttribute("aria-current", "page")
  })

  test("cambiar de vista no reinicia la faena", async ({ page }) => {
    const picker = await worksitePicker(page)
    if ((await picker.count()) === 0) test.skip(true, "El usuario tiene una sola faena autorizada")

    await picker.click()
    await page.getByRole("option").filter({ hasNotText: "Todas las faenas" }).first().click()
    await expect(page).toHaveURL(/faena=/)

    await page.getByRole("navigation", { name: "Vistas del tablero" }).getByRole("button").click()
    await page.getByRole("menuitem", { name: /^Control operacional/ }).click()

    // Las tres dimensiones conviven en la URL: sin esto, elegir vista tras
    // elegir faena devolvía el tablero a "todas".
    await expect(page).toHaveURL(/vista=flota/)
    await expect(page).toHaveURL(/faena=/)
  })

  test("una vista no autorizada cae al Resumen en vez de dejar la página en blanco", async ({ page }) => {
    await page.goto("/dashboard?vista=contabilidad")
    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
  })

  /*
   * Finanzas absorbe las dos direcciones del dinero. A5 sigue viva aunque el
   * tope de tiles se haya relajado: una cifra, una representación — por eso el
   * gasto salió de Adquisiciones en vez de quedar en las dos vistas.
   */
  test("el dinero vive en Finanzas y no se repite en Adquisiciones ni Flota", async ({ page }) => {
    await page.goto("/dashboard?vista=finanzas")
    const finanzas = page.getByRole("region", { name: "Finanzas" })
    await expect(finanzas.getByText("Egresos (compra y consumo)")).toBeVisible()
    await expect(finanzas.getByText("Gasto en OC", { exact: true })).toBeVisible()

    await page.goto("/dashboard?vista=adquisiciones")
    const adquisiciones = page.getByRole("region", { name: "Adquisiciones" })
    await expect(adquisiciones.getByText("Gasto", { exact: true })).toHaveCount(0)
    await expect(adquisiciones.getByText("Proveedores por gasto")).toHaveCount(0)
    await expect(adquisiciones.getByText("Gasto por módulo")).toHaveCount(0)

    await page.goto("/dashboard?vista=flota")
    await expect(page.getByRole("region", { name: "Control operacional" })
      .getByText("Deuda vencida", { exact: true })).toHaveCount(0)
  })

  // Las cifras de venta sólo vivían en /facturacion, sin presencia en el tablero.
  test("Finanzas trae la facturación de venta, que no estaba en el tablero", async ({ page }) => {
    await page.goto("/dashboard?vista=finanzas")
    const finanzas = page.getByRole("region", { name: "Finanzas" })

    await expect(finanzas.getByText("Ingresos (facturación de venta)")).toBeVisible()
    await expect(finanzas.getByText("Pendiente de cobro", { exact: true })).toBeVisible()
    await expect(finanzas.getByRole("link", { name: "Facturación" })).toHaveAttribute("href", "/facturacion")
  })

  /*
   * Ninguna sección es homogénea en el tiempo, así que la cabecera **no**
   * declara un período: lo hace cada cifra.
   *
   * La primera versión de la Fase 3 sí lo declaraba y era L-07/G-04.4 otra vez:
   * "Prevención · Año en curso" encabezaba tres KPIs de estado actual.
   */
  test("cada cifra declara su ventana y la sección no promete una global", async ({ page }) => {
    await page.goto("/dashboard?vista=prevencion")
    const prevencion = page.getByRole("region", { name: "Prevención", exact: true })
    // El PDTP es anual; los incidentes y las CAPA son estado actual. Conviven.
    await expect(prevencion.getByText(/Avance acreditado · año \d{4}/)).toBeVisible()
    await expect(prevencion.getByText(/abiertas en total · ahora/)).toBeVisible()
    await expect(prevencion.getByRole("heading", { name: "Prevención", exact: true })).toBeVisible()
  })

  // G-03: los gráficos dejaban de ser callejones sin salida.
  test("cada sección enlaza al módulo que la explica", async ({ page }) => {
    await page.goto("/dashboard?vista=adquisiciones")
    const adquisiciones = page.getByRole("region", { name: "Adquisiciones" })
    await expect(adquisiciones.getByRole("link", { name: "Compras" })).toHaveAttribute("href", "/compras")
    // `/analitica` no estaba enlazada desde ningún punto del dashboard.
    await expect(adquisiciones.getByRole("link", { name: "Analítica" })).toHaveAttribute("href", "/analitica")
  })

  /*
   * Los dominios que no tenían representación (inspecciones, permisos,
   * simulacros, comité, higiene) viven en **una** vista: uno por vista habría
   * devuelto la pantalla al muro que la auditoría desarmó. Gestión del cambio
   * era el sexto; se retiró de la plataforma en `cfe3a925` y su tile con él.
   */
  test("el control preventivo en terreno agrupa los dominios que faltaban", async ({ page }) => {
    await page.goto("/dashboard?vista=terreno")
    const seccion = page.getByRole("region", { name: "Prevención en terreno" })
    await expect(seccion).toBeVisible()

    for (const kpi of [
      "Cumplimiento de inspecciones", "Hallazgos críticos abiertos", "Permisos de trabajo activos",
      "Simulacros por mejorar", "Mediciones sobre el límite", "Acuerdos del comité abiertos",
    ]) {
      await expect(seccion.getByText(kpi, { exact: true })).toBeVisible()
    }
    await expect(seccion.getByText("Gestión del cambio abierta", { exact: true })).toHaveCount(0)
  })

  test("una faena inexistente cae a todas en vez de dejar el tablero en cero", async ({ page }) => {
    await page.goto("/dashboard?faena=ws-que-no-existe")

    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
    // "Todas" lo declara el selector, que es el único sitio donde el alcance se
    // puede además cambiar. La etiqueta distingue el caso en que "todas" no son
    // todas —un rol con faenas acotadas—, que es lo único que aportaba la línea
    // de contexto que antes lo repetía al lado.
    const picker = await worksitePicker(page)
    if ((await picker.count()) === 0) test.skip(true, "El usuario tiene una sola faena autorizada")
    await expect(picker).toHaveText(/Todas las faenas|Todas mis faenas autorizadas/)
  })
})

/**
 * Gating por permisos de tiles, alertas y lateral.
 *
 * `restricted-roles.spec.ts` entra al dashboard pero sólo para aterrizar y
 * navegar a /solicitudes: no afirma nada sobre esta pantalla. Aquí se cubre lo
 * que deciden `buildOperationalMetrics` y `buildOperationalAlerts`.
 *
 * `scoped@e2e.chome.cl` tiene requests:{create,view_own,submit},
 * receiving:{view,register_faena}, warehouse:{view_stock,register_movement} y
 * operations:view_work. NO tiene approvals:approve, purchasing:view,
 * deliveries:create ni prevention:pdtp:view.
 */
test.describe("Dashboard con rol restringido", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "scoped@e2e.chome.cl", "scoped2026")
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")
  })

  test("no muestra tiles ni alertas fuera de su permiso", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })
    await expect(strip).toBeVisible()

    // Sin approvals:approve ni purchasing:view. La aserción de la inversión
    // ahora depende del **permiso**: antes pasaba por el `.slice(0, 4)`, que
    // cortaba el tile para todos los roles, así que no podía fallar.
    await expect(strip.getByText("Por aprobar")).toHaveCount(0)
    await expect(strip.getByText("Gasto en OC", { exact: true })).toHaveCount(0)
    await expect(strip.getByText("OC activas")).toHaveCount(0)
    await expect(page.getByText("ítems esperan aprobación")).toHaveCount(0)

    // Sin prevention:pdtp:view no se instancia el medidor de cumplimiento, que
    // es donde vive esa cifra desde que salió de la fila de tiles (A5).
    await expect(page.getByText("Cumplimiento PDTP")).toHaveCount(0)
    await expect(strip.getByText("Cumplimiento PDTP")).toHaveCount(0)
  })

  /*
   * Hasta 2026-10-02 la ranura de riesgo de este rol caía en **Stock crítico**
   * (tiene `warehouse:view_stock` y no tiene incidentes ni CAPA). El stock
   * mínimo se retiró, así que ahora esa ranura se cede.
   */
  test("ya no muestra Stock crítico: sin incidentes ni CAPA la ranura de riesgo se cede", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })

    await expect(strip.getByText("Stock crítico", { exact: true })).toHaveCount(0)
    await expect(page.getByText("productos con stock crítico")).toHaveCount(0)
    // Cumplimiento cae en "Pendiente de recepción" al no tener PDTP.
    await expect(strip.getByText("Pendiente de recepción", { exact: true })).toBeVisible()
  })

  test("cede las ranuras que no autoriza en vez de rellenarlas con tareas", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })
    const stripText = (await strip.textContent()) ?? ""

    // Sin dinero autorizado la ranura se cede: quedan los tiles que el permiso
    // autoriza, nunca rellenados con contadores de la cola (esos viven en Hoy).
    for (const label of [...WORK_SLOT_LABELS, "Tareas críticas"]) expect(stripText).not.toContain(label)
  })

  /*
   * El orden y la visibilidad de las secciones los decide el **perfil de
   * permisos**, no el slug del rol. Este usuario no tiene `purchasing:view`, así
   * que no abre por gasto, y no tiene prevención ni combustibles: esas
   * secciones no existen —no se consultan ni aparecen en el índice—.
   */
  test("el rol restringido no ve los dominios que su permiso no autoriza", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    await tabs.getByRole("button").click()
    const titles = await page.getByRole("menuitem").evaluateAll((items) => items.map((item) => item.querySelector("span")?.textContent ?? ""))

    expect(titles).toContain("Adquisiciones")
    expect(titles).toContain("Bodega")
    expect(titles).not.toContain("Control operacional")
    expect(titles).not.toContain("Prevención")

    // Y escribir la vista a mano tampoco la abre: cae al Resumen.
    await page.goto("/dashboard?vista=flota")
    await expect(page.getByRole("region", { name: "Control operacional" })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
  })

  test("el flujo del mes sólo lista los módulos autorizados", async ({ page }) => {
    const flow = page.getByRole("region", { name: "Flujo del mes" })
    await expect(flow).toBeVisible()

    await expect(flow.getByText("Solicitudes creadas", { exact: false })).toBeVisible()
    await expect(flow.getByText("Recepciones", { exact: false })).toBeVisible()
    await expect(flow.getByText("OC emitidas", { exact: false })).toHaveCount(0)
    await expect(flow.getByText("Gasto en OC", { exact: false })).toHaveCount(0)
  })
})
