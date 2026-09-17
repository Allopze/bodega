# ¿Está mejor el módulo actual o lo planteado desde el Excel? — Comparativa y estado del módulo de Prevención

**Fecha:** 2026-09-16
**Compara:** [PDTP_INTERFAZ_DESDE_EXCEL_2026-09-16.md](PDTP_INTERFAZ_DESDE_EXCEL_2026-09-16.md) (spec derivada solo del Excel RE-36) contra el módulo `prevention` vigente en `main`.
**Evidencia usada:** esquema `db/schema/prevention/pdtp.ts` (33 tablas), servicios `lib/services/pdtp/*` (~6.100 líneas) y adaptadores 2026, las 27 pantallas de `app/(app)/prevencion/pdtp`, el manifiesto de navegación, y los informes previos: auditoría integral 2026-09-12, auditoría de ejecución por submódulos 2026-09-06, decisiones 2026-09-02, estado del programa 2026-09-10 y QA UI/UX 2026-09-16. Además se corrió el subconjunto de pruebas PDTP no-PGlite: **42 archivos, 308 pruebas, todas en verde** (24,6 s).

> **Nota de actualización.** El análisis original capturó cambios en curso. El lote PDTP-A01–A13 ya quedó incorporado en el estado actual: compatibilidad de huellas, ciclo v+1, diff/aplicación completa, ejecutores acreditadores, cobertura accionable, tablero/planilla y CTA de revisión. Los gates deterministas pasan; la UAT visual autenticada del módulo sigue pendiente porque la sesión disponible redirige a `/dashboard` ([reporte de cierre](qa/reports/2026-09-16-pdtp-audit-fixes.md)).

---

## 1. Veredicto

**El módulo actual es mejor que lo planteado en el documento, y por mucho, en modelo, reglas y trazabilidad.** El documento describe, en esencia, "el Excel corregido": una planilla con validaciones, calendario real y vistas derivadas. El módulo hace algo distinto y más ambicioso: convierte cada actividad del programa en un **contrato de cumplimiento** que se acredita desde el submódulo donde el trabajo ocurre de verdad (inspecciones, capacitación, incidentes, alcotest, CGRD, entregas de EPP, higiene…), con obligaciones por evento, cobertura contra padrones reales, aprobación segregada, versionado con huella de contenido, importación con staging y rollback, expediente auditor y cola de trabajo por responsable.

De los **15 problemas del Excel** identificados en el documento, el módulo resuelve **11** de raíz, dos quedan parciales (P-10 semanas reales, P-11 motivo de no cumplimiento por celda), uno se resuelve con una regla distinta que conviene revisar (P-2, tope de sobrecumplimiento por mes en vez de por actividad) y uno deja de ser problema por diseño (P-9, actividades duplicadas por responsable).

**Lo que el documento sí aporta** son cinco brechas concretas que el módulo no cubre o cubre a medias, y que importan para auditores, mandante y jefatura: la exportación con el formato RE-36 completo, presets de planificación más ricos, el registro de "no cumplida con motivo" por celda, el cierre/foto mensual y la asignación nominal a personas cuando dos cargos comparten faena.

**La debilidad real del módulo no es de alcance sino de madurez operativa y legibilidad:** es grande (26 submódulos, 124 permisos, 300 migraciones, 45 conectores), todavía no está en producción, el programa 2026 recién quedó activo en desarrollo el 10-09, la auditoría integral del 12-09 lo declara no apto para preproducción por bloqueadores ajenos al PDTP, la suite E2E no es un gate reproducible, y el QA de hoy encontró dos P1 de comunicación contradictoria. La recomendación es **no rehacer nada según el documento**: usarlo como lista de aceptación, cerrar las cinco brechas y concentrar el esfuerzo en estabilizar y simplificar lo que ya existe.

---

## 2. Dos modelos distintos del mismo problema

| Dimensión | Documento (desde el Excel) | Módulo actual |
|---|---|---|
| Unidad central | La celda P/E de la grilla 48 semanas | La **actividad como contrato**: mecanismo (`enganche`, `constancia`, `formulario`, `compuesta`), modo de calendario (`scheduled`, `on_demand`, `triggered`), modo de indicador (`planned_vs_completed`, `coverage`, `closed_on_time`, `completed_count`) — [pdtp.ts:355-474](db/schema/prevention/pdtp.ts#L355-L474) |
| Quién registra la ejecución | El responsable marca E en la interfaz PDTP (M4) | **El submódulo donde ocurre el hecho** acredita automáticamente: 68 de 81 actividades son `enganche`; solo 9 son constancias manuales. Mapa en [fulfillment-contract-2026.ts:86](lib/services/pdtp-adapters/fulfillment-contract-2026.ts#L86) |
| Actividades a demanda | Botón "registrar ocurrencia" sin P | `pdtp_obligations` con `dueAt`, idempotencia, origen manual/integración y recordatorios `due_7d/due_1d/overdue` — [pdtp.ts:537-574](db/schema/prevention/pdtp.ts#L537-L574) |
| Fuente de verdad del plan | Grilla de 48 semanas + patrones | **Regla de recurrencia** (`recurrenceRule`) proyectada a la grilla como compatibilidad — [recurrence.ts](lib/services/pdtp/recurrence.ts) |
| Identidad de la actividad | ID interno + N° visible | Catálogo corporativo con **revisiones inmutables** (`pdtp_catalog_activities` / `_revisions`) y actividad anual que referencia una revisión — [CONTEXT.md](CONTEXT.md) |
| Denominador de cobertura | Cantidad esperada por ocurrencia | Padrón **derivado de registros vivos** (dotación, extintores, expuestos GES, equipos, trabajadores nuevos, capacidades) con override manual — [compliance.ts:189-270](lib/services/pdtp/compliance.ts#L189-L270) |
| Aprobación | Elaborado/aprobado con fecha y firma | Dos pasos con segregación (`not_elaborator`, `different_from_previous`), huella SHA-256 del contenido y snapshot de revisión — [approval-flow.ts:26-35](lib/services/pdtp/approval-flow.ts#L26-L35) |
| Cambios | Bitácora automática + versiones | `pdtp_change_log` (before/after por sección), `contentVersion`, `contentDigest`, revisiones v+1 que conviven con la evidencia de la anterior — [pdtp.ts:49-52](db/schema/prevention/pdtp.ts#L49-L52) |
| Relación con el Excel | Importar una vez; exportar con layout RE-36 | Importación por lotes con vista previa, severidades por fila, snapshot pre-aplicación y **rollback** — [pdtp.ts:121-178](db/schema/prevention/pdtp.ts#L121-L178). Exportación **plana** por mes, sin layout RE-36 |

El módulo sigue el principio de [PRODUCT.md](PRODUCT.md): *"el trabajo antes que el documento"* y su anti-referencia explícita *"una planilla reproducida celda por celda dentro del navegador"*. El documento, por construcción, se acerca a esa anti-referencia.

---

## 3. Los 15 problemas del Excel: ¿los resuelve el módulo?

| # | Problema del Excel | Estado en el módulo | Evidencia |
|---|---|---|---|
| P-1 | Desfase de columnas P/E | **Resuelto.** `pdtp_activity_schedule.plannedQuantity` y `pdtp_executions.executedQuantity` son tablas distintas con CHECK de mes 1–12 y semana 1–4 | [pdtp.ts:517-535](db/schema/prevention/pdtp.ts#L517-L535), [:576-616](db/schema/prevention/pdtp.ts#L576-L616) |
| P-2 | Cumplimiento > 100 % | **Resuelto con regla distinta.** El tope se aplica al total del mes (`min(ΣE, ΣP)`), no por actividad; una actividad sobreejecutada puede compensar otra no hecha dentro del mismo mes. Es una decisión registrada ("respuesta 2.4"), no un descuido — pero conviene revisarla (ver §6) | [compliance.ts:345](lib/services/pdtp/compliance.ts#L345) |
| P-3 | E como bandera vs conteo | **Resuelto y mejorado.** `indicatorMode` por actividad; `coverage` es todo-o-nada contra padrón; `targetValue/targetUnit` separan meta de cantidad | [pdtp.ts:401-430](db/schema/prevention/pdtp.ts#L401-L430) |
| P-4 | "% mensual" que es semanal; trimestral = promedio de promedios | **Resuelto.** Mensual/trimestral/anual = ΣE/ΣP; `percent = null` cuando P = 0; solo ejecuciones **aprobadas** cuentan | [compliance.ts:292-356](lib/services/pdtp/compliance.ts#L292-L356) |
| P-5 | Hojas por cargo desincronizadas | **Resuelto.** `pdtp_sheets` + `pdtp_sheet_activities` son enlaces a la misma actividad; ocho hojas con roles por defecto | [sheet-meta-2026.ts:10-18](lib/services/pdtp-adapters/sheet-meta-2026.ts#L10-L18) |
| P-6 | Copias por faena y por mes | **Resuelto.** Membresía `pdtp_program_worksites`, exclusión por actividad-faena con motivo, overrides de cantidad y parámetros por faena; nunca una copia | [pdtp.ts:874-925](db/schema/prevention/pdtp.ts#L874-L925) |
| P-7 | Actividad "a demanda" como imagen | **Resuelto.** `scheduleMode` + `triggerType/triggerDescription` + `dueDays/dueHours` | [pdtp.ts:372-386](db/schema/prevention/pdtp.ts#L372-L386) |
| P-8 | Responsables en texto libre | **Resuelto.** `pdtp_responsible_catalog` con slug, rol RBAC y `operatedByRoleName` (D21: conductores sin cuenta, opera el JT) | [pdtp.ts:267-292](db/schema/prevention/pdtp.ts#L267-L292) |
| P-9 | Actividades duplicadas por responsable (30/31, 33/34, 37/38, 64/65, 68/70) | **Mantenido a propósito.** Siguen siendo actividades separadas porque acreditan desde instrumentos y permisos distintos (`execute` vs `review`); el catálogo con revisiones evita que el texto diverja | [fulfillment-contract-2026.ts:127-135](lib/services/pdtp-adapters/fulfillment-contract-2026.ts#L127-L135) |
| P-10 | "Sem 1–4" no son fechas | **Parcial.** Se conservan 4 bloques por día del mes (1–7, 8–14, 15–21, 22–31); la ejecución sí tiene `executedAt`, `occurredAt` y `dueAt` reales. Semanas ISO exigen remodelar `pdtp_activity_schedule` (CHECK 1–4) | [period.ts:22-30](lib/services/pdtp/period.ts#L22-L30), [recurrence.ts:15-21](lib/services/pdtp/recurrence.ts#L15-L21) |
| P-11 | Sin evidencia ni motivo | **Resuelto (evidencia), parcial (motivo).** Evidencia texto/URL/fotos con `evidenceStatus`; el motivo existe para rechazo, cancelación, retiro y exclusión, pero no hay "no realizada por X" por celda (ver G3) | [pdtp.ts:585-601](db/schema/prevention/pdtp.ts#L585-L601) |
| P-12 | Rangos fijos y filas ocultas como filtro | **Resuelto.** Totales calculados; filtros por estado, hoja, faena, período en URL | [actividades/page.tsx](app/(app)/prevencion/pdtp/actividades/page.tsx) |
| P-13 | Control de cambios manual | **Resuelto.** Bitácora automática, historia documental importada reconciliada con usuarios reales, versiones | [pdtp.ts:180-206](db/schema/prevention/pdtp.ts#L180-L206), [:735-748](db/schema/prevention/pdtp.ts#L735-L748) |
| P-14 | Glosario incompleto | **Resuelto.** Catálogo de responsables + leyenda de roles importada, visible en el detalle del programa | [[programId]/page.tsx:349-395](app/(app)/prevencion/pdtp/[programId]/page.tsx#L349-L395) |
| P-15 | Vacío vs 0 solo visual | **Resuelto.** Estados derivados `pending / executed / overdue / not_scheduled` por actividad-período y `draft / submitted / approved / rejected` por ejecución | [period.ts:76-100](lib/services/pdtp/period.ts#L76-L100) |

---

## 4. Módulo por módulo: lo que el documento pide vs lo que existe

| Módulo propuesto en el documento | Qué existe hoy | Comparación |
|---|---|---|
| **M1 Programas** (lista, cabecera, crear copiando año anterior o corporativo→faena) | `/pdtp/programas`, `/pdtp/nuevo` con `creationMode` `blank / program_copy / template / xlsx_import / base_2026`; plantillas versionadas (`pdtp_program_templates`); cabecera con los 7 campos de indicadores, código y revisión documental | **Módulo supera.** Además: ciclo `draft → in_review → rejected/active → closed/archived`, reapertura con motivo, pesos de cumplimiento integral |
| **M2 Catálogo de objetivos y actividades** (árbol, ficha, "no aplica" por faena) | Catálogo corporativo con revisiones (`/admin/pdtp-catalogos`), formulario guiado, retiro con motivo y fecha efectiva, exclusión por faena con motivo. **No hay entidad "objetivo"**: la agrupación de los 8 objetivos del Excel no existe como dato; el desglose "por eje" usa las hojas | **Equivalente, con una laguna:** los 8 objetivos del RE-36 no se modelan (ver G6) |
| **M3 Planificador** (grilla 48 semanas, cabeceras fijas, patrones, edición masiva, carga por rol) | Pestaña *Planificación* con grilla semanal editable, autoguardado, detección de conflictos entre sesiones, densidad, navegación por teclado; presets por fila **Semanal / 1×mes / Trimestral**; recurrencia con `weekOfMonth`, `months`, `interval`; horizonte acotado al período del programa; herramienta de reprogramación de calendario vencido | **Parcial.** Faltan presets que el Excel usa (quincenal, campaña por rango de meses, puntual por fechas, diario n/semana, mensual "semana N" desde UI), aplicación masiva a varias actividades y el indicador de carga por rol (ver G2) |
| **M4 Registro semanal** (vista "esta semana", cantidad, estado, evidencia, ejecutor, alertas) | Vista `semana` por faena con formulario mes/semana/cantidad/observación/evidencia (foto o PDF), evidencia mínima exigida por actividad, envío→aprobación, recordatorios semanales por cron, cola `/pendientes` con dueño por rol | **Módulo supera** en flujo (aprobación, recordatorios, cola). **Falta** el estado explícito "no realizada + motivo" y "reprogramar esta celda" (ver G3) |
| **M5 A demanda** (registrar ocurrencia, evento asociado, conteo aparte) | `/pdtp/obligaciones`: obligaciones abiertas por integración (un incidente abre 66–78; un ingreso abre 15/18/19/23/52) o a mano con motivo ≥10 caracteres; `closed_on_time` con plazo en días u **horas** (DIAT, informe preliminar 3 h) | **Módulo supera** |
| **M6 Mi programa** (por cargo y por persona) | Ocho hojas por rol; `/pendientes` filtra por permiso y faena del usuario; ejecutores por rol (`pdtp_activity_executor_assignments`) | **Parcial.** No hay asignación **nominal** a una persona: si dos supervisores comparten faena por turno, ambos ven lo mismo (ver G5). La variante Excel "POR CARGO" con nombre y apellido no tiene equivalente |
| **M7 Tablero** (ΣE/ΣP por período, desgloses, tendencia, meta, cierre de mes) | Dashboard con 4 KPI accionables, tendencia mensual, comparativa por faena, desglose por eje; reporte de gestión filtrable; cumplimiento integral ponderado (ejecución 0,5 / verificación checklist 0,3 / cierre de acciones 0,2) | **Módulo supera** en cálculo. **Falta** el "cierre de mes" como foto congelada del programa (ver G4). Los defectos visuales detectados el 16-09 (estados cero, ranking y `Plan / ejecutado`) quedaron corregidos en el lote actual; la comprobación visual autenticada sigue pendiente |
| **M8 Aprobación y versiones** | Flujo de dos pasos segregado, digest, snapshot de revisión, cambios post-firma detectados, revisión correctiva v+1 | **Módulo supera.** El P1 histórico de divergencia de huella ya tiene CTA contextual **Crear revisión v+1** en cobertura/backlog, conserva el linaje y no muta el activo; falta repetir el recorrido autenticado |
| **M9 Roles y leyenda** | Catálogo + leyenda importada en el detalle | **Equivalente** |
| **M10 Export/Import** (Excel RE-36 completo, PDF, snapshot, import con anomalías, correo) | Import con staging/rollback y advertencias por celda ✔. Export Excel **plano** (N°, actividad, guía, responsables, 12 × P/E mensual, totales) + hojas de plan de acción y seguimiento; expediente auditor; reporte de gestión. Sin cabecera, firmas, control de cambios, glosario ni columnas semanales. El propio código lo reconoce: *"perfil de compatibilidad 2026 opcional, §6.6, todavía no construido"* | **Brecha principal** (ver G1) |
| **M11 Permisos** | 124 permisos del módulo, grants por rol, `sign_own_work` para jefatura técnica, segregación en aprobación | **Módulo supera** |
| **Reglas de cálculo §5.4** | Implementadas con más matices (coverage, closed_on_time, flujo vs stock, activación "desde el mes en curso" D01) | **Módulo supera** salvo regla 2 (tope por actividad) |
| **Validaciones §5.5** | CHECKs en BD para casi todo lo listado; evidencia mínima exigida; compuerta de activación que exige instrumento vigente por actividad (81/81) | **Módulo supera** |

---

## 5. Lo que el documento aporta: brechas priorizadas

| # | Brecha | Por qué importa | Tamaño | Prioridad |
|---|---|---|---|---|
| **G1** | **Exportación con el formato RE-36** (cabecera con indicadores y logo, columnas semanales P/E, totales semanales/trimestrales, elaborado/aprobado, control de cambios, glosario, leyenda) para el programa general y por hoja | Es lo que hoy recibe el mandante (`CUMPLIMIENTO CHOME/06.- JUNIO`), lo que audita Mutual y lo que firma Legal. Sin esto la faena seguirá manteniendo el Excel a mano en paralelo — la doble digitación que PRODUCT.md prohíbe | Medio: ya existe `ReportData` multi-hoja y `buildXlsxBuffer`; falta el builder de layout | **Alta** |
| **G2** | **Presets de planificación completos y aplicación masiva**: quincenal (S1/S3, S2/S4), campaña por rango de meses, puntual por fechas, diario (n por semana), mensual en semana N desde la UI; aplicar a N actividades; carga planificada por rol y semana | El Excel 2026 usa 8 patrones; con 3 presets, 59 de las 89 actividades se planifican celda a celda otra vez | Pequeño-medio: `PdtpRecurrenceRule` ya soporta `weekOfMonth`, `months` e `interval` | **Alta** |
| **G3** | **"No realizada" con motivo y reprogramación por celda** (estados `no_cumplida`, `reprogramada`, `no_aplica_este_período`) | Hoy una celda sin ejecución solo puede ser pendiente/atrasada; la jefatura no distingue "no se hizo por lluvia" de "nadie lo registró". El reporte mensual al mandante exige la causa | Pequeño: tabla `pdtp_executions` ya tiene `status` y `rejectionReason`; falta un estado y un campo | **Media** |
| **G4** | **Cierre de mes**: foto congelada del programa por faena (P, E, %, evidencias, acciones) con fecha de corte y exportable | Reemplaza las cinco copias mensuales del Excel y da al Subgerente (act. 5) y a JDPR (act. 4) un documento inmutable para difundir | Medio: `audit-dossier.ts` y `management-report.ts` ya calculan casi todo; falta persistir el corte | **Media** |
| **G5** | **Asignación nominal a personas** por faena (además del rol) | La faena Biodiversa ya opera con hojas por persona (Supervisor F. Amestica, Prevención M.J. Martínez). Con turnos, dos JT comparten faena y la cola no separa el trabajo | Pequeño: tabla `pdtp_activity_executor_assignments` puede admitir `userId` opcional | **Media** |
| **G6** | **Objetivos como entidad** (los 8 del RE-36) para agrupar, filtrar y reportar | El Excel, el DS 44 y el mandante razonan por objetivo; el módulo agrupa por hoja, que es una vista por rol, no por propósito | Pequeño | **Baja** |
| **G7** | Envío por correo del reporte mensual a la lista de distribución (gerencias, subgerente, JDPR) | Hoy solo hay recordatorios; la difusión (act. 4, 5, 7) se hace fuera | Pequeño si G4 existe | **Baja** |

---

## 6. Dónde el módulo va más allá del documento — y cuándo eso es un riesgo

**Ventajas reales que el documento no imaginó:**
- Acreditación automática desde 15 submódulos con libro durable de eventos (`pdtp_fulfillment_events`), reconciliación y revocación cuando el hecho de origen se deshace.
- Padrón derivado de registros vivos y cobertura todo-o-nada por actividad (evita el "1 de 20 extintores = cumplido").
- Compuerta de activación 81/81 que exige instrumento vigente (plantilla aprobada, curso publicado, plan de emergencia aprobado) antes de activar.
- Cumplimiento integral que pondera ejecución, verificación de checklist y cierre de acciones correctivas.
- Importación del Excel real con vista previa, severidades, historia documental y rollback.

**Riesgos que trae esa profundidad (y que el documento, por simple, no tendría):**
1. **Dependencia de configuración de contenido.** El programa no acredita nada si faltan 13 plantillas aprobadas, 13 versiones de curso publicadas, 7 planes de emergencia aprobados o el padrón real de la N°56. En desarrollo se cerró con temarios de prueba y un padrón provisional de 1 persona por faena ([ESTADO_PROGRAMA_PREVENTIVO_2026-09-10.md](docs/prevencion/ESTADO_PROGRAMA_PREVENTIVO_2026-09-10.md)). En producción esas decisiones siguen pendientes de Prevención.
2. **Legibilidad.** El QA histórico ([2026-09-16-pdtp-uiux.md](qa/reports/2026-09-16-pdtp-uiux.md)) mostró el patrón: el sistema sabía que actividades no podían acreditar y a la vez decía "todas declaran destino", y detectaba divergencia de firma sin salida. El lote actual separa destino, ejecutor y permiso, y ofrece la revisión v+1; falta comprobarlo en una sesión autenticada. Cuanto más rico el modelo, más cuesta que la pantalla lo explique en cinco segundos (principio 2 de PRODUCT.md).
3. **Regla de compensación mensual** ([compliance.ts:345](lib/services/pdtp/compliance.ts#L345)): topar ΣE al total del mes permite que 5 diálogos extra tapen una inspección no hecha. Es una decisión de la jefatura, pero es exactamente el tipo de sobrecumplimiento que el Excel dejaba pasar (P-2) y que un auditor puede objetar. Vale la pena reabrirla o al menos exponer en el tablero cuántas actividades quedaron en cero aunque el mes marque 100 %.
4. **Semanas de compatibilidad.** Los bloques 1–7 / 8–14 / 15–21 / 22–31 reproducen la limitación del Excel; el código lo declara deuda estructural ([recurrence.ts:15-21](lib/services/pdtp/recurrence.ts#L15-L21)).

---

## 7. Estado general del módulo de Prevención (no solo el PDTP)

### 7.1 Tamaño y cobertura
| Métrica | Valor |
|---|---|
| Submódulos navegables | 26 (Programa de trabajo, Matriz IPER, Mapa de riesgos, Requisitos legales, Inspecciones, Capacitación, Acciones correctivas, Incidentes, Requisitos de EPP, Emergencias, CPHS, CGRD, Permisos de trabajo, Higiene y vigilancia, Gestión del cambio, Visitas y coordinación, Indicadores SST, Daño material y ambiental, Registro documental, Estructura preventiva, Datos personales, Alcotest, Constancias, Evaluaciones SST, PPA, Campañas) |
| Archivos de rutas/componentes en `app/(app)/prevencion` | 419 |
| Tablas del esquema `prevention` | 24 archivos, 6.315 líneas; PDTP solo: 33 tablas |
| Permisos del módulo | 124 de 271 del sistema |
| Pruebas | 48 archivos de test en rutas de prevención + 157 en `lib` del dominio; 30 specs E2E de prevención (10 de PDTP) |
| Conectores de acreditación PDTP | 18 exportados en `pdtp-accreditation-connectors.ts` (45 trazados en la auditoría del 06-09) |
| Manual de usuario | `docs/manual-prevencion` en 4 partes + anexos |

### 7.2 Madurez por submódulo (según auditorías y código)
| Grupo | Estado | Nota |
|---|---|---|
| PDTP (programa, catálogo, ejecución, obligaciones, cobertura, aprobaciones) | **Funcional en desarrollo; no probado en producción.** Programa 2026 activo localmente desde el 10-09 con 81/81 cableadas | Tests PDTP en verde; los dos P1 de comunicación del QA 16-09 están corregidos en el lote actual. UAT autenticada aún pendiente |
| Inspecciones, Capacitación, Incidentes RE-20, Emergencias, CPHS | **Maduros:** plantillas versionadas, ejecución offline con cola, roles/permisos, exportación e impresión, E2E propios | Dependen de datos maestros (plantillas y cursos aprobados) para que el PDTP acredite |
| Alcotest, CGRD, Constancias, Campañas simplificadas | **Nuevos (septiembre 2026):** creados por decisiones D08, D09, D18 | Poca vida real; Constancias cubre 8–9 actividades |
| Higiene, MIPER, Requisitos legales, Documentación, EPP preventivo, Permisos, Gestión del cambio, Coordinación, Privacidad | **Existentes y probados unitariamente**; integrados al PDTP donde corresponde | Sin observaciones críticas recientes |

### 7.3 Preparación para operar
- **Auditoría integral 12-09:** global 64/100; **no apta para preproducción** por tres S1 ajenos a Prevención (`sharp`, `maplibre-gl`, Excel DTE) y porque la **suite E2E no es gate reproducible** (366 ok, 31 fallas, 126 sin correr en 45 min). QA 15-09 y 14-09 repiten que E2E no inició (salida 143 del build).
- **Deuda de calidad estructural:** React Doctor 49/100 global (contaminado por proyectos de referencia, pero 11 advertencias reales en los 60 archivos del catálogo); documentación RBAC desalineada; contrato QA con scripts inexistentes.
- **Ritmo de cambio:** 271 commits desde el 1 de septiembre, ~60 de prevención/PDTP. El módulo está en construcción activa, no en mantenimiento; cada auditoría encuentra defectos nuevos introducidos por la corrección anterior (ej. N°62 acreditaba desde una función sin llamador; N°1 acreditaba antes de haber programa activo; pendientes previos a la activación imposibles de saldar — todos ya corregidos según el log).
- **Decisiones de negocio pendientes** antes de producción: temarios oficiales de 13 cursos, padrón real de conductores (N°56), pruebas con usuarios de cargos reales, repetición de la comprobación en el ambiente destino.

### 7.4 Lectura de conjunto
El módulo de Prevención ya es un sistema de gestión SST completo, no un reemplazo de una planilla. El PDTP es su columna vertebral y está bien diseñado; su fragilidad está en que **todo depende de que los otros 15 submódulos estén configurados y en uso**. Eso es correcto como diseño ("una captura, trazabilidad completa") pero significa que el valor del PDTP se realiza tarde: hasta que las faenas no inspeccionen, capaciten y registren incidentes en la plataforma, el programa mostrará ceros y la gente volverá al Excel. El documento derivado del Excel, más pobre, habría dado valor antes pero habría consolidado la doble digitación.

---

## 8. Recomendación

1. **No rehacer ni simplificar el modelo hacia el documento.** El módulo resuelve mejor cada problema del Excel y añade lo que un auditor DS 44 va a pedir.
2. **Usar el documento como lista de aceptación** desde la perspectiva del usuario que hoy vive en el Excel: cada caso de uso CU-1…CU-12 debería tener un recorrido demostrable en la plataforma. Los que hoy no lo tienen completos son CU-9 (reportar mensual con formato del mandante) y CU-5 (vista por persona).
3. **Cerrar las brechas en este orden:** G1 export RE-36 → G2 presets y edición masiva → G3 "no realizada con motivo" → G4 cierre de mes → G5 asignación nominal. G6 y G7 pueden esperar.
4. **Mantener verificados los dos P1 del QA histórico:** separar "destino declarado" de "responsable habilitado" con CTA, y dar salida a la versión activa con contenido divergente (crear revisión). Ambos ya están implementados con ejecutores acreditadores por rol y botón de nueva revisión ante desvío de huella; las suites pasan. Falta repetir el recorrido visual cuando la sesión autenticada permita entrar al módulo.
5. **Reabrir la regla de compensación mensual** (§6.3) con la jefatura: exponer al menos "actividades en cero este mes" junto al porcentaje.
6. **Condiciones de salida a producción** (fuera del PDTP pero bloqueantes): resolver los tres S1 de la auditoría integral, recuperar E2E como gate en dos corridas verdes consecutivas y ejecutar el preflight/backfill del catálogo en el ambiente destino.
7. **Contener el crecimiento.** Con 26 submódulos y 124 permisos, cada submódulo nuevo (Alcotest, CGRD, Constancias nacieron en tres semanas) suma superficie que hay que auditar. Antes de abrir otro, medir si los existentes se usan.

---

## Anexo. Dónde se ejecuta cada actividad del Excel en el módulo actual

| Actividades (N° del RE-36) | Submódulo que las acredita | Mecanismo |
|---|---|---|
| 1 | PDTP · aprobación Legal/RRHH | enganche |
| 3, 6, 20, 22, 28, 42, 44, 61, 82 | Constancias | constancia |
| 7 | Indicadores SST · cierre de período | enganche |
| 9, 11 | CPHS / Estructura preventiva | enganche |
| 10, 24, 25, 26, 27, 29, 33, 34, 39, 40, 41, 64, 65 | Inspecciones (plantillas 2026) | enganche |
| 15, 18, 19, 23, 52 | Evaluaciones SST · acta trabajador nuevo | enganche / compuesta |
| 16, 37, 38, 51, 53–60, 63 | Capacitación (cursos PDTP-xx) | enganche |
| 17 | Evaluaciones SST · acta RE-28 (cobertura 95 % dotación) | enganche |
| 2, 5, 12, 13, 14, 21 | Retiradas del programa 2026 en el catálogo (`RETIRED_NUMBERS`); la 21 por D02 porque duplica 66–78 | — |
| 30, 31, 32 | Alcotest (DO-48) | enganche |
| 35, 36, 43 | MIPER / Documentación SST | enganche |
| 45–50 | Higiene y vigilancia (protocolos MINSAL) | enganche |
| 62 | Entregas de EPP (bodega) | enganche |
| 66–78 | Incidentes RE-20 (obligaciones por hito, plazos en horas) | triggered |
| 79, 80, 81 | CGRD | enganche |
| 83, 84 | Emergencias (plan por amenaza, simulacro) | enganche |
| 85–89 | Campañas | enganche |

Fuente: [AUDITORIA_PREVENCION_EJECUCION_SUBMODULOS_2026-09-06.md](AUDITORIA_PREVENCION_EJECUCION_SUBMODULOS_2026-09-06.md) §2 y [fulfillment-contract-2026.ts](lib/services/pdtp-adapters/fulfillment-contract-2026.ts).
