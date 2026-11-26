# Mantención: hallazgos detallados de la auditoría (2026-11-26)

Este documento desarrolla, uno por uno, los hallazgos de la auditoría de lógica y UI/UX del submódulo de Mantención hecha sobre `main` `edc9b2fb3`. El resumen, el método y lo que quedó sano están en [mantencion-auditoria-2026-11-26.md](mantencion-auditoria-2026-11-26.md). El análisis de qué tan fácil es encontrar cada cosa está en [mantencion-encontrabilidad-2026-11-26.md](mantencion-encontrabilidad-2026-11-26.md).

Sirve para decidir qué arreglar y para arreglarlo: cada hallazgo dice dónde está, qué pasa, cómo corregirlo y cómo se verificó. No se cambió código.

## Cómo leerlo

**Severidad**

| Nivel | Significado |
|---|---|
| P0 | Pérdida o corrupción de datos, o brecha de autorización explotable. No hay ninguno. |
| P1 | Bloquea un flujo, deja datos o cifras incorrectas que alguien usa para decidir, o un error que no se ve. |
| P2 | Defecto con salida alternativa, inconsistencia visible o pantalla que induce a error. |
| P3 | Pulido. |

**Verificación**

| Marca | Significado |
|---|---|
| Reproducido | Hecho en la app (`localhost:3022`, base de prueba) y leído en la base o en pantalla. |
| Navegador | Visto en pantalla. |
| Lectura ✓ | Trazado por la línea de lectura y releído por el auditor principal. |
| Lectura | Trazado por la línea de lectura, sin releer. |
| Sospecha | Falta reproducirlo. Se dice cómo. |

**Identificadores.** `OT4-`, `NP4-`, `REG4-`, `EQ4-`, `PAN4-`, `APP4-` y `UI4-` son de las siete líneas de lectura de esta auditoría. `NAV-` son los que salieron del recorrido en navegador. Los demás (`OTN-`, `REG-`, `EQ-`, `PAN-`, `APP-`, `PER-`, `UI-`…) vienen de las auditorías del 16-11 y del 22-11 y siguen abiertos.

**Datos de prueba.** Los folios y códigos que se citan (`OT-CHO-0015`, `NP-2026-0002`, `KA-122`…) son de la base desechable `bodega_e2e_auditmant`, no de producción.

## Conteo

| Área | P1 | P2 | P3 | Previos abiertos |
|---|---|---|---|---|
| 1. Órdenes de trabajo | 3 | 8 | 10 | 17 |
| 2. Notas de pedido y repuestos | 1 | 14 | 12 | 0 |
| 3. Registros firmados | 1 | 2 | 5 | 21 |
| 4. Historial de mantenciones | 0 | 6 | 3 | 2 |
| 5. Equipos y ficha del equipo | 0 | 6 | 5 | 20 |
| 6. Pautas, catálogos y dispositivos | 0 | 0 | 5 | 2 |
| 7. Panel | 0 | 10 | 7 | 10 |
| 8. App del mecánico | 0 | 7 | 4 | 21 |
| 9. Permisos y navegación | 0 | 0 | 4 | 4 |
| **Total** | **5** | **53** | **55** | **97** |

De los cinco P1, cuatro son nuevos y uno (OT-1) viene del 16-11. Las columnas P1 a P3 cuentan los hallazgos con ficha propia en este documento. «Previos abiertos» cuenta los identificadores de auditorías anteriores que siguen sin corregir y van en la tabla al final de cada área.

---

## 1. Órdenes de trabajo

### OT4-6 · P1 · Bug de producto · «Editar solicitud» borra la descripción y los ítems al cambiar el tipo de acción
- **Dónde:** `components/mantencion/jefatura/ot/ot-request-fields.tsx:134-137` y `:53-66`.
- **Qué pasa:** al elegir el tipo de acción, `checksForActionType` marca Mantención y desmarca Reparación. El campo de descripción desaparece del formulario. Al guardar, `requestPayload` envía `repairDescription: null` y `annexItems: []` porque Reparación quedó desmarcada.
- **Reproducción:** `OT-CHO-0015`, asignada, sin tipo, con Reparación marcada, la descripción «Fisura en soporte de balde.» y un trabajo anexo. «Más acciones» → «Editar solicitud» → Tipo de acción «Preventiva» → «Guardar cambios». En la base queda `repair = false`, `maintenance = true`, `action_type = 'preventiva'`, `repair_description = NULL` y cero ítems. Se guardó una OT sin ninguna descripción del trabajo.
- **Por qué pesa:** una OT nace sin tipo y con Reparación marcada (OTN-7). Clasificarla después es el camino recomendado antes del Panel Trinorma, y ese camino borra lo pedido. El antes y el después quedan en el evento del historial, pero la ficha no los muestra.
- **Arreglo:** en modo edición, elegir el tipo no toca las casillas. El envío no manda `null` por un campo oculto: conserva el texto o pide confirmación diciendo qué se va a perder. Agregar una prueba del formulario en edición.
- **Verificación:** Reproducido (navegador y base).

### OTN-6 · P1 · Bug de producto · El ingreso a taller desde el PC guarda «8.100» horas como 8,1
- **Dónde:** `components/mantencion/jefatura/ot/ot-action-dialogs.tsx:153-156` (`Number(raw.replace(",", "."))`) y `lib/services/mantencion/work-orders/transitions.ts:120-168` (`resolveEntry`).
- **Qué pasa:** el campo trata el punto como decimal. Quien escribe la lectura con punto de miles guarda mil veces menos. El servidor sólo exige que haya un valor y no compara con la lectura anterior.
- **Reproducción:** `OT-STF-0024`, equipo en horas con última lectura firmada de 7.501 h. «Registrar ingreso» con horómetro «8.100». Se acepta sin aviso y en la base queda `entry_hourmeter = 8.1`. Con «1.234.567» el botón queda desactivado y ningún texto dice por qué.
- **Por qué pesa:** esa lectura es la que muestran el Historial, las pestañas Camiones y Máquinas y el Excel. La app del mecánico y el registro hecho desde el PC sí usan `parseReadingInput` y `checkReading`.
- **Arreglo:** el mismo parseo que la app, la última lectura a la vista y un aviso si la lectura baja o salta. Mensaje junto al campo cuando el valor no se entiende.
- **Verificación:** Reproducido. Viene del 22-11 como P2 y sube a P1.

### OT-1 · P1 · Bug de producto (previo) · Anular una OT nacida de un hallazgo deja la CAPA trabada
- **Dónde:** `lib/services/mantencion/work-orders/transitions.ts:482-501` y `lib/services/prevention-inspections/runs.ts:~892`.
- **Qué pasa:** anular la OT no toca el hallazgo ni su acción CAPA, y el diálogo de anular no lo advierte. Al intentar derivar el hallazgo de nuevo, el servicio responde que ya tiene una acción CAPA enlazada.
- **Arreglo:** al anular, liberar el vínculo o cerrar la CAPA con el motivo, y avisarlo en el diálogo. Hoy la única salida es que Prevención cancele la CAPA y derive otra.
- **Verificación:** Lectura.

### OT4-5 · P2 · Inconsistencia · «Correctiva» deducida de la casilla se ve como declarada
- **Dónde:** `work-orders/query.ts:419` y `ot-sections.tsx:172` (muestran `effectiveActionType`), `ot/[id]/page.tsx:127` y `ot-action-dialogs.tsx:615` (el diálogo de corrección precarga el tipo real), `ot-request-fields.tsx:131` («Sin definir»), `lib/mantencion/action-type.ts:16` («Sin clasificar») y `ot-aside.tsx:39` («No informado»).
- **Qué pasa:** con el tipo opcional, una OT sin tipo y con Reparación marcada dice «Tipo de acción: Correctiva» en la ficha, el PDF y el Excel, y el Panel la cuenta como correctiva. El diálogo «Corregir clasificación» de esa misma OT dice «Sin definir». Quien la corrige a «Sin definir» ve en el historial «Correctiva → No informado» y la ficha sigue diciendo «Correctiva».
- **Evidencia:** en la base de prueba 77 de 80 OT no tienen tipo. `OT-CAB-0007`, una de ellas, se ve «Correctiva».
- **Arreglo:** rotular lo deducido («Correctiva, según la casilla») y usar un solo nombre para el caso sin tipo. Va junto con OTN-7.
- **Verificación:** Navegador y base.

### OT4-3 · P2 · UX · «Corregir ingreso» deja editar la entrega estimada y el servidor la rechaza
- **Dónde:** `ot-action-dialogs.tsx:226` y `transitions.ts:196-198`.
- **Qué pasa:** en modo corrección el campo «Entrega estimada» sigue editable y obligatorio, con la ayuda «Se puede cambiar después; cada cambio queda en el historial». Si se cambia, el servidor responde «Para cambiar la fecha estimada de entrega usa «Cambiar fecha estimada»». El menú llama a esa acción «Cambiar entrega estimada». Además, corregir el ingreso a un día posterior a la estimada vigente falla y no se puede arreglar desde ese diálogo. La descripción del diálogo sigue diciendo «Al ingresar, el equipo pasa a mantención si estaba operativo».
- **Arreglo:** mostrar la estimada como sólo lectura en modo corrección, con un enlace a su acción, y unificar el nombre.
- **Verificación:** Navegador y Lectura ✓.

### OT4-1 · P2 · Inconsistencia · El aviso de devolución queda viejo o falta tras una reapertura
- **Dónde:** `ot-sections.tsx:462-471` (`OtRejectionNotice`), `work-orders/catalog-items.ts:46,90` (`lastRejection`) y `transitions.ts:523`.
- **Qué pasa:**
  - Una OT rechazada con el motivo A, corregida, cerrada y reabierta con el motivo B muestra «Esta orden fue devuelta una vez. Motivo: A». El motivo B sólo está en el historial.
  - Una OT cerrada que nunca se rechazó y se reabre no muestra aviso, y el teléfono recibe `lastRejection: null`. El mecánico no ve por qué volvió a taller.
  - El aviso sigue visible cuando la OT ya volvió a «Por recibir».
- **Arreglo:** leer el último evento `rejected` o `reopened` con su rótulo, ocultarlo cuando la OT salió de taller e incluir `reopened` en el catálogo del teléfono.
- **Verificación:** Lectura.

### OT4-2 · P2 · Hallazgo funcional (latente) · Una OT abierta no sigue el cambio de unidad del equipo
- **Dónde:** `transitions.ts:121-123` y `query.ts:415` (usan `equipmentSnapshot.unit`, sellada al crear la OT), `equipment.ts:286-308` (el cambio de unidad sólo toca el perfil), `looker/corrective.ts:126` (lee la lectura con la unidad actual), `catalog-items.ts:55` y `components/mantencion/app/ot-entry-form.tsx:60-62`.
- **Qué pasa:** una OT asignada con `unit = "km"` cuyo equipo pasa a horas sigue pidiendo «Kilómetro» en la ficha y en la app y guarda `entry_odometer`. El registro enlazado pide horómetro. El Panel lee `entry_hourmeter`, vacío, y la lectura de ingreso sale en blanco. El Excel rotula «km».
- **Arreglo:** resolver la unidad desde el perfil mientras la OT no tenga ingreso, o actualizar el sello de las OT sin ingreso al cambiar la unidad.
- **Verificación:** Lectura. Producción no tiene OT vigentes, así que hoy no ocurre. Se reproduce creando una OT, cambiando la unidad y abriendo «Registrar ingreso».

### OT4-4 · P2 · Inconsistencia · El Excel «Historial» de la OT no distingue la corrección de clasificación
- **Dónde:** `work-orders/export.ts:38-58` (tabla propia de rótulos) y `:194`, frente a `ot-labels.ts:40-44` y `ot-aside.tsx:34-60`.
- **Qué pasa:** al cambiar el tipo de una OT cerrada, la ficha muestra «Clasificación corregida» con «Tipo de acción: Correctiva → Preventiva». El Excel muestra «Solicitud editada», con el motivo y sin decir qué cambió. Tampoco se ven en la ficha los cambios de «Solicitud editada».
- **Arreglo:** reusar `otEventLabel` en el Excel y agregar una columna «Detalle» con el antes y el después.
- **Verificación:** Lectura.

### NAV-8 · P2 · UX · La pestaña «Por asignar» no muestra lo que hace falta para asignar
- **Dónde:** `components/mantencion/jefatura/ot/ot-table.tsx:109-118`.
- **Qué pasa:** la tabla tiene nueve columnas y en esta pestaña cinco no dicen nada: «Estado» repite «Por asignar» en todas las filas, «Mecánico» dice «Sin asignar», e «Ingreso», «Entrega estimada» y «Días en taller» muestran rayas. No aparecen la fecha del pedido, los días que lleva esperando, quién la pidió ni el problema. Las rayas además alternan «–» y «—».
- **Arreglo:** columnas según la pestaña. En «Por asignar»: pedida el, hace cuánto, solicitante y problema.
- **Verificación:** Navegador (`desk/10-ot-lista.png`). Amplía UI-1.

### NAV-9 · P2 · Inconsistencia · La lectura del ingreso a taller no cuenta como lectura del equipo
- **Dónde:** `lib/services/mantencion/fleet.ts` (`recentRecords` lee sólo registros firmados).
- **Qué pasa:** la ficha de `KA-122` dice «Última lectura 4.869 h» del 10-11 y «faltan 231 h». Su línea de tiempo muestra el ingreso de la OT del 25-11 con 4.933 h. Con esa lectura faltarían 167 h.
- **Arreglo:** decidir si el ingreso a taller actualiza la última lectura. Si no, decirlo en la ficha.
- **Verificación:** Navegador (`desk/56-ficha-h-en-taller.full.png`). Es una decisión de producto.

### OTN-13 · P2 · UX (previo) · La ficha ofrece «Crear orden de trabajo» a un equipo que ya tiene una abierta
- **Dónde:** `components/mantencion/jefatura/equipos/equipment-detail-view.tsx` y `work-orders/create.ts:~246-290`.
- **Qué pasa:** `KA-122` está en taller con `OT-STF-0021`, y la acción principal de su ficha es «Crear orden de trabajo». Ni la ficha ni el formulario avisan de la OT abierta.
- **Arreglo:** avisar y enlazar la OT abierta antes de crear otra.
- **Verificación:** Navegador y Lectura.

### OT4-7 · P3 · Inconsistencia · Tras un traslado, Excel, PDF y teléfono siguen mostrando la faena de imputación
- **Dónde:** `work-orders/export.ts:~104`, `app/(print)/mantencion/ot/[id]/print/ot-document.tsx`, `catalog-items.ts:58` y `ot-sections.tsx:~450`.
- **Qué pasa:** la lista filtrada por Pacífico incluye la OT de un equipo trasladado y agrega «Equipo ahora en X». El Excel de esa lista dice «Faena = Masisa» sin marca del traslado. El aviso de traslado sale también en OT cerradas y anuladas, donde «la recepción y la conformidad las da esa faena» ya no aplica.
- **Arreglo:** columna «Faena actual del equipo» en el Excel, una línea en el PDF y ocultar el aviso en OT terminadas.
- **Verificación:** Lectura.

### OT4-8 · P3 · UX · «Registrar ingreso» pide kilómetro y horómetro
- **Dónde:** `ot-action-dialogs.tsx:153-156,177-178,~219-224` y `transitions.ts:165-166`.
- **Qué pasa:** el diálogo muestra los dos campos. Para un equipo en horas sólo el horómetro es obligatorio, y lo escrito en «Kilómetro» se descarta sin aviso.
- **Arreglo:** mostrar sólo el campo de la unidad del equipo.
- **Verificación:** Navegador (`interact/D-registrar-ingreso.png`).

### OT4-9 · P3 · Inconsistencia · Dos tablas de rótulos de evento
- **Dónde:** `ot-labels.ts:11-33` frente a `work-orders/export.ts:38-58`.
- **Qué pasa:** el rechazo es «Rechazada» en la ficha, «Devuelta a taller» en el Excel, «Devuelta N veces» en la lista y «volvió a taller» en el aviso. «Orden solicitada» en la ficha es «Creada» en el Excel.
- **Arreglo:** una sola fuente de rótulos.
- **Verificación:** Lectura.

### OT4-10 · P3 · Sospecha · «Editar solicitud» recrea los ítems con ids nuevos
- **Dónde:** `transitions.ts:571-573`.
- **Qué pasa:** un mecánico sin señal tiene la OT en su catálogo. Jefatura edita la solicitud y los ítems cambian de id. Al sincronizar, las marcas de ítems se rechazan con 422.
- **Arreglo:** actualizar por posición conservando los ids, o bloquear la edición con un ingreso en cola.
- **Verificación:** Sospecha. Se reproduce marcando ítems sin señal y sincronizando después de editar.

### OT4-11 · P3 · UX · Reabrir no avisa que lo reservado se liberó
- **Dónde:** `lib/services/mantencion/parts/release.ts` y el diálogo de reapertura en `ot-action-dialogs.tsx`.
- **Qué pasa:** al cerrar la OT se liberan sus reservas. Al reabrirla no vuelven, y el mecánico no ve los repuestos disponibles ni sabe por qué.
- **Arreglo:** una línea en el diálogo de reapertura.
- **Verificación:** Lectura.

### OT4-12 · P3 · Mejora · «Fecha de la orden» no tiene límites
- **Dónde:** `lib/mantencion/work-order-schemas.ts:22`, `work-orders/create.ts:330` y `ot-request-fields.tsx`.
- **Qué pasa:** se puede crear o editar una OT con fecha de 2027 o de 2019, lo que mueve el filtro «Pedida desde/hasta».
- **Arreglo:** tope en hoy, o una advertencia.
- **Verificación:** Lectura.

### NAV-11 · P3 · Inconsistencia · La hora del ingreso cambia de formato según el navegador
- **Dónde:** `ot-action-dialogs.tsx` (campo `ot-entry-at-time`, `<input type="time">` nativo).
- **Qué pasa:** con el navegador en es-CL el campo muestra «04:31 p.m.». El resto de la plataforma muestra 24 horas («16:18»).
- **Arreglo:** un control de hora propio, como el `DatePicker` que ya se usa para la fecha.
- **Verificación:** Navegador (`interact/M1-error.png`).

### NAV-12 · P3 · UX · «Editar solicitud» se cierra sin preguntar y trae un texto viejo
- **Dónde:** `components/mantencion/jefatura/ot/edit-ot-sheet.tsx` y `ot-request-fields.tsx`.
- **Qué pasa:** con cambios sin guardar, la tecla Esc cierra la hoja y los descarta. La ayuda de «Faena de imputación» dice «el folio y los costos se imputan a ella» y la OT ya no lleva costo.
- **Arreglo:** preguntar antes de descartar y corregir el texto.
- **Verificación:** Navegador (`interact/C-cerrar-con-cambios.png`).

### UI4-16 · P3 · UX · Las pestañas vacías de la lista no ofrecen salida
- **Dónde:** `app/(app)/mantencion/ot/page.tsx:164-170`.
- **Qué pasa:** el vacío tiene botón sólo en «Por asignar» y «Abiertas». «En taller», «Por recibir», «Por conformidad» y «Cerradas» se quedan sin salida.
- **Arreglo:** un enlace a todas las abiertas.
- **Verificación:** Lectura.

### OT4-13 · P3 · Sospecha · Concurrencia entre conformidad y traslado
- **Dónde:** `work-orders/core.ts:~148`, `work-orders/create.ts:~246` y `lib/services/fleet-transfers.ts:289`.
- **Qué pasa:** `runLocked` y `createWorkOrder` bloquean el perfil del equipo y leen `fuel_vehicles.worksite_id` sin bloqueo. El traslado bloquea la fila de `fuel_vehicles`. Una conformidad o un alta simultánea con un traslado podría juzgar con la faena anterior.
- **Verificación:** Sospecha. La ventana es muy chica. Pide una prueba concurrente.

### Previos que siguen abiertos (OT)

| ID | Qué | Dónde hoy | Verif. |
|---|---|---|---|
| OTN-7 | Sin tipo elegido y con «Reparación» precargada, toda OT cuenta como correctiva. | `system-settings.ts:69`, `new-ot-sheet.tsx`, `action-type.ts:55-58` | Lectura |
| OTN-2 | Las horas hombre sólo se capturan desde el PC: la salida del teléfono no las trae. | `lib/mantencion/contracts.ts:260` | Lectura |
| OTN-3 | Cambió: la salida ya precarga y las horas se corrigen después. El «trabajo realizado» no se puede vaciar y el tope sigue en 10.000 h. | `transitions.ts:354-358,615-623` | Lectura |
| OTN-8 | La lista no muestra ni filtra el tipo de acción. | `ot-table.tsx:109-118` | Lectura |
| OTN-9 | El historial no nombra al mecánico ni la etapa del rechazo. | `ot-aside.tsx:15-27` | Lectura |
| OTN-10 | Recepción, conformidad y estimada sin fecha mínima ni máxima. | `ot-action-dialogs.tsx` | Lectura |
| OTN-12 | Elegir el tipo de acción pisa las casillas. Agravado en OT4-6. | `ot-request-fields.tsx:134-137` | Reproducido |
| OTN-14 | Anular no avisa a jefatura. | `work-orders/notifications.ts:144-147` | Lectura |
| OTN-15 | «Días detenido –» con la OT siete días en taller. La lista dice «Días en taller». | `ot-sections.tsx:177`, `query.ts:~86` | Navegador |
| OTN-17 | La faena de ejecución no da visibilidad. | `work-orders/access.ts:43-62,116-122` | Lectura |
| OT-2 | Un solo par ingreso y salida: reabrir conserva el ingreso y borra la salida. | `transitions.ts:401-405` | Lectura |
| OT-3 | El motivo de la reapertura no llega al mecánico. Ver OT4-1. | `catalog-items.ts:46,90` | Lectura |
| OT-6 | «Corregir ingreso» exige taller y conductor activos aunque sólo se corrija la lectura. | `transitions.ts:139,151` | Lectura |
| OT-7 | Un teléfono adelantado más de 5 minutos recibe un rechazo definitivo. | `work-orders/core.ts:43-47` | Lectura |
| UI-2 | «Interno · Taller interno» en la ficha y en la app. | `ot-sections.tsx:68-72`, `transitions.ts:133` | Navegador |
| UI-3 | Tarjetas «Trabajos anexos» y «Mantenciones solicitadas» vacías con «No hay líneas en esta lista.». | `ot-sections.tsx` (`OtItemsSection`) | Navegador |
| UI-8 | Rayas «—» y «–» mezcladas en la misma tarjeta («Especialidades —», «Horas hombre –»). | `ot-sections.tsx:173,176,177` | Navegador |

---

## 2. Notas de pedido y repuestos

Código fusionado a `main` el 26-11 y todavía sin desplegar. Los invariantes de stock resistieron el trazado. Los defectos están en el ciclo de vida de la nota y de sus líneas, y en las cifras que salen de ahí.

### NP4-1 · P1 · Hallazgo funcional · Una línea «en compra» cuya compra fue rechazada queda sin acciones
- **Dónde:** `components/mantencion/jefatura/notas-pedido/parts-note-detail.tsx:96,134`, `lib/services/mantencion/parts-notes/status.ts` (`isResolvableLine`) y los llamadores de `unlinkNoteItemsFromRequestTx` (`cancel-request.ts:118`, `requests-delete.ts:113`, `persist-draft.ts:244`).
- **Qué pasa:** la pantalla sólo muestra botones si la línea está `pendiente` y la nota abierta. El servidor sí permite volver a resolver una línea en compra con todas sus compras muertas. La línea sólo se desvincula al cancelar o borrar la solicitud o al quitar el ítem del borrador. Un rechazo en aprobaciones no la desvincula.
- **Escenario:** jefatura pulsa «Comprar» y quien aprueba rechaza la solicitud o el ítem. La nota, sin otras líneas pendientes, pasa a «Cerradas». La línea se ve «Pedido» y no tiene botones. El mecánico sigue esperando y nadie recibe aviso.
- **Arreglo:** desvincular también al rechazar. O tratar la línea en compra con todas sus compras muertas como pendiente en la pantalla, en el conteo y en el estado de la nota.
- **Verificación:** Lectura ✓. No se reprodujo porque pide el flujo de aprobación.

### NP4-2 · P2 · Hallazgo funcional · «Pendientes» y la cifra del Panel sólo cuentan notas sin ninguna línea resuelta
- **Dónde:** `parts-notes/query.ts:26` (`pendientes: ["enviada"]`), `parts-notes/status.ts:18-22`, `app/(app)/mantencion/panel/hoy-tab.tsx:130` y `notas-pedido/page.tsx:36`.
- **Qué pasa:** una nota con tres líneas y una resuelta pasa a `en_gestion`. Sale de «Pendientes» y deja de contar en «Notas de pedido por resolver» del Panel, aunque tenga un equipo detenido esperando. La prioridad «equipo detenido primero» sólo existe en esa pestaña. A la vez, una nota con todas sus líneas en compra queda `cerrada` y aparece en «Cerradas» con la compra en curso. El texto de «En gestión» dice «líneas ya resueltas que siguen abiertas: en compra, o con repuestos por llegar», lo contrario de lo que hace el código.
- **Evidencia:** `NP-2026-0002` tiene una línea pendiente y está en «En gestión». El Panel dice 2 y hay 3 notas con líneas por resolver.
- **Arreglo:** «por resolver» son las notas abiertas con líneas pendientes, en la pestaña y en el Panel. Decidir el nombre del estado de una nota con compras en curso.
- **Verificación:** Navegador y Lectura ✓. Pide una decisión.

### NP4-3 · P2 · Hallazgo funcional · Sacar de bodega menos de lo pedido cierra la línea
- **Dónde:** `parts-notes/resolve.ts:58` (permite menos de lo pedido) y `:93` (`desde_stock` es final), `parts-notes/request-link.ts:59` y `lib/requests/request-service-module/linked-parts-note.ts:~75`.
- **Qué pasa:** el mecánico pide 4 y hay 2 libres. Jefatura saca 2. La línea queda «En bodega · Llegó 2» y cerrada. Los 2 que faltan no se pueden comprar ni rechazar desde la nota y nada los marca.
- **Reproducción:** `NP-2026-0003`. Pedían 4 filtros de aire, se sacaron 2 y la nota quedó en «Cerradas».
- **Arreglo:** exigir la cantidad completa, o dejar el saldo como pendiente. Como mínimo, avisar en el diálogo y permitir «Comprar» el saldo.
- **Verificación:** Reproducido. Pide una decisión.

### NP4-4 · P2 · Inconsistencia · Liberar una reserva no cambia la nota
- **Dónde:** `parts-notes/lines.ts:81-98` (suma sólo los orígenes con `note_item_id`), `parts/allocations.ts:280`, `parts/release.ts` y `lib/services/stock-reservations.ts` (las rebajas se escriben sin ese id).
- **Qué pasa:** tras liberar la reserva, el stock vuelve a libre y los chips del mecánico no muestran nada. La nota sigue diciendo «En bodega · Llegó 2 · Usado 0», y esa cifra alimenta la etapa, la OT y la app. Lo mismo pasa al anular una recepción parcial.
- **Reproducción:** en `OT-CAB-0007` se liberaron las 2 unidades de «Filtro de combustible primario». La línea de `NP-2026-0002` siguió «En bodega · Llegó 2». La reserva quedó `activa` con cantidad 0,00.
- **Arreglo:** calcular «llegó» con todos los movimientos de la reserva de esa línea, o escribir `note_item_id` también en las rebajas. Cerrar la reserva que queda en cero.
- **Verificación:** Reproducido.

### NP4-6 · P2 · Hallazgo funcional · La nota no se puede anular aunque se libere la reserva
- **Dónde:** `parts-notes/resolve.ts:171` (el mensaje) frente a `:34,170` (la línea sigue `desde_stock`).
- **Qué pasa:** jefatura saca de bodega por error. Para anular la nota el sistema dice «libera esa reserva antes de anular la nota». Con la reserva ya liberada, responde lo mismo. Tampoco se puede rechazar ni volver a resolver la línea.
- **Reproducción:** `NP-2026-0002`, justo después de la liberación de NP4-4.
- **Arreglo:** que liberar toda la reserva devuelva la línea a pendiente, o que la anulación mire la reserva y no la resolución.
- **Verificación:** Reproducido.

### NP4-7 · P2 · Hallazgo funcional · Las notas de una OT anulada o cerrada siguen abiertas
- **Dónde:** `work-orders/transitions.ts:474,497`. Sólo se liberan las reservas.
- **Qué pasa:** la OT se conforma o se anula con una nota `enviada`. La nota sigue en «Pendientes» y cuenta en el Panel. «Sacar de bodega» responde que la orden ya está cerrada o anulada. Hay que rechazar o anular línea por línea.
- **Reproducción:** tras anular `OT-BIO-0005`, `NP-2026-0001` (equipo detenido) y `NP-2026-0005` siguieron en «Pendientes» con el contador en 2.
- **Arreglo:** al cerrar o anular la OT, cerrar o anular sus notas abiertas con un evento, o sacarlas de «Pendientes» y del Panel.
- **Verificación:** Reproducido. Va junto con REG4-1.

### NP4-5 · P2 · Bug de producto · Anular una recepción o guía tras liberar o ajustar falla con un mensaje falso
- **Dónde:** `parts/allocations.ts:259-272` y `:229`.
- **Qué pasa:** una recepción parcial aportó 5 a la reserva. Jefatura libera 2 a mano y después descubre que la recepción era de otra orden de compra. Al anularla, lo aportado es 5 y lo que queda es 3, y el sistema responde «Ya se usó en una orden de trabajo.» sin que nada se haya usado. La única salida es un ajuste.
- **Arreglo:** si no hay consumo, rebajar lo que quede y dejar que la guarda del motor decida. Decir «ya se usó» sólo con líneas descontadas.
- **Verificación:** Lectura. La secuencia no está cubierta por las pruebas leídas.

### NP4-8 · P2 · Inconsistencia · Tras un traslado, la faena de destino ve la nota y no puede comprarla
- **Dónde:** `parts-notes/access.ts:50-56` y `parts-notes/prefill.ts:40` (se ve por la faena de la nota o por la actual del equipo) frente a `linked-parts-note.ts:55` (sólo la faena de la nota).
- **Qué pasa:** el equipo pasa de A a B. El jefe de B ve la nota, pulsa «Comprar» y el formulario se abre prellenado. Al guardar responde «La línea de la nota de pedido ya no existe: quita ese ítem». El filtro de faena de la bandeja también usa la faena de la nota.
- **Arreglo:** la misma regla (`canSeeNote`) en `assertPartsNoteLineBuyable`.
- **Verificación:** Lectura. El escenario pide un traslado.

### NP4-9 · P2 · UX · «No alcanza para lo declarado» es falso en el caso normal de conciliar
- **Dónde:** `components/mantencion/jefatura/notas-pedido/conciliation-list.tsx:46` y `parts/conciliation.ts:215-217`.
- **Qué pasa:** el mecánico declara el uso antes de que se registre la recepción. Luego llega la compra, reservada para esa OT. La fila muestra «0 libres ahora · No alcanza para lo declarado» en tono de alerta, y «Descontar ahora» funciona porque usa la reserva propia.
- **Arreglo:** mostrar libres más lo reservado para esa OT, o quitar el texto.
- **Verificación:** Lectura.

### NP4-10 · P2 · Inconsistencia · El Excel de la OT parte en dos filas una línea comprada
- **Dónde:** `work-orders/export-parts.ts:111-112` y `:124`.
- **Qué pasa:** el mecánico pide «filtro de aceite» en texto libre y jefatura lo compra. La solicitud lo cataloga y la reserva tiene producto. La hoja «Repuestos» muestra una fila con Pedido 2 y Reservado 0, y otra con Pedido 0 y Reservado 2. La bandeja sí deduce el producto desde la reserva.
- **Arreglo:** reusar `loadLineStates`.
- **Verificación:** Lectura.

### NP4-11 · P2 · Inconsistencia · La diferencia del cotejo de una guía no rebaja stock ni reserva
- **Dónde:** `lib/services/dispatch-guides.ts:1133` y `parts/types.ts:23`. La fuente `cotejo` existe en el tipo y en la migración 0403, y nada la escribe.
- **Qué pasa:** una guía despacha 5 repuestos reservados para una OT y en faena llegan 3. El stock y la reserva quedan en 5, y el mecánico ve 5 disponibles.
- **Arreglo:** rebajar con `cotejo` al cotejar con diferencia, o mostrar la diferencia en la OT y dejar documentado que el ajuste es manual.
- **Verificación:** Lectura, confianza media.

### UI4-1 · P2 · Paridad · El interruptor «Notas de pedido» no corta el envío desde el teléfono
- **Dónde:** `lib/services/module-toggles-routes.ts:83`, `lib/services/mantencion/sync-auth.ts:73` y `app/api/mantencion/sync/notas-pedido/route.ts:14-24`.
- **Qué pasa:** `/api/mantencion/sync/notas-pedido` cuelga del submódulo Registros. Con el submódulo de notas apagado, la bandeja queda inactiva y el mecánico sigue creando notas que nadie ve en el PC. Las OT sí tienen prefijo propio.
- **Arreglo:** un prefijo propio antes del genérico, y que el catálogo del teléfono oculte «Pedir repuestos» con el submódulo apagado.
- **Verificación:** Lectura ✓.

### NAV-3 · P2 · Inconsistencia · El vocabulario de repuestos se contradice
- **Dónde:** `components/mantencion/jefatura/notas-pedido/note-line-actions.tsx`, `parts-note-detail.tsx:24`, `components/mantencion/jefatura/ot/ot-sections.tsx:299,314,320` y `parts-notes/resolve.ts`.
- **Qué pasa:** la misma acción tiene cinco nombres.
  - El botón dice «Sacar de bodega».
  - Su diálogo dice «queda reservado para esta orden de trabajo».
  - El aviso dice «Se apartaron 2 de…».
  - La línea queda con la insignia «En bodega» y, debajo, «Sacada de la bodega por…».
  - La OT lo lista en «Reservados sin usar» con el botón «Liberar».
  - En la tarjeta «Repuestos» de la OT, «Repuestos pedidos» son las solicitudes de compra («Sin solicitudes de compra»), y el botón «Pedir repuestos» crea una solicitud. Justo arriba están las «Notas de pedido» del mecánico, que en su app también se llaman «Pedir repuestos».
- **Arreglo:** un verbo por acción: reservar, liberar y usar. «Reservar de bodega» deja la línea «Reservado (2)». La sección de compras se llama «Solicitudes de compra» y su botón «Pedir compra».
- **Verificación:** Navegador (`desk/24-nota-en-gestion.png`, `desk/15-ot-en-ejecucion-repuestos.full.png`).

### NAV-4 · P2 · UX · El historial de la OT dice «Nota de pedido resuelta» por cada línea
- **Dónde:** `components/mantencion/jefatura/ot/ot-labels.ts:31-32` y `work-orders/export.ts:56`.
- **Qué pasa:** al rechazar o reservar una línea, el historial de la OT registra «Nota de pedido resuelta» con la nota todavía en gestión, y no dice qué repuesto ni cuánto. Un rechazo se lee como resolución, con el motivo citado debajo. «Repuestos reservados para la orden» tampoco dice cuáles.
- **Arreglo:** «Línea reservada: 2 × Filtro de combustible» y «Línea rechazada: Kit de sellos».
- **Verificación:** Navegador.

### NAV-7 · P2 · Mejora · El Catálogo de repuestos no muestra existencias ni reservas
- **Dónde:** `app/(app)/mantencion/repuestos/**` y `components/mantencion/repuestos/**`.
- **Qué pasa:** la lista tiene proveedor, último precio, última compra y «Comprado para». La ficha tiene los datos del repuesto y las compras. Con 6 unidades en Cabrero y 2 reservadas, la ficha de «Filtro de combustible primario» dice «Todavía no se ha comprado». Para saber cuánto hay y cuánto está reservado hay que ir a Bodega.
- **Arreglo:** existencia, reservado y libre por faena en la ficha, o un enlace a Bodega ya filtrado.
- **Verificación:** Navegador (`desk/70-repuestos.png`, `desk/71-repuesto-ficha.png`).

### NAV-5 · P3 · UX · La ficha de la nota no muestra su estado
- **Dónde:** `parts-note-detail.tsx`.
- **Qué pasa:** sólo la nota anulada tiene un aviso. En las demás no se lee si está pendiente, en gestión o cerrada: se deduce de que falten los botones. La línea de una nota anulada sigue con la insignia «Pedido».
- **Arreglo:** una insignia de estado junto al título.
- **Verificación:** Navegador (`desk/25-nota-cerrada-parcial.png`, `desk/26-nota-anulada.png`).

### NAV-6 · P3 · Inconsistencia · «Sacar de bodega» activo con cero libres
- **Dónde:** `note-line-actions.tsx`.
- **Qué pasa:** una línea de texto libre tiene el botón desactivado con su motivo («No hay repuestos con stock libre en Biodiversa»). Una línea del catálogo, en la misma faena y sin stock, lo tiene activo. El diálogo recién dice «0 libres en Biodiversa».
- **Arreglo:** el mismo trato en los dos casos.
- **Verificación:** Navegador (`interact/A-sacar-bodega-sin-stock.png`).

### NAV-13 · P3 · Texto · «Se apartaron 1 de…»
- **Dónde:** `parts-notes/resolve.ts` (mensaje de éxito).
- **Qué pasa:** la concordancia falla con una unidad.
- **Arreglo:** singular y plural, y el verbo de NAV-3.
- **Verificación:** Reproducido.

### UI4-10 · P3 · Búsqueda · La TopBar filtra sólo las 50 notas de la página
- **Dónde:** `parts-notes-table.tsx:43-53`, `conciliation-list.tsx:98-103` y `notas-pedido/page.tsx:74`.
- **Qué pasa:** el servidor acepta `?q=` y ninguna pantalla lo escribe. Con más de 50 notas, una nota de la segunda página no aparece al buscar.
- **Arreglo:** búsqueda de servidor con la ruta en `ROUTES_WITH_OWN_SEARCH`, o quitar `?q=`.
- **Verificación:** Lectura.

### UI4-11 · P3 · Rótulo · «NP» sin explicación
- **Dónde:** `parts-notes-table.tsx:15-16`.
- **Qué pasa:** la cabecera de la primera columna es «NP» y la segunda «Equipo y OT». La regla A6 pide el nombre completo o un `title`.
- **Arreglo:** «Nota» y «Equipo y orden».
- **Verificación:** Navegador.

### UI4-12 · P3 · Búsqueda · El buscador de la TopBar aparece en fichas donde no filtra nada
- **Dónde:** `notas-pedido/[id]/page.tsx`, `repuestos/[id]/page.tsx` y `components/layout/top-bar.tsx:81`.
- **Qué pasa:** la ficha de una nota y la de un repuesto muestran «Filtrar en esta página…» sin lista que filtrar.
- **Arreglo:** agregar los patrones como el de la ficha del equipo.
- **Verificación:** Navegador.

### NP4-12 · P3 · UX · Un error técnico queda como «pendiente de conciliar»
- **Dónde:** `parts/consumption.ts:87-89`.
- **Qué pasa:** el servicio guarda los primeros 300 caracteres de cualquier error. Un bloqueo o una caída de conexión deja la línea como «Pendiente de conciliar: Failed query: …», como si faltara stock.
- **Arreglo:** distinguir errores de negocio de errores técnicos y no capturar estos.
- **Verificación:** Sospecha. Se reproduce forzando un error en `applyMovementTx`.

### NP4-13 · P3 · Inconsistencia · La antigüedad cuenta desde la llegada al servidor
- **Dónde:** `parts-notes/create.ts:160` (se ignora `payload.createdAt`).
- **Qué pasa:** una nota pedida sin señal a las 08:00 y sincronizada a las 14:00 aparece como recién llegada y pierde lugar en la bandeja.
- **Arreglo:** guardar y mostrar también la hora del pedido, acotada.
- **Verificación:** Lectura.

### NP4-14 · P3 · Limpieza · Código sin uso y comentarios viejos
- **Dónde y qué:** `reservedQuantityTx` (`stock-reservations.ts:78`) no tiene llamadores. El comentario de `parts/types.ts:65` habla de «stubs» que ya no existen. `lib/services/spare-parts-catalog.ts:7` dice «Es de consumo directo: no entra a stock ni kárdex». `holdersBeyondAdmin` está copiado en tres archivos.
- **Verificación:** Lectura.

### NP4-15 · P3 · Sospecha · «Terminar» no espera a una nota posterior al último registro
- **Dónde:** `lib/mantencion/client/queue-order.ts:39`.
- **Qué pasa:** una nota creada entre el último registro y «Terminar», con reintento pendiente, puede llegar después. El servidor la rechaza porque la OT ya salió de taller.
- **Arreglo:** que «Terminar» también espere a las notas anteriores.
- **Verificación:** Sospecha. Se reproduce con una prueba de cola.

### APP4-11 · P3 · Mejora · El pedido del teléfono sólo admite enteros y la unidad «unidad»
- **Dónde:** `components/mantencion/app/parts-note-sheet.tsx:47,125`.
- **Qué pasa:** «20 litros de aceite» o «3 metros de manguera» sólo caben en el texto. La nota llega a jefatura como «20 unidad».
- **Arreglo:** decimales y elección de unidad.
- **Verificación:** Navegador (`app/06-pedir-repuestos.png`).

### UI4-8 · P3 · Texto · Descripciones de permisos que no coinciden con lo que hacen
- **Dónde:** `modules/mantencion-equipos/manifest.ts:59` y `:51`.
- **Qué pasa:** `mant:np:create` dice «desde la app o el PC» y sólo existe el envío desde la app. El mecánico no entra a la bandeja en el PC. `mant:export` dice «registros, equipos y pautas» y también habilita el Excel del Panel, el informe en PDF, el Historial y el Excel de la hoja de vida.
- **Arreglo:** corregir las dos descripciones.
- **Verificación:** Lectura, y Navegador para la bandeja.

---

## 3. Registros firmados

### REG4-1 · P1 · Bug de producto · Anular una OT en taller hace desaparecer su trabajo firmado
- **Dónde:** `lib/services/mantencion/maintenance-work.ts:318` (una OT anulada no cuenta), `:397-399` (un registro con OT no cuenta por sí mismo, ni en el Panel ni en la línea de tiempo), `lib/mantencion/work-order-states.ts:147` (se puede anular desde `en_ejecucion`) y `work-orders/transitions.ts:482-497`.
- **Qué pasa:** el trabajo de una OT se cuenta a través de la OT. Si la OT se anula después de que el mecánico firmó un registro enlazado, la OT deja de contar por anulada y el registro no cuenta porque tiene OT. El trabajo queda en «Registros firmados» y en ninguna otra vista.
- **Reproducción:** `OT-BIO-0005`, en taller, con la correctiva firmada `MC-BIO-0018`. Antes de anularla, el Historial de 12 meses tenía 100 trabajos y `KA-140` una fila. Después, 99 trabajos y `KA-140` sin filas. `MC-BIO-0018` sigue vigente y enlazado a la OT anulada.
- **Arreglo:** el registro cuenta como trabajo propio si su OT está anulada o no entró a taller, en el Panel y en la línea de tiempo. El diálogo de anular dice cuántos registros y notas quedan enlazados.
- **Verificación:** Reproducido. Va junto con NP4-7.

### REG4-3 · P2 · Inconsistencia · «Por revisar» incluye registros que el lector no puede revisar
- **Dónde:** `lib/services/mantencion/records-query.ts:25` (la lista sigue al equipo trasladado), `app/(app)/mantencion/registros/page.tsx:227`, `components/mantencion/jefatura/registros/record-selection.tsx:44-52` y `lib/services/mantencion/record-lifecycle.ts:285-287`.
- **Qué pasa:** tras un traslado, el supervisor de la faena de destino ve en «Por revisar», contados en la pestaña, registros pendientes de la faena de origen. Las acciones sobre un registro siguen con la faena del registro. «Seleccionar todos» y «Marcar como revisados» responde «N no se encontraron». En el detalle el botón no aparece y «Siguiente» sigue llevando a esos registros.
- **Arreglo:** exponer si el lector puede actuar en cada fila y excluir de la selección las que no. El contador cuenta sólo lo actuable.
- **Verificación:** Lectura. Producción ya tuvo traslados y aún no tiene registros nativos.

### REG4-5 · P2 · UX · Volver a la lista desde «Todos» cae en «Por revisar»
- **Dónde:** `registros/page.tsx:128-130`, `lib/services/mantencion/records-filters.ts:195-203` y `registros/[id]/page.tsx:134`.
- **Qué pasa:** el revisor está en la pestaña «Todos», abre un registro y vuelve con la miga. El detalle llega con `?lista=revision%3Dtodos`, pero el enlace de vuelta sale como `/mantencion/registros`, que para quien revisa abre «Por revisar» en la página 1.
- **Arreglo:** conservar `revision` en el enlace de vuelta.
- **Verificación:** Navegador.

### REG4-6 · P3 · Inconsistencia · «Lectura anterior» mezcla unidades
- **Dónde:** `lib/services/mantencion/records-detail.ts:210-216` (sin filtro de unidad) frente a `records-create-context.ts:136`.
- **Qué pasa:** un camión pasó de kilómetros a horas y firma 4.200 h. El detalle, el PDF y el texto de la alerta muestran como anterior «187.000», rotulado en horas.
- **Arreglo:** filtrar por la unidad vigente, como al crear.
- **Verificación:** Lectura. Depende del orden entre el cambio de unidad y los registros.

### REG4-7 · P3 · UX · Observar no avisa, y «Crear registro corregido» se pierde al cerrar el diálogo
- **Dónde:** `components/mantencion/jefatura/registros/record-actions.tsx:83-89` y `:181-185`.
- **Qué pasa:** al guardar una observación el diálogo se cierra sin aviso. El enlace «Crear registro corregido» sólo existe en el diálogo que sigue a la anulación: si se cierra, el registro anulado ya no lo ofrece.
- **Arreglo:** un aviso con el resultado, y el enlace en la ficha de todo anulado sin corrección.
- **Verificación:** Lectura.

### REG4-10 · P3 · Texto · Textos que sólo hablan del teléfono, y código sin uso
- **Dónde y qué:** los vacíos de `registros/page.tsx:80,88` dicen «su teléfono los sincroniza» y ya existen registros hechos desde el PC. `record-aside.tsx:20` y `record-sections.tsx:89` dicen siempre «Firmado en el teléfono» y «Firma del mecánico». «Todos los mecánicos» (`records-filters.tsx:100`) también lista talleres externos. `countsFromForms` (`lib/mantencion/forms-cutover.ts:25`) y `pendingObservations` (`records-detail.ts:341`) no tienen llamadores.
- **Verificación:** Lectura.

### NAV-16 · P3 · UX · La columna «Estado» mezcla dos cosas
- **Dónde:** `components/mantencion/jefatura/registros/records-table.tsx`.
- **Qué pasa:** en «Por revisar», la columna muestra «2 ítems no realizados» para una preventiva y «Cerrada» para una correctiva. «Cerrada» es el estado del trabajo, no el de la revisión, y se lee raro en una lista de pendientes.
- **Arreglo:** una columna para las alertas y otra para la situación en taller, o un rótulo que diga qué es.
- **Verificación:** Navegador (`desk/30-registros.png`).

### NAV-14 · P3 · Móvil · Una pantalla entera de controles antes del primer registro
- **Dónde:** `registros/page.tsx` y `components/mantencion/jefatura/registros/records-filters.tsx`.
- **Qué pasa:** a 390 px, antes del primer registro van el título, la descripción, dos botones, la franja de indicadores, dos cifras, las pestañas, el buscador, tres selectores, dos fechas, «Más filtros» y «Seleccionar todos». El primer registro aparece cerca del píxel 745 de 844. En Equipos y en la lista de OT pasa algo parecido, y el Historial abre con los gráficos desplegados.
- **Arreglo:** en móvil, los filtros detrás de un botón «Filtros (N)» y los gráficos cerrados.
- **Verificación:** Navegador (`mobile-grid.png`). Amplía UI-5.

### Previos que siguen abiertos (Registros)

| ID | Qué | Dónde hoy | Verif. |
|---|---|---|---|
| REG-1 | El teléfono pide respuesta a observaciones ya cerradas: no filtra por respuesta ni por registro vigente, y corta en 50. | `lib/services/mantencion/catalog.ts:129-147` | Lectura |
| REG-2 | La «lectura anterior» puede ser de un registro posterior del mismo día. | `records-detail.ts:210-216` | Lectura |
| REG-3 | El Excel lleva la pestaña activa sin decirlo. | `registros/page.tsx:189`, `records-query.ts:43-46` | Lectura |
| REG-4 | «Anulados» dentro de «Por revisar» da cero filas y el texto dice «con estos filtros». | `records-query.ts:45`, `records-filters.tsx:84` | Lectura |
| REG-5 | El lote no distingue registros con alertas ni observados sin respuesta. | `record-selection.tsx:44-52` | Lectura |
| REG-6 | La OT del registro es texto y no enlace. | `records-detail.ts:299` | Navegador |
| REG-7 | El buscador no encuentra un folio ni «ka91» sin guion. | `records-query.ts:28-33`, `records-filters.tsx:95` | Lectura |
| REG-15 | La franja «Indicadores · 93 registros vigentes del…» cambia con la pestaña y su rango es el mínimo y el máximo del conjunto. | `registros/page.tsx:138-142`, `records-query.ts:278-279` | Navegador |
| REGN-4 | «Observados» no distingue «espera al mecánico» de «ya respondió». «Marcar revisado» cierra una observación sin respuesta sin avisar. | `records-table.tsx:74`, `record-lifecycle.ts:207-231` | Lectura |
| REGN-6 | El Excel no trae observaciones de jefatura, lectura anterior ni OT. | `export-records.ts:188-196` | Lectura |
| REGN-12 | Ordenar por lectura mezcla kilómetros y horas. | `records-query.ts:110` | Lectura |
| REGN-15 | «Firma del mecánico» con quien registró, aunque el trabajo lo hizo un taller. | `record-aside.tsx:20` | Navegador |
| REGN-16 | El texto de la alerta de salto se recalcula con la lectura anterior actual. | `record-alerts.ts:50-57` | Lectura |
| REGN-18 | Las tarjetas móviles no se pueden ordenar. | `records-table.tsx:162` | Lectura |
| UI-4 | Un mecánico y un taller con el mismo nombre sólo se distinguen por «(taller externo)». | `records-query.ts:353-356` | Lectura |
| REG-9, REG-10, REG-13, REG-19, REG-20, REG-25 | Detalles del impreso, del filtro de mecánicos, de la descarga del PDF (`<a download>` sin `ExportLink`), de la huella del PDF, del enlace a la ficha y de revisar los registros propios. | `record-document.tsx:68`, `record-actions.tsx:113`, `record-pdf.ts:51-87`, `record-lifecycle.ts:207` | Lectura |

---

## 4. Historial de mantenciones

### NAV-1 · P2 · Móvil · El Historial se desborda de lado en el teléfono
- **Dónde:** `app/(app)/mantencion/registros/historicos/page.tsx:41` (el selector «Todos / Correctivas / Preventivas / Predictivas / Sin clasificar») y `components/mantencion/historial/work-matrix.tsx`.
- **Qué pasa:** a 390 px el selector de tipo mide 423 px y no envuelve ni tiene scroll propio. La página entera gana 49 px de scroll horizontal. En la vista «Equipos por mes» son 549 px.
- **Arreglo:** que el selector envuelva o tenga su propio scroll, y la matriz dentro de un contenedor con scroll propio.
- **Verificación:** Navegador, medido. Es la única pantalla del recorrido móvil con desborde.

### NAV-2 · P2 · Visual · Dos gráficos con las etiquetas del eje encimadas
- **Dónde:** `app/(app)/mantencion/panel/indicators-charts.tsx` («Trabajos de mantención por tipo») y `components/mantencion/panel/looker/corrective-panel.tsx` con `components/charts/hours-records-combo-chart-lazy.tsx` («Horas y registros por equipo»).
- **Qué pasa:** con 12 meses, el eje del Historial se lee «dic 2025ene 2026feb 2026mar 2026…», sin separación. En Camiones y Máquinas, las etiquetas por equipo («KCH-131 · PFVP-52») se pisan hasta quedar ilegibles. Debajo hay una lista con los mismos equipos, sin relación visible con las barras.
- **Arreglo:** el año una sola vez o etiquetas rotadas. En el gráfico por equipo, sólo el código.
- **Verificación:** Navegador (`crop-historial-graficos.png`, `crop-maquinas-chart.png`).

### REG4-2 · P2 · Hallazgo funcional · El importador de pantalla no guarda horas, especialidades ni la marca de prueba
- **Dónde:** `lib/services/mantencion/historical-import.ts:164-170` (el `insert` omite `laborHours`, `specialties`, `contractText`, `isTest`, `downtimeDays` y `actionType`), `maintenance-work.ts:226` (la lista, el Panel y el Excel leen sólo `laborHours`) y `registros/historicos/[id]/page.tsx:130` (la ficha sí cae a `hoursText`).
- **Qué pasa:** quien importa la última exportación de Forms antes del corte sube una respuesta con «8» en horas trabajadas. La ficha y «Respuestas de formularios» muestran 8. El Historial, la matriz, el Excel y «Horas hombre» del Panel la cuentan sin dato. Una respuesta de prueba entra a las cifras, porque esta ruta no la marca y la pantalla no ofrece marcarla.
- **Arreglo:** parsear como el importador del consolidado (`consolidated-workbook.ts:459-465`). Como mínimo, usar `hoursText` de respaldo.
- **Verificación:** Lectura ✓.

### REG4-4 · P2 · Inconsistencia · «Días en taller» ignora los «Días detenido» del formulario
- **Dónde:** `maintenance-work.ts:258` (salida menos ingreso; nadie más lee `downtime_days`) y `historicos/[id]/page.tsx:129`.
- **Qué pasa:** una respuesta trae «Días detenido 3» y no trae fechas. La ficha dice 3. La lista, el Excel y «Días en taller» la cuentan sin dato. Si trae fechas que dan 8 y declaró 5, la ficha muestra los dos números sin decir cuál manda.
- **Arreglo:** decidir la regla y aplicarla en lista, Excel y ficha.
- **Verificación:** Lectura, confianza media.

### UI4-2 · P2 · Navegación · El Historial de mantenciones no tiene ítem de menú
- **Dónde:** `modules/mantencion-equipos/manifest.ts:78-130` y `registros/historicos/page.tsx:54,76`.
- **Qué pasa:** se llega por un botón de «Registros firmados», por un enlace en la pestaña «Cerradas» de OT o por el Panel. El menú marca «Registros firmados» y la miga cuelga de ahí, aunque el contenido es otro: formularios, OT y registros.
- **Arreglo:** un ítem propio con los mismos permisos y su miga.
- **Verificación:** Navegador (`desk/40-historial.full.png`).

### UI4-4 · P2 · Inconsistencia · «Todas las faenas» para quien sólo ve las suyas
- **Dónde:** `components/mantencion/jefatura/registros/records-filters.tsx:97` y `components/mantencion/historial/history-filters.tsx:85`.
- **Qué pasa:** el administrador de contrato de una faena abre Registros o el Historial y lee «Todas las faenas». OT, Equipos, Notas y el Panel dicen «Todas tus faenas» (`lib/auth/worksite-label.ts`). El resumen del Historial dice «Tus faenas».
- **Arreglo:** pasar `allWorksitesLabel` desde la página.
- **Verificación:** Lectura ✓.

### REG4-8 · P3 · Inconsistencia · Rótulos, textos y orden del Historial
- **Dónde y qué:**
  - `historicos/page.tsx:161` dice siempre «Mismo criterio que el Panel». Es falso con un equipo elegido, y la cifra ya viene filtrada.
  - Las faenas cerradas se rotulan «(cerrada)» en `history-filters.tsx:50` y «(inactiva)» en `records-query.ts:332`.
  - El chip del equipo dice «El elegido» o «El de la ficha» en vez del código.
  - «Más filtros» es un `<details>` propio aquí y un panel de `FilterToolbar` en Registros.
  - Con menos de 6 meses, `historyMonths` (`lib/mantencion/history-view.ts:283-289`) amplía la ventana y los gráficos muestran ceros en meses que no se consultaron.
  - Con `?hasta=` sin `desde`, el selector muestra «01-01-2000».
  - El Excel ordena por `params.sort` aunque la pantalla agrupe (`export-history.ts:73`), escribe el id interno del equipo en «Filtros aplicados» (`:80`) y antepone un apóstrofo a las descripciones que empiezan con `-`, `+`, `=` o `@`.
- **Verificación:** Lectura.

### REG4-9 · P3 · Hallazgo funcional · Datos que se pierden sin aviso
- **Dónde y qué:**
  - Una respuesta con fecha futura queda fuera de la lista y del Panel (`history-view.ts:115,121`) y sólo aparece en «Respuestas de formularios». Nada dice cuántas hay. En producción hay una de 2027.
  - Los posibles duplicados entran como nuevos y cuentan dos veces (`historical-import.ts:164`).
  - Una sola respuesta sin correo o sin fecha aborta todo el archivo (`historical-workbook.ts:109`). Dos respuestas iguales dentro del mismo archivo también (`:117`).
- **Verificación:** Lectura.

### NAV-18 · P3 · UX · Muchos controles en la misma pantalla
- **Dónde:** `registros/historicos/page.tsx` y `components/mantencion/historial/`.
- **Qué pasa:** la pantalla tiene tres selectores segmentados (vista, tipo y agrupación), cinco filtros, dos acciones en la cabecera, un «Qué cuenta» plegable y los gráficos plegables. La lectura del formulario sale tal cual («150000») junto a lecturas con formato («4.933 h»).
- **Arreglo:** dejar el tipo dentro de los filtros o la agrupación dentro de la vista, y dar formato a la lectura cuando sea un número.
- **Verificación:** Navegador.

### Previos que siguen abiertos (Historial)

| ID | Qué | Dónde hoy | Verif. |
|---|---|---|---|
| REGN-5 | Parcial. El Historial ya busca por código y patente de la flota. «ka1» sigue sin encontrar «KA-1», y «Respuestas de formularios» busca sólo en el texto original. | `history-view.ts:206`, `historical-import.ts:233` | Lectura |
| REGN-2 | Corregido entre archivos. El duplicado dentro del mismo archivo todavía aborta. | `historical-workbook.ts:117` | Lectura |

---

## 5. Equipos y ficha del equipo

### EQ4-1 · P2 · Hallazgo funcional · Los registros en la unidad anterior siguen bloqueando la lectura inicial
- **Dónde:** `lib/services/mantencion/equipment-resolve.ts:245-256` (los conteos y el primer registro se calculan sobre todos los registros, sin filtrar por unidad), `:509` (un registro vigente fija la lectura inicial) y `:442-450` (la preventiva declarada se compara con el primer registro, sea de la unidad que sea). También `padron-identity.ts:91`.
- **Qué pasa:** un camión con tres registros en kilómetros pasa a horas. Queda «Sin lecturas». En «Editar mantención» el campo de lectura inicial está bloqueado («el equipo ya tiene registros») y el servidor lo confirma. La declarada se valida contra un registro en kilómetros, así que «6.500 h ≤ 250.000 km» pasa. El equipo sólo sale de «Sin lecturas» cuando un mecánico firma en horas.
- **Arreglo:** filtrar esos tres agregados por la unidad vigente, como hace `recentRecords` en `fleet.ts:359`.
- **Verificación:** Lectura ✓. En producción los 62 camiones no tenían registros nativos, así que hoy no ocurre.

### EQ4-2 · P2 · UX · «Sin lecturas» no dice qué falta ni cómo salir
- **Dónde:** `components/mantencion/jefatura/equipos/equipment-read-sections.tsx:77-82`, `app/(app)/mantencion/equipos/page.tsx:95-113` y `lib/mantencion/status.ts:49`.
- **Qué pasa:** la lista muestra «Sin lecturas» y tres rayas en última lectura, próxima mantención y estimación. El aviso «Falta completar» cuenta los equipos sin pauta y los vehículos por incorporar, y no los que no tienen lectura. Ninguna pantalla dice que falta la lectura inicial ni ofrece cargarla. En producción son los 62 camiones pasados a horas.
- **Evidencia:** 21 equipos en la base de prueba.
- **Arreglo:** texto de apoyo en ese estado, y «N equipos sin lectura» en «Falta completar» con enlace a `?estado=sin_lecturas`.
- **Verificación:** Navegador (`desk/51-equipos-sin-lecturas.png`).

### EQ4-3 · P2 · Inconsistencia · La importación no dice en qué unidad quedará cada equipo
- **Dónde:** `lib/services/mantencion/equipment-import.ts:584-601` (la hoja «Listas» saca la unidad del tipo), `:626`, `:379` y `components/mantencion/jefatura/equipos/equipment-import-preview.tsx:213`.
- **Qué pasa:** la plantilla trae un camión de Santa Fe. La hoja «Listas» dice «kilómetros», así que se escribe el odómetro (250.000). El equipo nace en horas por la regla de `lib/mantencion/equipment-unit.ts:42`, y la lectura inicial queda como 250.000 h. La vista previa dice «Nuevo · Camión tolva · Marca · Santa Fe», sin unidad.
- **Arreglo:** mostrar la unidad resultante en la fila y en «Listas», y avisar cuando la lectura no es razonable para esa unidad.
- **Verificación:** Lectura.

### EQ4-4 · P2 · UX · «Falta completar» promete «sólo falta su marca y su pauta» a vehículos bloqueados
- **Dónde:** `equipos/page.tsx:70,107`, `components/mantencion/jefatura/equipos/add-equipment-button.tsx:46` y `fleet-incorporation-panel.tsx:88,158`.
- **Qué pasa:** el aviso dice «5 vehículos de la flota aún no están en Mantención. Sólo falta su marca y su pauta». En «Incorporar desde la flota» los cinco están bloqueados: dos sin código interno y tres con la patente inválida. Cada bloqueo dice «asígnalo en Vehículos» o «corrígela en Vehículos», sin enlace al vehículo.
- **Arreglo:** contar sólo los que se pueden incorporar, decir aparte cuántos necesitan arreglo y enlazar cada uno.
- **Verificación:** Navegador (`desk/53-equipo-incorporar.png`). La línea de lectura lo puso en P3. Sube a P2 porque en la base de prueba el aviso es falso para todos.

### UI4-3 · P2 · Búsqueda (previo EQ-18) · «Incorporar desde la flota» no tiene buscador
- **Dónde:** `components/layout/top-bar.tsx:81` (el patrón `^/mantencion/equipos/[^/]+$` también oculta el buscador en `/equipos/incorporar`) y `fleet-incorporation-panel.tsx:49,79-84` (el panel filtra con el texto de la TopBar).
- **Qué pasa:** con decenas de vehículos pendientes, el buscador no está y la tabla sólo se filtra por faena. El panel sigue precargando marcas tal como vienen de la flota («MAHINDRA», «SSANGYONG»).
- **Arreglo:** excluir `incorporar` del patrón o dar al panel su propio buscador.
- **Verificación:** Navegador.

### NAV-19 · P2 · UX · La ficha repite los mismos registros en dos formatos
- **Dónde:** `components/mantencion/historial/equipment-timeline.tsx` y `components/mantencion/jefatura/equipos/equipment-life-section.tsx`.
- **Qué pasa:** la pestaña Mantención de la ficha muestra una línea de tiempo «Historial de mantenciones» y, debajo, la tabla «Hoja de vida» con los mismos ocho registros. El resumen de la tabla dice «7 h de taller» para dos correctivas que no pasaron por taller: son horas hombre. La columna «Estado» mezcla «Vigente» con «Revisado».
- **Arreglo:** una sola representación, «horas hombre» en el resumen y dos columnas para estado y revisión.
- **Verificación:** Navegador (`desk/56-ficha-h-en-taller.full.png`). **En curso en otra rama** (`fix/mantencion-hoja-vida-consistencia`, worktree `bodega-wt/hoja-vida`).

### EQ4-5 · P3 · Hallazgo funcional · Incorporar crea la marca aunque la fila falle
- **Dónde:** `lib/services/mantencion/fleet-incorporation.ts:158-166` (crea la marca) antes de `:182` (resuelve el equipo).
- **Qué pasa:** una fila con marca nueva y lectura inválida da error, pero la transacción confirma y la marca queda en el catálogo sin ningún vehículo.
- **Arreglo:** crear la marca después de resolver la fila.
- **Verificación:** Lectura.

### EQ4-6 · P3 · Inconsistencia · El Excel de equipos redondea las horas a entero
- **Dónde:** `lib/services/mantencion/export-equipment.ts:295` (`#,##0`). La plantilla de importación usa el mismo formato en `equipment-import.ts:560`.
- **Qué pasa:** la pantalla dice 5.400,5 h y el Excel muestra 5.401. Lo mismo en «Falta» y «Próxima».
- **Arreglo:** un decimal para las lecturas en horas.
- **Verificación:** Lectura.

### EQ4-11 · P3 · Sospecha · La estimación GPS no se valida sin lectura oficial
- **Dónde:** `lib/mantencion/gps-estimate.ts:69`.
- **Qué pasa:** un camión pasado a horas, sin lectura oficial y con un horómetro GPS sin calibrar, entra como estimación y nada la contrasta.
- **Arreglo:** exigir una lectura oficial para estimar, o marcarla «sin respaldo».
- **Verificación:** Sospecha. Se reproduce con un equipo sin registros y con horómetro GPS mayor que cero.

### UI4-13 · P3 · Rótulo · «Todos los estados» frente al chip «Mantención»
- **Dónde:** `components/mantencion/jefatura/equipos/equipment-filters.tsx:77` y `:60`.
- **Qué pasa:** el selector dice «Todos los estados» y su chip activo dice «Mantención: Sin lecturas». La columna se llama «Mantención» y el Excel «Estado».
- **Arreglo:** el mismo rótulo en selector, chip, columna y Excel.
- **Verificación:** Navegador.

### UI4-14 · P3 · Rótulo · «Exportar historial»
- **Dónde:** `components/mantencion/jefatura/equipos/equipment-detail-view.tsx:103`.
- **Qué pasa:** la regla A6 pide «Exportar Excel».
- **Verificación:** Lectura. Está en el área de la otra rama.

### Previos que siguen abiertos (Equipos)

| ID | Qué | Dónde hoy | Verif. |
|---|---|---|---|
| UIN-1 | La cabecera de la ficha tiene cinco acciones. En móvil son tres filas de botones antes de las pestañas. | `equipment-detail-view.tsx:283-287` | Navegador |
| PER-7 | La miga dice «Mantención › Equipos» y el menú marca «Flota › Vehículos». | `components/layout/nav-items.ts:187-205` | Navegador |
| EQN-2 | «Nuevo equipo» con el código de un vehículo de otra faena lo traslada con sólo `mant:equipment:manage`. | `equipment.ts:143-165,237`, `equipos/actions.ts:84` | Lectura |
| EQN-3 | «KA128» y «KA-128» no se reconocen como el mismo equipo. La vista previa dice válida y el guardado cae entero. | `equipment-resolve.ts:179-181,654`, `equipment-import.ts:280` | Lectura |
| EQN-4 | Parcial. Sigue «Lectura actual» en Incorporar y «Lectura inicial» en la ficha. | `fleet-incorporation-panel.tsx:257,289` | Lectura |
| EQN-5 | Parcial. `sin_preventiva` ya tiene texto de apoyo. Falta el botón «Declarar preventiva» y el aviso en «Falta completar». | `equipment-read-sections.tsx:77-82` | Lectura |
| EQN-7 | Con la preventiva declarada guardada y sin pauta, no se puede dar de baja hasta vaciarla. | `equipment-resolve.ts:454` | Lectura |
| EQN-10 | La declarada no es piso al validar una lectura. | `records-create*` (sin uso de `priorPreventive`) | Lectura |
| EQ-2 | Un cambio de tipo de km a horas, sin registros ni pauta, conserva 120.000 km como 120.000 h. | `equipment-resolve.ts:633` | Lectura |
| EQ-3 | «Nuevo equipo» e importar reescriben tipo, marca, modelo y año del vehículo de la flota. | `equipment.ts:168-170` | Lectura |
| EQ-4 | La baja no se confirma, su texto sólo habla de la app y apaga el vehículo en toda la plataforma. | `equipment-status-fields.tsx:192`, `equipment.ts:338` | Lectura |
| EQ-6 | Importar con una marca desactivada y la columna en blanco falla. | `equipment-import.ts:203,327-329` | Lectura |
| EQ-7 | Renombrar una marca no actualiza `fuel_vehicles.brand`. | `catalog-admin.ts:224-226` | Lectura |
| EQ-8 | El control de edición simultánea se omite si falta el campo, y no bloquea la fila. | `equipment.ts:395` | Lectura |
| EQ-11 | La ficha calcula el borrador de todas las pautas al cargar. | `flota/[id]/mantencion/page.tsx:103`, `form-catalogs.ts:183` | Lectura |
| EQ-14, EQ-15, EQ-17, EQ-21 | Parseo distinto de números entre formulario e importación. El formulario ofrece todas las faenas activas. Redirección permanente de `/mantencion/equipos/[id]`. Incorporar exige tipo activo. | `actions.ts:50`, `form-catalogs.ts:188`, `next.config.ts:117`, `fleet-incorporation.ts:81` | Lectura |
| UI-9 | «Estimación GPS · Al día» junto a «Sin lecturas» en la misma ficha. | `equipment-read-sections.tsx:108-142` | Lectura |

---

## 6. Pautas, catálogos y dispositivos

### EQ4-7 · P3 · UX · «Nueva pauta» pierde el nombre y los intervalos tras un error
- **Dónde:** `components/mantencion/jefatura/pautas/new-schedule-dialog.tsx:45,60`.
- **Qué pasa:** con un nombre repetido, el formulario muestra el error y borra el nombre y los intervalos. La unidad y la pauta de origen se conservan.
- **Arreglo:** controlar esos dos campos.
- **Verificación:** Lectura, confianza media.

### EQ4-8 · P3 · Hallazgo funcional · «Asignar equipos» con una selección vieja suelta equipos
- **Dónde:** `lib/services/mantencion/schedule-assign.ts:95-99` y `assign-equipment-dialog.tsx:170`.
- **Qué pasa:** un jefe abre el diálogo con dos equipos. Otro asigna un tercero desde «Editar mantención». Al guardar el primero, el tercero queda sin pauta, con «Pauta quitada» en su historial.
- **Arreglo:** enviar sólo lo agregado y lo quitado.
- **Verificación:** Lectura. Poco probable.

### EQ4-9 · P3 · Texto · «Cambia en todo lo que ya la usa» es falso para los aceites
- **Dónde:** `components/mantencion/jefatura/catalogos/catalog-entry-dialog.tsx:226`.
- **Qué pasa:** el aceite queda como texto en la correctiva. Al renombrarlo, los registros firmados conservan el nombre viejo.
- **Arreglo:** un texto por catálogo.
- **Verificación:** Lectura.

### EQ4-10 · P3 · Texto · «Quitar intervalo» describe como hecho lo que es un borrador
- **Dónde:** `components/mantencion/jefatura/pautas/schedule-intervals-card.tsx:81-90`.
- **Qué pasa:** el diálogo dice «N equipos asignados dejarán de tener la mantención de 10.000». Nada cambia hasta publicar.
- **Arreglo:** «cuando publiques…».
- **Verificación:** Lectura.

### UI4-6 · P3 · Paridad · «Dispositivos» valida el submódulo de Equipos
- **Dónde:** `app/(app)/mantencion/dispositivos/page.tsx:18` pasa `"/mantencion/equipos"`. Su acción usa `/mantencion/dispositivos` (`actions.ts:11`).
- **Qué pasa:** con Equipos apagado y Dispositivos encendido, la página manda a `/forbidden` y la acción funciona.
- **Arreglo:** pasar `"/mantencion/dispositivos"`.
- **Verificación:** Lectura ✓.

### Previos que siguen abiertos (Pautas y catálogos)

| ID | Qué | Dónde hoy | Verif. |
|---|---|---|---|
| EQN-13 | Publicar una pauta sólo dice «Versión N publicada», sin cuántos equipos cambian de estado. | `schedule-editor.tsx:46` | Lectura |
| UI-11 | El título «Marcas y talleres» cubre cinco catálogos: marcas, talleres, conductores, tipos de trabajo y aceites. | `catalogs-workbench.tsx:90-91` | Navegador |

---

## 7. Panel

### PAN4-6 · P2 · UX · El período no filtra Planificación
- **Dónde:** `lib/services/mantencion/looker/planning.ts:60` (el período sólo marca filas fuera de rango) y `:76-101` (la carga no filtra por fecha), `components/mantencion/panel/looker/filter-bar.tsx:107` (muestra el control en todas las pestañas) y `app/(app)/mantencion/panel/planificacion-tab.tsx:72,103`.
- **Qué pasa:** el usuario cambia el período y las tablas y los gráficos no se mueven. Si no hay diferencias que mostrar, el vacío dice «Sin mantenimientos con lectura programada y real en el período», lo que es falso. La nota de «fuera de rango» sólo aparece al pasar el cursor.
- **Evidencia:** el contenido de la pestaña es idéntico con «Noviembre 2026» y con «1 ene – 31 mar».
- **Arreglo:** ocultar el período en Planificación o decir arriba que es el estado de hoy. Cambiar el texto del vacío.
- **Verificación:** Navegador.

### PAN4-9 · P2 · Hallazgo funcional · Cambiar de pestaña borra período y faena
- **Dónde:** `components/mantencion/panel/looker/panel-tabs.tsx:11-13,35`.
- **Qué pasa:** los enlaces de las pestañas llevan sólo `?pestana=`. Quien elige «enero a octubre» y la faena Teno en Camiones y pulsa Máquinas vuelve al mes en curso y a todas las faenas.
- **Arreglo:** conservar `desde`, `hasta` y `faena`, y borrar sólo los filtros cruzados, el equipo, la frecuencia y la página.
- **Verificación:** Navegador. Cambiar la regla es decisión de producto.

### PAN4-14 · P2 · Rótulo · «Camiones» y «Máquinas» ya no describen su contenido
- **Dónde:** `panel-tabs.tsx:11-14`, `lib/services/mantencion/looker/filters.ts:112-116` (`tabUnit`) y `app/(app)/mantencion/panel/page.tsx:34-37`.
- **Qué pasa:** la pestaña se decide por la unidad del equipo y no por su tipo. Desde que los camiones de producción se miden en horas, aparecen en «Máquinas». Quien los busca en «Camiones» no los encuentra.
- **Evidencia:** en «Máquinas», 6 de los 11 trabajos del período son de camiones o tractocamiones.
- **Arreglo:** «Por kilómetros» y «Por horas». El Excel ya dice «equipos por kilómetros».
- **Verificación:** Navegador (`desk/06-panel-maquinas.full.png`). La línea de lectura lo puso en P3. Sube a P2 porque esconde a 62 equipos de la pestaña donde se los busca.

### PAN4-1 · P2 · Inconsistencia · El filtro por equipo fuerza la faena actual y esconde lo hecho en la anterior
- **Dónde:** `looker/filters.ts:166-175` (`worksiteIds = [cross.equipment.worksiteId]`), `looker/resolve.ts:117,229`, y las consultas que filtran por la faena del trabajo (`looker/corrective.ts:112,154,187`, `looker/preventive.ts:122,181`).
- **Qué pasa:** un camión pasó de Pacífico a Flor del Laja. Sus formularios y OT quedaron con faena Pacífico. En Camiones, «Cumplimiento por patente» lo muestra con tres pautas. Al pulsar su patente, el filtro fija Flor del Laja: la matriz, las barras por mes y los trabajos quedan en cero y dicen «No hay pautas…».
- **Arreglo:** con un equipo elegido, no pisar la faena. El equipo ya acota por sí solo.
- **Verificación:** Lectura ✓. El 25-11 se trasladaron 19 equipos a Flor del Laja en producción.

### PAN4-2 · P2 · Inconsistencia · En «Hoy», el enlace a un equipo trasladado se ignora en silencio
- **Dónde:** `app/(app)/mantencion/panel/trinorma-sections.tsx:270`, `maintenance-work.ts:713` (`resolvePanelEquipment` exige que el equipo esté hoy en la faena elegida), `hoy-tab.tsx:71` y `maintenance-work.ts:700`.
- **Qué pasa:** el Panel está en la faena A. Un equipo que trabajó en A y hoy está en B figura con tres correctivas. El enlace abre `?faena=A&equipo=X`, el equipo se descarta y se ve toda la faena A, sin aviso.
- **Arreglo:** validar el equipo contra el alcance del usuario y no contra la faena elegida.
- **Verificación:** Lectura.

### PAN4-3 · P2 · Inconsistencia · Una faena cerrada con historial no se puede elegir y sus enlaces se ignoran
- **Dónde:** `lib/services/mantencion/panel.ts:100-105` (el selector ofrece sólo faenas activas), `hoy-tab.tsx:66`, `app/(print)/mantencion/informe/report-data.ts:75`, `looker/resolve.ts:292` y `trinorma-sections.tsx:176`.
- **Qué pasa:** las cifras sí traen faenas inactivas. En «Hoy» aparece la barra «Pacífico 12 días» y su enlace lleva a `?faena=<Pacífico>`. La página descarta la faena y muestra todas, con el título «todas las faenas». En Camiones, la barra de faena y mecánico pierde la faena y queda sólo el mecánico. El Excel y el PDF repiten la omisión.
- **Arreglo:** ofrecer las faenas inactivas con historial, rotuladas «(inactiva)».
- **Verificación:** Lectura. Pacífico y Fábrica de Puertas se cerraron el 25-11.

### PAN4-5 · P2 · Bug latente · «Checklist de pauta (formularios)» no aplica el corte ni cuenta registros nativos
- **Dónde:** `maintenance-work.ts:736-748` (`loadScheduleCompliance`, sin la condición del corte) frente a `looker/preventive.ts:128,163-164`. Alimenta la cifra de `trinorma-sections.tsx:~270` y el PDF (`report-data.ts:111`).
- **Qué pasa:** desde el 01-12, Camiones y Máquinas ignoran las pautas de formularios posteriores al corte y cuentan los registros nativos. La cifra de «Hoy» sigue promediando formularios y no ve ningún registro nativo. Además promedia el porcentaje declarado, y las pestañas usan primero hechos sobre hechos más no hechos (`looker/preventive-summary.ts:30-34`).
- **Arreglo:** la misma regla en los dos lados, o rotular la cifra «sólo formularios, hasta el 30-11».
- **Verificación:** Lectura ✓. Empieza a notarse el 01-12.

### PAN4-4 · P2 · Inconsistencia · Los formularios importados por pantalla cuentan en «Hoy» y no en Camiones ni Máquinas
- **Dónde:** `historical-import.ts:167` (no escribe `action_type`), `maintenance-work.ts:~268` («Hoy» deduce el tipo del texto) y `looker/corrective.ts:108` (exige `action_type = 'correctiva'`).
- **Qué pasa:** se importa una exportación de Forms con una fila «CORRECTIVA» del equipo X. «Hoy» muestra «Equipos con más correctivas: X 3». En Camiones o Máquinas esa fila no aparece.
- **Arreglo:** la misma regla en `corrective.ts`, o que el importador llene `action_type`.
- **Verificación:** Lectura. El alcance depende de cuántas filas tengan el tipo vacío.

### PAN4-7 · P2 · UX · «Próxima mantención» dice «Sin pauta» a equipos que tienen pauta
- **Dónde:** `components/mantencion/panel/looker/planning-tables.tsx:148-149`. El estado real está en `row.state` (`planning.ts:55`) y no se usa.
- **Qué pasa:** un equipo con pauta y sin lectura inicial o sin preventiva muestra «Sin pauta». La causa real sólo está en el texto que aparece al pasar el cursor («Sin pauta o sin preventiva»). En «Faltantes» y en la tarjeta móvil dice «Sin dato».
- **Arreglo:** mostrar el estado real: «Sin lecturas», «Sin preventiva» o «Sin pauta».
- **Verificación:** Lectura ✓.

### PAN4-8 · P2 · UX · Los chips de mes, mecánico y frecuencia sólo mueven media pestaña
- **Dónde:** `looker/corrective.ts` (no lee mes, mecánico ni frecuencias) y `looker/filters.ts:300-336` (arma los chips sin decir a qué aplican).
- **Qué pasa:** en Camiones se pulsa la barra «oct 2026». Aparece el chip «Mes: oct 2026» y la mitad Correctivo sigue mostrando todo el período. «Conductor» tampoco actúa en la mitad Preventivo. «Frecuencia» significa una cosa en Planificación y otra en Preventivo.
- **Arreglo:** aplicar el mes al correctivo o decir en el chip a qué mitad aplica.
- **Verificación:** Lectura.

### NAV-10 · P3 · Visual · Columna vacía y una variación sin sentido
- **Dónde:** `app/(app)/mantencion/panel/work-tab.tsx` y `indicators-sections.tsx`.
- **Qué pasa:** en Camiones y Máquinas la mitad Preventivo termina a los 700 px y la mitad Correctivo sigue unos 2.500 px más. Queda media pantalla en blanco durante casi todo el recorrido. En «Hoy», «Días fuera de servicio» muestra «+7.833 % vs. período anterior».
- **Arreglo:** pasar Conductores y sus gráficos a la columna derecha, y acotar o reemplazar por texto las variaciones sobre una base casi nula.
- **Verificación:** Navegador (`desk/06-panel-maquinas.full.png`, `desk/02-panel-hoy.full.png`).

### PAN4-10 · P3 · UX · El gráfico por faena y mecánico muestra sólo los 12 mejores
- **Dónde:** `components/mantencion/panel/looker/preventive-panel.tsx:87` y `looker/preventive-summary.ts:71`.
- **Qué pasa:** con 30 combinaciones, los 18 de peor cumplimiento no se ven en pantalla. El Excel sí los trae.
- **Arreglo:** ordenar de menor a mayor, o mostrarlos todos con scroll.
- **Verificación:** Lectura.

### PAN4-11 · P3 · Inconsistencia · Una OT sin tipo y con las dos casillas cuenta distinto en cada mitad
- **Dónde:** `looker/corrective.ts:146` frente a `lib/mantencion/action-type.ts:~60`.
- **Qué pasa:** una OT sin tipo, con Reparación y Mantención marcadas, aparece como correctiva en Camiones y como «sin clasificar» en «Hoy».
- **Arreglo:** usar `workOrderActionType` en los dos lados.
- **Verificación:** Lectura.

### PAN4-12 · P3 · Inconsistencia · Conductores y foto de una OT cuentan registros anulados
- **Dónde:** `looker/corrective.ts:134,136`.
- **Qué pasa:** las subconsultas de conductores y de la foto no filtran por registro vigente. Una OT con un registro anulado atribuye horas al conductor equivocado.
- **Arreglo:** agregar `status = 'vigente'`.
- **Verificación:** Lectura, confianza media.

### PAN4-13 · P3 · Sospecha · Pautas en kilómetros de equipos hoy medidos en horas caen en «Máquinas»
- **Dónde:** `looker/preventive.ts:131` (el histórico filtra por la unidad actual del equipo).
- **Qué pasa:** un camión que ahora mide en horas tiene pautas de formularios con nivel «10.000 KM». «Máquinas» las muestra con niveles en kilómetros.
- **Arreglo:** rotularlas «unidad anterior» o dejarlas fuera de las medidas.
- **Verificación:** Sospecha. Se reproduce con uno de los 62 equipos y abriendo Máquinas.

### PAN4-15 · P3 · UX · Rótulos y recortes
- **Dónde y qué:**
  - «Horas» en Conductores y en «Horas y registros por equipo» son horas hombre, junto al horómetro en horas (`corrective-panel.tsx:~160,190`). El Excel dice «Horas hombre».
  - «Horas y registros por equipo» muestra 8 equipos sin decirlo (`looker/corrective.ts:398`).
  - Los gráficos de Planificación muestran 12 equipos sin decir cuántos faltan (`planificacion-tab.tsx:16`).
  - «% de cumplimiento por mes» omite los meses sin pautas (`preventive-panel.tsx:38-40`).
  - `work-tab.tsx:45` escribe «30-11-2026» y «01-12-2026» a mano en vez de usar `FORMS_CUTOVER_DATE`.
- **Verificación:** Lectura.

### PAN4-16 · P3 · Rendimiento · Cada pestaña repite las mismas consultas
- **Dónde:** `looker/work-data.ts:46-65` y `looker/corrective.ts:~355`.
- **Qué pasa:** `loadComplianceChecks` corre cuatro veces por carga y `loadCorrectiveSummary` lee todas las filas del período dos veces, con subconsultas por fila. Con el mes por defecto es aceptable. Con un período de cinco años crece con todo el historial.
- **Arreglo:** cargar una vez y derivar los resúmenes en memoria.
- **Verificación:** Lectura. El costo real no se midió.

### Previos que siguen abiertos (Panel)

| ID | Qué | Dónde hoy | Verif. |
|---|---|---|---|
| PAN-5 | La franja «Hoy» pinta «Registros por revisar» en tono de alerta a quien no puede revisar. | `components/mantencion/jefatura/panel/panel-today.tsx:52,72,83` | Lectura |
| PAN-4 | Cambió. «Días fuera de servicio» ya une las fichas, pero su enlace lleva a la lista de hoy. | `indicators-sections.tsx:~330` | Lectura |
| PANN-5 | Parcial. El enlace «Órdenes de trabajo» de la sección Trabajos sigue perdiendo el equipo. | `trinorma-sections.tsx:~74` | Lectura |
| PANN-6 | El tiempo medio de reparación divide por todas las reparaciones cerradas, no por las medidas. | `indicators.ts:323`, `work-orders/metrics.ts:245` | Lectura |
| PANN-7 | «Fallas abiertas» enlaza sin período ni equipo. | `reporte-equipos-section.tsx:56` | Lectura |
| PANN-10 | En el PDF el tiempo medio sale siempre en horas. La pantalla pasa a días sobre 48 h. | `informe-document.tsx:245` | Lectura |
| PANN-12 | El Excel de «Hoy» no valida el orden ni el tope del rango. | `panel/actions.ts:34-41` | Lectura |
| PANN-13 | «Reportes de equipos» se carga sin exigir el permiso de Inspecciones. El permiso sólo apaga los enlaces. | `hoy-tab.tsx:132` | Lectura |
| PANN-15, PANN-16 | El filtro «Equipo» lista vehículos sin ficha de Mantención. `panel-coverage.ts` sólo lo importa su prueba. | `maintenance-work.ts:~700`, `panel-coverage.ts` | Lectura |

---

## 8. App del mecánico

Todo sale de lectura de código, salvo lo que se indica. La app se abrió en el navegador sólo para una pasada visual.

### APP4-2 · P2 · Bug de producto · «Crear registro corregido» pierde el vínculo con la OT
- **Dónde:** `components/mantencion/jefatura/registros/record-actions.tsx:183` (el enlace sólo lleva `corregir=<id>`), `components/mantencion/app/mant-app.tsx:123-128`, `lib/mantencion/contracts.ts:441` (el registro propio no trae `workOrderId`), `lib/services/mantencion/records-create-parts.ts:97-98` y `record-lifecycle.ts:84-96`.
- **Qué pasa:** el mecánico firma una correctiva desde su OT con un repuesto reservado. Jefatura la anula: el stock se repone y la OT queda sin registro vigente. El mecánico abre el enlace y el borrador nace sin OT. No ofrece «Disponibles para esta OT», no queda enlazado y la OT sigue sin poder terminarse. Tiene que repetir el trabajo desde la OT, y por esa vía el registro no queda marcado como corrección.
- **Arreglo:** llevar `workOrderId` en los registros propios y en el enlace, y precargarlo en el borrador.
- **Verificación:** Lectura.

### APP4-1 · P2 · Bug de producto · Volver a entrar con la contraseña propia abre la app como otra cuenta
- **Dónde:** `lib/mantencion/client/bootstrap.ts:63,96-98`.
- **Qué pasa:** teléfono compartido. A entra con su contraseña, cambia a B por PIN y trabaja como B. La sesión de A vence y A vuelve a entrar con su contraseña. Como la última sesión guardada es la de A, el arranque no lo trata como un inicio nuevo y deja activa la cuenta guardada, B.
- **Arreglo:** un inicio de sesión explícito gana siempre.
- **Verificación:** Lectura ✓. No comprobé si la app pide el PIN de B antes de dejar trabajar, lo que reduciría el riesgo. Se reproduce en un navegador con dos cuentas.

### APP4-3 · P2 · Bug de producto · El reintento no se reinicia al volver la señal y no hay «Enviar ahora»
- **Dónde:** `lib/mantencion/client/queue.ts:101` (cada intento suma), `:24-26` (espera de hasta 15 minutos) y `sync-engine.ts:71-75,174,245`.
- **Qué pasa:** con wifi sin salida a internet, cada sondeo de 60 segundos falla y alarga la espera. Al volver la señal, el primer elemento puede esperar hasta 15 minutos, y los que dependen de él esperan con él. «Actualizar» sólo refresca el catálogo. El mecánico ve «N por enviar» y no puede forzar el envío.
- **Arreglo:** no contar los fallos de red como intentos, o reiniciar la espera al volver la señal y con un botón «Enviar ahora».
- **Verificación:** Lectura.

### APP4-7 · P2 · Bug de producto · Un registro rechazado por fotos faltantes entra en bucle
- **Dónde:** `sync-engine.ts:106-123`, `lib/mantencion/client/flow-record.ts:186,214`, `flow-validate.ts:243` y `components/mantencion/app/photo-slot.tsx:50,55,81`.
- **Qué pasa:** el almacenamiento del teléfono se vació y faltan las imágenes. El registro queda «Por corregir: Faltan fotos». Al corregirlo, las fotos se ven «Lista» sin imagen porque el borrador reutiliza los ids. El mecánico firma y recibe el mismo rechazo. La única salida es descartar.
- **Arreglo:** al abrir el borrador, quitar los ids cuya imagen no existe para que el paso muestre «Falta».
- **Verificación:** Lectura. Falta el disparador real, que es la limpieza del almacenamiento.

### APP4-4 · P2 · Hallazgo funcional · El reloj del teléfono mal puesto no se detecta
- **Dónde:** `lib/mantencion/client/freshness.ts:71` (la app ya mide la hora del servidor), `flow-types.ts:138`, `ot-time.ts:4`, `lib/services/mantencion/records-create-validate.ts:33`, `workshop-updates.ts:196,221-225` y `work-orders/transitions.ts:127`.
- **Qué pasa:** con la fecha adelantada, las validaciones del teléfono pasan porque comparan consigo mismo. El servidor rechaza después el registro, la novedad de taller o el ingreso con «no puede ser futura». Las fotos quedan selladas con la fecha equivocada. El mecánico se entera en «Por corregir» sin saber que la causa es el reloj.
- **Arreglo:** guardar la diferencia con la hora del servidor al arrancar y avisar o bloquear la firma.
- **Verificación:** Lectura, confianza media-alta.

### APP4-5 · P2 · Inconsistencia · Lo enviado que no es registro se compara con el reloj del teléfono
- **Dónde:** `queue.ts:113-114` (guarda la hora del teléfono), `lib/mantencion/client/api.ts:261-268` (descarta la hora del servidor) y `ot-model.ts:124-129,210-223`.
- **Qué pasa:** con el teléfono adelantado, una nota de pedido ya enviada sigue como «Pedido · por enviar» junto a su línea real, hasta que pase la diferencia. Con el teléfono atrasado, la OT vuelve a mostrar «Registrar ingreso» y el segundo intento da 409.
- **Arreglo:** guardar la hora de recepción del servidor, como ya se hace con los registros.
- **Verificación:** Lectura.

### APP4-6 · P2 · Inconsistencia · Tras un traslado, la app muestra la faena de imputación de la OT
- **Dónde:** `work-orders/catalog-items.ts:58,102` frente a `work-orders/sync-ops.ts:101-118` y `fleet-transfers.ts:352`.
- **Qué pasa:** el equipo pasa de A a B con una OT abierta asignada a un mecánico de B. Su teléfono dice «Equipo de otra faena (A). Puedes trabajarla igual», aunque el equipo ya está en su faena. Contradice la decisión de que la OT sigue al equipo.
- **Arreglo:** calcular los dos campos con la faena actual del vehículo.
- **Verificación:** Lectura. En la pasada visual el aviso apareció, pero el perfil de prueba tenía siete faenas, así que no sirve de evidencia.

### APP4-8 · P3 · UX · La pantalla de error de arranque no tiene salida
- **Dónde:** `components/mantencion/app/boot-screens.tsx:36` y `app/(mecanico)/mant-app.css:36`.
- **Qué pasa:** con el servidor fallando en la primera apertura, la pantalla dice «Intenta de nuevo en unos minutos» y no tiene botón. Como se desactivó tirar para recargar, la app instalada sólo se sale cerrándola. El mensaje puede salir crudo y en inglés.
- **Arreglo:** un botón «Reintentar» y traducir los errores del almacenamiento.
- **Verificación:** Lectura.

### APP4-9 · P3 · UX · La hora de «Equipos al…» no se actualiza
- **Dónde:** `lib/mantencion/client/catalog-sync.ts:43-52` y `components/mantencion/app/home-screen.tsx:184`.
- **Qué pasa:** al pulsar «Actualizar» dice «ya estaban al día» y el pie sigue con la hora de la última descarga completa.
- **Arreglo:** actualizar la hora también cuando no hay cambios.
- **Verificación:** Lectura.

### APP4-12 · P3 · UX · Reintento eterno sin aviso por elemento
- **Dónde:** `sync-engine.ts:101-102`.
- **Qué pasa:** un elemento que el servidor contesta siempre con error reintenta cada 15 minutos para siempre, como «En el teléfono». Sólo sale el aviso general de más de 24 horas.
- **Arreglo:** un estado visible tras varios intentos.
- **Verificación:** Lectura, confianza media.

### APP4-13 · P3 · Limpieza · Código sin uso
- **Dónde:** `queue.ts:150` (`discardWorkshopFor`), `lib/mantencion/client/accounts.ts:34` (`removeAccount`) y `photo-store.ts:24` (`deletePhoto`).
- **Verificación:** Lectura.

### Previos que siguen abiertos (App)

| ID | Qué | Dónde hoy | Verif. |
|---|---|---|---|
| APP-4 | Tras un 403, los envíos quedan pidiendo entrar de nuevo hasta 23 días. «Entrar de nuevo» recarga y no lo arregla. | `sync-engine.ts:78-90`, `bootstrap.ts:67-77`, `mant-app.tsx:139` | Lectura |
| APP-6 | Cualquier respuesta 2xx se da por enviada sin mirar el cuerpo. | `api.ts:228,267` | Lectura |
| APP-9 | «Quitar» una foto la borra al instante, sin deshacer. | `photo-slot.tsx:37-43,105` | Lectura |
| APP-10 | El botón Atrás de Android no se maneja. | `components/mantencion/app`, `lib/mantencion/client` | Lectura |
| APP-11 | Campos sin tope de largo, y el mensaje de validación sale en inglés. En las observaciones cualquier error dice «Escribe tu respuesta.». | `step-trabajo.tsx:89`, `flow-record.ts:114`, `observation-sheet.tsx:24` | Lectura |
| APP-12 | «Acceso revocado» nunca se ve: revocar cierra la sesión web y el mecánico lee «sesión venció». | `device-credentials.ts:337-338` | Lectura |
| APP-13, APP-14 | Sin señal, lo «sin actualizar» no se recalcula. La pantalla congela el día de hoy. | `fleet-view.ts:181`, `flow-screen.tsx:51` | Lectura |
| APP-15 | Cada autoguardado relee cuentas, catálogo y cola y recalcula toda la flota. | `use-device-data.ts:13` | Lectura |
| APP-17 | Las rutas de sincronización leen el cuerpo sin tope y consultan la base antes del límite de tasa. | `sync-http.ts:31`, `sync-auth.ts:63-75` | Lectura |
| APP-20, APP-21, APP-22, APP-23 | Un enlace abre la plataforma en otra pestaña. La miniatura se genera en cada petición. «1234.50» se lee como 123.450. Los pendientes de entrar se cuentan como «por enviar». | `step-lectura.tsx:85`, `photos.ts`, `lib/mantencion/format.ts:58-64`, `home-screen.tsx:150` | Lectura |
| APPN-7 | Un 401 de una credencial ya reemplazada marca la nueva como vencida. | `accounts.ts:87` | Lectura |
| APPN-8 | Los avisos del servidor para las operaciones de OT se descartan. | `api.ts:261-268` | Lectura |
| APPN-9 | La app no muestra «sin preventiva» en el selector ni en «Le toca». | `equipment-picker.tsx:62`, `fleet-view.ts:161-163` | Lectura |
| APPN-11, APPN-12, APPN-13 | Error de arranque crudo. `role="status"` que se anuncia en cada tecla. «Corregir y reenviar» sin salida si el equipo salió de la lista. | `boot-screens.tsx:36`, `trabajo-parts.tsx:38`, `mant-app.tsx:146` | Lectura |
| APPN-14 | Hoja de alto fijo con el teclado abierto. | `mant-app.css:165` | Sospecha |

---

## 9. Permisos y navegación

### UI4-5 · P3 · Paridad (latente) · `mant:ot:manage` y `mant:schedules:manage` no miran la faena
- **Dónde:** `work-orders/access.ts:112` (sólo recepción y conformidad miran la faena), `transitions.ts:63,92,174,320,424,484,506`, `app/(app)/mantencion/pautas/[id]/actions.ts:103-125` y `schedule-assign.ts:76`.
- **Qué pasa:** un rol no global con esos permisos podría asignar, anular o reabrir una OT de otra faena por su id, o asignar una pauta a equipos ajenos. Hoy sólo `jefe_mantencion`, que es global, los tiene.
- **Arreglo:** validar la faena para actores no globales, o documentar que son permisos globales.
- **Verificación:** Lectura. Viene del 16-11 como PER-2.

### UI4-7 · P3 · Navegación · `/mantencion` manda a `/forbidden` a roles con ítem en el menú
- **Dónde:** `app/(app)/mantencion/page.tsx:16-19`.
- **Qué pasa:** la raíz no contempla `mant:ot:execute`, `mant:np:*` ni los permisos de configuración. Un rol a medida con sólo uno de ellos ve su ítem en el menú y la raíz le niega el paso. Con los roles por defecto no ocurre.
- **Arreglo:** derivar el destino del primer ítem del menú que el usuario ve.
- **Verificación:** Lectura. Viene como PER-5.

### UI4-9 · P3 · Paridad · El Excel de OT no exige `mant:export`
- **Dónde:** `app/(app)/mantencion/ot/actions.ts:75`.
- **Qué pasa:** un mecánico con sólo `execute` exporta sus OT sin tener el permiso de exportar. El alcance sí se aplica. Registros, Equipos y Pautas lo exigen.
- **Arreglo:** decidir y documentar.
- **Verificación:** Lectura. Viene como PER-3.

### UIN-2 · P3 · Inconsistencia (previo) · Tres textos para «fuera de tu alcance»
- **Dónde:** `components/not-found-panel.tsx:26,31,35`.
- **Qué pasa:** una OT o un registro de otra faena dicen «No encontramos este registro», también cuando es una OT. La ficha de un equipo ajeno dice «Recurso no encontrado» al supervisor y «Esta dirección no existe» al administrador de contrato.
- **Arreglo:** un solo texto, con el nombre correcto de lo que se buscaba.
- **Verificación:** Navegador (perfiles `supervisor` y `contrato`).

### Previos que siguen abiertos (Permisos y navegación)

| ID | Qué | Dónde hoy | Verif. |
|---|---|---|---|
| PER-8 | El menú no muestra contador de pendientes para OT ni para notas de pedido. | `modules/mantencion-equipos/manifest.ts` | Lectura |
| PERN-1 | La descripción de `mant:export` no menciona el Panel ni el Historial. Ver UI4-8. | `manifest.ts:51` | Lectura |
| PER-6 | Cifras de Flota y de Control operacional frente a la lista. | Sin verificar: pide ejecución | — |
| EQ-9 | Asignar equipos a una pauta sin alcance por faena. Ver UI4-5. | `pautas/[id]/actions.ts:110` | Lectura |

---

## Anexo: qué se reprodujo y con qué datos

| Hallazgo | Dato de prueba | Resultado |
|---|---|---|
| OT4-6 | `OT-CHO-0015` | Descripción y trabajo anexo borrados al elegir «Preventiva». |
| OTN-6 | `OT-STF-0024` | «8.100» guardado como 8,1. |
| REG4-1 | `OT-BIO-0005` y `MC-BIO-0018` | Historial de 100 a 99 trabajos. |
| NP4-7 | `NP-2026-0001` y `NP-2026-0005` | Siguen en «Pendientes» tras anular la OT. |
| NP4-3 | `NP-2026-0003` | Cerrada con 2 de 4. |
| NP4-4 | `NP-2026-0002`, línea 1 | «Llegó 2» con la reserva liberada. |
| NP4-6 | `NP-2026-0002` | No se deja anular tras liberar. |

La base `bodega_e2e_auditmant` quedó con esas mutaciones. Los guiones para repetirlas están en `~/backups-dev/mock-2026-11-26-e2e-auditmant/` (`interact2.mjs`, pasos M1 a M4) y las capturas en `audit/mantencion-2026-11-26/`.
