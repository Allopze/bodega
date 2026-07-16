# Plan de mejora UX — Pantallas tediosas, confusas o poco intuitivas

**Fecha:** 2026-07-16 · **Alcance:** todas las rutas de `app/(app)/` · **Verificado contra el working tree actual**

**Método:** captura Playwright de las ~100 rutas con datos seed (`npm run screenshots`, viewport 1920×1080 y 390×844 — lo que se ve *sin scrollear*), más 10 rutas nuevas capturadas aparte, más lectura del código de cada pantalla densa. Evidencia en `audit/screenshots/2026-06-09-playwright/` (el baseline de junio quedó respaldado en `...-original-junio/`).

**Criterio rector — el "test de los 5 segundos":** al abrir la pantalla, sin scrollear, el usuario debe poder responder: *(1) ¿qué es esto?, (2) ¿qué estado tiene mi trabajo?, (3) ¿cuál es la acción que se espera de mí?* Toda ficha de este plan usa ese test como criterio de aceptación.

---

## 1. Resumen ejecutivo

| # | Pantalla | Ruta | Severidad | Problema en una línea |
|---|----------|------|-----------|----------------------|
| 1 | Combustibles (panel principal) | `/combustibles` | 🔴 P1 | Mega-dashboard: 10 tiles + filtros + 8 secciones de gráficos + tabla de 50 filas en una sola página sin tarea clara |
| 2 | Bitácora general | `/combustibles/bitacora` | 🔴 P1 | Muro de **24 controles de filtro** siempre visibles que ocupan media pantalla antes de la tabla |
| 3 | Detalle programa PDTP | `/prevencion/pdtp/[programId]` | 🔴 P1 | 11 métricas + 3 filas de selectores (8 hojas × faena × vista) antes del contenido; matriz anual de 21 columnas |
| 4 | Bodega | `/bodega` | 🟠 P2 | 3 formularios permanentemente abiertos en el sidebar compiten con el stock/kardex |
| 5 | Mantenciones | `/mantenciones` | 🟠 P2 | Formulario de creación de 11 campos siempre abierto **antes** del historial (viola la regla 5 de AGENTS.md) |
| 6 | Entregas | `/entregas` | 🟠 P2 | Mismo patrón: formulario gigante primero, historial después; identidad de página ambigua |
| 7 | Indicadores de accidentabilidad | `/prevencion/indicadores` | 🟠 P2 | Matriz 12 meses × 12 columnas con jerga abreviada (`Acc. c/TP`, `HH`) y captura mes a mes vía modal |
| 8 | Ciclo físico de combustible | `/combustibles/ciclo` | 🟠 P2 | Jerga técnica en tiles y estados vacíos ("Sin fuente disponible", "evento canónico de consumo") |
| 9 | PPA (revisión interna) | `/prevencion/ppa` | 🟠 P2 | El mismo dato (estado) se representa 3 veces: 8 KPIs + 5 tabs + select de estado |
| 10 | Dashboard | `/dashboard` | 🟡 P3 | 8 tiles de KPI que duplican los chips que el TopBar ya muestra |
| 11 | Flota | `/flota` | 🟡 P3 | Tabla de 13 columnas donde la mitad muestra "—" |
| 12 | Transversales menores | varias | 🟡 P3 | Fechas nativas `mm/dd/yyyy`, estados crudos en inglés (`SUBMITTED`), filtros sin etiqueta |

**Pantallas revisadas que están bien y no requieren cambios** (para acotar el alcance): `/solicitudes`, `/solicitudes/nueva` (el mejor patrón de la casa: formulario + resumen lateral + checklist "Pendientes"), `/aprobaciones`, `/compras`, `/recepcion`, `/trazabilidad` (embudo por ítem con filas resaltadas y nota al pie — excelente), `/prevencion/evaluaciones`, `/prevencion/documentacion` (rework reciente tipo Drive), `/combustibles/cuenta-corriente`, `/combustibles/anomalias`, `/admin/*` (listas CRUD estándar), `/prevencion/pdtp/acciones` (solo el fix menor T6).

---

## 2. Anti-patrones transversales (arreglar una vez, aplicar en todas)

Estos seis patrones explican casi todos los problemas individuales. Conviene decidirlos como **reglas de diseño del repo** (candidatas a añadirse a AGENTS.md al cerrar el plan) y luego aplicarlos pantalla por pantalla.

### A1 — Sobrecarga de KPIs sobre el contenido

**Dónde:** `/combustibles` (3 tiles de overview + 7 KPIs), PDTP detalle (5 + 6), `/prevencion/ppa` (8), `/dashboard` (8), `/analitica` (6).
**Por qué falla:** los números sin jerarquía no responden "¿qué hago?"; empujan la tabla/acción real bajo el fold. Con datos vacíos degeneran en una pared de ceros y "—" (visible en las capturas).
**Regla propuesta:**
- Máximo **4 tiles** arriba del contenido. Cada tile debe ser **accionable** (clic = filtra la lista o navega a la cola correspondiente); si un número no cambia ninguna decisión, va abajo o se elimina.
- Los KPIs secundarios viven en una fila compacta de texto (patrón `WarehouseHeaderMetrics` de bodega, que ya lo hace bien en el TopBar) o dentro de un tab "Análisis".
- Un tile en estado vacío muestra la acción para dejar de estar vacío, no "0" ni "—".

### A2 — Muro de filtros

**Dónde:** `/combustibles/bitacora` (24 controles), `/mantenciones` (3 filtros + formulario), `/combustibles` (6), `/entregas`.
**Regla propuesta (patrón "4 + Más filtros"):**
- Máximo 4–6 filtros primarios visibles: los que se usan a diario (período, faena, estado/fuente, búsqueda).
- El resto va en un `<details>`/Collapsible "Más filtros (N activos)" o en un `Sheet` lateral. El contador de activos es obligatorio para no esconder estado.
- Chips de filtros activos removibles bajo la barra (la bitácora **ya los tiene** en [bitacora/page.tsx:199-207](app/(app)/combustibles/bitacora/page.tsx#L199-L207) — el patrón existe, solo falta plegar el muro).

### A3 — Formulario permanente en vez de "lista + acción en el header"

**Dónde:** `/mantenciones` (form de 11 campos arriba), `/entregas` (form arriba), `/bodega` (3 paneles laterales abiertos).
**Por qué falla:** viola la regla 5 de AGENTS.md (acciones de página van en `PageHeader.actions`); la página no sabe si es un registro o un formulario; el contenido primario (historial/stock) queda bajo el fold; en móvil el usuario scrollea un formulario que quizá no va a usar.
**Regla propuesta:** la página **es la lista**. Crear/registrar se dispara desde `PageHeader actions` y abre un `Sheet` (ya existe `components/admin/sheet.tsx` + el patrón `catalog-form-sheet.tsx`). Excepción admitida: estaciones de captura repetitiva (ver ficha de Entregas) pueden conservar el form inline pero **plegado por defecto** con re-apertura de un clic.

### A4 — Estados vacíos con jerga interna

**Dónde:** `/combustibles/ciclo` ("No disponible / Falta una de las fuentes", "No se infiere… evento canónico de consumo"), PDTP detalle ("Catálogo PDTP no cargado"), `/analitica` ("Sin distribución de gasto suficiente"), bitácora ("ejecuta la importación histórica TAE desde /combustibles/tae/importar" — una ruta pegada como texto).
**Regla propuesta:** todo estado vacío tiene 3 partes: *qué significa en lenguaje del usuario* + *qué hacer para llenarlo* + *CTA (botón/Link real, no una ruta en texto)*. El componente `EmptyState` (`components/ui/empty-state.tsx`) ya soporta esto; usarlo en lugar de `<div>` ad-hoc.

### A5 — El mismo dato representado 2–3 veces

**Dónde:** `/prevencion/ppa` (estado en KPIs + tabs + select), `/dashboard` (KPIs que duplican los chips del TopBar: "3 Por aprobar · 2 Sin OC · 2 Por recibir · 1 Alertas stock" aparecen arriba **y** como tiles).
**Regla propuesta:** una dimensión = una representación interactiva. Si hay tabs por estado, no hay select de estado ni tile por estado; los KPIs pasan a ser los propios tabs con contador.

### A6 — Consistencia de controles y de vocabulario

- **Fechas:** bitácora, ciclo y análisis usan `<input type="date">` nativo que renderiza `mm/dd/yyyy` (formato US, visible en las capturas), mientras `/combustibles` y `/analitica` usan el DatePicker propio con `dd-mm-yyyy`. Unificar con el DatePicker del design system. *(Nota ponytail: el input nativo es la opción lazy correcta cuando el formato coincide con el locale; aquí el problema es que **no** coincide — `lang="es-CL"` en el `<html>` podría bastar y es el fix más barato a evaluar primero.)*
- **Estados crudos:** la ficha de ejecución PDTP muestra `SUBMITTED`/`APPROVED` sin traducir ([pdtp-sheet-table.tsx:391](app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx#L391) y :262). Mapear a "Enviada / Aprobada / Rechazada" con `Badge`.
- **Abreviaturas sin leyenda:** `Acc. c/TP`, `HH`, `D. Material` (indicadores), `T1…T4`, `S3`, "peso 50%" (PDTP). Toda abreviatura de dominio lleva `title`/Tooltip con el nombre completo, o se renombra.

---

## 3. Fichas detalladas — Prioridad 1 (críticas)

### P1.1 — `/combustibles`: partir el mega-dashboard

**Evidencia:** `desktop-combustibles.png`, `mobile-combustibles.png` · **Código:** [app/(app)/combustibles/page.tsx](app/(app)/combustibles/page.tsx) (449 líneas de JSX de página, ~3.000 en el directorio)

**Qué ve el usuario hoy (5 segundos):** panel "Estado del combustible" con 3 tiles grandes, luego 7 KPIs, luego una barra de filtros, y el inicio de "Tendencia y precio". Nada indica qué acción se espera. Debajo del fold siguen **8 secciones más**: consumo por tipo de equipo, 2 dispersiones, evolución por equipo, heatmap faena×equipo, anomalías, 4 rankings de patentes, 4 gráficos de log operacional, alertas, y recién al final la tabla de detalle paginada (50 filas). En móvil son ~10 pantallas de scroll antes del primer gráfico útil.

**Diagnóstico (heurísticas):** *aesthetic & minimalist design* (todo a la vez), *recognition rather than recall* (para llegar a la tabla hay que recordar que está al fondo), *flexibility & efficiency* (el análisis profundo estorba al uso diario). Además duplica funciones que ya tienen ruta propia: `/combustibles/analisis` (rendimiento por equipo) y `/combustibles/anomalias` (distribución de anomalías).

**Estado objetivo:** al entrar se ve: (1) el panel de control integrado (3 tiles, se mantiene — es bueno), (2) 4 KPIs máximo, (3) filtros, (4) **la tabla de registros** o el primer gráfico de tendencia, y una navegación clara hacia el análisis profundo.

**Cambios concretos:**
1. Introducir **tabs de nivel de página** (o sub-rutas con `searchParams`, como prefiera el equipo — tabs con `?vista=` conserva los filtros): `Resumen` / `Análisis` / `Registros`.
   - `Resumen` (default): panel integrado + 4 KPIs (Total consumido, Monto, Sin asociación, Transacciones) + gráfico "Consumo y gasto por período" + alertas (`ConsumptionAlerts`) + link "Ver N registros del período →".
   - `Análisis`: tendencia/precio, tipo de equipo, dispersiones, evolución por equipo, heatmap, rankings. Evaluar **fusionar con `/combustibles/analisis`** en vez de duplicar (hoy hay dos "análisis de rendimiento" — decidir cuál sobrevive; sugerencia: la sección de la página principal se mueve allá).
   - `Registros`: `ConsumptionDetailTable` con su paginación, primera en el viewport.
2. Los 4 gráficos del "Log operacional" (sección [page.tsx:384-437](app/(app)/combustibles/page.tsx#L384-L437)) duplican conceptualmente los rankings TCT de arriba con otra fuente; moverlos al tab Análisis bajo un sub-título "Log operacional" — o eliminarlos si la bitácora ya cubre esa consulta.
3. KPIs restantes (Patentes únicas, Precio promedio, Rendimiento promedio) pasan a texto compacto en la cabecera del tab Análisis (patrón A1).
4. Cada tile del panel integrado se hace clicable: "Facturado" → `/combustibles/facturas`, "Entregado TAE" → `/combustibles/tae`, "Consumo TCT" → tab Registros (hoy son estáticos).
5. Fetch: `page.tsx` hoy ejecuta ~12 consultas en paralelo para pintar todo; con tabs, cada vista consulta solo lo suyo (`searchParams.vista`), lo que además baja el TTFB de la vista por defecto.

**Criterio de aceptación (test 5s):** un jefe de faena que entra a `/combustibles` ve el estado del período y la tabla/alertas sin scrollear; un analista llega a cualquier gráfico en ≤ 2 clics. En móvil, el tab Resumen cabe en ≤ 3 pantallas.

**Esfuerzo:** L (2–4 días). Sin cambios de backend: es re-composición de secciones ya componentizadas.

---

### P1.2 — `/combustibles/bitacora`: plegar el muro de filtros

**Evidencia:** `desktop-combustibles-bitacora-extra.png` · **Código:** [bitacora/page.tsx:164-197](app/(app)/combustibles/bitacora/page.tsx#L164-L197)

**Qué ve el usuario hoy:** 24 controles (1 búsqueda, 2 fechas nativas `mm/dd/yyyy`, 10 selects, 6 inputs de texto, 3 checkboxes, orden) en una grilla de 4 columnas que ocupa la mitad superior; la tabla de 12 columnas queda apenas asomada. Para el caso de uso del 95% ("ver las cargas recientes de una faena / buscar una patente") el usuario debe escanear 24 opciones.

**Diagnóstico:** *aesthetic & minimalist* y *flexibility & efficiency* invertidas: la interfaz está optimizada para la consulta más rara. En móvil el formulario es interminable.

**Estado objetivo:** búsqueda + 4 filtros primarios + botón "Más filtros (N)" en una sola fila; chips activos debajo; la tabla visible desde el primer segundo.

**Cambios concretos:**
1. Mantener visibles: búsqueda libre (`q`), `desde`, `hasta`, `faena`, `fuente`. Son los únicos que el resumen de la página (`TAE, facturación y log operacional en una sola consulta`) necesita a diario.
2. Mover los otros ~18 controles a un `<details className="md:col-span-4">` con summary "Más filtros" **+ contador de activos** (los chips ya se calculan en [page.tsx:139-153](app/(app)/combustibles/bitacora/page.tsx#L139-L153); reutilizar `chips.length` para el contador y abrir el details por defecto cuando haya alguno activo). Es un form GET server-side: `<details>` nativo funciona sin JS. *(Rung nativo de la escalera: no hace falta un Sheet con estado.)*
3. Agrupar dentro del panel plegado por tema, con sub-encabezados: *Vehículo* (marca, modelo, tipo, conductor, supervisor), *Operación* (punto de carga, unidad, estado operativo, sellos, evidencia), *Anomalías* (checkboxes + tipo + severidad + responsable).
4. Fechas → DatePicker del design system o `lang` correcto (A6).
5. Los chips activos ya son removibles — mantener tal cual.
6. La fila "Orden" se integra a la cabecera de la tabla (clic en "Fecha y hora" alterna asc/desc) o se queda; no es crítica.

**Criterio de aceptación:** con cero filtros activos, la tabla arranca dentro del primer tercio de la pantalla; encontrar "cargas de la patente X este mes" toma ≤ 3 interacciones; ninguna capacidad de filtrado se pierde.

**Esfuerzo:** S–M (½–1 día). Es re-maquetación de un solo form.

---

### P1.3 — `/prevencion/pdtp/[programId]`: comprimir la cabecera y humanizar la matriz

**Evidencia:** `desktop-prevencion-pdtp-detalle.png` · **Código:** [pdtp/[programId]/page.tsx](app/(app)/prevencion/pdtp/%5BprogramId%5D/page.tsx), [pdtp-sheet-table.tsx](app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx), [pdtp-indicators-panel.tsx](app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx)

**Qué ve el usuario hoy:** barra de estado del programa, aviso legal, **fila 1 de métricas** (Cumplimiento integral, Ejecución peso 50%, Verificación peso 30%, Cierre peso 20%), **fila 2** (Cumplimiento anual, Meta 90%, T1, T2, T3, T4), "Ver desglose mensual", **8 chips de hoja**, selector de **faena**, selector de **vista** (semana/anual)… y recién ahí el contenido. Once métricas — que sin faena seleccionada son once "—". La vista anual es una matriz de **21 columnas** (N°, Actividad, Programa, Responsables, Estado, Ene…Dic, Plan, Ejecutado, Registrar, Aprobar). Jerga: "peso 50%", "T1–T4", "S3", estados crudos `SUBMITTED`.

**Diagnóstico:** *recognition rather than recall* (T1/S3/pesos exigen conocer la metodología), *visibility of system status* (once "—" no es estado, es ruido), *match with real world* (códigos internos en pantalla).

**Lo que ya está bien (proteger):** vista semanal por defecto, resumen de estados clicable como filtro, toggle de densidad, agrupación por objetivo, badges "no cumple / vencidas / pendientes". El trabajo previo de UX en la tabla es bueno; el problema es la **cabecera** y la **matriz anual**.

**Cambios concretos:**
1. **Fusionar las dos filas de métricas en una sola tarjeta compacta**: Cumplimiento integral (con el anillo que ya existe) + Meta + mini-desglose "Ejecución · Verificación · Cierre" como texto secundario en la misma tarjeta con tooltip explicando los pesos. T1–T4 (trimestres) pasan al desglose mensual ya existente ("Ver desglose mensual"), renombrados "Trim. 1…4".
2. **Estado vacío guiado:** si no hay faena seleccionada, en lugar de once "—", un `EmptyState` que diga "Selecciona una faena para ver ejecución y cumplimiento" con las faenas como botones (hoy el hint está enterrado como subtítulo del tile 'Ejecutado').
3. **Jerarquía de selectores:** Hoja (8 chips) + Faena + Vista hoy compiten visualmente. Compactar: una fila con `SegmentedControl` de vista + select de faena a la derecha, y las hojas como tabs subrayados (son la navegación principal). Etiquetar cada grupo con su label como ya se hace, pero en una sola línea.
4. **Matriz anual:** congelar las 2 primeras columnas (`position: sticky` en `<th>/<td>` — CSS puro), mover "Programa" y "Responsables" a un tooltip/expansión de la fila para bajar de 21 a ~17 columnas, y abreviar la doble cifra plan/ejecutado por celda con color en vez de dos líneas.
5. **Estados en español:** mapear `exec.status` a label + `Badge` ([pdtp-sheet-table.tsx:391](app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx#L391) y :262).
6. `M{exec.month}/S{exec.week}` → "Jul · Sem 2" (mismo formato `periodLabel` que ya existe en la línea 142).

**Criterio de aceptación:** un prevencionista de faena entra, ve su % de cumplimiento y la lista de actividades de la semana sin scrollear; nunca ve un código interno (`SUBMITTED`, `M7/S2`, `T1`) sin traducción; la matriz anual se puede recorrer horizontalmente sin perder de vista qué actividad es.

**Esfuerzo:** M–L (2–3 días).

---

## 4. Fichas detalladas — Prioridad 2

### P2.1 — `/bodega`: un solo punto de entrada para los 3 movimientos

**Evidencia:** `desktop-bodega.png` · **Código:** [bodega/page.tsx:178-190](app/(app)/bodega/page.tsx#L178-L190), `return-panel.tsx`, `physical-inventory-panel.tsx`, `adjust-panel.tsx`

**Problema:** el sidebar derecho apila 3 formularios completos y siempre abiertos (Devolver a stock, Conteo físico, Ajuste de inventario). Tres formularios con campos casi idénticos (faena, producto, cantidad, motivo) uno bajo el otro son fáciles de confundir — registrar una devolución en el panel de ajuste es un error de datos real. El botón primario visible ("Cerrar conteo") pertenece al panel del medio, no a la página.

**Cambios concretos:**
1. Reemplazar el `<aside>` por **un** botón en `PageHeader.actions`: "Registrar movimiento" que abre un `Sheet` con un paso previo de tipo (Devolución / Conteo físico / Ajuste) — exactamente el patrón que la regla 5 de AGENTS.md pide para flujos múltiples ("un botón que pregunta *qué*").
2. Alternativa más conservadora (si el equipo de bodega usa los paneles como estación de trabajo): mantener el aside pero como **acordeón con los 3 plegados** y solo títulos + descripción visibles; abrir uno cierra los otros.
3. Los `headerActions` con métricas (`WarehouseHeaderMetrics`) están bien — no tocar.

**Criterio de aceptación:** en el primer viewport se ven stock y kardex completos; iniciar cualquier movimiento toma 2 clics; es imposible tener dos formularios de movimiento abiertos a la vez.
**Esfuerzo:** M (1–2 días, opción 2 es S).

### P2.2 — `/mantenciones`: lista primero, formulario en Sheet

**Evidencia:** `desktop-mantenciones.png` · **Código:** [mantenciones/page.tsx](app/(app)/mantenciones/page.tsx), `maintenance-form.tsx`

**Problema:** "Nueva mantención" (11 campos: vehículo, fecha, tipo, estado, proveedor, faena, centro de costo, documento, km, horómetro, neto, IVA, total, notas) vive inline entre los filtros y el historial. El historial — el contenido que responde "¿qué mantenciones hay?" — queda fuera del primer viewport. Violación directa de la regla 5 de AGENTS.md que el propio repo ya corrigió en otros módulos.

**Cambios concretos:**
1. Mover `MaintenanceForm` a un `Sheet` disparado por un botón "Nueva mantención" en `PageHeader.actions` (patrón `catalog-form-sheet.tsx` de admin).
2. El historial sube a primera posición bajo los filtros; los 3 filtros existentes se quedan (cumplen A2).
3. El `Sheet` conserva los valores tras guardar con éxito ("Registrar otra") para el caso de carga en lote.

**Criterio de aceptación:** al entrar se ve el historial filtrable; crear toma 1 clic más que hoy pero ver (el caso mayoritario) toma cero scroll.
**Esfuerzo:** S–M (1 día).

### P2.3 — `/entregas`: decidir la identidad (estación de captura) y hacerla explícita

**Evidencia:** `desktop-entregas.png` · **Código:** [entregas/page.tsx](app/(app)/entregas/page.tsx), `delivery-form.tsx`, `deliveries-table.tsx`

**Problema:** igual que mantenciones (form primero, historial después), con un matiz: entregas de EPP **sí** es una estación de captura repetitiva para el bodeguero (varias entregas seguidas). Quitarle el form inline sería pesimizar su caso principal.

**Cambios concretos (versión que respeta ambos usos):**
1. Envolver el formulario en una tarjeta titulada "Registrar entrega" **plegable**, abierta por defecto, con resumen colapsado de una línea. La preferencia (abierto/cerrado) se persiste en `localStorage` por usuario: el bodeguero la deja abierta, el supervisor que solo consulta la pliega una vez y no la ve más.
2. Añadir el atajo espejo: botón "Registrar entrega" en `PageHeader.actions` que expande/enfoca el formulario (así la página cumple la convención aunque el form esté plegado).
3. Tras registrar con éxito, limpiar el form, mantenerlo abierto y hacer scroll-into-view de la fila recién creada en el historial (feedback de *visibility of status* que hoy falta).

**Criterio de aceptación:** el bodeguero encadena 5 entregas sin clics extra; un usuario de consulta ve el historial completo en el primer viewport tras plegar una vez.
**Esfuerzo:** S (½–1 día).

### P2.4 — `/prevencion/indicadores`: legibilidad de la matriz y captura anual

**Evidencia:** `desktop-prevencion-indicadores-extra.png` (capturada con permiso denegado — ver nota) · **Código:** [indicadores-dashboard.tsx](app/(app)/prevencion/indicadores/indicadores-dashboard.tsx)

**Problema:** tabla de 12 meses × 12 columnas con encabezados abreviados sin leyenda (`Trab.`, `HH`, `Acc. c/TP`, `Acc. s/TP`, `D. Material`); la captura de datos es mes a mes vía modal (12 aperturas de modal para cargar un año); 6 KPI arriba duplican la fila TOTAL del pie de la tabla.

**Cambios concretos:**
1. Encabezados con `title`/Tooltip: "Acc. c/TP → Accidentes con tiempo perdido", "HH → Horas hombre", etc. (los `KpiCard` de arriba ya traen `detail` — reusar esos textos).
2. Botón "Registrar mes actual" como CTA primaria cuando falta el mes corriente (hoy el hint solo aparece si la faena no tiene *ningún* registro; lo común es ir al día siguiente mes a mes).
3. Modal de edición con navegación "← Junio · Agosto →" para cargar varios meses sin cerrar/abrir (es la mejora de captura más barata; una grilla editable año completo es la versión cara — no hacerla mientras el modal encadenado baste).
4. Los 6 KPI se quedan (son las tasas que el prevencionista reporta), pero la fila TOTAL ANUAL del footer ya los contiene; si se busca simplificar, KPIs = solo las 2 tasas + total accidentes.
5. **Nota RBAC detectada al capturar:** el usuario `Administrador` del seed no tiene el permiso de indicadores (la ruta devuelve "Sin permisos suficientes"). Verificar en `modules/prevention/manifest.ts` si `administrador` debe traerlo — huele a omisión de parity, no a decisión.

**Criterio de aceptación:** cualquier columna se entiende con hover; cargar 3 meses seguidos no requiere cerrar el modal; el mes sin registrar se distingue de un mes en cero.
**Esfuerzo:** S–M (1 día) + revisión RBAC.

### P2.5 — `/combustibles/ciclo`: lenguaje de usuario en tiles y vacíos

**Evidencia:** `desktop-combustibles-ciclo.png` · **Código:** [ciclo/page.tsx](app/(app)/combustibles/ciclo/page.tsx), `cycle-workbench.tsx`

**Problema:** la fila de conciliación muestra tiles "No disponible — Falta una de las fuentes" y "Sin fuente disponible — No se infiere desde recibido/entregado mientras no exista un evento canónico de consumo". Es prosa de diseño de datos, no de usuario. El embudo Recibido→Registrado→Entregado→Consumido (buena idea) queda vacío sin explicar cómo llenarlo.

**Cambios concretos:**
1. Reescribir los 3 tiles de diferencia/consumo en lenguaje operacional: "Para comparar recibido vs. registrado, registra al menos una recepción física y una carga en el período" — con el link/CTA correspondiente (los links "Abrir recepciones/cargas/entregas" ya existen en los tiles de arriba; repetir el patrón).
2. "Evento canónico de consumo" → "consumo confirmado por telemetría o aforo" o directamente eliminar la frase; el tile puede decir "Se calculará cuando existan entregas a equipos".
3. La nota al pie sobre merma/aforo está bien (contexto honesto) — conservarla.

**Criterio de aceptación:** una persona de operaciones lee cada tile y sabe qué registro le falta crear; cero términos de modelo de datos en pantalla.
**Esfuerzo:** S (horas — es copywriting + CTAs).

### P2.6 — `/prevencion/ppa`: una sola representación del estado

**Evidencia:** `desktop-prevencion-ppa.png` · **Código:** [ppa-list.tsx](app/(app)/prevencion/ppa/ppa-list.tsx), [ppa-metric-bar.tsx](app/(app)/prevencion/ppa/ppa-metric-bar.tsx), [list-filters.ts](app/(app)/prevencion/ppa/list-filters.ts)

**Problema:** 8 tiles (Por revisar, Detenidos, Total, Aprobados, Rechazados, % desviaciones, Resp. promedio…) + 5 tabs (Todos, Por revisar, Detenidos, Autorizados, Rechazados) + select "Todos los estados" — tres controles distintos para la misma dimensión. Con pocos datos, la pantalla es 70% cromo y 30% contenido.

**Cambios concretos:**
1. Eliminar el select de estado (los tabs ya filtran exactamente eso).
2. Fusionar tiles con tabs: cada tab lleva su contador ("Por revisar · 3"). Quedan como tiles solo los que no son estados: % desviaciones y tiempo de respuesta promedio (+ quizá total del período).
3. "Tareas con más PPA" (mini-ranking) baja debajo de la tabla o al detalle — no es decisión de entrada.

**Criterio de aceptación:** un revisor entra y el tab "Por revisar" con su contador es lo primero clicable; ninguna cifra aparece dos veces.
**Esfuerzo:** S–M (1 día).

---

## 5. Prioridad 3 — menores y de pulido

| # | Pantalla / tema | Fix | Esfuerzo |
|---|-----------------|-----|----------|
| T1 | `/dashboard` — 8 tiles duplican los chips del TopBar (Por aprobar, Sin OC, Por recibir, Alertas stock aparecen en ambos) | Dejar en la banda solo lo que el TopBar no muestra (Tareas, Entregas, Inversión, Tasa aprob.) o quitar los chips del TopBar en `/dashboard`. La cola de trabajo y accesos rápidos están bien — no tocar. Archivo: [dashboard/page.tsx](app/(app)/dashboard/page.tsx), [metric-bar.tsx](app/(app)/dashboard/metric-bar.tsx) | S |
| T2 | `/dashboard` — card PDTP vacía dice "Selecciona una faena" en un card sin acción clara | Convertir el placeholder en CTA real (select de faena inline o link al PDTP). Archivo: [pdtp-compliance-card.tsx](app/(app)/dashboard/pdtp-compliance-card.tsx) | S |
| T3 | `/flota` — 13 columnas, mitad en "—" con datos reales escasos; triple link "Combustible · Mantenciones · Detalle" por fila | Toda la fila navega a Detalle (el detalle ya tiene tabs de combustible/mantenciones); columnas $/KM-H, KM/HR y Última mantención se muestran solo si ≥1 fila tiene dato (o pasan al detalle). Archivo: [flota/page.tsx](app/(app)/flota/page.tsx) | S–M |
| T4 | Fechas nativas `mm/dd/yyyy` en bitácora, ciclo, análisis | Primero probar `lang` es-CL a nivel de documento; si no basta, DatePicker del design system (A6) | S |
| T5 | Estados crudos `SUBMITTED`/`APPROVED` en PDTP | Mapa de labels + Badge (ver P1.3-5) | S |
| T6 | `/prevencion/pdtp/acciones` — el 4° filtro dice solo "Todas" sin indicar qué filtra | Añadir placeholder/label ("Todas las actividades" o lo que corresponda). Archivo: [pdtp/acciones/page.tsx](app/(app)/prevencion/pdtp/acciones/page.tsx) | S |
| T7 | `/analitica` — vacíos genéricos ("Sin distribución de gasto suficiente") | Aplicar A4: qué falta y CTA (p. ej. "Aún no hay OCs en el período — Ver compras") | S |
| T8 | `/prevencion` (hub) — página de 4 links que duplica el menú lateral | Opción barata: dejarla (no estorba). Opción mejor: añadir contadores de pendientes a cada fila (PPA por revisar, docs por vencer) para que aporte algo que el menú no da | S–M |

---

## 6. Orden de ejecución propuesto

**Fase 1 — Quick wins de lenguaje y ruido (1–2 días, todo S):**
P2.5 (ciclo, copywriting) · T4 (fechas) · T5 (estados PDTP) · T6 (label filtro) · T7 (vacíos analítica) · T1/T2 (dashboard dedup). Son cambios de bajo riesgo que suben la percepción de calidad en toda la app de una vez.

**Fase 2 — Patrón "lista + acción en header" (2–4 días):**
P2.2 (mantenciones) → P2.3 (entregas) → P2.1 (bodega). En este orden: mantenciones es el caso limpio para asentar el patrón Sheet, entregas valida la variante plegable, bodega es el más delicado (3 flujos).

**Fase 3 — Muro de filtros (1 día):** P1.2 (bitácora). Independiente de todo lo demás.

**Fase 4 — Cabecera y matriz PDTP (2–3 días):** P1.3 + P2.4 (indicadores) + revisión RBAC de indicadores. Mismo dominio, mismo reviewer (prevención).

**Fase 5 — Split de `/combustibles` (2–4 días):** P1.1 y P2.6 (PPA). El split de combustibles al final: es el cambio más grande y las fases anteriores ya habrán fijado los patrones (tiles accionables, tabs con contador) que esta pantalla consume.

**Al cierre:** añadir a `AGENTS.md` las reglas A1–A6 como sección "Reglas de densidad de pantalla", y actualizar `manual/` para las pantallas cuyo flujo cambió (bodega, mantenciones, entregas, combustibles).

---

## 7. Cómo verificar (por fase)

1. `npm run screenshots` regenera las capturas (ojo: el `outputDir` está hardcodeado a `audit/screenshots/2026-06-09-playwright` en [scripts/capture-all-routes.ts:28](scripts/capture-all-routes.ts#L28) — actualizar el nombre o respaldar antes). Comparar antes/después del primer viewport.
2. Test de 5 segundos con un usuario real por pantalla tocada (jefe de faena para combustibles, bodeguero para entregas/bodega, prevencionista para PDTP).
3. Los tests existentes de layout (PageHeader/PageContainer) deben seguir en verde; añadir un test por pantalla movida a Sheet verificando que la acción vive en `PageHeader.actions`.
4. Añadir al script de captura las rutas que hoy le faltan: `/prevencion/evaluaciones`, `/prevencion/indicadores`, `/prevencion/pdtp/acciones`, `/combustibles/bitacora`, `/combustibles/anomalias`, `/combustibles/analisis`, `/combustibles/sellos` — y quitar las 14 rutas podadas de prevención que aún lista (devuelven 404).

---

*Generado el 2026-07-16 revisando las ~100 rutas de `app/(app)` con capturas Playwright del build actual (243 imágenes desktop+mobile + 10 rutas extra) y lectura del código de las 20 pantallas más densas. Complementa — no reemplaza — el análisis funcional de `ANALISIS_PREVENCION_2026-07-15.md`.*
