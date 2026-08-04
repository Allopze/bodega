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
   * El saludo declara **una sola** cifra: el total de la cola.
   *
   * Antes enumeraba total + críticas + vencidas + entregas, y cada una de esas
   * tres ya vivía en su chip de atajo y en su tarjeta de alerta — "críticas"
   * aparecía cuatro veces en la misma pantalla contando el tile (G-02/A5).
   */
  test("el saludo declara una sola cifra y coincide con el atajo Todas", async ({ page }) => {
    const greeting = page.getByText(/No tienes acciones pendientes|Tienes \d+ tareas? pendientes?/)
    await expect(greeting).toBeVisible()

    const greetingText = (await greeting.textContent()) ?? ""
    expect(greetingText).not.toMatch(/crítica/i)
    expect(greetingText).not.toMatch(/vencida/i)
    expect(greetingText).not.toMatch(/entrega/i)

    const total = /^No tienes/.test(greetingText)
      ? "0"
      : greetingText.match(/Tienes (\d+) tareas? pendientes?/)?.[1]
    expect(total).toBeTruthy()

    // El atajo "Todas" es la otra representación legítima del mismo total
    // (acceso, no estado). Si hay cola, tiene que coincidir.
    if (total !== "0") {
      const shortcuts = page.getByRole("navigation", { name: "Atajos a la cola completa" })
      await expect(shortcuts.getByRole("link", { name: new RegExp(`Todas\\s*${total}$`) })).toBeVisible()
    }
  })

  // D-01: los atajos anuncian el backlog completo y navegan a /pendientes; no
  // filtran en cliente las filas visibles.
  test("los atajos de la cola navegan a la cola completa", async ({ page }) => {
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
    const queue = page.getByRole("region", { name: "Cola de trabajo" })
    const notice = queue.getByText(/Mostrando las .* más urgentes de/)
    const visibleCount = queue.getByText(/\d+ de \d+ visibles?/)
    await expect(visibleCount).toBeVisible()

    const counts = ((await visibleCount.textContent()) ?? "").match(/(\d+) de (\d+)/)
    const loaded = Number(counts?.[2] ?? 0)
    const total = Number(
      ((await page.getByText(/Tienes (\d+) tareas? pendientes?/).textContent().catch(() => "")) ?? "")
        .match(/Tienes (\d+)/)?.[1] ?? loaded,
    )

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
    // El alcance se declara en el saludo y en el rótulo de contexto.
    await expect(page.getByText(new RegExp(`pendientes en ${worksiteName}|No tienes acciones pendientes en ${worksiteName}`))).toBeVisible()

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

    // Sin esto, salir del dashboard con una faena elegida aterrizaba en
    // /pendientes sin filtro: el conteo del atajo y la lista de destino
    // hablaban de poblaciones distintas.
    const all = page.getByRole("navigation", { name: "Atajos a la cola completa" }).getByRole("link", { name: /Todas/ })
    await expect(all).toHaveAttribute("href", /\/pendientes\?worksiteId=/)
  })

  /*
   * Fase 3: las cinco secciones por dominio reemplazan al bloque "Analítica y
   * tendencias", que cubría 6 de ~19 dominios y cuyos gráficos no llevaban a
   * ningún módulo (G-03).
   */
  test("el admin ve las secciones por dominio en orden de gasto primero", async ({ page }) => {
    const index = page.getByRole("navigation", { name: "Secciones del tablero" })
    await expect(index).toBeVisible()

    // `purchasing:view` manda Adquisiciones y Flota al frente.
    const titles = await index.getByRole("link").allTextContents()
    expect(titles).toEqual(["Adquisiciones", "Flota y combustible", "Prevención y SST", "Bodega y entregas", "Control preventivo en terreno", "Cumplimiento y gobernanza"])
  })

  test("el índice navega a cada sección", async ({ page }) => {
    const index = page.getByRole("navigation", { name: "Secciones del tablero" })
    await index.getByRole("link", { name: "Prevención y SST" }).click()
    await expect(page).toHaveURL(/#dominio-prevencion/)
    await expect(page.getByRole("region", { name: "Prevención y SST" })).toBeVisible()
  })

  /*
   * Ninguna sección es homogénea en el tiempo, así que la cabecera **no**
   * declara un período: lo hace cada cifra.
   *
   * La primera versión de la Fase 3 sí lo declaraba y era L-07/G-04.4 otra vez:
   * "Prevención · Año en curso" encabezaba tres KPIs de estado actual, y
   * "Adquisiciones · Mes en curso" una tendencia de 6 meses, un backlog de hoy
   * y una inversión acumulada histórica.
   */
  test("cada cifra declara su ventana y la sección no promete una global", async ({ page }) => {
    const prevencion = page.getByRole("region", { name: "Prevención y SST" })
    // El PDTP es anual; los incidentes y las CAPA son estado actual. Conviven.
    await expect(prevencion.getByText(/Avance acreditado · año \d{4}/)).toBeVisible()
    await expect(prevencion.getByText(/abiertas en total · ahora/)).toBeVisible()

    // La cabecera de la sección es sólo el título y sus enlaces.
    const encabezado = prevencion.getByRole("heading", { name: "Prevención y SST" })
    await expect(encabezado).toBeVisible()

    const adquisiciones = page.getByRole("region", { name: "Adquisiciones" })
    await expect(adquisiciones.getByText(/OC emitidas · mes en curso/)).toBeVisible()
    // Y el gráfico acumulado sigue declarando lo suyo, distinto del KPI de al lado.
    await expect(adquisiciones.getByText(/acumulado histórico/)).toBeVisible()
  })

  // G-03: los gráficos dejaban de ser callejones sin salida.
  test("cada sección enlaza al módulo que la explica", async ({ page }) => {
    const adquisiciones = page.getByRole("region", { name: "Adquisiciones" })
    await expect(adquisiciones.getByRole("link", { name: "Compras" })).toHaveAttribute("href", "/compras")
    // `/analitica` no estaba enlazada desde ningún punto del dashboard.
    await expect(adquisiciones.getByRole("link", { name: "Analítica" })).toHaveAttribute("href", "/analitica")
  })

  /*
   * Los seis dominios que no tenían representación (inspecciones, permisos,
   * simulacros, comité, higiene, gestión del cambio) viven en **una** sección:
   * seis más habrían devuelto la pantalla al muro que la auditoría desarmó.
   */
  test("el control preventivo en terreno agrupa los seis dominios que faltaban", async ({ page }) => {
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
    await expect(page.getByText(/Todas las faenas activas|Todas mis faenas autorizadas/)).toBeVisible()
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

    // Sin prevention:pdtp:view no se instancia la sección del lateral.
    await expect(page.getByRole("heading", { name: "Programa de Trabajo Preventivo" })).toHaveCount(0)
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
  test("el rol restringido no ve las secciones que su permiso no autoriza", async ({ page }) => {
    const index = page.getByRole("navigation", { name: "Secciones del tablero" })
    const titles = await index.getByRole("link").allTextContents()

    expect(titles).toContain("Adquisiciones")
    expect(titles).toContain("Bodega y entregas")
    expect(titles).not.toContain("Flota y combustible")
    expect(titles).not.toContain("Prevención y SST")

    await expect(page.getByRole("region", { name: "Flota y combustible" })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Prevención y SST" })).toHaveCount(0)
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
