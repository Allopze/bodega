# Auditoría de production readiness — Inspecciones y EPP preventivo (agente `inspecciones`, prefijo INS-)

Fecha: 2026-09-29 · HEAD `11e67621` · Entorno principal: **B** (`:3101`, `bodega_audit_real_e2e`, programa 2026 v2 real). Entorno A no se usó.
Evidencia (scripts, capturas, salidas): `scratchpad/audit/inspecciones/` (capturas en `shots/`, registro de server actions en `actions-log.jsonl`, sonda de cumplimiento en `probe-compliance.txt` + copia de `inspecciones-compliance.audit-tmp.test.ts`, salidas de pruebas `tests-*.out`).

Datos creados (rotulados `QA_INS`): programa `insprog-2ndpuSesTdACNEF6edikE` (extintores, Horcones); runs `insrun-2YjsM6BNV9SNNbL1n5oRi` (F1, N°24, revisada), `insrun-v3X8j3l8KIdQ75ijjEH9p` (F2, N°64, cancelada), `insrun-xYiGw8X9fXy1iA82nnZa2` (F3, N°10, completada), `insrun-gRQBZEUQdC9tAuNnhc7Qc` (F4, reporte de equipos N°25/26, revisada); CAPA `CAPA-2026-KHI1WJPQZV`; entrega `ENT-2026-0059` (anulada); requisito EPP `peppr-8YmfN5UXtH5yheYmYPxTS` (desactivado). Dos plantillas de prueba se crearon y se retiraron (borradas). Nota: otro agente (`QA_INT_*`) insertó por SQL un documento PDF y una evidencia en mi run F1; no los toqué.

---

## AUDITORÍA — Inspecciones

**Rutas:** `/prevencion/inspecciones` (bandeja), `/[runId]` (ejecución), `/seguimiento`, `/plantillas`, `/programacion`. APIs: `evidence` (+`[name]`), `finding-evidence`, `documento` (+`[name]`), `export`, `seguimiento/export`.
**Archivos principales:** `app/(app)/prevencion/inspecciones/actions.ts`, `inspection-run-list.tsx`, `inspection-catalog.tsx` (1.690 líneas), `[runId]/inspection-run-detail.tsx` (1.195), `lib/services/prevention-inspections/{runs,transitions,templates,evidence,queries,programs}.ts`, `lib/prevention/inspections.ts`, `lib/prevention/inspection-wiring.ts`, `lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts:89-230`.
**Permisos (manifiesto `modules/prevention/manifest.ts:1063-1121`):** view/execute: jefe_terreno, supervisor_terreno, admin_contrato, prevencionista_faena, prevencionista; review: prevencionista_faena, prevencionista, jefa_chome; manage: prevencionista(_faena), admin_contrato; approve: prevencionista, administrador; ingest: jefe_terreno, admin_contrato; export: prevencionista, jefa_chome. `cphs`/`jefe_mantencion` sólo view. `tecnico_ti` nada.

### A. UI/UX/Diseño
- Estructura conforme a AGENTS.md: `PageHeader` (1 `h1` visible en todas las pantallas), `PageContainer`, búsqueda propia (ruta en `ROUTES_WITH_OWN_SEARCH`), 4 KPI accionables, 4 filtros + "Más filtros", acciones en el header, `DatePicker`, estados con label + `Badge`. Sin desborde horizontal de página a 1440/1024/768/390 en bandeja, plantillas, programación y ficha (medido con `scrollWidth`).
- **Ejecución en terreno a 390 px (crítico):** usable. Tarjetas por ítem, barra fija inferior "Guardar / Declarar ejecutada", aviso que nombra cada ítem pendiente con enlace, foto por ítem (subida 201 verificada), diálogo de CAPA legible. Defectos: todos los ítems puntuables muestran **"Opcional"** aunque el aviso los exige (INS-06); la tabla de hallazgos a 390 es una tabla con scroll lateral; sin atajo "todo conforme" (49 toques para una inspección de EPP de 10 filas, INS-20).
- **Plantillas a 1440:** la columna de acciones (Aprobar, Retirar, Acreditación PDTP) queda fuera de vista (tabla 1.278 px en contenedor de 1.126 px; botones en x≈1.430) y la columna "Acredita PDTP" pinta la descripción completa de la actividad en monoespaciada, filas de 150–200 px (INS-15).
- **Selector de plantilla** ofrece "Inspección de Uso y Estado de EPP · 02", que no acredita nada, junto a JT/PRF (INS-05); no indica qué plantilla acredita qué N°.
- **Reporte de equipos:** el texto "Prevención revisa y cierra después; no corresponde que quien transcribe se auto-revise" contradice lo que hace el sistema (INS-10). La vista previa mostró **"Resultado normalizado 263.16 %"** (INS-01).
- PDF de planilla: `<object>` bloqueado por CSP `object-src 'none'` (error de consola demostrado); se ve el fallback "Este navegador no puede mostrar el PDF" (INS-16).
- Bandeja: a quien ejecutó se le ofrece el CTA "Revisar" que no puede usar; el estado vacío le dice al supervisor que habilite plantillas y programe (no tiene permiso) (INS-17).
- **Estados observados:** Sin información (bandeja/programación/seguimiento vacíos con CTA), Con información, Operación exitosa (crear, guardar, cerrar, revisar, reabrir, cancelar), Operación fallida (servidor: "No se pudo completar la operación."; guardas de negocio con mensaje claro), Permisos insuficientes (`ti` → `/forbidden`; `otrafaena` → "No encontramos este registro"), Sin resultados (filtros). No observados: Cargando (skeleton existe en `loading.tsx`, no capturado), Error de página.

### Facilidad de uso (tareas y clics)
| Tarea | Rol | Clics/toques | Observación |
|---|---|---|---|
| Programar inspección (plantilla, faena, asignado, sujeto) | prevfaena | 9 + 1 "Crear y abrir" | Claro; la lista de asignables incluye personas sin alcance en la faena (INS-14) |
| Ejecutar extintores (5 ítems, 1 "Malo" con comentario, acta 2 firmas) y declarar | sup, 390 px | 19 | Fluido; "Opcional" engañoso |
| Ejecutar EPP JT (20 ítems + foto + acta) | jt, 390 px | 49 | Sin "marcar todo" |
| Derivar hallazgo a CAPA | sup, 390 px | 6 | Plazo por gravedad visible |
| Revisar y cerrar (otra persona) | prevfaena | 4 | Bloqueo por CAPA explicado |
| Crear inspección ad hoc | jt | 6 | Al elegir faena se asigna sola al prevencionista de la faena, no a quien la crea |

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Crear inspección / programar / "Crear y abrir" | ✅ | F1–F4 creadas por UI (sup, jt, prevfaena) |
| Guardar respuestas, autoguardado, CAS de versión | ✅ | captura de server actions; versión avanza |
| Declarar ejecutada (extintores, EPP, condiciones ambientales) | ✅ | DB `completed`, % correcto |
| Declarar ejecutada **reporte de equipos** | 🔴 | falla con CHECK (INS-01); sólo cierra si se dejan vacías las secciones condicionales |
| Cálculo de cumplimiento | 🔴 | 263 %, 105 %, 89 % en vez de 84 % (INS-01) |
| Hallazgo derivado → CAPA (+mantención si hay equipo) | ✅ | CAPA creada, responsable, plazo 7 días |
| Revisión independiente | ✅ | UI oculta el botón y el servidor responde "Quien ejecutó la inspección no puede revisarla" |
| Reabrir / cancelar con motivo | ✅ | DB + revocación PDTP |
| Reabrir + re-cerrar | 🟡 | duplica hallazgos (INS-03) |
| Cierre manual de hallazgo | 🟡 | permite cerrar un Alto sin CAPA y revisar (INS-04) |
| Evidencia por ítem / por hallazgo / planilla | 🟡 | subida OK; no se puede quitar una foto (INS-12); ruta escribe archivo antes de autorizar (INS-13) |
| Plantillas: incorporar, aprobar, retirar, acreditación PDTP | 🟡 | funcionan; sin segregación y cableado global por roles de faena (INS-08, INS-09) |
| Exportar Excel (bandeja, seguimiento) | ✅ | `jefa` 200, xlsx de 7 y 2 hojas con los runs QA; sin permiso 403 |
| Imprimir "Acta PDF" | ❓ | no verificado (Cloudreve no configurado en B) |
| Modo offline (cola de cierre) | ❓ | sólo lectura de código (INS-07) |
| Digitalización (`ingest`, detector de marcas en modo sombra) | ❓ | no ejecutado con planilla real |

### C. Código y lógica
- Lógica crítica en el servidor (guardas en `requireAccess`, `assertInspectionRunTransition`, CAS doble), bien comentada.
- Defecto de cálculo en `summarizeCompliance` (`lib/prevention/inspections.ts:445` suma `conforming` antes del filtro `:458`) (INS-01).
- `completeInspectionRun` recrea hallazgos derivados sin mirar si ya existe uno con CAPA para el mismo ítem (`runs.ts:527-544`) (INS-03).
- Código muerto: `deleteRunDocument` y `deleteAnswerEvidence` (`evidence.ts:95-109, 199-216`) sin acción ni UI; el mensaje de `runs.ts:274-276` manda a "quitar las fotografías primero", algo que no se puede hacer (INS-12).
- Comentario contradictorio: `templates.ts:436` "Sigue exigiendo un aprobador distinto del autor" vs `:463-469` "Sin segregación en plantillas".
- `catch {}` sin log en `app/api/prevencion/inspecciones/seguimiento/export/route.ts:23` (INS-18).
- Componentes de 1.200–1.700 líneas (`inspection-catalog.tsx`, `inspection-run-detail.tsx`).

### D. Modelo de datos
- CHECK en `prevention_inspection_runs` (bps 0–10000, cancelación, revisión, estado, sujeto único): la base impide guardar el % inflado, pero lo convierte en un error genérico.
- Hallazgos con CAPA sobreviven a reabrir (bien); los derivados se duplican (INS-03).
- KPI "Con hallazgos abiertos/graves" (`queries.ts:68-69`) cuentan `capa_linked` y runs **cancelados**: la bandeja de prevfaena mostró 2 y 2 (F1 revisada con CAPA y F2 cancelada) (INS-11).
- Retirar plantilla: borra si no tiene uso, si no `superseded` (evidencia protegida con FK restrict).

### E. Permisos y seguridad (DEMOSTRADO por replay de server actions y HTTP)
- `otrafaena` sobre runs de Horcones: revisar, reabrir, cancelar, guardar → "Inspección no encontrada o fuera de alcance"; página → "No encontramos este registro"; evidencia y documento → 404; `ti` → 403 en todo; `sup`/`jt`/`cphs` sin permiso → "No tienes permisos". Path traversal en evidencia → 400.
- Hallazgos: cableado PDTP global editable por roles con alcance de faena (INS-08); aprobación de plantillas sin segregación y paridad autodeclarable al importar (INS-09); escritura de archivos antes de autorizar (INS-13, `otrafaena` 94→95 archivos); asignación sin validar alcance del asignado (INS-14).

### F. Testing
- Ejecutadas: 22 archivos unitarios/UI (221 pruebas ✅), 7 PGlite (59 ✅), `prevention-inspections-postgres` (91 ✅, no skipped, base propia creada y borrada).
- E2E existentes (leídos, no corridos): ejecución, cierre, catálogo, concurrencia, offline, reportes, roles, flujo integral. El flujo integral declara explícitamente que no prueba la acreditación PDTP.
- Brechas: ninguna prueba responde las secciones condicionales del reporte de equipos (la de `reporte-equipos-definition.test.ts:80-86` sólo responde lo obligatorio, por eso INS-01 pasa verde); no hay prueba de reabrir→re-cerrar con hallazgo CAPA (INS-03); no hay prueba de cierre manual de un hallazgo alto.

### G. Integración con el Programa Anual (ejecutado en B, programa 2026 v2)
Cableado real (SQL, `pdtp_accreditation_bindings`): 13 plantillas vigentes → N°10, 24, 25+26, 27, 29, 33, 34, 39, 40, 41, 64, 65. N°28 queda como constancia. Coincide con el mapa declarado.

| Caso | Resultado observado |
|---|---|
| F1 extintores (sup) → N°24 | `pdtp_executions` N°24, Horcones, 2026-09 sem 4, `approved`, `executed_by = approved_by = qa-sup`, `approvalMode automatic_source_event`, `evidence_status not_required`, texto "Inspección completada: insrun-…". Vista anual: Sep "1 / 1". La celda planificada era la sem 2; la ejecución cae en sem 4 (cuenta por mes) |
| Revisión independiente (prevfaena) | run `reviewed`; la ejecución PDTP no cambia (ya estaba aprobada desde el cierre) (INS-02) |
| Reabrir F1 | ejecución → `draft`, `revokedBy qa-prev-faena`, motivo trazado ✅ |
| Re-cerrar F1 | vuelve a `approved` (misma fila/celda) ✅, pero hallazgo duplicado (INS-03) |
| Reescribir F1 cerrada (PRV-19 #13) | replay de `saveInspectionAnswers` → "No se pueden modificar respuestas de una inspección completada…"; re-envío de `complete` con respuestas cambiadas → eco idempotente, DB sin cambios ✅ |
| F2 EPP JT (jt) → N°64 | `approved` por qa-jt; **cancelar** (prevfaena) → `draft` con motivo ✅; el hallazgo alto queda abierto en un run cancelado (INS-11) |
| F3 condiciones ambientales (prevfaena) → N°10 | `approved` por qa-prev-faena; no puede revisarla ✅ |
| F4 reporte de equipos (jt) → N°25+26 | con todo el papel transcrito: **no cierra** (INS-01). Sin secciones condicionales: `reviewed` automático por jt, N°25 y N°26 `approved` por qa-jt en el mismo acto |
| Fecha imputada | la del cierre en servidor (`runs.ts:574`), no la del trabajo en terreno; `queuedAt` offline se descarta (INS-07) |

### H. Hallazgos

```
ID: INS-01
Severidad: 🔴 BLOQUEADOR
Submódulo: Inspecciones
Categoría: Funcionalidad / Integridad / Integración PDTP
Título: El % de cumplimiento suma conformes de secciones que no puntúan: el Reporte de Uso Diario de Equipos no se puede cerrar y otros % salen inflados
Archivo(s): lib/prevention/inspections.ts; lib/services/prevention-inspections/runs.ts
Línea(s): inspections.ts:445 (cuenta conforming de toda respuesta) vs :458 (sólo `scored` filtra countsForCompliance); runs.ts:585-591 (escribe el %); CHECK prevention_inspection_run_normalized_bps_valid
Pantalla/ruta: /prevencion/inspecciones/insrun-gRQBZEUQdC9tAuNnhc7Qc
Endpoint: completeInspectionRunAction
Rol: jefe_terreno (transcribe el reporte), cualquiera que ejecute
Descripción: el numerador cuenta los "Cumple" de secciones con countsForCompliance=false (estado acoplado, exclusivo camión, exclusivo carga); el denominador no. Con el papel completo el % supera 100 y el UPDATE viola el CHECK 0–10000.
Evidencia: DEMOSTRADO. (1) Navegador: la ficha mostró "Resultado normalizado 263.16%" y "Declarar ejecutada" respondió "No se pudo completar la operación."; log del servidor: UPDATE con compliance_percent=263, normalized_bps=26316. (2) HTTP: mismo cierre con sólo la sección "exclusivo camión" → mismo error; sin secciones condicionales → cierra. (3) Sonda vitest sobre las definiciones reales (probe-compliance.txt): reporte_equipos 263 %, camión simple 105 %, camión con 3 fallas 89 % (esperado 84 %), observación ampliroll/maquinaria 105 %.
Cómo reproducir:
1. Como jt, crear "Reporte de Uso Diario de Equipos · 02" en Horcones.
2. Responder todos los ítems "Cumple" (incluida la sección del camión) y el acta.
3. Declarar ejecutada.
Resultado actual: error genérico; la inspección queda en ejecución; N°25/N°26 no se acreditan. Con fallas, el % publicado es mayor que el real.
Resultado esperado: el numerador usa sólo ítems que puntúan; el reporte cierra con 100 %.
Impacto: la actividad de mayor volumen (N°25 y N°26, 48/año por faena cada una) no se puede acreditar por el camino normal; indicadores de cumplimiento inflados en exportación y acta.
Causa probable: contadores de conformes compartidos entre el resumen del acta y el cálculo del %.
Solución recomendada: contar conforming/partial para el % sólo tras el filtro `countsForCompliance` (mantener los contadores del acta aparte); prueba de regresión que responda las secciones condicionales; mensaje claro si igual se viola el CHECK.
Esfuerzo: Bajo
Bloquea producción: Sí
Clasificación: A
```

```
ID: INS-02
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: Integración PDTP / Segregación
Título: La ejecución PDTP queda aprobada por quien ejecutó, al declarar, antes de la revisión independiente
Archivo(s): lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts; lib/services/prevention-inspections/runs.ts
Línea(s): connectors 128-129 (autoApproveByUserId = completedByUserId); runs.ts:668-675; runs.ts:568-584 (reporte auto-revisado por el transcriptor)
Pantalla/ruta: /prevencion/pdtp/actividades
Endpoint: completeInspectionRunAction
Rol: ejecutores (sup, jt, prevfaena)
Descripción: el módulo exige que otra persona revise la inspección, pero el cumplimiento del programa ya cuenta desde el cierre y lo "aprueba" el mismo ejecutor. Una inspección que nunca se revisa sigue sumando. En el reporte de equipos la N°26 ("revisión y firma", Sup/JT) la acredita el mismo acto de transcribir.
Evidencia: DEMOSTRADO (SQL): F1 N°24 executed_by = approved_by = qa-sup antes de la revisión; F4 N°25 y N°26 approved por qa-jt con review_comment automático.
Cómo reproducir: 1. Ejecutar y declarar una inspección enganchada. 2. Consultar pdtp_executions por source_id. 3. No revisar la inspección: la celda sigue cumplida.
Resultado actual: aprobado por el ejecutor en el mismo instante.
Resultado esperado: que la acreditación quede `submitted` hasta la revisión (o se apruebe con el revisor), o documentar la decisión y mostrar en el PDTP que falta revisión.
Impacto: el PDTP puede afirmar cumplimiento de inspecciones que nadie revisó.
Causa probable: decisión de diseño (autoaprobación "incondicional" de inspecciones).
Solución recomendada: acreditar como submitted al cerrar y aprobar al revisar (el conector ya tiene el camino `review`); mantener la excepción D04 explícita para el reporte.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: INS-03
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: Integridad de datos
Título: Reabrir y volver a cerrar duplica los hallazgos que ya tenían CAPA
Archivo(s): lib/services/prevention-inspections/runs.ts; transitions.ts
Línea(s): runs.ts:527-544; transitions.ts:108-112
Pantalla/ruta: /prevencion/inspecciones/insrun-2YjsM6BNV9SNNbL1n5oRi
Endpoint: reopenInspectionRunAction + completeInspectionRunAction
Rol: prevfaena (reabre), sup (re-cierra)
Descripción: se conservan los hallazgos con CAPA y se derivan de nuevo todos los "no cumple", incluido el mismo ítem.
Evidencia: DEMOSTRADO: tras reabrir y re-cerrar F1 hay dos hallazgos "Manómetro…" Alta: uno capa_linked y otro open sin CAPA; la revisión quedó bloqueada otra vez.
Cómo reproducir: 1. Cerrar con un "Malo" alto y derivar CAPA. 2. Revisar. 3. Reabrir y declarar ejecutada otra vez.
Resultado actual: hallazgo duplicado que exige una segunda CAPA o un cierre manual.
Resultado esperado: no re-derivar ítems que ya tienen hallazgo con CAPA.
Impacto: CAPA duplicadas, métricas de hallazgos infladas, fricción que empuja al cierre manual (INS-04).
Causa probable: el filtro de borrado protege el hallazgo, pero la inserción no lo considera.
Solución recomendada: excluir de `derived` los (sectionId,itemId) con hallazgo vigente; prueba.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INS-04
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: Reglas de negocio
Título: Un hallazgo alto o crítico se puede cerrar a mano sin CAPA y así revisar la inspección
Archivo(s): lib/services/prevention-inspections/runs.ts; app/(app)/prevencion/inspecciones/[runId]/inspection-run-detail.tsx
Línea(s): runs.ts:952-968 (sin restricción de criticidad); detail.tsx:654-663 (botón "Cerrar" para todo abierto sin CAPA); lib/prevention/inspections.ts:747-775 (closed no bloquea)
Pantalla/ruta: ficha de la inspección
Endpoint: closeInspectionFindingAction
Rol: revisores (prevfaena, prevencionista, jefa)
Descripción: la regla visible ("los graves exigen una acción CAPA antes de cerrar", estado vacío de la bandeja) se salta cerrando el hallazgo con un motivo de 10 caracteres.
Evidencia: DEMOSTRADO: prevfaena cerró el hallazgo Alta duplicado sin CAPA y luego "Revisar y cerrar" funcionó (run reviewed).
Cómo reproducir: 1. Inspección con hallazgo Alta sin CAPA. 2. Revisor pulsa "Cerrar" en el hallazgo con motivo. 3. Revisar y cerrar.
Resultado actual: inspección cerrada con hallazgo grave sin acción correctiva.
Resultado esperado: cierre manual sólo para bajos/medios, o con aprobación/motivo tipificado distinto.
Impacto: debilita el control central de la auditoría.
Causa probable: #17 generalizó el cierre manual.
Solución recomendada: restringir `closeInspectionFinding` a `!requiresCapa(criticality)` o exigir `prevention:sign_own_work`/segunda persona.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INS-05
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: Integración PDTP / UX
Título: "Inspección de Uso y Estado de EPP · 02" sigue vigente, ejecutable y sin actividad; el detector de cableado no la reporta
Archivo(s): lib/prevention/inspection-wiring.ts
Línea(s): 206-221 (orphan_approved sólo si hay BORRADORES de otro código)
Pantalla/ruta: diálogo "Nueva inspección", /prevencion/inspecciones/plantillas
Endpoint: createInspectionRunAction
Rol: todos los ejecutores
Descripción: los reemplazos JT/PRF ya están aprobados, así que el caso que el propio comentario llama "el peor de todos" deja de detectarse.
Evidencia: DEMOSTRADO: SQL (instpl-IuGCm5BPKhJJa5QwABU9m approved, pdtp_activity_numbers null, sin binding); el selector del supervisor lista "Inspección de Uso y Estado de EPP · 02" entre JT y PRF; CÓDIGO del clasificador.
Cómo reproducir: 1. Como sup, "Nueva inspección". 2. Abrir "Plantilla". 3. Elegir la · 02 y ejecutar: nada llega al PDTP.
Resultado actual: trabajo de terreno que no acredita N°64/N°65, en silencio.
Resultado esperado: retirar la · 02 y que el detector marque vigentes sin números cuyo grupo tiene otra vigente cableada.
Impacto: pérdida silenciosa de cumplimiento.
Causa probable: la regla de detección mira borradores, no vigentes.
Solución recomendada: retirar la plantilla en datos y ampliar `classifyPdtp2026InspectionWiring`; indicar en el selector qué N° acredita cada plantilla.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INS-06
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: UI/UX
Título: Los ítems obligatorios se rotulan "Opcional"
Archivo(s): app/(app)/prevencion/inspecciones/[runId]/inspection-run-detail.tsx; lib/prevention/inspections.ts
Línea(s): detail.tsx:907 y :988 (usa item.required); inspections.ts:531-533 (la puerta usa required || puntuable)
Pantalla/ruta: ficha de ejecución (390 y 1440)
Endpoint: —
Rol: ejecutores
Descripción: el comentario del código dice que 11 de 12 plantillas no declaran `required`; casi todo se ve "Opcional" mientras el aviso superior los exige.
Evidencia: DEMOSTRADO: captura f1-exec-390-1 ("1. Manómetro… Opcional") con el mismo ítem en "Corrige antes de guardar".
Cómo reproducir: abrir cualquier inspección de extintores en móvil.
Resultado actual: rótulo contradictorio.
Resultado esperado: usar `effectiveRequiredItems` para el rótulo.
Impacto: confusión en terreno; cierres bloqueados sin entender por qué.
Causa probable: dos fuentes para la misma regla.
Solución recomendada: derivar el badge de `effectiveRequiredItems`.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INS-07
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: Integración PDTP / Trazabilidad
Título: La fecha que acredita es la del cierre en el servidor; la hora offline (`queuedAt`) se descarta
Archivo(s): lib/services/prevention-inspections/runs.ts; app/(app)/prevencion/inspecciones/[runId]/offline-inspection-queue.ts
Línea(s): runs.ts:376-402 (el zod no declara queuedAt ni fecha de ejecución), :574 (executedAt: now), :671; offline-inspection-queue.ts:44-46
Pantalla/ruta: ficha / cola offline
Endpoint: completeInspectionRunAction
Rol: ejecutores en terreno, transcriptores del reporte
Descripción: un reporte en papel transcrito días después, o un cierre sincronizado tarde, se imputa a la semana/mes de la transcripción. La cola declara `queuedAt` "para distinguir ejecutó tarde de sincronizó tarde", pero Zod lo elimina (mismo patrón que INS-19 anterior).
Evidencia: CÓDIGO (y DEMOSTRADO que la celda sale de executedAt: F1 cerrada el 29-09 cae en sem 4 aunque la programada era sem 2).
Cómo reproducir: cerrar el lunes un reporte del viernes anterior; la ejecución PDTP queda en la semana del lunes.
Resultado actual: celda equivocada en actividades semanales (N°25/26) y en el cruce de mes.
Resultado esperado: fecha de ejecución declarada (con límite de retroactividad, como Entregas) que alimente `occurredAt`.
Impacto: cumplimiento semanal/mensual mal imputado.
Causa probable: el modelo no tiene fecha de ejecución distinta de la de registro.
Solución recomendada: campo `performedAt` validado (≤ hoy, ≥ N días) usado por el conector.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: INS-08
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: Permisos / Integración PDTP
Título: Roles con alcance de faena pueden cambiar qué actividad del programa acredita una plantilla global
Archivo(s): lib/services/prevention-inspections/templates.ts; app/(app)/prevencion/inspecciones/actions.ts; modules/prevention/manifest.ts
Línea(s): templates.ts:270-280 (requireAccess manage sin faena; sólo bloquea superseded); actions.ts:109-113; manifest.ts:1089-1090 (prevencionista_faena y admin_contrato con manage)
Pantalla/ruta: /prevencion/inspecciones/plantillas → "Acreditación PDTP"
Endpoint: setInspectionTemplatePdtpActivitiesAction
Rol: prevencionista_faena, admin_contrato
Descripción: las plantillas no tienen faena; el cambio afecta a todas las faenas y no pasa por aprobación.
Evidencia: DEMOSTRADO: prevfaena (Horcones) vio "Acreditación PDTP" en 19 plantillas y cableó el borrador inspeccion_no_planeada a pdtp-catalog-040 (binding creado por qa-prev-faena); revertido por replay (binding inactivo).
Cómo reproducir: como prevfaena, Plantillas → Acreditación PDTP en cualquier plantilla vigente → elegir actividades → Guardar.
Resultado actual: cambio global inmediato, con historial pero sin aprobación.
Resultado esperado: exigir `prevention:inspections:approve` (o alcance total) y, en vigentes, aprobación segregada.
Impacto: un usuario de faena puede hacer que todas las inspecciones acrediten (o dejen de acreditar) actividades en todas las faenas.
Causa probable: el permiso `manage` se diseñó para programar por faena.
Solución recomendada: guardia de alcance total + permiso approve para el cableado.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INS-09
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: Permisos / Segregación
Título: Aprobar plantillas no está segregado de incorporarlas, contra lo declarado; la paridad documental se puede autodeclarar al importar
Archivo(s): lib/services/prevention-inspections/templates.ts; modules/prevention/manifest.ts
Línea(s): templates.ts:436 (dice que exige otro aprobador) vs :463-469 (no lo exige); :49-54 y :206-213 (importador fija parityReport "passed" con verifiedByUserId = él mismo); manifest.ts:233 ("de forma segregada de quien las incorpora")
Pantalla/ruta: /prevencion/inspecciones/plantillas
Endpoint: importInspectionTemplateAction, approveInspectionTemplateAction
Rol: prevencionista, administrador
Descripción: la misma persona incorpora y habilita el instrumento; y por acción directa puede saltarse la paridad segregada de `setInspectionTemplateParity`.
Evidencia: DEMOSTRADO: qa-prev incorporó OBS-CONDUCTAS "QA-INS-98" y la aprobó (author = approver = qa-prev); plantilla retirada después. Paridad al importar: CÓDIGO (la UI no la envía).
Cómo reproducir: 1. Incorporar borrador. 2. Aprobar con el mismo usuario.
Resultado actual: aprobado sin segunda persona.
Resultado esperado: decidir y alinear código, manifiesto y docstring; ignorar `parityReport` entrante o exigir que lo declare otra persona.
Impacto: control documental declarado que no existe.
Causa probable: decisión de simplificar tras quejas de uso, sin actualizar el contrato.
Solución recomendada: quitar `parityReport` del schema de importación; alinear la descripción del permiso o reponer la segregación.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INS-10
Severidad: 🟡 IMPORTANTE
Submódulo: Inspecciones
Categoría: UI/UX / Reglas de negocio
Título: El reporte de equipos promete una revisión de Prevención que el sistema no hace
Archivo(s): app/(app)/prevencion/inspecciones/[runId]/inspection-run-detail.tsx; lib/services/prevention-inspections/runs.ts; lib/sst/definitions/reporte-equipos.ts
Línea(s): detail.tsx:819; runs.ts:568-584; reporte-equipos.ts:41 (closesOnCompletion: true)
Pantalla/ruta: ficha del reporte (paso 1)
Endpoint: completeInspectionRunAction
Rol: jefe_terreno / admin_contrato
Descripción: la pantalla dice "Prevención revisa y cierra después; no corresponde que quien transcribe se auto-revise", pero al declarar ejecutada queda `reviewed` por el transcriptor.
Evidencia: DEMOSTRADO: F4 reviewed_by = executed_by = qa-jt, review_comment automático.
Cómo reproducir: cerrar un reporte sin hallazgos altos.
Resultado actual: autocierre por el transcriptor.
Resultado esperado: texto coherente con la decisión D04, o revisión real por Prevención.
Impacto: el usuario cree que habrá control posterior.
Causa probable: texto previo a la decisión de autocierre.
Solución recomendada: corregir el texto (o el comportamiento) y mostrarlo en el acta.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

**Mejoras y cosméticos (🔵/⚪)**

| ID | Hallazgo | Archivo:línea | Evidencia | Solución | Esfuerzo |
|---|---|---|---|---|---|
| INS-11 🔵 | KPI "hallazgos abiertos/graves" cuentan runs cancelados y hallazgos `capa_linked`; el hallazgo de un run cancelado queda abierto para siempre | `queries.ts:68-69`; `transitions.ts:100-113` | DEMOSTRADO (KPI 2/2 con F1 revisada y F2 cancelada) | Excluir cancelados; cerrar/anular hallazgos al cancelar | Bajo |
| INS-12 🔵 | No se puede quitar una foto (servicio sin acción ni UI); el error manda a "quitar las fotografías primero" | `evidence.ts:95-109,199-216`; `runs.ts:274-276` | CÓDIGO | Exponer borrado en runs editables | Bajo |
| INS-13 🔵 | `evidence` y `documento` escriben el archivo antes de autorizar: archivos huérfanos (DoS de disco teórico, 25 MB por envío) | `evidence/route.ts:77-82`; `documento/route.ts:81-84` (finding-evidence sí valida antes) | DEMOSTRADO (otrafaena y prevfaena rechazados, 93→95 archivos) | Validar run/alcance antes de escribir | Bajo |
| INS-14 🔵 | Asignado sin validar alcance/permiso; la lista ofrece usuarios de otras faenas; al elegir faena se asigna sola al prevencionista aunque la cree el JT | `runs.ts:73,132`; `programs.ts:36`; `inspection-run-list.tsx:621` | DEMOSTRADO (lista con QA_PrevFaena Otra; F2 asignada a otro) | Validar en servidor; default = quien crea | Bajo |
| INS-15 🔵 | Plantillas: columna de acciones fuera de vista a 1440; columna "Acredita PDTP" monoespaciada y larga | `inspection-catalog.tsx:350,463,515-521` | DEMOSTRADO (x≈1.430, tabla 1.278/1.126) | Acciones en menú; mostrar sólo N° | Bajo |
| INS-16 🔵 | Vista previa de planilla PDF bloqueada por CSP `object-src 'none'` | `source-form.tsx:46`; `lib/security/csp.ts:35` | DEMOSTRADO (error de consola) | Usar `<iframe>`/visor permitido o enlace | Bajo |
| INS-17 🔵 | CTA "Revisar" para quien ejecutó; estado vacío pide al supervisor habilitar plantillas | `inspection-run-list.tsx:316` | DEMOSTRADO (390 px) | CTA según permiso | Bajo |
| INS-18 🔵 | Violación de CHECK termina en "No se pudo completar la operación."; `catch {}` sin log en export de seguimiento | `actions.ts:76-78`; `seguimiento/export/route.ts:23` | DEMOSTRADO / CÓDIGO | Mapear errores de datos; loguear | Bajo |
| INS-19 ⚪ | La ejecución PDTP guarda "Inspección completada: insrun-…" como evidencia | `pdtp-accreditation-connectors.ts:128` | DEMOSTRADO (SQL) | Código legible del run | Bajo |
| INS-20 🔵 | Sin "marcar todo conforme": 49 toques en EPP a 390 | `inspection-run-detail.tsx` | DEMOSTRADO | Acción masiva por sección | Medio |
| INS-21 🔵 | Re-cerrar tras reabrir actualiza la ejecución existente sin mover año/mes/semana (si se re-cierra otro mes, la celda queda en la original con `executedAt` nuevo) | `lib/services/pdtp/accreditation.ts:873-897` | CÓDIGO / TEÓRICO | Recalcular celda o documentar | Bajo |

### I. Readiness individual: **60/100** (no listo)
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 13,5 | INS-01 −7, INS-03 −2, INS-04 −1,5, INS-14 −0,5, INS-12 −0,5 |
| UI/UX | 20 | 13,5 | INS-06 −2, INS-10 −1, INS-15 −1, INS-05 −1, INS-16 −0,5, INS-17 −0,5, INS-20 −0,5 |
| Integridad de datos | 15 | 10 | INS-01 −2, INS-03 −1, INS-11 −1, INS-13 −0,5, INS-21 −0,5 |
| Integración con Programa Anual | 15 | 7 | INS-01 −4 (N°25/26), INS-02 −1,5, INS-07 −1,5, INS-05 −1 |
| Código y mantenibilidad | 10 | 7,5 | INS-12 −0,5, INS-09 (comentario contradictorio) −0,5, INS-18 −0,5, archivos de 1.200–1.700 líneas −1 |
| Permisos y seguridad | 5 | 2 | INS-08 −1,5, INS-09 −1, INS-13 −0,5 |
| Testing | 5 | 3,5 | INS-01/INS-03 sin prueba −1,5 |
| Manejo de errores | 5 | 3 | INS-18 −1,5, INS-01 error genérico −0,5 |

### Estado de hallazgos previos en este alcance
- **PRV-19 #13** (reescribir inspección completada): **Corregido (verificado)**. Replay HTTP de `saveInspectionAnswers` sobre F1 completada → rechazo; re-envío de `complete` → eco idempotente sin cambios en DB.
- **PRV-04 (revocación, parte inspecciones/EPP):** **Corregido (verificado)**. Reabrir y cancelar revocan (draft + motivo + actor); anular entrega revierte una N°62 ya aprobada, con entrada en `pdtp_change_log`.
- **PRV-02 (inspecciones):** **Sigue abierto por diseño**. El actor se guarda, pero el mismo actor autoaprueba (INS-02).
- **C-03:** **Parcial**. La cola ya no muestra ids, pero la ejecución los guarda (INS-19) y las N°62 quedan indistinguibles (INS-E1).
- Matriz previa "Inspecciones — ¿2.ª aprobación? No (automática)": sin cambios.

### Qué no se pudo verificar y por qué
- Cola offline de extremo a extremo (sólo código). Digitalización con planilla real y detector de marcas. Impresión "Acta PDF" (Cloudreve no configurado en B). Barrido diario del programador (cron) y "Sacar de servicio" (flota). Acreditación de revisión `reviewN` (ninguna plantilla la usa). Inspección EPP con filas de la bodega (cfe3a925): no ejecutada en navegador; la prueba PGlite `prevention-inspection-epp-rows-pglite` pasa.

---

## AUDITORÍA — EPP preventivo (Requisitos de EPP)

**Rutas:** `/prevencion/epp-preventivo` (pestañas Cobertura / Requisitos), `/api/prevencion/epp/export`; relación con `/entregas` y `lib/services/deliveries-worker-stock.ts:478-498`, `deliveries-void.ts:204-214`.
**Permisos:** view: jt, admin_contrato, prevencionista(_faena), cphs, jefa, admin; manage: prevencionista(_faena), admin_contrato, jefa, admin. `sup` y `ti` sin acceso (`/forbidden`, verificado).

### A. UI/UX/Diseño
- `PageHeader` con acciones (Exportar, Nuevo requisito), aviso de calidad de datos (7 familias sin clasificar), pestañas con contadores, 2 filtros, tabla de brechas con fundamento y badge "BLOQUEANTE". Sin desborde a 1440 y 390 (a 390 la tabla se desplaza dentro de su contenedor; uso de escritorio, aceptable).
- Estado vacío "Sin brechas de cobertura de EPP… Toda la dotación… tiene el EPP entregado" cuando **no hay ningún requisito** (INS-E2).
- "Escalar brechas bloqueantes a CAPA" y "Crear solicitud de reposición" viven en el contenido, no en el header; export con `<a download>` y no `ExportButton`; los `SelectTrigger` del diálogo no tienen nombre accesible (INS-E4).
- El panel "Actividades programadas" aparece vacío (no hay instancias programadas en B).
- Estados observados: Sin información, Con información (7 brechas), Operación exitosa (crear, desactivar), Permisos insuficientes (sup/ti).

### Facilidad de uso
Crear un requisito por faena: 6 clics (Nuevo requisito, tipo, exigibilidad, faena, fundamento, Crear). El resultado se ve de inmediato en Cobertura. Desactivar: 3 clics con motivo.

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Crear requisito (faena propia) | ✅ | prevfaena → `peppr-8Ymf…` blocking, 7 brechas en Horcones |
| Alcance: otra faena / global desde faena | ✅ | replay: "fuera de alcance" / "Un requisito sin faena rige en todas las faenas…" |
| Brechas de cobertura (excluye anuladas) | ✅ | UI + código `prevention-epp.ts:336-341` |
| Desactivar con motivo | ✅ | UI → `is_active = f` |
| Exportar cobertura Excel | ✅ | otrafaena no ve Horcones; prevfaena sí (xlsx inspeccionado) |
| Escalar a CAPA | ❓ | no ejecutado en B (habría creado 7 CAPA reales); cubierto por `epp-requirement-management` y `prevention-epp-postgres` |
| N°62 por entrega en `/entregas` | ✅ | ver G |

### C. Código y lógica
Servicio pequeño y claro, historial en la misma transacción, `task` retirado del schema con motivo documentado. `getEppCoverageDataHealth` no filtra por faena (`prevention-epp.ts:436-464`): un usuario de faena ve conteos globales (INS-E3). `preferredFamilyId` no se valida contra el tipo de EPP.

### D. Modelo de datos
Requisitos con borrado lógico (`is_active`), FK a tipos/familias; la cobertura se calcula en lectura, sin tabla derivada. CAPA idempotente por `workerId:eppTypeId`.

### E. Permisos y seguridad
Demostrados: alcance por faena en creación y exportación; `sup`, `ti` y `cphs` sin manage rechazados. Sin vulnerabilidades encontradas.

### F. Testing
`prevention-epp-postgres` 10 ✅; unitarias `epp-requirement-management`, `prevention-epp-actions`, `prevention-epp-calc`, `epp-dialogs`, `pdtp-epp-delivery-accreditation` (PGlite), `worker-stock-delivery`, `register-delivery-action`: ✅ (dentro de los totales de arriba). E2E `prevencion-epp-matriz` e `integration-epp-lifecycle` leídos, no corridos.

### G. Integración con el Programa Anual (N°62, entorno B)
- Entrega `ENT-2026-0059` registrada por UI (admin, Biodiversa, 1 lente, comprobante PNG) → `pdtp_executions` N°62, programa v2, Biodiversa, 2026-09 sem 4, **submitted**, `executed_by = qa-admin`, `evidence_status provided` (ruta `storage/deliveries/…`), cantidad 1.
- Aprobada por `prev2` (otra persona) con un clic → `approved`.
- **Anulación** de la entrega → ejecución `draft`, motivo "Entrega anulada: …", entrada en `pdtp_change_log` ("Acreditación aprobada … revertida") ✅.
- **PRV-19 #12:** el código apunta a `/entregas` (`connectors.ts:171-173`, `fulfillment-contract-2026.ts:233-236`) y `/entregas?faena=` filtra la faena (verificado). El botón "Iniciar" sólo existe en el panel de instancias programadas, que en B está vacío: **no verificable en UI**. El panel se muestra con `prevention:epp:manage`, pero el destino exige `deliveries:create`, que `jefa_chome` y `admin_contrato` no tienen (INS-E5).
- Cada entrega genera su propia ejecución `submitted`; la N°62 planifica 1 por semana. La cola de aprobaciones muestra filas "Entrega EPP" con botones "✓ Sep · sem. 2" idénticos, sin trabajador ni código de entrega (INS-E1).
- Las 6 ejecuciones N°62 anteriores quedaron en el programa v1 (cerrado); v2 no tenía ninguna antes de mi prueba (lo evalúa el agente del núcleo PDTP).

### H. Hallazgos

```
ID: INS-E1
Severidad: 🟡 IMPORTANTE
Submódulo: EPP preventivo / N°62
Categoría: Integración PDTP / UX
Título: Cada entrega crea una ejecución N°62 a aprobar a mano, y la cola no permite distinguir cuál se aprueba
Archivo(s): lib/services/deliveries-worker-stock.ts; lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts
Línea(s): deliveries-worker-stock.ts:487-498; connectors 242-282 (fuente epp no autoaprueba, una fila por deliveryId)
Pantalla/ruta: /prevencion/pdtp/aprobaciones
Endpoint: approvePdtpExecutionAction
Rol: aprobadores PDTP
Descripción: la actividad es semanal (1), pero cada entrega a una persona es una ejecución `submitted`. La cola lista chips "Entrega EPP" y botones "✓ Sep · sem. 2" repetidos, sin trabajador, código ENT ni enlace al comprobante; se aprueba con un clic sin confirmación.
Evidencia: DEMOSTRADO: captura aprobaciones-prev2 (7 N°62 en Biodiversa, indistinguibles); aprobación de un clic de la ejecución de ENT-2026-0059.
Cómo reproducir: registrar varias entregas en una semana; abrir Aprobaciones.
Resultado actual: decenas de aprobaciones idénticas por faena y semana.
Resultado esperado: una ejecución por celda que agregue entregas, o aprobación en lote con detalle (trabajador, ENT, comprobante).
Impacto: la cola se vuelve inmanejable y se aprueba a ciegas.
Causa probable: acreditación por evento sin agregación.
Solución recomendada: mostrar ENT/trabajador/comprobante en la fila y aprobar por lote; o agregar por celda.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

| ID | Hallazgo | Archivo:línea | Evidencia | Solución | Esfuerzo |
|---|---|---|---|---|---|
| INS-E2 🔵 | Estado vacío afirma "sin brechas" cuando no hay requisitos (A4) | `epp-gap-list.tsx` | DEMOSTRADO (captura admin) | Mensaje "No hay requisitos declarados" + CTA | Bajo |
| INS-E3 🔵 | Salud de datos sin filtro de faena (conteos globales a usuarios de faena) | `prevention-epp.ts:436-464` | CÓDIGO + captura prevfaena ("66 entregas") | Aplicar alcance | Bajo |
| INS-E4 🔵 | Export con `<a download>`; acciones de página dentro del contenido; selects sin nombre accesible | `page.tsx:60-64`; `epp-dialogs.tsx:79-118` | CÓDIGO | `ExportButton`, `aria-label` | Bajo |
| INS-E5 🔵 | "Iniciar" N°62 se ofrece con `epp:manage` pero el destino exige `deliveries:create` (jefa_chome, admin_contrato) | `connectors.ts:173-174`; `fulfillment-contract-2026.ts:236` | CÓDIGO | Unificar el permiso del panel con el del contrato | Bajo |

### I. Readiness individual: **87/100** (muy próximo)
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 22 | INS-E1 −2, INS-E2 −1 |
| UI/UX | 20 | 16,5 | INS-E2 −1,5, INS-E4 −1,5, INS-E3 −0,5 |
| Integridad de datos | 15 | 14 | INS-E3 −0,5, familia preferida sin validar −0,5 |
| Integración con Programa Anual | 15 | 12 | INS-E1 −2, INS-E5 −0,5, #12 no verificable en UI −0,5 |
| Código y mantenibilidad | 10 | 9,5 | INS-E4 −0,5 |
| Permisos y seguridad | 5 | 4,5 | INS-E3 −0,5 |
| Testing | 5 | 4,5 | escalamiento sin E2E −0,5 |
| Manejo de errores | 5 | 4 | mensajes genéricos de `actionErrorResult` −1 |

### Estado de hallazgos previos en este alcance
- **PRV-19 #12:** **Parcial**. Corregido en código y `/entregas?faena=` funciona; el botón "Iniciar" no se pudo ejercitar (sin instancias programadas en B); permiso del panel desalineado (INS-E5).
- **PRV-02 (EPP):** **Corregido (verificado en datos)**. La ejecución guarda `executed_by = qa-admin` y la aprobó otra persona. No probé que el mismo admin sea rechazado.
- **PRV-01 (EPP):** **Corregido (verificado)**. El comprobante real queda como `evidence_url` y `provided`.
- **PRV-04 (anular entrega):** **Corregido (verificado)**, incluida la reversión de una aprobada.

### Qué no se pudo verificar y por qué
Escalamiento a CAPA en navegador (evité crear 7 CAPA en datos compartidos). "Iniciar" N°62 (no hay instancias programadas en B). Rechazo de autoaprobación por el mismo registrante.

---

Limpieza: `lib/__tests__/inspecciones-compliance.audit-tmp.test.ts` se copió a `scratchpad/audit/inspecciones/` y se borró del repo; las bases `bodega_test_audit_ins_*` se borraron. `git status --porcelain` no muestra archivos míos (quedan `.audit-*`, `.claude/settings.local.json` y `lib/__tests__/documental-integration.audit-tmp.test.ts` de otros).
