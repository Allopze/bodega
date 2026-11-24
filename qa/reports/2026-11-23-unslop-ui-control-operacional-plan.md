# unslop-ui: Control operacional, segunda pasada (plan, 2026-11-23)

**Estado: ejecutado en la rama `chore/unslop-ui-control-operacional` (sin push ni fusión).** Las secciones 1 a 8 son la especificación original, tal como se escribió antes de aplicarla; el resultado de aplicarla, lo que no se aplicó y lo que se verificó está en la **sección 9**. Léela primero.

Alcance de esta pasada: lo que el primer pase no leyó en Combustibles, Flota y Mantención. 14 agentes de solo lectura leyeron cada pantalla completa (no sólo coincidencias de búsqueda) y buscaron en tests cada texto antes de proponerlo. Yo releí el código de las filas marcadas con ⚑.

**Verdict: Light.** No hay eyebrows en mayúsculas, emojis, puntos que pulsan, franjas de color, badges decorativos ni vocabulario de IA. Los tells son prosa que narra la pantalla o repite la etiqueta (U3/U4/U5/U7), unas pocas flechas, dos títulos que no corresponden al dato y fechas fijas.

Cómo leerlo: `old → new`; `⚑` = releído por mí en el código; `L` = lo fija un test (se indica si el texto nuevo lo sobrevive). Antes de aplicar hay que volver a buscar cada texto viejo en `e2e/` y en todos los tests, y correr los tests de cada carpeta tocada (la búsqueda de los agentes se truncó en algunos casos).

---

## 1. Defectos que no son sólo de estilo (aplicar primero)

| Dónde | Problema | Cambio |
|---|---|---|
| `app/(app)/mantencion/panel/work-tab.tsx:55` ⚑ | Fechas de corte fijas en texto visible: «hasta el 30-11-2026 … desde el 01-12-2026». Caducan si el corte cambia. | Usar `formatDate(FORMS_LAST_COUNTED_DATE)` y `formatDate(FORMS_CUTOVER_DATE)`, como ya hace `trinorma-sections.tsx:80-83`. Buscar en tests el literal «30-11-2026». |
| `app/(app)/mantencion/panel/reporte-equipos-charts.tsx:48` ⚑ | El título dice «Reportes recibidos por día» aunque la granularidad pueda ser mes (`unit` ya existe en la línea 45). | Título con `unit`: «Reportes recibidos por día» o «por mes» según corresponda. Buscar qué test asserta el título. |
| `app/(app)/combustibles/[id]/edit-fuel-load-form.tsx:257, :314, :182, :354` y `components/combustibles/load-detail/meter-correction-dialog.tsx:129` | Grafías distintas para lo mismo entre la edición y el alta. | «Nro factura/boleta» → «N.º de factura o boleta»; «IVA (19%)» → «IVA (19 %)»; «Guardando...» → «Guardando…». |
| Módulo Mantención (`equipment-plan-fields.tsx:49`, `assign-equipment-dialog.tsx:79`, `schedule-brand-rules.tsx:61`, `meter-correction-dialog.tsx:115`) | «Solo» y «sólo» mezclados. | Unificar en «Sólo». Obliga a actualizar 2 aserciones de `components/__tests__/mantencion-jefatura-ui.test.tsx:277 y :318`. |

---

## 2. Combustibles

### Registrar carga, nueva factura, asistente de terreno (el asistente también lo usa la PWA pública /tae)

| Dónde | Regla | Cambio |
|---|---|---|
| `cargas/registrar/registrar-form.tsx:162` | U8 | «¿Dónde estás cargando? Si la faena tiene un solo punto de carga, se elige solo.» → «Elige la faena y el punto de carga.» |
| `registrar-form.tsx:206` | U3 | «Esta carga queda con la fecha y la hora que indicaste. La plataforma guarda además el día en que la ingresas y el motivo.» → «Queda con la fecha y hora que indicaste.» |
| `cargas/registrar/otro-dia.tsx:87` | U5 | «Las fotos son opcionales. La carga queda con la fecha que indicas, por decidir en «Por revisar», y la plataforma anota además el día en que la ingresas.» → «Las fotos son opcionales.» |
| `cargas/registrar/page.tsx:98` | U4, A4 | «Para registrar una carga hace falta una faena a tu alcance con un punto de carga activo (surtidor, camión surtidor, bidón…). Se crean en Ajustes.» → «Se registra en una faena a tu alcance con un punto de carga activo. Los puntos se crean en Ajustes.» (la variante sin permiso conserva su CTA) |
| `components/combustibles/field-load/step-review.tsx:87` | U3 | «Revisa que todo esté bien. Si algo no coincide, toca «Cambiar».» → «Si algo no coincide, toca «Cambiar».» |
| `step-vehicle.tsx:52` | U5 | «Para encontrarlo más rápido, escribe parte del código o la patente en el filtro de arriba.» → «Escribe parte del código o la patente en el filtro de arriba.» |
| `step-vehicle.tsx:56` | U7 | placeholder «Busca por código o patente» → «Código o patente» (el `aria-label` queda: L `field-load-wizard.test.tsx:52`) |
| `step-seals.tsx:37` ⚑ | U7 | «No hay sello (no había sello)» y «(no puse sello)» → «No hay sello» |
| `step-seals.tsx:31` | U7 | «El número grabado en el sello. No uses 000000 ni números repetidos.» → «No uses 000000 ni números repetidos.» |
| `step-people.tsx:39` | U3 | «Con guion, por ejemplo 12345678-9. Es lo más rápido.» → «Con guion, por ejemplo 12345678-9.» |
| `[id]/edit-fuel-load-form.tsx:323` | U5, W14 | «Cambiaste los litros: el IEC (CLP por litro) y el total se recalculan al guardar con las tasas vigentes. Los valores de arriba son los de la carga actual.» → «Cambiaste los litros. El IEC y el total se recalculan al guardar con las tasas vigentes; los valores de arriba son los actuales.» |
| `edit-fuel-load-form.tsx:345` | U3 | «Esta acción no se puede deshacer. La carga y sus montos asociados serán eliminados permanentemente.» → «Se elimina la carga y sus montos. No se puede deshacer.» |
| `new-fuel-load-form.tsx:154`, `edit-fuel-load-form.tsx:274` | U5 | quitar «Queda registrado en la carga con tu explicación.» |
| `load-detail/meter-correction-dialog.tsx:81` | U5 | «Si la foto trae una lectura sugerida automáticamente, no se aplica hasta que guardes esta corrección.» → «La lectura sugerida por la foto no se aplica hasta que guardes la corrección.» |
| `meter-correction-dialog.tsx:115` | U5 | «Esta lectura deja de compararse con las anteriores y pasa a ser el punto de partida del rendimiento.» → «Esta lectura pasa a ser el punto de partida del rendimiento.» |
| `load-detail/review-request-control.tsx:115, :118-119` | length, U5 | título «Esta carga ya tiene un pedido de revisión» → «Ya hay un pedido de revisión»; quitar «; quien decide la ve junto al dato que explica el caso» |

### Bandeja «Por revisar» y Panel

| Dónde | Regla | Cambio |
|---|---|---|
| `components/combustibles/inbox/case-weeks-chart.tsx:81` | U4 | «…es la semana en curso: todavía no termina.» → «…es la semana en curso.» (L `case-weeks-chart.test.tsx:38`, regex, sobrevive) |
| `inbox-evidence.tsx:37` | U13 | borrar «El punto es la lectura de esta carga.» |
| `inbox-evidence.tsx:118` | U5 | → «El rango es el promedio de las N cargas válidas del equipo, más y menos el múltiplo de desviación estándar que fijan los umbrales de Ajustes.» |
| `inbox-evidence.tsx:76`, `inbox-detail-sheet.tsx:86, :91` | U21 | quitar el ícono `ArrowSquareOut` (↗) de enlaces internos: «Abrir la carga», «Abrir el lote», «Ficha del equipo» |
| `inbox-detail-sheet.tsx:27` | U3 | quitar «Tu decisión queda registrada con tu nota.» |
| `case-actions.tsx:76, :81, :134` | U3, U7 | «Al tomar el caso quedas como responsable y lo ven todos.» → «Quedas como responsable.»; «Quien lo tiene en sus manos. Puedes pasárselo…» → «Puedes pasárselo a otra persona de la faena.»; borrar placeholder «Añadir un comentario…» |
| `decide-load-buttons.tsx:83` | U3 | «Mínimo 10 caracteres. Queda registrada con tu nombre.» → «Mínimo 10 caracteres.» |
| `reopen-decision-button.tsx:60` | U5 | → «Mínimo 10 caracteres. Puede volver a «Pendientes».» |
| `resolve-request-form.tsx:40` | U3 | «Quien pidió la revisión recibe el aviso con tu nota.» → «Quien lo pidió recibe el aviso.» |
| `components/combustibles/panel/panel-field.tsx:40` | U3 | borrar «Equipo, medidor, litros, sellos y personas, una pregunta por pantalla.» |
| `panel-field.tsx:119` | U4 | «Lo que está pendiente y puedes corregir, con lo más urgente arriba. Lo nuevo lleva un punto hasta que lo abres.» → «Lo pendiente que puedes corregir, lo más urgente arriba. Lo nuevo lleva un punto hasta abrirlo.» |
| `panel-field.tsx:82` | A4 | «Cuando registres una desde la plataforma, aparece acá con su estado.» → «Se llena cuando registres una, con su estado.» |
| `app/(app)/combustibles/revisar/actions.ts:34` | U8 | «Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente.» → «Sin conexión al servidor. Revisa la conexión y reintenta.» |

### Fuentes, importar, ajustes

| Dónde | Regla | Cambio |
|---|---|---|
| `ajustes/medios/supply-media-table.tsx:146` y `:176` | U3 | borrar «Los alias son los textos con que este medio aparece en las planillas; se guardan en mayúsculas.» y pasar «Se guardan en mayúsculas.» al texto de ayuda del campo Alias |
| `ajustes/puntos-de-carga/new-loading-point-button.tsx:59` | U3 | quitar «El lugar donde se carga combustible.»; queda «Después podrás generar su QR.» |
| `importar/operations-import-wizard.tsx:220-225` | U5 | «A diferencia del reporte de tarjeta por patente, este archivo abarca varias faenas…» → «Consolidado de cargas por transacción, con varias faenas y períodos.» |
| `operations-import-wizard.tsx:235` | U3 | «Mismas columnas que lee el importador, con una hoja de instrucciones (formatos y unidades).» → «Incluye una hoja con formatos y unidades.» |
| `operations-import-wizard.tsx:195` | W30 | «se omitirán automáticamente al confirmar» → «se omitirán al confirmar» |
| `importar/import-wizard-primitives.tsx:39` | U4 | «…y N errores más. Usa el botón de arriba para descargar la lista completa.» → «…y N más. Descárgalos con el botón de arriba.» |
| `fuentes/copec-period-review.tsx:63-66` | U5 | → «Filas que esperan una decisión. Las válidas ya se importaron; cerrar el mes no las toca.» |
| `copec-period-review.tsx:132` | U5 | «Es un cierre terminal: la sincronización no volverá a pedir ese mes.» → «Queda cerrado y la sincronización no volverá a pedir ese mes.» |
| `fuentes/revert-file.tsx:45` | U5 | «El archivo y su historial se conservan para trazabilidad. Queda registrado en la auditoría. Esta acción no se puede deshacer.» → «El archivo y su historial se conservan. Queda en la auditoría y no se puede deshacer.» |
| `fuentes/agregar/sellos/tae-import-report-form.tsx:100-103` | U5 | descripción de tres frases → «Sube el Excel antiguo y descarga el reporte de equivalencias. Revísalo antes de importar.» |
| `tae-import-report-form.tsx:164` | U5 | quitar «El plan usa sólo coincidencias confiables o decisiones ya guardadas.» |
| `fuentes/archivos/[tipo]/[id]/planilla-detail.tsx:95` | U5 | «Las que no cuadran (lectura menor que la anterior, proveedor desconocido) se importaron y quedaron en «Por revisar».» → «Lo que no cuadra queda en «Por revisar».» |
| `planilla-detail.tsx:127` | U3 | «Las cargas de estas faenas no llegan a ninguna faena de la plataforma hasta asociarlas.» → «Sus cargas no se asignan a faena hasta vincularlas.» |
| `planilla-detail.tsx:154` | length | título «Muestra de registros (los primeros 50 por fecha, de N)» → «Muestra de registros», y «Primeros 50 por fecha, de N.» en la descripción (volver a buscar el título en tests sin límite de resultados) |
| `sellos-detail.tsx:129` | length | «Resumen de tus faenas en el archivo» → «Tus faenas en el archivo» |
| `sellos-detail.tsx:183` | U5 | → «Se aplica desde la próxima importación; no corrige las cargas ya importadas.» |
| `tarjeta-detail.tsx:106` | U5 | «Quedan registradas para corregirlas y reprocesar el archivo.» → «Corrígelas y reprocesa el archivo.» |

### Cuadratura

| Dónde | Regla | Cambio |
|---|---|---|
| `cuadratura/estanques/estanques-sections.tsx:225` | U5 | → «Parte de lo registrado antes del período («Al inicio») y suma el movimiento del rango. No distingue merma de carga no registrada: falta el aforo físico periódico.» |
| `estanques-sections.tsx:293` | U21 | quitar `ArrowSquareOut` de «Abrir carga» (enlace interno) |
| `estanques/cycle-workbench.tsx:56` | U3 | «El registro queda auditado y entra en la cuadratura del período.» → «Queda auditado y suma a la cuadratura del período.» |
| `sellos/history-section.tsx:60, :61` | U4 | «Sólo aparecen las cargas ya validadas que retiraron o instalaron un sello. Prueba con…» → «Cargas validadas que retiraron o instalaron un sello. Prueba con…» |
| `history-section.tsx:68-69` | U5 | → «{n} movimientos. Ámbar: sello repetido o sin retiro posterior. «Vigente»: último sello del equipo.» («Vigente» L `sections.test.tsx:338`, la insignia no cambia) |
| `history-section.tsx:71` | U5 | «…para que los avisos de continuidad sean completos.» → «…para ver todos los avisos.» |
| `sellos/supervisors-section.tsx:103` | U5 | «…no cuenta como cadena rota: todavía no hay una carga siguiente que lo retire.» → «…no cuenta como cadena rota: aún no tiene carga siguiente.» (L `sections.test.tsx:285`, substring, sobrevive) |
| `tarjeta-y-terreno/coverage-table.tsx:71` | U5 | → «Registro que se extiende más allá del rango: sus litros no se suman. Amplía el período para verlos completos.» |

### Consumo

| Dónde | Regla | Cambio |
|---|---|---|
| `_indicadores/consumo-section.tsx:162` | U5 | → «Se llenan con cargas de terreno, la planilla o los reportes de tarjeta. Agrega alguna para ver litros, costo y rendimiento.» |
| `consumo/rendimiento/[familia]/family-filters.tsx:90` | U8 | etiqueta «¿Por dónde llegó el combustible?» → «Medio de suministro» |
| `family-filters.tsx:75` | U3 | «Tipo de rendimiento, medio de suministro y equipo. Se suman a la faena y al mandante.» → «Se suman a la faena y al mandante.» |
| `rendimiento/[familia]/stats-tables.tsx:144` | U5 | → «Tienen cargas, pero sin lecturas de medidor para calcular el rendimiento. Se completan con las lecturas de cada carga.» |
| `consumo/_components/charts/overview-meter-chart.tsx:34` | U4 | «Aparecen cuando hay cargas consecutivas con lectura del medidor y sin revisión pendiente.» → «Se necesitan cargas consecutivas con lectura de medidor y sin revisión pendiente.» |
| `consumo/_components/charts/idle-daily-chart.tsx:32` ⚑ | U16 | quitar `<Legend>` de 2 series: los ejes ya llevan «horas» y «% en vacío». Mirarlo en el navegador (el tooltip sigue nombrando cada serie). |

### Pagos y Cargas (de la lectura anterior, aún sin aplicar)

Ver las filas de Cargas y Pagos del plan anterior en la conversación (cargas-workbench, historial, load-detail, estados de cuenta, new-statement-dialog, statements-table). Siguen vigentes.

---

## 3. Flota

| Dónde | Regla | Cambio |
|---|---|---|
| `flota/[id]/_ficha/vehicle-ownership-button.tsx:131` | U7 | «Marca que la faena de origen está registrada, pero falta confirmar dónde está el equipo hoy.» → «Faena registrada; falta confirmar dónde está el equipo hoy.» |
| `[id]/flota/personal-use-sheet.tsx:72` | U5 | «En esos días el equipo no suma costos, litros, km ni horas en las cifras de gestión. Los pagos y los registros no cambian.» → «En esos días el equipo no suma costos ni consumo en las cifras de gestión.» |
| `[id]/flota/vehicle-personal-use-card.tsx:75` | A4 | → «Márcalo cuando el dueño se lleve el equipo; esos días no cuentan en costos ni consumo.» |
| `vehicle-personal-use-card.tsx:121` | U4 | «Las cifras de costos y consumo de esos días vuelven a contar en las cifras de gestión del equipo.» → «Esos días volverán a contar en costos y consumo.» |
| `[id]/fleet-documents-panel.tsx:109` | U4 | «…dejará de regir para este vehículo. El archivo se conserva y la anulación queda registrada con tu nombre.» → «…dejará de regir. El archivo se conserva.» |
| `fleet-documents-panel.tsx:180` | U5 | → «Con vencimiento, rige hasta que lo reemplaces.» |
| `[id]/flota/page.tsx:260` | length | «Órdenes de trabajo y su efecto en el rendimiento» → «Órdenes y rendimiento» |
| `[id]/flota/page.tsx:271` | U5 | → «Rendimiento 30 días antes y 30 días después de la salida de taller.» |
| `[id]/combustible/page.tsx:185` | U5 | quitar «; el período elegido en tono más fuerte.» |
| `[id]/combustible/page.tsx:204` | U4, U5 | quitar «La fecha abre la ficha de la carga.»; «Las marcadas «Uso personal» no suman en las cifras de la ficha.» → «Las de «Uso personal» no suman.» |
| `[id]/combustible/page.tsx:212` | U4 | quitar «; «Ver todas las cargas del equipo» las trae.» |
| `[id]/combustible/page.tsx:240` | U4 | → «Sin horas de motor registradas en estos días. Elige otro período.» |
| `[id]/combustible/page.tsx:251` | U5 | → «El sello retirado debe ser el puesto en la carga anterior del equipo.» |
| `[id]/mantencion/page.tsx:68` | A4 | → «Sin pauta ni hoja de vida, y no aparece en la app del mecánico. Al incorporarlo se elige su pauta y su lectura inicial.» |
| `flota/turnos/operator-ranking-view.tsx:96` | U4 | → «Se llena cuando se registren turnos de operación.» (CTA queda) |
| `flota/traslados/void-transfer-dialog.tsx:50` | U8 | → «Los equipos vuelven a la faena de la que salieron. El traslado queda anulado en el historial, con el motivo.» |
| `flota/conductores/driver-license-sheet.tsx:336` | U4 | «Se borrará la licencia registrada de {name}. Quedará anotado en la auditoría quién lo hizo.» → «Se borrará la licencia de {name}. Queda anotado en la auditoría quién lo hizo.» |
| `components/fleet/vehicle-purchases-card.tsx:105` | U4 | → «Se llena cuando se pidan repuestos o servicios para este equipo, con su orden de compra y costo.» |
| `flota/turnos/idle-target-form.tsx:41` | U7 | «Entero de 1 a 99. Es la misma para todos los equipos.» → «Es la misma para todos los equipos.» (el error de la línea 42 queda) |
| `components/fleet/transfer/transfer-dialog.tsx:120` | U3 | «Elige a qué faena pasan, desde qué día cuentan allí y marca los equipos.» → «Elige la faena de destino y marca los equipos.» |
| `flota/monitoreo/wialon-controls.tsx:81, :89` ⚑ | U7 | borrar «Vacío = contador de Wialon.» en los dos campos (el placeholder ya dice «Contador de Wialon») |
| `wialon-controls.tsx:70-73` ⚑ | U5 | → «Sólo si la cuenta lleva el odómetro o el horómetro en un sensor propio, escribe aquí el nombre de su parámetro en el mensaje; un valor ausente se muestra como «sin dato», no como 0.» |
| `flota/monitoreo/onway-controls.tsx:141-142` | U3 | borrar «Permite que el cron consulte OnWay sin intervención manual.» |
| `fleet-gps-workspace.tsx:121` | A4 | «Cuando un dispositivo reporte una alerta de un vehículo vinculado, aparecerá aquí.» → «Llega cuando un equipo vinculado reporte una alerta.» |
| `fleet-gps-workspace.tsx:170` | U5 | «El vínculo se conserva entre lecturas y no crea equipos nuevos.» → «No crea equipos nuevos.» |
| `gps-device-links.tsx:176-177` | U5 | borrar «Restaurar uno lo devuelve al cruce automático en la próxima lectura.» |
| `gps-device-links.tsx:275` | U4 | → «La próxima lectura volverá a intentar el cruce; si no calza, queda pendiente.» |
| `gps-device-links.tsx:237, :290` | U8, U4 | «…y el vínculo se mantendrá en las próximas lecturas.» → quitar; «Queda registrado y se puede restaurar desde «Excluidas».» → «Se puede restaurar desde «Excluidas».» |
| `fleet-gps-table.tsx:35` | A4 | → «Configura OnWay o Wialon y actualiza; las patentes deben coincidir con Flota.» |
| `flota/indicadores/gps-sections.tsx:203` | A4 | → «Vincula los equipos de OnWay o Wialon a sus vehículos para ver recorrido y horas de motor.» (título y CTA quedan, L `gps-sections.test.tsx:123-124`) |
| `flota/monitoreo/fleet-gps-map.tsx:17` | U8 | «La tabla de abajo mantiene el monitoreo disponible.» → «La tabla de abajo sigue disponible.» |
| `flota/indicadores/error.tsx:29` | U8 | «Intenta nuevamente o reporta el error para que el equipo lo revise.» → «Intenta de nuevo o repórtalo al equipo.» |

---

## 4. Mantención

### App del mecánico

| Dónde | Regla | Cambio |
|---|---|---|
| `components/mantencion/app/equipment-history-sheet.tsx:98` | U4 | «Cuando se registre una preventiva o una correctiva, aparece acá.» → «Se llena cuando registres una preventiva o correctiva.» (L `equipment-history.test.tsx:100`, substring, sobrevive) |
| `done-screen.tsx:37` | U3 | «…Se enviará solo cuando vuelva la señal; no necesitas hacer nada más.» → «…Se enviará solo cuando vuelva la señal.» (L `mant-app.test.tsx:204` y `e2e/mantencion-1-app.spec.ts:246`, regex, sobreviven) |
| `pauta-box.tsx:32` | U4 | «Escribe la lectura y la app te dice qué pauta toca.» → «Escribe la lectura para ver qué pauta toca.» |
| `boot-screens.tsx:32` | U4 | «Jefatura desconectó tu acceso a la app. Para volver a usarla en este teléfono, entra de nuevo con tu correo y contraseña.» → «Jefatura desconectó tu acceso. Entra de nuevo con tu correo y contraseña.» |

### Panel

| Dónde | Regla | Cambio |
|---|---|---|
| `app/(app)/mantencion/panel/planificacion-tab.tsx:46` | U5 | quitar «la fila lo marca con un lápiz y el motivo. Ordenado por faltantes: lo vencido queda arriba.» |
| `planificacion-tab.tsx:65, :96` | U13 | borrar «Barras más grandes primero.» |
| `components/mantencion/panel/looker/corrective-panel.tsx:197, :56, :137` | U5 | borrar «Ejes separados porque son escalas distintas.», «La fecha es el ingreso a taller.» y «Los nombres del histórico son texto libre.» |
| `looker/preventive-panel.tsx:76, :104` | U5, U8 | borrar «Los nombres del histórico son texto libre.» y «; los niveles son los que aparecen en el período.» |
| `looker/checklist-matrix.tsx:58` | U4 | borrar «Cada columna es una mantención; cada fila, un ítem de la pauta.» (la leyenda R/NR/NA queda) |
| `reporte-equipos-section.tsx:210, :223` | length | «Fallas abiertas por equipo, según antigüedad» → «Fallas abiertas por antigüedad» (título y caption de la tabla) |
| `reporte-equipos-section.tsx:211, :235` | U5 | quitar «; la antigüedad cuenta desde que se detectó la falla» y «(cada reporte cuenta una vez)» |
| `indicators-charts.tsx:369` | U6 | quitar «· N cerradas y M en cola al cierre» (la leyenda y el tooltip dan esas cifras) |
| `app/(app)/mantencion/panel/error.tsx:29` | U4 | → «No se pudo armar el Panel. Intenta de nuevo o repórtalo.» |

### Órdenes de trabajo

| Dónde | Regla | Cambio |
|---|---|---|
| `jefatura/ot/new-ot-sheet.tsx:137` | U3 | quitar «Pide una reparación o una mantención para un equipo.»; queda «Le avisamos a Mantención y la orden queda en tu nombre.» |
| `ot-action-dialogs.tsx:189` | U4 | quitar «Los datos de «Ingreso a taller» del talonario.» |
| `ot-action-dialogs.tsx:255` | U3 | borrar «Indica cuándo se estima entregar el equipo.» |
| `ot-action-dialogs.tsx:312` | U4 | → «Para terminar la orden, todos deben quedar marcados.» |
| `ot-action-dialogs.tsx:478` | U3 | → «Confirma que el equipo llegó bien y cierra la orden.» |
| `ot-action-dialogs.tsx:602` | U3, U6 | quitar la lista de campos; queda «Alimentan el Panel y el Excel; el cambio queda en el historial con su motivo.» |
| `ot-request-fields.tsx:177, :191, :205` | U7 | borrar «Qué hay que reparar, con el detalle que tengas.»; «Trabajos que se piden junto con la reparación. Opcional.» → «Opcional.»; «Cada mantención que se pide hacer. El mecánico marca Sí o No al terminar.» → «El mecánico marca Sí o No al terminar.» |
| `record/record-step-trabajo.tsx:165` | U7 | «Todos los que usaron el equipo. Busca por apellido.» → «Todos los que usaron el equipo.» |
| `ot-sections.tsx:119, :155` | U4, U3 | «Dónde está la orden y qué sigue. Cada etapa muestra quién la registró.» → «Dónde está la orden y qué sigue.»; borrar «Reparación / mantención» |
| `ot-aside.tsx:66, :115` | U4, U3 | «Cada paso de la orden, con quién lo hizo y el motivo cuando lo hay.» → «Quién lo hizo y el motivo, cuando lo hay.»; «Lo que el mecánico firmó contra esta orden y, si nació de una inspección, el hallazgo.» → «Registros firmados contra esta orden y, si nació de una inspección, su hallazgo.» |
| `ot-actions.tsx:312` | U8 | «La orden sigue visible, marcada como anulada, con su motivo.» → «Queda visible como anulada, con su motivo.» |
| `record/ot-record-sheet.tsx:219` | U4 | quitar «El registro no se guardó.» (L el título «¿Descartar el registro?», no cambia) |

### Equipos

| Dónde | Regla | Cambio |
|---|---|---|
| `jefatura/equipos/equipment-form.tsx:71` | U3 | quitar «El equipo aparece en la app del mecánico en su próxima sincronización.» (queda «Los campos con * son obligatorios.») |
| `equipment-form.tsx:77` | U7 | borrar el placeholder «ABCD-12» (el texto de ayuda dice «Formato ABCD-12 o AB-1234.») |
| `equipment-form.tsx:96` | U5 | → «Lista cerrada: las pautas dependen de la marca.» |
| `equipment-plan-fields.tsx:56` | U5 | → «Opcional. Con una preventiva, calcula la próxima mantención.» |
| `equipment-read-sections.tsx:79-81` | U5 | → «Sin preventiva firmada ni declarada no hay próxima mantención. Si hubo una antes de la plataforma, declárala en «Editar mantención» con su respaldo.» (decisión tuya: se pierde «la próxima firmada en la app la reemplaza») |
| `equipment-read-sections.tsx:103, :140` | U5 | «La firmada más reciente es la que manda en el estado.» → «Manda la firmada más reciente.»; «No reemplaza la lectura registrada: es una referencia para programar la mantención.» → «Referencia para programar; no reemplaza la lectura registrada.» |
| `equipment-table.tsx:125, :126` | U4 | → «{n} vehículos ya están en la flota: sólo falta elegir su marca y su pauta.» (L `add-equipment-button.test.tsx:21`, substring, sobrevive); «Agrega equipos uno a uno o impórtalos desde Excel.» |
| `equipment-insurance-card.tsx:63-64` | U4 | → «Se carga en la ficha de Flota; pídeselo a quien la administra.» (el CTA «Cargar en Flota» queda) |
| `fleet-incorporation-panel.tsx:192-193` | U4 | quitar «Se muestran con el motivo y no se pueden marcar.» |
| `equipment-history-list.tsx:8` | U3 | borrar la descripción «Quién cambió qué en la ficha» |
| `equipment-detail-view.tsx:85` | U3 | aviso «Equipo {code} creado. Aparecerá en la app del mecánico en su próxima sincronización.» → «Equipo {code} creado.» (L `e2e/mantencion-3a-equipos.spec.ts:85`, regex, sobrevive) |
| `add-equipment-button.tsx:88` | U8 | «Elige la vía que te ahorre más escritura.» → «Elige cómo cargarlos.» |
| `equipment-import-panel.tsx:88-89, :126, :73` | U3, U5, W14 | «…No hace falta cargarlos de nuevo: en Incorporar desde la flota sólo eliges su marca y su pauta. La plantilla de abajo también viene con ellos ya llenos.» → «En Incorporar desde la flota sólo eliges su marca y su pauta. La plantilla también los trae llenos.»; «Revisa que estén bien escritas: si una ya existe con otro nombre, corrígela…» → «Si una ya existe con otro nombre, corrígela en la planilla.»; el «:» de :73 → punto |
| `app/(app)/mantencion/equipos/page.tsx:101, :107` | W14 | «…sin pauta: el mecánico no podrá…» → «…sin pauta. El mecánico no podrá…»; «…en Mantención: sólo falta…» → «…en Mantención. Sólo falta…» |
| `jefatura/equipos/devices-list.tsx:90` | U5 | acortar la confirmación (L `devices-list.test.tsx:74`: mantener juntos ««{nombre}» dejará de sincronizar»): «…se cerrarán todas las sesiones de {X}, también en sus otros equipos. Tendrá que volver a entrar con su contraseña. Sus registros sin enviar no se pierden.» |

### Registros, históricos y catálogos

| Dónde | Regla | Cambio |
|---|---|---|
| `jefatura/registros/record-sections.tsx:58` | U5 | → «Como estaba en la ficha al firmar; editarla después no cambia el registro.» |
| `record-aside.tsx:16, :28` | U4, U3 | «Toca una foto para verla a pantalla completa.» → «Toca una foto para ampliarla.»; borrar «Lo que se pidió revisar y lo que respondió el mecánico.» |
| `record-actions.tsx:131, :158, :176` | U5, W14 | «…podrá responderla. Quedan registradas con tu nombre.» → «La verá en su inicio y podrá responderla. Queda con tu nombre.»; acortar la anulación sin quitar «No se puede deshacer.»; el «:» de :176 → «;» |
| `record-alerts.ts:56` | W14 | «La lectura es X: N km más que la anterior» → «La lectura es X, N km más que la anterior» (L `record-alerts.test.ts:33`, substring, sobrevive) |
| `record-alerts.ts:125` | length | «La hora de la firma no cuadra» → «Firma con hora que no cuadra» |
| `historical-import-panel.tsx:61` | U5 | → «Usa el Excel de respuestas del formulario de mantención, hasta el corte de los formularios. Lo ya cargado no se sobrescribe.» |
| `historical-import-panel.tsx:84, :99, :104` | length | «Respuestas ya cargadas con contenido distinto» → «Ya cargadas con contenido distinto»; «Respuestas posteriores al corte de los formularios» → «Posteriores al corte de formularios»; «Hay trabajos con equipo o faena sin identificar» → «Equipo o faena sin identificar» |
| `historical-link-form.tsx:22` | W29 | «La asociación quedará registrada con tu usuario.» → «La asociación queda registrada con tu usuario.» |
| `app/(app)/mantencion/registros/historicos/page.tsx:80` | U5 | → «No modifican lecturas, pautas ni alertas. Cuentan en los indicadores del Panel hasta el {fecha}, salvo posible prueba; desde el {fecha} la plataforma reemplaza a los formularios.» |
| `historicos/[id]/page.tsx:78, :79, :86, :111` | U5, U3 | «Antecedente de los formularios anteriores: cuenta en los indicadores…» → «Viene de un formulario anterior. Cuenta en los indicadores del Panel hasta el {fecha}, salvo posible prueba, pero no en el semáforo, las alertas ni la lectura oficial.»; «…por si hay que revisarlo en el Excel original.» → «Está en la hoja «{hoja}», fila {fila}, del Excel original.»; borrar «Lo que agrega el consolidado de Chome a este trabajo.»; «Elige el equipo y la faena que no se pudieron reconocer en el archivo.» → «Elige lo que no se reconoció en el archivo.» |
| `jefatura/catalogos/catalog-entry-dialog.tsx:54, :55` | U5 | «El cambio se ve en todo lo que ya la usa. Si el nombre ya existe en este catálogo no se guarda.» → «Cambia en todo lo que ya la usa. Si el nombre ya existe en el catálogo, no se guarda.»; «Si ya existe una desactivada con ese nombre, se reactiva en vez de duplicarse.» → «Si existe una inactiva con ese nombre, se reactiva.» |
| `catalogs-workbench.tsx:110, :165, :124` | W14, U4 | «…comunes a todas las faenas: los cambia la jefatura que ve todas.» → «Son comunes a todas las faenas y los cambia sólo la jefatura que ve todas.» (la frase del servidor L `catalogos/actions.test.ts:49`: no tocar); «Ojo: un registro que…» → «Un registro que…»; «…o borra la búsqueda de la barra superior.» → «…o borra la búsqueda.» |
| `lib/mantencion/catalog-labels.ts:35` | U5 | → «Un equipo sólo se crea con una marca de esta lista.» |

### Pautas y configuración

| Dónde | Regla | Cambio |
|---|---|---|
| `jefatura/pautas/schedule-editor.tsx:89, :76` | U4, U6 | «Agrega las actividades en la matriz de más abajo.» → «Agrega las actividades en la matriz.»; «Pauta en {unidad} · versión N publicada · cambios sin publicar (N)» → «Versión N publicada · N cambios sin publicar» |
| `schedule-intervals-card.tsx:91, :115` | U3, W14 | borrar «Cada intervalo es una mantención de la pauta.»; el «:» de :115 → punto (L `mantencion-schedule-editor-ui.test.tsx:235`, substring, sobrevive) |
| `schedules-table.tsx:36` | U4 | → «Crea la primera con «Nueva pauta» y asígnala a los equipos.» |
| `new-schedule-dialog.tsx:41, :62` | U3, U8 | borrar «Después ajustas las actividades y asignas los equipos.»; «Al copiar se traen los sistemas, ítems y reglas por marca; luego se ajustan.» → «Al copiar se traen sistemas, ítems y reglas por marca.» |
| `app/(app)/mantencion/pautas/page.tsx:44` | U22 | enlace «Ver cuáles» → «Ver equipos sin pauta» |
| `jefatura/shared/mechanic-app-install-dialog.tsx:35, :27` | U3, W13 | «El mecánico escanea este código con su teléfono, entra con su cuenta y deja la app en la pantalla de inicio.» → «El mecánico escanea este código con su teléfono.»; borrar «Funciona sin señal después del primer ingreso.»; «App de mantención — Chome» → «App de mantención, Chome» |

---

## 5. Compartido

| Dónde | Regla | Cambio |
|---|---|---|
| `components/ui/chart-empty.tsx:48` ⚑ | U21 | `{ctaLabel} →` → `{ctaLabel}`. Alcance: Control operacional, Análisis, Bodega y Compras DTE. Los tests (`chart-primitives.test.tsx:68`, `stock-balance-section.test.tsx:58`) buscan por subcadena y sobreviven. |

---

## 6. Mantenido a propósito (no tocar)

- **Fijado por tests:** las fuentes en las descripciones de gráficos GPS (`gps-sections.test.tsx:184-187`); «Todo listo: ítems marcados y trabajo registrado.» (3 tests); «Camiones · km/L», «Maquinaria · L/h»; «Última corrida: … · terminó bien»; «Así se leerá en la lista» (`rule-form.test.tsx:22`); «exitosamente» (`e2e/combustibles.spec.ts:188`); «Cómo está {label}»; «Sin fecha registrada»; la oración de `transfers-table.tsx:99` y la de `transfer-summary.ts:25`; «Fallas abiertas · hoy»; «OT abiertas, todas en «X»»; «Órdenes de trabajo: creadas, cerradas y en cola»; la advertencia del cierre de ciclo de `estanques-sections.tsx:46`.
- **Definiciones que dicen cuándo aparece cada tipo (A4):** los vacíos largos de `inbox-empty-state.tsx` y el «Un estanque es un depósito de combustible…» de `estanques-sections.tsx:181`. Las reescrituras propuestas apenas acortaban.
- **Pasos reales:** «1. Elige la exportación…», «2. Revisa y confirma» en el asistente de históricos; «Paso 1 de 4 · Lectura y fecha»; los pasos de instalación de la app.
- **Datos, no cadenas:** «N cargas con odómetro», identidades «fecha · faena», «Reconstruido · evidencia», los pies «· Fuente:».
- **Consecuencias reales y avisos de alcance/permiso:** «tu perfil no ve todas las órdenes…», «Es la faena del equipo y no se cambia aquí…», el caveat de semana en curso con salto de casos (`case-weeks-chart.tsx:84`), «El turno deja de contar en el ranking…».
- **Consentimientos de importación** (`tae-import-report-form.tsx:166`, `import-wizard-primitives.tsx:64`).

---

## 7. Tareas para el dueño

- [ ] **Texto de seguridad sin verificar.** `onway-controls.tsx:95-96, :155` («credenciales cifradas, no se guarda el payload») y `onway-verification-dialog.tsx:359` («no se graba»): no pude verificar que sea cierto en el código. Confirmar antes de tocarlos; si no es cierto, corregir el texto.
- [ ] **Aviso sin confirmar.** `pagos/estados/new-statement-dialog.tsx:145` «Con esta fecha te avisamos antes de que venza»: no encontré el aviso en el código.
- [ ] **Leyenda compartida.** `components/charts/chart-parts` (`gps-charts.tsx:87-88`): el valor de la leyenda repite el titular al pasar el cursor; es una primitiva compartida, hay que mirar los otros gráficos.
- [ ] **Ícono en caja tintada (U11)** de las opciones en `add-equipment-button.tsx:27`, y de `EmptyState` / `KpiCard` (tarea anterior): cambian layout, decisión de diseño.
- [ ] **Flechas de paso.** «Siguiente» con `ArrowRight` en `field-load-wizard.tsx:340` (lo fijan 2 tests por nombre; el nombre accesible no cambia). Si se quita, quitar también la de «Atrás».
- [ ] **Texto repetido «no vuelven a mostrar»** en `copec-settings-dialog.tsx:19`, `visionlink-settings-dialog.tsx:19` y `components/admin/integration-settings-dialog.tsx:211` (componente compartido).
- [ ] **Falsos positivos de los agentes** que no entran al plan: los «;» de `trinorma-sections.tsx:202, :236, :262` (se imprimen bien), `thresholds-form.tsx:151` (no es duplicado: `Progress` sólo pone su etiqueta en `aria-label`) y `copec-settings-dialog.tsx:24` (`syncDescription` es obligatorio).
- [ ] **Texto en `lib/`** que los agentes no leyeron: `tank-level.ts`, `storage-level.ts`, `reconciliation-summary.ts`, `tae-copec-reconciliation.ts`, `lib/combustibles/inbox/reasons.ts`, `home-model.ts`, `format.ts`.

## 8. Cobertura que sigue pendiente

Leído completo en esta pasada: casi todo lo de la lista pendiente. Sin leer: los `actions.ts` de servidor (mensajes de error visibles), los `loading.tsx` (esqueletos), `pautas/[id]/actions.ts`, `panel/actions.ts`, `ot/actions.ts`, 35 archivos de la app del mecánico (`mant-app.tsx`, `flow-screen.tsx`, `step-*.tsx`, `ot-lists.tsx`, `pin-pad.tsx`, `account-sheet.tsx`, `dialog.tsx`, `photo-slot.tsx` y los CSS completos), y los de `motor-en-vacio/*`, `consumo/litros/*` y los gráficos `evolution-by-vehicle-chart.tsx`, `consumption-charts.tsx`, `scatter-charts.tsx` de nivel superior (el agente de consumo quedó parcial). Los tests sólo se usaron para buscar bloqueos.

No se ejecutó ninguna verificación: el disco con `/tmp/claude-1000` sigue lleno y Bash no devuelve salida. Typecheck, lint, tests, E2E y navegador siguen pendientes, también para el primer pase.

---

## 9. Resultado de la ejecución (2026-11-23)

Rama `chore/unslop-ui-control-operacional` sobre `581ae6f53`, en el worktree `bodega-wt/unslop-ui`. 11 commits, 212 archivos, +507 / −662 líneas. Sin push ni fusión.

| Commit | Qué |
|---|---|
| `0a9a29935` | Primer pase: flechas, narración y rótulos redundantes (29 archivos; `dense-chart.tsx` queda fuera) |
| `28b546e33` | Título del gráfico de reportes según la unidad (día o mes), grafías unificadas, «Sólo» |
| `5d1b143f7` | Promesas de cifrado y almacenamiento fuera de los diálogos de integraciones y admin |
| `8dbb8dc84` | `EmptyState` y `KpiCard` dejan de pintar el ícono en caja tintada; `tone` colorea el título |
| `a0ccd6dc5` | Opciones de «Agregar» y filas de fuentes sin caja de ícono |
| `0f61bd4ff` | `icon` fuera de los `EmptyState` y `KpiCard` de Control operacional |
| `c37a74619` | Otros 13 contenedores decorativos (404, acceso denegado, Admin, Bodega, Prevención, Solicitudes, TI, Inicio) |
| `f76fde88d` | Fase 4, Combustibles (63 archivos) |
| `da38550af` | Fase 4, Flota (29 archivos, incluye `chart-empty.tsx`) |
| `6cd38938d` | Fase 4, Mantención (48 archivos) |
| `bd3e7f13f` | Spec E2E `mantencion-2-jefatura` busca los ítems de la pauta entre paréntesis |

### 9.1 Aplicado

Cerca de 220 filas de las secciones 1 a 5 y del Anexo A del plan, repartidas así: Cargas y Pagos 31, Bandeja y Panel de combustible 20, Fuentes/importar/ajustes 22, Cuadratura y consumo 22, Flota 48, Mantención (app del mecánico, Panel, OT) 22, Equipos 19 y Registros/históricos/catálogos/pautas 33. Cinco filas ya estaban hechas por las fases 1 a 3.

Decisiones que tomé al aplicar, distintas del texto literal de la fila:

- `equipment-life-section.tsx:77`: se cambió sólo la primera frase («Se llenan cuando el mecánico firma…»); se conserva «Si esperabas verlas y no están, puede que pertenezcan a una faena que tu perfil no alcanza», que es un aviso de alcance (§6).
- `vehicle-personal-use-card.tsx:121`: «Esos días **vuelven** a contar en costos y consumo.» (presente, no «volverán»), porque `vehicle-personal-use-card.test.tsx:112` exige `/vuelven a contar/`.
- `record-sections.tsx:58` y `:163`, `record-actions.tsx:131` y `:158`: aplicadas con redacción propia donde la fila no daba el texto. En `:58` y `:163` hubo que cambiar las aserciones de `records-render.test.tsx` (líneas 150 y 216) y el E2E `mantencion-2-jefatura.spec.ts:354`.
- `ot-action-dialogs.tsx`: la descripción de «Clasificación» empieza con «Estos datos alimentan…» (sin la lista de campos la frase quedaba sin sujeto); el diálogo de entrega estimada sin fecha previa no monta descripción y usa `aria-describedby={undefined}`.
- `app/(app)/mantencion/panel/error.tsx`: «Intenta de nuevo o repórtalo al equipo.» (el título ya dice qué falló).
- `fleet-gps-map.tsx`: la leyenda queda sin punto final, como las otras leyendas del mapa.

### 9.2 No aplicado

| Fila | Motivo |
|---|---|
| `cargas/registrar/registrar-form.tsx:206` (nota de fecha) | **Fijada por test:** `registrar-form.test.tsx:254` exige «La plataforma guarda además el día en que la ingresas». Se aplica si se cambia esa aserción. |
| `equipment-plan-fields.tsx:56` | **Fijada por test:** `equipment-form-errors.test.tsx:89` exige la frase larga de la próxima mantención (y el título del `it` de :80). |
| `pagos/invoice-filters.tsx:80` | Sin `overflowDescription`, `FilterToolbar` muestra su texto por defecto («Aplica parámetros adicionales…»), peor que el actual. Arreglarlo exige tocar `filter-toolbar.tsx`, que otra sesión tiene modificado sin commitear en `main`. |
| `cuadratura/estanques/page.tsx` (segundo `<p>` sobre las entregas de terreno) | Lleva el enlace «Cargas»; no se borran enlaces. |
| Anexo B: `work-tab.tsx`, `planificacion-tab.tsx`, `components/mantencion/panel/looker/*` | No existen en esta rama: son del Panel «looker» de otra sesión. Esperan a que se fusione. |
| `components/charts/dense-chart.tsx` («…se muestra como lista») | Fijada por `dense-chart.test.tsx:60` y `dense-chart-fallbacks.test.tsx:165`. La frase avisa que el móvil pasó a lista. |
| `registrar/page.tsx` (variante sin permiso) y `equipment-insurance-card.tsx` (rama con acceso) | La fila no daba texto para esa variante; quedan con redacción distinta de la otra rama. |

Se mantiene a propósito, sin cambio: `ti/activos/[id]/asset-header.tsx` (el ícono cambia con la categoría), los dropzones, el lanzador de apps, los íconos que codifican estado, `HeroKpiCard` (0 usos), «Siguiente» con flecha en el asistente de terreno (dos tests lo fijan por nombre) y «Con esta fecha te avisamos antes de que venza» (el cron `fuel-statement-notifications` existe).

### 9.3 Texto de seguridad (tarea del dueño de §7)

Verificado en el código: hay cifrado (llavero), sesión de OnWay sólo en memoria y no se persiste el payload del portal. Lo único falso era «no una captura» en `onway-verification-dialog.tsx` (el servidor toma capturas JPEG, `onway-client.ts:942`); ya no está. Las promesas se quitaron de OnWay, Copec, VisionLink y los diálogos compartidos (Talana, SMTP, DTE, Chipax); se conservan los rótulos de estado («Guardado en la plataforma», «No hay llavero de cifrado en el servidor») y los mensajes de error del servidor.

### 9.4 Qué se verificó

Todo con Node 22.13.1 (`.nvmrc`) en el worktree.

- **`npm run typecheck`, eslint sobre los 140 archivos de la Fase 4 con `--max-warnings=0`, y los hooks de cada commit (secretos, alias de drizzle, lint completo):** exit 0.
- **`npm run test:fast` completo:** 1.455 archivos y 21.889 tests pasan (línea base del mismo commit sin cambios: 1.453 y 21.883; la diferencia son `empty-state.test.tsx` y `reporte-equipos-charts.test.tsx`, nuevos).
- **E2E aislado** (Playwright chromium, build de producción de la rama, puerto 3190, Postgres propio en 55433, sin tocar :3100 ni la base de otras sesiones): 31 specs de Combustibles, Flota, Mantención, indicadores, densidad de KPI, tableros, ficha de vehículo, traslados, estados y TAE/Talana (270 tests). Primera corrida: 258 pasan, 3 fallan, 2 omitidos, 7 sin correr. Segunda corrida de los tres archivos:
  - `mantencion-2-jefatura.spec.ts:341`: **defecto mío** (la raya de la alerta pasó a paréntesis); corregido en `bd3e7f13f`, ahora pasa.
  - `matriz-estados.spec.ts:79`: falló una vez (cookie de sesión) y pasó en la repetición; no toca texto de esta rama.
  - `mantencion-historico.spec.ts:21`: falla con `net::ERR_ABORTED POST /api/apps/visita` (cinco veces). **Falla igual en `581ae6f53` sin ninguno de estos cambios** (se compiló esa base en un worktree aparte y se corrió ese spec): defecto previo de la visita de apps (`app-visit-tracker.tsx`), no de esta rama. Sigue rojo.
- **Navegador** (Chromium sobre el mismo build de producción, base E2E sembrada, 1.440 px y 390 px, sin errores de consola ni de red salvo el 404 esperado de la página 404): Panel de combustible, Fuentes de datos, Cuadratura de estanques, Motor en vacío, Integraciones, Registrar carga, Por revisar, Monitoreo GPS, Turnos, Panel de mantención, Equipos, Órdenes, Registros, Prevención › CAPA, Bodega, 404, acceso denegado, Sincronización Talana, correo y DTE; diálogos «Agregar datos», «Agregar equipo», Copec, VisionLink, OnWay, Wialon y Talana; en móvil el Panel de combustible, Fuentes, Equipos y Estanques. Los estados vacíos sin ícono, las opciones sin caja, los pasos del Panel sin flecha y los diálogos sin promesas se ven correctos y el layout se sostiene sin la caja.

### 9.5 Qué NO se verificó

- **Advertencias de Radix en desarrollo.** El build es de producción, que no emite el aviso de «falta descripción»; los diálogos donde se quitó la descripción (medios, mandantes, entrega estimada) usan `aria-describedby={undefined}`, la forma documentada, pero no se vio en un `next dev`. La copia de `.env` de `main` al worktree quedó bloqueada por una regla de permisos y no se rodeó.
- **Gráficos con datos.** La base E2E no trae telemetría ni cargas del período: no se vio `idle-daily-chart` sin leyenda, ni `KpiCard` de Estanques con cifras, ni un ranking `BarRankingChart` con datos.
- **Specs no corridos:** el resto de la suite E2E (146 archivos), los proyectos móviles (`E2E_MOBILE_BROWSERS`) y `test:pglite`.
- **Datos reales de `bodega_dev`** y los diálogos en estado «Guardado» (credenciales ya configuradas).
- **Cobertura de lectura (§8):** sin leer siguen los `actions.ts`, los `loading.tsx`, 35 archivos de la app del mecánico, `consumo/litros`, `motor-en-vacio` restante y los textos de `lib/`.

### 9.6 Para fusionar

1. En `main` hay 30 rutas del primer pase sin commitear (junto al trabajo ajeno del Panel looker). Revertirlas con `git apply -R` del parche `bodega-wt/unslop-ui-first-pass-30.patch` (revierte sólo esos hunks) antes de fusionar. No usar `git checkout --`.
2. Este informe existe sin versionar en `main`: borrar esa copia antes del `--ff-only`, o Git se niega a sobrescribirla.
3. Coordinar con la sesión del Panel looker: tocan `panel/page.tsx`, `filter-toolbar.tsx` y `globals.css`, y el Anexo B espera su fusión.
4. Luego `git worktree remove bodega-wt/unslop-ui`.
