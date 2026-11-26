# Mantención: auditoría de lógica y UI/UX (2026-11-26)

Auditoría de **sólo lectura** del submódulo de Mantención de Control operacional sobre `main` `edc9b2fb3`. **No se cambió código.** Es la cuarta auditoría del área; parte de la del 2026-11-22 (`mantencion-auditoria-2026-11-22.md`, sobre `01aa7e71a`) y audita lo que entró desde entonces:

- las tres tandas de arreglos de esa auditoría;
- el Panel con pestañas Planificación, Camiones y Máquinas;
- la unidad km/h por equipo (migración 0402);
- el Historial de mantenciones unificado;
- las notas de pedido y los repuestos con stock reservado por OT (migración 0403, fusionado hoy).

> **Estado (26-11, más tarde):** los arreglos decididos quedaron en la rama `fix/mantencion-encontrabilidad`, sin desplegar: OT4-6, OTN-6, REG4-1, NP4-7 y más. Siguen abiertos OT-1 y NP4-1. Detalle y verificación en [mantencion-arreglos-2026-11-26.md](mantencion-arreglos-2026-11-26.md).

Alcance: la jefatura en `/mantencion/*`, la pestaña Mantención de la ficha `/flota/[id]/mantencion`, los impresos y la app del mecánico `/m/mantencion`.

## Método

- **Código:** siete líneas de lectura en paralelo (subagentes Sonnet, sin permiso de edición), con trazado de llamadas: OT; registros e historial; equipos, pautas y unidad; Panel; notas de pedido y repuestos; app del mecánico; permisos, navegación y conformidad de UI.
- **Verificación propia:** releí en el código los hallazgos de más peso y reproduje seis con acciones reales.
- **Navegador:** `next dev` de `main` en `localhost:3022`.
  - **No se usó `bodega_dev`.** El clasificador de permisos bloqueó el inicio de sesión con la cuenta QA de `.env.qa`, y la sesión guardada en `playwright/.auth/` ya no servía.
  - En su lugar: una base E2E **desechable**, `bodega_e2e_auditmant` (contenedor `bodega-e2e-postgres`), creada con `npm run e2e:setup` y con los usuarios públicos del fixture.
  - Datos sintéticos, todos `QA_`/`mock-`: 99 equipos activos, 795 registros firmados, 80 OT en los 7 estados, 6 notas de pedido con stock y reservas, 30 respuestas de formularios, 204 fotos.
  - El envío de correo iba anulado (clave vacía) y el servidor escuchaba sólo en localhost.
- **Recorrido:**
  - 52 rutas en escritorio (1440×900) como jefe de mantención, con consola, red, desborde y axe WCAG 2.1 A/AA;
  - 18 rutas en móvil (390×844);
  - 18 rutas como supervisor de mantención, como administrador de contrato (ambos de Biodiversa) y como mecánico;
  - la app del mecánico (entrada, PIN, inicio, hoja de la OT, «Pedir repuestos»).
- **Verificación de cada hallazgo:**
  - **Reproducido:** hecho en la app y leído en la base o en pantalla.
  - **Navegador:** visto en pantalla.
  - **Lectura ✓:** trazado por la línea y releído por mí.
  - **Lectura:** trazado por la línea, sin releer.
  - **Sospecha:** falta reproducirlo; se dice cómo.

Capturas (221): `audit/mantencion-2026-11-26/` (carpeta ignorada por git). Guiones para repetir el recorrido: `~/backups-dev/mock-2026-11-26-e2e-auditmant/`.

## Resumen

| Severidad | Con ficha en esta auditoría |
|---|---|
| P0 | 0 |
| P1 | 5 (4 nuevos y OT-1, que viene del 16-11) |
| P2 | 53 |
| P3 | 55 |

Además siguen abiertos 97 identificadores de las auditorías del 16-11 y del 22-11. El detalle de cada hallazgo, uno por uno, está en [mantencion-hallazgos-detallados-2026-11-26.md](mantencion-hallazgos-detallados-2026-11-26.md).

De los P1 del 22-11 se corrigieron siete: OTN-1, APPN-1, REGN-1, EQ-1, APP-1, APP-2 y APP-3. Sigue OT-1.

Lo más importante:

1. **«Editar solicitud» borra la descripción y los ítems de la reparación** al cambiar sólo el tipo de acción (OT4-6, reproducido). Es justo el camino para corregir la clasificación antes del Panel Trinorma.
2. **El ingreso a taller desde el PC guarda «8.100» horas como 8,1** y no compara con la lectura anterior (OTN-6, reproducido).
3. **Anular una OT que ya entró a taller hace desaparecer su trabajo firmado** del Historial, del Panel y de la línea de tiempo (REG4-1, reproducido), y deja sus notas de pedido en «Pendientes» (NP4-7, reproducido).
4. **Notas de pedido** (aún sin desplegar): caminos sin salida y cifras que no cuadran.
   - Una línea cuya compra fue rechazada queda sin botones (NP4-1).
   - «Pendientes» y la cifra del Panel no cuentan las notas a medio resolver (NP4-2).
   - Sacar de bodega menos de lo pedido cierra la línea y el faltante no se puede comprar (NP4-3).
   - Liberar una reserva no se refleja en la nota (NP4-4), y la nota tampoco se puede anular después (NP4-6).
5. **Panel:** el período no filtra Planificación (PAN4-6) y cambiar de pestaña borra período y faena (PAN4-9). «Máquinas» lista camiones (PAN4-14). Un equipo trasladado o una faena cerrada rompen enlaces y filtros (PAN4-1, PAN4-2, PAN4-3).
6. **UI:** el Historial se desborda en el teléfono, hay ejes con las etiquetas encimadas, y el vocabulario de repuestos se contradice («Sacar de bodega» reserva; la línea queda «En bodega» y «Sacada de la bodega» a la vez).

Lo que está sano: las 52 rutas responden sin errores de consola ni de red, con un solo `h1`, sin desborde en escritorio y con **0 violaciones de axe**. El alcance por faena se cumple en los tres perfiles acotados, y los invariantes de stock (reservado ≤ existente, bloqueos, idempotencia) resistieron el trazado.

---

## P1

### OT4-6 · Bug de producto: «Editar solicitud» borra la descripción y los ítems al cambiar el tipo de acción
- **Dónde:** `components/mantencion/jefatura/ot/ot-request-fields.tsx:134-137` (elegir el tipo aplica `checksForActionType`, que desmarca Reparación) y `:53-66` (`requestPayload` manda `repairDescription: null` y `annexItems: []` si Reparación está desmarcada).
- **Reproducido** con `OT-CHO-0015` (asignada, sin tipo, Reparación marcada):
  - Antes: descripción «Fisura en soporte de balde.» y un trabajo anexo.
  - «Más acciones» → «Editar solicitud» → Tipo de acción «Preventiva» → «Guardar cambios».
  - Después, en la base: `repair = false`, `maintenance = true`, `repair_description = NULL`, 0 ítems.
- **Por qué pesa:** una OT nace sin tipo y con «Reparación» marcada (OTN-7). Quien la clasifica como preventiva pierde lo pedido sin aviso; el campo desaparece del formulario antes de guardar. Queda sólo en el evento del historial, y la ficha no muestra el antes y el después.
- **Arreglo:** en edición, elegir el tipo no toca las casillas. Y nunca enviar `null` por un campo que quedó oculto: conservar el texto o pedir confirmación.

### OTN-6 (previo, ahora reproducido) · Bug de producto: el ingreso a taller guarda «8.100» h como 8,1
- **Dónde:** `components/mantencion/jefatura/ot/ot-action-dialogs.tsx:153-156` (`Number(raw.replace(",", "."))`); `work-orders/transitions.ts:120-168` (`resolveEntry` no mira la lectura anterior).
- **Reproducido** con `OT-STF-0024` (equipo en horas, última lectura firmada 7.501 h):
  - «Registrar ingreso» con horómetro «8.100» → se acepta; en la base `entry_hourmeter = 8.1`.
  - Con «1.234.567» el botón queda desactivado sin ningún mensaje.
- **Por qué pesa:** esa lectura es la que muestran el Historial, la pestaña Camiones/Máquinas y el Excel. La app y el registro desde el PC sí usan `parseReadingInput` y `checkReading`.
- **Arreglo:** el mismo parseo y la misma comparación con la lectura anterior que la app.

### REG4-1 · Bug de producto: anular una OT en taller hace desaparecer su trabajo firmado
- **Dónde:** `lib/services/mantencion/maintenance-work.ts:318` (una OT anulada no cuenta) y `:397-399` (un registro con OT nunca cuenta por sí mismo, ni en el Panel ni en la línea de tiempo); `work-orders/transitions.ts:482-497` (`voidWorkOrder` no mira registros enlazados).
- **Reproducido** con `OT-BIO-0005` (en taller, con la correctiva firmada `MC-BIO-0018`):
  - Antes: Historial de 12 meses, 100 trabajos; `KA-140` con una fila.
  - Se anula la OT desde «Más acciones».
  - Después: 99 trabajos y `KA-140` sin filas. `MC-BIO-0018` sigue vigente y enlazado a la OT anulada, y ya no aparece en Historial, Panel, línea de tiempo ni Excel.
- **Arreglo:** el registro cuenta como trabajo propio si su OT está anulada o no entró a taller. El diálogo de anular debería decir cuántos registros y notas quedan enlazados.

### NP4-1 · Hallazgo funcional: una línea «en compra» cuya compra fue rechazada queda sin acciones
- **Dónde:** `components/mantencion/jefatura/notas-pedido/parts-note-detail.tsx:96,134` (los botones exigen `resolution === "pendiente"` y la nota abierta) frente a `parts-notes/status.ts` (`isResolvableLine` sí permite volver a resolver una compra muerta). `unlinkNoteItemsFromRequestTx` sólo se llama al cancelar o borrar la solicitud o al quitar el ítem del borrador (`cancel-request.ts:118`, `requests-delete.ts:113`, `persist-draft.ts:244`): un rechazo en aprobaciones no la llama.
- **Escenario:** jefatura pulsa «Comprar» y quien aprueba rechaza la solicitud o el ítem. La nota, sin otras líneas pendientes, pasa a «Cerradas». La línea se ve «Pedido» pero sin botones, el mecánico sigue esperando y nadie recibe aviso.
- **Arreglo:** desvincular también al rechazar, o tratar «en compra con todas sus compras muertas» como pendiente en la pantalla y en el estado de la nota.
- **Verificación:** lectura ✓. No se reprodujo (pide el flujo de aprobación).

### P1 previo que sigue
- **OT-1:** anular una OT nacida de un hallazgo deja la CAPA trabada (`transitions.ts:482-501`; `runs.ts:~892` rechaza derivar de nuevo). Lectura.

---

## P2

### Notas de pedido y repuestos (código nuevo, sin desplegar)

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| NP4-2 | **«Pendientes» y «Notas de pedido por resolver» del Panel sólo cuentan notas sin ninguna línea resuelta.** `NP-2026-0002`, con una línea pendiente, está en «En gestión»; el Panel dice 2 y hay 3 notas con líneas por resolver. Una nota con todo «en compra» queda «Cerrada». El texto de «En gestión» dice lo contrario. | `parts-notes/query.ts:26`, `status.ts:18-22`, `panel/hoy-tab.tsx:130` | «Por resolver» = notas abiertas con líneas pendientes; decidir el nombre del estado con compras en curso | **Navegador** + lectura ✓ |
| NP4-3 | **Sacar de bodega menos de lo pedido cierra la línea.** `NP-2026-0003`: pedían 4, había 2 libres; la línea queda «En bodega · Llegó 2» y la nota «Cerrada». Los 2 que faltan no se pueden comprar ni rechazar, y nada los marca. | `parts-notes/resolve.ts:58,93`, `request-link.ts:59` | Exigir la cantidad completa o dejar el saldo pendiente | **Reproducido** |
| NP4-4 | **Liberar una reserva no cambia la nota.** Tras liberar las 2 unidades, la línea sigue «En bodega · Llegó 2 · Usado 0». La reserva queda `activa` con cantidad 0,00. | `parts-notes/lines.ts:81-98`, `parts/allocations.ts:280`, `parts/release.ts` | Calcular «llegó» con todas las rebajas de la reserva | **Reproducido** |
| NP4-6 | **La nota no se puede anular aunque se libere la reserva.** El mensaje dice «libera esa reserva antes de anular la nota»; con la reserva ya liberada responde lo mismo. | `parts-notes/resolve.ts:34,170-171` | Que la anulación mire la reserva, o que liberar todo devuelva la línea a pendiente | **Reproducido** |
| NP4-7 | **Las notas de una OT anulada o cerrada siguen abiertas.** Tras anular `OT-BIO-0005`, `NP-2026-0001` (equipo detenido) y `NP-2026-0005` siguen en «Pendientes» y ofrecen «Sacar de bodega». | `work-orders/transitions.ts:474,497` | Cerrar o anular las notas abiertas con la OT | **Reproducido** |
| NP4-5 | Anular una recepción o guía después de liberar o ajustar la reserva falla con «Ya se usó en una orden de trabajo», sin que nada se haya usado. | `parts/allocations.ts:229,259-272` | Sólo decir «ya se usó» si hay consumo | Lectura |
| NP4-8 | Tras un traslado, la faena de destino ve la nota pero no puede comprarla: el borrador responde «La línea ya no existe». | `parts-notes/access.ts:50-56`, `linked-parts-note.ts:55` | La misma regla para ver y para comprar | Lectura |
| NP4-9 | «Por conciliar» dice «0 libres ahora · No alcanza para lo declarado» cuando la compra llegó reservada para esa OT y «Descontar ahora» sí funciona. | `conciliation-list.tsx:46`, `parts/conciliation.ts:215-217` | Mostrar libres + reservado para la OT | Lectura |
| NP4-10 | El Excel de la OT parte en dos filas lo pedido en texto libre y lo reservado con producto. | `work-orders/export-parts.ts:111-124` | Reusar `loadLineStates` | Lectura |
| NP4-11 | La diferencia del cotejo de una guía no rebaja stock ni reserva: llegan 3 y el mecánico ve 5 disponibles. La fuente `cotejo` existe y nadie la escribe. | `dispatch-guides.ts:1133`, `parts/types.ts:23` | Rebajar con `cotejo` o mostrar la diferencia en la OT | Lectura |
| UI4-1 | El interruptor del submódulo «Notas de pedido» no corta el envío desde el teléfono: `/api/mantencion/sync/notas-pedido` cuelga del submódulo Registros. | `module-toggles-routes.ts:83` | Prefijo propio antes del genérico | Lectura ✓ |
| NAV-3 | **El vocabulario de repuestos se contradice.** El botón «Sacar de bodega» reserva («queda reservado para esta orden»), el aviso dice «Se apartaron…», la línea queda con la insignia «En bodega» y el texto «Sacada de la bodega por…», y la OT dice «Reservados sin usar» y «Liberar». En la misma tarjeta, «Repuestos pedidos» son solicitudes de compra («Sin solicitudes de compra»), justo debajo de «Notas de pedido». | `note-line-actions.tsx`, `parts-note-detail.tsx:24`, `ot-sections.tsx:299,314,320`, `resolve.ts` | Un verbo: «Reservar de bodega» → «Reservado (2)»; «Solicitudes de compra» en vez de «Repuestos pedidos» | **Navegador** |
| NAV-4 | El historial de la OT dice «Nota de pedido resuelta» cuando se rechazó o se reservó **una línea**, con la nota todavía en gestión, y no dice qué repuesto ni cuánto. «Repuestos reservados para la orden» tampoco dice cuáles. | `components/mantencion/jefatura/ot/ot-labels.ts:31-32`, `work-orders/export.ts:56` | «Línea reservada: 2 × …» y «Línea rechazada: …» | **Navegador** |
| NAV-7 | El Catálogo de repuestos y su ficha no muestran existencias ni reservas. Con stock en Cabrero y 2 unidades reservadas, la ficha dice «Todavía no se ha comprado». | `app/(app)/mantencion/repuestos/**` | Existencia, reservado y libre por faena, o un enlace a Bodega | **Navegador** |

### Órdenes de trabajo

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| OT4-5 | «Tipo de acción: Correctiva» se muestra igual si fue declarado o deducido de la casilla. En la base de prueba, 77 de 80 OT no tienen tipo; `OT-CAB-0007`, sin tipo y con sólo Reparación marcada (como otras 56), se ve «Correctiva». El «sin tipo» tiene tres nombres: «Sin definir», «Sin clasificar» y «No informado». Con OTN-7 (sigue), infla las correctivas. | `work-orders/query.ts:419`, `ot-sections.tsx:172`, `ot-request-fields.tsx:131`, `action-type.ts:16`, `ot-aside.tsx:39` | Rotular lo deducido («según la casilla») y un solo nombre | **Navegador** + BD |
| OT4-3 | «Corregir ingreso» deja editar la entrega estimada con el texto «Se puede cambiar después», y el servidor la rechaza. El mensaje manda a «Cambiar fecha estimada»; el menú dice «Cambiar entrega estimada». | `ot-action-dialogs.tsx:226`, `transitions.ts:196-198` | Campo de sólo lectura en modo corrección; un solo nombre | **Navegador** + lectura ✓ |
| OT4-1 | El aviso «Esta orden fue devuelta» queda con el motivo viejo tras una reapertura, o no aparece si nunca se rechazó; el teléfono recibe `lastRejection: null`. | `ot-sections.tsx:462-471`, `catalog-items.ts:46,90`, `transitions.ts:523` | Leer el último evento `rejected` o `reopened` | Lectura |
| OT4-2 / APP4-10 | Una OT abierta conserva la unidad sellada al crearla. Si el equipo pasa a horas, la ficha y la app piden kilómetros y el Panel lee el horómetro, que queda vacío. Latente: producción no tiene OT vigentes. | `transitions.ts:121-123`, `query.ts:415`, `looker/corrective.ts:126`, `ot-entry-form.tsx:60-62` | Usar la unidad vigente mientras no haya ingreso | Lectura |
| OT4-4 | El Excel «Historial» de la OT dice «Solicitud editada» para una corrección de clasificación y no trae qué cambió. | `work-orders/export.ts:38-58,194` | Reusar `otEventLabel` y una columna «Detalle» | Lectura |
| NAV-8 (UI-1) | **«Por asignar» muestra 5 de 9 columnas sin información** (Estado igual en todas, «Sin asignar», Ingreso, Entrega estimada, Días en taller) y no muestra cuándo se pidió ni qué se pidió, que es lo que hace falta para asignar. | `ot-table.tsx:109-118` | Columnas por pestaña: «Pedida», antigüedad y problema | **Navegador** |
| OTN-13 | La ficha de un equipo que ya está en taller ofrece «Crear orden de trabajo» como acción principal, sin avisar de la OT abierta. | `equipment-detail-view.tsx`, `work-orders/create.ts:~246-290` | Avisar y enlazar la OT abierta | **Navegador** + lectura |
| OTN-15, UI-3, UI-8 | «Días detenido –» con la OT 7 días en taller; dos tarjetas vacías («Trabajos anexos», «Mantenciones solicitadas») con «No hay líneas en esta lista.»; rayas «—» y «–» mezcladas en la misma tarjeta. | `ot-sections.tsx:173-177` | Ver el informe del 22-11 | **Navegador** |
| NAV-9 | La ficha del equipo dice «Última lectura 4.869 h (10-11)» y «faltan 231 h», y su línea de tiempo muestra el ingreso de la OT con 4.933 h (25-11). La lectura del ingreso no cuenta como lectura del equipo. | `fleet.ts` (`recentRecords`) | Decidir si el ingreso a taller actualiza la lectura | **Navegador** |
| OTN-2, OT-2, OT-6, OT-7, PER-2, PER-3 | Horas hombre sólo desde el PC; tramos de taller; «Corregir ingreso» con taller inactivo; teléfono adelantado; alcance latente de `manage`; Excel de OT sin `mant:export`. | Ver el informe del 22-11 | — | Lectura (siguen) |

### Registros e Historial

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| NAV-1 | **El Historial se desborda en el teléfono.** A 390 px la página tiene 49 px de scroll horizontal por el selector de tipo (423 px, sin envolver), y 549 px en «Equipos por mes». | `app/(app)/mantencion/registros/historicos/page.tsx:41` (selector «Todos / Correctivas / …»), `components/mantencion/historial/work-matrix.tsx` | Envolver o scroll propio; la matriz dentro de su contenedor | **Navegador** (medido) |
| REG4-2 | El importador de pantalla no guarda horas, especialidades ni la marca de prueba. La ficha muestra «8»; el Historial, el Excel y «Horas hombre» del Panel cuentan «sin dato». | `historical-import.ts:164-170`, `maintenance-work.ts:226` | Parsear como el consolidado | Lectura ✓ |
| REG4-3 | «Por revisar», sus contadores y el lote incluyen registros de un equipo trasladado que el lector no puede revisar: «N no se encontraron». | `records-query.ts:25`, `record-selection.tsx:44-52` | Exponer `canAct` y excluirlos | Lectura |
| REG4-5 | Desde la pestaña «Todos», abrir un registro y volver con la miga cae en «Por revisar»: el detalle llega con `?lista=revision%3Dtodos` y el enlace de vuelta lo pierde. | `records-filters.ts:195-203`, `registros/[id]/page.tsx:134` | Conservar `revision` | **Navegador** |
| REG4-4 | «Días en taller» ignora los «Días detenido» que declara el formulario; la ficha muestra ambos sin decir cuál manda. | `maintenance-work.ts:258` | Decidir la regla | Lectura |
| UI4-2 | **El Historial de mantenciones no tiene ítem de menú.** Se llega por un botón de Registros; el menú marca «Registros firmados» y la miga cuelga de ahí. | `modules/mantencion-equipos/manifest.ts:78-130` | Ítem propio | **Navegador** |
| UI4-4 | Registros e Historial dicen «Todas las faenas» a quien sólo ve las suyas; OT, Equipos y Notas dicen «Todas tus faenas». | `records-filters.tsx:97`, `history-filters.tsx:85` | `allWorksitesLabel` | Lectura ✓ |
| REG-6, REG-7, REG-15, REGN-4 | La OT del registro es texto, no enlace (**navegador**); el buscador no encuentra folio ni «ka91»; la franja «Indicadores» cambia con la pestaña (**navegador**); «Observados» no distingue con y sin respuesta. | Ver el informe del 22-11 | — | Siguen |

### Equipos y pautas

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| EQ4-1 | Los registros en la unidad anterior siguen bloqueando la lectura inicial y validando la preventiva declarada: un camión pasado a horas con registros en km no deja escribir la lectura inicial en horas. Latente en producción. | `equipment-resolve.ts:245-256,442-450,509` | Filtrar esos agregados por la unidad vigente | Lectura ✓ |
| EQ4-2 | **«Sin lecturas» no explica qué falta ni ofrece salida.** 21 equipos en la base de prueba; «Falta completar» no los cuenta. En producción son los 62 camiones pasados a horas. | `equipment-read-sections.tsx:77-82`, `equipos/page.tsx:95-113` | Texto de apoyo y «N equipos sin lectura» con enlace | **Navegador** |
| EQ4-3 | La importación no dice en qué unidad quedará cada equipo y la hoja «Listas» dice «kilómetros» para camiones que nacen en horas: 250.000 km quedarían como 250.000 h. | `equipment-import.ts:379,584-601,626` | Mostrar la unidad resultante por fila | Lectura |
| EQ4-4 | «Falta completar» dice «5 vehículos… Sólo falta su marca y su pauta» cuando los 5 están bloqueados (sin código o con patente inválida). Los bloqueos dicen «asígnalo en Vehículos» sin enlace. | `equipos/page.tsx:70,107`, `fleet-incorporation-panel.tsx:88,158` | Contar sólo los incorporables; enlazar el vehículo | **Navegador** |
| UI4-3 (EQ-18) | «Incorporar desde la flota» sigue sin buscador: la TopBar lo oculta y el panel espera su texto. | `top-bar.tsx:81`, `fleet-incorporation-panel.tsx:49,79-84` | Excluir `incorporar` del patrón | **Navegador** |
| UIN-1, PER-7 | La cabecera de la ficha tiene cinco acciones (tres filas en móvil). La miga dice «Mantención › Equipos» y el menú marca «Flota › Vehículos». | `equipment-detail-view.tsx:283-287`, `nav-items.ts:187-205` | Una acción principal + «Más acciones»; alias del menú | **Navegador** (siguen) |
| Hoja de vida | La ficha repite los mismos registros en la línea de tiempo y en la tabla «Hoja de vida»; «7 h de taller» son horas hombre de trabajos que no pasaron por taller; «Vigente» y «Revisado» comparten columna. | `equipment-timeline.tsx`, `equipment-life-section.tsx` | **En curso en otra rama** (`fix/mantencion-hoja-vida-consistencia`) | **Navegador** |
| EQN-2, EQN-3, EQ-2, EQ-3, EQ-4, EQ-6 | «Nuevo equipo» traslada sin `flota:transfer`; identidad sin la regla del índice; cambio de tipo conserva la lectura; reescribe datos del vehículo; baja sin confirmar; importación con marca desactivada. | Ver el informe del 22-11 | — | Lectura (siguen) |

### Panel

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| PAN4-6 | **El período no filtra Planificación.** Con «Noviembre 2026» y con «1 ene – 31 mar» el contenido es idéntico. Los vacíos dicen «en el período». | `looker/planning.ts:60,76-101`, `filter-bar.tsx:107` | Ocultarlo ahí o decir que es el estado de hoy | **Navegador** |
| PAN4-9 | **Cambiar de pestaña borra período y faena:** los enlaces llevan sólo `?pestana=`. | `panel-tabs.tsx:11-13,35` | Conservar `desde`, `hasta` y `faena` | **Navegador** |
| PAN4-14 | **«Camiones» y «Máquinas» ya no describen su contenido:** se reparten por km u horas, y «Máquinas» lista camiones y tractocamiones. | `panel-tabs.tsx:11-14`, `looker/filters.ts:112-116` | «Por kilómetros» y «Por horas» | **Navegador** |
| PAN4-1 | Pulsar una patente o una barra fija la faena **actual** del equipo y esconde lo hecho en la faena anterior: la matriz y los trabajos quedan en cero. | `looker/filters.ts:166-175` | Con el equipo elegido, no pisar la faena | Lectura ✓ |
| PAN4-2 | En «Hoy», el enlace de «Equipos con más correctivas» a un equipo trasladado se ignora en silencio. | `trinorma-sections.tsx:270`, `maintenance-work.ts:713` | Validar contra el alcance, no contra la faena elegida | Lectura |
| PAN4-3 | Una faena cerrada con historial no se puede elegir, y sus barras enlazan a un filtro que se descarta. Pacífico y Fábrica de Puertas se cerraron el 25-11. | `panel.ts:100-105`, `hoy-tab.tsx:66`, `looker/resolve.ts:292` | Ofrecer las inactivas con historial, rotuladas | Lectura |
| PAN4-5 | «Checklist de pauta (formularios)» no aplica el corte del 01-12 ni cuenta registros nativos; Camiones y Máquinas sí. Desde el 01-12 las dos mitades darán porcentajes distintos. | `maintenance-work.ts:736-748` frente a `looker/preventive.ts:128,163-164` | Misma regla o rótulo «sólo formularios» | Lectura ✓ |
| PAN4-4 | Los formularios importados por pantalla (tipo nulo) cuentan como correctivas en «Hoy» y no aparecen en Camiones ni Máquinas. | `historical-import.ts:167`, `looker/corrective.ts:108` | Misma regla; llenar `action_type` al importar | Lectura |
| PAN4-7 | «Próxima mantención» dice «Sin pauta» a equipos que tienen pauta y les falta la lectura o la preventiva. | `planning-tables.tsx:148-149` | Mostrar el estado real | Lectura ✓ |
| PAN4-8 | Los chips Mes, Mecánico y Frecuencia parecen globales y sólo mueven la mitad Preventivo. | `looker/corrective.ts`, `filters.ts:300-336` | Aplicarlos o rotular el alcance | Lectura |
| NAV-2 | **Ejes con las etiquetas encimadas:** «Trabajos de mantención por tipo» del Historial (12 meses: «dic 2025ene 2026feb 2026…») y «Horas y registros por equipo» de Camiones/Máquinas (ilegible). | `app/(app)/mantencion/panel/indicators-charts.tsx`, `components/mantencion/panel/looker/corrective-panel.tsx` con `components/charts/hours-records-combo-chart-lazy.tsx` | Quitar el año repetido, rotar o espaciar | **Navegador** |
| PAN-5, PANN-12, PANN-13 | Tono de alerta a quien no puede revisar; el Excel de «Hoy» no valida el rango; «Reportes de equipos» sin el permiso de Inspecciones. | Ver el informe del 22-11 | — | Lectura (siguen) |

### App del mecánico

| ID | Hallazgo | Dónde | Arreglo | Verif. |
|---|---|---|---|---|
| APP4-2 | **«Crear registro corregido» pierde el vínculo con la OT.** El borrador nace sin OT: no ofrece los repuestos reservados y la OT sigue sin poder terminarse. | `record-actions.tsx:183`, `mant-app.tsx:123-128`, `contracts.ts:441` | Viajar `workOrderId` | Lectura |
| APP4-1 | Teléfono compartido: A entra con su contraseña y la app abre como B, la última cuenta activa. | `bootstrap.ts:63,96-98` | Un inicio de sesión explícito gana | Lectura ✓ (no comprobé si antes pide el PIN de B) |
| APP4-3 | El reintento no se reinicia al volver la señal y no hay «Enviar ahora»: tras un wifi sin salida, el primer elemento puede esperar 15 min. | `queue.ts:24-26,101`, `sync-engine.ts:71-75` | No contar los fallos de red; reiniciar con `online` | Lectura |
| APP4-7 | Un registro rechazado por «faltan fotos en el teléfono» entra en bucle: al corregir, las fotos se ven «Lista» sin imagen y vuelve a rechazarse. | `sync-engine.ts:106-123`, `flow-record.ts:186,214`, `photo-slot.tsx:50,55` | Quitar los ids sin imagen al abrir el borrador | Lectura |
| APP4-4, APP4-5 | El reloj del teléfono mal puesto no se detecta (la app ya mide la hora del servidor); lo enviado que no es registro se compara con el reloj del teléfono y se duplica en pantalla. | `freshness.ts:71`, `queue.ts:113-114`, `ot-model.ts:124-129` | Avisar del desfase; guardar `receivedAt` del servidor | Lectura |
| APP4-6 / OT4-7 | Tras un traslado, la app, el Excel y el PDF siguen mostrando la faena de imputación: «Equipo de otra faena» para un equipo que ya está en la faena del mecánico. | `catalog-items.ts:58,102`, `work-orders/export.ts:~104` | Usar la faena actual | Lectura |
| APP-4, APP-6 | `needs_login` hasta 23 días tras un 403; cualquier 2xx se da por enviado sin mirar el cuerpo. | Ver el informe del 22-11 | — | Lectura (siguen) |

---

## P3 (por área, compacto)

**Notas de pedido y repuestos**
- **NAV-5:** la ficha de la nota no muestra su estado, salvo el aviso de anulada; la línea de una nota anulada sigue diciendo «Pedido» (navegador).
- **NAV-6:** «Sacar de bodega» está activo con 0 libres si la línea es del catálogo y desactivado con su motivo si es texto libre (navegador).
- **NAV-13:** «Se apartaron 1 de…» (concordancia).
- **UI4-10:** la TopBar filtra sólo las 50 notas de la página; `?q=` no tiene quien lo escriba.
- **UI4-11, UI4-12:** «NP» sin `title`; el buscador de la TopBar aparece en las fichas de nota y de repuesto, donde no filtra nada (navegador).
- **NP4-12:** un error técnico queda como texto de «pendiente de conciliar».
- **NP4-13:** la antigüedad cuenta desde la llegada al servidor, no desde el pedido.
- **NP4-14:** `reservedQuantityTx` sin uso; comentario de `spare-parts-catalog.ts:7` desactualizado.
- **NP4-15 (sospecha):** «Terminar» no espera a una nota posterior al último registro.
- **APP4-11:** el pedido del teléfono sólo admite enteros y la unidad fija «unidad»: «20 L de aceite» llega como «20 unidad» (navegador).
- **UI4-8:** `mant:np:create` dice «desde la app o el PC» y sólo existe la app; el mecánico no ve la bandeja en el PC.

**OT**
- **OT4-8:** «Registrar ingreso» muestra Kilómetro y Horómetro; el que no corresponde se descarta sin aviso (navegador).
- **OT4-7:** el aviso de traslado sale también en OT cerradas y anuladas.
- **OT4-9:** dos tablas de rótulos de evento («Rechazada», «Devuelta a taller», «volvió a taller»).
- **OT4-10 (sospecha):** «Editar solicitud» recrea los ítems con ids nuevos.
- **OT4-11:** reabrir no avisa que lo reservado se liberó.
- **OT4-12:** «Fecha de la orden» sin tope.
- **NAV-11:** la hora del ingreso es un `<input type="time">` nativo: muestra «04:31 p.m.» con el navegador en es-CL, y el resto de la app usa 24 h.
- **NAV-12:** «Editar solicitud» se cierra con Esc sin preguntar aunque haya cambios; su ayuda dice «los costos se imputan a ella» y la OT ya no lleva costo.
- **UI-2:** «Interno · Taller interno» (también en la app).
- **UI4-16:** las pestañas intermedias vacías no ofrecen salida.
- **Siguen:** OTN-8, OTN-9, OTN-10, OTN-12, OTN-14, OTN-17.

**Registros e Historial**
- **NAV-16:** en «Por revisar», la columna «Estado» mezcla «2 ítems no realizados» con «Cerrada» (el estado de la correctiva).
- **NAV-14:** en el teléfono, Registros ocupa una pantalla entera con títulos, cifras y filtros antes del primer registro; el Historial abre con los gráficos desplegados (navegador).
- **REG4-6:** «Lectura anterior» mezcla unidades tras un cambio de km a horas.
- **REG4-7:** observar no avisa del éxito; «Crear registro corregido» sólo existe en el diálogo posterior a anular.
- **REG4-8:** «Mismo criterio que el Panel» es falso con un equipo elegido; «(cerrada)» frente a «(inactiva)»; dos «Más filtros» distintos; el Excel ordena distinto que la pantalla y antepone `'` a los textos que empiezan con `-`.
- **REG4-9:** una respuesta con fecha futura queda fuera sin aviso; una sola fila sin correo aborta el archivo.
- **REG4-10:** textos que sólo hablan del teléfono; `countsFromForms` y `pendingObservations` sin uso.
- **Historial:** tres segmentados, cinco filtros y dos acciones en la misma pantalla; la lectura del formulario sale cruda («150000»).
- **Siguen:** REG-1 a REG-5, REGN-6, REGN-12, REGN-15, REGN-16, REGN-18, UI-4.

**Equipos y pautas**
- **EQ4-5:** incorporar crea la marca aunque la fila falle.
- **EQ4-6:** el Excel de equipos redondea las horas a entero.
- **EQ4-7:** «Nueva pauta» pierde el nombre tras un error.
- **EQ4-8:** «Asignar equipos» con una selección vieja suelta equipos.
- **EQ4-9, EQ4-10:** textos de aceites y de «Quitar intervalo».
- **EQ4-11 (sospecha):** la estimación GPS no se valida sin lectura oficial.
- **UI4-13:** «Todos los estados» frente al chip «Mantención».
- **UI4-6:** «Dispositivos» valida el submódulo de Equipos (`dispositivos/page.tsx:18`).
- **Siguen:** EQ-7, EQ-8, EQ-11, EQ-14, EQ-15, EQ-17, EQ-21, EQN-5, EQN-7, EQN-10, EQN-13, UI-9, UI-11.

**Panel**
- **NAV-10:** en Camiones y Máquinas la columna derecha queda vacía unos 2.500 px mientras la izquierda sigue; «+7.833 % vs. período anterior» en «Días fuera de servicio».
- **PAN4-10:** el gráfico por faena y mecánico muestra los 12 mejores y oculta los peores.
- **PAN4-11, PAN4-12:** OT sin tipo con las dos casillas; conductores y foto cuentan registros anulados.
- **PAN4-13 (sospecha):** pautas en km de equipos hoy medidos en horas caen en «Máquinas».
- **PAN4-15:** «Horas» son horas hombre junto al horómetro; recortes sin aviso; fechas del corte escritas a mano en `work-tab.tsx:45`.
- **PAN4-16:** cada pestaña repite las mismas consultas.
- **Siguen:** PANN-6, PANN-7, PANN-10, PANN-15, PANN-16.

**App del mecánico**
- **APP4-8:** la pantalla de error de arranque no tiene «Reintentar».
- **APP4-9:** «Equipos al…» no se actualiza con un 304.
- **APP4-12:** reintento eterno sin aviso por elemento.
- **APP4-13:** `discardWorkshopFor`, `removeAccount` y `deletePhoto` sin uso.
- **Siguen:** APP-9 a APP-23 y APPN-6 a APPN-14, salvo los corregidos.

**Permisos y navegación**
- **UI4-5 (PER-2):** `mant:ot:manage` y `mant:schedules:manage` sin alcance por faena; latente, sólo `jefe_mantencion` los tiene.
- **UI4-7:** `/mantencion` manda a `/forbidden` a roles con ítem en el menú.
- **UI4-9:** el Excel de OT no exige `mant:export`.
- **UIN-2 (sigue):** tres textos para «fuera de tu alcance»: «No encontramos este registro» (también para una OT), «Recurso no encontrado» y «Esta dirección no existe» (navegador).

---

## Auditoría UI/UX

Formato del sistema `allopze-ui-ux`. Severidades: Alto = P1, Medio = P2, Bajo = P3.

### 1. Contexto y diagnóstico general
- **Superficie:** software interno de operación (listas, fichas y un tablero), de uso diario en escritorio por jefatura; una app de teléfono para el mecánico.
- **Tareas críticas:** asignar y cerrar una OT; revisar registros; resolver una nota de pedido; saber qué le toca a cada equipo; leer el mes en el Panel.
- **Puntuación global:** 6,8 / 10.
- **Veredicto:** requiere correcciones antes de poner en uso las notas de pedido y antes del 01-12. No hay un bloqueo total de ninguna tarea.

### 2. Puntuación por dimensiones
- Usabilidad: 6,5/10. Las tareas se completan, pero hay trampas: editar borra datos, un control que no hace nada, caminos sin salida en las notas.
- Jerarquía visual: 7,5/10. Una acción principal por pantalla, salvo la ficha del equipo.
- Claridad de contenido: 6/10. Vocabulario de repuestos, «Camiones/Máquinas», «historial» con tres significados.
- Consistencia: 6,5/10. Tres textos de «no encontrado», rayas mezcladas, «Todas las faenas».
- Navegación: 6,5/10. Historial sin menú; la ficha marca otro ítem.
- Accesibilidad (WCAG): 8/10. Axe sin violaciones en 52 rutas; la app cumple 44 px.
- Responsividad: 6,5/10. Sin desborde salvo el Historial; mucho control antes del contenido en móvil.
- Estados y feedback: 7/10. Las acciones destructivas confirman con motivo; faltan avisos puntuales.

### 3. Hallazgos detallados

#### Un control que no hace nada (PAN4-6, PAN4-9)
- **Problema:** el período se muestra en Planificación y no la filtra; cambiar de pestaña lo reinicia.
- **Evidencia:** contenido idéntico con dos períodos; los enlaces de las pestañas llevan sólo `?pestana=`.
- **Principio afectado:** visibilidad del estado del sistema (Nielsen 1) y control del usuario (Nielsen 3).
- **Severidad:** Medio.
- **Recomendación:** ocultar el período donde no aplica y conservar período y faena entre pestañas.

#### El mismo concepto con palabras opuestas (NAV-3, NAV-4)
- **Problema:** «Sacar de bodega» reserva; el resultado es «En bodega» y «Sacada de la bodega» a la vez.
- **Evidencia:** ficha de `NP-2026-0002` y tarjeta «Repuestos» de `OT-CAB-0007`.
- **Principio afectado:** correspondencia con el mundo real (Nielsen 2) y consistencia (Nielsen 4).
- **Severidad:** Medio.
- **Recomendación:** un solo verbo (reservar / liberar / usar) en botón, aviso, insignia e historial.

#### Rótulos que ya no describen el contenido (PAN4-14, UI4-2)
- **Problema:** «Máquinas» lista camiones; el Historial vive bajo «Registros firmados».
- **Evidencia:** 6 de 11 trabajos de «Máquinas» son camiones o tractocamiones; el menú no tiene «Historial».
- **Principio afectado:** reconocer antes que recordar (Nielsen 6); orientación («¿dónde estoy?»).
- **Severidad:** Medio.
- **Recomendación:** «Por kilómetros / Por horas»; ítem de menú propio.

#### Columnas y tarjetas sin información (NAV-8, UI-3, EQ4-2)
- **Problema:** «Por asignar» gasta cinco columnas en rayas y omite la fecha del pedido; la OT muestra dos tarjetas vacías; «Sin lecturas» son tres rayas sin explicación.
- **Evidencia:** capturas `10-ot-lista`, `15-ot-en-ejecucion-repuestos`, `51-equipos-sin-lecturas`.
- **Principio afectado:** diseño minimalista (Nielsen 8); estados vacíos con salida (regla A4 del repositorio).
- **Severidad:** Medio.
- **Recomendación:** columnas por pestaña; ocultar las tarjetas que no aplican; decir qué falta y cómo completarlo.

#### Desborde y exceso de controles en el teléfono (NAV-1, NAV-14, UIN-1)
- **Problema:** el Historial se mueve de lado; Registros, Equipos y la ficha gastan la primera pantalla en botones y filtros.
- **Evidencia:** 49 px y 549 px de scroll horizontal a 390 px; el primer registro aparece cerca del píxel 745 de 844.
- **Principio afectado:** reflow (WCAG 1.4.10); el contenido primero en pantallas chicas.
- **Severidad:** Medio.
- **Recomendación:** envolver el selector, plegar los filtros tras «Filtros (N)» y los gráficos cerrados por defecto en móvil.

#### Gráficos que no se pueden leer (NAV-2)
- **Problema:** etiquetas del eje encimadas en dos gráficos.
- **Evidencia:** `crop-historial-graficos.png` y `crop-maquinas-chart.png`.
- **Principio afectado:** legibilidad del dato (relación señal-ruido).
- **Severidad:** Bajo.
- **Recomendación:** el año una sola vez, o etiquetas rotadas; en el gráfico por equipo, sólo el código.

#### Prevención de errores al escribir cifras (OTN-6, OT4-8, NAV-11)
- **Problema:** el ingreso acepta «8.100» como 8,1, muestra dos lecturas cuando sirve una, y la hora cambia de formato según el navegador.
- **Evidencia:** `entry_hourmeter = 8.1` en la base.
- **Principio afectado:** prevención de errores (Nielsen 5).
- **Severidad:** Alto.
- **Recomendación:** un solo campo con la unidad del equipo, parseo chileno, la última lectura a la vista y un aviso si baja o salta.

### 4. Plan de acción priorizado
- Corregir OT4-6 y OTN-6.
- Corregir REG4-1 y NP4-7 juntos: qué pasa con registros y notas al anular o cerrar una OT.
- Cerrar los caminos sin salida de las notas (NP4-1, NP4-2, NP4-3, NP4-4, NP4-6) y unificar el vocabulario antes de desplegarlas.
- Panel: período y faena entre pestañas, rótulos por unidad y el corte del checklist.
- Móvil y gráficos: NAV-1, NAV-2 y NAV-14.

---

## Estado de los hallazgos del 22-11

| ID | Estado | Nota |
|---|---|---|
| OTN-1 | corregido | «Editar solicitud» existe; ver OT4-6 |
| APPN-1, APPN-2, APPN-3, APPN-5 | corregidos | |
| APP-1, APP-2, APP-3, APP-5, APP-7, APP-8 | corregidos | |
| REGN-1, REGN-2 (entre archivos), REGN-3, REGN-9 | corregidos | falta cargar horas y pruebas (REG4-2) |
| EQ-1, EQN-1, EQ-13 | corregidos | EQN-1 reaparece con unidades (EQ4-1) |
| OTN-4, OTN-5, OTN-16, OT-5 | corregidos | |
| PAN-1, PAN-6, PAN-7, PANN-1 a PANN-4, PANN-9, PANN-18 | corregidos | PAN-8 cambió y generó PAN4-3; PANN-5 a medias |
| REG-23 | corregido | la hoja de vida sigue al equipo |
| OT-1 (P1) | **sigue** | |
| OTN-2, OTN-6, OTN-7, OT-2, OT-3, OT-6, OT-7 | siguen | OTN-6 sube a P1 |
| REG-1 a REG-7, REG-15, REGN-4 | siguen | |
| EQN-2, EQN-3, EQ-2, EQ-3, EQ-4, EQ-6, EQ-18 | siguen | |
| PAN-5, PANN-6, PANN-7, PANN-12, PANN-13, PANN-15, PANN-16 | siguen | |
| APP-4, APP-6, APP-9 a APP-23, APPN-4, APPN-6 a APPN-14 | siguen | APPN-6 agravado (APP4-7) |
| PER-1, PER-2, PER-3, PER-5, PER-7, UIN-1, UIN-2, UI-1, UI-2, UI-3, UI-5 | siguen | |

El estado «corregido» de cada fila sale de la lectura de las líneas; verifiqué en pantalla los que se nombran como navegador en las tablas de arriba.

## PASS (verificado)

- **Rutas:** las 52 responden 200 en escritorio; un solo `h1` visible; sin scroll horizontal a 1440 px; sin error boundary, sin errores de consola y sin peticiones fallidas.
- **Accesibilidad automática:** axe WCAG 2.1 A/AA con **0 violaciones** en las 52 rutas. En la app del mecánico ningún control del inicio mide menos de 44 px.
- **Móvil:** 16 de 18 rutas sin desborde a 390 px. Las dos que fallan son el Historial (NAV-1).
- **Alcance por faena (navegador):**
  - Supervisor y administrador de contrato de Biodiversa: OT, registro y ficha de otra faena responden «no encontrado»; el Panel, las listas y las notas salen acotados.
  - Pautas, Catálogos, Dispositivos, Repuestos, «Nuevo equipo» e «Importar» responden `/forbidden` a los tres perfiles sin permiso.
  - El mecánico no entra al Panel, a Equipos, al Historial ni a las notas; sí ve sus OT y sus registros y puede ejecutar la OT desde el PC.
- **Confirmaciones:** anular una OT, anular una nota y liberar una reserva piden motivo; rechazar una línea también. Lo rutinario no pregunta.
- **Cifras accionables:** las dos cifras de Registros y las cuatro de la franja «Hoy» son enlaces a su subconjunto.
- **Código sano según las líneas:**
  - máquina de estados de OT con `expectedVersion` e idempotencia;
  - invariantes de stock (reservado ≤ existente, bloqueo ordenado, consumo y reverso);
  - alta idempotente de la nota desde el teléfono;
  - todos los lectores de la unidad usan `effectiveMeterSql` y no queda pauta en una unidad distinta a la del equipo;
  - el Historial, su resumen, la matriz y el Excel salen del mismo arreglo;
  - la autorización de páginas, acciones, PDF y exportaciones se valida en el servidor;
  - paridad de los 21 permisos `mant:*` entre manifiesto, menú y roles sembrados.

## Advertencias de automatización

- **Los datos no son reales.** La base desechable no trae el historial consolidado (2.356 filas en producción), ni las faenas y traslados reales, ni volúmenes para medir rendimiento. Las cifras de este informe son de prueba.
- **La carga inicial del fixture E2E deja los camiones en horas y sin pauta:** su faena Biodiversa tiene el código `MANT-BIO` y la regla busca `BIODIVERSA`. Lo corregí a mano en la base desechable (camiones de Biodiversa en km con «Camiones y tractos»; el resto en horas con «Maquinaria pesada») para parecerme a producción. Es la causa conocida de los specs E2E en rojo por la unidad.
- **`next dev`, no build de producción:** los tiempos de carga no son representativos.
- **Mi perfil de mecánico tenía siete faenas** (para generar datos): «Equipo de otra faena» en la app no es evidencia de APP4-6.
- **Fotos sintéticas** y el indicador flotante de Next en las capturas son del entorno.
- **La base desechable quedó creada** para repetir las pruebas: `bodega_e2e_auditmant` en `bodega-e2e-postgres`. Ya tiene las mutaciones de la auditoría (una OT anulada, una editada, un ingreso, una reserva liberada). Se borra con `docker exec bodega-e2e-postgres dropdb -U postgres bodega_e2e_auditmant`.

## Brechas de cobertura

- **`bodega_dev` y producción no se recorrieron.**
- **Sin reproducir:** lo que pide un traslado (PAN4-1, PAN4-2, PAN4-3, REG4-3, NP4-8, APP4-6), el rechazo de una compra (NP4-1) y todo lo de la cola de la app (APP4-*): salen de lectura.
- **Flujos no ejercitados:** «Comprar» desde la nota hasta la recepción, «Por conciliar», el registro completo desde la app y desde el PC, las importaciones (se abrieron las pantallas, sin subir archivos), publicar una pauta.
- **Sin descargas:** no se abrieron Excel ni PDF; los tres impresos sí se renderizaron.
- **Roles:** faltan consulta y jefa.
- **Sin puertas:** no se corrieron typecheck, lint, tests ni E2E, porque no hubo cambios de código.
- **Teclado y lector de pantalla:** no se probaron a mano; axe no detecta orden de foco ni nombres poco útiles.

## Decisiones que toca tomar antes de arreglar

1. **Estado de la nota de pedido:** ¿«Pendientes» son las notas con alguna línea sin resolver? ¿Cómo se llama una nota con todo en compra?
2. **Sacar de bodega menos de lo pedido:** ¿se exige la cantidad completa o el saldo queda pendiente?
3. **Al anular o cerrar una OT:** ¿se anulan sus notas abiertas? ¿sus registros firmados cuentan como trabajo propio?
4. **Pestañas del Panel:** decidido el 26-11, «Por kilómetros» y «Por horas». Falta decidir si el período se oculta en Planificación o la filtra.
5. **Lectura del ingreso a taller:** ¿cuenta como última lectura del equipo?
6. **Historial de mantenciones:** ¿ítem propio en el menú?
7. **Siguen abiertas del 22-11:** el alcance de la «baja» (EQ-4) y el tono de alerta para quien no revisa (PAN-5).

## Orden sugerido

1. **Antes del 01-12** (corte de los formularios y Panel Trinorma): OT4-6, OTN-6, REG4-1, OT4-5 con OTN-7, PAN4-5, PAN4-14, PAN4-6 y PAN4-9.
2. **Antes de desplegar las notas de pedido:** NP4-1, NP4-2, NP4-3, NP4-4, NP4-6, NP4-7, NAV-3, NAV-4 y UI4-1.
3. **Equipos en horas:** EQ4-1, EQ4-2 y EQ4-3 (los 62 camiones sin lectura).
4. **App del mecánico:** APP4-2, APP4-1, APP4-3, APP4-7 y APP-4.
5. **Móvil y gráficos:** NAV-1, NAV-2, NAV-14 y UIN-1.
6. **Traslados y faenas cerradas:** PAN4-1, PAN4-2, PAN4-3, REG4-3 y NP4-8.
7. **P3 por tandas de área.**
