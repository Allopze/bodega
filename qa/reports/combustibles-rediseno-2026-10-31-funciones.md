# Verificación de las 101 funciones: rediseño de Combustible

Anexo de `combustibles-rediseno-2026-10-31.md`. Cada fila del `MAP` del prototipo se ubicó en el código de la rama `feat/combustibles-rediseno` (lectura estática, por un agente). Las filas PARCIAL y DUDA se resolvieron después: la segunda pasada corrigió la 27 y la 35, y la tercera las demás (3, 9, 29, 48, 64, 73 y 74); ver el informe principal. «OK (decisión)» marca lo que difiere del prototipo porque el usuario lo decidió así. Las rutas son relativas al repo; `C/` = `app/(app)/combustibles/`.

Resumen: **OK 101** (tres por decisión del usuario: 3, 48 y 74) · PARCIAL 0 · FALTA 0 · DUDA 0

| n | función (corta) | estado | dónde | nota |
|---|---|---|---|---|
| 1 | Facturado vs terreno vs tarjetas, con variación | OK | `C/consumo/litros/page.tsx` → `C/fuel-control-overview.tsx` (FuelOriginSummary) | «De dónde vino lo cargado», tres cifras con `Delta` «vs. período anterior» (no «mes anterior»: es el período elegido) |
| 2 | Litros por faena y origen; clic filtra | OK | `C/fuel-control-overview.tsx` | «Litros por faena y origen», `worksiteHref` → `?faena=` |
| 3 | Señales de calidad en terreno (por validar, observadas, sin sello, sin 4 fotos) | OK (decisión) | `C/cargas/page.tsx` → `lib/combustibles/cargas-attention.ts` (`buildFieldAttentionStats`), `lib/combustibles/fuel-log.ts` (`getFieldLoadAttention`), `components/ui/filter-summary-bar.tsx` | Tercera pasada: tira de cuatro cifras sobre la lista de Cargas («Por validar», «Con observación», «Sello incompleto», «Menos de 4 fotos»). Cada una aplica su filtro y, en cero, dice «Ninguna». Es una sola consulta agregada con los mismos predicados que los filtros, así que la cifra es el número de filas de la lista. Por decisión del usuario las cargas por validar siguen sin entrar a «Por revisar» ni al Panel de jefatura. Las anuladas cuentan en «Sello incompleto» y «Menos de 4 fotos», igual que en sus filtros |
| 4 | Monto total del período; patentes sin asociación | OK | `C/pagos/page.tsx` (frase «Se facturaron N cargas por $…»); `C/revisar/page.tsx` tipo «Patentes sin vincular» | |
| 5 | Consumo y gasto por período; $/L | OK | `C/consumo/litros/cards-analysis.tsx` «Tendencia y precio» (pliegue «Más análisis de tarjetas»); `C/pagos/page.tsx` «$ por litro en promedio» | Gasto y precio solo aparecen con `view_costs` |
| 6 | Alertas de consumo → «Patentes para mirar» | OK | `C/consumo/litros/page.tsx` → `C/consumption-alerts.tsx`, `lib/combustibles/consumption-watch.ts` | Los 5 tipos se generan en `consumption-dashboard.ts` (consumo_alto, gasto_rendimiento_bajo, transacciones_altas, rendimiento_cero, variacion_fuerte) y además sin_asociacion |
| 7 | Litros por tipo de equipo | OK | `C/consumo/litros/cards-analysis.tsx` «Litros por tipo de equipo» | Dentro de «Más análisis de tarjetas» |
| 8 | Dispersión litros vs odómetro/horómetro | OK | `cards-analysis.tsx` «Litros contra odómetro y horómetro» | |
| 9 | Evolución del consumo por equipo (hasta 8) | OK | `cards-analysis.tsx` «Evolución por equipo… hasta 8 series»; `C/consumo/equipos/[id]/page.tsx` sección «Litros por mes» → `equipment-liters-chart.tsx` | Tercera pasada: la ficha de equipo suma «Litros por mes»: 12 meses que terminan en el mes del período elegido, con ceros en los meses sin cargas y los del período en tono pleno. Si la consulta falla, la ficha sigue y avisa que faltan datos |
| 10 | Matriz faena × equipo, un solo tono | OK | `C/worksite-equipment-heatmap.tsx` (color-mix sobre `--color-primary`), hint «Más oscuro es más litros» | Dentro del pliegue de tarjetas |
| 11 | Distribución de casos (estado, gravedad, regla) | OK | `C/revisar/page.tsx` `<details>` «Cómo se reparte lo pendiente» + `AnomalyDistributionChart` (estado, severidad, «Top reglas activas») | Se ve solo en «Pendientes» y cuando hay algo pendiente |
| 12 | Patentes bajo observación; clic abre ficha | OK | `cards-analysis.tsx` «Patentes bajo observación» (+ «Patentes para mirar») | El hint dice «Selecciona una barra para abrir la ficha del equipo» |
| 13 | Gráficos de la planilla | OK | `C/consumo/litros/planilla-analysis.tsx` (pliegue «Planilla de cargas») | Mayor gasto, rendimiento declarado por unidad, por faena y por proveedor |
| 14 | Totales de tarjeta por patente y mes | OK | `C/cargas/tarjetas/page.tsx` + `C/consumption-detail-table.tsx` | Paginado. «Ver archivo» reemplaza a «Ver lote»; «Sin vincular» enlaza a Por revisar |
| 15 | Filtros fuente, patente, asociación | OK | `C/cargas/tarjetas/tarjetas-filters.tsx` | Proveedor, buscador, «Sólo patentes sin vincular» |
| 16 | Litros, km/L y L/h globales, cargas en revisión | OK | `C/consumo/litros/page.tsx` (frase «En … se cargaron N L…», `ReviewExclusionNote` con enlace «Revisarlas») | |
| 17 | Litros por mes apilados por medio | OK | `consumo/litros/page.tsx` «Litros por mes, según de dónde salió» | |
| 18 | Tabla faena × medio exportable | OK | `C/consumo/litros/worksite-medium.tsx` (pliegue «Faena × medio de suministro») | Ranking, crosstab con totales, `ExportButton` |
| 19 | Series km y horas contra litros | OK | `consumo/litros/page.tsx` «Kilómetros contra litros» / «Horas contra litros», con «Global de estos meses» | |
| 20 | Rendimiento por familia; el cambio conserva filtros | OK | `C/consumo/rendimiento/[familia]/page.tsx` + `family-switch.tsx` | `contextForFamily = {...sp, …}` |
| 21 | Filtros tipo rendimiento, medio, equipo, fechas | OK | `rendimiento/[familia]/family-filters.tsx` («Más filtros de rendimiento») | El rango de fechas está en el control de período compartido del encabezado, no dentro de «Más filtros» |
| 22 | Por faena: promedio, desviación, dispersión | OK | `worksite-ranking.tsx` («parejo/irregular») + `Disclosure` «Ver datos estadísticos» | |
| 23 | Por equipo vs modelo e historial 12 m, «rinde peor» | OK | `stats-tables.tsx` (Su modelo / Su historial / badge «Rinde peor»); ficha de equipo `PerformanceFacts` | |
| 24 | Detalle de cargas de la familia | OK | «Cargas que forman estas cifras», `load-detail-table.tsx` | |
| 25 | Aviso «N cargas no entran al promedio» con enlace filtrado | OK | `C/control/_charts/performance-review-note.tsx`; href `fuelInboxHref({tipo:"carga", faena})` | |
| 26 | Ralentí completo | OK | `C/consumo/motor-en-vacio/page.tsx` | Frase, horas y litros por mes, equipos, equipo×mes, día a día, telemetría contra cargas, 20 días con más vacío |
| 27 | Excel con hoja de metadatos con nombres | OK | `lib/combustibles/control/queries/export-xlsx.ts` (describeFilters + resolveFilterNames) | Corregida en la segunda pasada: Pagos › Facturas, Cuadratura › Sellos, Tarjeta y terreno y la exportación de terreno también escriben los filtros en palabras y con nombres, no como JSON con ids |
| 28 | Lista unificada con alcance por faena | OK | `C/cargas/page.tsx` + `cargas-workbench.tsx` + `bitacora/bitacora-table.tsx` | |
| 29 | Un solo buscador | OK | `C/cargas/cargas-filters.tsx` (FilterSearchInput «Buscar equipo, patente o proveedor…»); `components/layout/top-bar.tsx` lista `/combustibles` en ROUTES_WITH_OWN_SEARCH | Hay un solo buscador por lista y vive en la barra de filtros de la página, no en la barra superior como pedía el prototipo: la del shell está oculta en todo `/combustibles` a propósito, porque cada lista lleva el suyo rotulado. Tercera pasada: el rótulo dice lo que busca, y con `view_personal` suma «o persona» |
| 30 | Filtros al instante: mes arriba, Faena, Cómo llegó, Estado | OK | `cargas-filters.tsx` + `FuelHeaderActions` | `useUrlFilters` sin botón «Aplicar» |
| 31 | Filtros secundarios en «Más filtros (N)» con chips | OK | `cargas-filters.tsx` (`CARGAS_ADVANCED_FILTER_KEYS`, grupos Equipo / Personas / Sellos y fotos / Origen y casos; chip para cada clave) | |
| 32 | Selector de columnas que recuerda | OK | `bitacora-table.tsx` «Columnas», `useLocalStorageState("chome:combustibles:cargas:columnas")` | Son 22 columnas: «Anomalías» y «Revisión» se fundieron en «Pendiente» |
| 33 | Seleccionar filas, exportar selección o con filtros | OK | `bitacora/export-button.tsx` «Exportar (N seleccionadas)» / «Exportar» | |
| 34 | Conductor/supervisor ocultos sin permiso | OK | `bitacora-table.tsx` `personalCell`; filtros de personas condicionados | |
| 35 | Conteo de anomalías por fila con enlace → «Pendiente» | OK | `bitacora-table.tsx` `PendingCell`, `fuel-log-shared.ts` `fuelLogPending` | Corregida en la segunda pasada: «Pendiente» muestra también los casos de anomalía abiertos, y entran al filtro «sólo con algo pendiente». El enlace de la insignia «Caso abierto» quedó por carga en la tercera pasada (fila 64) |
| 36 | «Pedir que la revisen» con nota → Por revisar | OK | `components/combustibles/load-detail/review-request-control.tsx` (tabla y ficha) | Nota obligatoria; llega como tipo «pedido» |
| 37 | Detalle, fotos e historial → ficha única | OK | `C/cargas/[origen]/[id]/page.tsx` | |
| 38 | Historial en palabras + campo a campo | OK | Ficha: sección «Historial» con enlace «Ver cambios campo a campo»; `C/cargas/[origen]/[id]/historial/page.tsx` | Tabla Antes/Después dentro de `<details>` |
| 39 | Registrar carga: faena y punto como paso 1, buscador dentro | OK | `C/cargas/registrar/registrar-form.tsx` + `registrar-picker.tsx` + `components/combustibles/field-load/*` | `shellSearch=false`: el buscador va dentro del paso Equipo; hay borrador (`use-field-draft`) |
| 40 | Verificación de RUT | OK | `field-load/step-people.tsx` «Verificar» | |
| 41 | Nueva carga facturada con IEC/IVA/total | OK | `C/pagos/nueva/page.tsx` + `new-fuel-load-form.tsx` | El botón dice «Nueva factura», sin «de combustible» |
| 42 | Ficha de factura: editar, registrar, eliminar, corregir lectura | OK | Ficha `origen=factura` → `factura-load-detail.tsx` sección «Factura» + `C/[id]/edit-fuel-load-form.tsx` | ConfirmDialog al eliminar, «Corregir lectura del medidor» |
| 43 | Formulario público QR con cola offline | OK | `app/(public)/tae/` (`tae-outbox.tsx`, `tae-submitter.ts`) | |
| 44 | «Agregar datos» pregunta qué tienes | OK | `components/combustibles/add-fuel-data-button.tsx`, `lib/combustibles/section-nav.ts` `fuelAddDataOptions` | Opciones «Tengo…» según permisos |
| 45 | Importar facturas Excel | OK | `?agregar=facturas` → `C/fuentes/add-data-launcher.tsx` → `ImportFuelLoadsModal` | |
| 46 | Importar reporte de tarjeta | OK | `C/fuentes/agregar/tarjeta/page.tsx` → `importar/import-wizard.tsx` | |
| 47 | Copec: corrida, calidad, cobertura, detalle técnico plegado | OK | `C/fuentes/page.tsx` → `importar/copec-sync-status.tsx` | |
| 48 | Aramco: actualizar, histórico, automática diaria | OK (decisión) | `importar/aramco-sync-status.tsx` («Actualizar ahora», «Traer meses anteriores»); `lib/combustibles/sources-status.ts` (dato «Sincronización automática»); `ajustes/integraciones/aramco-credentials.tsx` (Switch «Actualizar sola cada día») | Por decisión del usuario el interruptor se queda en Ajustes › Integraciones (requiere `manage_integrations`). Tercera pasada: la fila de Aramco en Fuentes muestra el estado («Activada», «Apagada» o «Sin credenciales») y, para quien puede cambiarlo, el enlace «Cambiar en Ajustes» |
| 49 | Credenciales Aramco solo con permiso | OK | `C/ajustes/integraciones/page.tsx` (`requirePermission("combustibles:manage_integrations")`) | |
| 50 | Exportar pendientes/rechazos de integraciones | OK | `fuentes/page.tsx` `FuelProviderQualityExportButton` | |
| 51 | Una sola lista de archivos; revertir con confirmación | OK | `fuentes/page.tsx` «Archivos importados», `C/fuentes/archivos/page.tsx`, `imported-files-table.tsx` + `RevertFileDialog` | Tarjeta, planilla, telemetría, surtidor y sellos |
| 52 | Vincular patentes | OK | `C/revisar/page.tsx` tipo patente (`link-plate-form.tsx`); `fuentes/archivos/[tipo]/[id]/tarjeta-detail.tsx` y `planilla-detail.tsx` | |
| 53 | Importar planilla de cargas | OK | `C/fuentes/agregar/planilla/page.tsx` → `OperationsImportWizard`; plantilla en Fuentes | |
| 54 | Detalle y reversión de planilla; vincular faenas/patentes | OK | `fuentes/archivos/[tipo]/[id]/planilla-detail.tsx` | |
| 55 | Telemetría y despachos de surtidor | OK | `?agregar=telemetria` / `surtidor` → `control/importar/import-wizard.tsx`; plantillas y revertir desde la lista | |
| 56 | Importar histórico de sellos | OK | `C/fuentes/agregar/sellos/page.tsx` → `TaeImportReportForm` | |
| 57 | Lotes de sellos: detalle, reprocesar, revertir | OK | `fuentes/archivos/[tipo]/[id]/sellos-detail.tsx` | `ReprocessTaeBatchButton`, `RevertFileButton` |
| 58 | Decisiones de equivalencia, con aviso | OK | `sellos-detail.tsx` «Identidades sin equivalente» | Texto «se aplica sola desde la próxima importación» |
| 59 | Cola de cargas: Pendientes / Decididas | OK | `C/revisar/page.tsx` (SectionNav Pendientes/Decididas, decisión Cuenta/No cuenta) | |
| 60 | 7 motivos con su dato | OK | `lib/combustibles/inbox/reasons.ts` `flagDatum`; `inbox-list.tsx` pinta `row.datum` | |
| 61 | Cuenta/No cuenta, nota 10–500, motivos rápidos | OK | `components/combustibles/inbox/decide-load-buttons.tsx` | `DECISION_QUICK_NOTES` |
| 62 | Duplicado: «Son dos cargas distintas» / «Es la misma carga» | OK | `reasons.ts` `decisionCopyFor` | |
| 63 | Decidir varias a la vez | OK | `inbox-list.tsx` → `bulk-decide-bar.tsx` | |
| 64 | Casos con filtros faena, estado, gravedad, origen | OK | `C/revisar/page.tsx`, `components/combustibles/inbox/inbox-filter-bar.tsx` (`showState`, «Filtrar por estado del caso»), `lib/combustibles/cargas-hrefs.ts`, `components/combustibles/load-detail/load-sections.tsx` (`OpenCasesNotice`) | Tercera pasada: selector de estado (Abierto, Tomada, Reabierto) en la vista «Pendientes» de los casos. Al registro de origen se llega desde la insignia «Caso abierto» de Cargas y desde la ficha de la carga, que lista sus casos abiertos; la bandeja lo muestra como el chip «Carga: …» y «Limpiar» lo quita. No hay un control para escribir el origen a mano |
| 65 | Tomar, resolver, descartar (confirmado), reabrir | OK | `components/combustibles/inbox/case-actions.tsx` | |
| 66 | Tipo de resolución de medidor con efecto explicado | OK | `case-actions.tsx` «¿Qué pasó con el medidor?», helper sobre Flota y Mantenciones | |
| 67 | Comentarios por caso | OK | `case-actions.tsx` campo «Comentario» | |
| 68 | Tomar el caso / Asignar a… | OK | `case-actions.tsx` | «Asignar a…» aparece solo con el caso en `in_review` |
| 69 | Motivo de cierre y enlace a la carga | OK | `lib/combustibles/inbox/queries.ts` «Motivo del cierre: …»; `inbox-detail-sheet.tsx` «Abrir la carga» | |
| 70 | Reglas en palabras, JSON en Avanzado | OK | `C/ajustes/reglas/rule-catalog.tsx` (Switch activa, Editar), `rule-form.tsx` («Avanzado: código y configuración en JSON») | |
| 71 | Última corrida de la revisión automática | OK | `revisar/page.tsx` pie «La revisión automática corrió el …» | |
| 72 | Contadores sin 0 falso, mismo período | OK | `revisar/page.tsx` (`summarizeFuelInbox(session, period, …)`, null → sin número) | |
| 73 | Tile «Combustible por revisar» | OK | `app/(app)/control-operacional/attention-tiles.ts` `fuelReviewTile`; `lib/combustibles/inbox/queries.ts` `getFuelInboxPendingByKind` | Tercera pasada: el tile suma los cuatro tipos (cargas, casos, patentes y pedidos) con la misma consulta que el contador del menú, y su detalle los nombra. Verificado en el navegador: «5 · 5 casos» igual al «Todo · N» de la bandeja. No depende del período: sólo coincide con la bandeja en el período por defecto y sin `?faena` |
| 74 | Lista de cargas en terreno con filtros y cifras | OK (decisión) | `C/cargas/cargas-filters.tsx` («Formulario en terreno (QR)», «Registrada en la app», «Histórico de sellos»); tira de `C/cargas/page.tsx` | Los filtros están. Tercera pasada: vuelven las cifras de calidad (por validar, con observación, sello incompleto, menos de 4 fotos) como tira sobre la lista. Los litros del conjunto no se repiten en Cargas: se ven en Consumo › Litros (una cifra, una pantalla: regla A5). «Por revisar» sigue sin incluir las cargas por validar, por decisión del usuario |
| 75 | Litros por supervisor, conductor, punto | OK | `C/cuadratura/sellos/page.tsx` (vista «Por supervisor»: «Litros por punto de carga» + pliegue con supervisor y conductor) | |
| 76 | Exportar cargas en terreno | OK | `C/bitacora/export-button.tsx` desde Cargas (filtros incluyen «Cómo llegó»); con solo `tae_export` usa `TaeExportButton` | |
| 77 | Detalle terreno: alertas, anterior/siguiente, fotos, historial | OK | `components/combustibles/load-detail/terreno-load-detail.tsx` | «Alertas por resolver», «Cargas vecinas», «Fotos», «Historial» |
| 78 | Validar / Con observación / Anular | OK | `load-detail/review-controls.tsx` | Validar sin motivo; observación con nota; Anular con motivo + ConfirmDialog |
| 79 | Corregir lectura (cambio de tablero) | OK | `load-detail/meter-correction-dialog.tsx` «Cambio de tablero o de equipo (inicia una serie nueva)» | |
| 80 | QR, revocar, crear puntos con tipo y estanque | OK | `C/ajustes/puntos-de-carga/loading-points-panel.tsx`, `new-loading-point-button.tsx` | |
| 81 | Cobertura tarjeta y terreno, exportable | OK | `C/cuadratura/tarjeta-y-terreno/page.tsx` (+ `export-button.tsx`) | |
| 82 | Cuadratura por mandante con tolerancia | OK | `C/cuadratura/mandante/mandante-sections.tsx` (Entró / Entregado directo / Vía estanque / Diferencia / tolerancia) | La pestaña aparece solo con permiso de terreno |
| 83 | Terreno vs proveedor por medio | OK | `C/cuadratura/proveedor/page.tsx` + `medium-section.tsx` | |
| 84 | Sellos por supervisor: sin sello, cadena rota, justificaciones | OK | `cuadratura/sellos/supervisors-section.tsx` | |
| 85 | Detalle por equipo con sellos, cadena y fotos | OK | `cuadratura/sellos/detail-section.tsx` («Cadena de sellos», «Fotos»); ficha de equipo «Cadena de sellos» | La ficha no muestra fotos; esas están en Cuadratura › Sellos |
| 86 | Historial de sellos; el último ya no es problema | OK | `cuadratura/sellos/history-section.tsx` («repetido», «Vigente») | |
| 87 | Estanques: recibido, registrado, entregado, diferencia | OK | `C/cuadratura/estanques/page.tsx` (4 tiles) | |
| 88 | Nivel por estanque, movimientos, registrar | OK | `estanques-sections.tsx` «Nivel por estanque»; `cycle-workbench.tsx` «Registrar movimiento» | |
| 89 | Facturas con filtros, cifras, gráficos, export, IEC e IVA | OK | `C/pagos/page.tsx`, `invoices-table.tsx` (columnas IEC, IVA), `invoice-charts.tsx` | Exportar exige `export_sensitive` |
| 90 | Estados de cuenta por proveedor y mes | OK | `C/pagos/estados/page.tsx` + `statements-table.tsx` | |
| 91 | Crear con vista previa | OK | `pagos/estados/new-statement-dialog.tsx` (`previewMonthlyStatementAction`) | |
| 92 | Detalle con estado y fechas legibles | OK | `pagos/estados/[id]/page.tsx` → `cuenta-corriente/[id]/statement-detail.tsx` (MetaBadge, formatDate) | |
| 93 | Registrar pago ≤ saldo | OK | `statement-detail.tsx` `AddPaymentDialog` (`max={pendingAmount}`) | |
| 94 | Panel según rol con período elegible | OK | `C/page.tsx` → `C/panel-content.tsx` (jefatura: `PanelStepsStrip`; terreno: `FieldPanel`; consulta), `FuelPeriodControl` | |
| 95 | Aviso mensual + paso 5 del Panel | OK | `lib/combustibles/notifications.ts`; `lib/combustibles/panel/steps.ts` paso «Pagos» («todavía no tiene estado de cuenta») | El envío de la notificación no lo probé |
| 96 | Mandantes con faenas y tolerancia | OK | `C/ajustes/mandantes/mandantes-table.tsx` | |
| 97 | Medios con alias y lectura automática | OK | `C/ajustes/medios/supply-media-table.tsx` («Alias en planillas», «Se actualiza solo») | |
| 98 | Familia por tipo de equipo | OK | `C/ajustes/familias/equipment-families-table.tsx` | |
| 99 | Umbrales y recálculo con progreso | OK | `C/ajustes/umbrales/thresholds-form.tsx` (`Progress`, se puede detener) | |
| 100 | Proveedores y vehículos; Ajustes enlaza | OK | `lib/combustibles/section-nav.ts` ítem externo «Proveedores y vehículos» → `/admin/flota-catalogos` | |
| 101 | Permisos, alcance, auditoría | OK | Guards `requirePermission` / `guard*` en las páginas y acciones revisadas; auditoría en `lib/combustibles/control/review.ts`, `anomaly-cases.ts`, `fuel-log-review-request.ts`, `provider-mappings.ts` | Revisión por muestreo, no exhaustiva sobre todas las escrituras |
