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

/** Las cuatro ranuras de `buildOperationalMetrics`, con su cascada por permiso. */
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

  /*
   * El saludo no declara **ninguna** cifra, y es el único título de la página.
   *
   * Antes enumeraba total + críticas + vencidas + entregas; luego sólo el total,
   * que aun así lo repetía la insignia de "Mi trabajo" a cien píxeles (G-02/A5).
   * Ahora la cifra vive una vez, en la insignia, que además navega hasta la cola.
   * Y el saludo es el `h1`: convivía con un "Inicio" en la TopBar, dos
   * identidades para la misma página.
   */
  test("el saludo es el único título y no repite el total de la cola", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Hola, /)

    await expect(page.getByText(/Tienes \d+ tareas? pendientes?/)).toHaveCount(0)
    await expect(page.getByText(/No tienes acciones pendientes/)).toHaveCount(0)
  })

  // D-01: los atajos anuncian el backlog completo y navegan a /pendientes; no
  // filtran en cliente las filas visibles.
  test("los atajos de la cola navegan a la cola completa", async ({ page }) => {
    await page.goto("/dashboard?vista=trabajo")
    const shortcuts = page.getByRole("navigation", { name: "Atajos a la cola completa" })
    await expect(shortcuts).toBeVisible()

    const all = shortcuts.getByRole("link", { name: /Todas/ })
    await expect(all).toHaveAttribute("href", "/pendientes")
    await all.click()
    await expect(page).toHaveURL(/\/pendientes/)
  })

  // D-01: si la cola está truncada tiene que decirlo. Si no lo está, no debe
  // inventar un aviso.
  test("declara el truncamiento sólo cuando lo hay", async ({ page }) => {
    await page.goto("/dashboard?vista=trabajo")
    const queue = page.getByRole("region", { name: "Cola de trabajo" })
    const notice = queue.getByText(/Mostrando las .* más urgentes de/)
    const visibleCount = queue.getByText(/\d+ de \d+ visibles?/)
    await expect(visibleCount).toBeVisible()

    const counts = ((await visibleCount.textContent()) ?? "").match(/(\d+) de (\d+)/)
    const loaded = Number(counts?.[2] ?? 0)
    // El total vive en la insignia de "Mi trabajo" —su única representación en la
    // cabecera desde que el saludo dejó de repetirlo—. Sin cola no hay insignia,
    // y ahí `loaded` es el total.
    const badge = ((await page.getByRole("navigation", { name: "Vistas del tablero" })
      .getByRole("link", { name: /Mi trabajo/ }).textContent()) ?? "")
    const total = Number(badge.match(/(\d+)$/)?.[1] ?? loaded)

    if (total > loaded) await expect(notice).toBeVisible()
    else await expect(notice).toHaveCount(0)
  })

  /*
   * G-01: la fila superior es una cifra **por dominio**, no cuatro de la misma.
   *
   * Antes `.slice(0, 4)` sobre una lista de orden fijo entregaba siempre
   * "Tareas pendientes · críticas · vencidas · Por aprobar" —tres del mismo
   * eje— y dejaba "Inversión" y "Stock crítico" inalcanzables para todo rol.
   */
  test("la fila superior no repite la dimensión de tareas", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })
    await expect(strip).toBeVisible()

    const stripText = (await strip.textContent()) ?? ""
    const workLabelsPresent = WORK_SLOT_LABELS.filter((label) => stripText.includes(label))

    // Una sola ranura de trabajo, no tres.
    expect(workLabelsPresent).toHaveLength(1)
    // Y "Tareas críticas" salió de la fila: vive en su alerta y en su atajo.
    expect(stripText).not.toContain("Tareas críticas")
  })

  /*
   * G-01: el admin del seed tiene `purchasing:view`, así que la ranura de dinero
   * se llena. Con el corte anterior este tile era el candidato 8 y **nunca** se
   * renderizaba — el test lo habría dado por correcto igual.
   */
  test("la ranura de dinero se renderiza para quien la tiene autorizada", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })
    await expect(strip.getByText("Inversión", { exact: true })).toBeVisible()
  })

  // L-02: la cola es el widget principal; no puede exigir scroll horizontal en
  // un portátil estándar.
  test("la cola de trabajo no scrollea horizontalmente a 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/dashboard?vista=trabajo")
    const scroller = page.locator("#cola-de-trabajo div.overflow-x-auto").first()
    if ((await scroller.count()) === 0) test.skip(true, "Sin tareas en la cola para este usuario")

    const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  // L-01: PageHeader ya emite el <h1> de la página; el saludo no debe ser otro.
  test("la página tiene un solo h1", async ({ page }) => {
    await expect(page.locator("h1")).toHaveCount(1)
  })

  /*
   * G-05: el alcance global son los **únicos dos filtros** de la pantalla. Antes
   * había tres controles y ninguno reencuadraba nada — el de faena filtraba en
   * cliente las 12 filas de la cola mientras KPIs, alertas, tarjeta PDTP y los 8
   * gráficos lo ignoraban.
   */
  test("la pantalla tiene dos controles de alcance y el de la cola es sólo el orden", async ({ page }) => {
    await expect(page.getByRole("group", { name: "Período del tablero" })).toBeVisible()

    await page.goto("/dashboard?vista=trabajo")
    const queue = page.getByRole("region", { name: "Cola de trabajo" })
    await expect(queue.getByRole("combobox", { name: "Ordenar por" })).toBeVisible()
    // La faena ya no se elige dos veces.
    await expect(queue.getByRole("combobox", { name: "Faena" })).toHaveCount(0)
    await expect(queue.getByText("Quitar filtro de faena")).toHaveCount(0)
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

    // Está en la URL, así que un recargue no lo pierde (a diferencia del estado
    // en React, que `loading.tsx` + `router.refresh()` borraban).
    await page.reload()
    await expect(page.getByText(worksiteName).first()).toBeVisible()
  })

  test("los atajos arrastran la faena a la cola completa", async ({ page }) => {
    const picker = await worksitePicker(page)
    if ((await picker.count()) === 0) test.skip(true, "El usuario tiene una sola faena autorizada")

    await picker.click()
    await page.getByRole("option").filter({ hasNotText: "Todas las faenas" }).first().click()
    await expect(page).toHaveURL(/faena=/)

    // La faena viaja con el cambio de vista: es la mitad del contrato.
    await page.getByRole("navigation", { name: "Vistas del tablero" })
      .getByRole("link", { name: /Mi trabajo/ }).click()
    await expect(page).toHaveURL(/faena=/)

    // Sin esto, salir del dashboard con una faena elegida aterrizaba en
    // /pendientes sin filtro: el conteo del atajo y la lista de destino
    // hablaban de poblaciones distintas.
    const all = page.getByRole("navigation", { name: "Atajos a la cola completa" }).getByRole("link", { name: /Todas/ })
    await expect(all).toHaveAttribute("href", /\/pendientes\?worksiteId=/)
  })

  /*
   * El selector de vistas: una a la vez. Sustituye al índice de anclas, que
   * navegaba con scroll sobre una página con las seis secciones ya montadas.
   */
  /*
   * Dos taxonomías, dos niveles: `Resumen` y `Mi trabajo` son modos de mirar,
   * los dominios son lugares. Como nueve pestañas hermanas había que leerlas
   * todas para descubrir que no eran comparables.
   */
  test("el admin ve dos modos como pestañas y sus dominios en el desplegable", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    await expect(tabs).toBeVisible()

    // La insignia de "Mi trabajo" pega el conteo al rótulo; se recorta.
    const modos = (await tabs.getByRole("link").allTextContents()).map((t) => t.replace(/\d+$/, "").trim())
    expect(modos).toEqual(["Resumen", "Mi trabajo"])

    await tabs.getByRole("button").click()
    const dominios = await page.getByRole("menuitem").allTextContents()
    // Finanzas al frente: es el dominio que abre para quien mira la plata.
    expect(dominios.slice(0, 2)).toEqual(["Finanzas", "Adquisiciones"])
  })

  test("Inicio abre en Resumen y sólo esa vista está montada", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
    // La cola vive en su pestaña: montarla acá era lo que empujaba todo
    // indicador bajo el pliegue.
    await expect(page.locator("#cola-de-trabajo")).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Adquisiciones" })).toHaveCount(0)
  })

  test("elegir una vista la pinta y deja las otras fuera del DOM", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    // El disparador es el único `button` de la barra: sin hidratar no abre nada,
    // así que la espera del `menuitem` es la que hace determinista el clic.
    await tabs.getByRole("button").click()
    await page.getByRole("menuitem", { name: "Prevención" }).click()

    await expect(page).toHaveURL(/vista=prevencion/)
    await expect(page.getByRole("region", { name: "Prevención y SST" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Adquisiciones" })).toHaveCount(0)
    // El desplegable se rotula con el dominio activo: la vista sigue siendo
    // legible sin abrirlo, que es lo que una pestaña daba gratis.
    await expect(tabs.getByRole("button")).toHaveText(/Prevención/)
  })

  test("Mi trabajo es la cola completa y su insignia cuadra con el atajo Todas", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    const trabajo = tabs.getByRole("link", { name: /Mi trabajo/ })
    // La insignia es ahora la **única** representación del total en la cabecera.
    const total = ((await trabajo.textContent()) ?? "").match(/(\d+)$/)?.[1]

    await trabajo.click()
    await expect(page).toHaveURL(/vista=trabajo/)
    await expect(page.getByRole("region", { name: "Cola de trabajo" })).toBeVisible()

    // El atajo "Todas" es la otra representación legítima del mismo total
    // (acceso, no estado). Si hay cola, tienen que coincidir.
    if (total) {
      const shortcuts = page.getByRole("navigation", { name: "Atajos a la cola completa" })
      await expect(shortcuts.getByRole("link", { name: new RegExp(`Todas\\s*${total}$`) })).toBeVisible()
    }
  })

  test("cambiar de vista no reinicia la faena", async ({ page }) => {
    const picker = await worksitePicker(page)
    if ((await picker.count()) === 0) test.skip(true, "El usuario tiene una sola faena autorizada")

    await picker.click()
    await page.getByRole("option").filter({ hasNotText: "Todas las faenas" }).first().click()
    await expect(page).toHaveURL(/faena=/)

    await page.getByRole("navigation", { name: "Vistas del tablero" }).getByRole("button").click()
    await page.getByRole("menuitem", { name: "Flota" }).click()

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
    await expect(finanzas.getByText("Egresos — compra y consumo")).toBeVisible()
    await expect(finanzas.getByText("Gasto en OC", { exact: true })).toBeVisible()

    await page.goto("/dashboard?vista=adquisiciones")
    const adquisiciones = page.getByRole("region", { name: "Adquisiciones" })
    await expect(adquisiciones.getByText("Gasto", { exact: true })).toHaveCount(0)
    await expect(adquisiciones.getByText("Proveedores por gasto")).toHaveCount(0)
    await expect(adquisiciones.getByText("Gasto por módulo")).toHaveCount(0)

    await page.goto("/dashboard?vista=flota")
    await expect(page.getByRole("region", { name: "Flota y combustible" })
      .getByText("Deuda vencida", { exact: true })).toHaveCount(0)
  })

  // Las cifras de venta sólo vivían en /facturacion, sin presencia en el tablero.
  test("Finanzas trae la facturación de venta, que no estaba en el tablero", async ({ page }) => {
    await page.goto("/dashboard?vista=finanzas")
    const finanzas = page.getByRole("region", { name: "Finanzas" })

    await expect(finanzas.getByText("Ingresos — facturación de venta")).toBeVisible()
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
    const prevencion = page.getByRole("region", { name: "Prevención y SST" })
    // El PDTP es anual; los incidentes y las CAPA son estado actual. Conviven.
    await expect(prevencion.getByText(/Avance acreditado · año \d{4}/)).toBeVisible()
    await expect(prevencion.getByText(/abiertas en total · ahora/)).toBeVisible()
    await expect(prevencion.getByRole("heading", { name: "Prevención y SST" })).toBeVisible()
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
   * Los seis dominios que no tenían representación (inspecciones, permisos,
   * simulacros, comité, higiene, gestión del cambio) viven en **una** vista:
   * seis más habrían devuelto la pantalla al muro que la auditoría desarmó.
   */
  test("el control preventivo en terreno agrupa los seis dominios que faltaban", async ({ page }) => {
    await page.goto("/dashboard?vista=terreno")
    const seccion = page.getByRole("region", { name: "Control preventivo en terreno" })
    await expect(seccion).toBeVisible()

    for (const kpi of [
      "Cumplimiento de inspecciones", "Hallazgos críticos abiertos", "Permisos de trabajo activos",
      "Simulacros por mejorar", "Mediciones sobre el límite", "Acuerdos del comité abiertos",
      "Gestión del cambio abierta",
    ]) {
      await expect(seccion.getByText(kpi, { exact: true })).toBeVisible()
    }
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
    await expect(strip.getByText("Inversión", { exact: true })).toHaveCount(0)
    await expect(strip.getByText("OC activas")).toHaveCount(0)
    await expect(page.getByText("ítems esperan aprobación")).toHaveCount(0)

    // Sin prevention:pdtp:view no se instancia el medidor de cumplimiento, que
    // es donde vive esa cifra desde que salió de la fila de tiles (A5).
    await expect(page.getByText("Cumplimiento PDTP")).toHaveCount(0)
    await expect(strip.getByText("Cumplimiento PDTP")).toHaveCount(0)
  })

  /*
   * Con las ranuras, este rol ve **Stock crítico**: tiene `warehouse:view_stock`
   * y la ranura de riesgo cae en stock al no tener incidentes ni CAPA.
   *
   * Con el corte anterior quedaba fuera —la propia auditoría 2026-07-30 lo dejó
   * anotado como "detalle que se presta a error"— y su sparkline, construido y
   * probado en esa misma pasada, era código inalcanzable.
   */
  test("la ranura de riesgo le entrega Stock crítico, que antes quedaba cortado", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })

    await expect(strip.getByText("Stock crítico", { exact: true })).toBeVisible()
    // Cumplimiento cae en "Por recibir" al no tener PDTP.
    await expect(strip.getByText("Por recibir", { exact: true })).toBeVisible()
  })

  test("cede las ranuras que no autoriza en vez de rellenarlas con tareas", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })
    const stripText = (await strip.textContent()) ?? ""

    // Sin dinero autorizado la ranura se cede: quedan 3 tiles, no 4 rellenados.
    const workLabelsPresent = WORK_SLOT_LABELS.filter((label) => stripText.includes(label))
    expect(workLabelsPresent).toHaveLength(1)
    expect(stripText).not.toContain("Tareas críticas")
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
    const titles = await page.getByRole("menuitem").allTextContents()

    expect(titles).toContain("Adquisiciones")
    expect(titles).toContain("Bodega")
    expect(titles).not.toContain("Flota")
    expect(titles).not.toContain("Prevención")

    // Y escribir la vista a mano tampoco la abre: cae al Resumen.
    await page.goto("/dashboard?vista=flota")
    await expect(page.getByRole("region", { name: "Flota y combustible" })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
  })

  test("el flujo del mes sólo lista los módulos autorizados", async ({ page }) => {
    const flow = page.getByRole("region", { name: "Flujo del mes" })
    await expect(flow).toBeVisible()

    await expect(flow.getByText("Solicitudes creadas", { exact: false })).toBeVisible()
    await expect(flow.getByText("Recepciones", { exact: false })).toBeVisible()
    await expect(flow.getByText("OC emitidas", { exact: false })).toHaveCount(0)
    await expect(flow.getByText("Inversión emitida", { exact: false })).toHaveCount(0)
  })
})
