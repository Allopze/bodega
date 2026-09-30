# Auditoría de production readiness — Evaluaciones SST, PPA e Inicio de Prevención

**Agente:** evaluaciones (prefijo **EVA-**) · **Fecha:** 2026-09-29 · **Build:** HEAD `11e67621` (producción) en :3100 (A, semilla E2E) y :3101 (B, copia realista con el programa 2026 v2 real).
**Modo:** diagnóstico. No se editó ningún archivo versionado. Todo lo ejecutado está en `scratchpad/audit/evaluaciones/` (scripts `.mjs`, capturas `.png`, salidas `.json`, exportes `.xlsx`).

**Datos QA creados (rotulados `QA_EVA`)**
- B: trabajadores `QA_EVA Trabajador Uno/Dos/Tres` (Horcones, RUT 25123401-9 / 25123402-7 / 25123403-5); actas `Qoz0FgXTKq55IPk1-Y51C` (nuevo, cerrada), `Z8KnpyQUQwyepKryVq6kf` (duplicada, cerrada), `-RABwCR88fvnFgmWV57qw` (RE-28, cerrada), `pSzmOqFwvXaiU9NfImUBv` (nuevo, cerrada), `IiDpNzku8XirtCF5ytEQO` (conductor líder, borrador), `Kfi59ZJGGajKUKz80MIgD` (fecha futura, cerrada); PPA `C8Z8caDt52uZVWHhKfXe6` (ciclo completo) y 4 PPA más; usuarios `qa-eva-cond` (conductor_lider) y `qa-eva-adminc` (admin_contrato) con faena Horcones. Se aprobaron N°18 (por `prev`), N°52 y N°23 (por `prev2`) de la primera acta.
- A: trabajadores `QA_EVA Trabajador A1` (Faena E2E) y `A2` (Faena Restringida); borrador `s4d1n3zsGmcQmVZOUp7My` (prueba de autoguardado).
- Se borró por la UI un borrador propio creado por error (`xtpwgcxB4esRuwiQK8H1g`), lo que sirvió de prueba de eliminación.

**Puertas ejecutadas:** 43 archivos / **493 pruebas** unitarias (SST, PPA, atención, paridad menú↔página, navegación) ✅ y 10 archivos / **91 pruebas PGlite** (acreditación de trabajador nuevo, RE-28, ciclo de vida, borrado, alcance, integridad, alertas, PPA) ✅ — `tests-fast.log`, `tests-pglite.log`.

---

## Respuesta a la observación del orquestador (dos `h1` en `/prevencion`)

**Causa demostrada:** `app/(app)/prevencion/loading.tsx:7-19` es un esqueleto con `PageHeader title="Evaluaciones SST"` que quedó de cuando `/prevencion` era la bandeja SST. Next envuelve `page.tsx` **y todos los segmentos hijos sin `loading` propio** en ese `Suspense` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`: "wraps page.js and any children below"). Durante el streaming el primer `h1` es "Evaluaciones SST" y luego se reemplaza por "Inicio de Prevención". No hay dos `h1` a la vez ni contenido distinto.
Evidencia (`survey.mjs`, `survey-A.json`): `h1` al primer pintado = `["Evaluaciones SST","Inicio de Prevención"]` para `prevfaena`, `otrafaena`; `["Evaluaciones SST"]` para `ti` antes de ir a `/forbidden`; `h1` visibles finales = 1. Afecta también a `/prevencion/coordinacion`, `/coordinacion/[id]`, `/faenas`, `/faenas/[worksiteId]` y `/privacidad` (sin `loading.tsx` propio). → **EVA-33**.

---

## AUDITORÍA — Evaluaciones SST / habilitación de trabajadores

**Rutas:** `/prevencion/evaluaciones` (lista por trabajador), `/prevencion/nueva`, `/prevencion/trabajador/[workerId]` (ficha con tres participaciones: prevencionista, admin. de contrato, conductor líder), `/prevencion/[id]` (acta por secciones), `/sst/[id]/print` y `/print/pdf`.
**Archivos:** `app/(app)/prevencion/actions/*.ts`, `lib/services/sst-module/*.ts`, `lib/sst/**` (definiciones `trabajador_nuevo`, `trabajador_antiguo`, `identificacion_sensibles`), `lib/validation/sst.ts`, `lib/services/pdtp-adapters/worker-onboarding-connector.ts`, `worker-sensitivity-connector.ts`, `worker-lifecycle-connector.ts`, `db/schema/sst.ts`.
**Permisos (`modules/sst/manifest.ts:34-62`):** `sst:view` (prevencionista, prevfaena, admin_contrato, jefe_terreno, supervisor_terreno, administrador), `sst:create` (prevencionista, prevfaena, admin_contrato, administrador), `sst:close` (prevencionista, prevfaena, admin_contrato, administrador), `sst:manage` (prevencionista, administrador), `sst:evaluate_acompanamiento` (conductor_lider, administrador). **En B `admin_contrato` no tiene `sst:close`** (sí en el manifiesto): deriva entre BD y manifiesto (EVA-M08).

### A. UI/UX/Diseño
- **Nueva evaluación** (`g2-*-form-1440.png`): bien resuelta — ficha base, trabajador buscable con RUT, faena derivada del trabajador, `DatePicker` con `max=hoy`, cargos como toggles, resumen antes de crear, `PageHeader`/`PageContainer` correctos, 0 desborde a 1440 y 390.
- **Tipo de evaluación** ofrece `Trabajador nuevo · Control de seguimiento · Control de seguimiento`: el RE-28 y el seguimiento de trabajador antiguo muestran **el mismo rótulo** (`nueva-evaluacion-form.types.ts:45-48`). El propio auditor eligió el equivocado (creó un seguimiento en vez del RE-28). → EVA-11.
- **Acta** (`shot-B-prev-_prevencion_Qoz0…-1440/390.png`): cabecera con avance, % y resultado; navegación por un selector de sección + "Anterior/Siguiente"; botones de estado grandes y legibles; a 390 px es usable. "Firmas requeridas (en acta impresa)" deja claro que las firmas son en papel. No muestra quién cerró ni cuándo, ni qué actividades del programa acreditó.
- **Lista** (`shot-B-prev-_prevencion_evaluaciones-1440.png`): una fila por trabajador con tres columnas de rol y `Badge` de estado/resultado; `EmptyState` con CTA. Sin filtros (ni faena ni estado) y paginación fija a 50 trabajadores (`evaluations-page.tsx:141`).
- **Ficha del trabajador** (`shot-B-prev-_prevencion_trabajador_VoRAccr…-1440.png`): con el acta cerrada muestra "Sin evaluación iniciada · + Iniciar Evaluación" en las tres tarjetas, aunque la lista dice "Cerrado · HABILITADO AUTÓNOMO". → EVA-04.
- **Breadcrumbs**: "Evaluaciones SST" apunta a `/prevencion` (Inicio) en `nueva/page.tsx:79`, `[id]/page.tsx:91`, `trabajador/[workerId]/page.tsx:113` y sus `loading.tsx`; el menú marca "Evaluaciones SST" en `/prevencion/campanas` (EVA-34).
- **RE-28**: pide "Motivo de seguimiento" (control periódico, post incidente…) y sólo permite cargos de conductor; el resultado se muestra como "HABILITADO AUTÓNOMO" (vocabulario del acta de ingreso). → EVA-11.
- **Estados observados:** con información ✅, sin información (EmptyState en A para `otrafaena`) ✅, cargando (esqueleto — con título erróneo en `/prevencion`, EVA-33) ✅, error de validación al cerrar ("Cierre bloqueado: faltan N ítem(s)") ✅, operación exitosa (toast "Evaluación cerrada exitosamente") ✅, operación fallida (toast de sección no permitida) ✅, permisos insuficientes (`ti`/`cphs`/`jefa` → `/forbidden`; `otrafaena` → redirección) ✅. Falso error: toast "Esta evaluación está cerrada y no puede ser modificada" junto al de éxito al cerrar (EVA-01).
- **Responsive:** 1440/390 sin desborde en lista, nueva, acta, ficha; 0 errores de consola, 0 respuestas ≥400.

### Facilidad de uso (tareas probadas)
| Tarea | Rol | Clics | Resultado |
|---|---|---:|---|
| Crear acta de trabajador nuevo desde la lista | prev (B) | 7 | ✅ |
| Completar 27 ítems y cerrar | prev (B) | 34 (27 respuestas + 5 "Siguiente" + 2 cierre) | ✅; total 41 clics de punta a punta |
| Crear RE-28 | prev (B) | 9 (incluye un "motivo" que no corresponde) | 🟡 opción ambigua |
| Iniciar participación del conductor líder en la misma visita | conductor (B) | 4 | ✅ (el cargo no viene preseleccionado; sin él el diálogo no avanza sin aviso visible) |
| Volver a abrir un acta cerrada desde la UI | prev | — | 🔴 no hay camino (sólo URL directa) |

Fricciones: sin "marcar todo Cumple"; el cierre no informa qué acreditó en el PDTP; la ficha del trabajador invita a duplicar.

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Crear acta (nuevo / seguimiento / RE-28) | ✅ / ✅ / 🟡 | `g2-nuevo1.json`, `g2-re28.json` (EVA-11) |
| Guardar respuestas (autoguardado) | 🔴 | bucle infinito y pisado entre pestañas (EVA-01) |
| Guard de sección por rol (conductor) | ✅ | réplica de la server action: 1.1/1.2 → "No tienes permisos para editar esta sección." (`g5-conductor.mjs`) |
| Validación de ítems contra la definición | 🔴 | ítem inexistente `no_existe_QA` aceptado; Punto 3 escrito en el acta del prevencionista (EVA-M01) |
| Cierre con gate de obligatorios y observación | ✅ | "Cierre bloqueado…"; `closeEvaluation` `evaluations.ts:248-258` |
| Cálculo de resultado / % | ✅ | 27/27 → 100 % → `habilitado_autonomo` |
| Consultar acta cerrada desde la UI | 🔴 | EVA-04 |
| Imprimir / PDF | ✅ | `/sst/[id]/print/pdf` 200 `application/pdf` 85 KB |
| Copia del acta en biblioteca documental | ❓ | en B falla por "Cloudreve no está configurado" (log del servidor); best-effort sin reintento (EVA-M07) |
| Eliminar borrador | 🟡 | funciona; CAPA abiertas se cancelan; deja la visita huérfana y no audita (EVA-08) |
| Anular / reabrir / corregir acta cerrada | ❌ | no existe (EVA-07) |
| Seguimientos D0/7/15/30 y plan de acción | 🟡 | requieren `sst:manage`, que `prevencionista_faena` no tiene (EVA-M05) |
| Semanas del conductor | 🟡 | desbloqueo por fecha ✅; marcar semana no exige respuestas ni rol (EVA-M02) |
| Filtrar/buscar lista | ❌/✅ | sin filtros; búsqueda del TopBar sobre la lista cargada |
| Exportar Excel | ❌ | no existe exportación de evaluaciones (no la promete la pantalla) |

### C. Código y lógica
- `use-checklist-responses.ts:67-74` usa `isDirty: revision > 0`; `revision` nunca vuelve a 0, así que `use-debounced-autosave.ts:71-75` re-arma el guardado cada vez que `pending` vuelve a `false` (EVA-01).
- `saveResponses` (`responses.ts:10-35`) acepta cualquier `seccionId/itemId`; el zod (`validation/sst.ts:290-297`) no valida contra la definición (EVA-M01).
- `fechaEvaluacion: z.string().min(1)` (`validation/sst.ts:269`): sin formato ni tope (EVA-06).
- Ciclo de vida de visita muerto: `sst_evaluation_visits` tiene `estado`, `closedAt`, `closedByUserId`, `reopened*` (`db/schema/sst.ts:9-24`) y ningún código los escribe (EVA-08).
- Comentario de manifiesto desactualizado: dice que el acta acredita la N°19 (`modules/sst/manifest.ts:41-45`), que desde el 24-09 acredita Documentación (`worker-onboarding-connector.ts:56-63`).
- `EvaluationList` recibe `canDelete` y lo ignora (`evaluation-list.tsx:28`). Sin `console.log`, sin `any`, sin TODO.

### D. Modelo de datos
- `sst_evaluations` sin `closed_at`/`closed_by`, sin CHECK de `estado`, sin trigger de inmutabilidad: la inmutabilidad DS 44 vive sólo en `assertEditable` (`helpers.ts:11-16`) (SQL de `pg_constraint`).
- `fecha_evaluacion` es `text`.
- Borrar un borrador elimina respuestas, seguimientos y semanas (cascada) pero deja la visita (`sst_evaluation_visits` con 0 evaluaciones, demostrado).
- Borrado físico sin `audit_log` (0 filas para el id borrado).

### E. Permisos y seguridad
- Alcance por faena ✅ demostrado: `otrafaena` → `/prevencion/[id]` redirige, `/sst/[id]/print` 404, `/print/pdf` 404; `cphs`/`ti` → `/forbidden` y PDF 403; anónimo → login/307 (`idor.mjs`).
- Guard server-side de sección ✅ (conductor líder).
- **Datos de salud del RE-28** visibles para `supervisor_terreno` y `jefe_terreno` (tienen `sst:view` "para firmar"): pantalla, impresión y PDF, sin registro en `prevention_sensitive_access_audit` (EVA-03).
- Segregación PDTP incompleta para N°17/18/23/63 (EVA-02).

### F. Testing
- Corridas: ver encabezado (493 + 91, todo verde).
- Brechas: no hay E2E del flujo crear → completar → cerrar → PDTP (sólo `e2e/sst-pdf.spec.ts`, cuyo caso "sin sesión" acepta 200 como válido, `sst-pdf.spec.ts:46-52`); ninguna prueba del autoguardado con cambios concurrentes ni de que el guardado se detenga; ninguna de fecha futura; ninguna de visibilidad del RE-28 por rol; `restricted-roles.spec.ts` no cubre Prevención.

### G. Integración con el Programa Anual (ejecutado en B con el programa 2026 v2 real)
1. Alta de `QA_EVA Trabajador Uno` en Horcones por `/admin/trabajadores` → abre obligaciones **N°15 y N°52** (`pending`, `integration`, sujeto `worker:<id>`, plazo = instante del alta).
2. `prev` crea y cierra el acta (27/27 Cumple) → `habilitado_autonomo`. Resultado en `pdtp_executions` (todas `submitted`, mes 9 semana 4, Horcones):

| N° | Vía | executed_by | evidence_status | ¿Quien cerró puede aprobar? |
|---|---|---|---|---|
| 15 | obligación | qa-prev | `provided` (sólo texto) | **No** — "Quien registró el cumplimiento no puede aprobarlo" ✅ |
| 52 | obligación | qa-prev | `provided` (sólo texto) | No; `prev2` la aprobó **sin motivo** (EVA-10) |
| 18 | directa | **null** | pending | **Sí — `prev` la aprobó** con un motivo (EVA-02) |
| 23 | directa | **null** | not_required | Sí (se aprobó con `prev2`) |
| 63 | directa | **null** | not_required | Sí (mismo camino que N°18) |
| 17 (RE-28) | directa | **null** | not_required | Sí (mismo camino) |

3. **Revocación:** el acta cerrada no se puede borrar (`evaluations.ts:364-366`, PGlite `sst-delete-evaluation`) y no hay anulación ni reapertura, así que nada revoca; la única corrección posible es rechazar cada ejecución en Aprobaciones (EVA-07).
4. **Segunda acta del mismo trabajador** (la ficha lo invita): crea otra tanda N°18/23/63 para la misma persona (EVA-05).
5. **Fecha futura** (15-12-2026, request alterada): acta cerrada, cinco ejecuciones en diciembre semana 3 y obligaciones N°15/52 "reported" a esa fecha; aprobarlas sí se bloquea ("…una semana que aún no ocurre") (EVA-06).
6. **Conductor líder / supervisor:** con la participación del conductor en borrador (0/4 semanas) y sin participación de admin. de contrato, el acta del prevencionista cierra "habilitado autónomo" y reporta N°52 (EVA-09).
7. **Aprobador:** ve el chip "Acta de trabajador nuevo cerrada" sin enlace al acta ni nombre del trabajador (`evidence-href.ts:1-14`, C-03 quitó el id) (EVA-10).
8. El mapa `MAPA_MODULOS_ACREDITACION_PDTP_2026.md:45` coincide con lo observado.

### H. Hallazgos

```
ID: EVA-01
Severidad: 🟠 CRÍTICO
Submódulo: Evaluaciones SST
Categoría: Integridad de datos / Código
Título: El autoguardado del acta nunca se detiene y reescribe el acta completa: dos pestañas se pisan y se pierden respuestas
Archivo(s): app/(app)/prevencion/[id]/evaluation-detail/use-checklist-responses.ts; lib/hooks/use-debounced-autosave.ts
Línea(s): use-checklist-responses.ts:41-57 (lote con todos los ítems, incluidos los null), 67-74 (isDirty: revision > 0); use-debounced-autosave.ts:71-75
Pantalla/ruta: /prevencion/[id]
Endpoint: saveResponsesAction (server action)
Rol: cualquier evaluador (prevencionista, prevfaena, admin, conductor)
Descripción: tras la primera edición `isDirty` queda en true para siempre, y el efecto vuelve a programar un guardado cada vez que termina el anterior. Cada guardado envía TODOS los ítems editables con el estado local, incluidos los vacíos.
Evidencia: DEMOSTRADO (g3-autosave.mjs, entorno A, borrador s4d1n3zsGmcQmVZOUp7My). Un solo clic → 14 server actions en 12 s (intervalo ~830 ms, sin fin). Con dos pestañas abiertas (prev y prev2), la BD alternó cada segundo entre "contrato_trabajo=cumple, examen=NULL" y "contrato_trabajo=NULL, examen=cumple"; estado final: contrato_trabajo=NULL (respuesta perdida). Al cerrar la pestaña ya guardada el navegador pidió confirmar la salida (beforeunload). En el cierre normal (g2-nuevo1.json) apareció el toast "Esta evaluación está cerrada y no puede ser modificada…" junto al de éxito.
Cómo reproducir:
1. Abrir el mismo borrador en dos pestañas (o equipos).
2. Responder un ítem en cada una.
3. Mirar sst_responses: los valores se alternan y gana la última pestaña que guardó.
Resultado actual: pérdida silenciosa de respuestas, ~1,2 solicitudes/s por acta abierta (cada una con revalidatePath), aviso de "cambios sin guardar" permanente y toast de error tras cerrar.
Resultado esperado: guardar sólo cuando hay cambios nuevos y sólo los ítems modificados; detenerse después de guardar.
Impacto: un acta legal puede cerrarse con respuestas que el evaluador sí marcó y se borraron; carga innecesaria sobre el servidor.
Causa probable: el contador de revisiones se usa como "sucio" sin registrar la última revisión guardada.
Solución recomendada: guardar la revisión confirmada (lastSavedRevision) y usar isDirty = revision !== lastSaved; enviar sólo los ítems cambiados (diff) o usar control de versión; prueba unitaria del hook.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A
```

```
ID: EVA-02
Severidad: 🟠 CRÍTICO
Submódulo: Evaluaciones SST
Categoría: Integración PDTP / Segregación (PRV-02)
Título: N°18, 23, 63 y 17 llegan al PDTP sin actor: quien cerró el acta aprueba su propio cumplimiento
Archivo(s): lib/services/pdtp-adapters/worker-onboarding-connector.ts; lib/services/pdtp-adapters/worker-sensitivity-connector.ts; lib/services/pdtp/executions.ts
Línea(s): worker-onboarding-connector.ts:196-213 (safeAccredit sin actorUserId); worker-sensitivity-connector.ts:43-58 (ídem); executions.ts:579 (sólo compara executedByUserId)
Pantalla/ruta: /prevencion/pdtp/aprobaciones
Endpoint: approvePdtpExecutionAction
Rol: prevencionista / administrador (cierran actas y tienen prevention:pdtp:approve)
Descripción: el arreglo de PRV-02 guarda el actor en `executedByUserId` sólo si el conector pasa `actorUserId`. El de trabajador nuevo lo pasa a las obligaciones (15/52) pero no a la acreditación directa; el del RE-28 no lo pasa nunca.
Evidencia: DEMOSTRADO (B). Acta Qoz0… cerrada por qa-prev; N°18 executed_by_user_id = NULL; qa-prev pulsó "✓ Sep · sem. 4", el diálogo pidió motivo y el resultado fue "Ejecución de Sep semana 4 aprobada" (approved_by = qa-prev). Con la N°15 el mismo usuario recibió "Quien registró el cumplimiento no puede aprobarlo". N°17 del RE-28 -RABw… también quedó con executed_by NULL.
Cómo reproducir:
1. Como prevencionista, cerrar un acta de trabajador nuevo conforme.
2. Ir a Aprobaciones, fila N°18 de la faena.
3. Aprobar con cualquier motivo de ≥10 caracteres.
Resultado actual: autoaprobación con un texto libre.
Resultado esperado: rechazo, igual que en la N°15.
Impacto: la segregación que el módulo exige en todo lo demás no rige en 4 de las 6 actividades del acta.
Causa probable: el parámetro se agregó a la obligación y se olvidó en `safeAccredit` y en el conector RE-28.
Solución recomendada: pasar `actorUserId` (quien cierra) en ambos conectores; prueba PGlite de regresión.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A
```

```
ID: EVA-03
Severidad: 🟠 CRÍTICO
Submódulo: Evaluaciones SST (RE-28)
Categoría: Permisos / Privacidad
Título: Los datos de salud del RE-28 los ven supervisores y jefes de terreno, en pantalla, impresión y PDF, sin auditoría de acceso
Archivo(s): lib/sst/definitions/identificacion-sensibles-sections.ts; modules/sst/manifest.ts; app/(print)/sst/[id]/print/page.tsx; app/(app)/prevencion/[id]/page.tsx
Línea(s): identificacion-sensibles-sections.ts:36-42 ("No lleva requiresPermission… la protección efectiva está en el archivo"); manifest.ts:52-53 (sst:view a jefe_terreno y supervisor_terreno); print/page.tsx:14 y pdf/route.ts:27 (sólo sst:view)
Pantalla/ruta: /prevencion/[id], /sst/[id]/print, /sst/[id]/print/pdf
Endpoint: GET de las tres rutas
Rol: supervisor_terreno, jefe_terreno (y cualquiera con sst:view en la faena)
Descripción: el RE-28 registra embarazo, enfermedad crónica, inmunocompromiso, discapacidad, fármacos. Sólo la copia archivada en la biblioteca se clasifica como sensible; la pantalla y el PDF bajo demanda no aplican ni permiso propio ni registro de acceso.
Evidencia: DEMOSTRADO (idor.mjs, B). Con el acta -RABw… (embarazo = Sí): sup y jt → pantalla 200 con "embarazada", impresión 200 con el texto, PDF 200 (85 521 bytes). prevention_sensitive_access_audit: 0 filas nuevas. otrafaena/cphs/ti bloqueados (correcto).
Cómo reproducir:
1. Cerrar un RE-28 con "Sí" en alguna categoría.
2. Abrir /prevencion/<id> o /sst/<id>/print/pdf con un supervisor de la faena.
Resultado actual: acceso completo y sin rastro.
Resultado esperado: sólo roles con necesidad de saber (p. ej. un permiso sst:sensitive:view) y registro de cada acceso, igual que la salud ocupacional.
Impacto: exposición de datos sensibles de salud (Ley 19.628/21.719) a jefaturas de terreno.
Causa probable: se reutilizó `sst:view`, pensado para firmar el acta de ingreso.
Solución recomendada: permiso específico para `identificacion_sensibles` en la página, la impresión y el PDF, y registro en prevention_sensitive_access_audit; ocultar el RE-28 en la lista a quien no lo tenga.
Esfuerzo: Medio
Bloquea producción: No (Sí si la organización ya declaró el RE-28 como dato sensible)
Clasificación: A
```

```
ID: EVA-04
Severidad: 🟡 IMPORTANTE
Submódulo: Evaluaciones SST
Categoría: Funcionalidad / Navegación
Título: Las actas cerradas no se pueden abrir desde la interfaz; la ficha dice "Sin evaluación iniciada"
Archivo(s): app/(app)/prevencion/trabajador/[workerId]/visit-context.ts; .../page.tsx; app/(app)/prevencion/evaluation-list.tsx
Línea(s): visit-context.ts:14-36 (sólo visitas con borrador); page.tsx (currentVisitEvaluations); evaluation-list.tsx:63 (la fila lleva a la ficha)
Pantalla/ruta: /prevencion/evaluaciones → /prevencion/trabajador/[workerId]
Endpoint: —
Rol: todos
Descripción: la lista muestra "Cerrado · HABILITADO AUTÓNOMO"; al hacer clic la ficha pinta tres tarjetas vacías y ofrece "+ Iniciar Evaluación". El historial del trabajador no existe en la UI.
Evidencia: DEMOSTRADO (shots.mjs, capturas shot-B-prev-_prevencion_evaluaciones-1440.png y …_trabajador_VoRAccr…-1440.png).
Cómo reproducir: 1. Cerrar un acta. 2. Abrir la lista y hacer clic en el trabajador. 3. No hay forma de llegar al acta.
Resultado actual: el registro legal sólo se alcanza por URL directa.
Resultado esperado: historial de actas por trabajador con enlace al detalle y al PDF.
Impacto: no se puede consultar ni reimprimir el acta; induce a crear otra (EVA-05).
Causa probable: la ficha se rediseñó por "visita en curso" y se perdió el historial.
Solución recomendada: sección "Historial" en la ficha con todas las actas del alcance (listWorkerEvaluations ya las trae).
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A
```

```
ID: EVA-05
Severidad: 🟡 IMPORTANTE
Submódulo: Evaluaciones SST
Categoría: Integridad / Integración PDTP
Título: Una segunda acta para el mismo trabajador duplica la acreditación de N°18, 23 y 63
Archivo(s): lib/services/pdtp-adapters/worker-onboarding-connector.ts; lib/services/pdtp/compliance.ts; lib/services/sst-module/evaluations.ts
Línea(s): worker-onboarding-connector.ts:196-213 (sourceId por acta, no por persona); compliance.ts:1149-1178 (cobertura suma cantidades aprobadas contra el padrón)
Pantalla/ruta: /prevencion/trabajador/[workerId] → Iniciar evaluación
Endpoint: createEvaluationAction / closeEvaluationAction
Rol: prevencionista
Descripción: nada impide una segunda acta de ingreso para quien ya tiene una cerrada; cada una acredita 1 unidad. La cobertura es todo-o-nada por cantidad, así que dos actas de una persona pueden completar un padrón de dos.
Evidencia: DEMOSTRADO (B) — acta Z8Knpy… de prev2 para QA_EVA Trabajador Uno: dos ejecuciones N°18, dos N°23 y dos N°63 para el mismo workerId. Efecto en el indicador: CÓDIGO (compliance.ts:1149-1178).
Cómo reproducir: 1. Cerrar un acta. 2. Desde la ficha, "Iniciar Evaluación" y cerrar otra. 3. Ver pdtp_executions por workerId.
Resultado actual: doble registro.
Resultado esperado: una habilitación vigente por persona y episodio de ingreso (o advertencia y no acreditar de nuevo).
Impacto: cobertura inflable de las actividades de ingreso.
Causa probable: idempotencia por acta, no por sujeto.
Solución recomendada: sourceId por episodio de ingreso del trabajador (como la obligación) o advertir antes de crear.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: EVA-06
Severidad: 🟡 IMPORTANTE
Submódulo: Evaluaciones SST
Categoría: Validación / Integración (PRV-03 en la vía de integración)
Título: El servidor acepta actas con fecha futura y deja ejecuciones PDTP y obligaciones "reportadas" en semanas que no ocurrieron
Archivo(s): lib/validation/sst.ts; app/(app)/prevencion/actions/evaluations.ts
Línea(s): validation/sst.ts:269; actions/evaluations.ts:29-84 (sin tope); nueva-evaluacion-form.tsx (sólo `max={today}` en el cliente)
Pantalla/ruta: /prevencion/nueva
Endpoint: createEvaluationAction
Rol: evaluador
Descripción: el tope de fecha es sólo del DatePicker.
Evidencia: DEMOSTRADO (g7-future.mjs, B): request alterada con fechaEvaluacion=2026-12-15 → acta Kfi59… creada y cerrada; ejecuciones N°15/18/23/52/63 en mes 12 semana 3; obligaciones N°15/52 "reported" el 15-12. Aprobarlas: "No se puede aprobar una ejecución de una semana que aún no ocurre" (la guarda de PRV-03 sí rige en la aprobación).
Cómo reproducir: enviar createEvaluationAction con una fecha futura (o un reloj de cliente adelantado) y cerrar.
Resultado actual: registro legal con fecha imposible y obligación dada por reportada.
Resultado esperado: rechazo en el servidor (fecha ≤ hoy en Chile, formato YYYY-MM-DD).
Impacto: bajo en el indicador (la aprobación se bloquea) pero la obligación deja de verse pendiente y el acta queda con fecha falsa.
Solución recomendada: `z.string().regex(ISO)` + refine `<= todayInChile()` en el esquema.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: EVA-07
Severidad: 🟡 IMPORTANTE
Submódulo: Evaluaciones SST
Categoría: Integración PDTP / Revocación
Título: Un acta cerrada no se puede anular ni corregir, y sus acreditaciones no tienen revocación
Archivo(s): lib/services/sst-module/evaluations.ts
Línea(s): 364-366 ("Usa un flujo de anulación auditada", que no existe); 341-352 (revocación sólo al borrar un borrador)
Pantalla/ruta: /prevencion/[id]
Endpoint: deleteEvaluationAction
Rol: prevencionista
Descripción: un acta cerrada por error (trabajador equivocado, fecha futura de EVA-06, duplicada de EVA-05) queda "habilitado autónomo" para siempre; la única vía es rechazar una a una las ejecuciones en Aprobaciones, y las ya aprobadas no se revierten.
Evidencia: CÓDIGO (líneas citadas) + PGlite `sst-delete-evaluation.test.ts` (rechaza borrar cerradas) + UI sin botón de anular.
Resultado esperado: anulación con motivo, segunda persona y revocación de lo acreditado (recordPdtpFulfillmentRevocation ya existe).
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: EVA-08
Severidad: 🟡 IMPORTANTE
Submódulo: Evaluaciones SST
Categoría: Trazabilidad / Modelo de datos
Título: El cierre del acta no registra quién ni cuándo; el borrado de borradores no se audita y deja visitas huérfanas
Archivo(s): db/schema/sst.ts; lib/services/sst-module/evaluations.ts
Línea(s): sst.ts:37-66 (sin closed_at/closed_by); sst.ts:9-24 (visitas con closed/reopened que nadie escribe); evaluations.ts:285 (sólo updatedAt); 397-399 (delete sin audit)
Descripción: el acta guarda `createdBy`, pero no quién la cerró; la pantalla muestra "Rol: Prevencionista de faena" aunque la creó un prevencionista global.
Evidencia: DEMOSTRADO/SQL — tras cerrar, la visita sigue "borrador"; tras borrar xtpwgcx…, visita 0B67bTM… queda con 0 evaluaciones; audit_log 0 filas.
Solución recomendada: closed_at/closed_by_user_id (migración nueva), cerrar la visita, audit_log en cierre y borrado.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: EVA-09
Severidad: 🟡 IMPORTANTE
Submódulo: Evaluaciones SST
Categoría: Reglas de negocio / Integración PDTP
Título: La N°52 se da por cumplida sin el acompañamiento del conductor líder ni la firma del supervisor
Archivo(s): lib/services/sst-module/evaluations.ts; lib/sst/definitions/trabajador-nuevo.ts
Línea(s): evaluations.ts:289-318 (acredita con el acta del prevencionista); trabajador-nuevo.ts:23-31 (firmas supervisor y prevencionista, sólo impresas)
Descripción: la N°52 incluye "inducción operacional terreno"; el acta de ingreso la acredita al cerrarse aunque la participación del conductor (Punto 3, 4 semanas) esté en borrador y sin participación del admin. de contrato.
Evidencia: DEMOSTRADO (B) — acta pSzm… cerrada "habilitado_autonomo" con la del conductor IiDp… en borrador (semanas 1–4 pendientes) → obligación N°52 "reported".
Resultado esperado: definir con Prevención si la N°52 exige el acompañamiento completo y las firmas; si sí, acreditar cuando todas las participaciones de la visita estén cerradas.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B (decisión de negocio)
```

```
ID: EVA-10
Severidad: 🟡 IMPORTANTE
Submódulo: Evaluaciones SST
Categoría: Evidencia (PRV-01 residual) / UX del aprobador
Título: Un rótulo de texto cuenta como "evidencia entregada" en N°15/52, y el aprobador no puede abrir el acta
Archivo(s): lib/services/pdtp/obligations.ts; lib/services/pdtp/evidence-href.ts; worker-onboarding-connector.ts
Línea(s): obligations.ts:271 y 326 (hasEvidence = evidenceText no vacío → "provided"); worker-onboarding-connector.ts:222 (evidenceText "Acta de trabajador nuevo cerrada: <id>"); evidence-href.ts:1-14 (chip sin enlace)
Descripción: la N°52 de prev2 se aprobó sin diálogo de motivo porque su evidencia figura "provided"; el chip "Acta de trabajador nuevo cerrada" no enlaza al acta ni dice de qué trabajador (C-03 quitó el id).
Evidencia: DEMOSTRADO (g4-approve.mjs; captura g4-row-18-prev.png).
Solución recomendada: `evidenceStatus` = "pending" para texto de integración, `returnHref` al acta /prevencion/<id> y nombre del trabajador en el rótulo.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: EVA-11
Severidad: 🟡 IMPORTANTE
Submódulo: Evaluaciones SST (RE-28, N°17)
Categoría: UI/UX / Formularios
Título: El RE-28 aparece como un segundo "Control de seguimiento", pide un motivo de seguimiento y sólo admite cargos de conductor
Archivo(s): app/(app)/prevencion/nueva/nueva-evaluacion-form.types.ts; lib/sst/definitions/identificacion-sensibles.ts; lib/sst/cargos.ts; lib/sst/badges.ts
Línea(s): types.ts:45-48; identificacion-sensibles.ts:33 (tipo 'seguimiento'); cargos.ts:1-5
Evidencia: DEMOSTRADO — opciones del selector ["Trabajador nuevo","Control de seguimiento","Control de seguimiento"]; el auditor creó por error un seguimiento; el RE-28 guardó motivo "control_periodico"; el resultado se muestra "HABILITADO AUTÓNOMO". El diálogo de la ficha no ofrece el RE-28.
Solución recomendada: rótulo propio ("RE-28: personas especialmente sensibles"), sin motivo, cargos de toda la dotación y etiquetas de resultado de su `closingAct`.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

**Mejoras (🔵) y cosméticos (⚪)**

| ID | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|
| EVA-M01 🔵 | `saveResponses` acepta ítems inexistentes y secciones de otro rol en actas ajenas (conductor escribió su Punto 3 en el acta del prevencionista) | `sst-module/responses.ts:10-35` | DEMOSTRADO (g5) | Validar seccion/ítem contra la definición y el rol del acta | B |
| EVA-M02 🔵 | Marcar semana completada no exige respuestas ni rol conductor | `sst-module/weekly.ts:13-26` | CÓDIGO | Exigir ítems de la semana respondidos | B |
| EVA-M03 🔵 | "Nota requerida: este ítem no quedó conforme" al responder "No" a "¿Daño a personas?" (sección no puntuable del seguimiento) | `checklist-section-item.tsx:78`; `trabajador-antiguo-sections.ts:10` | DEMOSTRADO (probe) | No pedir observación en secciones `countsForCompliance:false` | B |
| EVA-M04 🔵 | `/prevencion/nueva` redirige a `/prevencion` (no a `/forbidden`) sin mensaje | `nueva/page.tsx:21-22` | DEMOSTRADO (survey) | `/forbidden` | B |
| EVA-M05 🔵 | `prevencionista_faena` no puede registrar seguimientos D0/7/15/30 ni plan de acción (`sst:manage`) | `modules/sst/manifest.ts:39-46`; `actions/followups.ts:19` | CÓDIGO | Otorgar gestión acotada por faena | B |
| EVA-M06 🔵 | Sin filtros en la lista (faena/estado/fecha), página fija de 50 | `evaluations-page.tsx:141` | DEMOSTRADO | Filtros + paginación | M |
| EVA-M07 🔵 | Copia del acta a la biblioteca es best-effort sin reintento (en B falla por Cloudreve) | `evaluation-archive.ts:50-172` | DEMOSTRADO (log) | Cola reprocesable | M |
| EVA-M08 🔵 | `admin_contrato` en B sin `sst:close` (manifiesto lo otorga) | SQL B vs `manifest.ts:47` | SQL | Reaplicar grants en el despliegue | B |
| EVA-M09 ⚪ | Comentario del manifiesto dice que el acta acredita la N°19 | `modules/sst/manifest.ts:41-45` | CÓDIGO | Actualizar | B |
| EVA-M10 ⚪ | `EvaluationList` ignora `canDelete` | `evaluation-list.tsx:28` | CÓDIGO | Quitar prop | B |

### I. Readiness individual: **61/100** — No listo (60–69)
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 16 | EVA-04 −3, EVA-07 −2, EVA-09 −1,5, EVA-06 −1, EVA-05 −1, EVA-11 −0,5 |
| UI/UX | 20 | 14 | EVA-04 −2, EVA-11 −1,5, EVA-01 (toast/beforeunload) −1, EVA-34 −1, EVA-10 −0,5 |
| Integridad de datos | 15 | 8 | EVA-01 −4, EVA-05 −1, EVA-08 −1,5, EVA-06 −0,5 |
| Integración con Programa Anual | 15 | 8 | EVA-02 −3, EVA-10 −1,5, EVA-09 −1, EVA-07 −1, EVA-05 −0,5 |
| Código y mantenibilidad | 10 | 6 | EVA-01 −2, EVA-M01 −1, EVA-08 −0,5, EVA-M09/M10 −0,5 |
| Permisos y seguridad | 5 | 2,5 | EVA-03 −2, EVA-M01 −0,5 |
| Testing | 5 | 2,5 | sin E2E del flujo ni del autoguardado; `sst-pdf` acepta 200 sin sesión −2,5 |
| Manejo de errores | 5 | 4 | toast falso tras cerrar (EVA-01) −0,5; EVA-M07 −0,5 |
| **Total** | 100 | **61** | |

### Estado de hallazgos previos en este alcance
- **PRV-02 (segregación en integración)** → **Parcial**: corregido para N°15/52 (obligación; demostrado), **abierto** para N°18/23/63/17 (EVA-02, demostrado).
- **PRV-03 (fechas futuras)** → **Parcial**: la aprobación se bloquea (demostrado); el acta y la obligación aceptan fecha futura (EVA-06).
- **PRV-01 (evidencia de integración)** → **Parcial** en este conector: sin auto-aprobación (correcto), pero un rótulo cuenta como `provided` en N°15/52 (EVA-10).
- **C-03** (ids en Aprobaciones) → **Corregido** el rótulo; queda sin enlace ni identificación del trabajador (EVA-10).
- Matriz §8 de la auditoría previa ("Evaluación SST · 15,17,18,23,52,63 · 2.ª aprobación Sí") → **verificada** salvo la segregación.

### Qué no se pudo verificar y por qué
- Copia sensible del RE-28 en la biblioteca documental y su auditoría: en B falla "Cloudreve no está configurado".
- Flujo completo de `admin_contrato` (en B no tiene `sst:close`) y cierre de la participación del conductor (no se cerró para no consumir las semanas).
- Cron `sst-weekly-alerts` y notificaciones.
- Efecto numérico de EVA-05 en el % del tablero (no se aprobaron los duplicados).

---

## AUDITORÍA — PPA (Para, Piensa y Actúa)

**Rutas:** `/ppa` (público, sin sesión, PWA offline), `/ppa/result/[token]`, `/prevencion/ppa` (bandeja con búsqueda propia), `/prevencion/ppa/[id]`, `GET /api/prevencion/ppa/export`.
**Archivos:** `app/(public)/ppa/**`, `app/(app)/prevencion/ppa/**`, `lib/services/ppa-module/**`, `lib/validation/ppa.ts`, `lib/ppa/**`, `lib/pwa/hooks.ts`, `lib/pwa/offline-queue.ts`, `lib/services/prevention-capa.ts`.
**Permisos (`modules/ppa/manifest.ts:103-135`):** prevencionista y administrador todo; jefa_chome sin `ppa:correct` ni `ppa:manage` (no exporta); prevencionista_faena y admin_contrato `view/review/correct`; supervisor/jefe de terreno sin acceso.

### A. UI/UX/Diseño
- **Público a 390 px** (`ppa-pubDet-1…3.png`, `-result.png`): tres pasos con barra de progreso, botones Sí/No grandes, confirmación explícita cuando el PPA detendrá el trabajo, resultado "DETENGA EL TRABAJO" muy claro. 0 desborde, 0 errores de consola. La página de resultado no tiene `h1`.
- Al pasar del paso 2 al 3 aparece siempre un toast rojo "Faltan respuestas obligatorias." que llega hasta la pantalla de resultado (EVA-24).
- Tras sincronizar un PPA offline, la pantalla sigue diciendo "Se enviará ahora automáticamente" (no confirma ni avisa fallos) (EVA-20).
- **Bandeja** (`shot-B-prev-_prevencion_ppa-1440.png`): acciones de página en el header (QR/Enlace, Exportar Excel), 3 KPI (no accionables, `ppa-metric-bar.tsx` sin enlaces), pestañas por estado con contadores, 4 filtros (búsqueda propia, faena, desde, hasta). Correcto frente a A1/A2/A5 salvo KPI no clicables.
- **Detalle**: respuestas legibles, texto malicioso mostrado como texto, panel de revisión y "Siguiente control" claros. La evidencia de la corrección dice en pantalla "Este formulario todavía no sube archivos…" (EVA-23).
- **Estados observados:** con información, detenido, aprobado auto, en corrección, pendiente de verificación, autorizado, cerrado, 404 fuera de alcance (`otrafaena`), `/forbidden` (sup/jt/cphs/legal/ti), error de validación (documento rechazado), offline guardado.

### Facilidad de uso
| Tarea | Clics | Resultado |
|---|---:|---|
| Enviar PPA detenido desde el teléfono (RUT) | 12 + escribir RUT y peligro | ✅ con toast falso (EVA-24) |
| Enviar PPA sin detención | 11 | ✅ |
| Revisar → corregir → verificar → autorizar → cerrar | 5 pantallas | ✅, pero lo hizo una sola persona (EVA-22) |
| Exportar con rango de fechas | 4 | 🔴 descarga `export.json` (EVA-21) |

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Identificación por RUT (DV, respuesta uniforme, nombre enmascarado) | ✅ | "Verificado: QA_EVA T." |
| Enlace firmado por faena + identificación manual | ✅ | `pubManual` |
| Enlace general + identificación manual | 🟡 | rechazado por diseño (`evaluaciones.ts:107-120`, "QUEDA POR DECIDIR") |
| Offline con enlace firmado | ✅ | `synced` |
| Offline con enlace general | 🔴 | EVA-20 |
| Evaluación automática y notificación a revisores | ✅ | estado `detenido`, motivos |
| Revisión / CAPA / declarar / verificar / autorizar / cerrar | ✅ funcional, 🟡 segregación | EVA-22 |
| Evidencia de la corrección | 🟡 | sólo URL (EVA-23) |
| Revocar enlace público | ✅ (código + prueba `ppa-token-revocation`) | no ejecutado en navegador |
| Exportar Excel sin filtros / con faena | ✅ | 200, fórmulas neutralizadas (`'=HYPERLINK`) |
| Exportar con fechas | 🔴 | EVA-21 |
| Búsqueda y filtros de la bandeja | ✅ | URL con `returnTo` validado (`list-filters.ts:57-61`) |

### C. Código y lógica
- `ppa-form.tsx:187`: el mismo botón cambia de `type="button"` a `type="submit"` en el clic que avanza al paso 3 (EVA-24).
- `offline-saved.tsx` sólo cuenta `pending` (`offline-queue.ts:197-206`); los `failed` no se muestran (la TAE sí lo hace, `tae-form.tsx`) (EVA-20).
- `ppaExportFiltersSchema` exige `YYYY-MM-DD` (`validation/ppa.ts:196-202`) y `ppa-export-button.tsx:39` activa `isoDateISOFormat` (`export-dialog.tsx:89-95`): contratos incompatibles (EVA-21). Con fecha simple, `lte(created_at,'YYYY-MM-DD')` excluye el día final (`calculos.ts:34`).
- Exportación: "Fecha" es la llegada al servidor (no `filledAt`) y estados CAPA en crudo (`reportes.ts:463-486`) (EVA-M24).
- Sin `dangerouslySetInnerHTML`; XSS almacenado no ejecuta (demostrado).

### D. Modelo de datos
- `ppa_submissions` con CHECK de estado y de pares actor/fecha para cada transición, `version`, `client_submission_id` único (idempotencia offline), historial `ppa_status_history` con actor. Sólido.
- Dato legado en B: PPA de julio guardado con nombre enmascarado "Maria Jose M.", `manual_identificacion=t` y sin `worker_id` (EVA-M22).
- La CAPA del PPA queda `verified` cuando el PPA pasa a `cerrado` (no se cierra la CAPA).

### E. Permisos y seguridad
- XSS: payload `<img onerror>`/`<script>` en peligro y nombre → texto plano en detalle interno y resultado público (`window.__xss` = null) ✅.
- IDOR: `otrafaena` → 404 en el PPA de Horcones ✅; exportación: prevfaena/jefa/ti 403, anónimo 307 ✅; inyección de fórmulas neutralizada ✅.
- Cuotas por IP (30/5 min) e identidad; no se probó con carga para no bloquear la IP compartida.
- TEÓRICO: el enlace firmado por faena es un HMAC perpetuo (sólo se invalida rotando `AUTH_SECRET`); `findWorkerByRutAction` devuelve el `workerId` a quien conozca un RUT, que basta para firmar un PPA a nombre de esa persona; `/ppa` publica todas las faenas activas y los permisos de trabajo vigentes (código y tarea) (EVA-M23).
- Segregación ausente en el flujo de corrección (EVA-22).

### F. Testing
- Corridas: `ppa-actions`, `ppa-service`, `ppa-stats`, `ppa-public-token`, `ppa-token-revocation`, `ppa-list-filters`, `prevencion-ppa-admin`, `lib/ppa/**`, `ppa-workflow-panel.test.tsx` y PGlite `prevention-ppa-workflow-persistence` → verdes.
- Brechas: no hay prueba de la ruta de exportación ni del contrato con `ExportDialog`; `ppa-offline.spec.ts` no cubre el rechazo permanente de un encolado ni su visibilidad; ninguna prueba detecta el toast del paso 3.

### G. Integración con el Programa Anual
- El programa 2026 v2 real de B **no tiene ninguna actividad sobre PPA/"Piensa y Actúa"** (consulta `activity ILIKE '%piensa%'|'%PPA%'` = 0 filas). Coincide con el mapa (`MAPA_MODULOS…:54`: "sin actividad PDTP directa").
- Relación indirecta: el PPA detenido genera una CAPA con `sourceType='ppa'` (demostrado: `CAPA-2026-LOCBIGJUPZ`), y el acta de trabajador nuevo tiene el ítem "Programa Piensa y Actúa" (`trabajador-nuevo-sections.ts:32`) que no acredita nada.
- **Juicio:** no debe acreditar mientras el programa no lo declare. Lo que sí falta es trazabilidad: la CAPA del PPA no llega a "Medidas" del PDTP ni a la vista de CAPA como acción cerrable, y el PPA cerrado deja la CAPA en `verified`. Se puntúa la calidad de esa relación indirecta.

### H. Hallazgos

```
ID: EVA-20
Severidad: 🟠 CRÍTICO
Submódulo: PPA público
Categoría: Integridad de datos / Offline
Título: Un PPA guardado sin conexión desde el enlace general se rechaza al sincronizar y se pierde en silencio
Archivo(s): lib/services/ppa-module/evaluaciones.ts; lib/pwa/hooks.ts; app/(public)/ppa/offline-saved.tsx; lib/pwa/offline-queue.ts
Línea(s): evaluaciones.ts:115-120 (rechazo sin enlace acreditado ni workerId); hooks.ts:97-101 (failed permanente); offline-queue.ts:197-206 (la UI sólo cuenta pending)
Pantalla/ruta: /ppa (QR "General (se identifica por RUT)" del panel)
Endpoint: submitPpaAction
Rol: trabajador sin sesión
Descripción: sin red no se puede verificar el RUT, así que la única vía es la identificación manual; con el enlace general esa vía no acredita la faena. El PPA se encola ("PPA guardado offline… Se enviará cuando vuelva la conexión"), al volver la red el servidor lo rechaza, queda failed y la pantalla sigue diciendo "Se enviará ahora automáticamente".
Evidencia: DEMOSTRADO (ppa-offline.mjs, B, 390 px, Service Worker registrado): PPA detenido (peligro + "no es seguro") → cola ppa-offline: status=failed, attempts=3, lastError="Este enlace no acredita la faena…"; sin aviso en pantalla. Con el enlace firmado de Horcones el mismo caso quedó synced.
Cómo reproducir:
1. Abrir /ppa con el enlace general, quitar la red.
2. "No estoy en la lista", elegir faena y completar un PPA que detenga el trabajo; "Guardar offline".
3. Volver la red: el PPA nunca llega y nadie se entera.
Resultado actual: pérdida silenciosa de un registro de detención de trabajo; los revisores no reciben la alerta.
Resultado esperado: impedir el guardado offline cuando la faena no está acreditada (o permitir acreditarla sin red), y mostrar los rechazados con su motivo.
Impacto: el PPA existe para detener trabajos inseguros; "funciona sin conexión" es su promesa en la portada.
Solución recomendada: bloquear "Guardar offline" sin token de faena ni workerId verificado, listar los failed con reintento/corrección, y no ofrecer el QR general en terreno.
Esfuerzo: Bajo–Medio
Bloquea producción: No (Sí si se reparte el QR general en faenas sin señal)
Clasificación: A
```

```
ID: EVA-21
Severidad: 🟡 IMPORTANTE
Submódulo: PPA interno
Categoría: Funcionalidad / Exportación
Título: Exportar PPA con rango de fechas descarga un "export.json" con error 400; con fechas simples se pierde el último día
Archivo(s): app/(app)/prevencion/ppa/ppa-export-button.tsx; components/export-dialog.tsx; lib/validation/ppa.ts; lib/services/ppa-module/calculos.ts
Línea(s): ppa-export-button.tsx:39 (isoDateISOFormat); export-dialog.tsx:89-95; validation/ppa.ts:199-200; calculos.ts:33-34
Endpoint: GET /api/prevencion/ppa/export
Rol: prevencionista, administrador
Evidencia: DEMOSTRADO — ppa-export-ui.mjs: href del botón `…?dateFrom=2026-09-01T04%3A00%3A00.000Z` → 400 {"error":"Filtros inválidos"} y el navegador guarda "export.json". ppa-export.mjs: `dateFrom=dateTo=2026-09-29` → Excel sin ninguno de los 3 PPA creados ese día.
Resultado esperado: Excel filtrado incluyendo el día final.
Impacto: el reporte que se entrega a un fiscalizador sale roto o incompleto sin aviso.
Solución recomendada: aceptar ambos formatos o quitar isoDateISOFormat, y comparar `< dateTo + 1 día` en hora de Chile; prueba de la ruta.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A
```

```
ID: EVA-22
Severidad: 🟡 IMPORTANTE
Submódulo: PPA interno
Categoría: Permisos / Segregación
Título: Una misma prevencionista revisa, declara la corrección, la verifica, autoriza el reinicio y cierra el caso
Archivo(s): lib/services/prevention-capa.ts; modules/ppa/manifest.ts; app/(app)/prevencion/ppa/[id]/ppa-workflow-panel.tsx
Línea(s): prevention-capa.ts:293-313 (la SoD de CAPA se exime a sourceType 'ppa'); manifest.ts:112-119 (prevencionista tiene todos los permisos); ppa-workflow-panel.tsx (texto "El reinicio requiere evidencia, verificación independiente y autorización expresa")
Pantalla/ruta: /prevencion/ppa/[id]
Rol: prevencionista, administrador
Evidencia: DEMOSTRADO (ppa-step.mjs, B, PPA C8Z8…): reviewed_by = correction_declared_by = verified_by = authorized_by = closed_by = qa-prev; única evidencia: https://example.invalid/qa_eva_foto_barrera.jpg.
Resultado esperado: quien declara la corrección no la verifica, y quien verifica no autoriza (o excepción con motivo, como en CAPA).
Impacto: la reanudación de un trabajo detenido queda validada por una sola persona con un enlace cualquiera.
Causa probable: decisión documentada de "segregación por permiso", que no separa nada cuando un rol tiene todos los permisos.
Solución recomendada: aplicar la regla de identidad de CAPA también al PPA, con excepción motivada para faenas de una sola persona.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B (decisión de negocio)
```

```
ID: EVA-23
Severidad: 🟡 IMPORTANTE
Submódulo: PPA interno
Categoría: Funcionalidad / Evidencia
Título: La evidencia de la corrección sólo admite una URL; "Documento" y "Fotografía" se rechazan con un mensaje de rutas internas
Archivo(s): app/(app)/prevencion/ppa/[id]/ppa-workflow-panel.tsx; lib/services/prevention-capa.ts
Línea(s): ppa-workflow-panel.tsx:196-205 ("Este formulario todavía no sube archivos…"); prevention-capa.ts:782-811
Evidencia: DEMOSTRADO — URL aceptada sin verificación; documento → "La ruta de evidencia debe apuntar a storage/inspection-evidence/ o storage/pdtp-evidence/ o …".
Resultado esperado: subir foto/PDF (el resto de Prevención ya lo hace con MIME, sha256 y dueño).
Solución recomendada: reutilizar la subida de evidencia CAPA (`capa-evidence`) en este panel.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: EVA-24
Severidad: 🟡 IMPORTANTE
Submódulo: PPA público
Categoría: UI/UX
Título: En cada envío aparece "Faltan respuestas obligatorias" al llegar al último paso
Archivo(s): app/(public)/ppa/ppa-form.tsx; app/(public)/ppa/ppa-form.hooks.ts
Línea(s): ppa-form.tsx:187 (Continuar → Enviar en el mismo nodo); ppa-form.hooks.ts:219-224
Evidencia: DEMOSTRADO (ppa-public.mjs, registro de toasts por clic): el toast aparece tras el clic 9 ("Continuar" del paso 2), antes de responder "¿Es seguro comenzar?", y sigue visible en la pantalla de resultado (captura ppa-pubDet-result.png).
Impacto: el trabajador ve un error rojo en un envío correcto; resta confianza en el aviso de verdad.
Solución recomendada: `key` distinta por botón o `type="button"` + `requestSubmit()` explícito; prueba E2E que falle con cualquier toast de error en el camino feliz.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

| ID | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|
| EVA-M21 🔵 | KPI de la bandeja no accionables (A1) | `ppa-metric-bar.tsx` | CÓDIGO/captura | Enlazar a pestaña | B |
| EVA-M22 🔵 | PPA legado con nombre enmascarado ("Maria Jose M.") | BD B, julio 2026 | SQL | Script de saneamiento | B |
| EVA-M23 🔵 | Enlace de faena perpetuo; workerId expuesto por RUT; faenas y permisos vigentes públicos | `worksite-access-token.ts:43-60`; `(public)/ppa/actions.ts:152-163`; `evaluaciones.ts:332-360` | TEÓRICO | Token con vigencia/revocable, no devolver id | M |
| EVA-M24 🔵 | Export: "Fecha" = llegada (no `filledAt`), estados CAPA en crudo | `reportes.ts:463-486` | DEMOSTRADO (xlsx) | Agregar fecha de llenado y etiquetas | B |
| EVA-M25 ⚪ | Resultado público sin `h1`; PPA cerrado deja CAPA en `verified` | `(public)/ppa/result/[token]/page.tsx` | DEMOSTRADO | h1 y cerrar CAPA | B |

### I. Readiness individual: **69/100** — No listo (límite superior)
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 16 | EVA-20 −4, EVA-21 −2,5, EVA-23 −2, EVA-24 −0,5 |
| UI/UX | 20 | 15 | EVA-24 −1,5, EVA-20 (sin aviso) −1,5, EVA-23 (mensaje técnico) −1, EVA-M21 −0,5, EVA-M25 −0,5 |
| Integridad de datos | 15 | 9,5 | EVA-20 −4, EVA-21 (día excluido) −1, EVA-M22 −0,5 |
| Integración con Programa Anual | 15 | 11 | relación indirecta sólo vía CAPA sin vista en PDTP −2, CAPA queda `verified` −1, sin trazabilidad al ítem "Piensa y Actúa" del acta −1 |
| Código y mantenibilidad | 10 | 8 | contrato export roto (EVA-21) −1, placeholder de subida (EVA-23) −0,5, cola PPA sin surfacing a diferencia de TAE −0,5 |
| Permisos y seguridad | 5 | 3 | EVA-22 −1,5, EVA-M23 −0,5 |
| Testing | 5 | 3 | sin prueba de la ruta de exportación ni del rechazo offline −2 |
| Manejo de errores | 5 | 3,5 | failed silencioso −1, descarga JSON en vez de error −0,5 |
| **Total** | 100 | **69** | |

### Estado de hallazgos previos en este alcance
- PPA-001/PPA-002 (auditoría del 14-09, citadas en código) → **Corregidos (verificado)**: el enlace sin token no acredita faena y la búsqueda por RUT responde uniforme y consume cuota antes de buscar.
- PPAI-002/003 → **Corregidos (verificado)**: rechazar exige motivo; declarar exige texto.
- La auditoría del 28-09 no tenía hallazgos PPA propios.

### Qué no se pudo verificar y por qué
- Límites de cuota por IP/identidad bajo carga (la IP es compartida con los demás agentes).
- Notificación a revisores tras un PPA detenido (no se revisó la bandeja de notificaciones de cada rol).
- WebKit/Safari real (la PWA se usa en iPhone); sólo Chromium con emulación móvil.
- Revocación del enlace público en navegador (sí en pruebas unitarias).

---

## AUDITORÍA — Inicio de Prevención y menú lateral

**Rutas:** `/prevencion` (`page.tsx`, `prevention-home.tsx`, `lib/services/prevention-attention.ts`); menú de `modules/prevention/manifest.ts`, `sst`, `ppa`; `components/layout/nav-items.ts`.

### A. UI/UX/Diseño
- `DashboardGrid` con "Atención requerida" (principal) y "Módulos disponibles" (lateral) — este último repite el menú.
- **Test de los 5 segundos: no lo pasa para el programa.** En B, para `prev`, Inicio muestra 5 avisos (PPA detenido, evaluación pendiente, una medida, dos inspecciones). El tablero PDTP del mismo usuario muestra **38 ejecuciones por aprobar**, **576 programadas sin ejecutar este mes · 28 actividades en cero** y Obligaciones muestra **13 pendientes / 15 por aprobar**. Nada de eso aparece en Inicio (EVA-30). Para `prevfaena`, `sup`, `jt`, `cphs`, `legal` de B, Inicio dice "No hay pendientes…".
- "Evaluación SST pendiente · Conductor líder" no dice de qué trabajador; "PPA detenido" sí.
- Carga: título "Evaluaciones SST" durante el streaming (EVA-33).
- Responsive 1440/1024/768/390: sin desborde, un `h1`, 0 errores (capturas `shot-B-prev-_prevencion-*.png`).

### Facilidad de uso
- Inicio no tiene entrada en el menú; se llega desde el acceso rápido del dashboard (`dashboard/quick-actions.tsx:50`) o por breadcrumbs. Estando en `/prevencion`, el área Prevención del menú aparece **colapsada** y sin ítem activo (EVA-34).

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Avisos por permiso y alcance | ✅ | survey A/B por 10 roles: cada rol ve sólo lo suyo; `otrafaena` sólo su comité |
| Reparto por tipo (round-robin) | ✅ | prueba `prevention-attention-calc` |
| Estado del programa (atrasadas, por aprobar, obligaciones, próximas) | ❌ | EVA-30 |
| Coincidencia de cifras con el tablero PDTP | ❌ (no hay cifras que comparar) | EVA-30 |
| Sin permisos → `/forbidden` | ✅ | `ti` |

### C/D. Código y modelo
- `prevention-attention.ts:95-140`: sólo lee CAPA PDTP, borradores SST, PPA detenido/en corrección, inspecciones, CPHS, protocolos y equipos de emergencia. No consulta `pdtp_executions` submitted, `pdtp_obligations` ni la planilla.
- PPA `pendiente_verificacion` no entra en Atención (`:121`) aunque el enlace del lateral "PPA por revisar" sí lo incluye (`prevention-home.tsx:21-22`, `calculos.ts:24-25`).

### E. Permisos, navegación por rol y paridad
Menú observado (`nav-A.json`, A):
- **admin** 40 enlaces · **prev** 37 (sin Datos personales) · **prevfaena** 35 (sin Aprobaciones ni Datos personales) · **jefa** 36 (sin Alcotest, Reportar incidente, Evaluaciones SST) · **sup** 19 · **jt** 29 · **cphs** 27 · **legal** 10 (sólo Programa de trabajo y sus hijos, Constancias) · **ti** sin área Prevención.
- Paridad ruta↔permiso↔menú: la prueba `nav-page-permission-parity` pasa y el recorrido lo confirma — lo que aparece abre y lo que no aparece da `/forbidden` (Evaluaciones: jefa/cphs/legal; PPA: sup/jt/cphs/legal). Excepción: `/prevencion/nueva` redirige a Inicio en vez de `/forbidden` (EVA-M04).
- En B los roles tienen además grants de `bodega_dev`; no cambian el menú de Prevención salvo `admin_contrato` (EVA-M08).
- Ocultos: `/prevencion/campanas` sigue accesible por URL (histórico, `manifest.ts:464-467`), sin ítem propio, y deja activo "Evaluaciones SST" (EVA-34); `/prevencion/nueva`, `/prevencion/[id]` y `/trabajador/*` marcan "Evaluaciones SST" (correcto).
- Agrupación: "Programa", "Cumplimiento del programa", "En terreno" (Permisos, Higiene, Evaluaciones SST, PPA), "Seguimiento". Nombres claros; "Evaluaciones SST" cae en "En terreno" junto a PPA.

### F. Testing
`prevention-attention-calc`, `nav-page-permission-parity`, `admin-nav` → verdes. No hay prueba de que Inicio muestre el estado del programa ni de la ausencia de ítem activo.

### G. Integración con el Programa Anual
Inicio no acredita nada (correcto). Su rol es llevar a lo que el programa pide; hoy sólo lleva a las **medidas** (CAPA) del PDTP y omite ejecuciones por aprobar, obligaciones vencidas/por vencer y actividades atrasadas o próximas.

### H. Hallazgos

```
ID: EVA-30
Severidad: 🟡 IMPORTANTE
Submódulo: Inicio de Prevención
Categoría: UI/UX / Integración con el Programa Anual
Título: Inicio no muestra lo que el Programa Anual pide: ni ejecuciones por aprobar, ni obligaciones, ni actividades atrasadas o próximas
Archivo(s): lib/services/prevention-attention.ts; app/(app)/prevencion/prevention-home.tsx
Línea(s): prevention-attention.ts:95-140; prevention-home.tsx:41-55
Pantalla/ruta: /prevencion
Rol: prevencionista, prevencionista_faena, jefa
Evidencia: DEMOSTRADO (B, prev): Inicio 5 avisos, ninguno del programa; /prevencion/pdtp "38 ejecuciones por aprobar", "576 programadas sin ejecutar este mes · 28 actividades en cero"; /prevencion/pdtp/obligaciones "Pendientes 13 · Por aprobar 15".
Resultado esperado: primera fila de Inicio con por aprobar (quien tiene approve), obligaciones vencidas y por vencer, y actividades en cero o atrasadas de sus faenas, con enlace a la planilla filtrada.
Impacto: la pantalla de entrada del módulo no cumple el criterio rector.
Solución recomendada: sumar esas fuentes a getPreventionAttention (las consultas ya existen en el tablero PDTP) con el mismo reparto por tipo.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

| ID | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|
| EVA-33 🔵 | Esqueleto de carga con título "Evaluaciones SST" en `/prevencion` y en 5 rutas hijas sin `loading` propio (causa del "h1 que cambia") | `app/(app)/prevencion/loading.tsx:7-19` | DEMOSTRADO (survey) | Esqueleto neutro o "Inicio de Prevención" + `loading` propios | B |
| EVA-34 🔵 | Menú: Inicio sin entrada; área colapsada y sin activo en `/prevencion`; `/prevencion/campanas` marca "Evaluaciones SST"; breadcrumbs "Evaluaciones SST" → Inicio | `nav-items.ts:183-189`; `nueva/page.tsx:79`; `[id]/page.tsx:91`; `trabajador/[workerId]/page.tsx:113` | DEMOSTRADO (active.mjs) | Ítem "Inicio" en Prevención; restringir la regla especial a rutas SST; href `/prevencion/evaluaciones` | B |
| EVA-35 🔵 | Aviso "Evaluación SST pendiente" sin nombre del trabajador; PPA `pendiente_verificacion` no aparece | `prevention-attention.ts:114-121, 154-158` | DEMOSTRADO/CÓDIGO | Incluir nombre y el estado | B |
| EVA-36 ⚪ | "Módulos disponibles" duplica el menú (22 enlaces) | `prevention-home.tsx:83-105` | captura | Reducir a accesos por tarea | B |

### I. Readiness individual: **76/100** — Funcional, requiere correcciones
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 19 | EVA-30 −6 |
| UI/UX | 20 | 13 | EVA-30 −4, EVA-33 −1, EVA-34 −1, EVA-35 −0,5, EVA-36 −0,5 |
| Integridad de datos | 15 | 14 | EVA-35 (pendiente_verificacion) −1 |
| Integración con Programa Anual | 15 | 8 | EVA-30 −7 |
| Código y mantenibilidad | 10 | 9 | EVA-33 −1 |
| Permisos y seguridad | 5 | 5 | — |
| Testing | 5 | 3,5 | sin prueba de contenido de Inicio ni del estado activo −1,5 |
| Manejo de errores | 5 | 4,5 | EVA-M04 −0,5 |
| **Total** | 100 | **76** | |

### Estado de hallazgos previos en este alcance
- "El test de paridad entre menú y página pasa" (auditoría 28-09, §11) → **Sigue vigente (verificado)** y confirmado con 10 roles en navegador.
- I-11 (auditoría UI/UX 25-08: Atención antes que módulos) → **Corregido (verificado)**.

### Qué no se pudo verificar y por qué
- Comparación de Inicio con el tablero para `jefa` y `prevfaena` con datos abundantes (B tiene pocos registros operativos; A es de juguete).
- Menú a 390 px por rol (se verificó la pantalla, no el panel móvil).

---

## Resumen de hallazgos

| Severidad | Cantidad | IDs |
|---|---:|---|
| 🔴 Bloqueador | 0 | — |
| 🟠 Crítico | 4 | EVA-01, EVA-02, EVA-03, EVA-20 |
| 🟡 Importante | 13 | EVA-04…EVA-11, EVA-21…EVA-24, EVA-30 |
| 🔵 Mejora | 15 | EVA-M01…M08, M21…M24, EVA-33, EVA-34, EVA-35 |
| ⚪ Cosmético | 4 | EVA-M09, M10, M25, EVA-36 |

## Limpieza
- No se creó ningún archivo en el repositorio. `git status --porcelain` muestra `.audit-login.mjs` y `.audit-seed-qa-roles.ts` (orquestador), `.claude/settings.local.json` modificado y dos `lib/__tests__/*.audit-tmp.test.ts` (`documental-…`, `inspecciones-…`) que **son de otros agentes**; no se tocaron.
