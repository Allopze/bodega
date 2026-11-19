# Mantención: auditoría de lógica y UI/UX (2026-11-16)

Auditoría de **sólo lectura** del submódulo de Mantención sobre `main` `8725e74a9`: jefatura en `/mantencion/*`, la pestaña Mantención de la ficha única `/flota/[id]/mantencion` y la app del mecánico `/m/mantencion`. **No se cambió código.** Este informe parte de lo que ya corrigieron las auditorías del 2026-11-04 y del 2026-11-11 y no repite esos hallazgos. Ninguna de las líneas encontró que alguna de esas correcciones se haya vuelto a romper.

## Método

- **Código:** cinco líneas de lectura en paralelo con trazado de llamadas:
  - OT;
  - registros y fotos;
  - equipos, pautas y catálogos;
  - app del mecánico y sincronización;
  - Panel, permisos y paridad de navegación.
- **Navegador:** `next dev` en :3002 contra `bodega_dev`, con las migraciones al día (391/391).
  - Datos: 123 equipos, 545 registros, 36 OT en los 7 estados y 3 pautas.
  - Usuario QA administrador global.
  - 30 rutas recorridas en escritorio (1440×900) y móvil (390×844), con capturas, consola, red, overflow, conteo de `h1` y axe (WCAG 2.1 A/AA) en escritorio.
- **Sondas dirigidas:** buscador de la TopBar por página, enlaces de las cifras del Panel, selectores de faena y combinaciones de filtros en Registros.
- **Verificación de cada hallazgo:**
  - **Navegador:** reproducido en :3002.
  - **Lectura:** confirmado trazando el código.
  - **Sospecha:** requiere reproducirlo; se indica cómo.

## Resumen

| Severidad | Cantidad | Qué significa |
|---|---|---|
| P0 | 0 | Sin pérdida o corrupción de datos ni brechas explotables con los roles actuales |
| P1 | 5 | Flujo sin salida, evidencia equivocada o error invisible |
| P2 | 35 | Dato incorrecto visible, inconsistencia notable o riesgo latente |
| P3 | ~60 | Menores, copy, rendimiento y mejoras |

Lo más importante:

1. **App del mecánico:** un registro queda sin salida si jefatura desactiva un conductor, aceite o ejecutor ya elegido (APP-3).
2. **App del mecánico:** al cambiar de equipo se conservan las fotos con el sello del equipo anterior (APP-2).
3. **App del mecánico:** un teléfono con el reloj adelantado, o con una primera carga lenta, no puede entrar: ve «Necesitas señal» (APP-1).
4. **OT:** anular una OT nacida de un hallazgo deja la CAPA trabada, sin camino para volver a derivarla (OT-1).
5. **Equipos:** los errores de «Editar mantención» y de «Nuevo equipo» que sólo traen mensaje nunca se muestran (EQ-1).
6. **Panel:** el selector de faena ofrece 10 faenas desactivadas y omite Horcones, Oficina Central y Fábrica de Puertas, que son activas y tienen equipos (PAN-8, navegador).
7. **Panel:** tres cifras del período enlazan a todas las OT cerradas de la historia, y «pauta al día 41 %» enlaza a las vencidas (PAN-1 y PAN-6, navegador).
8. **Registros:**
   - «Anulados» dentro de «Por revisar» da una lista vacía sin explicación (REG-4, navegador).
   - El buscador no encuentra folios ni «ka91» (REG-7, navegador).
   - «Exportar Excel» exporta sólo la pestaña activa (REG-3).
9. **Costo de la OT:** lo carga quien la pide, nunca jefatura al cerrar, y alimenta las cifras de costo (OT-4).
10. **Incorporar desde la flota:**
    - No tiene buscador: la TopBar lo oculta por un patrón obsoleto (PER-1, navegador).
    - Precarga marcas crudas como «MAHINDRA» o «SSANGYONG», que se crean en el catálogo al incorporar (EQ-18, navegador).

---

## P1

### APP-3 · Bug de producto: registro sin salida si se desactiva un conductor, aceite o ejecutor ya elegido
- **Dónde:**
  - `components/mantencion/app/trabajo-parts.tsx:14`: `chosen` descarta los ids que no están en el catálogo.
  - `step-trabajo.tsx:61-63`.
  - `lib/mantencion/client/flow-validate.ts:358-360`: sólo mira `length`.
  - `lib/services/mantencion/records-create-validate-corrective.ts:49-52`.
- **Escenario:**
  1. El borrador, o un registro firmado sin señal, lleva `driverIds=[X]`, y jefatura desactiva X.
  2. El servidor rechaza con «vuelve a elegirlo».
  3. En la corrección el chip de X no se dibuja ni se puede quitar, así que cada reenvío se rechaza igual.
  4. Con aceites hay que adivinar el truco de pulsar dos veces «No se cambió aceite». El ejecutor muestra «Elige…» con el id viejo en el estado.
  5. La única salida es descartar el registro, con sus fotos.
- **Arreglo:** filtrar los ids que ya no existen al armar el borrador, al entrar al paso y en `buildRecord`, o mostrarlos como «ya no disponible · quitar».
- **Verificación:** lectura.

### APP-2 · Hallazgo funcional: al cambiar de equipo se conservan las fotos con el sello del equipo anterior
- **Dónde:**
  - `lib/mantencion/client/flow.ts:132-140`: `pickEquipment` reinicia lectura, pauta y marcas, pero no `photos`.
  - El sello va quemado en los píxeles (`photo-capture.ts:112`).
- **Escenario:**
  1. Preventiva de KA-140 con las fotos tomadas.
  2. En Revisar, «Cambiar» lectura y luego «Cambiar» equipo a KA-141.
  3. Los pasos con fotos siguen como «Lista», y el registro de KA-141 queda con fotos rotuladas «KA-140».
  4. El servidor no lo detecta.
- **Arreglo:** al cambiar de equipo, soltar las fotos y volver a pedirlas (o avisarlo con un diálogo).
- **Verificación:** lectura.

### APP-1 · Bug de producto: «Fresco» se mide con el reloj del teléfono y una ventana de 2 minutos
- **Dónde:**
  - `components/mantencion/app/mant-app.tsx:31,64`: `Date.now() - Date.parse(renderedAt) < 2 min`.
  - `lib/mantencion/client/bootstrap.ts:63`.
- **Escenario:** un teléfono nuevo, con señal, va más de 2 minutos adelantado, o su primera carga en 3G tarda más de 2 minutos. Queda `fresh=false`, no se pide credencial y aparece «Necesitas señal para entrar», que se repite al reintentar. Con un reloj atrasado pasa lo contrario: un HTML viejo del caché se ve «fresco». El mismo patrón aparece en `accounts.ts:43-50`.
- **Arreglo:**
  - Que el service worker marque el HTML servido desde caché.
  - Alternativa: comparar con la hora del servidor (header `Date`), no con la del teléfono.
- **Verificación:** lectura. La carga lenta y el desfase real son sospecha; para reproducir, simular `Date.now` +3 minutos.

### OT-1 · Hallazgo funcional: anular una OT nacida de un hallazgo deja la CAPA sin camino
- **Dónde:**
  - `lib/services/mantencion/work-orders/transitions.ts:454-471`: `voidWorkOrder` no mira `inspectionFindingId`.
  - `lib/services/prevention-inspections/runs.ts:879`: «El hallazgo ya tiene una acción CAPA enlazada».
  - `create.ts:278`: una OT manual siempre graba `inspectionFindingId: null`.
- **Escenario:**
  1. Se anula una OT derivada de un hallazgo porque el equipo era otro o estaba duplicada.
  2. El hallazgo queda en `capa_linked` sin OT viva y no se puede volver a derivar.
  3. Una OT creada a mano no lleva el hallazgo, así que su conformidad no acredita la CAPA.
  4. Prevención no se entera.
- **Arreglo:**
  - Al anular, ofrecer «Abrir OT de reemplazo» con el mismo `inspectionFindingId` y avisar a Prevención.
  - Alternativa: exigir motivo y aviso para anular mientras el hallazgo siga abierto.
- **Verificación:** lectura.

### EQ-1 · Bug de producto/UX: los errores de «Editar mantención» y «Nuevo equipo» que sólo traen mensaje no se ven
- **Dónde:**
  - `app/(app)/mantencion/equipos/actions.ts:74-77`: `toState` siempre devuelve `fieldErrors: {}`.
  - `components/mantencion/jefatura/equipos/equipment-plan-form.tsx:63` y `equipment-form.tsx:67`: el `Callout` exige `!state.fieldErrors`, y `{}` es truthy.
- **Escenario:** el equipo se movió a una faena que el usuario no administra, se borró, o choca una unicidad no prevista. Al pulsar «Guardar cambios» no pasa nada: ni mensaje ni cambio.
- **Arreglo:**
  - `fieldErrors: undefined` cuando el objeto está vacío.
  - Alternativa: mostrar el `Callout` si hay mensaje y ningún campo con error.
- **Verificación:** lectura de los dos lados.

---

## P2

### Órdenes de trabajo

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| OT-4 (+PAN-3, PER-4) | **Costo de la OT a medio camino.** La migración 0377 (2026-11-06) volvió a agregar `total_cost` opcional. Hoy lo escribe cualquiera que crea la OT, incluido el admin. de contrato, aunque el detalle diga «Cargado por jefatura». Sólo se puede editar en «por asignar» o «asignada», antes del trabajo, y el Panel dice «se carga al cerrarla». Alimenta «Mano de obra y taller», el costo de Control operacional y los indicadores. | `new-ot-sheet.tsx:245`, `create.ts:276`, `transitions.ts:~524`, `ot-aside.tsx:129`, `indicators-sections.tsx` | Decidir: si va, exigir `manage` y permitir cargarlo hasta el cierre; si no, retirarlo. Nota: la decisión del 2026-11-02 era «la OT no lleva costos». | Lectura |
| OT-2 | Horas y días en taller (y el MTTR) cuentan el tramo en que el equipo ya había vuelto a faena, entre la salida y un rechazo: la OT guarda un solo par ingreso/salida. | `transitions.ts:375-379`, `metrics.ts:136-141`, `indicators.ts:277-280`, `query.ts:95-101` | Registrar tramos (eventos `started`/`finished`/`rejected`) y sumarlos. | Lectura |
| OT-3 | Tras una **reapertura**, ni la ficha ni la app muestran el motivo; si hubo un rechazo anterior, la ficha muestra ese motivo viejo como si fuera el actual. | `catalog-items.ts:42,84`, `ot-model.ts`, `ot-sections.tsx` (`OtRejectionNotice`) | Considerar el último `rejected` o `reopened` con su motivo. | Lectura |
| OT-5 | «Nueva OT» envía los ítems de un tipo desmarcado: Mantención con 3 ítems, desmarcada, hace nacer la OT con 3 ítems de mantención. Si un ítem oculto falla en Zod, el envío falla sin mensaje visible. | `new-ot-sheet.tsx:73-87, 160`, `create.ts:62-67` | Mandar `[]` para el tipo no marcado y filtrarlo también en el servidor. | Lectura |
| OT-6 | «Corregir ingreso» falla si el taller o el operador de la OT se desactivaron después: obliga a cambiarlos y falsea el historial. | `transitions.ts:132-153, 191-211` | Aceptar los ya guardados aunque estén inactivos (patrón `keepWorksiteId`). | Lectura |
| OT-7 | Un teléfono adelantado más de 5 minutos recibe un rechazo definitivo (422) al registrar ingreso o salida, porque la app propone su propia hora como «ahora». | `core.ts:48-50`, `sync-ops.ts` (`refuse(422)`) | Recortar a `now()` del servidor si el desvío es pequeño. | Sospecha (teléfono a +10 min) |
| PER-2 (=OT-15) | **Alcance latente.** `assign`, `unassign`, `reopen`, `void`, `editRequest` y `start`/`finish` con `manage` no revisan la faena de la OT; sólo `receive` y `conform` lo hacen. Si `mant:ot:manage` se delega por `/admin/roles` a alguien no global, esa persona opera OT de otras faenas por id. | `access.ts:95-142`, `transitions.ts` (`runLocked`) | `inWorksiteScope` en toda transición de un actor no global. | Lectura (latente) |

### Registros

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| REG-4 | «Estado del registro = Anulados» dentro de «Por revisar» da 0 filas («No hay registros por revisar…»), porque la consulta pide `anulado AND vigente`. Con `revision=todos` aparecen los 3 anulados. | `records-query.ts:42-46`, `records-filters.tsx:83` | Al elegir «Anulados», pasar a `revision=todos`, o hacer de «Anulados» una pestaña (A5). | **Navegador** |
| REG-7 | El buscador sólo busca código o patente literal: `MC-MAS-0014` y `ka91` dan 0 resultados, y `KA-91` da 9. | `records-query.ts:28-33` | Buscar también por folio y comparar sin guiones ni mayúsculas; placeholder «Folio, código o patente». | **Navegador** |
| REG-3 | «Exportar Excel» lleva el filtro de la pestaña: quien revisa entra en «Por revisar» y exporta sólo los pendientes creyendo que son todos. | `registros/page.tsx:100,189`, `records-query.ts:43-46` | Exportar con la semántica de «Todos», o decir en el botón qué incluye. | Lectura |
| REG-1 | Las observaciones ya cerradas (registro revisado o anulado) siguen pidiendo respuesta en la app sin fin. Además, con más de 50 históricas, una pendiente antigua sale de la ventana. | `catalog.ts:128-146`, `home-model.ts:87-90`, `record-lifecycle.ts:283-325` | Filtrar `vigente AND observado AND response IS NULL`. | Lectura |
| REG-2 | «Lectura anterior» puede ser un registro **posterior** del mismo día (preventiva a 12.000 y correctiva a 12.010 el mismo día): sale mayor que la propia lectura, en el detalle, el PDF y el texto de la alerta de salto. | `records-detail.ts:199-220` | Acotar por `(workDate, receivedAt)` menor que el del registro. | Lectura |
| REG-5 | «Seleccionar todos» + «Marcar como revisados» no distingue lo delicado: la alerta de foto de otra fecha sólo existe en el detalle, y los observados sin respuesta entran al lote. | `records-query.ts:97`, `record-selection.tsx:44-52`, `record-review-batch.ts` | Calcular `stampGap` en la lista y excluir del «todos» las filas con alerta, o avisar. | Lectura |
| REG-6 | El enlace registro ↔ OT (`work_order_id`) no aparece en el detalle, el PDF, el Excel ni la lista. Sólo se ve el texto libre «OT» de 60 caracteres. | `records-detail.ts`, `record-sections.tsx:192`, `export-records.ts` | Traer `{id, folio}` de la OT y enlazarla. | Lectura |

### Equipos, pautas y catálogos

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| EQ-2 | Cambiar el tipo a otra unidad (km→h) en el padrón deja la lectura inicial en la unidad vieja: 120.000 km pasan a leerse como 120.000 h. | `equipment-resolve.ts:289-325`, `equipment.ts:395-476` | Limpiar la lectura al cambiar la unidad, o fijar la unidad si hay lectura inicial. | Lectura |
| EQ-3 | «Nuevo equipo», con un código o patente que ya existe en la flota, reescribe ese vehículo con lo tipeado: modelo y año en blanco, marca, faena y tipo. Sólo exige `mant:equipment:manage`, no `admin:fleet_vehicles`, contra la decisión del 2026-11-11. | `equipment.ts:91-163` | Si el vehículo existe, tratarlo como «Incorporar desde la flota»: identidad de sólo lectura. | Lectura |
| EQ-4 | La «baja» en Mantención desactiva el vehículo en **toda** la plataforma (Flota y Combustible) sin confirmación. El texto dice sólo «deja de aparecer en la app del mecánico». | `equipment.ts:280-294`, `equipment-plan-form.tsx` | `ConfirmDialog` con el alcance real y decidir el permiso exigido. | Lectura |
| EQ-6 | La importación rechaza filas que sólo cambian la pauta si la marca actual del equipo fue desactivada. | `equipment-import.ts:202-204, 324-328` | Si la fila no trae marca, conservar `brandId` (`keepBrandId`). | Lectura |
| EQ-18 | «Incorporar desde la flota» **precarga como marca nueva el texto crudo de la flota** («Maxus», «MAHINDRA», «SSANGYONG», «Mazda», «Peugeot»): al incorporar se crean en el catálogo compartido con esa caja. Si hay una sola pauta de la unidad, se asigna sola. La selección incluye filas ocultas por el filtro. | `fleet-incorporation-panel.tsx:53`, `fleet-incorporation.ts` | Sugerir sin precargar, normalizar la caja y contar sólo lo visible. | **Navegador** (captura móvil) |
| EQ-5 | El padrón puede dejar `fuel_vehicles.meterType` distinto de la unidad de Mantención, que sale del tipo. | `vehicle-form.tsx:~414`, `actions-module/vehicles.ts`, `fleet.ts:112,224` | Validar el medidor contra el tipo cuando hay perfil con registros. | Sospecha |

### App del mecánico

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| APP-4 | Un 403 (por ejemplo, `mant:app:use` retirado y luego restituido) deja operaciones de OT, taller y respuestas en `needs_login` para siempre: la cuenta sigue `ok`, no se reemite nada y `requeueAuthor` no corre. | `sync-engine.ts:78-89`, `bootstrap.ts:63-69` | No usar `needs_login` para 403; reencolar al arrancar. | Lectura |
| APP-5 | Se pierden en silencio los rechazos de novedades de taller y de operaciones de una OT que salió del catálogo. El equipo «vuelve» a taller sin explicación. | `home-model.ts:70`, `fleet-view.ts:198`, `ot-model.ts:149` | Sección «No se pudo enviar» también para `workshop` y `ot`. | Lectura |
| APP-6 | `postSimple` y `uploadPhoto` dan por enviado cualquier 2xx sin mirar el cuerpo, a diferencia de `postRecord`. | `api.ts:203,242` | Exigir `{ok:true}`. | Lectura |
| APP-7 | El service worker navega network-first **sin tiempo máximo**: con wifi sin salida, pantalla en blanco aunque haya shell guardado. | `public/mant-sw.js:77-109` | Timeout de 4–5 s y caer al caché. | Lectura |
| APP-8 | El toast queda sobre «Firmar y guardar» o «Continuar» durante 4 s y atrapa los toques (`z-index: 90`, sin `pointer-events: none`). | `app/(mecanico)/mant-app.css:168` | `pointer-events: none` y subirlo sobre el pie. | Sospecha (mirar a 390×844) |
| APP-9 | «Quitar» una foto la borra con un toque, sin deshacer. El botón está sobre la propia foto. | `photo-slot.tsx:37-41, 98-101` | Diferir el borrado con «Deshacer», o confirmar. | Lectura |
| APP-10 | El botón Atrás de Android saca de la PWA en vez de volver de paso o cerrar la hoja. | sin `pushState`/`popstate` en `components/mantencion/app` | Una entrada de historial por paso u hoja. | Sospecha |
| APP-11 | Los mensajes de Zod llegan en inglés («Too big: expected string…») porque los campos de texto no tienen `maxLength`. | `flow-record.ts:113-114`, `step-trabajo.tsx:357`, `trabajo-jobs.tsx:201` | `maxLength` en los campos, o traducir los mensajes. | Lectura |

### Panel

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| PAN-8 | **El selector de faena del Panel sale de `mant_worksite_settings`, no de las faenas con equipos.** Ofrece Arauco, Cabrero, Calymag, Cholguan, Ecoservitran, Fab. Puertas, Panguipulli, Servimar, Sin ubicación y Teno, todas **desactivadas**. Omite Horcones, Oficina Central y Fábrica de Puertas, que son **activas** y tienen equipos (KCH-129 y KA-135 son de Horcones). El selector de OT sí las lista bien. | `lib/services/mantencion/panel.ts:95` (`loadPanelWorksites`) | Usar la misma fuente que OT y Equipos: faenas activas dentro del alcance. | **Navegador** + BD |
| PAN-1 | «OT cerradas en el período», «Tiempo medio de reparación» y «Mano de obra y taller» enlazan a `/mantencion/ot?estado=cerrada` sin fechas: muestra las 15 cerradas de toda la historia, no las del período. Además, `desde/hasta` de la lista filtra por fecha de pedido, no de cierre. | `indicators-sections.tsx` (`closedList`), `work-orders/query.ts:76` | Filtro por fecha de cierre en la lista, o no enlazar. | **Navegador** |
| PAN-6 | «Equipos con la pauta al día **41 %**» enlaza a `equipos?estado=vencida`, el complemento. Además, «al día» excluye a las 16 «próximas» (que no están vencidas) y a las 49 «sin lecturas», así que 41 % se lee como que el 59 % está mal cuando hay 5 vencidas. | `indicators-sections.tsx` | Enlazar a `estado=al_dia` y definir la cifra (por ejemplo «sin vencer: N de M con lecturas»). | **Navegador** |
| PAN-2 | Un balde recortado por el rango («Últimos 90 días» empieza el 18-ago) se dibuja como mes completo, sin la marca «parcial». Sólo se marca el mes en curso. | `indicators.ts:114` (`bucketWindow`), `lib/indicators/period.ts` (`isPartialBucket`) | Marcar parcial todo balde recortado, o alinear a meses. | Lectura |
| PAN-4 | «Días fuera de servicio» suma vehículos de la flota sin ficha de Mantención, y enlaza a `equipos?taller=1`, la lista de hoy, no la del período. | `indicators.ts` (`loadOutOfService`) | `innerJoin(mantEquipmentProfiles)`; revisar el enlace. | Sospecha (contar intervalos sin perfil) |
| PAN-5 | La franja «Hoy» muestra «Órdenes por asignar» y «Registros por revisar» con tono de alerta a quien no puede asignar ni revisar (`supervisor_mantencion`, `jefa_chome`). | `panel-today.tsx`, `panel/page.tsx:71` | Condicionar al permiso, o quitar el tono. | Lectura |

### Permisos y navegación

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| PER-1 | `/mantencion/equipos/incorporar` **no tiene buscador**: el patrón `/^\/mantencion\/equipos\/[^/]+$/` (pensado para la ficha vieja) oculta el de la TopBar, y el panel filtra por `searchQuery` de la TopBar sin input propio. | `components/layout/top-bar.tsx:75`, `fleet-incorporation-panel.tsx:50,81` | Excluir `nuevo`, `importar` e `incorporar` del patrón (la ficha ya no vive ahí). | **Navegador** |

---

## P3 (por área)

### OT
- **OT-8.** Si el único `jefe_mantencion` es quien actúa, el aviso cae a todos los administradores (`notifications.ts:105-110`).
- **OT-9.** Los eventos de una misma transacción salen en orden aleatorio («Mecánico asignado» antes o después de «Orden solicitada»), en la ficha y en el Excel.
- **OT-10.** El vocabulario de eventos está duplicado y diverge entre ficha, Excel, PDF y avisos:
  - `rejected`: «Rechazada», «Devuelta a taller» o «volvió a taller».
  - `created`: «Orden solicitada» o «Creada».
  - El PDF no cubre `en_ejecucion` en «siguiente paso».
- **OT-11.** «Corregir ingreso» ofrece editar la fecha estimada, pero el servidor la rechaza.
- **OT-12.** Tras un rechazo, la fecha estimada vieja deja la OT «Vencida» al instante.
- **OT-13.** Faltan avisos:
  - al mecánico cuando la OT se cierra;
  - al solicitante cuando se reabre;
  - al solicitante cuando se rechaza en la recepción;
  - al asignado cuando se edita la solicitud.
- **OT-14.** La conformidad la da la faena de apertura, no la actual del equipo (sospecha con un equipo trasladado).
- **OT-16.** Una OT en taller de un equipo dado de baja no se puede terminar: sólo queda anularla.
- **OT-17.** Las OT derivadas de una inspección no reciben el mecánico automático de la faena.
- **OT-18.** El filtro «Mecánico» muestra el id crudo de un mecánico que ya no es asignable.
- **OT-19.** «Nueva OT» conserva los errores de un intento anterior al reabrir la hoja.
- **OT-20.** La fecha de la orden no tiene tope de futuro.
- **PER-3.** El Excel de OT no exige `mant:export`, a diferencia de Registros, Equipos y Pautas.
- **PAN-7.** «Órdenes por asignar 4» de la franja y la barra «Por asignar 4» del gráfico son la misma cifra en la misma pantalla (A5).
- **PAN-9.** Reabrir limpia `closed_at`, así que la serie «en cola» queda inflada hacia atrás.
- **UI-1.** En «Por asignar», las columnas Estado, Mecánico, Ingreso, Entrega estimada y Días en taller están vacías o repiten la pestaña (navegador).
- **UI-2.** En el bloque «Avance», el texto dice «Taller interno (interno)» (navegador).
- **UI-3.** Las tarjetas «Trabajos anexos» y «Mantenciones solicitadas» se muestran vacías aunque el tipo no esté marcado (navegador).

### Registros
- **REG-8.** Desalineaciones del Excel con la UI:
  - La columna «Revisión» dice «Pendiente» donde la UI dice «Por revisar».
  - «Observaciones» son las notas del mecánico, no las de jefatura.
  - Las observaciones de revisión no aparecen en ninguna hoja.
- **REG-9.** Un registro hecho desde el PC dice «Firmado en el teléfono» y «Firma del mecánico».
- **REG-10.** «Todos los mecánicos» también lista talleres externos.
- **REG-11.** La galería y el PDF cargan la foto original (hasta 10 MB) y no tienen fallback. Con el archivo ausente, el texto `alt` se encima a «Ampliar» (navegador, con las fotos sin archivo del dev).
- **REG-12.** En el visor, ← y → cambian de foto aunque haya zoom.
- **REG-13.** «Descargar PDF» es un `<a download>` hecho a mano, sin feedback ni manejo de error; AGENTS.md pide `ExportLink`.
- **REG-14.** Feedback incompleto:
  - «No quedan registros por revisar» aparece fuera de esa pestaña.
  - «Observar» no muestra toast.
  - El tope es de 1.000 caracteres en la acción y de 2.000 en el servicio.
- **REG-15.** La franja «Indicadores» depende de la pestaña de revisión: «Equipos en taller por correctiva» da 1 en «Por revisar», 2 en «Todos» y 1 en «Revisados» (navegador). Su rango «del 01-11-2025 al 02-11-2026» es el mínimo y el máximo del conjunto, y se lee como un período elegido.
- **REG-16.** El servidor acepta una pauta que no es la del equipo, y el aviso «la pauta cambió mientras…» puede ser falso.
- **REG-17.** El esquema acepta más de un decimal y la base redondea a 1.
- **REG-18.** Una foto que ya pertenece a otro registro da el mensaje «se vuelve a enviar sola».
- **REG-19.** El PDF archivado puede quedar con una «Lectura anterior» obsoleta.
- **REG-20.** El detalle no enlaza a la ficha ni a la hoja de vida.
- **REG-21.** Historial anterior:
  - Una sola fila cambiada aborta toda la importación.
  - El detalle muestra el correo de quien respondió a supervisores de faena.
- **REG-22.** Código muerto: `pendingObservations` y el comentario desfasado de `legacy-import.ts`.
- **REG-23.** La hoja de vida de un equipo trasladado es invisible para la faena nueva (sospecha; decidir si es deliberado).
- **REG-24.** Carrera mínima entre el recolector de huérfanas y la resubida de una foto (sospecha).
- **REG-25.** Quien revisa puede revisar sus propios registros (política por decidir).
- **UI-4.** «Hecho por» repite el nombre: «Eduardo Silva / Eduardo Silva (taller externo) · registrado por…» (navegador).
- **UI-5.** En móvil, los filtros ocupan 5 filas (~330 px) antes del primer registro, y en Equipos 3 filas. Pasar los secundarios a «Más filtros» por debajo de `sm` (navegador).

### Equipos, ficha, pautas y catálogos
- **EQ-7.** La marca de Mantención (`brandId`) y la del padrón (texto) divergen: renombrar una marca no cambia `fuel_vehicles.brand`, aunque el diálogo dice «se ve en todo lo que ya la usa».
- **EQ-8.** La regla «unidad fija con registros» se evalúa sin bloquear la fila (sospecha de carrera).
- **EQ-9.** Las pautas no tienen alcance por faena; es latente porque hoy sólo las maneja la jefatura global.
- **EQ-10.** En «Diferencias por marca» se pueden editar filas inertes (ítems que no están en la pauta), y no hay forma de agregar una marca.
- **EQ-11.** La ficha y «Nuevo equipo» calculan el borrador de todas las pautas sólo para llenar un `<select>`, y ofrecen el nombre del borrador.
- **EQ-12.** El Excel de equipos rotula «Estado» la columna que la lista llama «Mantención». **UI-6:** el filtro de la lista sigue diciendo «Todos los estados» (navegador).
- **EQ-13.** Las instrucciones de la plantilla dicen «si la faena no existe, se creará», y eso ya no es así.
- **EQ-14.** Hay dos parsers de números: `numberOrNull` en las acciones y `parseLocaleNumber` en la planilla. «1234.567» da cifras distintas.
- **EQ-15.** «Nuevo equipo» ofrece faenas fuera del alcance de quien lo usa.
- **EQ-16.** La importación del padrón recarga el catálogo completo por cada fila con perfil.
- **EQ-17.** Restos de la ficha vieja: `hasMaintenanceProfile` sin uso y la carpeta `equipos/[id]/` que sólo aloja una acción. Considerar `permanent: false` en el redirect mientras la ficha evoluciona.
- **EQ-19.** Una fila rechazada puede dejar creada una faena nueva (sospecha).
- **EQ-20.** La ficha de repuesto no filtra por faena; es latente con los roles actuales.
- **EQ-21.** Los vehículos de un tipo inactivo desaparecen de «Incorporar» y de su aviso, sin motivo visible.
- **PER-7 / UI-7.** En la ficha `/flota/[id]/mantencion`, el breadcrumb dice «Mantención › Equipos» pero el menú marca «Vehículos» de Flota (navegador como administrador). Un `supervisor_mantencion` sin `flota:view` no vería ningún ítem activo (sospecha).
- **UI-8.** El guion de los vacíos es inconsistente («–» y «—») en la ficha (Mantención, Plan) y en la lista de OT (navegador).
- **UI-9.** En la ficha, «Estimación GPS · Al día» aparece junto a «Sin lecturas» sin decir que «al día» es la frescura del GPS.
- **UI-10.** «Hoja de vida» y «Órdenes de trabajo» vacías no tienen CTA (A4). La segunda podría ofrecer «Crear orden de trabajo».
- **UI-11.** La página `/mantencion/catalogos` se titula «Marcas y talleres», pero administra 5 catálogos (también conductores, tipos de trabajo y aceites).

### App del mecánico
- **APP-12.** La pantalla «Acceso revocado» es inalcanzable: revocar ya cierra la sesión web, así que el mecánico ve «Tu sesión venció».
- **APP-13.** El aviso de taller sin actualizar (`stale`) no se recalcula sin señal.
- **APP-14.** El `today` del flujo queda congelado: pasada la medianoche rechaza la fecha de hoy.
- **APP-15.** Trabajo de más en el cliente:
  - Cada autoguardado relee el catálogo.
  - Cada 304 reescribe el historial completo.
- **APP-16.** El primer envío puede demorar hasta 60 s por el cerrojo (sospecha).
- **APP-17.** Endurecimiento de los endpoints de sync:
  - JSON sin tope de tamaño.
  - Consulta a la base antes del límite de tasa.
  - Sin cuota de fotos huérfanas por usuario.
- **APP-18.** No se puede quitar una cuenta del teléfono.
- **APP-19.** El estado de sincronización no se anuncia: falta `role="status"`.
- **APP-20.** Dos enlaces salen de la PWA. El del registro puede dar 403 a un mecánico con `view_own`.
- **APP-21.** La miniatura se regenera con `sharp` en cada GET.
- **APP-22.** «1234.50» se interpreta como 123.450.
- **APP-23.** Una cuenta bloqueada aparece como «por enviar».

### Navegación y shell
- **PER-5.** Un rol con sólo `ot:execute` o sólo `equipment:manage` ve el ítem en el menú, pero `/mantencion` lo manda a `/forbidden` (hipotético con los roles por defecto).
- **PER-6.** Los tiles de Flota, Control operacional y Dashboard cuentan OT por faena; la lista suma además las propias de otra faena.
- **PER-8.** «Órdenes de trabajo» no tiene contador en el menú; Combustible sí lo tiene en «Por revisar».
- **UI-12.** El chip «Tu faena: Oficina Central» aparece en todas las páginas de Mantención, incluso en una lista de todas las faenas o en una OT de Flor del Laja. Viene del `TopBar` (con prueba propia), así que es una decisión de la shell. Se anota porque en Mantención se lee como el filtro activo.
- **UI-13.** «Días fuera de servicio 63,4» se repite en la tira y en el titular de su gráfico (A5; el caso de «OT abiertas» ya se resolvió así).

---

## PASS (verificado)

- **Rutas.** Las 30 rutas responden 200 en escritorio y móvil, con un solo `h1` visible, sin scroll horizontal de la página a 390 px y sin error boundary.
- **Accesibilidad.** axe WCAG 2.1 A/AA dio **0 violaciones** en las 30 rutas de escritorio.
- **Consola.** Sin errores de consola salvo el 404 de fotos del dev (ver advertencias).
- **Redirecciones.**
  - `/mantencion` → Panel.
  - `/mantencion/indicadores` → Panel.
  - `/mantencion/configuracion` → Pautas.
  - `/mantencion/equipos/<id>?x=1` → `/flota/<id>/mantencion?x=1`, conserva la query.
- **Buscador de la TopBar.** Filtra de verdad en Equipos, Pautas, el detalle de pauta (la matriz), Catálogos, Dispositivos y Repuestos. OT, Registros e Historial tienen buscador propio y están en `ROUTES_WITH_OWN_SEARCH`.
- **Cifras del Panel que cuadran.**
  - 19 OT abiertas, igual a la base: 4+5+4+3+3.
  - 5 vencidas, igual a la lista de Equipos.
  - «Equipos en taller 6» = 4 por OT + 2 por correctiva, igual que Registros en «Todos».
- **Código sano según las líneas de lectura.**
  - Folio atómico, idempotencia del alta y del replay, transiciones con estado de origen y motivos obligatorios.
  - Conformidad con CAPA, también cuando la CAPA está cancelada.
  - Sin IDOR en fotos, PDF ni acciones de registros.
  - Revocación de credenciales y `sessionsValidFrom`.
  - Regla única de «vencida» (`equipmentStatus`), compartida por servidor, panel, lista, ficha y app.
  - El borrador de pautas cubre todo lo editable, y la matriz de pautas es accesible con teclado.
  - La tabla de paridad ruta → permiso → menú → manifest está completa para los 18 permisos `mant:*`, sin enlaces a rutas retiradas.

## Advertencias de automatización

- **404 de fotos.** `/api/mantencion/fotos/dev-mant-photo-*` responde 404 porque las fotos mock de `bodega_dev` no tienen archivo en `STORAGE_PATH`. No es un defecto del producto; lo que sí se ve es la falta de fallback (REG-11).
- **Capturas.** La captura de página completa exige agrandar el viewport, porque el scroll vive en `[data-shell-scroll]`.

## Brechas de cobertura

- **App del mecánico.** No se abrió en el navegador: entrar con el usuario QA crea credenciales de dispositivo. Todos los APP-n salen de lectura, y APP-8 y APP-10 necesitan un teléfono.
- **Un solo rol.** Sólo se recorrió como administrador global. Faltan jefe de mantención, supervisor, admin. de contrato y mecánico, y de ellos dependen PAN-5, PER-5 y PER-7.
- **Sin mutaciones.** No se crearon, anularon ni revisaron OT o registros. Los flujos OT-1, OT-5, OT-6, REG-1, REG-2, EQ-1, EQ-2 y EQ-3 están confirmados por lectura, no reproducidos.
- **Sin descargas.** No se descargaron ni inspeccionaron PDF ni Excel.
- **Sin puertas.** No se corrieron typecheck, lint, tests ni E2E: no hubo cambios de código.

## Orden sugerido de arreglo

1. **App del mecánico (P1):** APP-3, APP-2 y APP-1, más APP-4 y APP-5. Son los que pueden dejar trabajo de terreno sin enviar o con evidencia equivocada.
2. **Errores invisibles y CAPA:** EQ-1, OT-1 y OT-5.
3. **Cifras y navegación del Panel y de Registros:** PAN-8, PAN-1, PAN-6, REG-4, REG-7, REG-3 y PER-1. Son baratos y están verificados en navegador.
4. **Decisiones del usuario antes de tocar código:**
   - Costo de la OT (OT-4): ¿se queda? ¿quién lo carga y cuándo?
   - Alcance de la «baja» de Mantención (EQ-4).
   - Política del lote de revisión (REG-5, REG-25).
   - Visibilidad de la hoja de vida tras un traslado (REG-23).
5. **Integridad de la identidad del equipo:** EQ-2, EQ-3, EQ-18 y EQ-7.
6. **P3** por tandas de área.
