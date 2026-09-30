# Auditoría de production readiness — Prevención · agente **comites** (prefijo CPH-)

**Fecha:** 2026-09-29 · **HEAD:** `11e67621` · **Entornos:** A `:3100` (`bodega_audit_e2e`), B `:3101` (`bodega_audit_real_e2e`, programa 2026 v2 real).
**Alcance:** Comités paritarios (CPHS), Estructura preventiva de la faena, Visitas y coordinación, Indicadores SST.
**Carácter:** diagnóstico. No se corrigió código. La sonda PGlite temporal se copió a `scratchpad/audit/comites/comites-integracion.audit-tmp.test.ts` y se **borró del repo**.

## Resumen

| Submódulo | Nota | Lectura |
|---|---:|---|
| Comités paritarios (CPHS) | **72** | Funcional, requiere correcciones |
| Estructura preventiva de la faena | **86** | Muy próximo |
| Visitas y coordinación | **70** | Funcional, requiere correcciones (en el límite) |
| Indicadores SST | **79** | Funcional, requiere correcciones |

Hallazgos: 🔴 0 · 🟠 0 · 🟡 13 · 🔵 18 · ⚪ 6.

**Cifras de indicadores:** el cálculo coincide con el cálculo a mano en pantalla y en Excel (ver §Indicadores-B). La diferencia es de **presentación**: la pantalla muestra la cifra provisional y el Excel la confirmada, sin rotularlo (CPH-11).

**Integración con el programa (B, programa 2026 v2):**
- N°11 al constituir: acredita, pero quien constituyó no puede aprobar (PRV-02 corregido). Disolver revoca la ejecución directa y **no** la obligación (CPH-01).
- N°9: sólo acredita si la revisión es de una faena; la corporativa no acredita nada (CPH-05).
- N°20: en B es `constancia`; el hecho queda diferido (PRV-22), sin aviso al usuario (CPH-10).
- N°7: se acredita en el mes del indicador (PRV-19 #15 en parte corregido). Reabrir revoca la N°7. Un mes con 0 HH no se puede cerrar (CPH-13) y un mes futuro sí (CPH-12).

---

## Evidencia ejecutada (común)

| Qué | Resultado |
|---|---|
| Unit (non-PGlite): `app/(app)/prevencion/{cphs,indicadores,faenas}`, `app/api/prevencion/indicadores`, `lib/services/prevention-cphs-access.test.ts`, 8 suites `lib/__tests__/*cphs*/*indicator*` | **18 archivos, 162 PASS** (`comites/unit-tests.log`) |
| PGlite: `prevention-cphs-program-persistence`, `prevention-cphs-certification-persistence`, `backfill-cphs-mandatory-sessions`, `pdtp-indicators-reopen-revocation`, `pdtp-preventive-organization-obligation`, `external-engagement-accreditation-connector` | **69 PASS** (`comites/pglite-tests.log`) |
| `prevention-cphs-postgres.test.ts` contra `:55432/bodega_test_audit_cph_cphs` | **20 PASS**, 0 skipped (`comites/pg-cphs.log`) |
| `prevention-indicators-postgres.test.ts` contra `:55432/bodega_test_audit_cph_ind` | **4 PASS**, 0 skipped (`comites/pg-ind.log`) |
| Sonda PGlite propia (5 casos, servicios reales) | PASS; resultados en `comites/probe-result.txt` |
| Recorrido por rol (A) admin, prevfaena, otrafaena, cphs, ti, jt, legal, sup × 13 rutas (1440) | `comites/survey-A-roles.log`: 0 errores de consola; 0 respuestas ≥400 salvo lo indicado; 0 px de desborde |
| Responsive (A admin, B prevfaena) 1440/1024/768/390 | 0 px de desborde de página en todas; capturas en `comites/shots/` |
| Flujos en navegador B: constituir, integrantes, sesión con acta, aprobar N°11 (mismo actor y 2.º actor), revisión por la dirección (faena y corporativa), disolver, 3 coordinaciones, denominadores jul/ago/sep/oct, cierre, reapertura, aprobación N°7 | Scripts `cphs-B-*.mjs`, `coord-B.mjs`, `ind-B*.mjs`, `approve.mjs`; SQL de verificación citado en cada hallazgo |
| Flujos en navegador A: indicadores con cifras controladas, Excel por rol, expediente de certificación, rol `cphs` | `ind-A.mjs`, `cert-A.mjs`, `cphs-role.mjs`; Excel en `comites/export-A-*.xlsx` |

**Datos creados** (todos `QA_CPH_`):
- **B:**
  - comité `cphs-TCiN2UwvGAQ0yydk9h02A` (Horcones, disuelto);
  - revisiones `RD-2026-4ZYZOO` (Horcones) y `RD-2026-UDDOTN` (corporativa), ambas cerradas;
  - coordinaciones `COORD-BNAIOVPE`, `COORD-VIYCYBXW` y `COORD-YQ4VTBMN`, cerradas;
  - denominadores jul–oct de Horcones y períodos sep/oct cerrados; agosto reabierto;
  - ejecuciones N°7 (ago `draft`, sep `approved`, oct `submitted`), N°9 `submitted` y N°11 `draft` revocada.
- **A:**
  - incidentes `QA_CPH_INC-A…E` en `ws-oficina-e2e`, insertados por SQL;
  - denominadores jul/ago aprobados y agosto cerrado;
  - expediente Bronce 2026 en `cphs-e2e-base`.

---

## AUDITORÍA — Comités paritarios (CPHS)

**Rutas:**
- `/prevencion/cphs`
- `/prevencion/cphs/[committeeId]`
- `/prevencion/cphs/[committeeId]/programa`
- `/prevencion/cphs/[committeeId]/certificacion`

**Archivos principales:**
- `app/(app)/prevencion/cphs/**` (acciones en `actions.ts:84-258`)
- `lib/services/prevention-cphs.ts`
- `lib/services/prevention-cphs-program.ts`
- `lib/services/prevention-cphs-certification.ts`
- `lib/services/prevention-cphs-access.ts`
- `lib/prevention/cphs*.ts`
- conectores en `pdtp-accreditation-connectors.ts:290-353`

**Permisos:**
- `prevention:cphs:view/manage/certify` y `prevention:governance:review`.
- Concesiones en `modules/prevention/manifest.ts:1129-1149`; A y B coinciden (SQL de `role_permissions`).

### A. UI/UX/Diseño

- **Estructura correcta:**
  - `PageHeader` y `PageContainer`;
  - un único botón "Nuevo" en el header, con elección entre Comité y Revisión (`cphs-dialogs.tsx:137-161`);
  - alerta de faenas sobre 25 trabajadores sin comité, con CTA "Crear comité";
  - búsqueda del TopBar.
- **Estados y validación:** estados en español con `Badge`. Los mensajes de quórum y paridad son claros: "El comité no cumple los requisitos de validez: …3 titulares por representación".
- **KPI:** los cuatro tiles (`committee-list.tsx:83-100`) **no son accionables** (CPH-14).
- **Pestañas:** son botones propios con `aria-pressed`, no el componente `Tabs`. "Revisión por la dirección (0)" aparece también a quien no tiene el permiso (CPH-37).
- **Acta cerrada:**
  - Después del cierre sólo se ve "ACTA CERRADA · 2 / 2 · 0 acuerdos".
  - El texto del acta, la asistencia nominal, las excusas y los acuerdos no se pueden consultar en ninguna pantalla (CPH-03).
  - La fila de sesión no enlaza a ningún detalle.
- **Fechas:** crudas ISO en la lista ("2026-01-15"; captura `A-admin-1440-_prevencion_cphs.png`) (CPH-32).
- **Texto técnico:** "Sin trabajo del Programa Preventivo pendiente en cphs." (`components/prevention/pdtp-scheduled-activity-panel.tsx:143`) (CPH-32).
- **Quórum:** "Quórum: 2 de 1 requeridos" se lee mal (CPH-33).
- **Orden de secciones:** "Documentos del comité" aparece debajo de la "Zona de riesgo", sin separación (captura `crop-detail-bottom.png`).
- **Estados observados:**

| Estado | Evidencia |
|---|---|
| Sin información | Comité sin integrantes, sin sesiones, sin expediente |
| Con información | — |
| Operación exitosa | Sólo implícita: el diálogo se cierra sin aviso (CPH-15) |
| Operación fallida | Toast "Quien registró el cumplimiento no puede aprobarlo" |
| Permisos insuficientes | `ti`, `legal` y `sup` → `/forbidden`; `otrafaena` → "No encontramos este registro" |
| Cargando | `loading.tsx`, no observado en vivo |
| Error | No observado |

- **Responsive:**
  - 1440/1024/768/390 sin desborde de página.
  - A 390 las tablas hacen scroll interno.
  - Los diálogos de constitución y cierre de acta son usables (`max-h-[75vh] overflow-y-auto`).

### Facilidad de uso

| Tarea (B, `prev`) | Clics | Observación |
|---|---:|---|
| Constituir comité | 5 + texto | El DatePicker de "Mandato hasta" a 2 años exige ~24 clics de "mes siguiente": no hay navegación por año (CPH-16) |
| Agregar 2 integrantes | 14 | 7 por integrante (persona, representación, cargo) |
| **Registrar una sesión con acta** | **6** + 2 textos | Convocar (2) → "Cerrar acta" → marcar 2 asistentes → Cerrar acta. No se puede registrar una sesión pasada sin convocarla antes |
| Aprobar la N°11 (segunda persona) | 3 + motivo | Pide motivo porque la integración no trae archivo |
| Revisión por la dirección (crear + cerrar) | 7 + textos | "Toda la organización" es la opción por defecto y no avisa que no acredita la N°9 (CPH-05) |
| Disolver | 2 + motivo | Sin toast; el estado pasa a "Disuelto" |

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Constituir comité (1 vigente por faena) | ✅ | B: comité creado; índice único (postgres «allows only one active committee») |
| Integrantes titular/suplente, cargo, fuero; renuncia; reemplazo | ✅ | B (2 integrantes); E2E lifecycle; servicio `prevention-cphs.ts:113-329` |
| Validez de composición (3+3, suplentes, cargos) | 🟡 | Se informa, pero no bloquea sesiones ni actas (CPH-20) |
| Convocar / cancelar sesión | ✅ | B; `cancelCommitteeMeeting` exige motivo |
| Cerrar acta con quórum real (ambas representaciones), fecha no futura, acuerdos → CAPA | ✅ | B (2/2); postgres (quórum, futuro, ajenos) |
| Consultar el acta cerrada (texto, asistencia, acuerdos) | ❌ | `committee-detail.tsx:75-91`: `MeetingInfo` no trae `minutes` (CPH-03) |
| Prácticas Plata/Oro (tabla previa, invitado, comisiones, acta a gerencia) | ✅ | E2E maturity (lectura) + UI |
| Programa de trabajo (crear, activar, actividades, completar al cerrar el acta mensual) | ✅ | PGlite persistence; `closeCommitteeMeeting` completa la sesión mandatoria (`prevention-cphs.ts:861-883`) |
| Expediente de certificación Mutual (autoevaluación desde datos) | ✅ | A: Bronce 2026 creado → 4/11 requisitos con fundamento automático |
| Revisión por la dirección (crear, cerrar con conclusiones, compromisos → CAPA) | ✅ | B |
| Anular una revisión cerrada | ❌ | No existe; la N°9 acreditada no tiene revocación (CPH-05, nota) |
| Disolver (motivo) / vencimiento por fecha | ✅ | B: disuelto; `expireLapsedCommittees` (postgres) |

### C. Código y lógica

- **Buen diseño:**
  - servicio con alcance único (`requireCphsAccess`), bloqueo optimista por `version` y estados en el `WHERE` contra carreras (`prevention-cphs.ts:249-260`, `297-308`);
  - mensajes de índices únicos mapeados (`actions.ts:59-64`);
  - M-10 corregido (`prevention-cphs-access.ts:48-51`).
- **Atomicidad:** `constituteCommittee` y `createManagementReview` escriben la fila y el historial fuera de una transacción (`prevention-cphs.ts:70-80`, `904-914`) (CPH-18).
- **Carga del detalle:** el detalle carga **todas** las sesiones del alcance (máximo 300) y filtra por comité (`[committeeId]/page.tsx:39-49`, `prevention-cphs.ts:1093`). Con 300 sesiones en el alcance, las antiguas de un comité desaparecen (TEÓRICO; CPH-17).
- **Comentario obsoleto:** "revisión por la dirección → actividad 14" (`prevention-cphs.ts:986`), cuando la acreditación va a la N°9 (CPH-35).
- **Rótulos con id interno:** "Comité paritario constituido: cphs-…". La pantalla de aprobaciones lo oculta ("Automático: Comité paritario constituido"), así que C-03 sigue corregido en la vista.

### D. Modelo de datos

- **Tablas:**
  - `prevention_committees`, con índice único parcial de comité activo por faena;
  - `…_members`, `…_meetings` (versión y estados), `…_attendance`, `…_agreements` (el estado vive en su CAPA);
  - `…_commissions`, `…_programs`/`…_activities` y `prevention_management_reviews`.
- **Borrado:** no hay borrado físico. Disolver, renunciar, cancelar y reemplazar son lógicos y dejan historial (`recordGovernanceHistory`).
- **Fechas civiles:** `constitutedOn` es texto `YYYY-MM-DD` y viaja al PDTP como `occurredAt` sin hora (CPH-02).

### E. Permisos y seguridad

- **Alcance por faena:**
  - Servidor: `requireCphsAccess(..., worksiteId)` en cada mutación.
  - Lectura: `otrafaena` → "No encontramos este registro" en el comité de otra faena (A y B).
  - Postgres: «denies constitution from a foreign worksite scope».
- **Rol `cphs` (integrante del comité):** tiene `cphs:manage`. En A ve y puede usar "Nuevo comité", "Disolver comité", "Agregar integrante", "Reemplazar", "Renuncia", "Designar delegado" y "Registrar ante la DT" (`cphs-role.mjs`) (CPH-04).
- **Responsables de la N°9 sin permiso:** según `pdtp_activities.responsible_slugs` son `gerente_legal_rrhh`, `jdpr` y `prf`. `gerente_legal_rrhh` y `prevencionista_faena` no tienen `governance:review`: `legal` → `/forbidden` en `/prevencion/cphs` (A) (CPH-05).
- **XSS:** React escapa y no hay `dangerouslySetInnerHTML`. Longitudes acotadas en zod.

### F. Testing

- **Corridas:** unit 162 PASS; PGlite (programa, certificación, backfill) PASS; postgres 20 PASS.
- **E2E existentes (leídos, no corridos):** `prevencion-cphs*.spec.ts` cubren carga, alerta de brecha, ciclo de vida (renuncia, reemplazo, cancelar, disolver) y madurez.
- **Sin E2E:** constitución, cierre de acta con quórum, revisión por la dirección, integración N°9/N°11 y segregación en aprobación (CPH-31).

### G. Integración con Programa Anual (ejecutado en B)

- **N°11 al constituir:**
  - `pdtp_executions` → `submitted`, `origin=integration`, `executed_by=qa-prev`, sept·sem 4, `evidence_status=pending`.
  - Evento `accredited` en `pdtp_fulfillment_events`.
- **Aprobación de la N°11:**
  - `prev`, que constituyó, recibe en `/prevencion/pdtp/aprobaciones` el toast «Quien registró el cumplimiento no puede aprobarlo» y la ejecución sigue `submitted` → **PRV-02 corregido (DEMOSTRADO)**.
  - `prev2` debe dar motivo; queda `approved` con `approvalReason`.
- **Disolver:**
  - La N°11 aprobada pasa a `draft` con `revokedAt` y motivo; el evento `revoked` queda en el libro.
  - La sonda PGlite muestra que la constitución genera **dos** ejecuciones N°11 para el mismo hecho: directa (`cphs`) y la que cierra la obligación (`organizacion_preventiva`). Disolver revoca sólo la directa; la obligación queda `reported` (CPH-01).
- **N°9:** una revisión de Horcones → `submitted`, `executed_by=qa-prev`, sept·sem 4. La revisión corporativa cerrada → **ninguna ejecución** (`prevention-cphs.ts:988`) (CPH-05).
- **Fechas:** la sonda muestra que `constitutedOn=2026-09-01` acredita en **agosto sem 4** (CPH-02). Una constitución y una revisión con fecha futura (diciembre) acreditan en diciembre, `submitted` (CPH-06).
- **Sesiones:** no acreditan PDTP, por diseño (la N°13 salió del catálogo). Sí completan el programa propio del comité.

### H. Hallazgos

```
ID: CPH-01
Severidad: 🟡 IMPORTANTE
Submódulo: CPHS / Estructura preventiva
Categoría: Integración PDTP / Integridad
Título: Disolver o vencer el comité (o terminar un delegado) no revoca la N°11 que cuenta; la constitución crea dos ejecuciones para el mismo hecho
Archivo(s): lib/services/prevention-cphs.ts; lib/services/pdtp-adapters/preventive-organization-connector.ts; lib/services/prevention-cphs-organization.ts
Línea(s): prevention-cphs.ts:84-99 (acredita + reporta obligación), 185-195 (revoca sólo sourceType "cphs"), 1045-1052 (vencimiento, ídem); preventive-organization-connector.ts:187-209; prevention-cphs-organization.ts:158-195 (endDelegate sin revocación)
Pantalla/ruta: /prevencion/cphs/[id] (Disolver), /prevencion/faenas/[id] (Terminar período), /prevencion/pdtp/aprobaciones
Endpoint: dissolveCommitteeAction, endDelegateAction
Rol: prevencionista, prevencionista_faena, cphs
Descripción: al constituir en una faena con brecha abierta se escriben dos ejecuciones N°11: la directa (sourceType cphs) y la que cierra la obligación (sourceType organizacion_preventiva). El indicador closed_on_time de la N°11 sólo mira obligaciones (comentario en prevention-cphs.ts:90-92). Disolver y vencer revocan sólo la directa. La obligación queda "reported" y su ejecución sigue aprobable. Terminar un delegado no revoca nada.
Evidencia: DEMOSTRADO (sonda PGlite, probe-result.txt): sweep abre 1 obligación → constituteCommittee → 2 ejecuciones N°11 submitted (una con obligationId) y obligación reported → dissolveCommittee → la directa pasa a draft; la de la obligación sigue submitted y la obligación reported. En B: la directa aprobada pasó a draft con revokedAt al disolver.
Cómo reproducir:
1. Faena con más de 25 trabajadores y obligación N°11 abierta (barrido diario).
2. Constituir el comité: en Aprobaciones aparecen dos N°11 del mismo hecho.
3. Disolverlo el mismo día: la obligación sigue "reportada" y su ejecución puede aprobarse.
Resultado actual: el cumplimiento que mide el plazo sobrevive a la anulación de su fuente. Hay doble cola de aprobación por un solo hecho.
Resultado esperado: una sola ejecución por hecho, o que la revocación alcance también la ejecución de la obligación cuando la fuente se anula por error (disolución con motivo).
Impacto: la N°11 puede figurar cumplida en plazo con un comité que se constituyó por error y se disolvió.
Causa probable: dos caminos de acreditación para el mismo hecho, y una sola clave de revocación (sourceType cphs).
Solución recomendada: que constituteCommittee acredite sólo por la obligación cuando exista (o dedupe), y que dissolveCommittee/endDelegate revoquen la ejecución de la obligación cuando la disolución invalida el hecho; prueba de regresión PGlite.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-02
Severidad: 🟡 IMPORTANTE
Submódulo: CPHS / Estructura preventiva
Categoría: Integridad de datos / Integración
Título: Las fechas civiles (constitución, designación) se sellan a medianoche UTC y la N°11 del día 1 se imputa al mes anterior
Archivo(s): lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts; lib/services/prevention-cphs.ts; lib/services/prevention-cphs-organization.ts; lib/services/pdtp/accreditation.ts
Línea(s): pdtp-accreditation-connectors.ts:303,312 (occurredAt: constitutedOn); prevention-cphs.ts:88,97; prevention-cphs-organization.ts:146; accreditation.ts:197-205 (new Date(occurredAt) + formato Chile)
Pantalla/ruta: /prevencion/cphs (Constituir), /prevencion/faenas/[id] (Designar delegado)
Endpoint: constituteCommitteeAction, designateDelegateAction
Rol: prevencionista, prevencionista_faena
Descripción: "2026-09-01" se interpreta como 2026-09-01T00:00Z = 31-08 21:00 en Chile. La celda resultante es agosto, semana 4. El 1 de enero caería en el año anterior. El conector de coordinación ya lo resuelve con el mediodía de Chile (external-engagement-accreditation-connector.ts:53-55); CPHS y delegado no.
Evidencia: DEMOSTRADO (sonda PGlite): constitutedOn 2026-09-01 → ejecución N°11 month 8 week 4 (directa y de obligación). En B el fulfillment event quedó occurred_at 2026-09-29 00:00:00+00.
Cómo reproducir: 1. Constituir un comité con fecha 01 de cualquier mes. 2. Ver la celda de la N°11 en la planilla. 3. Aparece en el mes anterior.
Resultado actual: cumplimiento imputado al mes (o año) anterior.
Resultado esperado: el mismo mes civil de la constitución.
Impacto: celdas y plazo de la N°11 corridos un día. Un comité del 1 de enero cae en el programa del año anterior.
Causa probable: se pasa la fecha civil sin hora a un motor que la trata como instante.
Solución recomendada: usar el helper de mediodía (o plannedPeriod desde la fecha civil) en onCphsCommitteeConstituted, onPreventiveOrganizationSatisfied y designateDelegate.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-03
Severidad: 🟡 IMPORTANTE
Submódulo: CPHS
Categoría: Funcionalidad / Trazabilidad
Título: El acta cerrada no se puede consultar: texto, asistencia nominal, excusas y acuerdos no se muestran en ninguna pantalla ni exportación
Archivo(s): app/(app)/prevencion/cphs/[committeeId]/committee-detail.tsx; app/(app)/prevencion/cphs/[committeeId]/page.tsx; app/(app)/prevencion/cphs/committee-list.tsx
Línea(s): committee-detail.tsx:75-91 (MeetingInfo sin minutes/asistentes), 237-292 (fila sin enlace); page.tsx:98-113
Pantalla/ruta: /prevencion/cphs/[id] y pestaña Sesiones de /prevencion/cphs
Endpoint: —
Rol: todos los que ven CPHS
Descripción: closeCommitteeMeeting guarda minutes, asistencia, excusas y acuerdos. La UI sólo muestra código, agenda, "Acta cerrada", "2 / 2" y el número de acuerdos. No hay detalle de sesión, impresión ni Excel del acta.
Evidencia: DEMOSTRADO (B, captura B-cphs-detail-after-acta.png; fila «CPHS-2026-0OHNBT2J … ACTA CERRADA 2 / 2 0 · Enviar acta a gerencia») + CÓDIGO (grep "minutes" sólo aparece en el formulario de cierre).
Cómo reproducir: 1. Cerrar un acta con asistentes y texto. 2. Volver al detalle del comité. 3. No hay forma de leer el acta ni quién asistió.
Resultado actual: el registro legal del comité existe en la base, pero nadie puede verlo desde la plataforma.
Resultado esperado: detalle de sesión (acta, asistentes y excusados, acuerdos con su CAPA) y exportación o impresión.
Impacto: ante una fiscalización o la auditoría de Mutual no se puede mostrar el acta. "Enviar acta a gerencia" registra el envío de algo que la plataforma no permite leer.
Causa probable: la lista se diseñó como tablero de estado.
Solución recomendada: página o hoja de detalle de sesión con el acta y la asistencia, y exportación.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-04
Severidad: 🟡 IMPORTANTE
Submódulo: CPHS / Estructura preventiva
Categoría: Permisos
Título: El rol "cphs" (integrante del comité) puede constituir, disolver y recomponer el comité, y designar delegado
Archivo(s): modules/prevention/manifest.ts
Línea(s): 1129-1130 (cphs → cphs:view y cphs:manage); descripción del permiso en 239
Pantalla/ruta: /prevencion/cphs, /prevencion/cphs/[id], /prevencion/faenas/[id]
Endpoint: constituteCommitteeAction, dissolveCommitteeAction, add/replace/resignCommitteeMemberAction, designateDelegateAction, recordDtRegistrationAction
Rol: cphs
Descripción: cphs:manage es un solo permiso que cubre convocar y cerrar actas (lo propio del comité) y también constituir, que acredita la N°11, y disolver, que la revoca y es terminal. Cubre además cambiar integrantes y fuero, designar delegado y registrar ante la DT.
Evidencia: DEMOSTRADO (A, cphs-role.mjs): con la sesión cphs se ven "Nuevo comité", "Disolver comité", "Agregar integrante", "Reemplazar", "Renuncia", "Designar delegado", "Registrar ante la DT". SQL: role_permissions de cphs en A y B = cphs:manage, cphs:view, indicadores:view.
Cómo reproducir: 1. Entrar como integrante del comité. 2. Abrir el comité. 3. Aparece "Disolver comité".
Resultado actual: un integrante puede anular el órgano y su acreditación.
Resultado esperado: el integrante convoca, registra asistencia y cierra actas. Constituir, disolver y recomponer queda a Prevención.
Impacto: segregación débil sobre el hecho que acredita la N°11.
Causa probable: permiso de gestión grueso.
Solución recomendada: separar un permiso de sesiones (p. ej. cphs:sessions) del de gobierno del comité, y ajustar grants y paridad.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-05
Severidad: 🟡 IMPORTANTE
Submódulo: CPHS (revisión por la dirección)
Categoría: Integración PDTP / Permisos
Título: La revisión corporativa (opción por defecto) no acredita la N°9, y dos de sus tres responsables no tienen el permiso para registrarla
Archivo(s): lib/services/prevention-cphs.ts; app/(app)/prevencion/cphs/cphs-dialogs.tsx; modules/prevention/manifest.ts
Línea(s): prevention-cphs.ts:988-995 (sólo si review.worksiteId); cphs-dialogs.tsx:88,115-116 (default "_all" = Toda la organización); manifest.ts:1136,1141,1144 (governance:review sólo prevencionista, jefa_chome, administrador)
Pantalla/ruta: /prevencion/cphs → Nuevo → Revisión por la dirección
Endpoint: createManagementReviewAction, closeManagementReviewAction
Rol: gerente_legal_rrhh, prevencionista_faena (responsables de la N°9)
Descripción: la N°9 está planificada mensualmente (mar–dic) por faena. La revisión por la dirección es, por naturaleza, corporativa, pero sólo acredita si se ata a una faena. Cubrir 6 faenas exige 6 revisiones por mes, y la corporativa no suma nada, sin aviso. Además responsible_slugs de la N°9 = gerente_legal_rrhh, jdpr, prf; legal y prevencionista_faena no tienen governance:review.
Evidencia: DEMOSTRADO (B): RD-2026-4ZYZOO (Horcones) → N°9 submitted; RD-2026-UDDOTN (corporativa) cerrada → 0 ejecuciones. SQL responsible_slugs ["gerente_legal_rrhh","jdpr","prf"]. Rol legal → /forbidden en /prevencion/cphs (survey A).
Cómo reproducir: 1. Crear una revisión sin cambiar la faena ("Toda la organización"). 2. Cerrarla. 3. La N°9 no cambia en ninguna faena.
Resultado actual: revisión real sin efecto en el programa; los responsables formales no pueden registrarla.
Resultado esperado: la revisión corporativa acredita la N°9 en las faenas del programa (o la N°9 pasa a corporativa). Los responsables tienen el permiso, o el contrato de responsables se corrige.
Impacto: la N°9 aparece incumplida o exige doble registro por faena.
Causa probable: acreditación modelada por faena.
Solución recomendada: acreditar a todas las faenas del programa cuando worksiteId es null, avisar en el diálogo y conceder governance:review a los responsables.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-06
Severidad: 🟡 IMPORTANTE
Submódulo: CPHS
Categoría: Validaciones / Integración
Título: Se aceptan constitución y revisión por la dirección con fecha futura, y acreditan en celdas futuras
Archivo(s): lib/services/prevention-cphs.ts; lib/services/pdtp/accreditation.ts
Línea(s): prevention-cphs.ts:54-64 (constitutedOn sólo regex), 893-898 (heldAt sin cota); accreditation.ts:560-622 (sin guarda de futuro en la vía de integración)
Pantalla/ruta: diálogos "Constituir comité" y "Nueva revisión por la dirección"
Endpoint: constituteCommitteeAction, createManagementReviewAction
Rol: prevencionista, prevencionista_faena
Descripción: el acta de sesión sí rechaza fechas futuras (prevention-cphs.ts:691-698); la constitución y la revisión no. El motor no aplica la guarda PRV-03 a los hechos de integración.
Evidencia: DEMOSTRADO (sonda PGlite): constitutedOn 2026-12-10 → N°11 month 12 week 2 submitted; heldAt 2026-12-15 → N°9 month 12 week 3 submitted.
Cómo reproducir: 1. Constituir con fecha de diciembre. 2. Ver la planilla: N°11 "por aprobar" en diciembre.
Resultado actual: un error de tipeo deja comité "vigente" desde una fecha futura y ejecuciones en meses futuros. La aprobación sí se bloquea hasta esa semana.
Resultado esperado: rechazar fechas futuras en ambos esquemas (como en closeMeetingSchema).
Impacto: celdas mal imputadas y un comité que no existía todavía.
Causa probable: validación omitida.
Solución recomendada: superRefine de no-futuro en committeeSchema y managementReviewSchema; guarda de futuro en accreditPdtpFromEvent (ver CPH-08).
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

Mejoras y cosméticos del submódulo: CPH-14, 15, 16, 17, 18, 20, 32, 33, 35 y 37 (tabla consolidada al final).

### I. Readiness individual: **72/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 20,5 | CPH-03 (−2), CPH-01 (−1,5), CPH-06 (−1) |
| UI/UX y facilidad de uso | 20 | 14,5 | CPH-03 (−2), CPH-14 (−1), CPH-15 (−1), CPH-16 (−0,5), CPH-32/33 (−0,5), aprobar ofrecido a quien no puede (−0,5, ver CPH-19) |
| Integridad de datos | 15 | 10 | CPH-01 (−2), CPH-02 (−1,5), CPH-06 (−1), CPH-18 (−0,5) |
| Integración con Programa Anual | 15 | 9 | CPH-05 (−3), CPH-01 (−2), CPH-02 (−1) |
| Código y mantenibilidad | 10 | 8,5 | CPH-17 (−1), CPH-18/35 (−0,5) |
| Permisos y seguridad | 5 | 2 | CPH-04 (−2), CPH-05 permisos de responsables (−1) |
| Testing | 5 | 3,5 | CPH-31 (−1,5) |
| Manejo de errores | 5 | 4 | CPH-15 (−0,5), CPH-36 (−0,5) |
| **Total** | 100 | **72** | |

### Estado de hallazgos previos en este alcance

| Hallazgo | Dictamen | Evidencia propia |
|---|---|---|
| **PRV-02** (CPHS acredita sin segregación) | **Corregido (verificado)** | B: `prev` (constituyó) rechazado al aprobar la N°11; `prev2` exige motivo y queda `approvalReason` |
| M-10 (`.catch(() => null)` en `prevention-cphs-*`) | **Corregido (verificado)** | `nullIfCphsNotFound` en `prevention-cphs-access.ts:48-51`, usado en `prevention-cphs-program.ts:519` y `prevention-cphs-certification.ts:397` |
| Matriz del 28-09: "la N°9 corporativa no acredita" | **Sigue abierto** | CPH-05, demostrado en B |
| PRV-04 (revocaciones al anular) en CPHS | **Parcial** | Disolver revoca la directa (B) pero no la obligación (CPH-01) |
| C-03 (ids internos en rótulos) | **Corregido en la vista** | Aprobaciones muestra "Automático: Comité paritario constituido"; el id sigue en `evidence_text` en la base |

### Qué no se pudo verificar y por qué

- **Crons:** `expireLapsedCommittees` y el barrido de organización preventiva no se ejecutaron en B (son crons y no hay secreto). Se probaron por PGlite/postgres.
- **E2E:** no se corrió ninguno (prohibido por el brief).

---

## AUDITORÍA — Estructura preventiva de la faena

**Rutas:** `/prevencion/faenas` y `/prevencion/faenas/[worksiteId]`.

**Archivos principales:**
- `app/(app)/prevencion/faenas/**`
- `lib/prevention/cphs-organization.ts`
- `lib/services/prevention-cphs-organization.ts`
- `lib/services/prevention-cphs-organization-read.ts`
- `lib/services/pdtp-adapters/preventive-organization-connector.ts`

**Permisos:** `cphs:view` para ver; `cphs:manage` para designar o terminar delegado y registrar ante la DT (`faenas/actions.ts:34-49`).

### A. UI/UX/Diseño

- **Lista:**
  - KPI **accionables**: los tiles filtran la tabla (`worksite-organization-list.tsx:59-64`).
  - Nombre de faena y comité enlazados.
  - Estado con badge ("AL DÍA"/"BRECHA") y detalle en lenguaje de usuario.
- **Ficha:**
  - dotación activa y declarada, órgano exigible, prevencionista, comité y delegado;
  - "Ir a CPHS" con `?faena=`, que preselecciona la faena en el diálogo.
- **CTA engañosa:** en una faena que exige **comité** (26 trabajadores), la acción primaria verde es "Designar delegado" y "Ir a CPHS" es secundaria (captura `c-faena-det.png`). Designar un delegado allí no cierra la N°11 y no se advierte (CPH-21).
- **Estados observados:**

| Estado | Evidencia |
|---|---|
| Sin información | Sin comité / sin delegado |
| Con información | — |
| Permisos insuficientes | `ti`, `legal`, `sup` → `/forbidden` |
| Fuera de alcance | `otrafaena` → "No encontramos este registro", con HTTP 200 (CPH-36) |

- **Responsive:** sin desborde a 390.

### Facilidad de uso

- Designar delegado: 1 clic + persona + fecha + Designar (4–5 clics).
- Registrar la DT: 2 clics + fecha + folio.
- Se entiende qué exige la dotación.

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Umbrales >25 comité / 10–25 delegado / <10 ninguno; comité cubre tramo delegado | ✅ | `cphs-organization.ts:35-89`; PGlite (25 justos → delegado; 41 + delegado no cierra) |
| Lista y ficha con alcance | ✅ | A/B por rol |
| Designar delegado (misma dotación, uno vigente, vencidos se terminan) | ✅ | `prevention-cphs-organization.ts:58-150`; sonda PGlite |
| Terminar período con motivo | 🟡 | No re-evalúa la brecha hasta el barrido diario ni revoca (CPH-01, CPH-22) |
| Registro ante la DT (fecha ≥ constitución) | ✅ | `prevention-cphs.ts:211-233` |
| Barrido de obligación N°11 (programa activo + membresía) | ✅ | PGlite `pdtp-preventive-organization-obligation` (8 casos PASS) |

### C. Código y lógica

- **Lectura agregada:** 4 consultas agregadas para toda la lista (`prevention-cphs-organization-read.ts:48-115`), compartidas con el barrido. La brecha que ve la pantalla y la que abre la obligación son la misma.
- **M-10 corregido:** `faenas/[worksiteId]/page.tsx:30`.
- **Dotación declarada:** se muestra junto a la del padrón, sin elegir en silencio.

### D. Modelo de datos

- `prevention_worksite_delegates`: versión y estado `active`/`ended`, motivo, sin borrado físico.
- Fechas civiles con el mismo defecto de zona horaria que CPHS (CPH-02).

### E. Permisos y seguridad

- **Alcance:** en servidor (`requireCphsAccess` con `worksiteId`); `otrafaena` no ve Horcones ni `ws-e2e`.
- **Rol `cphs`:** puede designar delegado y registrar la DT (CPH-04).

### F. Testing

- PGlite de organización: PASS; unit `prevention-cphs-organization.test.ts` y `worksite-profile.test.tsx`: PASS.
- No hay E2E de designar ni terminar delegado (CPH-31).

### G. Integración con Programa Anual

- **N°11 por obligación (sonda PGlite):**
  - 30 trabajadores: el barrido abre 1 obligación y la constitución la deja `reported`.
  - 15 trabajadores: designar delegado la deja `reported`.
  - 41 trabajadores + delegado: sigue `pending` (test existente).
- **Terminar delegado o disolver:** la obligación sigue `reported` (CPH-01). El barrido siguiente abre un episodio nuevo.
- **Entorno B:** no hay obligaciones N°11 porque el cron no corrió en esa copia. Cholguan (41 trabajadores) figura con brecha en la pantalla.

### H. Hallazgos

- **Aplican aquí:** CPH-01, CPH-02 y CPH-04 (detallados en CPHS).
- **Propios:** CPH-21 y CPH-22 (🔵) en la tabla consolidada.

### I. Readiness individual: **86/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 22,5 | CPH-01 (−1,5), CPH-21 (−1) |
| UI/UX y facilidad de uso | 20 | 17,5 | CPH-21 (−2), CPH-36 (−0,5) |
| Integridad de datos | 15 | 12 | CPH-02 (−1,5), CPH-01 (−1,5) |
| Integración con Programa Anual | 15 | 12 | CPH-01 (−2), CPH-02 (−1) |
| Código y mantenibilidad | 10 | 9,5 | CPH-22 (−0,5) |
| Permisos y seguridad | 5 | 4 | CPH-04 (−1) |
| Testing | 5 | 4 | CPH-31 (−1) |
| Manejo de errores | 5 | 5 | — |
| **Total** | 100 | **86** | (redondeo de 86,5) |

### Estado de hallazgos previos

| Hallazgo | Dictamen | Evidencia |
|---|---|---|
| **M-10** (`faenas/[worksiteId]/page.tsx:26`) | **Corregido (verificado)** | `.catch(nullIfCphsNotFound)` en `page.tsx:30`; sólo "no existe o fuera de alcance" es 404. Los demás errores se relanzan (`prevention-cphs-access.ts:48-51`) |

### Qué no se pudo verificar

- El barrido real en B (cron).
- Una caída de base provocada, para ver la página de error en vez del 404: no se puede provocar en un servidor compartido.

---

## AUDITORÍA — Visitas y coordinación

**Rutas:** `/prevencion/coordinacion` y `/prevencion/coordinacion/[id]`.

**Archivos principales:**
- `app/(app)/prevencion/coordinacion/**` (3 acciones: crear, agregar medida, cerrar)
- `lib/services/prevention-external-engagements.ts`
- `lib/validation/prevention-module/external-engagements.ts`
- `lib/services/pdtp-adapters/external-engagement-accreditation-connector.ts`
- verificación de evidencia en `lib/services/pdtp/integration-evidence.ts:125-137`

**Permisos:**
- `engagement:view/manage`: prevencionista, prevencionista_faena, admin_contrato y administrador.
- `jefa_chome`: sólo `view`.
- `cphs`, `jt`, `ti`, `legal`, `sup`: `/forbidden` (A).

### A. UI/UX/Diseño

- **Lista:**
  - filtros tipo/faena;
  - aviso de reciprocidad del art. 20 ("falta entregar: Riesgos laborales existentes");
  - estado Abierta/Cerrada con badge;
  - medidas "n/m abiertas".
- **Reglas de página:**
  - "Registrar interacción" es un botón de toolbar dentro del contenido, no una acción del `PageHeader` (regla 5 / A3) (CPH-23).
  - El `EmptyState` no trae CTA (A4) (CPH-23).
- **Detalle** (captura `c-coordB-det.png`):
  - datos, resultado y medidas prescritas;
  - **sin** documentos ni evidencia, sin estado de la N°20 (acreditada, diferida o por aprobar), sin acciones.
  - La fecha sólo aparece en la descripción del header.
- **Diálogo de cierre:** el botón de envío "Cerrar" tiene el mismo nombre accesible que la X del diálogo ("Cerrar"). La automatización cerró el diálogo sin enviar en el primer intento (CPH-34).
- **Feedback:** ni crear ni cerrar muestran toast; la fila simplemente aparece o cambia (CPH-23).
- **Responsive:** a 390 la tabla no tiene tarjetas y la columna de acciones queda fuera de pantalla. A 1440 la columna "Acciones" se corta y la tabla hace scroll interno (captura `c-coordB.png`) (CPH-25).
- **Estados observados:**

| Estado | Evidencia |
|---|---|
| Sin información | Lista vacía en A |
| Con información | 3 interacciones en B |
| Operación exitosa | Implícita |
| Permisos insuficientes | `cphs` → `/forbidden` |
| Fuera de alcance | `otrafaena` en el detalle de Horcones → "No encontramos este registro" |

### Facilidad de uso

| Tarea (B, `prevfaena`) | Clics | Observación |
|---|---:|---|
| Registrar coordinación con mandante | 6 + 3 textos | Faena, tipo de información y fecha |
| Registrar coordinación con contratista | 8 | Hay que cambiar también el tipo de contraparte |
| Cerrar | 2 + resultado | Nada indica qué pasa con la N°20 |
| Adjuntar el acta de la reunión | **imposible desde la UI** | CPH-07 |

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Registrar coordinación, fiscalización o visita OAL, con reglas del art. 20 (dirección, referencia obligatoria en fiscalización) | ✅ | B; zod en `external-engagements.ts:13-40` |
| Fecha de la interacción | 🟡 | Acepta futura: `COORD-YQ4VTBMN` el 2026-12-15 (CPH-08) |
| Medida prescrita → CAPA con responsable y plazo | ✅ | `prevention-external-engagements.ts:127-168` |
| Cerrar con gate de medidas abiertas (FOR UPDATE) | ✅ | `:170-212` |
| Editar, anular, reabrir una interacción | ❌ | No existen. El mensaje "reábrela para agregar medidas" (`:135`) promete una función inexistente (CPH-09) |
| Adjuntar acta o correo | ❌ | El card de vínculos no ofrece `external_engagement` (`documentacion/[id]/document-links-card.tsx:16-25`) aunque el servidor lo acepta (`prevention-documents/links.ts:39`; `actions/links.ts:22`) (CPH-07) |
| Detalle con medidas | ✅ | B |
| Exportar | ❌ | No hay exportación (no la promete) |

### C. Código y lógica

- **Estructura:** servicio corto con alcance y bloqueo optimista.
- **Degradación del conector:** si falla la búsqueda del documento vinculado, el conector usa la referencia como evidencia y deja log (`external-engagement-accreditation-connector.ts:71-93`). Es razonable.
- **Patrón M-10:** en `coordinacion/[id]/page.tsx:40-41`, `try { … } catch { notFound() }` convierte cualquier error en 404 (CPH-24).
- **RUT de contraparte:** sin validar (`external-engagements.ts:19`) (CPH-26).

### D. Modelo de datos

- **Tabla:** `prevention_external_engagements`, con `version`, `closedAt`/`closedBy` y CHECK de referencia para fiscalización.
- **Medidas:** viven en CAPA, sin tabla espejo.
- **Irreversibilidad:** no hay estado anulado ni fecha de corrección; el cierre es irreversible (CPH-09).

### E. Permisos y seguridad

- **Alcance:** en servidor en crear, agregar medida y cerrar (`requireAccess(..., worksiteId)`). Lectura con alcance (`getExternalEngagement` lanza `NOT_FOUND`). `otrafaena` → 404 en el detalle de Horcones (B).
- **Auto-aprobación de la N°20:** con archivo verificado la firma quien cerró la interacción (`autoApproveByUserId = actorUserId = closedByUserId`, `external-engagement-accreditation-connector.ts:177-178`). Es la decisión M0.4, pero no hay segunda persona (CPH-08).

### F. Testing

- PGlite del conector (9 casos): PASS. Cubre filtros kind/contraparte, acta vinculada, constancia diferida y replay.
- **No hay** unit de UI **ni E2E** de coordinación (CPH-31).

### G. Integración con Programa Anual

- **B, N°20 `mechanism = constancia`:**
  - Cerrar `COORD-BNAIOVPE` (mandante) → evento `rejected` con `deferredReason = mechanism_constancia`, `occurred_at` al mediodía.
  - Cerrar `COORD-VIYCYBXW` (contratista) → **ningún evento** ✅.
  - Cerrar `COORD-YQ4VTBMN` (mandante, fecha futura) → también diferido.
  - PRV-22 queda corregido en el libro.
  - Planilla N°20 de Horcones: "1 / -" en ago/sep/oct, sin rastro para el usuario (CPH-10).
- **Sonda PGlite, N°20 = enganche:**

| Caso | Resultado |
|---|---|
| Acta vinculada con archivo real y sha256 | `approved`, `approvedBy = executedBy` = quien cerró |
| Misma, con fecha 2026-12-15 | **`approved` en diciembre** (futuro) |
| Documento en estado `archivado` | `approved` |
| Fila de documento sin archivo en disco | `submitted`, `evidenceRejection = file_missing` ✅ |
| Referencia `https://drive…` | `submitted`; el mismo usuario no puede aprobarla (PRV-02) ✅ |

- **Replay:** el test existente lo demuestra (1 replay). La clave idempotente del libro (`fulfillment.ts:128-190`) impide duplicar.

### H. Hallazgos

```
ID: CPH-07
Severidad: 🟡 IMPORTANTE
Submódulo: Visitas y coordinación
Categoría: Evidencia / Integración
Título: No hay forma, desde la interfaz, de adjuntar el acta o el correo a una coordinación; la N°20 nunca llega con evidencia verificada
Archivo(s): app/(app)/prevencion/documentacion/[id]/document-links-card.tsx; app/(app)/prevencion/coordinacion/[id]/page.tsx; lib/services/prevention-documents/links.ts
Línea(s): document-links-card.tsx:16-25 (8 tipos, sin external_engagement) y 116-122 (pide "Identificador exacto"); links.ts:39 (el servidor lo acepta); coordinacion/[id]/page.tsx:59-80 (sin sección de documentos)
Pantalla/ruta: /prevencion/coordinacion/[id]; biblioteca de Documentación
Endpoint: createSstDocumentLinkAction (acepta el tipo; la UI no lo ofrece)
Rol: prevencionista, prevencionista_faena
Descripción: el conector busca la evidencia en sst_document_links (entityType external_engagement). La coordinación no tiene carga de archivos. El vínculo desde Documentación no ofrece ese tipo y, aun si lo ofreciera, exige teclear el id interno peng-…. En la práctica toda N°20 llega con texto (referencia o rótulo sintético), queda submitted y se aprueba con un motivo, sin archivo.
Evidencia: CÓDIGO (líneas citadas) + DEMOSTRADO (detalle en B sin documentos, captura c-coordB-det.png; sonda PGlite: sólo con un vínculo insertado por SQL la N°20 obtiene evidence_status provided).
Cómo reproducir: 1. Registrar y cerrar una coordinación con mandante. 2. Buscar dónde adjuntar el acta: no existe. 3. En Documentación → vínculos, el tipo "Visita/coordinación" no aparece.
Resultado actual: la N°20 no puede tener evidencia verificable desde la plataforma.
Resultado esperado: carga del acta en la propia coordinación (dominio con dueño, faena y sha256, como CGRD), visible en el detalle y enviada al conector.
Impacto: la actividad más recurrente de coordinación (12/año por faena) queda sin evidencia adjunta. Todo depende de aprobaciones con motivo.
Causa probable: se reutilizó la biblioteca documental sin construir el vínculo en la UI.
Solución recomendada: subir evidencia en el diálogo de cierre (prevention_evidence_uploads, dominio engagement) o agregar external_engagement con buscador al card de vínculos, y mostrar los documentos en el detalle.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-08
Severidad: 🟡 IMPORTANTE
Submódulo: Visitas y coordinación (y motor de integración)
Categoría: Integración / Validaciones — regresión parcial de PRV-03 en la vía de integración
Título: Una coordinación con fecha futura y archivo real se auto-aprueba en el mes futuro; también con documento archivado; la aprobación la firma quien cerró
Archivo(s): lib/validation/prevention-module/external-engagements.ts; lib/services/pdtp/accreditation.ts; lib/services/pdtp/integration-evidence.ts; lib/services/pdtp-adapters/external-engagement-accreditation-connector.ts
Línea(s): external-engagements.ts:20 (occurredOn sólo regex); accreditation.ts:560-622 y 902-930 (inserta approved sin isPdtpCellInFuture); integration-evidence.ts:125-137 (no mira sst_documents.status); connector:177-178
Pantalla/ruta: /prevencion/coordinacion (Registrar + Cerrar)
Endpoint: createExternalEngagementAction, closeExternalEngagementAction
Rol: prevencionista, prevencionista_faena, admin_contrato
Descripción: PRV-03 se corrigió en markPdtpExecution y approvePdtpExecution (executions.ts:586-587). La auto-aprobación de integración no pasa por ahí. La UI y el esquema aceptan fechas futuras. Además, un documento archivado o reemplazado sigue "verificando".
Evidencia: DEMOSTRADO (sonda PGlite): occurredOn 2026-12-15 + acta real → N°20 month 12 week 3 approved, approvedBy=executedBy=closer; documento "archivado" → approved. En B se registró y cerró COORD-YQ4VTBMN el 2026-12-15 (diferido por constancia; se acreditará aprobado en diciembre cuando la N°20 pase a enganche y corra el replay).
Cómo reproducir: 1. Registrar una coordinación con mandante fechada en diciembre y vincularle un acta. 2. Cerrarla. 3. La N°20 de diciembre aparece aprobada hoy.
Resultado actual: cumplimiento aprobado de algo que no ocurrió, sin segunda persona.
Resultado esperado: rechazar fechas futuras en la interacción; guarda isPdtpCellInFuture en accreditPdtpFromEvent (no auto-aprobar ni escribir en semanas futuras); exigir documento vigente.
Impacto: infla el avance anual. Con engagement el camino es directo.
Causa probable: la guarda de futuro se cableó sólo en la vía manual.
Solución recomendada: validación no-futuro en el esquema; guarda en el motor para todas las fuentes; filtrar sst_documents.status IN (vigente, aprobado) en la verificación.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-09
Severidad: 🟡 IMPORTANTE
Submódulo: Visitas y coordinación
Categoría: Funcionalidad / Integridad
Título: Una interacción no se puede editar, anular ni reabrir: un error de registro o de cierre deja la N°20 acreditada sin vía de revocación
Archivo(s): app/(app)/prevencion/coordinacion/actions.ts; lib/services/prevention-external-engagements.ts
Línea(s): actions.ts:36-52 (sólo crear, medida, cerrar); prevention-external-engagements.ts:135 (mensaje "reábrela"), 170-241
Pantalla/ruta: /prevencion/coordinacion
Endpoint: —
Rol: prevencionista, prevencionista_faena
Descripción: sin edición, anulación ni reapertura. Tipo de contraparte, fecha o faena equivocados no tienen corrección. Cerrar una coordinación con el "mandante" por error acredita la N°20 y no hay recordPdtpFulfillmentRevocation para engagement. El mensaje de error remite a una reapertura que no existe.
Evidencia: CÓDIGO (líneas citadas) + DEMOSTRADO (UI en B: la fila cerrada no ofrece acciones).
Cómo reproducir: 1. Registrar una coordinación con contraparte equivocada. 2. Cerrarla. 3. No hay forma de corregirla ni anularla.
Resultado actual: registro inmutable, incluidos los errores.
Resultado esperado: anulación con motivo que revoque la N°20, y edición antes del cierre.
Impacto: datos erróneos permanentes y cumplimientos no revocables.
Causa probable: alcance mínimo del submódulo.
Solución recomendada: acciones de anular con motivo, con revocación por sourceId coordinacion-mandante:<id>, y editar mientras esté abierta.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-10
Severidad: 🟡 IMPORTANTE
Submódulo: Visitas y coordinación
Categoría: Integración / UX — PRV-22 parcial
Título: Mientras la N°20 sea "constancia" (así está en la copia real), cerrar la coordinación la difiere sin decirle nada al usuario y la N°20 sigue exigiendo el registro en Constancias
Archivo(s): lib/services/pdtp-adapters/external-engagement-accreditation-connector.ts; app/(app)/prevencion/coordinacion/engagements-workbench.tsx
Línea(s): connector:182-197; workbench:401-436 (el diálogo de cierre no informa efecto PDTP)
Pantalla/ruta: /prevencion/coordinacion, /prevencion/pdtp/actividades
Endpoint: closeExternalEngagementAction
Rol: prevencionista_faena
Descripción: el libro guarda el hecho diferido (correcto), pero en la pantalla no queda nada: ni la coordinación ni la planilla lo muestran, y la N°20 sigue "1 / -". Hasta que se corra pdtp:apply-mechanisms en el ambiente, el usuario debe registrar lo mismo en Constancias (doble registro) o la N°20 queda incumplida.
Evidencia: DEMOSTRADO (B): SQL pdtp_activities.n=20 mechanism=constancia; pdtp_fulfillment_events de COORD-BNAIOVPE status rejected, deferredReason mechanism_constancia; planilla Horcones N°20 "1 / -" en ago/sep/oct (sheet.mjs).
Cómo reproducir: 1. En B, cerrar una coordinación con mandante. 2. Ver la N°20 en la planilla. 3. Sigue sin ejecución.
Resultado actual: hecho invisible y doble registro.
Resultado esperado: aviso en la coordinación ("N°20: diferida, se acreditará al reclasificar la actividad; mientras tanto declárala en Constancias") o reclasificación aplicada como paso de despliegue verificado.
Impacto: la N°20 aparece incumplida o se registra dos veces.
Causa probable: paso operativo pendiente (apply-mechanisms) sin reflejo en UI.
Solución recomendada: verificar y aplicar el mecanismo de la N°20 en cada ambiente (checklist de deploy) y mostrar el estado PDTP en el detalle de la interacción.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A (paso de despliegue) / B (UI)
```

Mejoras del submódulo: CPH-23, 24, 25, 26 y 34.

### I. Readiness individual: **70/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 18,5 | CPH-09 (−3), CPH-07 (−2,5), CPH-08 (−1) |
| UI/UX y facilidad de uso | 20 | 13,5 | CPH-23 (−2,5, incluye falta de feedback), detalle sin evidencia ni estado PDTP (CPH-07/10, −1,5), CPH-25 (−1), CPH-10 (−1), CPH-34 (−0,5) |
| Integridad de datos | 15 | 10 | CPH-09 (−3), CPH-08 (−2) |
| Integración con Programa Anual | 15 | 7 | CPH-07 (−3), CPH-08 (−2), CPH-10 (−1,5), CPH-09 (−1,5) |
| Código y mantenibilidad | 10 | 9 | CPH-24 (−0,5), CPH-35 "reábrela" (−0,5) |
| Permisos y seguridad | 5 | 4,5 | Auto-aprobación firmada por el mismo actor (CPH-08, −0,5) |
| Testing | 5 | 3 | CPH-31 (−2) |
| Manejo de errores | 5 | 4 | CPH-24 (−0,5), mensaje engañoso (CPH-09, −0,5) |
| **Total** | 100 | **70** | (redondeo de 69,5) |

### Estado de hallazgos previos

| Hallazgo | Dictamen | Evidencia |
|---|---|---|
| **PRV-01** (N°20 con texto o URL como evidencia) | **Corregido (verificado)** | URL → `submitted`; archivo ausente → `file_missing`; archivo real y sha256 → `approved` (sonda) |
| Residual de PRV-01 | Nuevo (CPH-08) | Documento archivado y fecha futura |
| **PRV-02** (segregación) en la N°20 `submitted` | **Corregido (verificado)** | Quien cerró no aprueba (sonda) |
| Auto-aprobación de la N°20 con archivo | Nuevo (CPH-08) | La firma el mismo actor, por diseño M0.4 |
| **PRV-22** | **Parcial** | Hecho diferido y reprocesable (B + test PGlite); el mecanismo sigue `constancia` en B y el usuario no ve nada (CPH-10) |
| **M-10** | **Corregido en `faenas`/`cphs`** | El mismo patrón sigue en `coordinacion/[id]/page.tsx:40-41` (CPH-24) |

### Qué no se pudo verificar

- **N°20 en B:** la auto-aprobación con archivo real no se pudo ver, porque es `constancia` (probada en PGlite). El replay en B no se ejecutó porque es un cron. No se corrió `pdtp:apply-mechanisms` (prohibido).
- **Adjuntar en navegador:** tampoco se pudo demostrar el adjunto desde Documentación. La biblioteca de A no tiene documentos y el tipo no se ofrece.

---

## AUDITORÍA — Indicadores SST

**Rutas:** `/prevencion/indicadores` y `/api/prevencion/indicadores/export`.

**Archivos principales:**
- `app/(app)/prevencion/indicadores/**`
- `lib/services/prevention-indicadores.ts`
- `lib/prevention/safety-indicators-calc.ts`
- `lib/validation/prevention-module/safety-indicators.ts`
- `app/api/prevencion/indicadores/export/route.ts`
- conector `pdtp-accreditation-connectors.ts:680-742`

**Permisos:** `indicadores:view/manage/close`. Tienen `close`: prevencionista, prevencionista_faena y administrador. `cphs` sólo `view`; `ti` → 403 en el export.

### A. UI/UX/Diseño

- **Estructura:**
  - `PageHeader` con "Exportar Excel" en acciones;
  - 4 KPI **accionables**, que llevan a incidentes filtrados;
  - pestañas Cálculo / Denominadores / Datos del sistema anterior;
  - aviso con CTA "Cargar dotación y HH";
  - fórmulas visibles.
- **Jerga interna:** "Motor canónico · fórmula ds44-art73-2026-v3". La tarjeta de semestre no dice qué tasa muestra (CPH-32).
- **KPI del futuro:** "Frecuencia · Octubre" toma el último mes con denominador, aunque sea futuro (captura `c-indB-390.png`) (CPH-12).
- **0 HH:** un mes con 0 HH **aprobado** se muestra como "—", con title "Sin denominador cargado", y cuenta en "Faltan denominadores" (CPH-13).
- **Año inválido:** `?year=1999` → "Algo salió mal", con HTTP 200 y React #441 en consola (CPH-28).
- **Estados observados:**

| Estado | Evidencia |
|---|---|
| Sin información | "Sin denominadores cargados" |
| Con información | Conciliado y Provisional |
| Operación exitosa | Toasts "Denominador enviado a revisión", "Denominador aprobado", "Período cerrado" |
| Segregación | "No puedes aprobar un denominador que preparaste tú" (código) |
| Permisos insuficientes | `ti`, `jt`, `sup`, `legal` → `/forbidden` |
| Error | `year=1999` |

- **Responsive:** sin desborde de página; la tabla mensual hace scroll interno a 390.

### Facilidad de uso

**Cerrar el mes, para una faena sin accidentes:**

| Paso | Quién | Clics | Texto |
|---|---|---:|---|
| Preparar denominador | Preparador | 5 (+2 para elegir faena) | 4 |
| Aprobar denominador | Otra persona | 2 (+2 faena) | 1 |
| Cerrar el período | Quien tiene permiso de cierre | 2 (+2 faena) | 1 |
| Aprobar la N°7 en Aprobaciones | Tercera persona, con `pdtp:approve` | 3 | 1 |

- **Total ≈ 18 clics y 3–4 personas.** Si hay accidentes, antes hay que calificar los casos en Incidentes.
- **Reapertura:** no hay botón "Reabrir". Se reabre corrigiendo un denominador aprobado (aviso explícito en el diálogo) o reclasificando un caso (CPH-30).

### B. Funcionalidad

| Función | Estado | Evidencia |
|---|---|---|
| Denominador con fuente, evidencia, conciliación, envío a revisión y aprobación segregada | ✅ | A/B; `approveSafetyIndicatorDenominator` rechaza a quien preparó (`prevention-indicadores.ts:725`) |
| Evidencia del denominador | 🟡 | Texto libre (CPH-29) |
| Cálculo canónico (accidentabilidad, frecuencia, gravedad semestral; provisional vs confirmado) | ✅ | A: cifras = cálculo a mano (tabla siguiente) |
| Cerrar período (sólo conciliado, sin casos pendientes) | ✅ | B agosto/septiembre; A agosto. A julio con caso pendiente → sin botón |
| Cerrar un mes futuro | 🔴 | Octubre cerrado el 29-09 (CPH-12) |
| Mes con 0 HH | 🔴 | No cierra nunca (CPH-13) |
| Reabrir por corrección → nuevo borrador, revoca la N°7 | ✅ | B: agosto `reopened`, N°7 v1 `approved` → `draft` con `revocationReason` |
| Exportar Excel con alcance | ✅ | A: `otrafaena` sólo "Faena Restringida", `prevfaena` sólo "Faena E2E", `ti` 403. XLSX con 8 hojas y metadatos |
| Cifras del Excel = pantalla | 🟡 | Distintas en períodos provisionales (CPH-11) |
| Etiquetas del Excel | 🟡 | Estados y IDs crudos (CPH-27) |

**Verificación de cifras** (A, `ws-oficina-e2e`):

| Magnitud | Cálculo a mano | Pantalla | Excel |
|---|---:|---:|---:|
| Frecuencia jul (conf. 3 / 10.000 HH ×1e6) | 300,00 | — | 300 |
| Frecuencia jul (prov. 4 / 10.000 ×1e6) | 400,00 | **400,00** | — |
| Accidentabilidad jul (conf. 2/50×100 · prov. 3/50×100) | 4,00 · 6,00 | **6,00** | 4 |
| Ausencia + cargo jul (conf. 18 · prov. 22) | 18 · 22 | **22 + 0** | 18 / 0 |
| Frecuencia ago (1 / 9.600 ×1e6) | 104,17 | 104,17 | 104,17 |
| Accidentabilidad ago (1/48×100) | 2,08 | 2,08 | 2,08 |
| Gravedad S2 (conf. 24/19.600 · prov. 28/19.600 ×1e6) | 1.224,49 · 1.428,57 | **1.428,57** | 1224,49 |
| Accidentabilidad anual (conf. 3/49 · prov. 4/49 ×100) | 6,12 · 8,16 | **8,16** | 6,12 |

- **Conclusión:** el motor es correcto. La discrepancia es de presentación (CPH-11).
- **Regla A5b:** el gráfico de tasas del tablero usa eje doble (`dashboard-charts.tsx:291-330`) con datos confirmados (`sst-monthly-points.ts:35`). Cumple.
- **Tasa de siniestralidad:** no se calcula como indicador propio. Sólo aparece el rótulo "Tasas de Siniestralidad SST" en el tablero, que muestra TF y TG.

### C. Código y lógica

- **Bien resuelto:**
  - motor único y puro (`safety-indicators-calc.ts`);
  - snapshot con hash de fuentes;
  - revocación por la misma clave del cierre (`indicadores:${snapshotId}`);
  - errores de dominio con mensaje propio y el resto genérico (`actions.ts:41-44`);
  - `sanitizeCell` contra inyección de fórmulas en el Excel.
- **Guarda de permiso:** `closeSafetyIndicatorPeriod` no comprueba `indicadores:close` por sí mismo; lo hace la acción (`actions.ts:47`).
- **Año UTC:** `new Date().getFullYear()` en `page.tsx:27` y `route.ts:37` (CPH-35).

### D. Modelo de datos

- **Tablas:** `safety_indicator_denominators` (versión, estado, conciliación, aprobador), `safety_indicator_periods` (`closed`/`reopened` con motivo) y `safety_indicator_snapshots` (`approved`/`superseded`).
- **Legado:** la tabla `safety_indicators` se conserva sólo para comparar.
- **Borrado:** no hay borrado físico.

### E. Permisos y seguridad

- **Alcance por faena:** en la lectura (`listVisibleWorksites`) y en las mutaciones (`requireIndicatorAccess` con `worksiteId`).
- **Export:** 401/403 y alcance (demostrado). Postgres: «rejects … foreign-faena reads or writes» PASS.

### F. Testing

- **Corridas:** unit (calc, close, dashboard, diálogo, route) PASS; PGlite reopen-revocation PASS; postgres 4 PASS.
- **E2E (leídos):** carga más export (`prevencion-indicadores-export.spec.ts`) y explicación de HH por rol (`indicadores-hh-por-rol.spec.ts`).
- **Sin E2E:** cierre, reapertura y la N°7 (CPH-31).

### G. Integración con Programa Anual (B, Horcones)

| Paso | Resultado |
|---|---|
| Cerrar agosto (el 29-09) | N°7 **agosto** sem 4, `submitted`, `executed_by=qa-prev-faena` (resuelta a la v1, dueña de agosto) |
| Cerrar septiembre | N°7 **septiembre** |
| Aprobar la N°7 | `prev2` con motivo → `approved` |
| Planilla v2 | Septiembre "1 / 1"; historia "12 / 1" |
| Octubre, cerrado por adelantado | N°7 octubre `submitted`, que no aparece en Aprobaciones (futuro) |
| Julio con 0 HH | No se puede cerrar (CPH-13) |
| Reabrir agosto | La N°7 aprobada vuelve a `draft` con motivo (revocación verificada) |

- **Segregación:** el que cierra no aprueba la N°7 (PRV-02). La aprobación exige motivo porque la evidencia es un texto.

### H. Hallazgos

```
ID: CPH-11
Severidad: 🟡 IMPORTANTE
Submódulo: Indicadores SST
Categoría: Integridad / Consistencia de cifras
Título: La pantalla y el Excel muestran cifras distintas para el mismo período provisional, sin rotularlo
Archivo(s): app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx; app/api/prevencion/indicadores/export/route.ts
Línea(s): dashboard:44-46 (metricValue usa provisional si status=provisional), 97-100, 143-147; route.ts:59-67, 79-83, 93-97 (siempre confirmed)
Pantalla/ruta: /prevencion/indicadores; Excel "indicadores_canonicos_2026.xlsx"
Endpoint: GET /api/prevencion/indicadores/export
Rol: todos los que ven indicadores
Descripción: con un caso por calificar el mes queda "provisional". La pantalla muestra la tasa que incluye ese caso y el Excel la que lo excluye. Las columnas "Tasa frecuencia" y "Tasa accidentabilidad" no dicen "confirmada".
Evidencia: DEMOSTRADO (A, ind-A.mjs + openpyxl): julio frecuencia 400,00 (pantalla) vs 300 (Excel); accidentabilidad 6,00 vs 4; S2 gravedad 1.428,57 vs 1224,49; anual 8,16 vs 6,12. Los valores coinciden con el cálculo a mano de cada variante.
Cómo reproducir: 1. Tener un accidente por calificar en un mes con denominador. 2. Anotar la frecuencia del mes en pantalla. 3. Exportar y comparar.
Resultado actual: dos cifras oficiales distintas para el mismo mes.
Resultado esperado: el Excel trae ambas columnas (confirmada y provisional) o la misma que la pantalla, rotulada.
Impacto: reportes a gerencia o Mutual inconsistentes con la plataforma.
Causa probable: el export se escribió sólo sobre confirmed.
Solución recomendada: columnas "provisional" y "confirmada", o un rótulo explícito, y una prueba de dorado cruzado pantalla↔Excel.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-12
Severidad: 🟡 IMPORTANTE
Submódulo: Indicadores SST
Categoría: Validaciones / Integración
Título: Se puede aprobar un denominador de un mes futuro y cerrar ese mes: queda un snapshot "cerrado" y una N°7 del futuro
Archivo(s): lib/validation/prevention-module/safety-indicators.ts; lib/services/prevention-indicadores.ts; app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx
Línea(s): safety-indicators.ts:34-37, 88-93 (sin cota de fecha); prevention-indicadores.ts:616-714, 835-885; dashboard:61-65 (latestMonth = último con denominador), 144 (botón Cerrar si reconciled)
Pantalla/ruta: /prevencion/indicadores
Endpoint: saveSafetyIndicatorDenominatorAction, closeSafetyIndicatorPeriodAction
Rol: prevencionista_faena, prevencionista
Descripción: el 29-09 se registró y aprobó octubre ("Proyección octubre 2026") y se cerró. El KPI "Frecuencia" pasa a mostrar octubre.
Evidencia: DEMOSTRADO (B): safety_indicator_periods ws-horcones 2026-10 closed sis-X8AOnKGvfJkSArIRIgmm3; pdtp_executions N°7 month 10 submitted; KPI "FRECUENCIA · OCTUBRE" (captura B-prevfaena-390-_prevencion_indicadores.png).
Cómo reproducir: 1. Registrar el denominador del mes siguiente. 2. Aprobarlo con otra persona. 3. "Cerrar" aparece y funciona.
Resultado actual: período cerrado antes de ocurrir; los accidentes de ese mes quedan fuera del snapshot hasta que alguien con permiso de cierre reclasifique.
Resultado esperado: sólo meses vencidos (mes < mes actual en Chile) admiten cierre; el denominador de un mes futuro queda como borrador o se rechaza.
Impacto: indicador y N°7 anticipados; estadística del mes congelada en cero.
Causa probable: falta la guarda temporal.
Solución recomendada: validar year/month ≤ mes en curso (todayInChile) en denominador y cierre; excluir meses futuros de latestMonth.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: CPH-13
Severidad: 🟡 IMPORTANTE
Submódulo: Indicadores SST
Categoría: Integración PDTP — PRV-19 #15 (resto abierto)
Título: Un mes con 0 horas trabajadas declarado y aprobado no puede cerrarse nunca, y la N°7 de ese mes queda imposible de cumplir
Archivo(s): lib/prevention/safety-indicators-calc.ts; lib/services/prevention-indicadores.ts; app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx
Línea(s): safety-indicators-calc.ts:323-329 (workedHours 0 → non_calculable); prevention-indicadores.ts:760-763; dashboard:75-76 y 144 (lo trata como "falta denominador"; no muestra Cerrar)
Pantalla/ruta: /prevencion/indicadores
Endpoint: closeSafetyIndicatorPeriodAction
Rol: prevencionista_faena
Descripción: una faena detenida (4 trabajadores, 0 HH, denominador aprobado con evidencia) queda "No calculable", sin botón Cerrar. La pantalla afirma que falta el denominador aunque existe y está aprobado.
Evidencia: DEMOSTRADO (B, julio Horcones): denominador approved, 0 HH → fila "Julio No calculable … Gestionar" sin Cerrar. El informe de correcciones lo reconoce pendiente de decisión (§4).
Cómo reproducir: 1. Registrar un mes con HH=0. 2. Aprobarlo. 3. No hay Cerrar; la N°7 de ese mes queda sin ejecución.
Resultado actual: N°7 incumplible en meses sin actividad.
Resultado esperado: cierre "sin actividad" con motivo y aprobación, que acredite la N°7 (o NA de la N°7 para ese mes), y un mensaje que no llame "faltante" a un 0 declarado.
Impacto: la faena aparece incumpliendo la N°7 por un mes en que no trabajó.
Causa probable: decisión de negocio pendiente.
Solución recomendada: decidir quién declara "sin actividad" e implementarlo; mientras tanto, texto y ruta para declarar NA.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

Mejoras del submódulo: CPH-27, 28, 29 y 30.

### I. Readiness individual: **79/100**

| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 20,5 | CPH-12 (−2), CPH-13 (−2), CPH-30 (−0,5) |
| UI/UX y facilidad de uso | 20 | 16 | CPH-11 (−1,5), CPH-13 texto "falta" (−1), CPH-12 KPI futuro (−0,5), CPH-28 (−0,5), CPH-32 (−0,5) |
| Integridad de datos | 15 | 10,5 | CPH-11 (−2), CPH-12 (−2), CPH-29 (−0,5) |
| Integración con Programa Anual | 15 | 10 | CPH-13 (−3), CPH-12 (−2) |
| Código y mantenibilidad | 10 | 9 | CPH-35 (−0,5), guarda de permiso sólo en la acción (−0,5) |
| Permisos y seguridad | 5 | 5 | — |
| Testing | 5 | 4 | CPH-31 (−1) |
| Manejo de errores | 5 | 4 | CPH-28 (−1) |
| **Total** | 100 | **79** | |

### Estado de hallazgos previos

| Hallazgo | Dictamen | Evidencia |
|---|---|---|
| **PRV-19 #15** — mes de imputación | **Corregido (verificado)** | Agosto cerrado el 29-09 → N°7 agosto (resuelta a la v1, dueña del período); septiembre → septiembre |
| **PRV-19 #15** — mes con 0 HH | **Sigue abierto** | CPH-13 |
| **PRV-02** en la N°7 | **Corregido (verificado)** | El que cierra (`executed_by`) no aprueba; la aprobación exige motivo |
| PRV-04 (reabrir revoca) | **Corregido (verificado)** | B: `approved` → `draft` con `revocationReason` |

### Qué no se pudo verificar

- **Incidentes por UI:** los casos de A se insertaron por SQL (rotulados `QA_CPH_`), no por el flujo de Incidentes. La calificación por UI y su reapertura de períodos cerrados (`prevention-incidents.ts:772`) no se ejercitó en navegador.
- **Vista consolidada v1/v2:** la ejecución de agosto quedó en la v1 y la planilla de la v2 muestra agosto "1 / -". No se evaluó la vista consolidada entre versiones; corresponde al núcleo PDTP.

---

## Mejoras (🔵) y cosméticos (⚪) — tabla consolidada

| ID | Sev. | Submódulo | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|---|---|
| CPH-14 | 🔵 | CPHS | Los 4 KPI no son accionables (regla A1) | `cphs/committee-list.tsx:83-100` | CÓDIGO + captura | Enlazar a lista filtrada | B |
| CPH-15 | 🔵 | CPHS | Constituir, cerrar revisión, disolver y cerrar acta sin toast de éxito; el diálogo se cierra en silencio | `cphs-dialogs.tsx:50,101,212`; `committee-detail.tsx:500`; `use-operation.ts:55-61` | DEMOSTRADO (B, sin toast) | `feedback: "toast"` | B |
| CPH-16 | 🔵 | CPHS | "Mandato hasta" (≈2 años) exige ~24 clics de mes siguiente; sin navegación por año | `cphs-dialogs.tsx:71`; `components/ui/date-picker.tsx` | DEMOSTRADO | `captionLayout="dropdown"` o sugerir +2 años | B |
| CPH-17 | 🔵 | CPHS | El detalle carga todas las sesiones del alcance (máx. 300) y 2.000 trabajadores, y filtra en memoria; truncamiento con volumen | `[committeeId]/page.tsx:39-50`; `prevention-cphs.ts:1093,1147` | TEÓRICO | Consultas por comité o faena | B |
| CPH-18 | 🔵 | CPHS | Alta de comité y de revisión, e historial, fuera de una transacción | `prevention-cphs.ts:70-80, 904-914` | CÓDIGO | `db.transaction` | B |
| CPH-19 | 🔵 | CPHS (Aprobaciones) | Se ofrece "Aprobar" a quien originó el hecho; el servidor lo rechaza después de escribir el motivo | `pdtp/pdtp-approval-buttons.tsx:108` | DEMOSTRADO (B) | Ocultar o avisar si `executedByUserId` = usuario | B |
| CPH-20 | 🔵 | CPHS | Un comité con composición inválida (1+1 titulares) sesiona, cierra actas válidas y completa su programa; sólo hay aviso | `prevention-cphs.ts:708-756` | DEMOSTRADO (B) | Decidir si bloquea o marca el acta | M |
| CPH-21 | 🔵 | Estructura | En faena que exige comité, la CTA primaria es "Designar delegado" (no satisface la N°11) y "Ir a CPHS" es secundaria | `faenas/[worksiteId]/worksite-profile.tsx:146-153, 210` | DEMOSTRADO (captura) | Primaria según `compliance.required`; avisar | B |
| CPH-22 | 🔵 | Estructura | Terminar un delegado no re-evalúa la brecha hasta el barrido diario | `prevention-cphs-organization.ts:158-195` | CÓDIGO | Llamar a `evaluateWorksitePreventiveOrganization` | B |
| CPH-23 | 🔵 | Coordinación | "Registrar interacción" en toolbar de contenido y no en `PageHeader.actions` (regla 5/A3); `EmptyState` sin CTA (A4); sin toast | `engagements-workbench.tsx:115-126, 233-243, 413` | CÓDIGO + captura | Subir al header; CTA en empty state; toast | B |
| CPH-24 | 🔵 | Coordinación | Patrón M-10: `catch { notFound() }` vuelve 404 cualquier error | `coordinacion/[id]/page.tsx:40-41` | CÓDIGO | Atrapar sólo `NOT_FOUND` | B |
| CPH-25 | 🔵 | Coordinación | Sin tarjetas móviles a 390 (acciones fuera de pantalla); columna "Acciones" cortada a 1440 | `engagements-workbench.tsx:128-190` | DEMOSTRADO (capturas) | Tarjetas `md:hidden` o acciones en el detalle | M |
| CPH-26 | 🔵 | Coordinación | RUT de contraparte sin validar | `validation/.../external-engagements.ts:19` | CÓDIGO | Validar módulo 11 | B |
| CPH-27 | 🔵 | Indicadores | Excel con enums crudos (`provisional`, `reconciled`, `non_calculable`, `rrhh`, `approved`, `matched`) e IDs de faena y aprobador en vez de nombres | `export/route.ts:60, 110-116, 155-159` | DEMOSTRADO (openpyxl) | Mapear rótulos y nombres | B |
| CPH-28 | 🔵 | Indicadores | `?year=1999` → "Algo salió mal" (HTTP 200) | `indicadores/page.tsx:27-30`; `prevention-indicadores.ts:362` | DEMOSTRADO | Acotar el año como en el export | B |
| CPH-29 | 🔵 | Indicadores | La evidencia del denominador es texto libre (≥3 caracteres), sin archivo ni hash | `safety-indicators.ts:42-53`; `indicator-denominator-dialog.tsx` | CÓDIGO + UI | Subida con sha256 | M |
| CPH-30 | 🔵 | Indicadores | No hay acción "Reabrir período"; sólo se reabre corrigiendo un denominador aprobado o un caso | `canonical-indicators-dashboard.tsx:144` | CÓDIGO | Acción explícita con motivo | B |
| CPH-31 | 🔵 | Todos (Testing) | Sin E2E de: coordinación (ninguno), constituir, cerrar acta con quórum, revisión por la dirección, cierre/reapertura de indicadores, acreditación N°7/9/11/20 | `e2e/` | CÓDIGO | Specs de las vías críticas | M |
| CPH-32 | ⚪ | CPHS/Ind. | Fechas ISO crudas (lista de comités, coordinaciones); jerga "pendiente en cphs", "Motor canónico · fórmula ds44-art73-2026-v3"; semestre sin nombre de la tasa | `committee-list.tsx:156`; `pdtp-scheduled-activity-panel.tsx:143`; `canonical-indicators-dashboard.tsx:87-88, 147` | DEMOSTRADO | `formatDate`, rótulos de usuario | B |
| CPH-33 | ⚪ | CPHS | "Quórum: 2 de 1 requeridos" | `committee-detail.tsx:517` | DEMOSTRADO | Redactar "ambas representaciones presentes" | B |
| CPH-34 | ⚪ | Coordinación | El submit "Cerrar" comparte nombre accesible con la X "Cerrar" del diálogo | `engagements-workbench.tsx:431` | DEMOSTRADO (automatización) | "Cerrar interacción" | B |
| CPH-35 | ⚪ | Varios | `new Date().getFullYear()` (año del servidor); comentario obsoleto "actividad 14"; mensaje "reábrela" sin función de reapertura | `indicadores/page.tsx:27`; `export/route.ts:37`; `prevention-cphs.ts:986`; `prevention-external-engagements.ts:135` | CÓDIGO | `codeYear()`; corregir textos | B |
| CPH-36 | ⚪ | Varios | "No encontrado" / fuera de alcance responde HTTP 200 (dentro de Suspense) en faenas, coordinación y CPHS | survey A/B | DEMOSTRADO | Layout con `requireRecord` y alcance, como el de CPHS | B |
| CPH-37 | ⚪ | CPHS | La pestaña "Revisión por la dirección (0)" se muestra a quien no tiene `governance:review` | `committee-list.tsx:114` | DEMOSTRADO (rol `cphs`) | Ocultarla sin permiso | B |

## Limpieza

- **Sonda:** `lib/__tests__/comites-integracion.audit-tmp.test.ts` se borró del repo; queda copiada en `scratchpad/audit/comites/`.
- **`git status`:** además de `.audit-*` aparecen:
  - `.claude/settings.local.json` modificado — no lo toqué;
  - cuatro `*.audit-tmp.test.ts` de **otros** agentes (capacitación, documental, incidentes, inspecciones).
- **Bases:** creé `bodega_test_audit_cph_cphs` y `bodega_test_audit_cph_ind` en `:55432` para las suites postgres.
