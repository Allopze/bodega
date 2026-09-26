# Auditoría de Production Readiness — Módulo de Prevención (CHOME)

**Fecha:** 2026-09-26 · **Commit auditado:** `9c862fd0` (rama `main`, árbol limpio) · **Tipo:** diagnóstico, sin cambios de código.

**Alcance y método.** Se combinó:

- lectura de código de `lib/services/pdtp/**`, `lib/services/pdtp-adapters/**`, `lib/services/prevention-*`, `app/(app)/prevencion/**`, `app/api/prevencion/**` y `db/schema/prevention/**`;
- ejecución de las puertas deterministas y de las suites de pruebas del módulo;
- recorrido de navegador con Playwright (escritorio y 390 px) contra un **servidor aislado**: build de producción en `:3100` con base desechable `bodega_audit_e2e` en el contenedor E2E;
- reproducciones de servicio sobre PGlite en memoria, fuera del repositorio.

**Qué no se tocó.** Producción (`:3000` y `plataforma-db-1`) no recibió ninguna escritura. Del contenedor `plataforma-cron-1` solo se leyó el crontab.

**Límites de la verificación**, relevantes para leer la nota:

1. El fixture E2E tiene un programa de 2 a 3 actividades **sin conectores a submódulos**. La integración submódulo → programa se verificó con pruebas PGlite y reproducciones de servicio, **no en navegador**.
2. Para recorrer el programa 2026 real (174 actividades) se intentó clonar la base de desarrollo a una base desechable. El control de permisos del entorno lo denegó y no se buscó otra vía. Por la misma razón no se consultó la base de desarrollo para contar actividades.
3. La "prueba de realidad" de 10 actividades (§9) quedó **parcial** por el punto 1.
4. No se corrió `npm run test:e2e` completo: solo las specs `pdtp-*` y `prevencion-*`. Tampoco se corrieron las suites `*-postgres`.

---

## 1. Resumen ejecutivo

El módulo **no es un prototipo**:

- El programa anual tiene un ciclo de vida completo: borrador → revisión → firma JDPR → firma legal → activo, con versiones v+1 y huella de contenido.
- Las ejecuciones se aprueban con **segregación de funciones** real: quien registra no puede aprobar.
- Hay desvíos "no realizada" y "no aplica" con motivo, cierres mensuales inmutables con digest, y un libro durable de eventos de cumplimiento.
- Unos 14 submódulos acreditan automáticamente, con idempotencia por índices únicos. Inspecciones y Capacitación lo hacen dentro de la transacción (o con outbox).
- La base de pruebas es amplia y **está en verde**: 1.518 unitarias, 1.010 PGlite y 147 E2E del módulo, además de typecheck y lint.
- Las 73 páginas validan permisos en el servidor.

**El problema está donde el propio principio del módulo es más exigente: la confiabilidad de la evidencia y del porcentaje.** Se demostró, en ejecución o con reproducción:

1. **"Se hizo" sin ninguna evidencia.** Una ejecución sin archivo ni observación se registró y otro usuario la aprobó. Cuenta como cumplida (verificado en navegador). La compuerta de evidencia solo actúa si la actividad declara `evidenceRequirement`, y los scripts de datos 2026 solo lo cargan en constancias y actividades a demanda.
2. **Anular el registro fuente no revierte el cumplimiento ya aprobado por una persona.** El libro marca el evento como "revoked" y nadie recibe aviso. Aplica a EPP, CPHS, CGRD, vigilancia, MIPER, documentos, acta SST e indicadores (reproducción PGlite y tests que fijan ese comportamiento).
3. **Un par de la misma faena sobrescribe el envío pendiente de otro.** La evidencia original queda sin referencia y deja de ser descargable, incluso para su faena (verificado en navegador y en la base).
4. **El mismo programa muestra cifras distintas según la pantalla:** "Ejecutadas 1", "Plan 5 · Ejecutado 3 · 60 %", "Cumplimiento (4 faenas): 20 %", y en la planilla "1 / 5" contando ejecuciones rechazadas y pendientes (verificado en navegador).
5. **En producción no está agendado ningún cron de Prevención**: recordatorios PDTP, reintento de acreditaciones fallidas, CAPA, capacitación, CPHS, incidentes, programas de inspección (verificado en el crontab y en `scripts/cron-runner.mjs`).

Ninguno exige rediseñar el módulo. Son correcciones acotadas sobre una base sólida. Pero mientras existan, el sistema no puede garantizar lo central: *qué se hizo y con qué evidencia*.

---

## 2. Production Readiness Score

```text
PRODUCTION READINESS

54 / 100

Categoría:
Estado de desarrollo significativo (40–59)
```

**Límite aplicado.** Corresponde el tope de **59/100** de la regla 25, porque hay problemas demostrados de pérdida de evidencia (PREV-B03) y de evidencia no confiable o alteración del cumplimiento (PREV-B01, PREV-C02). La suma ponderada (54) ya queda bajo ese tope, así que el tope no modifica la nota.

**Tope de 69 (flujo principal no integral): no aplica.** El flujo Programa → Actividad → Ejecución → Evidencia → Cumplimiento funciona de punta a punta; lo que falla es la confiabilidad de sus datos.

**Tope de 69 (mocks o datos fijos): no aplica.** No hay mocks ni placeholders. La dependencia de datos fijos 2026 afecta al ciclo 2027 y se descuenta en su área.

---

## 3. Desglose de puntuación

| Área | Puntos | Obtenido |
|---|---:|---:|
| Flujo Programa → Actividad → Cumplimiento | 20 | **11** |
| Evidencias y trazabilidad | 15 | **5** |
| Integración con submódulos | 15 | **8** |
| Integridad y consistencia de datos | 10 | **6** |
| Roles, permisos y seguridad | 10 | **6** |
| UX/UI y facilidad de operación | 10 | **6** |
| Testing y estabilidad | 8 | **6** |
| Manejo de errores y casos borde | 5 | **3** |
| Performance | 3 | **2** |
| Observabilidad y operación | 4 | **1** |
| **TOTAL** | **100** | **54** |

**Flujo Programa → Actividad → Cumplimiento — 11/20**
- *Justificación:* crear programa, versionar, firmar, activar, registrar, aprobar, rechazar, desvío y exclusión funcionan (60 E2E PDTP en verde; recorrido propio).
- *Descuentos:* "Se hizo" sin evidencia (B02, −3); indicadores divergentes (C01, −2); atrasos ocultos (C06, −2); revisión v+1 que parte el año (C05, −1); cambio de año (C03, −1).

**Evidencias y trazabilidad — 5/15**
- *Justificación:* hay validación por magic bytes, descarga atada a la faena, change log, eventos operacionales y cierres con digest.
- *Descuentos:* B01 (−3), B02 (−2), B03 (−2), rechazo sin historial (I04, −1), enlaces de evidencia de integración y CAPA que dan 404 (I05, −1), expediente que dice "Con evidencia: Sí" sin evidencia (I06, −1).

**Integración con submódulos — 8/15**
- *Justificación:* amplia cobertura automática, libro durable e idempotencia.
- *Descuentos:* B01 (−2), carga manual más integración que se suman (C02, −2), cableado fijo a 2026 (C03, −1), reconciliador no agendado (C04, −1), N°88 que apunta a Campañas (I10, −1).

**Integridad y consistencia de datos — 6/10**
- *Justificación:* CHECKs, advisory locks, índices únicos y guardas de mes cerrado.
- *Descuentos:* estados representados en 4 tablas y `evidence_status` sin lector (M03, −1); cascadas sin defensa en la base (M04, −1); cierre del mes en curso (I02, −1); doble conteo latente instancia más ejecución (I08, −1).

**Roles, permisos y seguridad — 6/10**
- *Justificación:* guardas de servidor en todas las páginas (verificado en navegador con 3 roles), IDOR de descarga bloqueado (verificado), segregación ejecución ≠ aprobación, CSP, sanitización Excel.
- *Descuentos:* B03 (−2); ejecución por no asignados y por roles globales no operacionales (I03, −1); "No aplica" sin revisión (C07, −1).

**UX/UI y facilidad de operación — 6/10**
- *Justificación:* estados vacíos con CTA, 4 KPI accionables, toasts de éxito, sin errores de consola ni de red en 30 rutas recorridas.
- *Descuentos:* cifras contradictorias (C01, −1); "Registrar" inalcanzable en móvil (I01, −1); mensajes contradictorios y jerga (I14, −1); límite de 10 MB con mensaje engañoso (I09, −1).

**Testing y estabilidad — 6/8**
- *Justificación:* suites amplias y en verde.
- *Descuentos:* sin E2E de carga de evidencia más aprobación y sin test de "quien registra no aprueba" (−1); tests que fijan el comportamiento de B01 como correcto (−1).

**Manejo de errores y casos borde — 3/5**
- *Justificación:* el doble envío está protegido (verificado).
- *Descuentos:* 10 MB (I09, −1); errores de BD tragados en conectores (I07, −1).

**Performance — 2/3**
- *Justificación:* páginas de ~0,8–1,5 s con el fixture.
- *Descuentos:* abanico de ~20 consultas por faena en el tablero con un pool de 10 (I12, −1).

**Observabilidad y operación — 1/4**
- *Descuentos:* crons de Prevención no agendados (C04, −2); sin Sentry ni chequeo de integridad de archivos, y el ensayo de restauración no prueba el storage (I13, −1).

---

## 4. ¿Qué funciona correctamente? (verificado)

| Capacidad | Evidencia |
|---|---|
| Ciclo de vida del programa: borrador → revisión → JDPR → legal → activo; v+1; archivado; el contenido firmado no se edita | E2E `pdtp-lifecycle-approvals`, `pdtp-flow` (PASS); `lifecycle.ts` compara el digest al activar |
| Registrar ejecución desde la planilla con feedback | Navegador: toast "Ejecución PDTP registrada." y fila `submitted` en la base |
| Segregación: quien registra no aprueba | `executions.ts:340`; navegador: un segundo usuario aprobó ("Ejecución M9S4 aprobada.") |
| Rechazo con motivo | E2E `pdtp-lifecycle-approvals` "rechazar… con motivo" (PASS) |
| "No realizada" con motivo visible y retiro | E2E `pdtp-desvios` (3 PASS); CHECK de motivo de al menos 10 caracteres en la base |
| Exclusión por faena y cero explícito | E2E `pdtp-annual-adjustments` (PASS) |
| N/A fuera del denominador | Reproducción del ejemplo del enunciado: 60 hechas / 80 evaluables = **75 %** (`compliance.ts`) |
| Cierre mensual inmutable con digest y reapertura con motivo | E2E `pdtp-cierre-mes` (PASS); `period-closures.ts` |
| Asignación nominal con vigencia que filtra `/pendientes` | E2E `pdtp-asignacion-nominal` (7 PASS) |
| Permisos en el servidor por URL directa | Navegador: `jt` → `/nuevo`, `/aprobaciones`, `/plantillas`, `/editar` = `/forbidden`; `prevencion.lectura` → todo el PDTP = `/forbidden` |
| Descarga de evidencia atada a la faena (IDOR) | Navegador: un usuario de otra faena recibe 404 sobre un PDF de `ws-e2e` |
| Validación de archivos por magic bytes (PDF, JPEG, PNG) y nombres aleatorios | `lib/file-validation.ts:83-120`; tests de ruta PASS |
| Doble envío | Navegador: el botón se deshabilita mientras procesa y queda una sola fila |
| Idempotencia de integraciones y libro durable | Índices únicos `idempotency_key` y `(sourceType, sourceId, eventType)`; PGlite 249/249 |
| Exportación Excel RE-36 y planilla | E2E `pdtp-templates-exports` (PASS) |
| Estados vacíos en lenguaje de usuario | `/obligaciones`: "Esto no equivale a 0 % ni a 100 % de cumplimiento" |
| Móvil: sin overflow horizontal de página en 6 rutas clave | Recorrido a 390 px |

---

## 5. ¿Qué impide salir a producción? (solo bloqueadores)

1. **PREV-B01:** anular la fuente no revierte un cumplimiento aprobado por una persona, y no avisa a nadie.
2. **PREV-B02:** "Se hizo" aceptado y aprobado sin ninguna evidencia.
3. **PREV-B03:** un par sobrescribe un envío ajeno y la evidencia original se vuelve inaccesible; lo mismo ocurre con la evidencia de un intento rechazado.

---

## 6. Matriz funcional

| Funcionalidad | Estado | Evidencia | Problema | ¿Bloquea? |
|---|---|---|---|---|
| Crear programa | ✅ Completa | E2E `pdtp-flow`; `/prevencion/pdtp/nuevo` | Solo desde la "Base 2026" (C03) | No |
| Configurar programa | ✅ Completa | Editor de borrador, faenas, meta, objetivos | Período fijo 01-01 a 12-31, no editable | No |
| Crear actividad | ✅ Completa | `addPdtpActivity`; tests PGlite | — | No |
| Editar actividad | 🟡 Parcial | Solo en borrador; en activo vía v+1 | v+1 pierde `scheduleDefinition`, configs y recordatorios (C05) | No |
| Eliminar actividad | ✅ Completa | Retiro con motivo y fecha efectiva, sin borrar historia | — | No |
| Responsable | 🟡 Parcial | Cargo, override por faena, asignación nominal | No se valida en el servidor al registrar (I03) | No |
| Fecha | ✅ Completa | Grilla mes × semana e instancias fechadas | Granularidad mensual del estado (C06) | No |
| Recurrencia | ✅ Completa | `recurrenceRule`/`scheduleDefinition` y tests | — | No |
| Actividad condicionada | ✅ Completa | `triggered` con obligaciones y plazo (`obligations.ts`) | `reportedAt` antedatable (I11) | No |
| Cuando corresponda | ✅ Completa | `on_demand` y `/obligaciones` | — | No |
| Mínimo de ejecuciones | ✅ Completa | `annual-minimum.ts`; piso sumado a diciembre | — | No |
| Asociación con submódulo | 🟡 Parcial | Conectores y bindings | Por número fijo 2026 (C03); N°88 obsoleta (I10) | No |
| Evidencia | 🔴 Defectuosa | Carga PDF, JPEG o PNG | Opcional por defecto (B02); se pierde al sobrescribir (B03); >10 MB falla (I09); enlaces 404 (I05) | **Sí** |
| Se hizo | 🔴 Defectuosa | Registro más aprobación | Sin evidencia (B02); la fuente anulada sigue "hecha" (B01) | **Sí** |
| No se hizo | ✅ Completa | Desvío con motivo, usuario y fecha; E2E | No restaura el desvío si la ejecución se rechaza después (mejora) | No |
| No aplica | 🟡 Parcial | Desvío o exclusión con motivo | Sin revisión ni límite, también sobre celdas futuras (C07) | No |
| Pendiente | 🟡 Parcial | Estado derivado | El "anual" no distingue lo no vencido (I15); atrasos ocultos (C06) | No |
| Historial | 🟡 Parcial | `pdtp_change_log`, eventos operacionales | Rechazos y evidencia previa sin historia (I04); IDs crudos en pantalla (M10) | No |
| Auditoría | 🟡 Parcial | `audit_log` y cierres con digest | Aprobar o rechazar no deja fila en el change log; GC sin rastro (I04) | No |
| Dashboard | 🔴 Defectuosa | `/prevencion/pdtp` | Cifras contradictorias en la misma pantalla (C01) | No |
| Porcentaje de cumplimiento | 🔴 Defectuosa | `compliance.ts` | Tres o más fórmulas; la carga manual más la integración se suman (C01, C02) | No |
| Actividades atrasadas | 🔴 Defectuosa | `period.ts:164-198` | "No programada en este período" oculta la deuda (C06) | No |
| Actividades próximas | 🟡 Parcial | "Programadas esta semana" en aprobaciones; recordatorios | Los recordatorios no corren en producción (C04) | No |
| Permisos | 🟡 Parcial | Guardas de servidor; segregación | B03, I03, C07 | Vía B03 |
| Integración entre módulos | 🟡 Parcial | ~14 submódulos acreditan | B01, C02 | Vía B01 |
| Cambio de año | 🔴 Defectuosa | `templates.ts`, `training-occurrences-catalog.ts` | 2027 pierde configuración y acredita el programa 2026 (C03) | No hoy; sí antes del 01-01-2027 |
| Exportación | ✅ Completa | RE-36 y planilla Excel (E2E) | La planilla exporta totales de cualquier estado (C01) | No |
| Mobile/responsive | 🟡 Parcial | 6 rutas sin overflow | "Registrar" inalcanzable en la planilla (I01) | No |

---

## 7. Hallazgos

Convenciones:
- **Verificación:** `NAVEGADOR` (reproducido en la app aislada), `BD` (comprobado en la base desechable), `PGLITE` (reproducción de servicio), `CÓDIGO` (camino leído sin ejecutar).
- Las rutas de archivo son relativas al repositorio. Las capturas están en `qa/reports/2026-09-26-prevencion-readiness/`.

### 7.1 Bloqueadores

```text
ID: PREV-B01
Severidad: 🔴 BLOQUEADOR
Área: Integración / Evidencias
Título: Anular el registro fuente no revierte un cumplimiento aprobado por una persona, y no avisa

Archivo(s): lib/services/pdtp/accreditation.ts; lib/services/pdtp/fulfillment.ts
Línea(s): accreditation.ts:913-916; fulfillment.ts:515-519
Ruta/pantalla: cualquier submódulo que requiere aprobación humana (EPP N°62, CPHS N°9/11, CGRD N°79/80, vigilancia N°50, MIPER N°35, documentos, acta SST, indicadores N°7)
Endpoint: server actions de anulación de cada submódulo → revokePdtpAccreditation
Rol afectado: aprobador PDTP, jefatura, auditor

Descripción: Si la ejecución acreditada ya la aprobó una persona (no auto-aprobada), la revocación la salta (`skippedApproved.push(...); continue`) y luego marca el evento del libro como `status: "revoked"`. `skippedApproved` no se muestra en ninguna UI.

Evidencia: Código citado. Reproducción PGLITE R1 del agente de integración (entrega EPP → aprobar → anular ⇒ ejecución `approved`, evento `revoked`, mes con `executed: 1`). Tests que fijan este comportamiento: lib/__tests__/pdtp-accreditation.test.ts:652-680, 713-748, 1644-1658.

Cómo reproducir:
1. Registrar una entrega de EPP (acredita N°62 como `submitted`).
2. Aprobar la ejecución en /prevencion/pdtp/aprobaciones.
3. Anular la entrega en Bodega/EPP.

Resultado actual: La actividad sigue "cumplida", respaldada por un registro anulado, y el libro dice "revoked".

Resultado esperado: La ejecución vuelve a revisión, o la anulación queda en una cola visible para el aprobador, con aviso.

Impacto en producción: El porcentaje y el RE-36 declaran cumplimientos que no ocurrieron. Es el caso "la interfaz dice cumplida pero la evidencia no es válida".

Causa probable: Decisión deliberada ("deshacer una aprobación humana es una decisión humana") sin el canal que lleve esa decisión a una persona.

Solución recomendada: Al revocar sobre una ejecución aprobada por una persona, pasarla a `submitted` con marca "fuente anulada" o crear un ítem en la cola de aprobación. Registrar `skippedApproved` en el evento y mostrarlo en el panel de backlog.

Esfuerzo estimado: Medio

Bloquea producción: Sí
```

```text
ID: PREV-B02
Severidad: 🔴 BLOQUEADOR
Área: Flujo principal / Evidencias
Título: "Se hizo" se registra y se aprueba sin ninguna evidencia

Archivo(s): lib/services/pdtp/executions.ts; scripts/apply-pdtp-2026-catalog-decisions.ts; scripts/apply-pdtp-2026-demand-slas.ts; lib/services/pdtp/audit-dossier.ts
Línea(s): executions.ts:162-167 (gate solo si `requirement`), 193-196 (archivo real solo en `constancia`); approvePdtpExecution executions.ts:325-391 (no revalida evidencia); catalog-decisions.ts:182-196 y demand-slas.ts:77-175 (los únicos lugares que cargan `evidenceRequirement`)
Ruta/pantalla: /prevencion/pdtp/[programId]?faena=… → "Registrar"; /prevencion/pdtp/aprobaciones
Endpoint: markPdtpExecutionAction, approvePdtpExecutionAction
Rol afectado: todos los que ejecutan o aprueban

Descripción: La compuerta de evidencia depende del texto libre `evidenceRequirement`. Solo lo tienen ~11 constancias y ~20 actividades a demanda (según los scripts de datos 2026; no se pudo contar en la base). Para el resto, una ejecución vacía (cantidad 1, sin observación ni archivo) es válida y, al aprobarse, cuenta como cumplida.

Evidencia: NAVEGADOR + BD. Como admin se registró N°1 "Charla de seguridad E2E", Sep S4, cantidad 1, sin observación ni archivo → toast de éxito, fila `pdtp-act-e2e-e-ws-e2e-2026-09-4` en `submitted` con `evidence_url` y `evidence_text` nulos. Luego `qa.prev.a` la aprobó ("Ejecución M9S4 aprobada.") → `approved`, `approved_by_user_id=user-qa-prev-a`.

Cómo reproducir:
1. Abrir el programa activo con faena y pulsar "Registrar" en una actividad sin evidencia exigida.
2. Poner cantidad 1 y guardar sin archivo ni observación.
3. Aprobar con otro usuario en /prevencion/pdtp/aprobaciones.

Resultado actual: La actividad cuenta como cumplida sin evidencia. El expediente de auditor (audit-dossier.ts:126) diría además "Con evidencia: Sí" si hubiese cualquier texto.

Resultado esperado: "Se hizo" exige evidencia verificable (archivo o registro nativo vinculado) salvo excepción configurada explícitamente por actividad.

Impacto en producción: El programa puede llegar al 100 % sin una sola evidencia. Contradice el principio rector del módulo.

Causa probable: La evidencia se modeló como opcional por actividad (texto libre) en vez de obligatoria por defecto. El endurecimiento de 648032d0 se acotó a constancias.

Solución recomendada: Invertir el default: exigir evidencia en toda ejecución manual salvo `evidenceRequired=false` explícito en `pdtp_activity_execution_configs`. Revalidar en `approvePdtpExecution`. Mostrar "sin evidencia" en la cola de aprobación.

Esfuerzo estimado: Medio

Bloquea producción: Sí
```

```text
ID: PREV-B03
Severidad: 🔴 BLOQUEADOR
Área: Evidencias / Permisos / Trazabilidad
Título: Un par sobrescribe el envío pendiente de otro y la evidencia original queda inaccesible (también al reenviar tras un rechazo)

Archivo(s): lib/services/pdtp/executions.ts; lib/services/pdtp/obligations.ts; lib/services/pdtp/evidence-gc.ts; app/api/prevencion/pdtp/evidence/[name]/route.ts
Línea(s): executions.ts:89-91 (solo bloquea `approved`), 125-138 (reemplaza `evidenceUrl`), 249-260 (upsert reescribe texto, URL y `executedByUserId`); obligations.ts:283-297; evidence-gc.ts:51-152; [name]/route.ts:58-72
Ruta/pantalla: /prevencion/pdtp/[programId]?faena=… → "Registrar"
Endpoint: markPdtpExecutionAction; GET /api/prevencion/pdtp/evidence/[name]
Rol afectado: responsables de ejecución de una misma faena y roles globales con `pdtp:execute`

Descripción: Cualquier usuario con `prevention:pdtp:execute` en la faena puede reenviar la misma celda (actividad × faena × semana) de un envío `submitted` o `rejected` ajeno. Se reemplazan cantidad, observación, archivo y ejecutor. El archivo anterior queda sin referencia en la base. La ruta de descarga solo sirve archivos referenciados, así que deja de ser accesible, y el GC (1 h de gracia) lo borraría físicamente si se ejecuta. Lo mismo ocurre con la evidencia de un intento rechazado al reenviar.

Evidencia: NAVEGADOR + BD.
- (1) `jt@e2e` registró Ago S3, cantidad 1, "Charla realizada, acta A", con acta-A.pdf → `evidence_url=…/EYralw4WLEiq5aA2bXaK.pdf`, `executed_by=user-jt-pdtp-e2e`.
- (2) `jefe.faena@e2e` registró la misma celda con cantidad 3, "Reemplazo por supervisor B", acta-B.pdf → la fila quedó con `…/wCBZgIc3GsXeL_0ookCy.pdf`, cantidad 3, `executed_by=user-jefe-terreno-e2e`.
- (3) Referencias al archivo A en la base: 0. El archivo sigue en disco.
- (4) GET de A como `jefe.faena` (misma faena) → 404. GET de B → 200.

Cómo reproducir:
1. El usuario A registra una ejecución con archivo.
2. El usuario B, de la misma faena, registra la misma actividad, mes y semana con otro archivo.
3. Intentar descargar el archivo de A.

Resultado actual: El envío de A desaparece sin aviso. Su evidencia es inaccesible y candidata a borrado. Solo queda el evento `pdtp.execution_resubmitted`, sin contenido.

Resultado esperado: El envío ajeno no se sobrescribe (o exige confirmación explícita), y la evidencia de cada intento se conserva (append-only), con su motivo de rechazo.

Impacto en producción: Pérdida de evidencias y de autoría, y posibilidad de alterar lo que ve el aprobador.

Causa probable: Upsert por celda sin control de autor ni historia de intentos. `evidenceUrl` es escalar y no append-only.

Solución recomendada: Bloquear el reenvío de un `submitted` ajeno salvo por el mismo autor o un aprobador. Mover la evidencia a una tabla `pdtp_execution_evidence` append-only (ruta, sha256, autor, fecha, intento) e incluirla en el GC. Guardar el motivo de rechazo en el evento.

Esfuerzo estimado: Medio

Bloquea producción: Sí
```

### 7.2 Críticos

```text
ID: PREV-C01
Severidad: 🟠 CRÍTICO
Área: Dashboard / Cálculo
Título: El mismo programa muestra cifras de cumplimiento distintas según la pantalla

Archivo(s): app/(app)/prevencion/pdtp/page.tsx; lib/services/pdtp/compliance.ts; lib/services/pdtp/sheets.ts; lib/services/pdtp/management-report.ts
Línea(s): page.tsx:189 (`executedCount = indicators.annual.executed` rotulado "Ejecuciones registradas"), 163-169 (avance por eje, otra fuente); compliance.ts:537 (tope mensual global); sheets.ts:443-453 (suma ejecuciones de cualquier estado), 536-537; management-report.ts:142-144, 176
Ruta/pantalla: /prevencion/pdtp, /prevencion/pdtp/programas, /prevencion/pdtp/[programId], reporte de gestión, Excel de planilla
Endpoint: —
Rol afectado: jefatura, jefatura de prevención, auditor

Descripción: Coexisten al menos cuatro cálculos. (a) El indicador formal: solo aprobadas, con tope por mes. (b) El "avance por eje": aprobadas agrupadas por hoja, con otro tope. (c) La planilla por faena y su Excel: ejecuciones de **cualquier estado**, incluidas rechazadas y pendientes, sin tope. (d) El reporte de gestión: tope por actividad, sin instancias y con otro corte de activación.

Evidencia: NAVEGADOR (captura 01 y 02), mismo instante y base quieta.
- Tablero: "Ejecutadas 1 — Ejecuciones registradas en 2026"; "Avance por eje: Plan 5 · Ejecutado 3 · 60 %"; barra de Faena E2E ≈ 50 %.
- /programas: "Cumplimiento (4 faenas): 20 %".
- Planilla de Faena E2E: "Plan / Ejecutado 1 / 5", cuando la base tiene 3 aprobadas, 1 rechazada y 1 enviada para esa actividad. La tarjeta superior de la misma página dice "Plan 2 · ejecutado 1 · 50 %".

Cómo reproducir:
1. Tener ejecuciones aprobadas, rechazadas y pendientes en una actividad.
2. Comparar el tablero, /programas y la planilla de la faena.
3. Descargar el Excel de la planilla.

Resultado actual: Tres o más porcentajes para el mismo programa y un "ejecutado" que incluye rechazos.

Resultado esperado: Una sola función de cumplimiento, con la misma regla (solo aprobadas) en todas las vistas. Rótulos que digan qué se cuenta.

Impacto en producción: La jefatura no puede responder "¿qué porcentaje está cumplido?" con una sola cifra. En la planilla, un rechazo se ve como "Ejecutada".

Causa probable: La fórmula está duplicada en 10 lugares (compliance, management-report, period-closures, sheets).

Solución recomendada: Un helper único `pdtpCompliance(executed, planned, {cap, scale})` sobre ejecuciones aprobadas. La planilla debe distinguir enviada, rechazada y aprobada visualmente sin sumarlas al ejecutado.

Esfuerzo estimado: Medio

Bloquea producción: No (pero es condición para confiar en el tablero)
```

```text
ID: PREV-C02
Severidad: 🟠 CRÍTICO
Área: Cálculo / Integración
Título: La carga manual más la acreditación de otro submódulo se suman, y el excedente compensa actividades en cero

Archivo(s): lib/services/pdtp/compliance.ts; lib/validation/prevention-module/pdtp.ts; app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx
Línea(s): compliance.ts:188-221 (`Math.max(inspection, legacy) + otherIntegration`), 537 (`min(Σejec, Σplan)` por mes, no por actividad); pdtp.ts:29 (`executedQuantity` sin máximo); pdtp-sheet-table.tsx:470-479 (formulario manual en todas las filas)
Ruta/pantalla: planilla del programa; tablero
Endpoint: markPdtpExecutionAction; conectores
Rol afectado: jefatura (lectura del %), cualquier ejecutor

Descripción: Solo Inspecciones se deduplica contra la carga manual. Una actividad acreditada por Capacitación, EPP, CGRD, etc. y además registrada a mano suma dos. Como el tope es por mes y no por actividad, ese excedente, o una cantidad aprobada alta, cubre otra actividad del mismo mes que está en cero. También hay doble fuente para la N°63 (acta de ingreso y CAP-03).

Evidencia: PGLITE R2: dos actividades planificadas, una sin ninguna ejecución → mes 2/2 = 100 %. Código citado. Verificado en código que el tope es mensual.

Cómo reproducir:
1. Acreditar una actividad desde su submódulo y aprobar.
2. Registrar la misma actividad y semana a mano y aprobar.
3. Dejar otra actividad del mismo mes en cero y ver el % mensual.

Resultado actual: 100 % con una actividad sin hacer.

Resultado esperado: Tope por actividad y celda. La carga manual no se suma a una acreditación de la misma celda.

Impacto en producción: Porcentaje inflado sin que nadie lo note. Alteración del cumplimiento.

Causa probable: Deduplicación especial solo para inspecciones y tope agregado.

Solución recomendada: Deduplicar por celda (máximo entre fuentes), topar por actividad, poner un máximo razonable a `executedQuantity` y ocultar "Registrar" en filas con conector activo (o avisar).

Esfuerzo estimado: Medio

Bloquea producción: No
```

```text
ID: PREV-C03
Severidad: 🟠 CRÍTICO
Área: Cambio de año
Título: El programa 2027 nace sin mecanismo ni programación, y varias integraciones siguen acreditando el programa 2026

Archivo(s): lib/services/pdtp/templates.ts; lib/services/pdtp/programs.ts; lib/services/prevention-training-occurrences.ts; training-occurrences-catalog (lib/services); program-slots-2026 (lib/services); lib/services/pdtp/accreditation.ts
Línea(s): templates.ts:349-392 (la inserción no copia `mechanism`, `scheduleDefinition`, `subjectSource`, `dueHours`, configs, recordatorios, exclusiones ni overrides; verificado: no aparecen en el `values(...)`); templates.ts:147-153, 227 (solo "Base 2026"); programs.ts:39-47; training-occurrences-catalog.ts:1, 593-596; prevention-training-occurrences.ts:276-277; program-slots-2026.ts:58, 116-119; accreditation.ts:297-299 (acepta programas `closed`)
Ruta/pantalla: /prevencion/pdtp/nuevo
Endpoint: createPdtpProgramAction
Rol afectado: prevención, jefatura

Descripción: Crear el año siguiente instancia siempre la Base 2026 y descarta la configuración de ejecución. Todas las actividades nacen `mechanism = sin_definir`, lo que bloquea el envío a revisión hasta reclasificarlas a mano. El catálogo de capacitación y las casillas (simulacros, CGRD, alcotest, higiene) fuerzan el año 2026, así que en 2027 acreditarían el programa 2026 cerrado.

Evidencia: CÓDIGO (agentes de núcleo y de integración, líneas verificadas). BD: el programa 2027 del fixture tiene sus 3 actividades con `mechanism=sin_definir` y `schedule_definition=null`. No es concluyente por sí solo, porque el snapshot del fixture tampoco trae esos campos.

Cómo reproducir:
1. Crear el programa 2027 desde /prevencion/pdtp/nuevo.
2. Revisar el mecanismo de sus actividades e intentar enviarlo a revisión.
3. Registrar en 2027 una ocurrencia de capacitación.

Resultado actual: Reconfiguración manual de unas 80 actividades y acreditaciones al año equivocado.

Resultado esperado: "Copiar desde el programa anterior" completo, y catálogos y casillas parametrizados por año.

Impacto en producción: No impide iniciar en 2026, pero sin corregirlo el módulo deja de funcionar correctamente el 01-01-2027. Además, ese día el tablero deja de mostrar el resultado de 2026.

Causa probable: La Base 2026 y el cableado se construyeron para el primer año.

Solución recomendada: Restaurar todos los campos del snapshot en `instantiatePdtpTemplateVersion`, permitir publicar una Base desde cualquier año y parametrizar `PREDEFINED_TRAINING_CATALOG_YEAR` y `PROGRAM_SLOT_YEAR`.

Esfuerzo estimado: Alto

Bloquea producción: No para iniciar; sí antes del 2027
```

```text
> **Corrección posterior (2026-09-26):** `.github/workflows/prevention-inspection-programs.yml` estaba versionado desde el 19-08. La materialización de programas de inspección probablemente sí corría en GitHub Actions; no se pudo confirmar sin `gh`. El otro workflow, `prevention-daily-reminders.yml` (recordatorios y GC), estaba en `.gitignore` y nunca se subió, así que para esos crons el hallazgo se mantiene. El workflow de inspecciones se retiró en T0: el cron de docker es el único scheduler.

ID: PREV-C04
Severidad: 🟠 CRÍTICO
Área: Operación
Título: Ningún cron de Prevención está agendado: sin recordatorios ni reintento de acreditaciones fallidas

Archivo(s): scripts/cron-runner.mjs; app/api/cron/pdtp-weekly-reminders/route.ts; app/api/cron/{prevention-*,pdtp-evidence-gc,sst-weekly-alerts,deadline-reminders}
Línea(s): cron-runner.mjs:16-104 (15 jobs, ninguno de Prevención); pdtp-weekly-reminders/route.ts:74 (ahí vive `reconcilePdtpFulfillmentEvents`)
Ruta/pantalla: —
Endpoint: /api/cron/pdtp-weekly-reminders, prevention-capa-reminders, prevention-training-reminders, prevention-cphs-alerts, prevention-incident-reminders, prevention-inspection-programs, prevention-document-ack-reminders, sst-weekly-alerts, deadline-reminders, pdtp-evidence-gc
Rol afectado: responsables (no reciben avisos), prevención

Descripción: El crontab del contenedor `plataforma-cron-1` (producción) se genera desde `cron-runner.mjs` y contiene solo DTE, ventas, Chipax, health, combustibles, flota, mantenciones, feedback, TI, integridad operacional y archivo documental. Los endpoints de Prevención existen pero nadie los invoca. Consecuencias: (a) no hay recordatorios semanales ni de CAPA, capacitación, CPHS, incidentes o acuses; (b) los eventos de acreditación en `error`/`pending` solo se reintentan al activar un programa (límite 50); (c) no se materializan los programas de inspección, si ese cron es su único camino. Aspecto positivo: el GC de evidencia tampoco corre, así que hoy no borra nada (ver B03).

Evidencia: Lectura del crontab de producción (solo lectura) y de `scripts/cron-runner.mjs`. No hay scheduler alternativo en el host (`crontab -l`, `/etc/cron.d`). El pendiente GC-01a en tasks/TODO_AUDITORIA_PREVENCION_2026-08-17.md:21 ya lo señalaba.

Cómo reproducir:
1. Leer `scripts/cron-runner.mjs`.
2. Buscar `pdtp` o `prevention`.
3. Comparar con la lista de app/api/cron.

Resultado actual: Automatizaciones de Prevención inactivas en producción.

Resultado esperado: Todos los crons de Prevención agendados, con monitoreo de su última ejecución.

Impacto en producción: Actividades vencidas sin aviso; acreditaciones perdidas que no se recuperan solas.

Causa probable: El runner se construyó por dominios y Prevención nunca se sumó.

Solución recomendada: Agregar los jobs a `cron-runner.mjs` con horarios definidos. Decidir explícitamente si `pdtp-evidence-gc` se agenda, y hacerlo solo después de corregir B03.

Esfuerzo estimado: Bajo

Bloquea producción: No (pero debe quedar resuelto en la salida)
```

```text
ID: PREV-C05
Severidad: 🟠 CRÍTICO
Área: Flujo principal / Versionado
Título: Una revisión v+1 a mitad de año parte el año, pierde configuración y congela los meses previos

Archivo(s): lib/services/pdtp/programs.ts; lib/services/pdtp/compliance.ts; lib/services/pdtp/executions.ts; lib/services/pdtp/period-closures.ts
Línea(s): programs.ts:451-494 (la copia no incluye `scheduleDefinition`, execution configs ni reminder rules), 636-637; compliance.ts:232-234, 269-273; executions.ts:38, 48-50; period-closures.ts:316-318, 332-336
Ruta/pantalla: "Crear revisión v+1" en el programa activo
Endpoint: createPdtpRevision, activatePdtpProgram
Rol afectado: prevención, jefatura

Descripción: La v2 crea actividades nuevas. El indicador de v2 corta en su activación y el tablero solo mira el programa activo, así que tras una revisión en noviembre el "anual" muestra noviembre y diciembre. Los meses anteriores de v1 ya no admiten ejecuciones tardías, cierres ni desvíos (v1 `closed`, v2 rechaza períodos previos). Las actividades planificadas por instancias pierden su plan sin aviso.

Evidencia: CÓDIGO (líneas citadas). No se reprodujo en navegador.

Cómo reproducir:
1. Con v1 activa y ejecuciones de enero a octubre, crear, firmar y activar una v2 en noviembre.
2. Mirar el "Cumplimiento anual" del tablero.
3. Intentar registrar o cerrar octubre.

Resultado actual: El año queda fragmentado y los meses previos no se pueden completar.

Resultado esperado: Vista anual consolidada entre versiones; la v1 cerrada sigue admitiendo regularizaciones y cierres de sus meses; la v+1 copia toda la configuración.

Impacto en producción: Cualquier ajuste formal del programa durante el año degrada el seguimiento.

Causa probable: Versionado por filas nuevas sin capa de consolidación.

Solución recomendada: Copiar las tablas faltantes en `createPdtpRevision`, permitir cierres y regularización sobre la versión dueña del mes, y consolidar por `catalogActivityId` en el indicador anual.

Esfuerzo estimado: Alto

Bloquea producción: No
```

```text
ID: PREV-C06
Severidad: 🟠 CRÍTICO
Área: Dashboard / Estados
Título: Las actividades atrasadas quedan ocultas como "No programada en este período"

Archivo(s): lib/services/pdtp/period.ts; lib/services/operational-work-queue.ts; app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx
Línea(s): period.ts:164-198 (174-176 devuelve `not_scheduled` si el mes actual no tiene plan; 179-181 `executed` si hubo cualquier ejecución este mes); operational-work-queue.ts:866; pdtp-sheet-table-ui.tsx:25
Ruta/pantalla: planilla (filtro "Atrasadas"), tablero (KPI "Atrasadas"), /pendientes
Endpoint: —
Rol afectado: jefatura, responsables

Descripción: El estado se deriva solo del mes en curso. Una trimestral no hecha en marzo se ve en abril y mayo como "No programada en este período" y no entra en "Atrasadas". Una ejecución este mes oculta meses previos en cero.

Evidencia: CÓDIGO. NAVEGADOR (parcial): la fila N°1 muestra "No programada en este período" y el tablero "Atrasadas 0".

Cómo reproducir:
1. Actividad trimestral planificada en marzo sin ejecución.
2. Abrir la planilla en mayo.
3. Filtrar por "Atrasadas".

Resultado actual: No aparece.

Resultado esperado: "Atrasada" mientras exista plan vencido sin ejecutar ni desvío.

Impacto en producción: No responde "¿qué actividades están atrasadas?", una de las preguntas centrales del módulo.

Causa probable: Estado de celda mensual en vez de acumulado.

Solución recomendada: Derivar el atraso del acumulado planificado vencido menos el ejecutado aprobado menos N/A hasta la fecha.

Esfuerzo estimado: Medio

Bloquea producción: No
```

```text
ID: PREV-C07
Severidad: 🟠 CRÍTICO
Área: Estados / Permisos
Título: "No aplica" se aplica al instante, sin revisión, sin límite y también sobre celdas futuras

Archivo(s): app/(app)/prevencion/pdtp/actions/deviations.ts; lib/services/pdtp/deviations.ts; lib/services/pdtp/scheduled-execution.ts
Línea(s): actions/deviations.ts:78-94 (`not_applicable` acepta `constancias:execute`); deviations.ts:161-169 (solo "no realizada" bloquea el futuro), ~275 (`status: "active"` inmediato), 493; scheduled-execution.ts:241 (motivo de 3 caracteres en instancias)
Ruta/pantalla: planilla / Constancias
Endpoint: recordPdtpDeviationAction
Rol afectado: cualquier rol con `constancias:execute` (incluye roles globales como gerente_legal_rrhh, subgerente_operaciones, jefe_mantencion) y `override:manage`

Descripción: El N/A saca la celda del denominador en el acto. Solo exige un motivo; no hay segundo actor, cuota ni reporte de N/A por usuario. El mismo usuario puede retirarlo. En actividades `constancia`, el propio responsable puede eximirse.

Evidencia: CÓDIGO. E2E `pdtp-annual-adjustments` y `pdtp-desvios` (flujos de exclusión y desvío PASS).

Cómo reproducir:
1. Con un rol que tenga `constancias:execute`, abrir una constancia pendiente.
2. Declarar "No aplica" con un motivo de 10 caracteres.
3. Ver cómo sube el %.

Resultado actual: Mejora el % sin control.

Resultado esperado: N/A sujeto a aprobación (o al menos visible en una bandeja de revisión), prohibido sobre celdas futuras salvo reprogramación, y con reporte de uso.

Impacto en producción: Es la palanca más directa para inflar el cumplimiento.

Causa probable: Diseño deliberado (documentado en deviations.ts:12-24) sin contrapeso.

Solución recomendada: Estado `pending_review` para N/A con aprobador distinto, más un indicador visible de "celdas N/A" junto al %.

Esfuerzo estimado: Medio

Bloquea producción: No
```

### 7.3 Importantes

```text
ID: PREV-I01
Severidad: 🟡 IMPORTANTE
Área: Mobile
Título: En móvil el botón "Registrar" de la planilla queda tapado por la columna fija y no se puede pulsar

Archivo(s): app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx (celda `sticky left-12 z-10`)
Línea(s): no identificada con precisión (la clase aparece en el `<td>` de actividad)
Ruta/pantalla: /prevencion/pdtp/[programId]?faena=…&vista=anual a 390 px
Endpoint: —
Rol afectado: responsables en terreno

Descripción: A 390 px la columna fija N° + Actividad ocupa todo el ancho visible del contenedor (356 px de 1.081). Aun deslizando la tabla al máximo, la prueba de impacto sobre el centro de "Registrar" cae en "Ver programa y responsables".

Evidencia: NAVEGADOR (captura 03; `elementFromPoint` con scrollLeft 0, 1/3, 1/2 y máximo: `hitIsButton=false` en los cuatro casos). Playwright no pudo pulsarlo ("subtree intercepts pointer events").

Cómo reproducir:
1. Abrir la planilla de una faena en un teléfono.
2. Deslizar la tabla a la derecha.
3. Intentar tocar "Registrar".

Resultado actual: No se puede registrar desde el teléfono. Constancias tiene su propio flujo.

Resultado esperado: Acción de registro accesible en móvil (tarjetas o columna de acciones fija a la derecha).

Impacto en producción: Obliga a registrar desde escritorio, lo que dificulta adjuntar fotos en terreno.

Causa probable: Anchos de columnas fijas pensados para escritorio.

Solución recomendada: Por debajo de `md`, reducir la columna fija o usar la vista de tarjetas (patrón `DataTable`/`listRecord`).

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I02
Severidad: 🟡 IMPORTANTE
Área: Cierres
Título: Se puede cerrar el mes en curso y con envíos pendientes de aprobación

Archivo(s): lib/services/pdtp/period-closures.ts; lib/services/pdtp/executions.ts
Línea(s): period-closures.ts:327-329 (`month > current.month`, contradice su comentario); executions.ts:315-323, 344
Ruta/pantalla: "Cerrar mes" en el programa
Endpoint: closePdtpPeriodAction
Rol afectado: quien tiene `close_period`; aprobadores

Descripción: El mes vigente se congela antes de terminar. Las ejecuciones `submitted` quedan sin poder aprobarse hasta que alguien reabra el mes.

Evidencia: CÓDIGO (línea verificada).

Cómo reproducir:
1. En septiembre, cerrar septiembre con envíos pendientes.
2. Intentar aprobar uno.

Resultado actual: Se permite cerrar y luego se bloquea la aprobación.

Resultado esperado: Solo cerrar meses terminados, avisando de los pendientes.

Impacto en producción: Fotos de cierre incompletas y reaperturas forzadas.

Causa probable: Comparación `>` en vez de `>=`.

Solución recomendada: Rechazar `month >= current.month` y mostrar los envíos pendientes antes de confirmar.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I03
Severidad: 🟡 IMPORTANTE
Área: Permisos
Título: Se puede registrar la ejecución de una actividad asignada a otra persona, y roles globales no operacionales pueden hacerlo en cualquier faena

Archivo(s): lib/services/pdtp/executions.ts; lib/auth/system-rbac.ts; modules/prevention/manifest.ts
Línea(s): executions.ts:17-60 (no consulta asignados ni responsables); system-rbac.ts:34-43
Ruta/pantalla: planilla
Endpoint: markPdtpExecutionAction
Rol afectado: gerente_legal_rrhh, subgerente_operaciones, jefe_mantencion (globales con `pdtp:execute`)

Descripción: La asignación nominal solo filtra /pendientes. El servidor no la aplica.

Evidencia: CÓDIGO. NAVEGADOR (indirecto): `jefe.faena`, no asignado, registró la celda de `jt` (ver B03).

Cómo reproducir: ver PREV-B03.

Resultado actual: Cualquiera con `execute` en la faena registra cualquier actividad.

Resultado esperado: Registrar solo actividades propias (responsable o asignado), salvo prevención o administración.

Impacto en producción: Autoría difusa. La segregación de la aprobación mitiga, pero no reemplaza.

Causa probable: La asignación se diseñó como filtro de cola.

Solución recomendada: Validar la asignación vigente en `markPdtpExecution` con excepción para `override:manage`.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I04
Severidad: 🟡 IMPORTANTE
Área: Trazabilidad
Título: El historial no permite reconstruir qué evidencia se presentó, quién la rechazó y por qué

Archivo(s): lib/services/pdtp/executions.ts; lib/services/pdtp/evidence-gc.ts; lib/logger.ts
Línea(s): executions.ts:255, 258, 352-354, 444 (el motivo de rechazo se borra al reenviar o aprobar; el evento guarda `{status, hasObligation}`); evidence-gc.ts:99 (resumen con `logger.info`); logger.ts:17 (producción emite desde `warn`)
Ruta/pantalla: "Control de cambios" del programa
Endpoint: —
Rol afectado: auditor, jefatura

Descripción: Aprobar o rechazar no escribe en `pdtp_change_log` ni en `audit_log`. Los eventos operacionales no guardan el estado previo ni la evidencia. `executedBy` y `executedAt` se sobrescriben en cada reenvío. El GC borra archivos sin dejar rastro en producción.

Evidencia: CÓDIGO. NAVEGADOR: el control de cambios no muestra aprobaciones, solo obligaciones, desvíos, cierres y asignaciones.

Cómo reproducir:
1. Rechazar una ejecución con motivo.
2. Reenviarla con otro archivo.
3. Buscar el motivo y el archivo original.

Resultado actual: No existen en ninguna parte.

Resultado esperado: Registro append-only por intento: estado anterior → nuevo, usuario, fecha, evidencia y motivo.

Impacto en producción: Una revisión posterior no puede reconstruir la historia de una actividad.

Causa probable: La ejecución se modeló como fila mutable.

Solución recomendada: Tabla de historia de ejecución (o `recordModuleHistory`) en cada transición, más `recordAudit` en el GC.

Esfuerzo estimado: Medio

Bloquea producción: No (se resuelve junto con B03)
```

```text
ID: PREV-I05
Severidad: 🟡 IMPORTANTE
Área: Evidencias
Título: La evidencia que llega por integración y la de seguimiento CAPA se muestra con enlaces que responden 404

Archivo(s): lib/services/pdtp/accreditation.ts; app/(app)/prevencion/pdtp/pdtp-evidence-thumbs.tsx; app/api/prevencion/pdtp/evidence/[name]/route.ts; lib/services/pdtp/followups.ts
Línea(s): accreditation.ts:755-756, 787-788; pdtp-evidence-thumbs.tsx:33-36; [name]/route.ts:60-72; followups.ts:63-83
Ruta/pantalla: planilla (miniaturas de evidencia) y panel del plan de acción
Endpoint: GET /api/prevencion/pdtp/evidence/[name]
Rol afectado: aprobador, auditor

Descripción: Capacitación, alcotest y simulacros guardan rutas de otros directorios en `evidence_url`. La miniatura arma `/api/prevencion/pdtp/evidence/<basename>`, que solo busca en `pdtp-evidence/`. La evidencia CAPA subida desde PDTP solo vive en `prevention_capa_evidence` y la ruta solo consulta `pdtp_executions`.

Evidencia: CÓDIGO (agente de evidencias). No reproducido en navegador, porque el fixture no tiene integraciones.

Cómo reproducir:
1. Acreditar la N°16 desde una ocurrencia de capacitación con evidencia.
2. Abrir la miniatura en la planilla.

Resultado actual: 404 (según el código).

Resultado esperado: El enlace abre el archivo del módulo de origen, con sus permisos.

Impacto en producción: El aprobador aprueba sin poder ver la evidencia.

Causa probable: Una sola ruta de descarga para evidencias de varios orígenes.

Solución recomendada: Resolver la descarga según `source_type` (redirigir a la ruta del módulo de origen) y agregar `prevention_capa_evidence` a la autorización.

Esfuerzo estimado: Medio

Bloquea producción: No
```

```text
ID: PREV-I06
Severidad: 🟡 IMPORTANTE
Área: Evidencias / Exportación
Título: El expediente de auditor declara "Con evidencia: Sí" cuando solo hay texto o una etiqueta

Archivo(s): lib/services/pdtp/audit-dossier.ts; lib/services/pdtp/imports.ts
Línea(s): audit-dossier.ts:126; imports.ts:711-720 (importadas con "…sin evidencia adjunta")
Ruta/pantalla: descarga del expediente de auditor
Endpoint: /api/prevencion/pdtp/expediente-auditor
Rol afectado: auditor externo

Descripción: Cualquier texto cuenta como evidencia y no se comprueba que el archivo exista.

Evidencia: CÓDIGO.

Cómo reproducir:
1. Aprobar una ejecución con solo observación.
2. Descargar el expediente.

Resultado actual: "Sí".

Resultado esperado: Distinguir "archivo verificado", "registro nativo" y "solo declaración".

Impacto en producción: Documento externo que afirma algo falso.

Causa probable: Criterio laxo de `hasEvidence`.

Solución recomendada: Usar el mismo criterio `isRealEvidence` de accreditation.ts más `existsSync`.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I07
Severidad: 🟡 IMPORTANTE
Área: Manejo de errores
Título: Tres conectores tratan cualquier error de base de datos como "no hay programa" y omiten en silencio

Archivo(s): lib/services/pdtp-adapters/preventive-organization-connector.ts; riohs-rollout-connector.ts; worker-lifecycle-connector.ts
Línea(s): 132; 113; 101 (`resolvePdtpActivityIdsForNumbers(...).catch(() => null)`)
Ruta/pantalla: —
Endpoint: barridos de obligaciones
Rol afectado: prevención

Descripción: Una caída de la base durante el barrido se registra como `skipped_no_program` y las obligaciones no se abren.

Evidencia: CÓDIGO.

Cómo reproducir: no reproducido (requiere inyectar un fallo de la base).

Resultado actual: Omisión silenciosa.

Resultado esperado: Capturar solo `PdtpNoActiveProgramError`.

Impacto en producción: Obligaciones legales (RIOHS, ingreso de trabajadores) que no se generan.

Causa probable: Catch demasiado amplio.

Solución recomendada: `catch (e) { if (e instanceof PdtpNoActiveProgramError) return null; throw e }`.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I08
Severidad: 🟡 IMPORTANTE (latente)
Área: Integridad / Seguridad
Título: El modelo de instancias programadas cuenta doble, no se reabre al revocar y su acción confía en metadatos del cliente

Archivo(s): lib/services/pdtp/compliance.ts; lib/services/pdtp/scheduled-execution.ts; lib/services/pdtp/fulfillment.ts; lib/validation/prevention-module/pdtp.ts
Línea(s): compliance.ts:422-440; scheduled-execution.ts:17-29, 78-118, 248-253; fulfillment.ts:306-352; pdtp.ts:152-158 (`sourceMetadata: z.record(...)`)
Ruta/pantalla: actividades creadas con el constructor nuevo (no `legacy_grid`)
Endpoint: recordPdtpScheduledInstanceOutcomeAction (hoy sin UI que la importe)
Rol afectado: —

Descripción:
(a) Ejecución aprobada e instancia `completed` suman ambas.
(b) Revocar no reabre la instancia.
(c) La acción acepta `{sourceApproved:true, sourceRecordId:"x"}` del cliente y completa sin aprobación ni guarda de mes cerrado.
(d) Las `evidenceRef` descriptivas hacen fallar el enlace y la instancia queda pendiente para siempre.
El programa 2026 usa `legacy_grid`, por eso es latente.

Evidencia: PGLITE R3 (a, b). CÓDIGO (c, d).

Cómo reproducir: ver la reproducción R3 del agente de integración (scratchpad).

Resultado actual: Latente.

Resultado esperado: Una sola fuente de "ejecutado" por celda y metadatos derivados en el servidor.

Impacto en producción: Se activa en cuanto se usen actividades del constructor nuevo.

Causa probable: Migración a medias entre la grilla y las instancias.

Solución recomendada: Excluir ejecuciones con `scheduledInstanceId` del conteo, reabrir la instancia al revocar y derivar los metadatos del registro fuente.

Esfuerzo estimado: Medio

Bloquea producción: No
```

```text
ID: PREV-I09
Severidad: 🟡 IMPORTANTE
Área: Evidencias / Casos borde
Título: Archivos de 10 a 25 MB se rechazan con el mensaje "Body inválido: se esperaba multipart/form-data."

Archivo(s): proxy.ts; app/api/prevencion/pdtp/evidence/route.ts; next.config.ts
Línea(s): proxy.ts:125-128 (el proxy intercepta /api); route.ts:19, 53-54, 87 (límite declarado de 25 MB); sin `proxyClientMaxBodySize` (el default de Next es 10 MB)
Ruta/pantalla: formulario "Registrar ejecución"
Endpoint: POST /api/prevencion/pdtp/evidence
Rol afectado: todos los que suben actas escaneadas

Descripción: El cuerpo se trunca en el proxy a 10 MB y el handler falla al parsear.

Evidencia: NAVEGADOR. PDF válido de 12 MB → 400 y alerta "Body inválido: se esperaba multipart/form-data."; el diálogo queda abierto y no se crea fila. Afecta también las rutas de 25 MB de inspecciones y TI (según el código).

Cómo reproducir:
1. Registrar una ejecución.
2. Adjuntar un PDF de 12 MB.
3. Guardar.

Resultado actual: Error técnico engañoso.

Resultado esperado: Aceptar hasta 25 MB, o rechazar en el cliente con "El archivo supera 10 MB".

Impacto en producción: Las actas escaneadas suelen superar 10 MB.

Causa probable: Límite del proxy de Next no configurado.

Solución recomendada: Configurar `experimental.proxyClientMaxBodySize` (o excluir las rutas de subida del matcher) y validar el tamaño en el cliente.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I10
Severidad: 🟡 IMPORTANTE
Área: Integración
Título: La N°88 envía a Campañas, que ya no acredita, y la UI de Campañas promete una auto-acreditación que no ocurre

Archivo(s): lib/services/pdtp-adapters/fulfillment-contract-2026.ts; app/(app)/prevencion/campanas/campanas-client.tsx; lib/services/pdtp/instruments.ts
Línea(s): fulfillment-contract-2026.ts:299-302; campanas-client.tsx:207-236; instruments.ts:249-257
Ruta/pantalla: /pendientes → /prevencion/campanas
Endpoint: closeCampaign
Rol afectado: responsables de la N°88

Descripción: Desde b5ff6c1f las campañas no acreditan, pero el destino, la compuerta de instrumento y el texto "Confirmar y Acreditar PDTP" siguen apuntando ahí.

Evidencia: CÓDIGO.

Cómo reproducir:
1. Abrir la tarea de la N°88 desde /pendientes.
2. Cerrar la campaña.
3. Revisar el PDTP.

Resultado actual: Sin acreditación, pese a lo que promete la pantalla.

Resultado esperado: Destino CAM-07 en Capacitación y texto corregido.

Impacto en producción: Trabajo registrado que no cuenta.

Causa probable: Migración de campañas a capacitación incompleta.

Solución recomendada: Actualizar el destino, el instrumento y el copy.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I11
Severidad: 🟡 IMPORTANTE
Área: Validación
Título: La fecha de reporte de obligaciones la envía el cliente y se puede antedatar

Archivo(s): lib/validation/prevention-module/pdtp.ts; lib/services/pdtp/obligations.ts; lib/services/pdtp/compliance.ts
Línea(s): pdtp.ts:436; obligations.ts:229; compliance.ts:160
Ruta/pantalla: /prevencion/pdtp/obligaciones
Endpoint: reportPdtpObligationAction
Rol afectado: ejecutores

Descripción: `closed_on_time` compara `reportedAt <= dueAt` con un valor que llega del cliente. La UI no lo envía, pero un POST armado sí.

Evidencia: CÓDIGO.

Cómo reproducir: POST a la server action con `reportedAt` anterior a `dueAt`.

Resultado actual: Cierre tardío contado "a tiempo".

Resultado esperado: `reportedAt` fijado por el servidor.

Impacto en producción: Indicadores de plazo (RE-20) manipulables.

Causa probable: Campo aceptado en el esquema.

Solución recomendada: Quitarlo del esquema y usar `now()`.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I12
Severidad: 🟡 IMPORTANTE
Área: Performance
Título: El tablero hace del orden de 20 consultas por faena y cálculos duplicados; el pool es de 10 conexiones

Archivo(s): app/(app)/prevencion/pdtp/page.tsx; app/(app)/prevencion/pdtp/[programId]/page.tsx; lib/services/pdtp/compliance.ts; lib/services/pdtp/sheets.ts; db/index.ts
Línea(s): page.tsx:123-205; compliance.ts:373-378 (nómina ×12 meses), 641, 808-809, 1032; sheets.ts:201-203; db/index.ts:16 (`max: 10`)
Ruta/pantalla: /prevencion/pdtp, /prevencion/pdtp/[programId]
Endpoint: —
Rol afectado: todos

Descripción: `getPdtpComplianceIndicators` recalcula programa, actividades y grilla por faena. La ficha del programa lo calcula dos veces. No hay `React.cache`.

Evidencia: CÓDIGO (estimación estática). NAVEGADOR: con el fixture, 0,8–1,5 s por página (no representativo del volumen real).

Cómo reproducir: medir con `npm run perf:queries` o con logging de consultas sobre el programa 2026 con 10 faenas.

Resultado actual: Más de 200 consultas estimadas con 10 faenas.

Resultado esperado: Carga única por programa, reutilizada entre faenas.

Impacto en producción: Latencia y agotamiento del pool en horas punta.

Causa probable: Composición de servicios sin memoización.

Solución recomendada: `React.cache` en las lecturas base, nóminas por lote y reutilizar `base` en `getPdtpIntegralCompliance`.

Esfuerzo estimado: Medio

Bloquea producción: No
```

```text
ID: PREV-I13
Severidad: 🟡 IMPORTANTE
Área: Observabilidad
Título: No hay captura de errores ni chequeo de integridad entre la base y los archivos de evidencia

Archivo(s): instrumentation.ts; lib/services/platform-health.ts; scripts backup-restore-drill.sh / backup-storage.sh (ver docs/deploy/RESPALDOS_Y_RESTAURACION.md)
Línea(s): instrumentation.ts (solo `validateEnv`); platform-health.ts:55-60; backup-storage.sh:25-32
Ruta/pantalla: —
Endpoint: /api/health
Rol afectado: operación

Descripción: No hay Sentry ni `onRequestError`. El health solo prueba que storage acepte escritura. Una evidencia desaparecida responde el mismo 404 que un acceso denegado, sin log. El respaldo sí incluye `STORAGE_PATH`, pero el ensayo de restauración solo prueba PostgreSQL, y `backup-storage.sh` sale con 0 si falta el destino.

Evidencia: CÓDIGO.

Cómo reproducir: borrar un archivo referenciado en un entorno de prueba y observar que nada alerta.

Resultado actual: Si desaparecen evidencias de 40 actividades, nadie lo detecta hasta que un auditor hace clic. Se recupera del respaldo nocturno (retención de 30 días) solo lo que la base aún referencia, y sin checksum para verificarlo.

Resultado esperado: Escaneo periódico de referencias contra disco, alerta, log del ENOENT y sha256 guardado.

Impacto en producción: Pérdidas silenciosas.

Causa probable: La observabilidad no cubre el storage.

Solución recomendada: Agregar PDTP a `operational-integrity-scan`, guardar sha256 por archivo, loguear ENOENT con nivel `warn` e incluir storage en el ensayo de restauración.

Esfuerzo estimado: Medio

Bloquea producción: No
```

```text
ID: PREV-I14
Severidad: 🟡 IMPORTANTE
Área: UX
Título: Mensajes contradictorios y jerga en pantallas clave

Archivo(s): app/(app)/prevencion/pdtp/[programId]/page.tsx y componentes de habilitación; aprobaciones
Línea(s): no identificadas con precisión
Ruta/pantalla: /prevencion/pdtp/[programId]; /prevencion/pdtp/aprobaciones
Endpoint: —
Rol afectado: todos

Descripción:
(a) Un programa ACTIVO muestra "0 de 3 actividades listas para ejecutar · 3 frenan la firma del programa" y "Versión congelada: Pendiente" (captura 04).
(b) Las aprobaciones se rotulan "✓ M7S1 / ✗ M7S1", sin nombre de mes ni semana legible.
(c) El KPI "Ejecutadas" dice "Ejecuciones registradas" pero muestra ejecuciones aprobadas con tope.

Evidencia: NAVEGADOR (capturas 01 y 04).

Cómo reproducir: abrir la ficha de un programa activo y la bandeja de aprobaciones.

Resultado actual: El usuario no sabe si el programa está firmado ni qué aprueba.

Resultado esperado: Mensajes coherentes con el estado ("Firmado y vigente"), "Julio · semana 1" y rótulos exactos.

Impacto en producción: Confusión en la operación diaria y en la revisión de jefatura.

Causa probable: Componentes de la etapa de firma reutilizados en estado activo.

Solución recomendada: Condicionar los textos al estado del programa y reemplazar los códigos por etiquetas.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I15
Severidad: 🟡 IMPORTANTE
Área: Cálculo / Semántica
Título: El "Cumplimiento anual" es avance contra el plan de todo el año; no existe un cumplimiento "a la fecha"

Archivo(s): lib/services/pdtp/compliance.ts; app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx; app/(app)/prevencion/pdtp/programas/page.tsx
Línea(s): compliance.ts:549 (comentario explícito), 589-593; pdtp-indicators-panel.tsx:84-98; programas/page.tsx:118
Ruta/pantalla: ficha del programa y /programas
Endpoint: —
Rol afectado: jefatura

Descripción: Los meses futuros entran al denominador. En septiembre, con todo lo exigible hecho, el panel muestra ~75 % en rojo contra la meta del 90 %. Solo la tarjeta del dashboard general muestra el "avance esperado".

Evidencia: CÓDIGO. Con el ejemplo del enunciado el código da 75 %; el cumplimiento "a la fecha" sería 60/70 = 85,7 % y ninguna pantalla lo muestra.

Cómo reproducir: revisar un programa a mitad de año sin atrasos.

Resultado actual: Parece incumplido.

Resultado esperado: Mostrar las dos cifras, "cumplimiento a la fecha" y "avance anual", rotuladas.

Impacto en producción: Lecturas erróneas de la jefatura.

Causa probable: Definición de indicador sin rotular.

Solución recomendada: Agregar el cumplimiento a la fecha (plan vencido) y rotular el anual como avance.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

```text
ID: PREV-I16
Severidad: 🟡 IMPORTANTE
Área: Integración
Título: No se puede cerrar una inspección de una faena fuera de la membresía del programa, y los errores permanentes bloquean el reconciliador

Archivo(s): lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts; lib/services/pdtp/fulfillment.ts; lib/services/pdtp/backlog.ts
Línea(s): pdtp-accreditation-connectors.ts:~153-159; fulfillment.ts:571-575; backlog.ts:222-236
Ruta/pantalla: cierre de inspección; panel de backlog
Endpoint: —
Rol afectado: inspectores; prevención

Descripción: El conector relanza cualquier error distinto de "sin programa" y aborta el cierre del run. Los eventos de faenas no miembro quedan en `error` para siempre, ocupan los primeros 200 del reconciliador y no se ven en el panel.

Evidencia: PGLITE R4 (a nivel de conector). CÓDIGO.

Cómo reproducir: cerrar una inspección con plantilla vinculada en una faena que no pertenece al programa.

Resultado actual: El cierre falla.

Resultado esperado: El cierre se completa y el evento queda "no aplica por faena".

Impacto en producción: Trabajo de terreno bloqueado y reintentos que no avanzan.

Causa probable: Tolerancia de errores demasiado estrecha.

Solución recomendada: Tratar "faena no miembro" como omisión con estado propio y excluirla del reconciliador.

Esfuerzo estimado: Bajo

Bloquea producción: No
```

### 7.4 Mejoras

Cada una en el formato pedido, condensado.

```text
ID: PREV-M01 · Severidad: 🔵 MEJORA · Área: Integridad · Título: No hay índice único "un programa activo por año"
Archivo(s): db/schema/prevention/pdtp.ts; lib/services/pdtp/lifecycle.ts · Línea(s): lifecycle.ts:462-463 · Ruta: — · Endpoint: activatePdtpProgram · Rol: prevención
Descripción/Evidencia: solo lo garantiza la aplicación; dos activaciones concurrentes podrían dejar dos activos (CÓDIGO, teórico).
Reproducir: activaciones concurrentes · Actual: posible duplicado · Esperado: índice parcial `(year) WHERE status='active'`
Impacto: bajo · Causa: invariante en código · Solución: índice parcial · Esfuerzo: Bajo · Bloquea: No
```

```text
ID: PREV-M02 · Severidad: 🔵 MEJORA · Área: Evidencias · Título: Se puede "adoptar" un archivo existente y la extensión se toma del nombre del cliente
Archivo(s): lib/services/pdtp/executions.ts; app/api/prevencion/pdtp/evidence/route.ts; lib/services/prevention-documents/utils.ts · Línea(s): executions.ts:101-135; route.ts:100; utils.ts:201-205 · Endpoint: POST evidence, markPdtpExecution · Rol: ejecutores
Descripción/Evidencia: `markPdtpExecution` acepta cualquier ruta existente en `pdtp-evidence/`; la búsqueda de descarga es `LIKE %name%`; un PNG renombrado `.pdf` se sirve como PDF (CÓDIGO; los nombres nanoid(20) lo hacen teórico).
Actual: vínculo sin dueño · Esperado: tabla de subidas con dueño y faena, igualdad exacta y extensión según el tipo detectado · Esfuerzo: Bajo · Bloquea: No
```

```text
ID: PREV-M03 · Severidad: 🔵 MEJORA · Área: Modelo de datos · Título: El estado de cumplimiento vive en 4 tablas y `evidence_status` no tiene lector
Archivo(s): db/schema/prevention/pdtp.ts:660, 703, 754, 759, 843-889 · Rol: desarrollo
Descripción/Evidencia: ejecuciones, instancias, obligaciones y desvíos más un estado derivado en `period.ts:16`; `markPdtpExecution` nunca actualiza `evidence_status` (BD: una ejecución de obligación quedó `provided` con solo texto).
Esperado: un estado de celda canónico · Esfuerzo: Alto · Bloquea: No
```

```text
ID: PREV-M04 · Severidad: 🔵 MEJORA · Área: Integridad · Título: Cascadas destructivas sin defensa en la base
Archivo(s): db/schema/prevention/pdtp.ts · Línea(s): 378, 712, 845, 915, 1067 · Endpoint: SQL/scripts
Descripción/Evidencia: borrar un programa arrastra ejecuciones, cierres firmados y change log; la app solo lo permite en borrador, pero un script o SQL manual lo borra todo. `rollbackPdtpImportBatch` (imports.ts:822-900) borra ejecuciones aprobadas si no hubo change log, y las aprobaciones no escriben en él.
Esperado: `ON DELETE RESTRICT` en ejecuciones y cierres, y guarda de estado en el rollback · Esfuerzo: Bajo · Bloquea: No
```

```text
ID: PREV-M05 · Severidad: 🔵 MEJORA · Área: Seguridad · Título: El paso JDPR solo excluye al elaborador, no a quien envió a revisión
Archivo(s): lib/services/pdtp/approval-flow.ts · Línea(s): 29, 247 · Endpoint: decidePdtpApprovalStepAction · Rol: prevencionista
Descripción/Evidencia: un prevencionista que no creó el programa puede editarlo, enviarlo y aprobarlo como JDPR; el paso Legal sigue exigiendo a un tercero (CÓDIGO).
Esperado: comparar también con `reviewStartedByUserId` · Esfuerzo: Bajo · Bloquea: No
```

```text
ID: PREV-M06 · Severidad: 🔵 MEJORA · Área: Seguridad · Título: El token público de acuse no expira y permite acusar permisos cerrados
Archivo(s): lib/services/prevention-ack-token.ts; lib/services/prevention-permits.ts:653, 665 · Endpoint: /acuse
Descripción/Evidencia: HMAC de 256 bits, un solo uso, rate limit en el POST; sin expiración ni chequeo de estado (CÓDIGO).
Esperado: expiración y validación de estado · Esfuerzo: Bajo · Bloquea: No
```

```text
ID: PREV-M07 · Severidad: 🔵 MEJORA · Área: Integridad · Título: Obligaciones agrupadas por mes sin mirar el año
Archivo(s): lib/services/pdtp/compliance.ts · Línea(s): 158
Descripción/Evidencia: una obligación de diciembre que vence en enero suma al enero del mismo programa y cambia un mes cerrado (CÓDIGO).
Esperado: filtrar por el año del programa · Esfuerzo: Bajo · Bloquea: No
```

```text
ID: PREV-M08 · Severidad: 🔵 MEJORA · Área: Testing · Título: Faltan pruebas de caminos sensibles
Archivo(s): e2e/pdtp-*.spec.ts; lib/__tests__
Descripción/Evidencia: ningún E2E sube evidencia (`setInputFiles`) ni cubre aprobar tras cargar; no hay test de "quien registró no puede aprobar"; `startPdtpScheduledInstance` sin prueba; dos suites PGlite fuera de `tests/pglite-files.ts` (`prevention-campaigns`, `prevention-incidents-re20`); los tests de revocación fijan B01 como correcto.
Esperado: regresiones para B01, B02, B03, I09 y segregación · Esfuerzo: Medio · Bloquea: No
```

```text
ID: PREV-M09 · Severidad: 🔵 MEJORA · Área: Mantenibilidad · Título: Archivos grandes y consultas sin paginar
Archivo(s): lib/services/prevention-inspections.ts (3.368 líneas); app/(app)/prevencion/inspecciones/[runId]/inspection-run-detail.tsx (2.308); lib/services/pdtp/obligations.ts:429 (sin límite); pdtp_executions sin índice que empiece por `activity_id`; índice redundante `pdtp_executions_scheduled_instance_idx`
Esperado: dividir por responsabilidad, paginar e indexar · Esfuerzo: Medio · Bloquea: No
```

```text
ID: PREV-M10 · Severidad: 🔵 MEJORA · Área: Dependencias · Título: vitest con vulnerabilidad moderada (solo desarrollo)
Archivo(s): package.json · Evidencia: `npm audit` → 0 críticas, 0 altas, 3 moderadas (GHSA-82fw-gwwq-j7x9); `check:security-audit` exit 0 con allowlist que vence el 2026-10-28
Esperado: subir vitest · Esfuerzo: Bajo · Bloquea: No
```

### 7.5 Cosméticos

```text
ID: PREV-K01 · Severidad: ⚪ COSMÉTICO · Área: UX · Título: El "Control de cambios" muestra identificadores internos
Ruta: /prevencion/pdtp/[programId] · Evidencia: NAVEGADOR (captura 05): "obligation:pdtp-obligation-gkQ_EOjgb7s1BqTLxeTU4", "assignee:78", "closure:2026-05"
Esperado: "Obligación N°2 · Faena E2E" · Esfuerzo: Bajo · Bloquea: No
```

```text
ID: PREV-K02 · Severidad: ⚪ COSMÉTICO · Área: Errores · Título: La subida devuelve mensajes de filesystem con 400
Archivo(s): app/api/prevencion/pdtp/evidence/route.ts:109-110 · Evidencia: CÓDIGO; puede exponer la ruta absoluta
Esperado: 500 con un mensaje genérico y el detalle en el log · Esfuerzo: Bajo · Bloquea: No
```

```text
ID: PREV-K03 · Severidad: ⚪ COSMÉTICO · Área: Exportación · Título: El export de integridad documental no usa `sanitizeCell`
Archivo(s): app/api/prevencion/documentacion/integrity/export/route.ts:40 · Evidencia: CÓDIGO; ExcelJS guarda texto, el impacto real es mínimo
Esperado: consistencia con el resto de exportaciones · Esfuerzo: Bajo · Bloquea: No
```

---

## 8. Auditoría del flujo principal

| Eslabón | Estado | Observación |
|---|---|---|
| **Programa** | ✅ | Ciclo de vida robusto con digest y segregación. El año siguiente y la v+1 pierden configuración (C03, C05). |
| **Actividad** | ✅ | Catálogo con revisiones inmutables, recurrencias, eventos, mínimo anual, faenas y responsables. |
| **Submódulo** | 🟡 | ~14 submódulos acreditan (inspecciones en la misma transacción, capacitación con outbox, el resto post-commit con libro durable). Resolución por número fijo 2026; N°88 obsoleta. |
| **Ejecución** | 🟡 | Registro y aprobación con segregación (verificado). Sin control de autor sobre la celda (B03, I03). |
| **Evidencia** | 🔴 | Opcional por defecto (B02). Reemplazable y perdible (B03). >10 MB rota (I09). Enlaces de integración y CAPA con 404 (I05). Anulación de la fuente no refleja (B01). |
| **Cumplimiento** | 🔴 | N/A bien excluido (75 % en el ejemplo). Manual más integración se suman y el tope mensual compensa ceros (C02). N/A sin revisión (C07). |
| **Indicadores** | 🔴 | Cifras divergentes entre vistas (C01). Atrasos ocultos (C06). "Anual" sin "a la fecha" (I15). |

**Conclusión:** el flujo existe y funciona de punta a punta. Lo que no es confiable es la calidad del dato que produce, en la evidencia y en el porcentaje.

---

## 9. Resultado de la prueba de realidad

La simulación completa de 10 actividades no fue posible en navegador. El fixture E2E trae un programa con 2 actividades activas en la faena y sin conectores, y la clonación del programa 2026 real a una base desechable fue denegada por el entorno. Se ejecutó lo que el entorno permitía y el resto se cubrió con suites deterministas:

| Caso | Cómo se probó | Resultado |
|---|---|---|
| Actividad con fecha única | N°1, enero S1, aprobada (fixture) | ✅ Cuenta en plan y ejecutado |
| Actividad mensual / recurrente | `schedule-definition.test.ts`, `schedule-presets` (PASS) | ✅ Servicio; no recorrida en navegador |
| Actividad "cuando corresponda" | Obligación de "Inducción a trabajador nuevo E2E" creada por E2E, reportada con texto | 🟡 Queda `submitted` con `evidence_status=provided` y solo texto; entra al denominador como `closed_on_time` (plan 2 · ejecutado 1 = 50 %) |
| Actividad con evidencia documental | Registro con acta-A.pdf (NAVEGADOR) | ✅ Archivo guardado y descargable; 🔴 luego perdido al sobrescribir (B03) |
| Actividad cumplida desde otro submódulo | PGlite `pdtp-fulfillment` y otros 16 archivos (360 tests PASS); R1/R2 | 🟡 Acredita; 🔴 anular después de aprobar no revierte (B01); se suma con la carga manual (C02) |
| Actividad no realizada | E2E `pdtp-desvios` (PASS) | ✅ Motivo visible, E = 0 en el RE-36, retiro devuelve a pendiente |
| Actividad no aplicable | E2E `pdtp-annual-adjustments` (exclusión por faena, PASS) | ✅ Sale del denominador; 🟠 sin revisión (C07) |
| Actividad atrasada | No reproducible con el fixture | 🔴 Por código, un atraso de un mes anterior se ve "No programada en este período" (C06) |
| Actividad futura | Registro en semanas no planificadas (NAVEGADOR: Jun S1, Ago S2/S3, Sep S4) | 🟡 Se aceptan ejecuciones fuera de plan; no suben el % (tope por mes) pero sí la planilla ("1 / 5") |
| Múltiples ejecuciones | N°1 con 5 ejecuciones en distintos estados | 🔴 La planilla muestra 5 incluyendo rechazada y pendiente (C01) |
| Ejecución sin evidencia aprobada | NAVEGADOR | 🔴 Aprobada y contada (B02) |
| Doble envío | NAVEGADOR | ✅ Una sola fila |
| Archivo de 12 MB | NAVEGADOR | 🔴 Error engañoso (I09) |
| Acceso de otra faena a la evidencia | NAVEGADOR | ✅ 404 |

**Pendiente para cerrar esta sección:** repetir la simulación sobre una copia desechable del programa 2026 real con al menos inspecciones, capacitación, EPP y CGRD. Requiere autorizar la clonación de la base de desarrollo.

---

## 10. Problemas de arquitectura y datos

- **Estado de cumplimiento fragmentado** en ejecuciones, instancias, obligaciones y desvíos, con transición a medias entre la grilla y las instancias (M03, I08). Es la raíz de C01, C02 e I08.
- **Evidencia como columnas escalares** de la ejecución, sin tabla, hash ni versiones (B03, I04, I13).
- **Fórmula de cumplimiento duplicada en 10 lugares** (C01).
- **Versionado por filas nuevas sin consolidación** (C05) y **Base atada a 2026** (C03).
- **Integraciones resueltas por número de actividad** y no por identidad de catálogo en la mayoría de los conectores (C03).
- Lo positivo: transacciones y advisory locks por celda, índices únicos de idempotencia, CHECKs de estados y motivos, cierres con digest, catálogo con revisiones inmutables (trigger en 0297). `db:verify-migrations`: 329 entradas hasta 0328, checksums OK.

## 11. Seguridad y permisos

- **Verificado en navegador:** guardas de servidor por URL directa para 3 roles; descarga de evidencia bloqueada entre faenas; segregación ejecución ≠ aprobación.
- **Vulnerabilidad demostrada:** sobrescritura de un envío ajeno (B03).
- **Riesgos de diseño:** ejecución por no asignados y por roles globales no operacionales (I03); N/A sin revisión (C07); `reportedAt` del cliente (I11).
- **Latente:** `sourceMetadata` forjable en la acción de instancias, hoy sin UI (I08).
- Sin XSS encontrado (sin `dangerouslySetInnerHTML` con datos de usuario). Magic bytes en subidas, `nosniff`, CSP con nonce, chequeo de origen de server actions por defecto de Next 16, `SameSite=Lax`.
- No hay rate limiting en server actions autenticadas (mejora, no descontada).

## 12. Testing

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| Unitarias de Prevención (non-PGlite, 212 archivos) | 198 archivos PASS, 14 omitidos (suites `*-postgres` sin variables); **1.518 tests PASS**, 0 fallos |
| PGlite de Prevención (74 archivos) | **1.010/1.010 PASS** |
| PGlite de integración (17 archivos) | 360/360 PASS |
| E2E `pdtp-*` (16 specs) | **60 PASS, 1 omitida** (un `test.skip` condicional por falta de datos en el fixture, en `pdtp-habilitacion` o `pdtp-contexto-ida-vuelta`) |
| E2E `prevencion-*` (28 specs) | **87/87 PASS** |
| `npm run db:verify-migrations` | PASS (329 entradas) |
| `npm run check:security-audit` | PASS (allowlist vigente hasta 2026-10-28) |
| Suites `*-postgres` (14) | **No ejecutadas**: requieren crear una base; en CI sí están conectadas |
| `npm run test:e2e` completo | **No ejecutado** |

**Cobertura de caminos críticos:** crear programa, crear actividad, asignar responsable, registrar ejecución, porcentaje, no realizada, no aplica, editar y permisos tienen pruebas. **Huecos:** E2E de evidencia con aprobación, test de autoaprobación de ejecuciones, `startPdtpScheduledInstance`, y la lectura del historial (M08). Varios tests PGlite **fijan el comportamiento de B01 como correcto**: al corregirlo habrá que cambiarlos.

## 13. UX/UI

- **Bien:** estructura con `PageHeader`/`PageContainer`; 4 KPI accionables; estados vacíos con CTA y en lenguaje de usuario; toasts de éxito y error; ninguna ruta con errores de consola ni fallos de red (30 rutas en escritorio y 6 en móvil); sin overflow horizontal de página a 390 px.
- **Mal:** cifras contradictorias (C01); en móvil no se puede pulsar "Registrar" (I01); un programa activo dice que las actividades "frenan la firma" (I14); códigos "M7S1" en aprobaciones; IDs crudos en el control de cambios (K01); error técnico con archivos >10 MB (I09).
- **Test de 5 segundos:** en el tablero, "¿qué porcentaje llevo?" tiene tres respuestas visibles. En la planilla, "¿ya cumplí?" se contesta con un "1 / 5" que incluye rechazos.

## 14. Performance y operación

- Tablero con abanico de consultas por faena y cálculos duplicados (I12). No medido con el volumen real.
- **Operación:** crons de Prevención sin agendar en producción (C04). Sin Sentry. Health sin chequeo de integridad de archivos. Respaldo cifrado de base más storage con 30 días de retención y procedimiento documentado, pero el ensayo de restauración no cubre storage (I13).
- **Respuesta a "¿40 evidencias desaparecidas?":** hoy no se detectaría. Si la base aún las referencia, se recuperan del `storage.tar.gz.gpg` nocturno dentro de la retención, sin poder verificar su integridad. Si la referencia se sobrescribió (B03) o la fila se borró por un rollback de importación (M04), no queda rastro.

## 15. Lo obligatorio antes de producción

- [ ] **B01:** anular la fuente devuelve la ejecución aprobada a revisión (o la encola visiblemente) y se registra en el evento.
- [ ] **B02:** evidencia obligatoria por defecto para "Se hizo", revalidada al aprobar; la excepción se declara por actividad.
- [ ] **B03:** no sobrescribir envíos ajenos; evidencia append-only por intento, con autor, fecha, sha256 y motivo de rechazo (resuelve también I04 y habilita un GC seguro).
- [ ] **C04:** agendar los crons de Prevención (recordatorios y reconciliador); decidir el GC después de B03.
- [ ] **C01:** una sola fórmula de cumplimiento sobre aprobadas en tablero, programas, planilla, Excel y reporte (condición para que la jefatura use el tablero).
- [ ] Regresiones deterministas para B01, B02 y B03 (PGlite más un E2E de carga de evidencia y aprobación).

## 16. Recomendable inmediatamente después

- [ ] C02: deduplicar por celda, topar por actividad y poner un máximo a la cantidad.
- [ ] C06: atraso acumulado.
- [ ] C07: N/A con revisión y visible junto al %.
- [ ] I01: registro accesible en móvil.
- [ ] I02: no cerrar el mes en curso.
- [ ] I03: validar la asignación al registrar.
- [ ] I05: enlaces de evidencia por origen.
- [ ] I06: expediente de auditor con criterio real de evidencia.
- [ ] I07: catch estrecho en conectores.
- [ ] I09: límite de 25 MB real.
- [ ] I10: N°88 y textos de Campañas.
- [ ] I11: `reportedAt` del servidor.
- [ ] I14: mensajes y rótulos coherentes.
- [ ] I15: cumplimiento a la fecha.
- [ ] I16: faena no miembro y reconciliador.
- [ ] I13: chequeo de integridad de evidencia y alerta.

## 17. Mejoras futuras

- C03: "copiar desde el año anterior" completo y catálogos y casillas por año. **Obligatorio antes del 01-01-2027**, no antes del lanzamiento.
- C05: vista anual consolidada entre versiones y copia completa en v+1.
- I08: completar la migración a instancias.
- I12: performance del tablero.
- M01 a M10.
- K01 a K03.

**Fuera de alcance (no convertir en requisito):** motor de workflow configurable, firma electrónica avanzada, BI propio, multi-empresa, notificaciones push, app nativa. El módulo ya tiene más superficie de la necesaria. Lo que falta es confiabilidad, no funciones.

## 18. Roadmap hacia producción

```text
FASE 1 — Bloqueadores
  B03 (modelo de evidencia append-only + autoría)  →  B02 (evidencia obligatoria sobre ese modelo)  →  B01 (revocación que reabre revisión)

FASE 2 — Integridad funcional
  C01 (fórmula única)  →  C02 (dedupe/tope por actividad)  →  C06 (atraso acumulado)  →  I15 (a la fecha)  →  I02, I11, M07

FASE 3 — Seguridad y permisos
  I03 (asignación validada)  →  C07 (N/A con revisión)  →  M05, M02, M06

FASE 4 — UX y manejo de errores
  I01 (móvil)  →  I09 (25 MB)  →  I05/I06 (enlaces y expediente)  →  I14, K01  →  I07, I16, I10

FASE 5 — Testing y estabilización
  Regresiones B01–B03, E2E evidencia+aprobación, test de autoaprobación, ajustar los tests que fijan B01  →  C04 (crons) + I13 (integridad/alertas)  →  I12

FASE 6 — Validación final
  Simulación de realidad sobre copia del programa 2026 real con 4+ submódulos  →  suites *-postgres + test:e2e completo  →  recorrido asistido documentado en qa/reports/
  (Antes del 01-01-2027: C03 y C05)
```

## 19. Veredicto técnico

```text
Production Readiness: 54/100

Estado:
Estado de desarrollo significativo (40–59)

Bloqueadores: 3
Críticos: 7
Importantes: 16
Mejoras: 10
Cosméticos: 3

Principal riesgo actual:
El sistema puede declarar actividades como cumplidas sin evidencia, con evidencia de un
registro anulado o tras perder la evidencia original. Además, sus pantallas muestran
porcentajes distintos para el mismo programa. La pregunta central del módulo —qué se hizo y
con qué evidencia— no tiene hoy una respuesta confiable.

Principal fortaleza actual:
Un núcleo sólido y muy probado: ciclo de vida del programa con firmas y digest, segregación
ejecución/aprobación, cierres inmutables, libro durable de acreditaciones con idempotencia,
unos 14 submódulos integrados y más de 2.600 pruebas del módulo en verde.

Condición mínima para producción:
Resolver B01, B02 y B03, con regresiones deterministas. Agendar los crons de Prevención (C04).
Unificar la fórmula de cumplimiento en todas las vistas (C01).

Áreas que NO necesitan seguir creciendo antes del lanzamiento:
Nuevos submódulos o conectores; más tipos de recurrencia o de programación; plantillas y
catálogo; objetivos, cobertura MIPER/legal y matrices de aplicabilidad; exportaciones
adicionales; nuevas vistas del tablero. El esfuerzo debe ir a la confiabilidad de la
evidencia y del porcentaje, no a más funciones.
```

---

### Anexo — Evidencia y entorno

- **Servidor aislado:** `bash e2e/start-server.sh` con `E2E_DATABASE_URL=…/bodega_audit_e2e` (build de producción, puerto 3100). Usuarios QA creados **solo en esa base**: `qa.prev.a`, `qa.prev.b` (rol global de prevención con `pdtp:approve`) y `qa.otra` (otra faena).
- **Capturas:** `qa/reports/2026-09-26-prevencion-readiness/` (01 tablero con cifras divergentes; 02 planilla "1 / 5"; 03 móvil con "Registrar" tapado; 04 programa activo con "frenan la firma"; 05 control de cambios con IDs).
- **Scripts de recorrido y reproducciones PGlite:** en el scratchpad de la sesión. No se versionaron.
- **Limpieza:** los dos PDF subidos en las pruebas se borraron de `storage/pdtp-evidence/` al terminar. La base desechable `bodega_audit_e2e` sigue en el contenedor E2E. El servidor aislado se detuvo; su build reemplazó el directorio `.next`.
