# Auditoría de production readiness — Emergencias, Higiene y Permisos de trabajo (agente `emergencias`, prefijo EMG-)

**Fecha:** 2026-09-29 · **HEAD:** `11e67621` · **Entornos:** A (`:3100`, `bodega_audit_e2e`) y B (`:3101`, `bodega_audit_real_e2e`, programa 2026 v2 real).
**Evidencia:** scripts, salidas y capturas en `scratchpad/audit/emergencias/` (`tour1.out`, `emg-plan*.out`, `emg-drill*.out`, `hyg.out`, `ptw*.out`, `test-*.log`, `pg-*.log`, `shots/`).
**Método de ejecución:** recorridos de navegador con Playwright por rol (UI real, con conteo de clics) y, para manipulaciones, llamadas directas a las *server actions* desde la página autenticada (mismo `Next-Action` que usa el cliente, IDs tomados de `.next/static`). Estado verificado con SQL de lectura sobre B.

## Resumen

| Submódulo | Nota | Lectura |
|---|---:|---|
| Plan de emergencia y simulacros | **84/100** | Muy próximo. N°84 bien resuelta de punta a punta; la N°83 se imputa al mes de aprobación y el acta del simulacro no se puede abrir desde ninguna pantalla. |
| Higiene y vigilancia | **76/100** | Funcional, requiere correcciones. N°46–50 siguen sin segregación (PRV-02), acepta fechas futuras que acreditan (una N°45 quedó **aprobada** en diciembre) y una medición no se puede anular. |
| Permisos de trabajo (PTAR/LOTO) | **79/100** | Funcional, requiere correcciones. Máquina de estados y habilitación sólidas en servidor; tres huecos de seguridad de proceso: control obligatorio «no aplica» con 3 caracteres, permiso terminado con candados aplicados, extensión sin segregación. |

Hallazgos: 🔴 0 · 🟠 1 · 🟡 8 · 🔵 13 · ⚪ 5.

Datos creados/alterados en B (todos rotulados `QA_EMG`): **se archivó el plan sembrado `PE-2026-HTZIPT` de Teno - Arauco** (necesario: índice de un plan vigente por faena; motivo trazado) y Teno quedó sin plan vigente; plan `QA_EMG Plan de emergencia Teno` (aprobado y archivado; su N°83 quedó aprobada); 3 simulacros en el plan sembrado de Horcones (dos anulados, uno completado con el archivo borrado del disco, CAPA `capa-ZWfYm4MWozsEyvmqjik_F` abierta); agente global `QA_EMG_RUIDO`, GES `QA_EMG_GES1` (Horcones, 2 mediciones, una con fecha 2026-12-15) y `QA_EMG_GES2` (Biodiversa); pronunciamientos PREXOR y TMERT de Horcones; programa `QA_EMG_VIG1`; tipos `QA_EMG_LOTO`/`QA_EMG_ACK`; permisos `permit-0LwLWl_h8ftEEa2r0jfuR`, `permit-NbkUXpHxDDIuLo4Caj8tI` (ambos cancelados con candado aplicado) y `permit-Wsb-Y0b6iyX9wxQnlTTpq`.

---

## AUDITORÍA — Plan de emergencia y simulacros

**Rutas:** `/prevencion/emergencias` (pestañas Planes/Simulacros), `/prevencion/emergencias/[planId]`.
**Archivos:** `app/(app)/prevencion/emergencias/{page,emergency-list,emergencias-dialogs,actions}.tsx|ts`, `[planId]/plan-detail.tsx` (984 líneas), `lib/services/prevention-emergency.ts` (1357), `prevention-emergency-{catalog,seed}.ts`, `emergency-resource-{catalog,service}.ts`, `app/api/prevencion/emergencias/simulacros/evidencia/{route,[name]/route}.ts`, conectores `pdtp-accreditation-connectors.ts:363-443` (N°84) y `:630-678` (N°83).
**Permisos (`modules/prevention/manifest.ts:1184-1202`):** `view` (jefe_terreno, admin_contrato, prevencionista_faena, prevencionista, cphs, jefa, admin, jefe_mantencion); `manage` (prevencionista_faena, admin_contrato, prevencionista, admin); `approve` (prevencionista, jefa, admin — **no** prevencionista_faena); `drill_execute` (jefe_terreno, admin_contrato, prevencionista_faena, prevencionista, admin).

### A. UI/UX/Diseño
- Cumple el patrón: `PageHeader` + `PageContainer`, 1 `h1` por página en los 10 roles, 4 KPI (Planes aprobados, En preparación, Simulacros realizados, Requieren mejora), pestañas con contador, «Nuevo plan» en el header, estados con `Badge` en español, `DatePicker`/`DateTimePicker` del sistema, tokens `-ink`. Sin errores de consola ni respuestas ≥400 en el recorrido (`tour1.out`).
- Detalle del plan: formulario largo pero bien seccionado (escenarios, organigrama, recursos, contactos, simulacros, casillas del programa); bloqueadores de aprobación listados en un aviso; el plan aprobado explica que su contenido quedó congelado.
- Fricciones: la tabla de simulacros sólo muestra escenario, fecha programada, estado y resultado — no la fecha real, el motivo de anulación ni **la evidencia** (EMG-07, EMG-18). Un simulacro anulado y uno cancelado se ven igual («Cancelado»), el anulado además con «Satisfactorio». «Nuevo plan» se ofrece aunque todas las faenas tengan plan vigente; el error recién aparece al enviar (EMG-23). En un plan archivado siguen los botones «No hecha/No aplica» de las casillas (EMG-26).
- **Estados observados:** con información (7 planes), sin información (sin recursos/contactos, «Sin simulacros programados»), permisos insuficientes (`sup`, `legal`, `ti` → `/forbidden`), fuera de alcance (`prevfaena`→plan de Biodiversa y `otrafaena`→Horcones: «Error 404 No encontramos este registro»), operación exitosa (el diálogo se cierra; no hay toast, el cambio se ve en la tabla), operación fallida (mensaje en el diálogo). No observé «Cargando» (existe `loading.tsx`).
- **Responsive:** detalle del plan en borrador a 1024/768/390 px sin desborde horizontal; diálogo «Completar simulacro» usable a 390 px (scroll interno) — captura `B-prevfaena-drill-complete-dialog-390.png`.

### Facilidad de uso (medido en B)
| Tarea | Rol | Clics/campos |
|---|---|---:|
| Crear plan | prev | 5 |
| Agregar escenario | prev | 6 |
| Agregar rol del organigrama | prev | 3 |
| **Aprobar el plan** (otro usuario) | prev2 | **2** (abrir + «Aprobar plan», sin confirmación) |
| Programar simulacro | prevfaena | 4 |
| **Completar simulacro con evidencia** (archivo + casilla + resultado) | prevfaena | **7** |
| Anular simulacro realizado | prevfaena | 3 |

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Crear plan (uno vigente por faena) | ✅ | UI 5 clics; índice parcial + mensaje de dominio |
| Escenarios / roles / contactos / validaciones | ✅ | tipo inexistente, procedimiento corto y titular de otra faena rechazados (`emg-plan.out` 3c–3e) |
| Aprobación segregada | ✅ | creador no ve el botón y la acción directa responde «Quien crea el plan no puede aprobarlo.» |
| Archivar plan | ✅ | con motivo ≥10; libera la faena |
| Programar / completar simulacro | ✅ | executedAt futuro y anterior a lo programado rechazados |
| Subir evidencia (MIME real, 25 MB, alcance) | 🟡 | HTML con `.pdf` rechazado; 26 MB → 413; otra faena → 404. La extensión guardada sale del nombre del cliente (EMG-13) |
| Ver/descargar el acta | 🔴 | la ruta GET existe y respeta alcance, pero **ninguna pantalla la enlaza** (EMG-07) |
| Anular simulacro completado + revocación | ✅ | N°84 → `draft`, casilla → pendiente; la CAPA derivada queda abierta (EMG-10) |
| Casillas «No hecha/No aplica» | ✅ | (PGlite/postgres) |
| Recursos (vínculo al inventario) | ✅ | cubierto por `emergency-resource-*` (no recorrido a fondo) |

### C. Código y lógica
Servicio bien estructurado: `EmergencyDomainError` separa mensajes de usuario de errores internos, CAS por `version` en plan/simulacro/casilla, acreditación después del commit. Puntos: el gate de cierre cuenta filas de evidencia activas, no archivos existentes (`prevention-emergency.ts:900-912`, EMG-11); `cancelEmergencyDrill` no toca la CAPA ni la evidencia (`:1026-1083`, EMG-10) y resetea la casilla sin subir `version` (`:1058-1064`, EMG-25); `completeEmergencyDrill` no mira el estado del plan (`:874-882`, EMG-27); `generateStorageName(fileName)` usa la extensión del cliente (`:706`, `prevention-documents/utils.ts:230-234`).

### D. Modelo de datos
Tablas `prevention_emergency_{plans,scenarios,roles,contacts,resources,drills,drill_evidence,drill_slots,…}` con `version`, historial en `prevention_emergency_history`, borrado lógico (archivado/cancelado), índice parcial de plan vigente por faena. El equipo pertenece a la faena, no al plan (archivar no borra inventario). Sin huérfanos observados salvo la CAPA de un simulacro anulado.

### E. Permisos y seguridad
- Alcance por faena en detalle, acciones, subida y descarga: `otrafaena` 404 en el plan y en la evidencia de Horcones, 400 al subir y «no encontrado» al cancelar; `ti` 403; `cphs`/`jt` 200 en su faena.
- Descarga: `inline` sólo PDF/imagen, `nosniff`, `Content-Type` desde la fila (no desde la extensión); traversal `..%2F` → 400.
- Riesgo potencial (no explotado): `fileName` original con `../../../evil.html` se persiste tal cual y se devuelve en `Content-Disposition` (codificado); archivo guardado `…AnXTWy….html` con `image/png`.

### F. Testing
Corrí: unitarias `prevention-emergency-{actions,calc,threat-catalog}`, `emergency-resource-catalog`, `worksite-inventory` (dentro de 10 archivos / **116 PASS**); PGlite `prevention-emergency-{plan-seed,list}`, `emergency-resource-inventory-pglite` (dentro de 6 archivos / **77 PASS**); **`prevention-emergency-postgres` 23/23 PASS** (no *skipped*). E2E existentes (`prevencion-emergencias-simulacros.spec.ts`, 30 líneas; `emergency-resource-catalog.spec.ts`): sólo carga de bandeja y extintores; **ningún E2E** de aprobar plan, completar simulacro con acta o anular (EMG-19).

### G. Integración con Programa Anual (ejecutado en B, programa 2026 v2)
- **N°83 (plan aprobado):** `prev` creó `QA_EMG Plan… Teno` con 2 escenarios; `prev2` aprobó → ejecución `pdtp-accredit-KB-8EnQ22mbHTZ0Mth2Zx` `submitted`, **cantidad 1** (PRV-19 #16 corregido), `executed_by = qa-prev2`, `evidence_status = not_required`, evidencia textual «Plan de emergencia aprobado: PE-2026-FV1H2R», metadato `evidenceRejection = wrong_domain` (ruido). `prev2` no pudo aprobarla («Quien registró el cumplimiento no puede aprobarlo»); `prev` (autor del plan) sin motivo → rechazado; **con motivo → aprobada**. Dos personas distintas intervinieron (autor ≠ aprobador del plan ≠ registrante), lo considero aceptable.
  - **Celda:** quedó en **septiembre semana 4**, mientras la N°83 se planifica en **marzo semana 1**. La planilla de Teno muestra `MAR 1 / -`, `SEP - / 1` y `Histórico 1 / 1` (captura `B-pdtp-teno-Plan_emergenci.png`); el indicador mensual topa por mes («lo ejecutado sin plan en el mes no aporta», `compliance.ts:1194-1197`) → EMG-06.
  - **Archivo del plan:** la N°83 siguió `approved` (decisión PRV-04 declarada: un documento archivado respalda el período en que estuvo vigente). Coherente, pero el diálogo de archivo no lo advierte ni ofrece la vía de anulación PDTP si el plan se emitió por error (EMG-12).
- **N°84 (simulacro):** acta PDF real + casilla «septiembre · semana 3» → `approved` automáticamente (`approvalMode = automatic_source_event`), `evidence_status = provided` con sha256, celda **m9 w3** (la planificada). Archivo borrado del disco antes de cerrar → `submitted`, `evidenceRejection = file_missing` (**PRV-01 corregido**). URL externa: imposible, no hay campo (sólo subida). Evidencia de otra faena: imposible por UI y rechazada por API. **Anulación de un completado** → la N°84 pasa a `draft`, la casilla vuelve a `pending`, queda evento `revoked` en `pdtp_fulfillment_events` (**PRV-19 #8 corregido**).
  - Una sola aprobación: el ejecutor que cierra el simulacro con acta verificada es quien auto-aprueba (diseño M0.4).
- Observación transversal (EMG-22): los 7 planes sembrados en `bodega_dev` se aprobaron el 10-09 con el programa v1 y sus N°83 quedaron `submitted` en v1; la revisión v2 no las trasladó, así que en B **ninguna faena tiene N°83** pese a tener plan aprobado.

### H. Hallazgos

```text
ID: EMG-06
Severidad: 🟡 IMPORTANTE
Submódulo: Plan de emergencia (N°83) · Higiene (N°46–49)
Categoría: Integración con Programa Anual
Título: La N°83 y las N°46–49 se imputan al mes del acto, no a la celda planificada; un cumplimiento tardío no paga la celda adeudada
Archivo(s): lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts; lib/services/pdtp-adapters/hygiene-accreditation-connector.ts; lib/services/pdtp/compliance.ts
Línea(s): pdtp-accreditation-connectors.ts:630-678 (occurredAt = approvedAt, sin plannedPeriod); hygiene-accreditation-connector.ts:213-225 (occurredAt = assessedOn); compliance.ts:1194-1197 (tope por mes)
Pantalla/ruta: /prevencion/pdtp/actividades?faena=ie5q-M3p_RCnZFC0P_d0h&vista=anual (página 3); ídem ws-horcones
Endpoint: approveEmergencyPlanAction, setProtocolApplicabilityAction
Rol: prevencionista / jefa (aprobador)
Descripción: simulacros (casilla), alcotest y N°45 usan plannedPeriod para pagar la celda planificada; el plan de emergencia y los protocolos no. Aprobar el plan en septiembre crea la ejecución en septiembre (sin plan) y la celda de marzo queda en cero.
Evidencia: DEMOSTRADO (navegador + SQL en B). N°83 Teno: MAR «1 / -», SEP «- / 1», Histórico «1 / 1». N°46 PREXOR Horcones: ENE–ABR «1 / -», SEP «- / 1», Histórico «4 / 1».
Cómo reproducir:
1. Aprobar un plan de emergencia fuera de marzo (o pronunciarse sobre PREXOR fuera de ene–abr).
2. Abrir la vista anual de la faena, página 3 (N°83) o 2 (N°46).
3. La celda planificada sigue sin ejecución; la ejecución aparece en un mes sin plan.
Resultado actual: el indicador mensual no cuenta el cumplimiento; la columna Histórico sí (1/1), así que las dos cifras se contradicen.
Resultado esperado: imputar a la celda planificada pendiente más próxima (o permitir elegirla), igual que las casillas de simulacro/N°45.
Impacto: la N°83 sólo se cumple si el plan se aprueba justo en marzo; el programa subrepresenta planes y protocolos reales.
Causa probable: estas fuentes no tienen casilla ni plannedPeriod.
Solución recomendada: pasar plannedPeriod con la primera celda planificada no cumplida del año (o casillas como en simulacros).
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```text
ID: EMG-07
Severidad: 🟡 IMPORTANTE
Submódulo: Simulacros
Categoría: UI/UX · Evidencia
Título: El acta de un simulacro no se puede abrir desde ninguna pantalla
Archivo(s): app/(app)/prevencion/emergencias/[planId]/plan-detail.tsx; lib/services/pdtp/evidence-href.ts; lib/services/prevention-emergency.ts
Línea(s): plan-detail.tsx:322-365 (tabla sin evidencia); evidence-href.ts:36-40 (el directorio prevention-drill-evidence no tiene ruta de descarga declarada); prevention-emergency.ts:1217-1223 (sólo trae el conteo)
Pantalla/ruta: /prevencion/emergencias/[planId]; detalle de ejecución PDTP N°84
Endpoint: GET /api/prevencion/emergencias/simulacros/evidencia/[name] (existe, sin llamador)
Rol: todos
Descripción: la evidencia es obligatoria para cerrar y sostiene la N°84 auto-aprobada, pero el detalle del plan sólo muestra «N evidencias adjuntas» dentro del diálogo y el PDTP la pinta como chip sin enlace («source_module»).
Evidencia: DEMOSTRADO: tras completar D1, `a[href*='simulacros/evidencia']` = 0 en el detalle; GET directo con el nombre → 200 para prevfaena/cphs/jt, 404 otrafaena, 403 ti. CÓDIGO: evidence-href.ts:36-40.
Cómo reproducir: 1. Completar un simulacro con acta. 2. Buscar el acta en el plan o en /prevencion/pdtp/aprobaciones. 3. No hay enlace.
Resultado actual: evidencia que nadie puede revisar desde la plataforma (mismo defecto que PRV-21 tenía para higiene).
Resultado esperado: lista de archivos del simulacro con enlace, y la ruta registrada en MODULE_DOWNLOAD_ROUTES.
Impacto: un fiscalizador o revisor no puede ver el respaldo de la N°84.
Causa probable: PRV-21 se corrigió sólo para higiene, CGRD y Campañas.
Solución recomendada: agregar `storage/prevention-drill-evidence/` a MODULE_DOWNLOAD_ROUTES y listar la evidencia por simulacro en el detalle.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

### I. Readiness individual: **84/100**
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 21 | EMG-07 −2, EMG-10 −1, EMG-11 −0,5, EMG-27 −0,5 |
| UI/UX y facilidad de uso | 20 | 17 | EMG-18 −2, EMG-23 −0,5, EMG-26 −0,5 |
| Integridad de datos | 15 | 13,5 | EMG-10 −1, EMG-25 −0,5 |
| Integración con Programa Anual | 15 | 11,5 | EMG-06 −3, EMG-12 −0,5 |
| Código y mantenibilidad | 10 | 9 | EMG-13 −0,5, EMG-11 −0,5 |
| Permisos y seguridad | 5 | 4,5 | EMG-13 −0,5 |
| Testing | 5 | 3,5 | EMG-19 −1,5 |
| Manejo de errores | 5 | 4 | EMG-11 −0,5, EMG-23 −0,5 |
| **Total** | 100 | **84** | |

---

## AUDITORÍA — Higiene y vigilancia

**Rutas:** `/prevencion/higiene` (Grupos, Vigilancia, Programa y protocolos, Panel anonimizado), `/prevencion/higiene/grupos/[groupId]`, `/prevencion/higiene/programas/[programId]`.
**Archivos:** `app/(app)/prevencion/higiene/**`, `lib/services/prevention-hygiene.ts` (1208), `lib/validation/prevention-module/hygiene.ts`, `lib/services/pdtp-adapters/hygiene-accreditation-connector.ts` (291), `app/api/prevencion/higiene/evidence/{route,[name]/route}.ts`, `lib/services/prevention-evidence-upload.ts`.
**Permisos (`manifest.ts:1153-1180`):** `manage` global (prevencionista, jefa, admin); `assess` (prevencionista_faena, admin_contrato, prevencionista, jefa, admin); `measure` (prevencionista_faena, admin_contrato, prevencionista, admin); `view` además cphs y jefe_terreno.

### A. UI/UX/Diseño
- Estructura correcta (`PageHeader`, 4 KPI, pestañas, «Nuevo programa de vigilancia» en el header, 1 `h1`). Sin errores de consola.
- **Estados:** sin información (GES vacío: «Aún no hay grupos de exposición» **sin CTA**, A4 — EMG-16), con información (GES con mediciones), permisos insuficientes (`sup`, `legal`, `ti` → `/forbidden`), fuera de alcance (acciones de otra faena → «Registro de higiene no encontrado o fuera de alcance»), operación fallida con mensaje **genérico** «No se pudo completar la operación.» ante código de agente duplicado o informe reutilizado (EMG-14).
- El detalle del GES no enlaza el informe de laboratorio de cada medición (EMG-20): sólo se abre desde el detalle de la ejecución PDTP.
- **Responsive:** diálogo «Nueva medición» a 390 px usable (captura `B-prevfaena-hyg-measure-dialog-390.png`).

### Facilidad de uso
Registrar una medición con informe: **6** clics/campos (valor, método, equipo, archivo —sube al elegirlo—, registrar). Crear agente/GES/programa y matricular: por acción directa (no se contaron clics).

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Catálogo global de agentes (`manage`) | ✅ | prevfaena → «No tienes permisos»; prev → ok; duplicado → error genérico (EMG-14) |
| GES por faena, integrantes de la misma faena | ✅ | GES en otra faena y persona de otra faena rechazados |
| Medición contra límite, obligación de vigilancia | ✅ | 88 dB(A) > 85 → `above_limit`, `surveillance_required = true` |
| Informe obligatorio, ruta validada | ✅ | ruta inventada, traversal y ruta de otro dominio rechazadas |
| Fecha de medición | 🔴 | acepta `2026-12-15` (EMG-02) |
| Anular/corregir una medición | ❌ | no existe servicio ni acción (EMG-08) |
| Pronunciamiento MINSAL con versiones | 🟡 | versiona y revoca la versión inmediata anterior al retirar; acepta fecha futura (EMG-02) |
| Programa de vigilancia, matrícula desde GES, asistencia, reversión | ✅ | asistido → N°50; corregir a ausente → revoca |
| Descarga del informe con alcance (PRV-21) | 🟡 | prevfaena/cphs/jt 200, otrafaena 404, ti 403; sin enlace en el módulo |

### C. Código y lógica
`recordExposureMeasurement` lee el informe del disco y recalcula sha256 (bien), pero **no liga la subida a la faena** (`prevention-hygiene.ts:212-237`; no llama `claimPreventionEvidenceUpload`, a diferencia de CGRD/Campañas): `prevention_evidence_uploads.worksite_id` queda NULL. La reutilización entre faenas la impide sólo el índice único `prevention_hygiene_measurement_evidence_storage_path_unique`, con error genérico. El conector N°46–49 y N°50 no pasa `actorUserId` al motor (`hygiene-accreditation-connector.ts:213-225`, `:254-269`) aunque la N°45 sí (`:152`). Sin validación de fecha futura en `measuredOn`, `lastAssessedOn` ni `attendedOn` (`lib/validation/prevention-module/hygiene.ts:22,33`; `prevention-hygiene.ts:777`), y el motor de integración no tiene la guarda de PRV-03.

### D. Modelo de datos
Límite y nivel de acción congelados por medición; evidencia 1:N con estado; casillas N°45 con `FOR UPDATE`; matrículas con índice único (programa, persona, vencimiento) y renovación automática. Sin borrado ni anulación de mediciones: un valor erróneo fija `surveillance_required` para siempre (EMG-08).

### E. Permisos y seguridad
`manage` global vs `assess`/`measure` por faena funciona (DEMOSTRADO). Alcance en lectura, escritura y descarga correcto. La extensión del informe sale del MIME detectado (**M-21 corregido en higiene**: `D9SAyfEn-2WDkmTSA0F_.pdf`). `Content-Disposition: inline` para todo tipo servido (`[name]/route.ts:66`), mitigado porque sólo se sirven pdf/png/jpeg/octet-stream con `nosniff`.

### F. Testing
Unitarias `prevention-hygiene-calc`, `hygiene-accreditation-connector.test.ts`, `hygiene-dialogs.test.tsx` (PASS en el lote de 116); PGlite `prevention-hygiene-pdtp-accreditation` (PASS en el lote de 77); **`prevention-hygiene-postgres` 15/15 PASS**. E2E `prevencion-salud-ocupacional.spec.ts` (29 líneas): sólo carga del panel. Nada prueba fechas futuras ni el actor de N°46–50.

### G. Integración con Programa Anual (B)
- **N°45:** medición por UI con informe → casilla `m02-w2` cumplida y ejecución **auto-aprobada con evidencia verificada**… pero en **`pdtp-2026-v1` (cerrado)**, porque la celda planificada (febrero) cae en la ventana de la versión anterior (`pdtp-accredit-yFqhT3qWLjjT4qwp50UBQ`, `resolvedProgramId: pdtp-2026-v1`). En v2 la celda de febrero sigue «1 / -» (EMG-09). La segunda medición, fechada **2026-12-15**, quedó **aprobada automáticamente en diciembre semana 3** (`pdtp-accredit-87pKpErRNkxNbwdmr_2Eg`) — EMG-02.
- **Reutilización del mismo PDF en otra faena (PRV-21):** `otrafaena` registró una medición de Biodiversa con la ruta del informe de Horcones → rechazada (índice único; la transacción no dejó medición huérfana). El PDF **no** puede sostener la N°45 en dos faenas. Mensaje genérico (EMG-14).
- **N°46–49:** PREXOR «aplica» por `prev` → `submitted`, `executed_by = NULL`, en septiembre (sin plan; EMG-06). **`prev` aprobó su propio pronunciamiento** con motivo → `approved` (EMG-01). Reevaluar a «no aplica» (v3) creó una segunda ejecución en la misma celda; retirar (v4 pendiente) revocó sólo v3 → `draft`; v2 siguió aprobada (PRV-04 parcial, coherente con «cada versión respalda su período»). TMERT con `lastAssessedOn = 2026-12-20` → ejecución en diciembre (`submitted`; aprobarla es rechazado por la guarda de PRV-03 ✔).
- **N°50:** asistencia registrada por `prev` → `submitted` sin actor; **`prev` la aprobó él mismo** (EMG-01). Corregir a ausente → revocada (`draft`) ✔. Asistencia con fecha 2026-12-01 → ejecución en diciembre (aprobación bloqueada ✔).
- **N°44:** constancia manual (sin conector), como declara el mapa. Correcto: el módulo no registra evaluaciones cualitativas.

### H. Hallazgos

```text
ID: EMG-01
Severidad: 🟠 CRÍTICO
Submódulo: Higiene y vigilancia
Categoría: Integración / Permisos (segregación)
Título: Las ejecuciones N°46–49 (protocolos MINSAL) y N°50 (vigilancia) no guardan actor: quien hizo el pronunciamiento o registró el control aprueba su propio cumplimiento (PRV-02 sigue abierto aquí)
Archivo(s): lib/services/pdtp-adapters/hygiene-accreditation-connector.ts; lib/services/prevention-hygiene.ts; lib/services/pdtp/executions.ts
Línea(s): hygiene-accreditation-connector.ts:213-225 (safeAccredit sin actorUserId, aunque lo recibe en :190) y :233-269 (onSurveillanceControlAttended sin actor); prevention-hygiene.ts:870-878; executions.ts:579 (compara sólo executedByUserId)
Pantalla/ruta: /prevencion/higiene (Programa y protocolos, Vigilancia) → /prevencion/pdtp/aprobaciones
Endpoint: setProtocolApplicabilityAction, recordSurveillanceOutcomeAction → approvePdtpExecutionAction
Rol: prevencionista (tiene hygiene:assess y pdtp:approve); igual jefa y admin
Descripción: el fix de PRV-02 persiste el actor en el resto de conectores, pero estos dos llaman al motor sin actorUserId → executed_by_user_id NULL → la comparación de segregación no aplica. Sólo se exige un motivo.
Evidencia: DEMOSTRADO en B: prev pronunció PREXOR (ejecución pdtp-accredit-X9TtWuJOf85OLinLDZcZB, by:-) y la aprobó él mismo con motivo → approved, ap:qa-prev. prev registró la asistencia (pdtp-accredit-pyqtm4TQNi4SoOtIyydyq, by:-) y la aprobó → ok:true. Contraste: en la N°83 el mismo intento fue rechazado.
Cómo reproducir:
1. Como prevencionista, declarar PREXOR «aplica» en una faena (o marcar asistido un control).
2. En /prevencion/pdtp/aprobaciones, aprobar la ejecución con un motivo de 10+ caracteres.
3. Queda aprobada por la misma persona.
Resultado actual: autoaprobación de 5 actividades del programa.
Resultado esperado: «Quien registró el cumplimiento no puede aprobarlo».
Impacto: segregación rota justo en la vía que el fix declaraba cerrada; afecta N°46, 47, 48, 49 y 50.
Causa probable: el parámetro actorUserId se agregó a la firma pero no se reenvió; el conector de vigilancia no lo recibe.
Solución recomendada: pasar actorUserId: input.actorUserId en onProtocolApplicabilityAssessed y agregar el actor a onSurveillanceControlAttended (desde recordSurveillanceOutcome); prueba de regresión por conector.
Esfuerzo: Bajo
Bloquea producción: No (condición mínima)
Clasificación: A
```

```text
ID: EMG-02
Severidad: 🟡 IMPORTANTE
Submódulo: Higiene y vigilancia
Categoría: Integridad / Integración
Título: Mediciones, pronunciamientos y controles con fecha futura acreditan celdas futuras; la N°45 queda aprobada automáticamente
Archivo(s): lib/validation/prevention-module/hygiene.ts; lib/services/prevention-hygiene.ts; lib/services/pdtp/accreditation.ts
Línea(s): hygiene.ts:33 (measuredOn sin cota), :22 (lastAssessedOn); prevention-hygiene.ts:777 (attendedOn); accreditation.ts:567-660 (sin guarda de semana futura para integraciones)
Pantalla/ruta: /prevencion/higiene/grupos/[groupId] («Nueva medición», DatePicker sin máximo)
Endpoint: recordExposureMeasurementAction, setProtocolApplicabilityAction, recordSurveillanceOutcomeAction
Rol: prevencionista_faena, prevencionista
Descripción: PRV-03 se corrigió en el registro/aprobación manual, pero la vía de integración no valida el futuro. La N°45 con evidencia verificada se auto-aprueba y no pasa por la guarda de aprobación.
Evidencia: DEMOSTRADO en B: medición measuredOn=2026-12-15 → pdtp-accredit-87pKpErRNkxNbwdmr_2Eg approved m12w3 (planilla Horcones N°45: DIC «- / 1», Histórico «1 / 1»). TMERT lastAssessedOn=2026-12-20 y asistencia 2026-12-01 → ejecuciones en diciembre submitted; aprobarlas → «No se puede aprobar una ejecución de una semana que aún no ocurre» (guarda manual OK).
Cómo reproducir: 1. Registrar una medición con fecha de diciembre. 2. Ver la N°45 de la faena. 3. Diciembre aparece cumplido.
Resultado actual: cumplimiento de algo que no ocurrió; infla el histórico.
Resultado esperado: rechazar fechas posteriores a hoy (Chile) en el esquema y en accreditPdtpFromEvent.
Impacto: indicador inflado; el error de digitación no se puede corregir en origen (EMG-08).
Causa probable: la guarda isPdtpCellInFuture no se cableó en el motor de integración.
Solución recomendada: `refine(v <= todayInChile())` en las tres fechas y la guarda en accreditPdtpFromEvent.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A
```

```text
ID: EMG-08
Severidad: 🟡 IMPORTANTE
Submódulo: Higiene y vigilancia
Categoría: Funcionalidad / Integridad (CRUD con relaciones)
Título: Una medición no se puede anular ni corregir, aunque acredita la N°45 y fija la obligación de vigilancia
Archivo(s): lib/services/prevention-hygiene.ts; app/(app)/prevencion/higiene/actions.ts
Línea(s): prevention-hygiene.ts:414-540 (sólo alta); actions.ts:1-103 (sin acción de anulación)
Pantalla/ruta: /prevencion/higiene/grupos/[groupId]
Endpoint: —
Rol: measure
Descripción: no hay servicio de anulación/corrección de mediciones ni de evidencia. Una medición errónea (valor o fecha) queda cumpliendo la N°45 y mantiene surveillance_required = true; la única salida es la anulación PDTP (segunda persona), que no corrige el GES.
Evidencia: CÓDIGO (no existe función); DEMOSTRADO que la medición de prueba del 2026-12-15 quedó sin vía de corrección en la UI.
Cómo reproducir: registrar una medición con un valor mal digitado; buscar cómo anularla.
Resultado actual: dato erróneo permanente.
Resultado esperado: anular con motivo (estado + revocación de la N°45 con recordPdtpFulfillmentRevocation + recálculo de la obligación).
Impacto: integridad del registro de exposición y del cumplimiento.
Causa probable: el módulo se diseñó «cada insert es final».
Solución recomendada: `voidExposureMeasurement` con motivo, revocación y recálculo.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```text
ID: EMG-09
Severidad: 🟡 IMPORTANTE (transversal; confirmar con el agente del núcleo PDTP)
Submódulo: Higiene (N°45) — aplica a toda casilla con plannedPeriod anterior a una revisión del programa
Categoría: Integración con Programa Anual
Título: Una casilla planificada antes de la revisión v2 acredita en la versión v1 cerrada; el programa activo no ve el cumplimiento
Archivo(s): lib/services/prevention-hygiene.ts; lib/services/pdtp/version-window.ts; lib/services/pdtp/accreditation.ts
Línea(s): prevention-hygiene.ts:530 (plannedPeriod de la casilla); version-window.ts:240-252 (un programa `closed` por reemplazo acepta su ventana)
Pantalla/ruta: /prevencion/pdtp/actividades?faena=ws-horcones&vista=anual&page=2
Endpoint: recordExposureMeasurementAction
Rol: measure
Descripción: la medición de septiembre llenó la casilla de febrero; el motor resolvió la celda a la ventana de v1 (activa hasta el 17-09) y escribió allí la ejecución aprobada. En v2, febrero sigue «1 / -».
Evidencia: DEMOSTRADO: pdtp_fulfillment_events medicion:expms-6Xpz8… → resolvedProgramId pdtp-2026-v1, ejecución pdtp-accredit-yFqhT3qWLjjT4qwp50UBQ approved m2w2 (programa v1, estado closed). Planilla v2: FEB «1 / -».
Cómo reproducir: en un año con revisión a mitad de año, registrar hoy una medición cuya casilla abierta es de un mes anterior a la revisión.
Resultado actual: evidencia real en una versión que ya nadie consulta; la casilla del módulo dice «cumplida» y el programa vigente dice «pendiente».
Resultado esperado: o bien la versión vigente recoge ese cumplimiento (traspaso), o la casilla se imputa a una celda de la versión vigente.
Impacto: contradicción módulo ↔ programa en todo año con revisión; en B afecta todas las casillas de febrero/marzo (N°45, N°84 de marzo).
Causa probable: combinación de plannedPeriod con ventanas de versión.
Solución recomendada: decidir la regla en el núcleo (traspasar al activar la revisión o rechazar la imputación a una versión cerrada) y probarla.
Esfuerzo: Medio
Bloquea producción: No (sólo si producción revisa el programa a mitad de año)
Clasificación: B
```

### I. Readiness individual: **76/100**
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 21 | EMG-08 −3, EMG-20 −1 |
| UI/UX y facilidad de uso | 20 | 16,5 | EMG-16 −1,5, EMG-20 −1, EMG-14 −1 |
| Integridad de datos | 15 | 11 | EMG-02 −3, EMG-08 −1 |
| Integración con Programa Anual | 15 | 7 | EMG-01 −4, EMG-02 −1,5, EMG-06 −1,5, EMG-09 −1 |
| Código y mantenibilidad | 10 | 9 | subida no ligada a faena (C) −1 |
| Permisos y seguridad | 5 | 4,5 | inline para todo tipo −0,5 |
| Testing | 5 | 3,5 | EMG-19 −1,5 |
| Manejo de errores | 5 | 3,5 | EMG-14 −1,5 |
| **Total** | 100 | **76** | |

---

## AUDITORÍA — Permisos de trabajo (PTAR/LOTO)

**Rutas:** `/prevencion/permisos`, `/prevencion/permisos/[permitId]`, acuse público de cuadrilla (enlace con token).
**Archivos:** `app/(app)/prevencion/permisos/{page,work-permit-list,permit-dialogs,actions}.tsx|ts`, `[permitId]/permit-detail.tsx` (886), `lib/services/prevention-permits.ts` (988), `prevention-permits-export.ts`, `lib/prevention/permits.ts` (máquina de estados y `assessPermitActivation`), `lib/validation/prevention-module/permits.ts`, `app/api/prevencion/permisos/export/route.ts`.
**Permisos (`manifest.ts:1018-1060`):** `request` (jefe_terreno, admin_contrato, prevencionista_faena, prevencionista, admin); `verify` (jefe_terreno, prevencionista_faena, admin_contrato, prevencionista, admin); `approve` (prevencionista_faena, admin_contrato, prevencionista, jefa, admin); `activate` (prevencionista_faena, prevencionista, admin); `close`; `suspend` (incluye cphs); `export` (sólo prevencionista, jefa, admin); `manage` (catálogo). `supervisor_terreno` no tiene ningún permiso del submódulo.

### A. UI/UX/Diseño
- Estructura correcta, 4 KPI, filtros estado/faena, «Exportar Excel» y «Nuevo permiso» en el header, detalle con bloques AST/Controles/LOTO/Mediciones/Cuadrilla, bloqueadores de habilitación visibles, estados en español.
- Fricciones: fechas con `<input type="datetime-local">` nativo en alta, extensión y medición (A6; `permit-dialogs.tsx:252,255`, `permit-detail.tsx:568,861`); «Peligro MIPER de origen» pide pegar un **ID interno** (`permit-dialogs.tsx:246`); el supervisor viene preseleccionado con la primera persona alfabética habilitada (en B, un usuario real ajeno a la prueba); el control «no aplica» se muestra como texto gris sin alerta; el detalle no muestra quién aprobó ni quién habilitó (sólo solicitante y supervisor).
- Catálogo vacío (situación inicial en A, B y producción: sólo `seed-demo` crea tipos): los roles de faena no ven «Nuevo permiso» y el estado vacío no explica que falta el catálogo ni ofrece CTA (EMG-16).
- **Estados:** sin información (bandeja vacía), con información, permisos insuficientes (`sup`, `legal`, `ti`), fuera de alcance (`otrafaena` en P1 → 404; acciones → «no encontrado»), bloqueadores (habilitar sin controles/sin acuse), operación exitosa/fallida.
- **Responsive (uso en terreno):** detalle a 1024/768/390 px sin desborde de página; a 390 px las tablas LOTO y Mediciones requieren scroll horizontal interno y dejan fuera de vista el estado completo y el botón «Aplicar/Retirar» (EMG-17). El diálogo de alta es largo pero usable a 390 px.

### Facilidad de uso (UI real en B)
**Solicitar y habilitar un permiso LOTO completo: 52 clics/campos entre 2 personas** — crear con cuadrilla de 2 y 2 controles 12; AST 5; enviar a aprobación 3; aprobar (otra persona) 3; verificar 2 controles 7; aislamiento registrar + aplicar 10; medición 7; habilitar 3; más 2 navegaciones. Razonable para una tarea crítica; el AST, los controles y el LOTO no se pueden precargar desde el tipo.

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Catálogo de tipos | ✅ | `manage`; sin edición/desactivación desde la UI (🔵 menor) |
| Solicitud + AST + cuadrilla de la faena | ✅ | UI |
| Aprobación segregada del solicitante | ✅ | prevfaena solicita P2 y al aprobar: «Quien solicita el permiso no puede aprobarlo.»; jt sin permiso → «No tienes permisos» |
| Habilitación recalculada en servidor | ✅ | P2 sin controles/LOTO/medición/AST → bloqueado con lista; P3 sin acuse → «no ha acusado el AST» |
| Control obligatorio «no aplica» | 🔴 | «n/a» (3 caracteres) habilitó P1 (EMG-03) |
| Cierre sólo con LOTO retirado | 🟡 | cierre bloqueado ✔ y retiro con permiso vigente bloqueado ✔, pero suspendido → **cancelado** con candado aplicado ✔ se permite (EMG-04) |
| Aplicar aislamiento en permiso terminado | 🔴 | P2 cancelado → aplicar → ok (EMG-04) |
| Extensión | 🟡 | el solicitante con `approve` extiende su propio permiso (EMG-05) |
| Suspensión (incl. automática por vencimiento) | ✅ | manual probada; automática por PGlite/postgres |
| Acuse de cuadrilla (cuenta / enlace) | ✅ | bloqueador demostrado; enlace no probado |
| Exportación Excel | ✅ | prev y jefa 200, xlsx con 6 hojas (Permisos, AST JSA, Controles, LOTO, Mediciones, Cuadrilla); prevfaena/jt/otrafaena/ti 403 (EMG-21) |

### C. Código y lógica
Única puerta de estado (`transitionWorkPermit`), readiness recalculada al habilitar, CAS por `version` con `bumpPermitVersion` en toda mutación hija, avisos post-commit. Brechas: el chequeo de LOTO sólo corre para `closed` (`prevention-permits.ts:607-617`) aunque `suspended → cancelled` existe (`lib/prevention/permits.ts:68`); `applyPermitIsolation` no mira el estado del permiso (`prevention-permits.ts:385-407`) mientras `add` sí; `extendWorkPermit` no compara con `requestedByUserId` (`:645-676`); el motivo de «no aplica» sólo exige no vacío en servidor (`validation/.../permits.ts:80-84`) y la regla acepta N/A en obligatorios (`lib/prevention/permits.ts:185-191`).

### D. Modelo de datos
`prevention_work_permits` con CHECK de consistencia por estado, controles, aislamientos (aplicado/retirado con actor), mediciones con `within_range` persistido, cuadrilla con sello sha256 del acuse. Estado inconsistente demostrado: permisos `cancelled` con aislamientos `applied_at` no nulo y `removed_at` nulo (P1 y P2).

### E. Permisos y seguridad
Segregación de aprobación y alcance por faena: DEMOSTRADO. Hueco de segregación en extensión (EMG-05), contradice la descripción del propio permiso («Aprobar, rechazar o extender … de forma segregada del solicitante», `manifest.ts:226`). Export sólo para roles globales, con alcance del usuario.

### F. Testing
Unitarias `prevention-permits-calc`, `permit-dialogs.test.tsx` (PASS en el lote de 116); PGlite `prevention-permit-crew-ack-blocker`, `prevention-permit-workflow-gates-pglite` (PASS en el lote de 77); **`prevention-permits-postgres` 22/22 PASS**. E2E `prevencion-ptar-loto.spec.ts` (42 líneas): carga de bandeja y exportación; sin ciclo de vida, sin 390 px.

### G. Integración con Programa Anual
No acredita ninguna actividad. El programa 2026 v2 real (89 actividades, listado completo revisado en B) **no tiene ninguna actividad de permisos de trabajo, LOTO ni PTAR**; las más cercanas (N°43 procedimientos de trabajo seguro, N°39–41 observaciones e inspecciones) no se cumplen con un permiso. **No debería acreditar** mientras el programa no lo declare; coincide con el mapa («Brecha, sin actividad PDTP directa»). Relación indirecta: vínculo opcional al peligro MIPER (validado contra la MIPER vigente de la misma faena, pero se ingresa como ID crudo). Puntúo la calidad de esa relación: 13/15.

### H. Hallazgos

```text
ID: EMG-03
Severidad: 🟡 IMPORTANTE
Submódulo: Permisos de trabajo
Categoría: Reglas de negocio / Seguridad de proceso
Título: Un control obligatorio se da por cumplido declarándolo «no aplica» con 3 caracteres, por el mismo verificador y sin revisión; el permiso se habilita
Archivo(s): lib/prevention/permits.ts; lib/validation/prevention-module/permits.ts; app/(app)/prevencion/permisos/[permitId]/permit-detail.tsx
Línea(s): permits.ts:185-191; validation/permits.ts:80-84 (sólo no vacío); permit-detail.tsx:696 (minLength=3)
Pantalla/ruta: /prevencion/permisos/[permitId] → «Verificar» → «No aplica»
Endpoint: verifyPermitControlAction → transitionWorkPermitAction(active)
Rol: jefe_terreno / prevencionista_faena (verify)
Descripción: «Obligatorio» deja de serlo: cualquier verificador lo anula con un texto mínimo y el aprobador no vuelve a revisarlo antes de habilitar.
Evidencia: DEMOSTRADO en B: control «QA_EMG Extintor clase C en el lugar» (obligatorio) → «No aplica: n/a» (jt) → prevfaena «Habilitar» → estado active (permit-0LwLWl_h8ftEEa2r0jfuR).
Cómo reproducir: 1. Permiso aprobado con un control obligatorio. 2. Verificar → No aplica → «n/a». 3. Habilitar.
Resultado actual: habilitado sin verificar el control.
Resultado esperado: un obligatorio no admite N/A (o exige motivo ≥10–20 caracteres y confirmación del aprobador/activador, con alerta visible).
Impacto: debilita la compuerta central del PTAR en tareas críticas.
Causa probable: la regla «verificar o justificar» no distingue obligatorio de opcional.
Solución recomendada: prohibir N/A en obligatorios o requerir segunda persona; subir el mínimo en el esquema.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: EMG-04
Severidad: 🟡 IMPORTANTE
Submódulo: Permisos de trabajo
Categoría: Integridad / Seguridad de proceso (LOTO)
Título: Un permiso puede terminar (cancelado) con candados aplicados, y se puede aplicar un aislamiento en un permiso ya terminado
Archivo(s): lib/services/prevention-permits.ts; lib/prevention/permits.ts
Línea(s): prevention-permits.ts:607-617 (el chequeo de LOTO sólo para closed), :385-407 (applyPermitIsolation sin guarda de estado); permits.ts:68 (suspended → cancelled)
Pantalla/ruta: /prevencion/permisos/[permitId]
Endpoint: transitionWorkPermitAction(cancelled), applyPermitIsolationAction
Rol: jefe_terreno (suspend + request), prevencionista_faena
Descripción: «Cerrar» exige retirar los aislamientos, pero «Suspender → Cancelar» los deja aplicados; y aplicar un aislamiento pendiente sobre un permiso cancelado se acepta.
Evidencia: DEMOSTRADO en B: P1 activo con QA-LOCK-01 aplicado → cerrar rechazado («1 aislamiento(s) aplicados sin retirar») → suspender → cancelar → ok, LOTO vivos = 1. P2 cancelado → applyPermitIsolation → ok, LOTO vivos = 1 (mientras verificar un control del mismo permiso sí se rechaza).
Cómo reproducir: 1. Habilitar con LOTO aplicado. 2. Suspender. 3. Cancelar.
Resultado actual: permiso terminal con energía bloqueada sin registro de liberación.
Resultado esperado: exigir aislamientos retirados para cualquier estado terminal (closed/cancelled) y rechazar aplicar en permisos terminados.
Impacto: el registro LOTO deja de decir si el equipo fue devuelto a servicio.
Causa probable: la guarda se escribió para el cierre y no se generalizó.
Solución recomendada: mover el chequeo a toda transición a estado sin salida y agregar la guarda de estado en applyPermitIsolation.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```text
ID: EMG-05
Severidad: 🟡 IMPORTANTE
Submódulo: Permisos de trabajo
Categoría: Permisos (segregación)
Título: El solicitante que tiene permiso de aprobar puede extender su propio permiso
Archivo(s): lib/services/prevention-permits.ts; modules/prevention/manifest.ts
Línea(s): prevention-permits.ts:645-676; manifest.ts:226 (descripción del permiso: extender de forma segregada)
Pantalla/ruta: /prevencion/permisos/[permitId] → «Extender»
Endpoint: extendWorkPermitAction
Rol: prevencionista_faena, prevencionista, admin_contrato
Descripción: extender cambia la ventana autorizada (una re-aprobación) pero no se compara con requestedByUserId.
Evidencia: DEMOSTRADO en B: prevfaena solicitó P2, no pudo aprobarlo, prev lo aprobó y prevfaena lo extendió +8 h → ok:true.
Cómo reproducir: 1. Solicitar como prevencionista_faena. 2. Que otro apruebe. 3. Extender como el solicitante.
Resultado actual: la ventana se amplía sin segunda persona.
Resultado esperado: misma regla que la aprobación.
Impacto: la segregación se puede sortear pidiendo una ventana corta y extendiéndola.
Causa probable: la guarda se copió sólo en `approved`.
Solución recomendada: `if (permit.requestedByUserId === access.userId) throw …` en extendWorkPermit + prueba.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

### I. Readiness individual: **79/100**
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 19 | EMG-03 −2, EMG-04 −2, EMG-05 −2 |
| UI/UX y facilidad de uso | 20 | 14 | EMG-15 −3, EMG-16 −1, EMG-17 −1, sin trazas de aprobador/activador en el detalle −1 |
| Integridad de datos | 15 | 12 | EMG-04 −3 |
| Integración con Programa Anual | 15 | 13 | no debe acreditar; relación indirecta por MIPER con ID crudo (EMG-15) −2 |
| Código y mantenibilidad | 10 | 9 | guardas no generalizadas (EMG-04) −1 |
| Permisos y seguridad | 5 | 4 | EMG-05 −1 |
| Testing | 5 | 3,5 | EMG-19 −1,5 |
| Manejo de errores | 5 | 4,5 | —0,5 mensaje de transición «Transición de permiso inválida: suspended → …» con estados crudos |
| **Total** | 100 | **79** | |

---

## Mejoras (🔵) y cosméticos (⚪)

| ID | Sev. | Submódulo | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|---|---|
| EMG-10 | 🔵 | Simulacros | Anular un simulacro «requiere mejora» deja su CAPA abierta y la evidencia activa | prevention-emergency.ts:1026-1083 | DEMOSTRADO: capa-ZWfYm4MWozsEyvmqjik_F `pending` tras anular D3 | Cerrar/cancelar la CAPA derivada con el mismo motivo | B |
| EMG-11 | 🔵 | Simulacros | El cierre exige filas de evidencia, no archivos existentes | prevention-emergency.ts:900-912 | DEMOSTRADO: D2 cerrado con su único archivo borrado (la N°84 quedó `submitted` ✔) | Verificar existencia/sha256 antes de cerrar | B |
| EMG-12 | 🔵 | Plan | Archivar no revoca la N°83 (decisión) y el diálogo no lo dice ni orienta a la anulación PDTP si fue un error | plan-detail.tsx:664-698 | DEMOSTRADO: N°83 `approved` tras archivar | Texto en el diálogo + motivo tipificado (reemplazo/error) | B |
| EMG-13 | 🔵 | Simulacros | Extensión del archivo tomada del nombre del cliente; nombre con `../` persistido (M-21 en este dominio) | prevention-emergency.ts:706; prevention-documents/utils.ts:230-234 | DEMOSTRADO: PNG guardado como `…AnXTWyj60_zcDLDRUcMq.html`, `file_name = ../../../evil.html` | Extensión según MIME detectado y saneo del nombre | B |
| EMG-14 | 🔵 | Higiene | Violaciones de unicidad devuelven «No se pudo completar la operación.» | higiene/actions.ts:29-42 | DEMOSTRADO: agente duplicado; informe reutilizado | Traducir 23505 a mensaje de dominio | B |
| EMG-15 | 🔵 | Permisos | `datetime-local` nativo (A6); ID MIPER crudo; supervisor preseleccionado | permit-dialogs.tsx:246,252,255; permit-detail.tsx:568,861 | DEMOSTRADO (capturas) | DateTimePicker, selector de peligros, sin preselección | M |
| EMG-16 | 🔵 | Permisos · Higiene | Estados vacíos sin CTA; con catálogo vacío los roles de faena no ven «Nuevo permiso» ni por qué | permit-dialogs.tsx:350; work-permit-list.tsx:168 | DEMOSTRADO (capturas prevfaena) | EmptyState con acción y aviso «falta el catálogo de tipos» | B |
| EMG-17 | 🔵 | Permisos | A 390 px las tablas LOTO/Mediciones esconden estado y acción tras scroll interno | permit-detail.tsx (tablas) | DEMOSTRADO (`crop-permit390-*.png`) | Tarjetas en móvil | M |
| EMG-18 | 🔵 | Simulacros | Tabla de simulacros sin fecha real, motivo ni evidencia; anulado = «Cancelado» con resultado | plan-detail.tsx:322-365 | DEMOSTRADO (`crop-drills-after-annul.png`) | Columna/fila expandible con detalle y estado «Anulado» | B |
| EMG-19 | 🔵 | Los tres | E2E sólo de humo; ningún flujo crítico con navegador | e2e/prevencion-{emergencias-simulacros,ptar-loto,salud-ocupacional}.spec.ts | CÓDIGO | E2E: aprobar plan, completar/anular simulacro, medición, ciclo PTAR | M |
| EMG-20 | 🔵 | Higiene | El GES no enlaza el informe de cada medición (PRV-21 parcial) | grupos/[groupId]/group-detail.tsx; prevention-hygiene.ts:973-1005 | DEMOSTRADO: 0 enlaces | Columna «Informe» con la ruta GET | B |
| EMG-21 | 🔵 | Permisos | Exportar sólo para roles globales; prevencionista_faena no exporta sus propios permisos | manifest.ts:1043,1051,1060 | DEMOSTRADO: prevfaena/jt 403 | Decidir; el servicio ya aplica alcance | B |
| EMG-22 | 🔵 | Plan / núcleo | N°83 de los planes aprobados antes de la revisión v2 quedaron en v1 `submitted` y no se trasladaron | pdtp_executions (v1) | SQL: 6 N°83 en v1, 0 en v2 salvo la de la prueba | Decidir traspaso (agente del núcleo PDTP) | M |
| EMG-23 | ⚪ | Plan | «Nuevo plan» con todas las faenas cubiertas; error al enviar | emergencias/page.tsx:60 | DEMOSTRADO (captura admin) | Filtrar faenas con plan vigente | B |
| EMG-24 | ⚪ | Núcleo (vista) | Chip «N ejecuciones con evidencia» para rótulos de texto (N°83, N°46, N°50 con `not_required`) | planilla PDTP | DEMOSTRADO (capturas de fila) | Contar sólo `provided` | B |
| EMG-25 | ⚪ | Simulacros | Al anular, la casilla vuelve a pendiente sin subir `version` | prevention-emergency.ts:1058-1064 | SQL: `m09-w3 pending v2` | `version + 1` | B |
| EMG-26 | ⚪ | Simulacros | Botones «No hecha/No aplica» de casillas visibles en un plan archivado | plan-detail.tsx:308-315 | DEMOSTRADO (`emg-plan2b.out` 8c) | Ocultar en archivados | B |
| EMG-27 | ⚪ | Simulacros | Se puede completar un simulacro de un plan archivado | prevention-emergency.ts:874-882 | CÓDIGO (TEÓRICO) | Decidir y validar | B |

## Estado de hallazgos previos en este alcance

| Hallazgo | Dictamen | Evidencia propia |
|---|---|---|
| PRV-01 (emergencia, higiene) | **Corregido (verificado)** | Simulacro con archivo borrado → `submitted` + `file_missing`; no existe campo URL; higiene: ruta inventada, traversal y otro dominio rechazados; N°45/N°84 con archivo real → `provided` + sha256 |
| PRV-02 (N°83, 84, 45–50) | **Parcial** | N°83 guarda actor (autoaprobación rechazada) y N°45/N°84 lo guardan; **N°46–49 y N°50 no** → autoaprobación demostrada (EMG-01) |
| PRV-03 (vía integración) | **Sigue abierto / regresión por otra vía** | aprobar semana futura: bloqueado ✔; pero la N°45 fechada en diciembre se **auto-aprueba** (EMG-02) |
| PRV-04 (plan archivado; pronunciamiento) | **Parcial** | Retirar un pronunciamiento revoca la versión inmediata anterior ✔; archivar el plan no revoca la N°83 (decisión declarada, sin aviso en UI — EMG-12) |
| PRV-19 #8 (anular simulacro completado) | **Corregido (verificado)** | N°84 → `draft`, casilla → `pending`, evento `revoked`; deja la CAPA abierta (EMG-10) |
| PRV-19 #16 (cantidad N°83) | **Corregido (verificado)** | plan con 2 escenarios → cantidad 1,00 |
| PRV-21 (descarga y reutilización del informe) | **Parcial** | Descarga con alcance ✔ (otrafaena 404, ti 403) y enlazada desde el PDTP (CÓDIGO: evidence-href.ts:36); mismo PDF en otra faena rechazado (índice único) ✔; sin enlace en el módulo (EMG-20) y la subida no queda ligada a la faena |
| M-21 (extensión por MIME) | **Corregido en higiene · abierto en simulacros** | higiene guarda `.pdf` por MIME; simulacros usan el nombre del cliente (EMG-13) |

## Qué no se pudo verificar y por qué

- **Acuse de cuadrilla por enlace público** y **suspensión automática por vencimiento**: no recorridos (cubiertos por PGlite/postgres, que pasaron).
- **Recursos/inventario de emergencia** (vínculo al plan, importación de extintores): sólo lectura de código y pruebas; sin recorrido.
- **Casillas «No hecha/No aplica»** de simulacros y N°45 en navegador: no ejercidas (sí por PGlite/postgres).
- **Clics** de crear agente/GES/programa de vigilancia y de pronunciarse sobre un protocolo: se ejecutaron por acción directa, no por UI.
- **Estado «Cargando»**: no observado.
- **Entorno A**: sin registros de estos submódulos; sólo se usó B (más un vistazo de rutas en A omitido por el corte de API).
- **Compliance numérico** (% del tablero) tras mis ejecuciones: leído en la planilla, no en el tablero.
- **WebKit**: no probado.

Archivos temporales: no creé ningún `*.audit-tmp.test.ts`. `git status --porcelain` muestra `lib/__tests__/documental-integration.audit-tmp.test.ts` e `inspecciones-compliance.audit-tmp.test.ts` (de otros agentes) y `.claude/settings.local.json` modificado (no lo toqué), además de los `.audit-*` del orquestador.
