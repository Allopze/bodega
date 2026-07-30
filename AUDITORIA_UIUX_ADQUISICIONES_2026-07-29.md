# Auditoría UI/UX — Solicitudes, Aprobaciones, Compras, Recepción y Mis pendientes

**Fecha:** 2026-07-29
**Alcance:** el flujo operacional completo de adquisiciones: `/solicitudes`, `/aprobaciones`, `/compras`, `/recepcion`, `/pendientes` (listas, detalles y formularios de creación).
**Objetivo:** fricción, cosas poco intuitivas y oportunidades de mejora. No es una auditoría de contraste ni de accesibilidad formal (ver §4).

## 1. Método y evidencia

Servidor `next dev` local en :3001 contra la base `bodega_capture` (migrada a HEAD antes de capturar — venía atrasada y rompía 4 rutas con `Failed query`), sesión `admin.audit@chome.cl`.

13 rutas capturadas en desktop 1440×900 y móvil 390×844, todas HTTP 200 y sin errores de consola. Evidencia en `audit/screenshots/2026-07-29-uiux-adquisiciones/` (`d-*.png` desktop, `m-*.png` móvil) — directorio gitignored.

Fixtures relevantes de la base de captura:

| Solicitud | Tipo | Estado solicitud | Estado ítem |
|---|---|---|---|
| REP-2026-0001 | repuestos | submitted | requested |
| SOL-2026-0001 | epp | submitted | approved + pending_purchase |
| SOL-2026-0002 | otro | submitted | requested |
| SOL-2026-0003 | epp | **closed** | partially_delivered |
| SRV-2026-0001 | servicios | submitted | requested |

Cada hallazgo cita la captura y, cuando la causa está localizada, el archivo y la línea. Los hallazgos marcados **[código]** se verificaron leyendo la fuente además de la captura.

---

## 2. Hallazgos

### P0 — impiden completar la tarea

#### A-01 · `/aprobaciones` en móvil: texto superpuesto y controles fuera del contenedor **[código]**

✅ **Corregido.** `request-group.tsx:62` y `item-row.tsx:68` pasan a `flex-wrap` con `gap-x/gap-y`; el botón del código toma `basis-full` bajo `sm` y el grupo de acciones baja a su propia línea. Verificado en `after/m-aprobaciones.png`: sin solapes, y `document.scrollWidth === 390` sin elementos fuera del contenedor.

`m-aprobaciones.png`: el código `SOL-2026-0002` se envuelve en tres líneas y queda **encima** del texto del solicitante (`…cionista Faena · 09-06-2026`); el `Select` "Vía oficina" se corta en el borde derecho de la pantalla; en la fila del ítem, los botones Aprobar / Rechazar / Asignar se solapan con el código `INS-AUD-002`.

Causa: el header del grupo (`app/(app)/aprobaciones/request-group.tsx:62`) es un único `flex items-center gap-3` **sin `flex-wrap`**, y el bloque derecho es `shrink-0` con seis controles (solicitante, fecha, pastilla "N pendiente", `Select` de `w-[9.5rem]`, checkbox "Seleccionar todos" y botón "Aprobar todos"). Ese bloque mide ~500px y no cede; el botón izquierdo es `flex-1 min-w-0`, así que se comprime hasta romperse y el resto desborda.

Aprobar desde el teléfono es inviable hoy. Es el rol —jefatura en terreno— con más probabilidad de estar en móvil.

#### A-02 · `/recepcion/nueva` desborda horizontalmente en móvil

✅ **Corregido.** No era desborde de página: medido en el navegador, `document.scrollWidth` era 390 y el bloque medía 442px — `main` tiene `overflow-x-hidden`, así que el exceso se **recortaba sin scroll**. Causa real: el grid item heredaba `min-width:auto`, con lo que el `min-w-[440px]` de la tabla fijaba el mínimo de la columna. Con `min-w-0` en `receipt-form.tsx:122` el bloque cae a 358px y el scroll vuelve a vivir dentro de la tabla. Verificado: `scrollable=true, scrolled=true, headers=Producto,Recibido,Rechazado,Dañado`.

`m-recepcion-nueva.png`: el input "Guía o factura", las dos tarjetas de "Tipo de recepción", la tabla de ítems (**la columna "Dañado" no se ve**) y los textos de ayuda se cortan todos en x=390. El contenido excede el viewport en lugar de reflowear.

Es el formulario que más se usa en faena y el que más se usa desde el teléfono. Registrar una recepción con rechazo o daño requiere una columna que en móvil no existe.

#### A-03 · "Mis pendientes" manda a callejones sin salida en Aprobaciones **[código]**

✅ **Corregido.** La fuente `aprobaciones` aplica ahora `approvalQueueFilter()` y la base compartida `itemBase` excluye los estados terminales (`TERMINAL_REQUEST_STATUSES`, nueva constante única en `lib/approvals-queue.ts`). **Al verificar apareció un cuarto consumidor con el mismo bug:** `getOperationalWorkCount` —el badge del rail— repetía los criterios y dejaba el rail en 12 contra 9 de la página; también corregido. Verificado en `after/d-pendientes.png`: rail 9, página "9 acciones", `/aprobaciones` 1. Cubierto por test de regresión con control positivo (ver §5.1).

La fuente `aprobaciones` de la cola (`lib/services/operational-work-queue.ts:522-531`) filtra **solo** `purchase_request_items.status = 'requested'`. No aplica `approvalQueueFilter()` (`lib/approvals-queue.ts`), que además exige:

- `purchase_requests.status IN ('submitted','in_review','partially_approved')`
- `request_type NOT IN ('repuestos','servicios')` — repuestos y servicios se aprueban por el flujo de cotizaciones, no ítem a ítem.

Con los fixtures actuales hay 3 ítems `requested` (REP-2026-0001, SOL-2026-0002, SRV-2026-0001), así que la cola muestra **3 tareas de Aprobaciones** y la página `/aprobaciones` solo acepta **1**. `d-pendientes.png` lista "Aprobar Mantención preventiva de generador · SRV-2026-0001 · Necesita aprobación", CTA "Aprobar o devolver" → `/aprobaciones?solicitud=<id>`; `d-aprobaciones.png` muestra únicamente SOL-2026-0002. **2 de 3 clics aterrizan en una página vacía.**

Tres cifras distintas para lo mismo en la misma pantalla: badge del rail = **1**, cola de pendientes = **3**, página = **1 solicitud**.

Es la reaparición literal del hallazgo A-8 de la auditoría 2026-07-24 — el comentario que encabeza `lib/approvals-queue.ts` documenta que el predicado se extrajo precisamente para que el badge y la página no derivaran. La cola de pendientes es un tercer consumidor que no lo usa.

---

### P1 — fricción alta

#### A-04 · Nada señala lo vencido en la cola **[código]**

✅ **Corregido.** `QueueRow` (extraído de la fila inline) deriva `overdue` de `effectiveDueAt < hoy` en zona Santiago, la misma regla del chip "Vencidas". El badge pasa a `warning` y la celda de vencimiento dice "Vencida hace N días". Verificado en `after/d-pendientes.png`: las 9 filas en ámbar con su atraso explícito.

`work-queue-workbench.tsx:149` elige la variante del badge con
`item.blocked ? "danger" : item.status === "overdue" ? "warning" : "info"`.
Pero `status` es el estado de dominio (`requested`, `draft`, `sent`…); la única fuente que puede traer `'overdue'` son las obligaciones PDTP (`operational-work-queue.ts:604`). Para todo Adquisiciones la rama `warning` es código muerto.

`d-pendientes.png`: 12 filas con vencimientos 18, 19, 20 y 25-06-2026 — entre 34 y 41 días pasados — todas con badge azul informativo. El filtro rápido "Vencidas" sí funciona porque se resuelve en SQL aparte (`effective_due_at < startOfChileDay()`, línea 786), pero la fila no delata nada. Una cola priorizada donde lo atrasado se ve igual que lo reciente no prioriza.

#### A-05 · La cola calcula un resumen y lo descarta **[código]**

✅ **Corregido.** Los chips llevan contador. Se calculan sobre un CTE nuevo `scoped` —todos los filtros **menos** el chip— para que cada chip anuncie lo que entregaría al pulsarlo; contarlos sobre `filtered` habría hecho que "Vencidas" mostrara su propio total al estar activo. `queueFilterSql` se partió en `queueScopeFilterSql` + `quickFilterSql`. Verificado: `Todas 9 · Críticas 2 · Vencidas 9 · Hoy 0 · Bloqueadas 0 · Sin asignar 9 · Mis tareas 0`.

`getOperationalWorkQueue` computa `summary { critical, overdue, blocked, unassigned, moduleCounts }` en SQL (tipo en línea 126, agregación en 875, mapeo en 904). El workbench **nunca lo renderiza** (0 usos de `summary` en `app/(app)/pendientes/`). Los seis filtros rápidos van sin contador: no se sabe si "Vencidas" tiene 12 o 0 hasta hacer clic y descubrirlo.

La query ya está pagada. Poner los conteos en los chips es la mejora de mayor relación valor/esfuerzo de todo este informe.

#### A-06 · El CTA "Crear orden de compra" pierde el ítem **[código]**

✅ **Corregido.** El href lleva `&item=<id>`; `/compras/nueva` lo lee y `useOcForm` preselecciona ese ítem. Además arranca en el `modeFilter` del ítem: sin eso, una faena con ítems en ambos modos de despacho habría dejado la preselección filtrada fuera de la vista.

`operational-work-queue.ts:540`: `href = '/compras/nueva?faena=' + worksiteId`. No lleva el ítem.

La tarea dice "Comprar Guante anticorte nivel 5" y `d-compras-nueva.png` muestra el destino: los dos ítems de la faena sin marcar y el botón "Crear OC (0 ítems)" deshabilitado. Hay que reencontrar a mano el ítem por el que se hizo clic. La fuente `entregas` (línea 552) sí pasa `&item=<id>`; compras quedó a medias.

#### A-07 · "Proveedor: Listo" con el proveedor vacío **[código]**

✅ **Corregido.** `oc-form-summary.tsx` exige al menos un ítem antes de declarar el proveedor resuelto (`[].every()` es `true` por vacuidad). Verificado en `after/d-compras-nueva.png`: el checklist dice "Proveedor: **Falta**".

`app/(app)/compras/oc-form-summary.tsx:59`:
`{supplierId || includedItems.every((i) => i.targetSupplierId) ? "Listo" : "Falta"}`

Con cero ítems seleccionados, `[].every(...)` es `true` por vacuidad. `d-compras-nueva.png` lo muestra: el campo dice "Selecciona proveedor (opcional)" y el checklist afirma **Proveedor: Listo**. El checklist de "qué me falta" miente exactamente en el momento en que se lo consulta.

#### A-08 · "Despacho a faena: Completo" cuando no está completo **[código]**

✅ **Corregido.** `faenaComplete` exige ahora `officeComplete && pendingDispatch === 0`. Verificado en `after/d-recepcion-nueva.png`: el paso 2 muestra círculo gris "2" y "Disponible tras Paso 1", coherente con la tarjeta deshabilitada.

`app/(app)/recepcion/receipt-form-progress.tsx:24-25`:
```
pendingDispatch = totalOfficeReceived - totalFaenaReceived
faenaComplete   = totalOfficeReceived > 0 && pendingDispatch === 0
```
Mide "no queda nada pendiente **de lo que ya llegó**", no "el despacho terminó".

`d-recepcion-nueva.png`: con 6 de 12 unidades llegadas y esas 6 despachadas, el paso 1 dice "6 / 12 un." y el paso 2 muestra **check verde y "Completo"** — mientras la tarjeta "Recepción en faena", justo debajo, sigue deshabilitada con "Disponible una vez registrada la llegada a oficina". El stepper declara terminada una etapa que la UI no deja ni empezar.

#### A-09 · El mismo stepper suma unidades distintas y las rotula "un." **[código]**

✅ **Corregido.** El stepper sólo muestra totales cuando toda la OC comparte unidad; si no, cuenta líneas. Verificado: "Llegada a oficina — 6 / 12 **par**". La concordancia de plural se resolvió en el formateador compartido (ver A-25).

`receipt-form-progress.tsx:18-20` hace `items.reduce((n, i) => n + i.quantity, 0)` sin mirar la unidad de medida, y el texto rotula el total como `un.`

`d-recepcion-nueva.png` muestra las dos cifras en la misma tarjeta: "6 / 12 **un.**" arriba y "Pedido: 12 **par** · En oficina: 6 par" abajo. Una OC de 12 par + 5 rollo mostraría "17 un.", un número sin significado.

#### A-10 · El stepper de 5 etapas contradice la página que lo contiene

✅ **Corregido, con el diagnóstico rectificado.** La primera parte del hallazgo era **artefacto del fixture**: `receiving.ts:346-347` sí avanza el estado de la OC al registrar una recepción, y OC-2026-0001 quedó en la base de captura con `status='sent'` y `quantity_office_received=6` porque el seed escribe filas sin pasar por el servicio. Lo real y corregido: (a) `ocCurrentStage` derivaba la etapa **sólo** del estado de la OC, ignorando las cantidades que ya recibe por parámetro — ahora también las mira, así que el stepper no puede contradecir a la tabla que tiene al lado, venga la fila de donde venga; (b) el subtítulo lo escribía una sola voz para dos audiencias, y en el detalle de una recepción mostraba instrucciones para quien compra. `buildOcProgress` recibe ahora la audiencia (`"compras"` | `"recepcion"`).

- `d-recepcion-detalle.png` — es REC-2026-0001, badge "Abierta", con 6 par ya recibidos. El stepper marca "Compra" en curso y **"Recepción" apagada**. El subtítulo dice "Confirma la recepción del proveedor o registra la llegada a oficina": una instrucción para otra pantalla.
- `d-compras-detalle.png` / `-avance.png` — el ítem dice "Recepción parcial" y el tab Avance dice "RECIBIDO 6 par", pero "Recepción" sigue apagada. El stepper tiene estado "en curso" (anillo) y lo usa para Compra, así que la etapa Recepción podría representarse.

El componente que debería orientar sobre "dónde va esto" es el que más desorienta.

#### A-11 · Las descripciones de página son invisibles entre 1024 y 1535px **[código]**

✅ **Corregido.** La descripción pasa de `2xl:block` a `lg:block`. Verificado a 1440 en `after/d-compras-nueva.png` ("…y fija los precios") y `after/d-pendientes.png`.

`components/layout/top-bar.tsx:118`: la descripción es `hidden … 2xl:block`. En un laptop de 1440 —la resolución que capturé— se pierde:

- El `buildDescription()` de `app/(app)/aprobaciones/page.tsx:283-289`, que compone "N ítems en M solicitudes de K faenas". Trabajo de servidor que nunca se ve.
- "Selecciona ítems aprobados, elige el proveedor y **fija los precios**" en compras/nueva — la única pista de que hay precios que ingresar. Comparar `d-compras-nueva.png` (sin subtítulo, con "Total $0" sin explicación) contra `m-compras-nueva.png` (con subtítulo).

Lo que orienta al usuario existe y solo se muestra en monitores grandes y en móvil, no en el tamaño más común.

#### A-12 · Los breadcrumbs no se dibujan en ninguna parte en desktop **[código]**

✅ **Corregido.** Corrección al diagnóstico: no eran "sólo texto para lectores de pantalla" — `PageHeader` **no renderiza** `breadcrumb` en su bloque local, sólo lo empuja al contexto, así que no se dibujaban en ninguna parte, en ningún tamaño. El top bar los renderiza ahora en `xl`. Verificado: "Dashboard / Órdenes de compra / Nueva OC" y "Dashboard / Recepción / Registrar".

`PageHeader` empuja `breadcrumb` al contexto del shell (`components/ui/page-header.tsx:73`) y su bloque local es `lg:sr-only` (línea 81). `top-bar.tsx` **nunca lee `header.breadcrumb`**. Las páginas los construyen — p. ej. `aprobaciones/page.tsx:297-300` — y a ≥1024px son solo texto para lectores de pantalla. Ninguna captura desktop muestra un breadcrumb.

#### A-13 · Tareas de solicitudes ya cerradas en la cola **[código]**

✅ **Corregido.** Junto con A-03: la guarda de estados terminales vive en `itemBase`, así que vale para aprobaciones, compras y entregas a la vez. Las etiquetas de entregas pasan a un `CASE` en español ("Recibido parcial", "Recibido, por entregar", "Entrega parcial"); el test verifica que ningún `statusLabel` contenga `_`.

La fuente `entregas` (`operational-work-queue.ts:544-554`) filtra por estado del ítem y no del documento. SOL-2026-0003 está `closed` y su ítem `partially_delivered`, así que genera una tarea activa "Entregar …" sobre una solicitud cerrada. Mismo patrón estructural que A-03.

Además su `statusLabel` es `REPLACE(status, '_', ' ')` (línea 549) → el badge dice literalmente **"partially delivered"**, en inglés y sin traducir, mientras las demás fuentes traen etiquetas en español ("Necesita aprobación", "Listo para comprar", "Recepción en oficina").

---

### P2 — inconsistencia, ruido y oportunidades

#### A-14 · La misma urgencia se dibuja de tres maneras

✅ **Corregido.** No hubo que elegir nada: `PriorityBadge` ya existía como render único y su propio docblock dice que se creó exactamente para terminar con los tres tratamientos. La lista de solicitudes era la única que no había migrado — mantenía un `URGENCY_DOT` local, ya eliminado. Verificado en `after/d-r2-solicitudes.png`.

- `d-solicitudes.png`: texto plano coloreado — "Crítico" rojo, "Alta" naranja, "Normal" gris.
- `d-aprobaciones.png`: badge monospace en mayúsculas con punto — "CRÍTICO".
- `d-pendientes.png`: `PriorityBadge` — "CRÍTICO" / "ALTA" / "Normal".

Tres lenguajes visuales para un solo dato, en tres pantallas del mismo flujo.

#### A-15 · Urgencia en dos niveles sin precedencia visible **[código]**

✅ **Corregido.** El texto de ayuda pasó a decir cuál manda: "Valor por defecto de los ítems. Cada ítem puede fijar la suya y esa es la que prioriza en la cola." Se corrigió el copy y no el modelo: la urgencia por ítem es deliberada (`COALESCE(item, request)`), lo que estaba mal era prometer lo contrario.

`d-solicitudes-nueva.png` pide "Urgencia" de la solicitud y otra "Urgencia" por ítem. El ítem gana (`operational-work-queue.ts:512`, `COALESCE(item.urgency, request.urgency)`), pero el texto de ayuda del campo de la solicitud afirma "Alta y Crítico destacan los ítems en la cola de aprobación" — atribuyéndose un efecto que cualquier ítem puede anular. La lista de solicitudes muestra la de la solicitud; aprobaciones muestra la del ítem. Nada explica cuál manda.

#### A-16 · ~~Riesgo de OC con proveedores mezclados, sin advertencia~~ — **falso positivo, retirado**

❌ **Descartado al implementar.** `oc-form-summary.tsx:70-74` sí advierte —"Los ítems se dividirán por proveedor al crear la orden."— más un badge "N OC" en la cabecera del resumen, y el backend efectivamente divide. El formulario y la promesa del banner de la lista coinciden.

El hallazgo original decía "nada advierte al marcar ambos": la advertencia es condicional a `supplierGroupCount > 1` y en una captura estática, sin ningún ítem marcado, nunca aparece. Es exactamente la clase de error que anticipaba §4 al declarar que no se probaron interacciones. Sin cambio de código.

#### A-17 · Una solicitud aprobada no tiene camino hacia su compra

✅ **Corregido.** `RequestProgressPanel` acepta un `action`, y el detalle de la solicitud pasa "Crear orden de compra" cuando hay algún ítem en `PURCHASE_ITEM_STATUSES` y el usuario tiene `purchasing:create_order`. Aprovecha A-06: el enlace lleva `?faena=…&item=…`, así que la OC abre con ese ítem ya marcado. Y el copy dejó de delegar en "el módulo de órdenes de compra": dice qué falta, no quién debería hacerlo.

`d-solicitudes-detalle.png`: "Seguimiento del pedido — **El módulo de órdenes de compra debe generar la orden de compra**". Enuncia el siguiente paso, no lo enlaza, y nombra un módulo en lugar de un responsable. La única acción del header es "Duplicar solicitud".

#### A-18 · "Exportar Excel" cambia de sitio entre páginas hermanas

✅ **Corregido.** Nuevo `components/adquisiciones/export-excel-button.tsx` (lee los filtros de la URL, así que el enlace sigue reflejando lo que se ve) y recepción lo pasa por `actions` del `PageHeader`. Verificado en `after/d-recepcion.png`: en el top bar, fuera de la fila de filtros.

Top bar en `d-solicitudes.png` y `d-compras.png`; dentro de la fila de filtros en `d-recepcion.png`.

#### A-19 · Ayuda apilada por encima de los datos

✅ **Corregido, con una premisa rectificada.** El informe decía que los banners ocupan el espacio "de forma permanente": es falso, `OnboardingHint` es descartable y persiste en `localStorage`, y en las capturas aparecían sólo porque el navegador de captura es un perfil nuevo.

Corregido en la ronda 2: la pastilla "Sin OC" del top bar duplicaba, en el mismo viewport, la alerta ámbar de la lista — que además explica y trae su propio "Crear OC"; se quedó la accionable. Y la barra de `DataTable` ya no reserva una fila entera cuando su único control es "Columnas" (el caso de /solicitudes, que tiene el buscador en `ListFilters`).

Cerrado en la ronda 3: `OnboardingHint` **nace colapsado**. Pasó a `<details>` nativo —sin estado de cliente, el mismo patrón de `StateLegend`— con el título en una línea y el cuerpo tras el disclosure; la X de descartar sigue ahí, con `preventDefault` para que no alterne el `<details>` al pulsarla. Medido: 42px colapsado contra 95px expandido, y la ayuda de /recepcion baja de ~115px a ~42px sobre los datos.

- `d-recepcion.png`: banner informativo (~75px) + acordeón "¿Qué significa cada estado?" (~40px) + fila de filtros, todo antes de **2 filas** de tabla.
- `d-compras.png`: banner + alerta ámbar "2 ítems aprobados sin incluir en ninguna OC" que repite la pastilla "2 Sin OC" del top bar, en el mismo viewport.
- `d-solicitudes.png`: banner + fila de filtros + una fila propia solo para "Columnas", que deja una banda vacía de ~60px.

Los tres banners son texto estático de onboarding ocupando el espacio más valioso de forma permanente.

#### A-20 · "Enviada" significa dos cosas en la misma fila

✅ **Corregido.** "Enviada" → "Fecha de envío" (deja de chocar con el valor "Enviada" de la columna Estado en la misma fila) y "En tránsito" → "Pend. de faena", que es el vocabulario que ya usaba su contenido.

`d-recepcion.png`: columna **ESTADO** con valor "Enviada" y columna **ENVIADA** con una fecha. En la misma fila, la misma palabra es un estado y un campo de fecha. Y la columna "EN TRÁNSITO" contiene "1 PEND. FAENA" — header y contenido con vocabularios distintos, más una abreviatura de jerga.

#### A-21 · La cola de pendientes no usa la tabla compartida **[código]**

✅ **Corregido, sin migrar a `DataTable`.** Se evaluó la migración y se descartó: esta cola pagina por cursor y ordena en SQL, y `DataTable` hace ambas cosas en cliente — adoptarlo obligaba a rehacer la paginación. Se aplicó el patrón que `recepcion-table` ya usaba para lo mismo: tabla desde `md`, tarjetas (`QueueCard`) debajo, compartiendo la lógica de vencimiento con la fila vía `dueState`. Los chips además pasaron de `overflow-x-auto` a `flex-wrap`, así que desaparecieron los dos scrolls horizontales anidados. Verificado en `after/m-r2-pendientes.png`, sin desborde.

`work-queue-workbench.tsx:147` es un `<table>` a mano con `min-w-[980px]`, fuera de `DataTable` — cuyo `caption` se hizo obligatorio en la remediación del 2026-07-28 justamente para unificar tablas. En móvil (`m-pendientes.png`) el resultado son **dos scrolls horizontales anidados** en la misma pantalla: los filtros rápidos ("Mis tareas" cortado) y la tabla, cuyas columnas de acción quedan a ~600px de scroll. Sumado a los 4 selects apilados y "Más filtros", hay que recorrer ~620px verticales antes del primer dato.

#### A-22 · Modo consulta que parece formulario roto

✅ **Corregido en dos pasos.** Ronda 2: los textos de ayuda de creación ("La jefatura confirma al aprobar", etc.) ya no se emiten en `readOnly`.

Ronda 3, al **medir** el contraste que la ronda anterior sólo había afirmado: los valores de la solicitud estaban en **3.53:1**, bajo el mínimo AA de 4.5:1, por el `disabled:opacity-50` del control. Un dato en una ficha de lectura es contenido, no un control inactivo — la exención de WCAG 1.4.3 no lo cubre. Los campos en modo consulta recuperan la opacidad (siguen no interactivos): **3.53 → 18.85:1**.

`d-solicitudes-detalle.png`: los datos se presentan como selects deshabilitados en gris tenue ("Faena Mininco", "EPP", "Alta") junto a los textos de ayuda de creación, que ahí ya no aplican ("Alta y Crítico destacan los ítems en la cola de aprobación", "La jefatura confirma al aprobar"). Se lee como un formulario averiado más que como una ficha de consulta.

#### A-23 · Dos mecanismos de aprobación masiva conviviendo **[código]**

✅ **Corregido.** "Aprobar todos" sólo se muestra cuando no hay nada marcado en el grupo; en cuanto hay selección manda la barra en lote, que declara cuántos va a aprobar. Además el botón dice el número ("Aprobar todos (1)"). Marcar un ítem y aprobar el resto sin querer ya no es posible.

`d-aprobaciones.png` ofrece a la vez checkbox por ítem + "Seleccionar todos" (que alimenta una barra de acciones masivas) **y** un botón "Aprobar todos" que ignora la selección y envía el grupo completo (`request-group.tsx:136-145`, `value={pendingIds}`). Marcar un ítem y pulsar "Aprobar todos" aprueba todos. En `d-compras-nueva.png` el mismo "Seleccionar todos" es un link de texto sin checkbox: tercera variante del patrón.

#### A-24 · Rechazar tiene mucha menos afordancia que Aprobar

✅ **Corregido, y apareció un hallazgo mayor detrás.** `returnItemAction` existía completa —permisos, observaciones obligatorias, su propio estado `returned`— y **ningún botón la alcanzaba**: `grep` de consumidores devolvía cero. Por eso el CTA de /pendientes prometía "Aprobar o devolver" algo que la pantalla no ofrecía. Devolver y rechazar **no** son sinónimos (devolver vuelve al solicitante para corregir y la cola lo marca "Bloqueada"; rechazar es terminal), así que la solución no era unificar el vocabulario sino exponer la acción que faltaba. La fila tiene ahora Aprobar / Devolver / Rechazar, y Rechazar dejó de ser texto suelto: es un botón con borde, a la par del resto.

`d-aprobaciones.png`: "Aprobar" es un botón verde sólido; "Rechazar" es texto rojo con ícono, sin borde ni fondo. Y el verbo cambia según la pantalla: "Rechazar" en aprobaciones, "Aprobar o **devolver**" como CTA en pendientes, `returned` = "Bloqueada" en la cola. Tres nombres para la misma decisión.

#### A-25 · Plurales y unidades sin concordancia

✅ **Corregido.** Se resolvió en el formateador compartido `formatQty` (`lib/utils.ts`), así que aplica a todas las pantallas de una vez, con un mapa explícito de plurales: las unidades las administra el usuario y una abreviatura (`kg`, `m2`) no debe pluralizarse, así que lo desconocido pasa tal cual. También "1 ítem/2 ítems" en el subtítulo de la cola y "1 decisión registrada / N decisiones registradas". Verificado: "8 rollos", "12 pares", "4 rollos".

"8 rollo" (`d-aprobaciones.png`), "1 items" y "2 items" (`d-pendientes.png`), "1 decisión(es) registradas" (`d-solicitudes-detalle.png`).

#### A-26 · "Mis pendientes" vive dentro de Adquisiciones

✅ **Corregido.** Área propia `pendientes` (orden 5, arriba de Adquisiciones). Al hacerlo apareció un efecto secundario: un área de un solo destino quedaba envuelta en un acordeón que, colapsado, **escondía el badge de conteo**. Se corrigió en `AreaSection`: las áreas con un único ítem se renderizan planas, como "Inicio". Verificado en `after/d-r2-solicitudes-detalle.png`: "Mis pendientes 9" plano y con su badge.

En todas las capturas el ítem cuelga del grupo Adquisiciones, pero la cola agrega PDTP, CAPA, Inspecciones, Documentación, PPA y SST (`MODULE_LABELS`, `work-queue-workbench.tsx:16-19`). Es una bandeja transversal presentada como submódulo de compras.

#### A-27 · Duplicación de encabezado en móvil

✅ **Corregido.** La descripción de la página ya no repite la del `<h2>` ("Todo lo que requiere tu acción, en un solo lugar" contra "N acciones dentro de tus permisos y faenas").

`m-pendientes.png`: h1 "Mis pendientes" + "Cola priorizada de trabajo real dentro de tus permisos y faenas", inmediatamente seguido de h2 "Cola de trabajo" + "12 acciones priorizadas dentro de tus permisos y faenas". Dos títulos y dos descripciones casi idénticas. En desktop no se nota porque el h1 es `lg:sr-only`.

#### A-28 · `unassigned` es un filtro sin puerta en la UI **[código]**

✅ **Corregido.** "Sin asignar" es ahora un chip visible, con contador. Verificado: `Sin asignar 9`.

`parseOperationalQueueFilters` lo acepta (`operational-work-queue.ts:1141`) pero `QUICK_FILTERS` (`work-queue-workbench.tsx:21-23`) no lo ofrece. "Sin asignar" —justo el filtro que necesita quien reparte trabajo— solo se alcanza escribiendo la URL a mano.

#### A-29 · "Página anterior" usa `router.back()` **[código]** — **en gran parte falso positivo**

❌ **El razonamiento original estaba mal**, y ✅ **el borde real quedó cerrado.**

El diagnóstico decía que un cambio de filtro entre medio rompía el retroceso, pero `update()` usa `router.replace` (no agrega entrada al historial) y sólo `nextPage()` usa `router.push`. El historial contiene entonces exactamente la secuencia de cursores, y `router.back()` **sí** devuelve a la página anterior de resultados.

El borde estrecho sí era real: entrando por un enlace compartido con `?cursor=…`, el botón aparecía y `back()` sacaba de la aplicación. Cerrado en la ronda 3 sin construir una pila de cursores: un marcador distingue si el historial lo construyó esta lista. Si lo construyó, el botón dice "Página anterior" y usa `back()`; si no, dice **"Volver al inicio de la lista"** y limpia el cursor, que nunca sale de la aplicación. El marcador va en `sessionStorage` y no en estado de React porque `/pendientes` tiene `loading.tsx` y la navegación remonta el árbol.

#### A-30 · "Condición de pago" es texto libre

✅ **Corregido con `datalist`, no con `Select`.** Los datos ya divergen ("30 días", "Contado", "CREDITO" en la base de desarrollo), así que un `Select` habría rechazado valores legítimos de proveedores y OC históricas. Un `datalist` nativo guía hacia `PAYMENT_TERMS_OPTIONS` sin bloquear lo demás, y el valor que trae el proveedor sigue autocompletándose.

`d-compras-nueva.png`, placeholder "30 días, contado, etc.". Cada usuario escribirá su variante ("30 dias", "30 días", "contado", "Contado") y el campo queda inservible para filtrar, agrupar o reportar. El detalle de OC ya lo muestra como dato estructurado ("30 días").

#### A-31 · Contradicción aparente entre Facturación y Avance

✅ **Corregido.** La pestaña Avance explica, cuando alguna línea va en 0, que "Facturado" cuenta cantidades conciliadas y que una factura puede estar registrada sin cantidades asignadas todavía.

`d-compras-detalle.png` rotula el tab "Facturación **1**"; `d-compras-detalle-avance.png` muestra "FACTURADO **0 par**". Puede ser correcto en el modelo (una factura sin líneas asignadas a ítems), pero al usuario le llega como dos datos en conflicto sin nada que lo explique.

#### A-32 · El submit primario no cierra el formulario de recepción

✅ **Corregido.** "Responsables de la recepción" pasó a ir **antes** del formulario: asignar es un paso previo al registro, y así "Marcar como recibido" vuelve a ser lo último de la página.

`d-recepcion-nueva.png`: "Marcar como recibido" está a media página y **debajo** aparece la sección "Responsables de la recepción" con su propio botón "Asignar". Contenido interactivo después de la acción primaria: quien asigna después de enviar, ya envió.

#### A-33 · El glosario de estados solo existe en la lista

✅ **Corregido.** El detalle explica ahora qué significa "Abierta"/"Cerrada" junto al badge. No se reusó `StateLegend`: ése documenta estados de **OC**, y acá el badge es el estado de la **recepción**.

`d-recepcion.png` tiene el acordeón "¿Qué significa cada estado?"; `d-recepcion-detalle.png` muestra un badge "Abierta" sin ninguna explicación disponible. El detalle es donde más se necesita.

#### A-34 · "Ver OC" parece deshabilitado

✅ **Corregido.** "Ver OC" toma borde, fondo de superficie y sombra, el mismo tratamiento que los demás botones secundarios.

`d-recepcion-detalle.png`: es un link activo con fondo gris tenue y texto de bajo contraste, junto a paneles de datos. No se lee como acción.

#### A-35 · Detalles de tabla

✅ **Corregido.** Ronda 2: (a) Casing: la causa no era el texto sino que `repuestos` estaba mapeado a `warning`, una variante de **severidad**, que en el design system lleva mono-mayúsculas; el tipo de solicitud es una categoría, así que todas sus variantes pasaron a neutras y "REPUESTOS" dejó de gritar. (b) "Recibir" se movió a una columna de acciones al final de la fila. (c) El badge de tránsito dice "N ítems" en vez de repetir el nombre de la columna. (d) "En oficina" bajo un título "…en faena" se reescribió como "Llegó antes a oficina", que es el hito que realmente representa.

Ronda 3: (e) **Alineación numérica** — la causa era que los consumidores usaban `TableCell` con `text-right pr-6` ad-hoc en vez de `TableCellNum`, el render canónico (mono, alineado y con el mismo padding que su encabezado). Migradas las columnas Ítems, Total y Facturas de `oc-list-rows` y la columna Ítems de `request-list`. (f) **Contadores de pestañas** — "Historial" recibió el suyo; "Avance" sigue sin contador **a propósito** y con un comentario que lo dice: tiene una fila por ítem, así que su número sería el de "Ítems" repetido.

- Casing inconsistente en la columna TIPO de `d-solicitudes.png`: "EPP", "Otros", "REPUESTOS", "Servicios" convivendo.
- Columnas numéricas sin alineación derecha consistente (ÍTEMS y TOTAL en `d-solicitudes.png` y `d-compras.png`).
- Tabs con contador solo en algunos: "Ítems 1", "Facturación 1", "Avance", "Historial" (`d-compras-detalle.png`).
- Los badges "SUGERIDO: PROVEEDOR" en monospace mayúsculas pesan más que el nombre del producto (`d-compras-nueva.png`).
- `d-recepcion-detalle.png` titula "Ítems recibidos **en faena**" y la fila dice "En oficina: 6 par".
- `d-recepcion.png`: el botón "Recibir" está pegado al badge de estado y se lee como parte de él.

#### A-36 · "Unidad" del ítem es texto libre **[código]** — *hallazgo nuevo, ronda 3*

✅ **Corregido.** Apareció al auditar bajo el pliegue de `/solicitudes/nueva`, la única de las tres pantallas de creación con una segunda pantalla de contenido (1172px de 900px).

`item-editor.tsx:225` renderizaba la unidad de medida como `Input` libre, con "unidad" precargado. Es la misma familia que A-30: cada usuario escribirá su variante ("unidad", "Unidad", "un", "unid.") y la columna queda inservible para agrupar o comparar — y encima alimenta a `formatQty`, cuyo mapa de plurales sólo reconoce las formas canónicas.

Mismo remedio que A-30, y por la misma razón: un `datalist` sobre `UNIT_OF_MEASURE_OPTIONS` (apoyado en `VALID_UNITS`, el vocabulario que ya valida la importación de EPP) guía hacia el término canónico sin rechazar las unidades de productos heredados. No se usó `Select` porque el catálogo lo administra el usuario.

---

## 3. Prioridad sugerida

El patrón de fondo de los tres P0 y de A-13 es el mismo: **la cola de pendientes reimplementa criterios que ya viven en otro lado en vez de reusarlos**, y el layout móvil de aprobaciones y recepción nunca se probó a 390px.

Orden por relación valor/esfuerzo:

1. **A-03 + A-13** — hacer que las fuentes de la cola reusen los predicados canónicos (`approvalQueueFilter` y equivalentes por módulo). Un dead-end de 2 en 3 clics destruye la confianza en la bandeja.
2. **A-05** — renderizar el `summary` que ya se calcula, como contadores en los chips. Cambio pequeño, mejora inmediata.
3. **A-04** — derivar "vencida" de `effectiveDueAt` en la fila, no de `status`.
4. **A-01 + A-02** — `flex-wrap` y reflow móvil en `request-group` / `item-row` y en el formulario de recepción.
5. **A-07 + A-08 + A-09** — tres cálculos que afirman en pantalla algo distinto de lo que ocurre; los tres son correcciones de pocas líneas.
- **A-11 + A-12** — subir el breakpoint de la descripción y decidir si los breadcrumbs se muestran o se eliminan del `PageHeader`.
- **A-06** — propagar el ítem en el href, igual que ya hace `entregas`.
- El resto (P2) agrupado por tipo: unificar la representación de urgencia (A-14), el vocabulario de la decisión (A-24), los mecanismos de selección masiva (A-23) y la ubicación de las acciones de exportar (A-18).

## 4. Qué no se verificó

> **Estado:** esta sección describe el alcance de la auditoría **original**. La ronda 3 cerró casi todo lo que enumera —interacciones, contraste, estados vacíos, bajo el pliegue— y descartó el "buscador duplicado" por inexistente. Ver §5.6 para lo verificado y §5.8 para lo que sigue realmente abierto.

- **Interacciones.** Todo el informe se basa en render estático de 13 rutas. No se abrió el `product-picker`, no se envió ningún formulario, no se probó el selector de variantes ni los estados de validación y error.
- **El buscador duplicado.** El top bar trae "Filtrar en esta página…" con atajo `/` (`top-bar.tsx:146-164`) y cada lista trae el suyo. Visualmente compiten sin nada que los distinga, pero no se probó el comportamiento de ambos sobre la misma tabla. Vale una prueba dirigida.
- **Contraste.** Varios hallazgos mencionan "bajo contraste" por inspección visual (A-22, A-34, el estado disabled de "Crear OC", la tarjeta "Recepción en faena"). No se midieron ratios ni se corrió axe. La auditoría 2026-07-28 ya cubrió contraste de forma sistemática.
- **Estados vacíos y de error.** Todas las rutas tenían datos. No se vieron los `EmptyState` reales de compras, recepción ni solicitudes, ni los `error.tsx`.
- **`/solicitudes/nueva` y `/compras/nueva` completos.** El layout usa un contenedor con scroll propio, así que `fullPage` no captura bajo el pliegue. Los formularios se auditaron hasta donde llega el viewport.
- La base de captura tenía la cadena de migraciones atrasada y hubo que migrarla; `scripts/capture-all-routes.ts` no incluye `/pendientes` en su lista de rutas, por lo que ese módulo no tiene baseline histórico con el que comparar.

---

## 5. Estado de remediación (2026-07-29, misma sesión)

Tres rondas. La primera cerró los P0 y la mayoría de los P1; la segunda, el grueso de los P2; la tercera, los parciales que quedaban y las brechas de verificación que §4 había declarado abiertas. Capturas en `audit/screenshots/2026-07-29-uiux-adquisiciones-after/` (`d-*`/`m-*` ronda 1, `*-r2-*` ronda 2, `*-r3-*` ronda 3).

> **Nota sobre las capturas:** el círculo oscuro con una "N" en el borde inferior izquierdo es el indicador de `next dev` (`nextjs-portal`), no interfaz de la aplicación. En una captura llegó a taparle las primeras letras a un párrafo; se verificó por medición (`elementFromPoint`) antes de tratarlo como defecto. No existe en producción.

### 5.1 Verificación

- `tsc --noEmit` limpio. `eslint app components lib modules` sin errores ni advertencias.
- Suite completa verde en las tres rondas: **3112 pasan** (368 archivos, 21 saltados) en la configuración rápida y **399 pasan** (47 archivos) en la de PGlite.
- Test de regresión en `lib/__tests__/operational-assignments.test.ts`: tabla con los cuatro criterios excluyentes (servicios, repuestos, solicitud `draft`, solicitud `closed`) más uno que sí debe aparecer, la ausencia de etiquetas con `_`, y la igualdad `badge del rail === total de la página`.
- **Control positivo hecho:** revirtiendo sólo la línea de `approvalQueueFilter`, el test falla con `servicios/submitted/requested: expected true to be false`. El verde no es un falso verde.
- Cobertura de `formatQty` ampliada, incluido el caso que **no** se debe pluralizar (`3 kg`, `3 m2`).
- **25 aserciones de interacción en vivo, todas pasan** (§5.6). Cubren lo que §4 declaraba sin probar.
- **Contraste medido, no afirmado** (§5.6): 8 puntos, con conversión por canvas y opacidad heredada compuesta contra el fondo real.
- Las capturas se validan con dos aserciones automáticas por vista: cero errores de consola y `scrollWidth - clientWidth <= 1`.

### 5.2 Corregido (34 de 36, ninguno parcial)

**P0 (3/3):** A-01, A-02, A-03.
**P1 (10/10):** A-04 … A-13.
**P2 (21/21 de los válidos):** A-14, A-15, A-17, A-18, A-19, A-20, A-21, A-22, A-23, A-24, A-25, A-26, A-27, A-28, A-30, A-31, A-32, A-33, A-34, A-35, A-36.

Los dos no corregidos son A-16 y el diagnóstico de A-29, ambos descartados por ser incorrectos (§5.3).

A-19, A-29 y A-35 quedaban parciales al cierre de la ronda 2 y se cerraron en la ronda 3. Cada hallazgo lleva su nota "✅ Corregido" en §2 con archivo y forma de verificación.

### 5.3 Descartado por ser incorrecto (5)

Verificar antes de arreglar evitó cinco cambios que habrían sido ruido o daño:

- **A-16** — falso positivo completo. `oc-form-summary.tsx:70-74` sí advierte ("Los ítems se dividirán por proveedor al crear la orden"), más un badge "N OC", y el backend divide. La advertencia es condicional a tener ítems marcados, así que en una captura estática nunca aparece.
- **A-29 (el diagnóstico)** — los cambios de filtro usan `router.replace`, no `push`, así que `back()` sí funciona. El borde estrecho que quedaba sí era real y está corregido.
- **La "divergencia badge/cola en entregas"** que este documento reportó al cierre de la ronda 1 **no existe**: la fuente `entregas` ya tenía el `EXISTS worksiteStock … quantity > 0`. Lo afirmé leyendo una ventana truncada del archivo. El `productId IS NOT NULL` que el badge suma es redundante — con `productId` nulo la comparación da NULL y el `EXISTS` ya es falso.
- **La primera mitad de A-10** era artefacto del fixture: `receiving.ts` sí avanza el estado de la OC. (Ver §5.5: el seed quedó corregido.)

Y el quinto, de la ronda 3: **el "buscador duplicado" de §4 no existe.** `top-bar.tsx:25` tiene `ROUTES_WITH_OWN_SEARCH`, que oculta el buscador del top bar exactamente en las cinco rutas auditadas. Medido: 0 inputs de filtro global en `/solicitudes`.

### 5.4 Hallazgos nuevos, aparecidos al remediar

Ninguno venía de la auditoría: los destapó el trabajo de corregirla.

1. **El badge del rail era un cuarto consumidor de los criterios divergidos** (`getOperationalWorkCount`). Arreglar la cola sin él habría dejado el rail en 12 contra 9 de la página. Corregido y cubierto por el test.
2. **`returnItemAction` era código muerto desde la UI.** Una acción completa, con permisos y observaciones obligatorias, sin un solo botón que la alcanzara, mientras el CTA de la cola prometía "Aprobar o devolver". Corregido exponiendo la acción (ver A-24).
3. **Un área de navegación con un solo destino escondía su badge.** Efecto secundario de A-26: el acordeón colapsado ocultaba el conteo. Corregido en `AreaSection` para cualquier área de un ítem.
4. **`formatQuantity` duplicaba a `formatQty` sin concordancia de plural**, así que el panel de seguimiento decía "4 rollo". Ahora delega en el formateador compartido.
5. **Dos defectos de contraste reales, sólo visibles al medir** (§5.6): los valores en modo consulta a 3.53:1 y el texto que explica por qué la recepción en faena está bloqueada a 2.08:1. Ambos por `opacity-50` heredada. Corregidos.
6. **"Unidad" del ítem de una solicitud es texto libre** (`item-editor.tsx`), la misma familia que A-30. Quedó documentado como **A-36** en §2 y corregido con el mismo remedio.
7. **Un `nested-interactive` que introdujo la propia corrección de A-19** — botón dentro de `<summary>`, impacto serio en cuatro rutas. Lo cazó la suite e2e de accesibilidad, no las capturas ni los tests unitarios. Detalle en §5.7.
8. **`pickCurrentMonthDate` (helper e2e) rompe según el calendario del mes.** Deuda pre-existente, ajena a esta auditoría, que afecta a los cinco specs que lo usan. Detalle en §5.7.

El patrón detrás de 1, 2, 4 y 6 es el mismo que el de los P0: **lógica duplicada que derivó**. Los criterios de la cola viven ahora en `TERMINAL_REQUEST_STATUSES` y `approvalQueueFilter`, el formato de cantidades en `formatQty`, y el vocabulario sugerido en constantes con nombre.

### 5.5 Correcciones al instrumental de auditoría

- **El seed de captura quedaba en un estado que el servicio nunca produce.** `scripts/capture-all-routes.ts` insertaba OC-2026-0001 con `status: "sent"` y su ítem con 6 de 12 recibidas en oficina **y** en faena; con esas cantidades `recalcOrderStatus` la dejaría en `partially_received`. Esa incoherencia es la que hizo reportar A-10 como bug del stepper. El seed ahora escribe el estado que el servicio produciría, con un comentario que explica el invariante. Sin esto, cada auditoría futura volvería a inventar el mismo hallazgo.
- **La base `bodega_capture` persiste entre corridas y se desactualiza**: al empezar le faltaban columnas y cuatro rutas de compras/recepción reventaban con `Failed query` — visible sólo en consola, porque la página igual devuelve 200. Conviene migrarla antes de capturar.

### 5.6 Verificación en vivo (ronda 3)

**Interacciones — 25/25 pasan.** Lo que §4 declaraba sin probar:

| Qué | Resultado |
|---|---|
| Aprobar / Devolver / Rechazar visibles en la fila | los tres |
| "Devolver" abre su formulario y exige observaciones | sí; enviar vacío no procede |
| "Aprobar todos (N)" desaparece al marcar un ítem (A-23) | sí, y aparece la barra en lote |
| El CTA de la cola lleva el ítem (A-06) | `?faena=ws-audit-1&item=req-item-audit-1` |
| La OC abre con ese ítem marcado | 1 marcado, botón "Crear OC (1 ítem)" |
| El `datalist` de condición de pago (A-30) | 6 opciones, y sigue aceptando texto libre |
| El CTA del detalle de la solicitud (A-17) | lleva faena e ítem |
| El banner nace colapsado y se expande (A-19) | 42px → 95px |
| El top bar no duplica el buscador | 0 inputs globales |

**Contraste medido** (WCAG AA: 4.5:1 texto normal, 3:1 grande):

| Punto | Antes | Después |
|---|---|---|
| A-22 · valores en modo consulta | **3.53:1** | 18.85:1 |
| Texto "Disponible una vez registrada la llegada a oficina" | **2.08:1** | 7.55:1 |
| A-34 · enlace "Ver OC" | — | 18.85:1 |
| A-24 · botón "Rechazar" | — | 5.96:1 |
| A-24 · botón "Devolver" | — | 18.85:1 |
| Celda "Vencida hace N días" (A-04) | — | 5.99:1 |
| Botón "Aprobar" (referencia) | — | 8.07:1 |
| Botón "Crear OC" **deshabilitado** | 2.9:1 | 2.9:1, **exento** |

El último no se cambió a propósito: WCAG 1.4.3 exime explícitamente el texto de componentes inactivos, y subirle el contraste borraría la señal de que está deshabilitado. Los otros dos sí eran defectos: en ambos la opacidad afectaba **contenido** (un dato en una ficha de lectura, y la instrucción que explica por qué un control está bloqueado), no el control inactivo en sí.

**Estados vacíos** — los cinco listados devuelven 200 sin errores de consola y muestran su `EmptyState` con acción de limpiar filtros. En `/pendientes` los siete chips muestran 0 y se atenúan, lo que confirma que el CTE `scoped` respeta el filtro de búsqueda.

**Bajo el pliegue** — medido el contenedor con scroll propio: `/compras/nueva` y `/recepcion/nueva` caben en una pantalla a 1440×900 (900px de 900px), así que la advertencia de §4 sobrestimaba el problema. Sólo `/solicitudes/nueva` tiene una segunda pantalla (1172px); revisada, es donde apareció el hallazgo de "Unidad".

### 5.7 La suite e2e, y lo que encontró

Se corrió el subconjunto que toca los selectores modificados: cola operacional, pendientes, recepción, compras, accesibilidad y navegación por teclado. Contra `bodega_e2e_local` para no tocar la base compartida.

**Primera corrida: 42 pasan, 7 fallan.** Las tres causas, todas distintas:

1. **Una regresión de accesibilidad que introduje yo** (4 specs). El `<details>` de A-19 dejaba el botón de descartar **dentro del `<summary>`**, y un control interactivo anidado en otro dispara `nested-interactive` de axe con impacto *serio*: rompe el foco y el anuncio en lectores de pantalla. Corregido moviendo el botón a hermano del `<details>`, posicionado sobre la esquina. Es exactamente el tipo de defecto que sólo aparece corriendo la suite: los tests unitarios y las capturas lo dejaban pasar.
2. **Una aserción que mi cambio volvió ambigua** (1 spec). Las tarjetas móviles de A-21 hacen que el mismo código aparezca dos veces en el DOM —tabla desde `md`, tarjetas debajo—, así que `getByText("SOL-BULK-E2E-001")` cayó en strict mode. Sólo una rama es visible por viewport y la otra va con `display:none`, fuera del árbol de accesibilidad, de modo que no hay defecto de producto: se acotó con `.first()`, el mismo patrón que ya usaban las líneas siguientes del propio spec.
3. **Un bug pre-existente del helper de fecha, ajeno a esta auditoría** (2 specs). `pickCurrentMonthDate` clicaba el **primer** botón cuyo texto fuera el día del mes. Julio de 2026 empieza miércoles, así que la primera fila de la grilla muestra 28, 29 y 30 de **junio**: con hoy = 29, seleccionaba el 29-06 y el servidor lo rechazaba con "La fecha requerida no puede estar en el pasado". Es una falla dependiente del calendario —habría aparecido igual sin ningún cambio de esta sesión— y afecta a los cinco specs que usan el helper. Corregido seleccionando por `data-day` (la fecha ISO que expone `react-day-picker`) en vez de por texto, y calculando el día en la zona contra la que valida el servidor.

**Segunda corrida, tras los tres arreglos: 31 pasan, 2 fallan.** Las cuatro de accesibilidad y las tres de la cola operacional quedaron verdes, confirmando los dos primeros arreglos. Las 2 restantes, ambas de `purchase-flow.spec.ts`, se caracterizaron con una **tercera corrida aislada** (sólo ese archivo, 1 worker): **3 pasan, 1 falla**.

- **"cierra sesión y bloquea el acceso al dashboard" era flaky.** Pasó en la corrida 1, falló en la 2 (2 workers) y volvió a pasar aislada. El test sólo abre el menú de usuario y cierra sesión: nada de lo modificado lo toca. Contención entre workers.
- **La otra falla avanzó dos veces, y ninguna de las dos causas era de producto.** En la corrida 2 no encontraba la OC enviada en `/recepcion`; aislada, esa aserción **pasa** (era una carrera con el commit de "Marcar como enviada"). Entonces falló más adelante, en `getByText("Recepción en oficina")`, que resuelve a **dos** elementos: la tarjeta de etapa y el `statusLabel` de la sección "Responsables de la recepción". Ambigüedad **latente y pre-existente**: este spec nunca había llegado hasta ahí en este entorno porque el bug del helper de fecha lo cortaba antes. Acotada a la tarjeta con `getByRole("button", …)`.

**Cuarta corrida (purchase-flow + recepcion-flow, 1 worker): 4 pasan, 1 falla.** La falla volvió a avanzar —ahora tres pasos más adelante, en la etapa 2 de recepción— y su causa ya no es de código: la cantidad precargada es 10 donde el spec espera 5, y la base muestra que la OC quedó con **dos líneas** porque arrastró ítems `approved` del seed (`SOL-BULK-E2E-*`).

El origen es del entorno, no de esta remediación: **`e2e/setup-db.ts` tiene 103 líneas sin commitear del trabajo concurrente en este checkout** (PDTP), y ese archivo es el que siembra los datos de todos los specs. Con el seed en movimiento no hay línea base contra la que validar `purchase-flow`, así que conviene reintentarlo cuando ese trabajo esté cerrado. Los tres arreglos de aserciones sí quedaron confirmados: el spec ahora recorre creación → aprobación → OC → impresión → emisión → envío → recepción en oficina, donde antes moría en el primer paso.

Vale subrayar el reparto: de todo lo que encontró la suite, **uno** era un defecto mío —el `nested-interactive`, que se habría ido a producción sin correrla—, **dos** eran aserciones que había que acotar (una por mi cambio, una latente), **una** era deuda pre-existente del instrumental, **una** flakiness de concurrencia y **una** contaminación del seed por trabajo ajeno en curso.

### 5.8 Lo que sigue abierto

Nada de la auditoría queda sin resolver: los 34 hallazgos válidos están corregidos y los 2 restantes descartados por incorrectos. Lo de abajo es alcance que nunca estuvo cubierto, no deuda de la remediación.

- **Los specs e2e restantes** (PDTP, combustibles, privacidad, entregas, repuestos/servicios, zoom 200%) no se ejecutaron. El arreglo del helper de fecha toca a los cinco specs que lo usan, así que conviene una corrida completa antes de cerrar.
- **`purchase-flow.spec.ts` sigue en rojo por contaminación del seed**, no por código (§5.7). Hay que reintentarlo con `e2e/setup-db.ts` estable.
- **Sin auditar en profundidad:** el `product-picker`, el selector de variantes y la validación campo a campo. Se probaron los flujos, no cada control.
- **`error.tsx`** de cada módulo: no se forzó ningún fallo de servidor para verlos.
- **Dark mode**: todo se midió y capturó en tema claro. El contraste de §5.6 no dice nada del tema oscuro.
- **Móvil real**: se emuló 390×844 en Chromium, sin dispositivo ni navegador móvil de verdad.
- **`scripts/capture-all-routes.ts` no incluye `/pendientes`** en su lista de rutas, así que ese módulo sigue sin baseline histórico con el que comparar.
- **El botón "Crear OC" deshabilitado sigue en 2.9:1** — exento por WCAG 1.4.3 y dejado a propósito (§5.6). Si se quisiera subir, habría que rediseñar la señal de "deshabilitado" sin apoyarse en opacidad.
