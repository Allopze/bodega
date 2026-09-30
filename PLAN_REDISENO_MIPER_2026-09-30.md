# Plan de rediseño integral del submódulo MIPER

Fecha: 2026-09-30

Documento único del rediseño:

- **Parte I, Diseño:** el spec aprobado, que cubre las tres fases (F1 núcleo, F2 Programa de Trabajo y F3 consolas).
- **Parte II, Plan de implementación de la F1:** 21 tareas con pruebas, código, comandos de verificación y commits.

Los planes de F2 y F3 se escriben al integrar la fase anterior y se agregan aquí como Partes III y IV.

Estado: diseño aprobado; plan de F1 pendiente de aprobación y de elegir la modalidad de ejecución.

---

## Parte I — Diseño (spec)

Fecha: 2026-09-30 · Estado: **diseño aprobado por secciones, pendiente de revisión del spec escrito**
Alcance: `app/(app)/prevencion/miper`, `lib/services/prevention-risk-legal.ts`,
`db/schema/prevention/risk-legal.ts` y sus consumidores.
Referencia documental: `docs/Prevención Biodiversa/5. MATRIZ DE RIESGOS/RE- 04 Matriz de
Identificación de Peligros y Evaluación de Riesgos (MIPER).xlsx` (hojas *Instructivo MIPER*,
*RE-04 IPER*, *Modificaciones*, *Criterios de Evaluación IPER*, *Programa de Trabajo*).

El objetivo no es una planilla Excel en la web: es el ciclo **Creación → Revisión técnica →
Correcciones → Aprobación → Ejecución del programa → Evidencias → Seguimiento**, con la
estructura y la metodología del RE-04 y trazabilidad completa.

---

### 1. Punto de partida (verificado sobre el código)

Lo que ya existe y se conserva o evoluciona:

1. **Versionado por faena con cadena de supersesión.** `prevention_risk_matrices` numera
   `matrix_version` por faena, admite una sola `published` por faena
   (`prevention_risk_matrices_one_published_scope_unique`), sella `published_hash_sha256` y
   encadena `supersedes_matrix_id`. Crear una revisión **copia** filas y controles
   (`createRiskMatrixDraftWithClient`).
2. **Máquina de estados** `draft → in_review → reviewed → approved → published → superseded`
   (`MATRIX_TRANSITIONS`, `prevention-risk-legal.ts:382`) con segregación creador ≠ revisor ≠
   aprobador y devolución a borrador (MIPER-10). Los recordatorios de firma pendiente
   (`lib/services/pdtp/reminders.ts:450-500`) se derivan de `MATRIX_TRANSITIONS` /
   `MATRIX_PERMISSION`.
3. **Controles con jerarquía** `elimination|substitution|engineering|administrative|ppe`,
   responsable y plazo (`prevention_risk_controls`).
4. **Vínculo N:M PDTP ↔ control** en `prevention_pdtp_source_links` (`source_type='risk_control'`),
   el reloj de 30 días `prevention_pdtp_update_obligations` y el conector de acreditación
   `onRiskMatrixPublished` (actividad N°35).
5. **Auditoría** vía `recordModuleHistory` (envuelto como `history()` en el servicio).
6. **Consumidores por FK** de `prevention_risk_entries.id`, todos filtrando por
   `status = 'published'`: marcadores del mapa CGRD (`prevention-risk-map.ts`), requisitos EPP
   (`db/schema/prevention/epp.ts:26`), programas de inspección
   (`prevention-inspections/programs.ts:185`, `catalogs.ts:105` — usa `hazard_code`), permisos
   de trabajo (`permits.ts:68`) e higiene (`hygiene.ts:46`).

Brechas frente al objetivo:

| # | Brecha |
|---|---|
| B1 | Evaluación con 4 niveles genéricos elegidos a mano (inherente/residual). No hay P×C, MR ni las bandas RE-04. El alias `tolerable → medium` de `lib/prevention/risk-levels.ts` contradice el RE-04 (Tolerable = MR 1–2, la banda más baja). |
| B2 | Sin observaciones por fila ni comparación entre envíos. |
| B3 | Sin aprobación Legal y RRHH; los permisos `risk:approve`/`risk:publish` los tienen `prevencionista` y `jefa_chome`. |
| B4 | Encabezado RE-04 incompleto: sin período, comuna, N° adherente ni dotación por sexo. |
| B5 | Factor de riesgo, peligro y riesgo son texto libre; riesgo y daño probable están fusionados en `expected_event_or_damage`. |
| B6 | Alta de filas por un diálogo grande (`AddRiskDialog`); no hay grilla editable ni librería de grilla en el repo. |
| B7 | No hay Programa de Trabajo RE-04.1 ligado a la matriz con ejecución Se hizo / No se hizo, fecha efectiva y avance calculado. |
| B8 | Un MIPER aprobado sólo cambia creando una copia completa, que obliga a re-apuntar a los consumidores (`repointRiskMapMarkers`). |

---

### 2. Decisiones de negocio tomadas

| Tema | Decisión |
|---|---|
| Programa de Trabajo | **Programa propio del MIPER** (RE-04.1 por MIPER). Se integra al PDTP corporativo sólo como cobertura y acreditación, sin una segunda ejecución duplicada. |
| RRHH y Legal | **Una sola firma conjunta "Legal y RRHH"**, que también puede solicitar correcciones. |
| ¿Está controlado? | **Sí / Parcialmente / No**, como se usa en el RE-04 real. |
| Actividades recurrentes | **Frecuencia con ocurrencias**; avance = realizadas ÷ planificadas del período. |
| Datos existentes | **No hay MIPER reales en producción.** Se permite reformar el modelo sin compatibilidad hacia atrás, pero con migraciones seguras (§10). |
| Mutabilidad | **El MIPER aprobado es mutable**: los cambios aplican de inmediato, quedan registrados y pasan después por revisión (Jefa → Legal y RRHH). Cada aprobación sella una versión inmutable. |
| Jefa del Departamento de Prevención | Es el rol `prevencionista` (rótulo "Jefe del Departamento de Prevención de Riesgos", global). |

---

### 3. Modelo conceptual

- **MIPER** = documento **vivo** por **faena + período** (año). Sus filas, medidas y
  actividades tienen **IDs estables** durante el período.
- **Versión** = foto **sellada e inmutable** del MIPER en el momento de una aprobación de
  Legal y RRHH (v1, v2, v3…). La lista de versiones es la hoja *Modificaciones* del RE-04.
- **Cambios pendientes** = diferencia calculada entre el MIPER vivo y su última versión
  sellada. No hay una cola de cambios separada.
- **Ronda de revisión** = cada envío. Congela una foto que es lo que revisan la Jefa y
  Legal y RRHH; los datos vivos pueden seguir cambiando sin alterar lo revisado.
- **Nuevo período** (renovación anual): "Iniciar período AAAA" crea un MIPER nuevo copiado del
  vigente. El anterior sigue vigente hasta que el nuevo se aprueba y entonces pasa a
  *Reemplazado*. Una faena acumula así MIPER históricos, uno por período, cada uno con sus
  versiones.
- **Programa de Trabajo Preventivo** = uno por MIPER (faena + período).

Trazabilidad objetivo:

```
MIPER → Registro de evaluación → Medida de control ⇄ Actividad del programa → Ocurrencia → Evidencia
                                                   (N:M)
```

---

### 4. Modelo de datos

Enfoque: **evolucionar** las tablas `prevention_risk_*`, no crear tablas `miper_*` paralelas.
Los consumidores por FK (§1.6) siguen funcionando y ganan IDs estables.

#### 4.1 `prevention_risk_matrices` (MIPER vivo)

Se conserva la tabla. Cambios:

- `period` (entero, año). Unicidad: un MIPER no reemplazado por `(worksite_id, period)`.
- **Ciclo de vida** en la columna existente `status`, reducida a `draft` (nunca aprobado) ·
  `published` (= **vigente**: tiene al menos una versión sellada) · `superseded` (reemplazado por
  el MIPER de otro período). Se reutiliza el valor `published` a propósito: los cinco consumidores
  por FK (§1.6), los recordatorios, el archivado y la verificación de controles ya filtran
  `status = 'published'` y siguen funcionando sin cambios. El índice
  `prevention_risk_matrices_one_published_scope_unique` (un solo vigente por faena) se conserva.
  En este documento, "`in_force`" es el nombre conceptual de `status = 'published'`.
- `is_legacy` (booleano): marca las matrices creadas con la metodología anterior (§10).
- **Estado de revisión** `review_state`: `none` · `in_review` · `observed` ·
  `pending_approval`. "Cambios pendientes" no se persiste: se calcula (§3).
- La última versión sellada no se guarda en la matriz: es `max(version_number)` en `prevention_risk_matrix_versions` (evita una FK circular matriz ↔ versión).
- **Encabezado RE-04** (editable salvo en `superseded`, igual que las filas; prellenado, ver §4.8):
  `iper_code`, `elaborated_on`, `updated_on` (CHECK `updated_on >= elaborated_on`),
  `company_name`, `company_rut`, `company_address`, `company_commune`, `economic_activity`,
  `adherent_number`, `worksite_name`, `site_representative_user_id` + `site_representative_name`,
  `headcount_total`, `headcount_male`, `headcount_female`, `headcount_other`
  (CHECK suma = total).
- Elaboró / revisó / aprobó **no se escriben**: se derivan de los usuarios de la última ronda
  aprobada y se congelan en la versión sellada.
- `reviewed_*`, `approved_*`, `published_*` y `published_hash_sha256` se **conservan** con un
  significado nuevo: firmantes y hash de la **última** versión sellada (la revisora técnica, el
  aprobador Legal y RRHH, y el hash de la foto). Así se mantiene el CHECK
  `prevention_risk_matrices_publish_evidence` y los lectores existentes del hash. La columna
  `version` sigue siendo la **versión optimista** de la fila (concurrencia), distinta del número
  de versión sellada. `source_import_batch_id` queda sin uso hasta el importador de F3.
- Se conservan `methodology_id` + `methodology_snapshot` (metodología nueva "RE-04 CHOME",
  §5), `revision_reason`, `participation_summary`, `committee_meeting_id`,
  `consultation_evidence_reference` y `supersedes_matrix_id` (ahora encadena períodos).

#### 4.2 Diccionarios por faena: actividad, tarea, puesto, lugar

`prevention_risk_processes` (actividad / proceso), `prevention_risk_tasks`,
`prevention_risk_positions` se conservan como **diccionarios por faena** que alimentan el
autocompletado:

- `code` deja de ser obligatorio para el usuario: se genera. La unicidad pasa a ser por nombre
  normalizado dentro de la faena, así "Carga de lodo" y "carga de lodo " son el mismo valor.
- Tarea y puesto dejan de colgar jerárquicamente uno del otro: en el RE-04 real la misma tarea
  aparece con varios puestos y viceversa. Cada diccionario cuelga de la faena.
- `is_routine` sale de la tarea y pasa a la fila (en el RE-04 es un atributo por fila).
- Diccionario nuevo `prevention_risk_locations` (lugar de trabajo específico), mismo patrón.
- `prevention_risk_positions.worker_position_key` se mantiene como puente opcional hacia
  `worker_positions`.

#### 4.3 `prevention_risk_factors` (catálogo nuevo)

`id`, `code`, `name`, `sort_order`, `is_active`. Administrable (permiso
`prevention:risk:catalog:manage`). Semilla idempotente con los factores del RE-04: Locativo,
Mecánico, Físico, Químico, Biológico, Eléctrico, Ergonómico, Psicosocial, más los que aparezcan
en las matrices reales al importar (§8.4). Un factor en uso no se borra: se desactiva.

#### 4.4 `prevention_risk_entries` (registro de evaluación)

Una fila por situación concreta de exposición:

| Columna | Tipo / regla |
|---|---|
| `row_number` | entero ≥ 1, orden visible (N°); único por matriz |
| `process_id`, `task_id`, `position_id`, `location_id` | FK a los diccionarios |
| `exposed_female`, `exposed_male`, `exposed_other` | enteros ≥ 0 |
| `risk_factor_id` | FK a `prevention_risk_factors` |
| `is_routine` | booleano ("Rutinaria" / "No rutinaria") |
| `hazard`, `risk`, `probable_damage` | texto; `risk` y `probable_damage` se separan del antiguo `expected_event_or_damage` |
| `probability`, `consequence` | CHECK `IN (1, 2, 4)`; nulos sólo mientras la fila está incompleta |
| `magnitude` | **columna generada** `probability * consequence` |
| `classification` | **columna generada**: 1–2 `tolerable`, 4 `moderate`, 8 `important`, 16 `intolerable` |
| `controlled_status` | `yes` / `partial` / `no` |
| `hazard_code` | se conserva (lo usa `prevention-inspections/catalogs.ts`); se genera desde `row_number` |
| `gender_considerations`, `sensitive_worker_considerations` | se conservan como opcionales (enfoque de género DS 44) |
| `version` | concurrencia optimista por fila |

Se retiran `inherent_*`, `residual_*`, `is_critical` a nivel de fila (la criticidad pasa a
derivarse de la clasificación), `exposed_people_description`/`count` (reemplazados por F/M/Otro)
y los campos de importación antigua (`source_*`, `normalization_decision`). Se elimina el índice
único `…_matrix_identity_unique`: el RE-04 real repite combinaciones actividad/tarea/puesto.

MR y clasificación son columnas generadas por Postgres: ningún camino (UI, seed, script) puede
guardar una clasificación incoherente con P×C.

#### 4.5 `prevention_risk_controls` (medidas de control)

Casi sin cambios: varias por fila, `hierarchy` (I–V), `description`, `responsible_user_id` +
`responsible_snapshot`, `due_date`, `status`, `version`. Los campos de control crítico
(`performance_standard`, `verification_frequency`, `effectiveness_status`, verificación) se
conservan porque los usa la ficha de verificación existente.

#### 4.6 Revisión, versiones y observaciones (tablas nuevas)

**`prevention_risk_review_rounds`**: `id`, `matrix_id`, `round_number`, `stage`
(`technical` | `legal_rrhh`), `snapshot` (jsonb: encabezado + filas + medidas + actividades del
programa), `snapshot_sha256`, `submitted_by_user_id`, `submitted_at`, `opened_at` (primera
apertura por la revisora; distingue "Enviado" de "En revisión"), `decision`
(`observed` | `approved` | nulo mientras está abierta), `decided_by_user_id`, `decided_at`,
`decision_comment`. **Sólo inserción**, salvo completar la decisión una vez.

**`prevention_risk_matrix_versions`**: `id`, `matrix_id`, `version_number` (correlativo por
MIPER), `period`, `round_id` (la ronda Legal y RRHH aprobada), `snapshot`, `snapshot_sha256`,
`change_summary` (texto de *Modificaciones*), `elaborated_by_user_id`,
`technical_reviewer_user_id`, `approver_user_id` + nombres y cargos congelados, `approved_at`.
Inmutable: sin UPDATE ni DELETE desde la aplicación (y un trigger que lo rechaza).

**`prevention_risk_observations`**: `id`, `matrix_id`, `entry_id` (nulo = observación general),
`round_id`, `stage`, `author_user_id`, `body`, `status` (`open` → `answered` → `resolved`, o
`answered` → `open` si quien observó la reabre), `response`, `responded_by_user_id`,
`responded_at`, `resolved_by_user_id`, `resolved_at`. Nunca se borra.

#### 4.7 Programa de Trabajo (tablas nuevas, F2)

**`prevention_risk_programs`**: 1:1 con el MIPER. Encabezado RE-04.1 (§7.1) con los mismos
campos de empresa que el MIPER más `program_manager_user_id` (encargado) y
`elaborated_on`. "Fecha última revisión" = `approved_at` de la última versión sellada.
"N° de centros de trabajo" se calcula.

**`prevention_risk_program_actions`**: `id`, `program_id`, `action_number`, `process_id` (FK al
diccionario de actividades: la columna *Proceso* no se copia como texto), `description`,
`responsible_user_id` + `responsible_snapshot`, `location_label` (centro de trabajo, por defecto
el nombre de la faena), `schedule_kind` (`once` | `monthly` | `quarterly` | `semiannual` |
`annual`), `starts_on`, `status` (`active` | `retired`), `retired_at`, `retired_reason`.

**`prevention_risk_program_action_controls`**: N:M actividad ↔ medida (`action_id`,
`control_id`, `linked_by_user_id`, `linked_at`). Única por par.

**`prevention_risk_program_occurrences`**: `id`, `action_id`, `due_on`, `outcome`
(`pending` | `done` | `not_done` | `superseded`), `current_record_id`. Única por
`(action_id, due_on)`. `outcome` es un resumen mantenido por el servicio: siempre coincide con el
último registro no anulado (o `pending` si no hay), salvo `superseded`, que marca las pendientes de
un programa reemplazado.

**`prevention_risk_program_occurrence_records`**: cada registro de ejecución, **sólo inserción**:
`id`, `occurrence_id`, `outcome` (`done` | `not_done`), `effective_on`, `late` (booleano),
`reason`, `notes`, `recorded_by_user_id`, `recorded_at`, `voided_at`, `voided_by_user_id`,
`void_reason`. CHECK: `done` exige `effective_on`; `not_done` exige `reason` de al menos 10
caracteres; anular exige `void_reason`. Así "No se hizo" seguido de "Se hizo (fuera de plazo)"
son dos registros visibles, y una anulación no borra nada.

**`prevention_risk_occurrence_evidence`**: `id`, `record_id` (el registro de ejecución al que
acredita), `evidence_upload_id` (FK a
`prevention_evidence_uploads`), `description`, `uploaded_by_user_id`, `uploaded_at`,
`withdrawn_at`, `withdrawn_by_user_id`, `withdraw_reason`. Sólo inserción; retirar exige motivo.

#### 4.8 Prellenado del encabezado (fuentes existentes)

| Campo RE-04 | Fuente | Estado actual |
|---|---|---|
| Razón social, RUT, dirección, actividad económica | `getCompanyProfile()` (`lib/services/system-settings.ts:474`) | existe |
| N° de adherente | clave nueva en el perfil de empresa | **se agrega** |
| Comuna | columna nueva `worksites.commune` | **se agrega** |
| Nombre del centro de trabajo | `worksites.name` | existe |
| Representante de la empresa en la faena | usuario con rol `admin_contrato` asignado en `worksite_users` | existe |
| Dotación total / H / M / Otro | conteo de `workers` activos de la faena por `sex` (`female`, `male`, `intersex` + `unspecified` → Otro) | existe (migración 0343) |

El campo se rotula **"Representante de la empresa en la faena (Administrador de contrato)"**,
nunca "Representante legal". Cada valor prellenado indica su origen y se puede restaurar desde la
fuente. La dotación declarada se valida contra sí misma (H + M + Otro = total); el conteo real de
trabajadores se muestra al lado como referencia, sin forzar igualdad.

#### 4.9 Auditoría

Todo cambio pasa por `recordModuleHistory` con estado anterior y nuevo. Se agrega al `new_state`
el **rol con que actuó** el usuario (`roleContext`: `prevencionista_faena`, `jefa_prevencion`,
`legal_rrhh`, …), que hoy no se guarda. Eventos mínimos: creación, modificación de encabezado,
alta/cambio/baja de fila y medida, envío, apertura de ronda, observación, respuesta,
resolución, devolución, aprobación técnica, aprobación Legal y RRHH, sellado de versión, inicio
de período, alta/retiro de actividad, registro y anulación de ocurrencia, carga y retiro de
evidencia.

---

### 5. Metodología de evaluación (RE-04)

Se registra una metodología nueva `RE-04-CHOME` en `prevention_risk_methodologies` (idempotente,
como `ensureIspRiskMethodology`) cuya `configuration` contiene las escalas y textos de la hoja
*Criterios de Evaluación IPER*, y se congela en `methodology_snapshot` de cada MIPER.

| Nivel | Valor | Probabilidad | Consecuencia |
|---|---|---|---|
| Baja | 1 | El daño ocurrirá rara vez o en contadas ocasiones | Ligeramente dañino |
| Media | 2 | El daño ocurrirá en varias ocasiones | Dañino |
| Alta | 4 | El daño ocurrirá siempre o casi siempre | Extremadamente dañino |

MR = P × C.

| MR | Clasificación | Criterio (texto del RE-04, mostrado en la UI) |
|---|---|---|
| 1–2 | TOLERABLE | No se necesita mejorar la acción preventiva… |
| 4 | MODERADO | Se deben hacer esfuerzos para reducir el riesgo… |
| 8 | IMPORTANTE | No se debe comenzar ni continuar el trabajo hasta que se haya reducido el riesgo… |
| 16 | INTOLERABLE | No debe comenzar ni continuar el trabajo hasta que se reduzca el riesgo… |

Los textos completos se copian verbatim del Excel al construir la metodología.

**Vocabulario único.** `lib/prevention/risk-levels.ts` pasa a exponer
`RISK_CLASSIFICATIONS = ["tolerable", "moderate", "important", "intolerable"]` con rótulos,
tonos y función `classify(p, c)`. La misma función sirve para el cálculo instantáneo en el
cliente; la columna generada es la autoridad. Se elimina el alias `tolerable → medium`. Los
consumidores (`risk-map-panel.tsx`, `controles/[id]/page.tsx`, `miper-workbook.ts`, validación)
migran al vocabulario nuevo.

#### 5.1 Reglas de negocio por clasificación y control (§13 y §15)

Implementadas en **un solo** validador puro (`lib/validation/prevention-module/miper-completeness.ts`) que usan
la grilla (en vivo) y el servicio (al enviar):

| Condición | Regla |
|---|---|
| Toda fila | P, C, factor, peligro, riesgo, daño probable, actividad, tarea, puesto y controlado completos para poder enviar. |
| `controlled_status ∈ {yes, partial}` | Al menos una medida. |
| `important` | Al menos una medida; si `controlled_status ≠ yes`, al menos una medida pendiente con responsable y plazo. |
| `intolerable` | Al menos una medida con responsable y plazo **y** vinculada a una actividad del programa. Advertencia crítica permanente mientras siga Intolerable. |
| Toda medida | Descripción, tipo I–V y plazo; responsable obligatorio salvo en `tolerable`. |

Estas reglas **bloquean el envío a revisión** y, en un MIPER vigente, generan alertas (§8.2).
No bloquean el guardado de una celda, porque una fila se completa de a poco.

---

### 6. Flujo, estados y permisos

#### 6.1 Estados

Rótulo en pantalla = combinación de `lifecycle` y `review_state` (y "cambios pendientes"
calculado):

| `lifecycle` | `review_state` | Rótulo |
|---|---|---|
| `draft` | `none` | Borrador |
| `draft` | `in_review` | Enviado a revisión / En revisión por Prevención (según `opened_at` de la ronda) |
| `draft` | `observed` | Con observaciones |
| `draft` | `pending_approval` | Revisión técnica aprobada · Pendiente de aprobación Legal y RRHH |
| `in_force` | `none` | Vigente · vN (o "Vigente vN · cambios pendientes de revisión") |
| `in_force` | `in_review` / `observed` / `pending_approval` | Vigente vN · en revisión técnica / con observaciones / pendiente Legal y RRHH |
| `superseded` | — | Reemplazado por el período AAAA |

#### 6.2 Transiciones

| Acción | Efecto | Quién | Condiciones (servidor) |
|---|---|---|---|
| Enviar a revisión | `none`/`observed` → `in_review`; crea ronda `technical` con foto | `risk:edit` en la faena | Validador §5.1 sin errores; en un reenvío, todas las observaciones abiertas están respondidas; en un MIPER vigente, hay cambios pendientes. |
| Abrir ronda | fija `opened_at` | `risk:review` | Idempotente. |
| Devolver con observaciones | `in_review` → `observed` | `risk:review` | Al menos una observación abierta en la ronda; distinta de la autora. |
| Aprobar revisión técnica | `in_review` → `pending_approval`; crea ronda `legal_rrhh` con la misma foto | `risk:review` | Sin observaciones abiertas; distinta de la autora. |
| Solicitar correcciones | `pending_approval` → `observed` | `risk:approve_legal` | Al menos una observación. El reenvío vuelve a `in_review` (la Jefa valida la corrección). |
| Aprobar | `pending_approval` → `none`; sella versión desde la foto de la ronda; `lifecycle` → `in_force` | `risk:approve_legal` | Distinto de la autora y de la revisora técnica. Si es el primer `in_force` del período, el MIPER vigente del período anterior pasa a `superseded`. Activa el programa (F2). Dispara los ganchos existentes: reloj PDTP de 30 días, acreditación N°35 y documento generado `miper`. |
| Iniciar período | crea un MIPER `draft` del período nuevo, copiado del vigente | `risk:edit` | No existe ya un MIPER no reemplazado para `(faena, período)`. |
| Descartar borrador | elimina un MIPER `draft` nunca enviado | `risk:edit` | Sin rondas. Queda auditado. |

**Edición.** El MIPER se edita siempre salvo `superseded`. La revisión trabaja sobre la foto de
la ronda: lo editado después del envío queda para la ronda siguiente, y al aprobar se sella lo
revisado, no lo vivo. En un MIPER vigente, un cambio aplica de inmediato (y sus actividades se
activan de inmediato) y se muestra como "cambio pendiente de revisión" hasta el próximo sellado.

Toda validación vive en el servicio; la UI refleja lo que el servidor permite. La concurrencia
por fila usa `version` (patrón `expectedVersion` ya usado en `transitionRiskMatrix`).

#### 6.3 Permisos

En `modules/prevention/manifest.ts`, con paridad en `modules/registry.ts`, navegación,
`lib/services/module-toggles.ts` y `db:sync-rbac`:

| Permiso | Estado | Uso | Grants por defecto |
|---|---|---|---|
| `prevention:risk:view` | se conserva | Ver MIPER dentro del alcance | sin cambios |
| `prevention:risk:edit` | se conserva | Crear, editar, responder observaciones, enviar | sin cambios (`prevencionista_faena`, `admin_contrato`, `prevencionista`) |
| `prevention:risk:review` | se conserva | Revisión técnica | sin cambios (`prevencionista`, `jefa_chome`) |
| `prevention:risk:approve_legal` | **nuevo** | Aprobación Legal y RRHH | `gerente_legal_rrhh`, `administrador` |
| `prevention:risk:program:execute` | **nuevo** (F2) | Registrar Se hizo / No se hizo y evidencia | `prevencionista_faena`, `prevencionista`, `jefe_terreno`, `supervisor_terreno`, `admin_contrato`, `administrador` |
| `prevention:risk:catalog:manage` | **nuevo** | Administrar factores de riesgo | `prevencionista`, `administrador` |
| `prevention:risk:approve`, `prevention:risk:publish` | **se retiran** | — | — |

Se usa una clave nueva en vez de reutilizar `risk:approve` porque los grants por defecto sólo
se aplican cuando el permiso aparece por primera vez (`system-rbac.ts`): reutilizarla convertiría
en aprobadores finales, sin decisión de nadie, a los roles que ya la tienen en la base.
`jefa_chome` conserva `risk:review` en el código; si no corresponde, se retira desde
`/admin/roles`.

**Alcance por faena.** `edit` y `program:execute` se evalúan con `resolveWorksiteScope`; `review`
y `approve_legal` los tienen roles globales. El responsable nominal de una actividad puede
registrar sus ocurrencias sin `program:execute` si tiene `risk:view` sobre la faena.

**Segregación.** Autora (quien envía la ronda) ≠ revisora técnica ≠ aprobador Legal y RRHH, con
`requireDifferentActor` (`lib/auth/segregation.ts`). `override_segregation` y `sign_own_work`
conservan su significado.

**Recordatorios.** `MATRIX_TRANSITIONS` / `MATRIX_PERMISSION` se reescriben sobre
`review_state`; el recordatorio de firma pendiente sigue derivándose de ellos.

---

### 7. Programa de Trabajo Preventivo (F2)

#### 7.1 Encabezado RE-04.1

Título "Programa de Trabajo Preventivo", período, razón social, dirección casa matriz, RUT,
**representante** (Administrador de contrato de la faena, mismo criterio que §4.8), fecha de
elaboración, N° de centros de trabajo (calculado), fecha última revisión (última versión
sellada) y encargado del programa (usuario).

#### 7.2 Actividades

Columnas: N°, Proceso (desde el diccionario de actividades del MIPER), Actividad a realizar /
medida de control, Responsable, Centro de trabajo, Fecha programada (fecha única o frecuencia),
Fecha de ejecución efectiva (de las ocurrencias), Indicador de avance (calculado, §7.5).

#### 7.3 Generación desde el MIPER, con deduplicación

"Generar actividades" recorre las medidas sin actividad y propone agrupaciones por descripción
normalizada (minúsculas, sin tildes, sin puntuación ni palabras vacías) y similitud de tokens
sobre un umbral. Por cada grupo o medida el usuario elige: **crear actividad nueva**, **asociar a
una actividad existente** o **dejar sin actividad** (esto último sólo para medidas de filas
Tolerable o Moderado). La decisión siempre es del usuario; el sistema sólo propone. El vínculo es
N:M (`…_program_action_controls`).

Desde una actividad: "Esta actividad se creó por los siguientes riesgos del MIPER" (enlaces a
`?fila=`). Desde un riesgo: medidas → actividades → ocurrencias → evidencias.

#### 7.4 Ocurrencias y ejecución

- Se generan desde `starts_on` hasta el 31-12 del período según `schedule_kind`. En un MIPER
  `draft` las actividades existen pero **no generan ocurrencias** hasta la primera aprobación; en
  un MIPER `in_force`, una actividad nueva genera sus ocurrencias al crearse.
- **Se hizo**: fecha efectiva (`DatePicker`, no futura), al menos una evidencia, observación
  opcional; quién registró y cuándo se guardan automáticamente.
- **No se hizo**: fecha y motivo (≥ 10 caracteres), evidencia opcional. La ocurrencia queda
  **Incumplida** y cuenta 0.
- Una Incumplida puede registrarse después como **Se hizo (fuera de plazo)**, con su fecha y su
  evidencia, por acción manual. El registro "No se hizo" queda en el historial. Nunca hay una
  conversión automática.
- **Anular** un registro con error exige motivo; la ocurrencia vuelve al resultado del registro
  vigente anterior (o a Pendiente). Nada se borra.
- **Retirar** una actividad detiene sus ocurrencias futuras; las ya registradas se conservan.
- Al aprobarse el MIPER del período siguiente, las ocurrencias pendientes del programa anterior
  pasan a `superseded` ("reemplazadas") y no cuentan.

#### 7.5 Avance

Avance del programa = ocurrencias `done` (incluidas las fuera de plazo, marcadas) ÷ ocurrencias
planificadas del período, excluidas las `superseded`. Se muestran también
realizadas, pendientes, incumplidas y **vencidas** (pendientes con `due_on` pasado). Por actividad,
el indicador es el mismo cociente sobre sus ocurrencias. Nunca se ingresa a mano.

#### 7.6 Evidencia

Se usa `storePreventionEvidence` / `claimPreventionEvidenceUpload`
(`lib/services/prevention-evidence-upload.ts`) con un dominio nuevo `miper` (almacenamiento,
tipo detectado por contenido, sha256, fila en `prevention_evidence_uploads`). Tipos admitidos:
PDF, JPEG, PNG y además Word y Excel para actas y registros. `lib/file-validation.ts` ya define
`OFFICE`, así que se compone un conjunto `MIPER_EVIDENCE = PROOF ∪ OFFICE`. Retirar evidencia
exige motivo y queda auditado; el archivo no se borra.

#### 7.7 Integración con el PDTP corporativo

Sin cambios de contrato: la aprobación sigue abriendo y cerrando el reloj de 30 días y acreditando
la N°35. Además, cualquier actividad del programa MIPER puede declararse como fuente de cobertura
de una actividad PDTP mediante `prevention_pdtp_source_links` (`source_type = 'risk_control'`, ya
existente), cuyo filtro `status = 'published'` no cambia.

---

### 8. Experiencia de usuario

Todas las pantallas usan `PageHeader` + `PageContainer`, `Field`, `DatePicker`, `Badge`/`MetaBadge`,
`EmptyState` con CTA real, `ConfirmDialog` para decisiones, y `router.replace(…, { scroll: false })`
para pestañas y filtros en la URL.

#### 8.1 Rutas

- **`/prevencion/miper`**: portada con pestañas en URL.
  - **Por hacer** (por defecto; contenido por rol). Prevencionista: sus borradores, MIPER con
    observaciones y vigentes con cambios pendientes. Jefa: bandeja de revisión con faena,
    prevencionista, fecha de envío, versión, estado, total de riesgos, conteo por clasificación,
    última modificación y alertas. Legal y RRHH: pendientes de firma.
  - **Todas**: filtros por faena, período, estado y responsable.
  - **Resumen**: dashboard (§8.6, F3).
  - Acción de header **"Nueva MIPER"** → diálogo (faena en alcance, período, punto de partida:
    "desde la vigente vN" o "vacía") → abre el borrador.
- **`/prevencion/miper/[id]`**: espacio de trabajo con pestañas **Antecedentes · Matriz ·
  Programa · Revisión · Historial**. El modo (edición, revisión técnica, aprobación Legal y RRHH,
  lectura) se calcula en el servidor con estado + permisos + alcance.
- **Detalle de fila**: `Sheet` lateral enlazable con `?fila=<id>`: medidas, actividades derivadas,
  ocurrencias y evidencias, observaciones y diff contra la ronda anterior.
- `/prevencion/miper/controles/[id]` se conserva: es donde vive la verificación segregada de un
  control (MIPER-08). El `Sheet` de la fila enlaza a ella.
- `/prevencion/miper/[id]` entra en `ROUTES_WITH_OWN_SEARCH`: tiene dos tablas (matriz y
  programa), cada una con su propio buscador rotulado.

#### 8.2 Grilla de la matriz (desktop primero)

Componente propio del MIPER construido sobre `TableRoot stickyHeader`; no se agrega una librería
de grilla.

- Encabezado fijo; columnas N°, Actividad y Tarea fijas a la izquierda; scroll horizontal.
- Edición en la celda con teclado (flechas, Enter, Tab, Esc). **Guardado automático por fila**
  con concurrencia optimista; el error se muestra en la celda.
- Autocompletado (`Combobox`) desde los diccionarios de la faena y desde los valores ya usados de
  peligro, riesgo, daño y medida, **sin impedir valores nuevos**. Factor de riesgo: select del
  catálogo.
- P y C: selector con la descripción del criterio visible. MR y clasificación de solo lectura,
  recalculados al instante con `classify()`.
- **Agregar debajo** (hereda actividad, tarea, puesto y lugar), **duplicar**, **eliminar**
  (confirmación; en un MIPER vigente la baja queda como cambio pendiente).
- Agrupar por actividad, puesto o clasificación (grupos plegables). Filtros: clasificación,
  factor, controlado, observadas, modificadas. Orden por N° o MR.
- Celda "Medidas": chips por tipo I–V; Enter abre un editor rápido para varias medidas (tipo,
  descripción, responsable, plazo).
- Indicadores por fila del validador §5.1; el botón "Enviar a revisión" lista los bloqueos.
- Móvil: tarjetas de solo lectura (cumpliendo la regla de locators duplicados de `e2e/helpers.ts`).

#### 8.3 Clasificación visual

Badge con rótulo + ícono + tratamiento, usando siempre tokens `-ink` para el texto:

| Clasificación | Tratamiento |
|---|---|
| Tolerable | tinte verde, ícono check |
| Moderado | tinte ámbar, ícono de información |
| Importante | tinte rojo con borde, ícono de advertencia |
| Intolerable | relleno rojo sólido, texto blanco, ícono de alerta |

Si hay filas Intolerables, la matriz, la revisión, el dashboard y el programa muestran una
alerta crítica con el texto del criterio y el conteo.

#### 8.4 Revisión (Jefa) y aprobación (Legal y RRHH)

- **Franja de resumen en texto** (no tarjetas, regla A1): faena, autora, versión, fechas,
  dotación, total de riesgos, distribución por clasificación, no controlados, medidas sin
  responsable, medidas sin plazo, Importantes, Intolerables y actividades en el programa.
- **Filtros rápidos**: Solo Importantes · Solo Intolerables · No controlados · Observados ·
  Modificados desde la ronda anterior.
- Badges "Nueva" / "Modificada" / "Eliminada" por fila; diff campo por campo en el `Sheet`
  (foto de la ronda anterior o de la última versión sellada → foto actual).
- "Observar" en cualquier fila y observaciones generales en la pestaña Revisión.
- Barra de decisión con `ConfirmDialog`: Jefa (Devolver con observaciones / Aprobar revisión
  técnica), Legal y RRHH (Solicitar correcciones / Aprobar, con comentario obligatorio al
  solicitar correcciones).
- **Prevencionista con observaciones**: la pestaña Revisión es su bandeja (observación, fila
  enlazada, respuesta). Las filas observadas se marcan en la grilla. "Reenviar a revisión" indica
  cuántas faltan por responder.

#### 8.5 Antecedentes e Historial

- **Antecedentes**: formulario con origen visible de cada valor prellenado y opción de restaurar;
  dotación declarada con el conteo real al lado.
- **Historial**: cadena de MIPER de la faena por período, versiones selladas de cada uno
  (enlazadas, exportables) y línea de tiempo de eventos con `EntityTimeline` (actor, rol, fecha,
  hora, acción, objeto).

#### 8.6 Dashboard (F3)

- Filtros primarios: faena, período, estado, responsable.
- **Cuatro tiles accionables** (A1): pendientes de revisión o aprobación → "Por hacer";
  Intolerables + Importantes → lista filtrada; riesgos sin controlar → lista filtrada; avance del
  programa.
- Franja de texto secundaria: MIPER vigentes, con observaciones, Tolerables y Moderados, medidas
  pendientes, actividades vencidas.
- Tabla por faena: estado, versión, distribución por clasificación, sin controlar, avance,
  alertas.

---

### 9. Alertas, exportación e importación (F3)

#### 9.1 Alertas

Notificación sólo cuando hay una acción que corresponde a una persona concreta:

| Evento | Canal | Destinatario |
|---|---|---|
| Fila pasa a Intolerable | notificación deduplicada por fila | prevencionista de la faena + Jefa |
| Enviado / devuelto / pendiente de firma | notificación | siguiente responsable |
| Ocurrencia vencida (barrido diario) | notificación deduplicada por ocurrencia | responsable + prevencionista |
| Ocurrencia "No se hizo" | notificación | Jefa |
| Importante sin medida; medida sin responsable o plazo | indicador en la matriz + `getPreventionAttention` | — |
| En revisión o pendiente de firma > 5 días hábiles | recordatorio de firma pendiente existente, con umbral | revisor o firmante |

Se agregan tipos de notificación nuevos al union de `db/schema/audit.ts`, un tipo MIPER en
`getPreventionAttention` y en la cola "Mi trabajo" (`operational-work-queue.ts`), usando
`notifyAfterCommit` y `getUserIdsWithPermissionForWorksite`.

#### 9.2 Exportación

Sólo Excel (ExcelJS), vía `ExportButton`. Se reescribe `lib/reports/miper-workbook.ts`:

- **RE-04 IPER**: encabezado + matriz con la estructura y el orden del RE-04 de Biodiversa;
  clasificación en texto y color.
- **Modificaciones**: versiones selladas.
- **Criterios de Evaluación IPER**: desde `methodology_snapshot`.
- **Programa de Trabajo**: encabezado RE-04.1 y actividades con fecha efectiva y avance.
- Página horizontal, ajustada al ancho, encabezados repetidos.
- Por defecto se exporta la **versión sellada**; opcionalmente el estado vivo con la leyenda
  "Incluye cambios no aprobados".
- Al aprobar, la versión sellada se archiva con el documento generado `miper` existente
  (`lib/services/generated-documents/kinds.ts:64`).

#### 9.3 Importación RE-04

Reemplaza al importador anterior (`prevention-risk-import.ts`), que F1 retira del UI porque el
modelo cambia. Lee la hoja "RE-04 IPER" del formato real, mapea los valores de texto conocidos
("SÍ, CONTROLADO", "PARCIALMENTE CONTROLADO", "RUTINARIA", "NO RUTINARIA") y muestra una vista
previa con problemas por fila: factor desconocido (mapear al catálogo o crearlo), P o C fuera de
{1, 2, 4}, MR o clasificación del Excel que no coincide con el cálculo (se informa, manda el
cálculo). Carga las filas en un MIPER en borrador o las agrega al vivo. Las tablas
`prevention_risk_import_batches` / `_rows` se reutilizan si su forma sirve; si no, se reemplazan en
la misma fase.

---

### 10. Migraciones

- Se generan con `npm run db:generate` desde `db/schema/*.ts`, con SQL idempotente anexado cuando
  haga falta (columnas generadas, trigger de inmutabilidad, semillas de catálogo y metodología),
  `DROP … IF EXISTS` y checksums registrados
  (`node scripts/verify-migration-chain.mjs --update-checksums`). Al final,
  `db:generate` reporta "No schema changes".
- Aunque no hay datos reales, **ninguna fila existente se borra**: las matrices y filas previas se
  marcan `legacy` (solo lectura, fuera de todos los flujos) y las restricciones nuevas se escriben
  para no aplicar a filas legacy. Las columnas antiguas (`inherent_*`, `residual_*`, …) se eliminan
  en una migración posterior, **después** de comprobar en producción que no quedan filas legacy
  (`scripts/migration-preflight.mjs` bloquea el despliegue si las hay).
- Consumidores por FK (§1.6): **no cambian**, porque el vigente sigue siendo `status = 'published'`.
  Los que leen `residual_level` (mapa CGRD, ficha de control, CAPA por control ineficaz) pasan a
  un helper que usa la clasificación RE-04 y cae a `residual_level` sólo en filas legacy.
- RBAC por manifiesto, nunca en migraciones (`db:sync-rbac`).

---

### 11. Pruebas y verificación

| Nivel | Qué cubre |
|---|---|
| Unitarias (`test:fast`) | `classify(p, c)`; validador de completitud §5.1; máquina de estados + permiso + segregación por transición; diff de fotos; agrupación de deduplicación; generación de ocurrencias por frecuencia; cálculo de avance. |
| PGlite (`test:pglite`) | Flujo completo en servicios; alcance por faena; inmutabilidad de versiones (trigger); columnas generadas y CHECK; evidencia solo de inserción; "Se hizo" rechazado sin evidencia o con fecha futura; consumidores por FK con `in_force`. |
| Acciones | Cada acción rechaza a un usuario sin permiso o fuera de su faena. |
| E2E (`test:e2e`) | Escenario §12 completo, determinista, con tres usuarios sembrados (prevencionista de faena, Jefa = `prevencionista`, `gerente_legal_rrhh`), locators por rol y helpers `textoVisible()` / `campoInspeccion()`. |
| Navegador | Recorrido asistido de cada fase con informe fechado en `qa/reports/`, declarando alcance y lo no recorrido. |
| Puertas | `typecheck`, `lint`, `test:fast`, `test:pglite`, `test:e2e`, `db:verify-migrations`, `doctor`, `check:secrets`. |

---

### 12. Criterio de aceptación (escenario de extremo a extremo)

El rediseño se considera terminado cuando el E2E recorre, sin datos duplicados a mano, sin
cálculos fuera de la plataforma y sin consultar el Excel:

1. Un prevencionista entra a una faena y crea un MIPER nuevo.
2. Completa antecedentes (prellenados desde la faena y la empresa).
3. Agrega actividades, tareas y puestos; identifica peligros y riesgos.
4. Selecciona P y C; la plataforma calcula MR y clasificación.
5. Define medidas con tipo de control, responsable y plazo.
6. Genera las actividades del programa, reutilizando una para varias medidas.
7. Envía a revisión.
8. La Jefa revisa y observa un riesgo concreto.
9. El prevencionista responde, corrige y reenvía; la Jefa ve la fila como "Modificada".
10. La Jefa aprueba técnicamente; Legal y RRHH revisa y aprueba.
11. El MIPER queda vigente (v1) y las actividades aparecen en el programa con ocurrencias.
12. Un responsable marca "Se hizo" con fecha efectiva y evidencia; el avance se actualiza.
13. Otra ocurrencia se marca "No se hizo" y queda Incumplida.
14. La Jefa consulta el avance general.
15. Desde una actividad se llega al riesgo que la originó; desde un riesgo, a sus medidas,
    actividades y evidencias.
16. El prevencionista agrega un riesgo nuevo al MIPER vigente: aplica de inmediato, aparece como
    cambio pendiente, se envía, se revisa y se sella la v2; la v1 sigue consultable.
17. Todo el proceso queda en el historial con actor, rol, fecha y hora.

---

### 13. Fases

Un plan de implementación por fase, en este orden:

| Fase | Contenido | Pasos del §12 |
|---|---|---|
| **F1 – Núcleo** | Modelo (§4.1–4.6, 4.8, 4.9), metodología y vocabulario (§5), flujo y permisos (§6), grilla, antecedentes, revisión con observaciones y diff, versiones, historial, bandeja "Por hacer" mínima, retiro del importador anterior, y el libro RE-04 básico (hojas *RE-04 IPER*, *Modificaciones* y *Criterios*, generado desde la versión sellada), porque el archivado automático se dispara en cada aprobación y el libro anterior depende de columnas que dejan de usarse. | 1–5, 7–10, 16 (sin programa), 17 |
| **F2 – Programa** | §4.7, §7: actividades, deduplicación, ocurrencias, ejecución, evidencia, avance, trazabilidad riesgo ↔ actividad, activación con la aprobación. | 6, 11–15 |
| **F3 – Consolas** | Dashboard (§8.6), alertas (§9.1), exportación del estado vivo y hoja *Programa de Trabajo* (§9.2), importación RE-04 (§9.3), E2E completo del §12. | 14 y el escenario completo |

---

### 14. Decisiones abiertas (con valor por defecto)

1. **N° de adherente** en el perfil de empresa y **comuna** en la faena. En el RE-04 de Biodiversa
   el adherente se llenó con el N° de contrato; como el campo del encabezado es editable, admite
   ambos usos.
2. **Umbral de espera** para recordar revisiones y firmas: 5 días hábiles.
3. **Un MIPER nunca aprobado no genera ocurrencias ejecutables.** Si una faena nueva tiene un
   riesgo Intolerable, su control inmediato se gestiona fuera del programa (permiso de trabajo,
   detención) hasta la primera aprobación.
4. **Umbral de similitud** para proponer agrupaciones de medidas: se fija con los datos reales del
   RE-04 de Biodiversa durante F2 y queda como constante documentada.

---

## Parte II — Plan de implementación de la F1 (núcleo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la MIPER en un documento vivo por faena y período, con evaluación RE-04 automática (P×C → MR → clasificación), grilla editable, revisión técnica con observaciones por fila y diff, aprobación Legal y RRHH, versiones selladas inmutables e historial.

**Architecture:** Se evolucionan las tablas `prevention_risk_*`. `status` guarda el ciclo de vida (`draft | published | superseded`, con `published` = vigente) y una columna nueva `review_state` guarda la revisión. La lógica pura (metodología, completitud, diff, estados) vive en `lib/prevention/miper/` y la usan tanto la UI como el servidor. Los servicios nuevos van en `lib/services/miper/`, y el flujo antiguo se retira de `lib/services/prevention-risk-legal.ts`. La UI se divide en portada (`/prevencion/miper`) y espacio de trabajo (`/prevencion/miper/[id]`).

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Drizzle ORM 0.45 + drizzle-kit 0.31 (PostgreSQL; PGlite en pruebas), Zod 4, ExcelJS 4, Vitest 4, Playwright 1.62.

**Spec:** Parte I de este mismo documento (leer §3–§6, §8.1–8.5, §10–§13 antes de empezar).

### Global Constraints

- Los P y C sólo admiten los valores 1, 2 y 4. MR = P × C. Clasificación: MR 1–2 `tolerable`, 4 `moderate`, 8 `important`, 16 `intolerable`. MR y clasificación son **columnas generadas por Postgres**.
- Rótulos visibles: "Tolerable", "Moderado", "Importante", "Intolerable". Nunca mostrar un valor de enum crudo (regla A6).
- El campo del representante se rotula **"Representante de la empresa en la faena (Administrador de contrato)"**; nunca "Representante legal".
- `status` ∈ `draft | published | superseded`; `review_state` ∈ `none | in_review | observed | pending_approval`.
- Permisos nuevos: `prevention:risk:approve_legal`, `prevention:risk:catalog:manage`. Se retiran `prevention:risk:approve` y `prevention:risk:publish`. (`prevention:risk:program:execute` es de F2: no crearlo acá.)
- Separación de funciones: quien envía la ronda ≠ revisora técnica ≠ aprobador Legal y RRHH.
- Toda validación vive en el servicio; la UI sólo refleja lo que el servidor permite.
- Migraciones: nunca editar `_journal.json` a mano ni un `.sql` ya generado; registrar checksums con `node scripts/verify-migration-chain.mjs --update-checksums`; `DROP … IF EXISTS`; al final `npm run db:generate` debe responder "No schema changes".
- Fechas de hoy con `todayInChile()`; formateo con `formatDate`/`formatDateTime` (`@/lib/utils`); en UI nunca `toLocaleDateString()` ni `<input type="date">` (usar `DatePicker`).
- Páginas con `PageHeader` + `PageContainer`; acciones de página en `PageHeader.actions`; texto con tokens `-ink`; `router.replace(url, { scroll: false })` para pestañas y filtros en la URL.
- Exportaciones sólo en Excel (ExcelJS).
- En E2E: locators por rol; `textoVisible()`/`campoInspeccion()` de `e2e/helpers.ts` en vez de `.first()`; `exact: true` cuando un nombre es prefijo de otro.
- Mensajes de error de dominio en español y accionables (`RiskLegalDomainError`).

### Review Focus

1. **Dos pestañas editando la misma fila.** Quien guarda segundo debe recibir "La fila cambió mientras la editabas. Recarga." y no pisar el cambio del otro. Prueba en Task 9.
2. **Editar el MIPER mientras está en revisión.** La revisora debe ver la foto enviada, sin los cambios posteriores, y aprobar debe sellar esa foto, no los datos vivos. Prueba en Task 11.
3. **Una revisora técnica que también tiene `risk:edit` y fue quien envió.** No debe poder aprobar su propio envío, aunque tenga ambos permisos. Prueba en Task 11.
4. **Un usuario de otra faena que conoce el `matrixId`.** Leer, editar u observar debe fallar con "fuera de alcance", sin filtrar datos. Pruebas en Tasks 8 y 12.
5. **Nombres casi iguales en diccionarios** ("Carga de lodo" y "carga de lodo "). Deben resolverse al mismo valor y no duplicar el autocompletado. Prueba en Task 7.

---

### Prerrequisitos (antes de la Task 1)

- [ ] **P1: El trabajo de "sexo del trabajador" (migración 0343, `lib/person-sex.ts`) está committeado en `main`.** F1 depende de `workers.sex` y de que la migración 0344 se genere encima de la 0343. Verificar con `git log --oneline -1 -- db/migrations/0343_worker_sex.sql`: debe mostrar un commit. Si no, detenerse y pedírselo al usuario.
- [ ] **P2: Crear la rama de trabajo** (`superpowers:using-git-worktrees` si se ejecuta aislado):

```bash
git switch -c prevencion/miper-f1-nucleo
```

- [ ] **P3: Bases de datos locales disponibles**
  - `pg_isready -h 127.0.0.1 -p 55432` responde: contenedor `bodega-e2e-postgres`, para las suites `*-postgres` y E2E.
  - La base de desarrollo `bodega-dev-db` está en `127.0.0.1:5433`.
  - **Nunca apuntar a `plataforma-db-1`**: es producción.

---

### Mapa de archivos

**Lógica pura (cliente y servidor):**
- Crear `lib/prevention/miper/methodology.ts`: escalas P/C, bandas y textos del RE-04, `classify()`, `magnitudeOf()` y `criticalityOf()`.
- Crear `lib/prevention/miper/snapshot.ts`: tipos `MiperSnapshot` y `diffSnapshots()`.
- Crear `lib/prevention/miper/completeness.ts`: `checkMiperCompleteness()`.
- Crear `lib/prevention/miper/states.ts`: estados, rótulos, reglas de transición y permiso de firma pendiente.
- Crear `lib/prevention/miper/names.ts`: `normalizeMiperName()` y buckets de dotación por sexo.
- Crear `lib/prevention/miper/grid-view.ts`: filtros y agrupación de la grilla.
- Crear `lib/prevention/miper/workspace-mode.ts`: qué puede hacer la persona en el espacio de trabajo.
- Crear `lib/prevention/miper/history-labels.ts`: rótulos del historial.
- Modificar `lib/prevention/risk-levels.ts`: alias `tolerable → low` y `effectiveRiskLevel()`.

**Validación:**
- Crear `lib/validation/prevention-module/miper.ts`: schemas Zod de todas las acciones.
- Modificar `lib/validation/prevention-module/risk-legal.ts`: quitar los schemas del flujo antiguo.
- Modificar `lib/validation/masters.ts`: `commune` en `worksiteSchema`.

**Base de datos:**
- Modificar `db/schema/prevention/risk-legal.ts`: matrices, entradas, controles y diccionarios; tablas `prevention_risk_factors` y `prevention_risk_locations`.
- Crear `db/schema/prevention/miper.ts`: rondas, versiones y observaciones.
- Modificar `db/schema/prevention/index.ts` (export) y `db/schema/worksites.ts` (`commune`).
- Crear `db/migrations/0344_miper_f1_nucleo.sql` + snapshot (generados) con SQL anexado.
- Crear `db/__tests__/miper-constraints.test.ts` (PGlite).

**Servicios:**
- Crear en `lib/services/miper/`:
  - `shared.ts`: acceso, alcance, historial y bloqueo.
  - `dictionaries.ts`.
  - `prefill.ts`.
  - `matrices.ts`.
  - `entries.ts`.
  - `snapshots.ts`.
  - `observations.ts`.
  - `workflow.ts`.
  - `queries.ts`.
  - `risk-factors.ts`.
- Modificar `lib/services/prevention-risk-legal.ts`: retirar el flujo antiguo de la MIPER y usar `shared.ts`.
- Borrar `lib/services/prevention-risk-import.ts` y `lib/services/prevention-risk-import.test.ts`.
- Modificar `lib/services/pdtp/reminders.ts`, `lib/services/pdtp/connectors.ts`, `lib/services/pdtp-adapters/fulfillment-contract-2026.ts`, `lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts`, `lib/services/prevention-risk-map.ts`, `lib/services/generated-documents/renderers.ts` y `lib/services/system-settings.ts` (N° adherente).
- Modificar `modules/prevention/manifest.ts`.

**Reportes:**
- Reescribir `lib/reports/miper-workbook.ts` (libro RE-04 desde la versión sellada).
- Modificar `app/api/prevencion/miper/[id]/export/route.ts`: `[id]` pasa a ser el id de la versión.

**UI:**
- Reescribir `app/(app)/prevencion/miper/page.tsx` (portada) y `actions.ts` (acciones nuevas).
- Crear en `app/(app)/prevencion/miper/`:
  - `miper-home.tsx`.
  - `new-miper-dialog.tsx`.
  - `factores/page.tsx` y `factores/risk-factors-admin.tsx`.
- Crear en `app/(app)/prevencion/miper/[id]/`:
  - `page.tsx`, `loading.tsx`, `miper-workspace.tsx` y `workflow-bar.tsx`.
  - `antecedentes-form.tsx`.
  - `matrix-grid.tsx` y `use-row-saver.ts`.
  - `entry-sheet.tsx`, `observation-item.tsx`, `review-panel.tsx` e `history-panel.tsx`.
  - `summary-strip.tsx`.
- Crear en `components/prevention/`: `risk-classification-badge.tsx` y `pc-select.tsx`.
- Borrar `app/(app)/prevencion/miper/miper-workbench.tsx` y `lib/__tests__/miper-ui-contract.test.ts`.
- Modificar:
  - `app/(app)/prevencion/miper/controles/[id]/page.tsx`: nivel efectivo.
  - `app/(app)/prevencion/cgrd/mapa/risk-map-panel.tsx`: nivel efectivo.
  - `components/layout/top-bar.tsx`: buscador propio en el espacio de trabajo.
  - `app/(app)/admin/faenas/*`: comuna.
  - `app/(app)/admin/configuracion/*`: N° de adherente.

**E2E:**
- Modificar `e2e/setup-db.ts`: tres usuarios MIPER.
- Crear `e2e/prevencion-miper-flujo.spec.ts`.
- Modificar `e2e/prevencion-miper-matriz.spec.ts`.

---

#### Task 1: Metodología RE-04 y vocabulario de clasificación

**Files:**
- Create: `lib/prevention/miper/methodology.ts`
- Modify: `lib/prevention/risk-levels.ts:45-49` (alias) y agregar `effectiveRiskLevel`
- Test: `lib/prevention/miper/methodology.test.ts`

**Interfaces:**
- Produces:
  - `type MiperScaleValue = 1 | 2 | 4`
  - `MIPER_SCALE_VALUES`
  - `PROBABILITY_LEVELS` y `CONSEQUENCE_LEVELS`: `ReadonlyArray<{ value: MiperScaleValue; label: string; description: string }>`
  - `RISK_CLASSIFICATIONS`, `type RiskClassification`, `CLASSIFICATION_LABEL`, `CLASSIFICATION_CRITERIA`
  - `isScaleValue(v: unknown): v is MiperScaleValue`
  - `magnitudeOf(p, c): number | null`
  - `classify(p, c): RiskClassification | null`
  - `criticalityOf(c: RiskClassification): RiskLevel`
  - `RE04_METHODOLOGY`: fila para `prevention_risk_methodologies`
  - En `risk-levels.ts`: `effectiveRiskLevel(input: { classification?: string | null; residualLevel?: string | null }): RiskLevel | null`

- [ ] **Step 1: Write the failing test**

```ts
// lib/prevention/miper/methodology.test.ts
import { describe, expect, it } from "vitest"
import {
  CLASSIFICATION_CRITERIA, CLASSIFICATION_LABEL, CONSEQUENCE_LEVELS, PROBABILITY_LEVELS,
  RE04_METHODOLOGY, RISK_CLASSIFICATIONS, classify, criticalityOf, isScaleValue, magnitudeOf,
} from "./methodology"
import { effectiveRiskLevel, normalizeRiskLevel } from "@/lib/prevention/risk-levels"

describe("metodología RE-04", () => {
  it("MR es P × C y la clasificación sigue las bandas del RE-04", () => {
    const table: Array<[number, number, number, string]> = [
      [1, 1, 1, "tolerable"], [1, 2, 2, "tolerable"], [2, 1, 2, "tolerable"],
      [2, 2, 4, "moderate"], [1, 4, 4, "moderate"], [4, 1, 4, "moderate"],
      [2, 4, 8, "important"], [4, 2, 8, "important"],
      [4, 4, 16, "intolerable"],
    ]
    for (const [p, c, mr, cls] of table) {
      expect(magnitudeOf(p, c)).toBe(mr)
      expect(classify(p, c)).toBe(cls)
    }
  })

  it("sin P o C, o con un valor fuera de {1,2,4}, no hay MR ni clasificación", () => {
    expect(classify(null, 2)).toBeNull()
    expect(classify(2, undefined)).toBeNull()
    expect(classify(3, 2)).toBeNull()
    expect(magnitudeOf(2, 0)).toBeNull()
    expect(isScaleValue(4)).toBe(true)
    expect(isScaleValue(3)).toBe(false)
  })

  it("cada nivel y cada banda tiene rótulo y texto del criterio", () => {
    expect(PROBABILITY_LEVELS.map((l) => l.value)).toEqual([1, 2, 4])
    expect(CONSEQUENCE_LEVELS.map((l) => l.value)).toEqual([1, 2, 4])
    for (const level of [...PROBABILITY_LEVELS, ...CONSEQUENCE_LEVELS]) expect(level.description.length).toBeGreaterThan(20)
    for (const cls of RISK_CLASSIFICATIONS) {
      expect(CLASSIFICATION_LABEL[cls]).toMatch(/^[A-ZÁÉÍÓÚ]/)
      expect(CLASSIFICATION_CRITERIA[cls].length).toBeGreaterThan(40)
    }
    expect(CLASSIFICATION_CRITERIA.intolerable).toMatch(/se debe prohibir el trabajo/)
  })

  it("la metodología persistible congela escalas y bandas", () => {
    expect(RE04_METHODOLOGY.code).toBe("RE-04-CHOME")
    expect(RE04_METHODOLOGY.configuration.probability).toHaveLength(3)
    expect(RE04_METHODOLOGY.configuration.bands.map((b) => b.classification)).toEqual([...RISK_CLASSIFICATIONS])
  })

  it("criticidad para CAPA y mapa: Tolerable es la más baja", () => {
    expect(criticalityOf("tolerable")).toBe("low")
    expect(criticalityOf("moderate")).toBe("medium")
    expect(criticalityOf("important")).toBe("high")
    expect(criticalityOf("intolerable")).toBe("critical")
  })

  it("nivel efectivo: manda la clasificación y cae a residual sólo en filas legacy", () => {
    expect(effectiveRiskLevel({ classification: "intolerable", residualLevel: "low" })).toBe("critical")
    expect(effectiveRiskLevel({ classification: null, residualLevel: "high" })).toBe("high")
    expect(effectiveRiskLevel({ classification: null, residualLevel: null })).toBeNull()
    // El alias antiguo "tolerable → medium" contradecía el RE-04.
    expect(normalizeRiskLevel("tolerable")).toBe("low")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/prevention/miper/methodology.test.ts`
Expected: FAIL con "Failed to resolve import ./methodology".

- [ ] **Step 3: Write the implementation**

```ts
// lib/prevention/miper/methodology.ts
/**
 * Metodología del RE-04 (hoja "Criterios de Evaluación IPER" de la matriz de
 * Biodiversa). Es la única fuente de las escalas y los textos: la grilla la usa
 * para el cálculo instantáneo, la migración la replica en la columna generada, y
 * `RE04_METHODOLOGY` la congela en `methodology_snapshot` de cada MIPER.
 */
import type { RiskLevel } from "@/lib/prevention/risk-levels"

export const MIPER_SCALE_VALUES = [1, 2, 4] as const
export type MiperScaleValue = typeof MIPER_SCALE_VALUES[number]

export const PROBABILITY_LEVELS: ReadonlyArray<{ value: MiperScaleValue; label: string; description: string }> = [
  { value: 1, label: "Baja", description: "El daño ocurrirá rara vez o en contadas ocasiones (posibilidad de ocurrencia remota)." },
  { value: 2, label: "Media", description: "El daño ocurrirá en varias ocasiones (posibilidad de ocurrencia mediana (puede pasar), no siendo tan evidente)." },
  { value: 4, label: "Alta", description: "El daño ocurrirá siempre o casi siempre (posibilidad de ocurrencia inmediata, siendo evidente que pasará)." },
]

export const CONSEQUENCE_LEVELS: ReadonlyArray<{ value: MiperScaleValue; label: string; description: string }> = [
  { value: 1, label: "Baja (ligeramente dañino)", description: "Esta graduación debe ser adoptada en aquellos casos que pueden causar pequeñas lesiones o daños superficiales (cortes superficiales, magulladuras, etc.), o molestias e irritaciones con tiempos rápidos de recuperación." },
  { value: 2, label: "Media (dañino)", description: "Esta graduación debe ser adoptada en aquellos casos que pueden causar lesiones (laceraciones, quemaduras, torceduras, etc.) y/o intoxicaciones que pueden causar incapacidad temporal." },
  { value: 4, label: "Alta (extremadamente dañino)", description: "Esta graduación debe ser adoptada en aquellos casos en los cuales se puedan generar eventos extremadamente dañinos como amputaciones, lesiones múltiples que generen incapacidades permanentes y lesiones fatales." },
]

export const RISK_CLASSIFICATIONS = ["tolerable", "moderate", "important", "intolerable"] as const
export type RiskClassification = typeof RISK_CLASSIFICATIONS[number]

export const CLASSIFICATION_LABEL: Record<RiskClassification, string> = {
  tolerable: "Tolerable",
  moderate: "Moderado",
  important: "Importante",
  intolerable: "Intolerable",
}

/** Textos verbatim del RE-04, columna F de las filas 9–12. */
export const CLASSIFICATION_CRITERIA: Record<RiskClassification, string> = {
  tolerable: "No se necesita mejorar la acción preventiva. Sin embargo, se deben considerar soluciones más rentables o mejoras que no supongan una carga económica importante. Se requieren comprobaciones periódicas para asegurar que se mantiene la eficacia de las medidas de control.",
  moderate: "Se deben hacer esfuerzos para reducir el riesgo, determinando las inversiones precisas. Las medidas para reducir el riesgo se deben implementar en un período determinado. Cuando el riesgo moderado está asociado con consecuencias extremadamente dañinas, se precisará una acción posterior para establecer, con más precisión, la probabilidad de daño como base para determinar la necesidad de mejora de las medidas de control.",
  important: "No se debe comenzar ni continuar el trabajo hasta que se haya reducido el riesgo (puede que se precisen recursos considerables para controlar el riesgo). Cuando el riesgo corresponda a un trabajo que se está realizando, se debe remediar el problema en un tiempo inferior al de los riesgos moderados.",
  intolerable: "No debe comenzar ni continuar el trabajo hasta que se reduzca el riesgo. Si no es posible reducirlo, incluso con recursos ilimitados, se debe prohibir el trabajo.",
}

const BAND_MAGNITUDES: Record<RiskClassification, readonly number[]> = {
  tolerable: [1, 2], moderate: [4], important: [8], intolerable: [16],
}

export function isScaleValue(value: unknown): value is MiperScaleValue {
  return value === 1 || value === 2 || value === 4
}

export function magnitudeOf(probability: unknown, consequence: unknown): number | null {
  if (!isScaleValue(probability) || !isScaleValue(consequence)) return null
  return probability * consequence
}

/** Misma regla que la columna generada `prevention_risk_entries.classification`. */
export function classify(probability: unknown, consequence: unknown): RiskClassification | null {
  const mr = magnitudeOf(probability, consequence)
  if (mr === null) return null
  if (mr <= 2) return "tolerable"
  if (mr === 4) return "moderate"
  if (mr === 8) return "important"
  return "intolerable"
}

/** Puente al vocabulario de 4 niveles que usan la CAPA y el mapa de riesgos. */
export function criticalityOf(classification: RiskClassification): RiskLevel {
  return ({ tolerable: "low", moderate: "medium", important: "high", intolerable: "critical" } as const)[classification]
}

export const RE04_METHODOLOGY = {
  id: "riskmethod-re04-chome",
  code: "RE-04-CHOME",
  name: "Matriz de Identificación de Peligros y Evaluación de Riesgos (RE-04)",
  versionLabel: "REV-2026",
  kind: "primary" as const,
  authoritySource: "Formato RE-04 CHOME: probabilidad × consecuencia (1-2-4), magnitud del riesgo y clasificación en cuatro bandas.",
  configuration: {
    probability: PROBABILITY_LEVELS,
    consequence: CONSEQUENCE_LEVELS,
    bands: RISK_CLASSIFICATIONS.map((classification) => ({
      classification,
      label: CLASSIFICATION_LABEL[classification],
      magnitudes: BAND_MAGNITUDES[classification],
      criteria: CLASSIFICATION_CRITERIA[classification],
    })),
  },
}
```

En `lib/prevention/risk-levels.ts`, cambiar el alias `tolerable: "medium"` a `tolerable: "low"` y agregar al final:

```ts
import { criticalityOf, RISK_CLASSIFICATIONS, type RiskClassification } from "@/lib/prevention/miper/methodology"

/**
 * Nivel de 4 escalones de una fila MIPER. Manda la clasificación RE-04; sólo las
 * filas legacy (metodología anterior, sin P×C) caen a `residual_level`.
 */
export function effectiveRiskLevel(input: { classification?: string | null; residualLevel?: string | null }): RiskLevel | null {
  if (input.classification && (RISK_CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    return criticalityOf(input.classification as RiskClassification)
  }
  return input.residualLevel ? normalizeRiskLevel(input.residualLevel) : null
}
```

Hay un ciclo de imports: `methodology.ts` importa el **tipo** `RiskLevel` y `risk-levels.ts` importa valores. Un `import type` desaparece al compilar, así que el ciclo no existe en runtime; dejarlo como `import type`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- lib/prevention/miper/methodology.test.ts lib/__tests__/prevention-risk-legal.test.ts`
Expected: PASS en el archivo nuevo. En `prevention-risk-legal.test.ts` puede fallar la aserción del alias `tolerable`: actualizarla a `low` y releer el comentario de ese test para que diga lo nuevo.

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/miper/methodology.ts lib/prevention/miper/methodology.test.ts lib/prevention/risk-levels.ts lib/__tests__/prevention-risk-legal.test.ts
git commit -m "feat(miper): metodología RE-04 con clasificación P×C y nivel efectivo"
```

---

#### Task 2: Normalización de nombres y dotación por sexo

**Files:**
- Create: `lib/prevention/miper/names.ts`
- Test: `lib/prevention/miper/names.test.ts`

**Interfaces:**
- Produces:
  - `normalizeMiperName(value: string): string`
  - `cleanMiperName(value: string | null | undefined): string | null`: trim, espacios colapsados, `null` si queda vacío.
  - `headcountFromSexCounts(rows: Array<{ sex: string | null; count: number }>): { total: number; male: number; female: number; other: number; unrecorded: number }`

- [ ] **Step 1: Write the failing test**

```ts
// lib/prevention/miper/names.test.ts
import { describe, expect, it } from "vitest"
import { cleanMiperName, headcountFromSexCounts, normalizeMiperName } from "./names"

describe("nombres de diccionario MIPER", () => {
  it("dos escrituras del mismo nombre normalizan igual", () => {
    expect(normalizeMiperName("Carga de lodo")).toBe(normalizeMiperName("  carga  DE lodo "))
    expect(normalizeMiperName("Mantención")).toBe(normalizeMiperName("mantencion"))
  })
  it("limpia espacios y devuelve null si queda vacío", () => {
    expect(cleanMiperName("  Operador   de grúa ")).toBe("Operador de grúa")
    expect(cleanMiperName("   ")).toBeNull()
    expect(cleanMiperName(null)).toBeNull()
  })
})

describe("dotación por sexo", () => {
  it("hombres, mujeres y el resto como Otro; sin registrar se informa aparte", () => {
    const result = headcountFromSexCounts([
      { sex: "male", count: 14 }, { sex: "female", count: 2 },
      { sex: "intersex", count: 1 }, { sex: "unspecified", count: 1 }, { sex: null, count: 3 },
    ])
    expect(result).toEqual({ total: 21, male: 14, female: 2, other: 5, unrecorded: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/prevention/miper/names.test.ts`
Expected: FAIL con "Failed to resolve import ./names".

- [ ] **Step 3: Write the implementation**

```ts
// lib/prevention/miper/names.ts
/** Clave de igualdad de diccionario: sin tildes, minúsculas, espacios colapsados. */
export function normalizeMiperName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL").replace(/\s+/g, " ").trim()
}

/** Texto a guardar: se respeta la escritura del usuario, sin espacios sobrantes. */
export function cleanMiperName(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim()
  return cleaned.length > 0 ? cleaned : null
}

/**
 * `workers.sex` admite female | male | intersex | unspecified, y null significa
 * "no registrado" (migración 0343). El RE-04 pide F / M / Otro: intersex,
 * unspecified y null van a Otro para que la suma cuadre con el total, y
 * `unrecorded` avisa cuántos de ellos son en realidad falta de dato.
 */
export function headcountFromSexCounts(rows: Array<{ sex: string | null; count: number }>) {
  let male = 0, female = 0, other = 0, unrecorded = 0
  for (const row of rows) {
    if (row.sex === "male") male += row.count
    else if (row.sex === "female") female += row.count
    else {
      other += row.count
      if (row.sex === null) unrecorded += row.count
    }
  }
  return { total: male + female + other, male, female, other, unrecorded }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- lib/prevention/miper/names.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/miper/names.ts lib/prevention/miper/names.test.ts
git commit -m "feat(miper): normalización de diccionarios y dotación por sexo"
```

---

#### Task 3: Foto del MIPER y diff entre fotos

**Files:**
- Create: `lib/prevention/miper/snapshot.ts`
- Test: `lib/prevention/miper/snapshot.test.ts`

**Interfaces:**
- Consumes: `RiskClassification` (Task 1).
- Produces (tipos exactos, que usan las Tasks 4, 10, 11, 12 y 15–19):

```ts
export type ControlHierarchy = "elimination" | "substitution" | "engineering" | "administrative" | "ppe"
export type ControlledStatus = "yes" | "partial" | "no"
export type MiperControlSnapshot = { id: string; hierarchy: ControlHierarchy; description: string; responsibleUserId: string | null; responsibleName: string | null; dueDate: string | null; status: string }
export type MiperEntrySnapshot = {
  id: string; rowNumber: number
  activity: string | null; task: string | null; position: string | null; location: string | null
  exposedFemale: number; exposedMale: number; exposedOther: number
  riskFactorId: string | null; riskFactor: string | null; isRoutine: boolean | null
  hazard: string | null; risk: string | null; probableDamage: string | null
  probability: number | null; consequence: number | null; magnitude: number | null
  classification: RiskClassification | null; controlledStatus: ControlledStatus | null
  controls: MiperControlSnapshot[]
}
export type MiperHeaderSnapshot = {
  period: number | null; iperCode: string | null; elaboratedOn: string | null; updatedOn: string | null
  companyName: string | null; companyRut: string | null; companyAddress: string | null; companyCommune: string | null
  economicActivity: string | null; adherentNumber: string | null; worksiteName: string | null
  siteRepresentativeUserId: string | null; siteRepresentativeName: string | null
  headcountTotal: number | null; headcountMale: number | null; headcountFemale: number | null; headcountOther: number | null
  participationSummary: string; consultationEvidenceReference: string
}
export type MiperSnapshot = { header: MiperHeaderSnapshot; entries: MiperEntrySnapshot[] }
export type EntryChange = { kind: "added" | "removed" | "modified"; entryId: string; rowNumber: number; fields: string[] }
export type SnapshotDiff = { headerFields: string[]; entries: EntryChange[]; hasChanges: boolean }
export function diffSnapshots(before: MiperSnapshot | null, after: MiperSnapshot): SnapshotDiff
export function changesByEntry(diff: SnapshotDiff): Map<string, EntryChange>
export const ENTRY_FIELD_LABEL: Record<string, string>
export const HEADER_FIELD_LABEL: Record<keyof MiperHeaderSnapshot, string>
export const CONTROL_HIERARCHY_LABEL: Record<ControlHierarchy, string>
export const CONTROLLED_STATUS_LABEL: Record<ControlledStatus, string>
```

- [ ] **Step 1: Write the failing test**

```ts
// lib/prevention/miper/snapshot.test.ts
import { describe, expect, it } from "vitest"
import { changesByEntry, diffSnapshots, type MiperEntrySnapshot, type MiperSnapshot } from "./snapshot"

const header: MiperSnapshot["header"] = {
  period: 2026, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: null,
  companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero",
  economicActivity: "Transporte", adherentNumber: "252086", worksiteName: "Biodiversa",
  siteRepresentativeUserId: "u-admin", siteRepresentativeName: "Jean Paul Recart",
  headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0,
  participationSummary: "", consultationEvidenceReference: "",
}

function entry(id: string, over: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot {
  return {
    id, rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta",
    exposedFemale: 0, exposedMale: 5, exposedOther: 0, riskFactorId: "rf-mecanico", riskFactor: "Mecánico",
    isRoutine: true, hazard: "Camión en movimiento", risk: "Atropello", probableDamage: "Fracturas",
    probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "partial",
    controls: [{ id: `${id}-c1`, hierarchy: "administrative", description: "Procedimiento de carga", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-31", status: "proposed" }],
    ...over,
  }
}

describe("diffSnapshots", () => {
  it("sin foto anterior todo es agregado", () => {
    const diff = diffSnapshots(null, { header, entries: [entry("e1")] })
    expect(diff.hasChanges).toBe(true)
    expect(diff.entries).toEqual([{ kind: "added", entryId: "e1", rowNumber: 1, fields: [] }])
  })

  it("detecta agregadas, eliminadas y modificadas con sus campos, incluidas las medidas", () => {
    const before: MiperSnapshot = { header, entries: [entry("e1"), entry("e2", { rowNumber: 2 })] }
    const after: MiperSnapshot = {
      header: { ...header, headcountTotal: 17, headcountMale: 15 },
      entries: [
        entry("e1", { consequence: 2, magnitude: 4, classification: "moderate" }),
        entry("e3", { rowNumber: 2 }),
        // e2 eliminada
      ],
    }
    const diff = diffSnapshots(before, after)
    expect(diff.headerFields.sort()).toEqual(["headcountMale", "headcountTotal"])
    const byId = changesByEntry(diff)
    expect(byId.get("e1")).toMatchObject({ kind: "modified", fields: ["consequence", "magnitude", "classification"] })
    expect(byId.get("e3")?.kind).toBe("added")
    expect(byId.get("e2")?.kind).toBe("removed")
  })

  it("renumerar filas no es un cambio de contenido, pero editar una medida sí", () => {
    const before: MiperSnapshot = { header, entries: [entry("e1", { rowNumber: 1 })] }
    const renumbered: MiperSnapshot = { header, entries: [entry("e1", { rowNumber: 3 })] }
    expect(diffSnapshots(before, renumbered).hasChanges).toBe(false)
    const controlEdited = entry("e1")
    controlEdited.controls = [{ ...controlEdited.controls[0]!, dueDate: "2026-12-31" }]
    expect(changesByEntry(diffSnapshots(before, { header, entries: [controlEdited] })).get("e1")?.fields).toEqual(["controls"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/prevention/miper/snapshot.test.ts`
Expected: FAIL con "Failed to resolve import ./snapshot".

- [ ] **Step 3: Write the implementation**

```ts
// lib/prevention/miper/snapshot.ts
/**
 * Foto autosuficiente de un MIPER: la forma que se congela en cada ronda de
 * revisión y en cada versión sellada. Lleva nombres, no ids de diccionario,
 * para que una versión antigua se pueda leer y exportar aunque el diccionario
 * cambie después. El diff entre dos fotos es la base de "Modificados desde la
 * ronda anterior" y de "cambios pendientes de revisión".
 */
import type { RiskClassification } from "./methodology"

export type ControlHierarchy = "elimination" | "substitution" | "engineering" | "administrative" | "ppe"
export type ControlledStatus = "yes" | "partial" | "no"

export type MiperControlSnapshot = {
  id: string; hierarchy: ControlHierarchy; description: string
  responsibleUserId: string | null; responsibleName: string | null; dueDate: string | null; status: string
}

export type MiperEntrySnapshot = {
  id: string; rowNumber: number
  activity: string | null; task: string | null; position: string | null; location: string | null
  exposedFemale: number; exposedMale: number; exposedOther: number
  riskFactorId: string | null; riskFactor: string | null; isRoutine: boolean | null
  hazard: string | null; risk: string | null; probableDamage: string | null
  probability: number | null; consequence: number | null; magnitude: number | null
  classification: RiskClassification | null; controlledStatus: ControlledStatus | null
  controls: MiperControlSnapshot[]
}

export type MiperHeaderSnapshot = {
  period: number | null; iperCode: string | null; elaboratedOn: string | null; updatedOn: string | null
  companyName: string | null; companyRut: string | null; companyAddress: string | null; companyCommune: string | null
  economicActivity: string | null; adherentNumber: string | null; worksiteName: string | null
  siteRepresentativeUserId: string | null; siteRepresentativeName: string | null
  headcountTotal: number | null; headcountMale: number | null; headcountFemale: number | null; headcountOther: number | null
  participationSummary: string; consultationEvidenceReference: string
}

export type MiperSnapshot = { header: MiperHeaderSnapshot; entries: MiperEntrySnapshot[] }
export type EntryChange = { kind: "added" | "removed" | "modified"; entryId: string; rowNumber: number; fields: string[] }
export type SnapshotDiff = { headerFields: string[]; entries: EntryChange[]; hasChanges: boolean }

export const CONTROL_HIERARCHY_LABEL: Record<ControlHierarchy, string> = {
  elimination: "I. Eliminación",
  substitution: "II. Sustitución",
  engineering: "III. Controles de ingeniería",
  administrative: "IV. Controles administrativos",
  ppe: "V. Elementos de protección personal",
}

export const CONTROLLED_STATUS_LABEL: Record<ControlledStatus, string> = { yes: "Sí", partial: "Parcialmente", no: "No" }

/** Orden = orden de columnas del RE-04. `rowNumber` queda fuera: renumerar no es cambiar contenido. */
const ENTRY_FIELDS = [
  "activity", "task", "position", "location", "exposedFemale", "exposedMale", "exposedOther",
  "riskFactor", "isRoutine", "hazard", "risk", "probableDamage", "probability", "consequence",
  "magnitude", "classification", "controlledStatus",
] as const

export const ENTRY_FIELD_LABEL: Record<string, string> = {
  activity: "Actividad", task: "Tarea", position: "Puesto de trabajo", location: "Lugar específico",
  exposedFemale: "Expuestos F", exposedMale: "Expuestos M", exposedOther: "Expuestos otro",
  riskFactor: "Factor de riesgo", isRoutine: "Rutinaria", hazard: "Peligro", risk: "Riesgo",
  probableDamage: "Daño probable", probability: "Probabilidad", consequence: "Consecuencia",
  magnitude: "MR", classification: "Clasificación", controlledStatus: "¿Está controlado?", controls: "Medidas de control",
}

export const HEADER_FIELD_LABEL: Record<keyof MiperHeaderSnapshot, string> = {
  period: "Período", iperCode: "Código IPER", elaboratedOn: "Fecha de elaboración", updatedOn: "Fecha de actualización",
  companyName: "Razón social", companyRut: "RUT empleador", companyAddress: "Dirección", companyCommune: "Comuna",
  economicActivity: "Actividad económica principal", adherentNumber: "N° de adherente", worksiteName: "Centro de trabajo",
  siteRepresentativeUserId: "Representante de la empresa en la faena (Administrador de contrato)",
  siteRepresentativeName: "Representante de la empresa en la faena (Administrador de contrato)",
  headcountTotal: "N° total de trabajadores", headcountMale: "Trabajadores hombres", headcountFemale: "Trabajadoras mujeres",
  headcountOther: "Trabajadores otro", participationSummary: "Participación y consulta", consultationEvidenceReference: "Evidencia de la consulta",
}

function controlsKey(controls: MiperControlSnapshot[]): string {
  return JSON.stringify([...controls].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [c.id, c.hierarchy, c.description, c.responsibleUserId, c.responsibleName, c.dueDate, c.status]))
}

export function diffSnapshots(before: MiperSnapshot | null, after: MiperSnapshot): SnapshotDiff {
  const headerFields = before
    ? (Object.keys(after.header) as Array<keyof MiperHeaderSnapshot>).filter((key) => before.header[key] !== after.header[key])
    : []
  const previous = new Map((before?.entries ?? []).map((item) => [item.id, item]))
  const entries: EntryChange[] = []
  for (const current of after.entries) {
    const old = previous.get(current.id)
    if (!old) { entries.push({ kind: "added", entryId: current.id, rowNumber: current.rowNumber, fields: [] }); continue }
    previous.delete(current.id)
    const fields: string[] = ENTRY_FIELDS.filter((field) => old[field] !== current[field])
    if (controlsKey(old.controls) !== controlsKey(current.controls)) fields.push("controls")
    if (fields.length > 0) entries.push({ kind: "modified", entryId: current.id, rowNumber: current.rowNumber, fields })
  }
  for (const removed of previous.values()) entries.push({ kind: "removed", entryId: removed.id, rowNumber: removed.rowNumber, fields: [] })
  return { headerFields, entries, hasChanges: headerFields.length > 0 || entries.length > 0 }
}

export function changesByEntry(diff: SnapshotDiff): Map<string, EntryChange> {
  return new Map(diff.entries.map((change) => [change.entryId, change]))
}
```

La prueba "sin foto anterior" espera `headerFields: []` porque, cuando todavía no existe una versión, el encabezado no se considera "modificado".

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- lib/prevention/miper/snapshot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/miper/snapshot.ts lib/prevention/miper/snapshot.test.ts
git commit -m "feat(miper): foto autosuficiente del MIPER y diff entre fotos"
```

---

#### Task 4: Validador de completitud y reglas de estado

**Files:**
- Create: `lib/prevention/miper/completeness.ts`
- Create: `lib/prevention/miper/states.ts`
- Test: `lib/prevention/miper/completeness.test.ts`, `lib/prevention/miper/states.test.ts`

**Interfaces:**
- Consumes: `MiperSnapshot`, `MiperEntrySnapshot` (Task 3); `classify` (Task 1).
- Produces:
  - `type CompletenessIssue = { scope: "header" | "entry" | "control"; entryId?: string; controlId?: string; field: string; message: string; severity: "error" | "warning" }`
  - `checkMiperCompleteness(snapshot: MiperSnapshot, options?: { linkedControlIds?: ReadonlySet<string>; requireProgramLink?: boolean }): CompletenessIssue[]`. `requireProgramLink` queda en `false` en F1 y F2 lo activa.
  - `issuesByEntry(issues): Map<string, CompletenessIssue[]>`
  - `MIPER_STATUSES`, `type MiperStatus`, `MIPER_REVIEW_STATES`, `type MiperReviewState`
  - `type MiperWorkflowAction = "submit" | "return" | "approve_technical" | "request_corrections" | "approve_final"`
  - `MIPER_ACTION_RULES: Record<MiperWorkflowAction, { from: readonly MiperReviewState[]; to: MiperReviewState; permission: string; label: string }>`
  - `REVIEW_STATE_LABEL: Record<MiperReviewState, string>`
  - `miperStatusLabel(input: { status: string; reviewState: string; versionNumber: number | null; hasUnsentChanges: boolean; roundOpened: boolean; isLegacy?: boolean }): string`
  - `pendingSignaturePermission(reviewState: string): string | null`
  - `REVIEW_STAGE_FOR_STATE: Partial<Record<MiperReviewState, "technical" | "legal_rrhh">>` (`in_review → technical`, `pending_approval → legal_rrhh`)
  - `STAGE_PERMISSION: Record<"technical" | "legal_rrhh", string>`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/prevention/miper/completeness.test.ts
import { describe, expect, it } from "vitest"
import { checkMiperCompleteness, issuesByEntry } from "./completeness"
import type { MiperEntrySnapshot, MiperSnapshot } from "./snapshot"

const header: MiperSnapshot["header"] = {
  period: 2026, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: "2026-05-02",
  companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero",
  economicActivity: "Transporte", adherentNumber: null, worksiteName: "Biodiversa",
  siteRepresentativeUserId: "u1", siteRepresentativeName: "JP", headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0,
  participationSummary: "", consultationEvidenceReference: "",
}

function row(over: Partial<MiperEntrySnapshot>): MiperEntrySnapshot {
  return {
    id: "e1", rowNumber: 1, activity: "A", task: "T", position: "P", location: null,
    exposedFemale: 0, exposedMale: 1, exposedOther: 0, riskFactorId: "rf", riskFactor: "Mecánico", isRoutine: true,
    hazard: "H", risk: "R", probableDamage: "D", probability: 1, consequence: 2, magnitude: 2, classification: "tolerable",
    controlledStatus: "no", controls: [], ...over,
  }
}
const control = { id: "c1", hierarchy: "administrative" as const, description: "Procedimiento", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-12-31", status: "proposed" }

const errors = (snapshot: MiperSnapshot, opts?: Parameters<typeof checkMiperCompleteness>[1]) =>
  checkMiperCompleteness(snapshot, opts).filter((i) => i.severity === "error")

describe("completitud RE-04 (§5.1)", () => {
  it("una matriz completa y tolerable sin medidas no tiene errores", () => {
    expect(errors({ header, entries: [row({})] })).toEqual([])
  })
  it("una matriz sin filas no se puede enviar", () => {
    expect(errors({ header, entries: [] }).map((i) => i.field)).toContain("entries")
  })
  it("encabezado: actualización antes de elaboración y dotación que no suma", () => {
    const fields = errors({ header: { ...header, updatedOn: "2026-01-01", headcountMale: 10 }, entries: [row({})] }).map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(["updatedOn", "headcountTotal"]))
  })
  it("fila incompleta: exige P, C, factor, peligro, riesgo, daño, actividad, tarea, puesto y controlado", () => {
    const fields = errors({ header, entries: [row({ probability: null, riskFactorId: null, hazard: null, controlledStatus: null, task: null })] }).map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(["probability", "riskFactorId", "hazard", "controlledStatus", "task"]))
  })
  it("'Sí' o 'Parcialmente' controlado exige al menos una medida", () => {
    expect(errors({ header, entries: [row({ controlledStatus: "yes" })] }).map((i) => i.field)).toContain("controls")
    expect(errors({ header, entries: [row({ controlledStatus: "partial", controls: [control] })] })).toEqual([])
  })
  it("Importante: exige medida, y si no está controlado, una con responsable y plazo", () => {
    const important = row({ probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no" })
    expect(errors({ header, entries: [important] }).map((i) => i.field)).toContain("controls")
    const noDeadline = { ...important, controls: [{ ...control, dueDate: null }] }
    expect(errors({ header, entries: [noDeadline] }).map((i) => i.field)).toContain("dueDate")
    expect(errors({ header, entries: [{ ...important, controls: [control] }] })).toEqual([])
  })
  it("Intolerable: exige medida con responsable y plazo; el vínculo al programa sólo si se pide", () => {
    const intolerable = row({ probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controlledStatus: "no", controls: [control] })
    expect(errors({ header, entries: [intolerable] })).toEqual([])
    expect(checkMiperCompleteness({ header, entries: [intolerable] }).some((i) => i.severity === "warning" && i.field === "classification")).toBe(true)
    expect(errors({ header, entries: [intolerable] }, { requireProgramLink: true, linkedControlIds: new Set() }).map((i) => i.field)).toContain("programLink")
    expect(errors({ header, entries: [intolerable] }, { requireProgramLink: true, linkedControlIds: new Set(["c1"]) })).toEqual([])
  })
  it("toda medida exige descripción, tipo y plazo; responsable salvo en Tolerable", () => {
    const moderate = row({ probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "partial", controls: [{ ...control, responsibleName: null, dueDate: null }] })
    const fields = errors({ header, entries: [moderate] }).map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(["responsible", "dueDate"]))
    const tolerable = row({ controlledStatus: "yes", controls: [{ ...control, responsibleName: null }] })
    expect(errors({ header, entries: [tolerable] })).toEqual([])
  })
  it("agrupa los problemas por fila", () => {
    const issues = checkMiperCompleteness({ header, entries: [row({ hazard: null })] })
    expect(issuesByEntry(issues).get("e1")?.length).toBeGreaterThan(0)
  })
})
```

```ts
// lib/prevention/miper/states.test.ts
import { describe, expect, it } from "vitest"
import { MIPER_ACTION_RULES, miperStatusLabel, pendingSignaturePermission } from "./states"

describe("estados del MIPER", () => {
  it("las reglas de transición son las del §6.2 del spec", () => {
    expect(MIPER_ACTION_RULES.submit).toMatchObject({ from: ["none", "observed"], to: "in_review", permission: "prevention:risk:edit" })
    expect(MIPER_ACTION_RULES.return).toMatchObject({ from: ["in_review"], to: "observed", permission: "prevention:risk:review" })
    expect(MIPER_ACTION_RULES.approve_technical).toMatchObject({ from: ["in_review"], to: "pending_approval", permission: "prevention:risk:review" })
    expect(MIPER_ACTION_RULES.request_corrections).toMatchObject({ from: ["pending_approval"], to: "observed", permission: "prevention:risk:approve_legal" })
    expect(MIPER_ACTION_RULES.approve_final).toMatchObject({ from: ["pending_approval"], to: "none", permission: "prevention:risk:approve_legal" })
  })
  it("rótulo combinado sin estados ambiguos", () => {
    const base = { versionNumber: null, hasUnsentChanges: false, roundOpened: false }
    expect(miperStatusLabel({ ...base, status: "draft", reviewState: "none" })).toBe("Borrador")
    expect(miperStatusLabel({ ...base, status: "draft", reviewState: "in_review" })).toBe("Enviado a revisión")
    expect(miperStatusLabel({ ...base, status: "draft", reviewState: "in_review", roundOpened: true })).toBe("En revisión por Prevención")
    expect(miperStatusLabel({ ...base, status: "draft", reviewState: "pending_approval" })).toBe("Revisión técnica aprobada · Pendiente de aprobación Legal y RRHH")
    expect(miperStatusLabel({ ...base, status: "published", reviewState: "none", versionNumber: 3 })).toBe("Vigente · v3")
    expect(miperStatusLabel({ ...base, status: "published", reviewState: "none", versionNumber: 3, hasUnsentChanges: true })).toBe("Vigente v3 · cambios pendientes de revisión")
    expect(miperStatusLabel({ ...base, status: "published", reviewState: "observed", versionNumber: 3 })).toBe("Vigente v3 · con observaciones")
    expect(miperStatusLabel({ ...base, status: "superseded", reviewState: "none", versionNumber: 5 })).toBe("Reemplazado")
    expect(miperStatusLabel({ ...base, status: "published", reviewState: "none", isLegacy: true })).toBe("Vigente · metodología anterior")
  })
  it("firma pendiente: a quién avisar en cada estado", () => {
    expect(pendingSignaturePermission("in_review")).toBe("prevention:risk:review")
    expect(pendingSignaturePermission("pending_approval")).toBe("prevention:risk:approve_legal")
    expect(pendingSignaturePermission("observed")).toBeNull()
    expect(pendingSignaturePermission("none")).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/prevention/miper/completeness.test.ts lib/prevention/miper/states.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Write the implementation**

```ts
// lib/prevention/miper/completeness.ts
/**
 * Reglas del §5.1 del spec, una sola vez: la grilla las pinta en vivo y el
 * servicio las aplica al enviar a revisión. Los errores bloquean el envío; las
 * advertencias sólo se muestran (el Intolerable siempre lleva su advertencia
 * crítica, aunque esté completo).
 */
import { isScaleValue } from "./methodology"
import type { MiperSnapshot } from "./snapshot"

export type CompletenessIssue = {
  scope: "header" | "entry" | "control"
  entryId?: string
  controlId?: string
  field: string
  message: string
  severity: "error" | "warning"
}

const REQUIRED_ENTRY_FIELDS: Array<[keyof MiperSnapshot["entries"][number], string]> = [
  ["activity", "Falta la actividad."], ["task", "Falta la tarea."], ["position", "Falta el puesto de trabajo."],
  ["riskFactorId", "Falta el factor de riesgo."], ["hazard", "Falta el peligro."], ["risk", "Falta el riesgo."],
  ["probableDamage", "Falta el daño probable."], ["controlledStatus", "Indica si el riesgo está controlado."],
]

export function checkMiperCompleteness(
  snapshot: MiperSnapshot,
  options: { linkedControlIds?: ReadonlySet<string>; requireProgramLink?: boolean } = {},
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = []
  const h = snapshot.header
  const headerError = (field: string, message: string) => issues.push({ scope: "header", field, message, severity: "error" })
  if (h.elaboratedOn && h.updatedOn && h.updatedOn < h.elaboratedOn) headerError("updatedOn", "La fecha de actualización no puede ser anterior a la de elaboración.")
  if (!h.elaboratedOn) headerError("elaboratedOn", "Falta la fecha de elaboración.")
  const counts = [h.headcountMale, h.headcountFemale, h.headcountOther]
  if (h.headcountTotal === null || counts.some((value) => value === null)) headerError("headcountTotal", "Completa la dotación: total, hombres, mujeres y otro.")
  else if (counts.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== h.headcountTotal) headerError("headcountTotal", "Hombres + mujeres + otro debe sumar el total de trabajadores.")
  if (!h.siteRepresentativeName) headerError("siteRepresentativeName", "Falta el representante de la empresa en la faena (Administrador de contrato).")
  if (snapshot.entries.length === 0) headerError("entries", "La matriz no tiene registros de evaluación.")

  for (const entry of snapshot.entries) {
    const err = (field: string, message: string, controlId?: string) =>
      issues.push({ scope: controlId ? "control" : "entry", entryId: entry.id, controlId, field, message, severity: "error" })
    for (const [field, message] of REQUIRED_ENTRY_FIELDS) if (entry[field] === null || entry[field] === "") err(field, message)
    if (!isScaleValue(entry.probability)) err("probability", "Selecciona la probabilidad (Baja, Media o Alta).")
    if (!isScaleValue(entry.consequence)) err("consequence", "Selecciona la consecuencia (Baja, Media o Alta).")

    const cls = entry.classification
    if ((entry.controlledStatus === "yes" || entry.controlledStatus === "partial") && entry.controls.length === 0) {
      err("controls", "Si el riesgo está controlado (total o parcialmente), registra al menos una medida.")
    }
    if ((cls === "important" || cls === "intolerable") && entry.controls.length === 0) {
      err("controls", "Un riesgo Importante o Intolerable exige al menos una medida de control.")
    }
    const assigned = entry.controls.filter((control) => control.dueDate && (control.responsibleUserId || control.responsibleName))
    if (cls === "important" && entry.controlledStatus !== "yes" && entry.controls.length > 0 && assigned.length === 0) {
      err("dueDate", "Un riesgo Importante no controlado exige una medida con responsable y plazo.")
    }
    if (cls === "intolerable") {
      if (entry.controls.length > 0 && assigned.length === 0) err("dueDate", "Un riesgo Intolerable exige una medida con responsable y plazo.")
      if (options.requireProgramLink && !entry.controls.some((control) => options.linkedControlIds?.has(control.id))) {
        err("programLink", "Un riesgo Intolerable exige una medida vinculada a una actividad del Programa de Trabajo.")
      }
      issues.push({ scope: "entry", entryId: entry.id, field: "classification", severity: "warning", message: "Riesgo Intolerable: no debe comenzar ni continuar el trabajo hasta que se reduzca el riesgo." })
    }
    for (const control of entry.controls) {
      if (control.description.trim().length < 3) err("description", "La medida necesita una descripción.", control.id)
      if (!control.dueDate) err("dueDate", "La medida necesita un plazo.", control.id)
      if (cls !== "tolerable" && !control.responsibleUserId && !control.responsibleName) err("responsible", "La medida necesita un responsable.", control.id)
    }
  }
  return issues
}

export function issuesByEntry(issues: CompletenessIssue[]): Map<string, CompletenessIssue[]> {
  const map = new Map<string, CompletenessIssue[]>()
  for (const issue of issues) if (issue.entryId) map.set(issue.entryId, [...(map.get(issue.entryId) ?? []), issue])
  return map
}
```

Nota sobre la regla "toda medida exige plazo" y la prueba del Tolerable: en esa prueba la medida tiene `dueDate` y no tiene responsable, y pasa porque el responsable sólo se exige fuera de Tolerable. El plazo se exige siempre (§5.1).

```ts
// lib/prevention/miper/states.ts
/**
 * Estados del MIPER (§6 del spec). `status` es el ciclo de vida
 * (`published` = vigente) y `review_state` la revisión. Los recordatorios de
 * firma pendiente (lib/services/pdtp/reminders.ts) y el servicio de flujo leen
 * estas mismas reglas: si cambia la máquina, cambian con ella.
 */
export const MIPER_STATUSES = ["draft", "published", "superseded"] as const
export type MiperStatus = typeof MIPER_STATUSES[number]
export const MIPER_REVIEW_STATES = ["none", "in_review", "observed", "pending_approval"] as const
export type MiperReviewState = typeof MIPER_REVIEW_STATES[number]
export type MiperWorkflowAction = "submit" | "return" | "approve_technical" | "request_corrections" | "approve_final"
export type ReviewStage = "technical" | "legal_rrhh"

export const MIPER_ACTION_RULES: Record<MiperWorkflowAction, { from: readonly MiperReviewState[]; to: MiperReviewState; permission: string; label: string }> = {
  submit: { from: ["none", "observed"], to: "in_review", permission: "prevention:risk:edit", label: "Enviar a revisión" },
  return: { from: ["in_review"], to: "observed", permission: "prevention:risk:review", label: "Devolver con observaciones" },
  approve_technical: { from: ["in_review"], to: "pending_approval", permission: "prevention:risk:review", label: "Aprobar revisión técnica" },
  request_corrections: { from: ["pending_approval"], to: "observed", permission: "prevention:risk:approve_legal", label: "Solicitar correcciones" },
  approve_final: { from: ["pending_approval"], to: "none", permission: "prevention:risk:approve_legal", label: "Aprobar (Legal y RRHH)" },
}

export const REVIEW_STAGE_FOR_STATE: Partial<Record<MiperReviewState, ReviewStage>> = { in_review: "technical", pending_approval: "legal_rrhh" }
export const STAGE_PERMISSION: Record<ReviewStage, string> = { technical: "prevention:risk:review", legal_rrhh: "prevention:risk:approve_legal" }
export const STAGE_LABEL: Record<ReviewStage, string> = { technical: "Revisión técnica (Prevención)", legal_rrhh: "Aprobación Legal y RRHH" }

export const REVIEW_STATE_LABEL: Record<MiperReviewState, string> = {
  none: "Sin revisión en curso",
  in_review: "En revisión técnica",
  observed: "Con observaciones",
  pending_approval: "Pendiente de aprobación Legal y RRHH",
}

export function miperStatusLabel(input: { status: string; reviewState: string; versionNumber: number | null; hasUnsentChanges: boolean; roundOpened: boolean; isLegacy?: boolean }): string {
  if (input.status === "superseded") return "Reemplazado"
  if (input.isLegacy) return input.status === "published" ? "Vigente · metodología anterior" : "Borrador · metodología anterior"
  const review = input.reviewState
  if (input.status === "draft") {
    if (review === "in_review") return input.roundOpened ? "En revisión por Prevención" : "Enviado a revisión"
    if (review === "observed") return "Con observaciones"
    if (review === "pending_approval") return "Revisión técnica aprobada · Pendiente de aprobación Legal y RRHH"
    return "Borrador"
  }
  const v = input.versionNumber ? `v${input.versionNumber}` : ""
  if (review === "in_review") return `Vigente ${v} · ${input.roundOpened ? "en revisión por Prevención" : "enviado a revisión"}`
  if (review === "observed") return `Vigente ${v} · con observaciones`
  if (review === "pending_approval") return `Vigente ${v} · pendiente de aprobación Legal y RRHH`
  return input.hasUnsentChanges ? `Vigente ${v} · cambios pendientes de revisión` : `Vigente · ${v}`
}

export function pendingSignaturePermission(reviewState: string): string | null {
  const stage = REVIEW_STAGE_FOR_STATE[reviewState as MiperReviewState]
  return stage ? STAGE_PERMISSION[stage] : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fast -- lib/prevention/miper/`
Expected: PASS en todos los archivos de `lib/prevention/miper/`.

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/miper/completeness.ts lib/prevention/miper/completeness.test.ts lib/prevention/miper/states.ts lib/prevention/miper/states.test.ts
git commit -m "feat(miper): validador de completitud RE-04 y reglas de estado del flujo"
```

---

#### Task 5: Esquema y migraciones (0344 modelo, 0345 restricciones de estado)

**Files:**
- Modify: `db/schema/prevention/risk-legal.ts`:
  - tablas `preventionRiskProcesses`, `preventionRiskTasks`, `preventionRiskPositions`, `preventionRiskMatrices`, `preventionRiskEntries` y `preventionRiskControls`;
  - tablas nuevas `preventionRiskFactors` y `preventionRiskLocations`, junto a los diccionarios.
- Create: `db/schema/prevention/miper.ts`.
- Modify: `db/schema/prevention/index.ts` (agregar `export * from "./miper"`).
- Modify: `db/schema/worksites.ts` (columna `commune`).
- Create (generados): `db/migrations/0344_miper_f1_modelo.sql`, `db/migrations/0345_miper_f1_estados.sql` y sus snapshots.
- Modify: `db/migrations/meta/_sql-checksums.json` (con el script, nunca a mano).
- Test: `db/__tests__/miper-constraints.test.ts` (PGlite); registrarlo en `tests/pglite-files.ts`.

**Interfaces:**
- Produces: las tablas Drizzle `preventionRiskFactors`, `preventionRiskLocations`, `preventionRiskReviewRounds`, `preventionRiskMatrixVersions` y `preventionRiskObservations`.
- Columnas nuevas:
  - matrices: `reviewState`, `period`, `isLegacy`, encabezado RE-04.
  - entries: `rowNumber`, `locationId`, `riskFactorId`, `isRoutine`, `risk`, `probableDamage`, `exposed*`, `probability`, `consequence`, `magnitude` (generada), `classification` (generada), `controlledStatus`.
  - diccionarios: `worksiteId` (tareas y puestos) y `normalizedName`.
  - worksites: `commune`.

**Por qué dos migraciones:** las matrices existentes pueden estar en `in_review`, `reviewed` o `approved`, y el CHECK nuevo sólo admite `draft|published|superseded`. El SQL anexado a 0344 convierte esas filas. El CHECK nuevo va en 0345, que se genera después. Así se respeta la regla de sólo anexar SQL a una migración recién generada, sin reordenar nada.

- [ ] **Step 1: Write the failing constraint test**

```ts
// db/__tests__/miper-constraints.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema })

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await db.insert(schema.worksites).values({ id: "ws-c", name: "Faena C", code: "C-1", commune: "Cabrero" })
  await db.insert(schema.users).values({ id: "u-c", name: "Autora", email: "a@c.cl", hashedPassword: "x", isActive: true })
  await db.insert(schema.preventionRiskMethodologies).values({ id: "m-c", code: "RE-04-CHOME", name: "RE-04", versionLabel: "REV-2026", kind: "primary", authoritySource: "RE-04", createdByUserId: "u-c" })
  await db.insert(schema.preventionRiskMatrices).values({
    id: "mx-c", worksiteId: "ws-c", matrixVersion: 1, title: "MIPER C 2026", period: 2026, methodologyId: "m-c", methodologySnapshot: {},
    revisionReason: "Elaboración inicial del período.", participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-c",
  })
}, 60_000)

async function insertEntry(id: string, probability: number | null, consequence: number | null) {
  await db.insert(schema.preventionRiskEntries).values({ id, matrixId: "mx-c", rowNumber: 1, hazardCode: `R-${id}`, probability, consequence })
}

describe("restricciones MIPER F1", () => {
  it("MR y clasificación son columnas generadas y se recalculan", async () => {
    await insertEntry("e-gen", 2, 4)
    let [row] = await db.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, "e-gen"))
    expect(row).toMatchObject({ magnitude: 8, classification: "important" })
    await db.update(schema.preventionRiskEntries).set({ consequence: 1 }).where(eq(schema.preventionRiskEntries.id, "e-gen"))
    ;[row] = await db.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, "e-gen"))
    expect(row).toMatchObject({ magnitude: 2, classification: "tolerable" })
    await insertEntry("e-null", null, 4)
    ;[row] = await db.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, "e-null"))
    expect(row).toMatchObject({ magnitude: null, classification: null })
  })

  it("P y C sólo admiten 1, 2 o 4", async () => {
    await expect(insertEntry("e-bad", 3, 2)).rejects.toThrow()
  })

  it("siembra el catálogo de factores de riesgo del RE-04", async () => {
    const rows = await db.select().from(schema.preventionRiskFactors)
    expect(rows.map((r) => r.code)).toEqual(expect.arrayContaining(["locativo", "mecanico", "fisico", "quimico", "biologico", "electrico", "ergonomico", "psicosocial"]))
  })

  it("encabezado: fecha de actualización y dotación coherentes", async () => {
    await expect(db.update(schema.preventionRiskMatrices).set({ elaboratedOn: "2026-05-01", updatedOn: "2026-04-01" }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))).rejects.toThrow()
    await expect(db.update(schema.preventionRiskMatrices).set({ headcountTotal: 16, headcountMale: 10, headcountFemale: 2, headcountOther: 0 }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))).rejects.toThrow()
    await db.update(schema.preventionRiskMatrices).set({ headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0 }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))
  })

  it("estados: sólo draft, published o superseded; review_state válido", async () => {
    await expect(db.update(schema.preventionRiskMatrices).set({ status: "reviewed" }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))).rejects.toThrow()
    await expect(db.update(schema.preventionRiskMatrices).set({ reviewState: "approved" }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))).rejects.toThrow()
  })

  it("un solo MIPER abierto por faena y período", async () => {
    await expect(db.insert(schema.preventionRiskMatrices).values({
      id: "mx-dup", worksiteId: "ws-c", matrixVersion: 2, title: "Duplicado", period: 2026, methodologyId: "m-c", methodologySnapshot: {},
      revisionReason: "Duplicado del período.", participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-c",
    })).rejects.toThrow()
  })

  it("una sola ronda abierta y las versiones selladas son inmutables", async () => {
    await db.insert(schema.preventionRiskReviewRounds).values({ id: "r1", matrixId: "mx-c", roundNumber: 1, stage: "technical", snapshot: {}, snapshotSha256: "a".repeat(64), submittedByUserId: "u-c" })
    await expect(db.insert(schema.preventionRiskReviewRounds).values({ id: "r2", matrixId: "mx-c", roundNumber: 2, stage: "technical", snapshot: {}, snapshotSha256: "b".repeat(64), submittedByUserId: "u-c" })).rejects.toThrow()
    await db.insert(schema.preventionRiskMatrixVersions).values({
      id: "v1", matrixId: "mx-c", versionNumber: 1, period: 2026, roundId: "r1", snapshot: {}, snapshotSha256: "a".repeat(64), changeSummary: "Emisión inicial del documento.",
      elaboratedByUserId: "u-c", technicalReviewerUserId: "u-c", approverUserId: "u-c", elaboratedByName: "A", technicalReviewerName: "A", approverName: "A",
    })
    await expect(db.update(schema.preventionRiskMatrixVersions).set({ changeSummary: "reescrito" }).where(eq(schema.preventionRiskMatrixVersions.id, "v1"))).rejects.toThrow(/inmutables/)
    await expect(db.execute(sql`DELETE FROM prevention_risk_matrix_versions WHERE id = 'v1'`)).rejects.toThrow(/inmutables/)
  })
})
```

Agregar a `tests/pglite-files.ts`, en la lista `pgliteTestFiles`:

```ts
  // MIPER F1: columnas generadas P×C, estados y versiones inmutables.
  "db/__tests__/miper-constraints.test.ts",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- db/__tests__/miper-constraints.test.ts`
Expected: FAIL: TypeScript o Drizzle no conocen `commune`, `period`, `preventionRiskFactors`, etc.

- [ ] **Step 3: Cambios de esquema, parte A (todo menos el CHECK de estados)**

En `db/schema/worksites.ts`, dentro de `worksites`, después de `region`:

```ts
  /** Comuna del centro de trabajo: encabezado RE-04 de la MIPER. */
  commune:   text("commune"),
```

En `db/schema/prevention/risk-legal.ts`, **antes** de `preventionRiskProcesses`:

```ts
/* ── Catálogo de factores de riesgo (RE-04) ─────────────────────────────── */
export const preventionRiskFactors = pgTable("prevention_risk_factors", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_factors_code_unique").on(table.code),
  uniqueIndex("prevention_risk_factors_name_unique").on(table.name),
])

/* ── Diccionario: lugar de trabajo específico ───────────────────────────── */
export const preventionRiskLocations = pgTable("prevention_risk_locations", {
  id: text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_locations_scope_name_unique").on(table.worksiteId, table.normalizedName),
])
```

Diccionarios (reemplazar las tres definiciones):

```ts
export const preventionRiskProcesses = pgTable("prevention_risk_processes", {
  id: text("id").primaryKey(),
  worksiteId: text("worksite_id").notNull().references(() => worksites.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  /* Clave de igualdad del diccionario de actividades (lib/prevention/miper/names).
   * Nula en filas de la metodología anterior: esas no participan del
   * autocompletado y no chocan con el índice. */
  normalizedName: text("normalized_name"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_processes_scope_code_unique").on(table.worksiteId, table.code),
  uniqueIndex("prevention_risk_processes_scope_name_unique").on(table.worksiteId, table.normalizedName),
  index("prevention_risk_processes_scope_active_idx").on(table.worksiteId, table.isActive),
])

export const preventionRiskTasks = pgTable("prevention_risk_tasks", {
  id: text("id").primaryKey(),
  /* Nulo en el modelo RE-04: tarea y puesto cuelgan de la faena, no uno del otro
   * (en el RE-04 real la misma tarea aparece con varios puestos). */
  processId: text("process_id").references(() => preventionRiskProcesses.id, { onDelete: "cascade" }),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name"),
  isRoutine: boolean("is_routine").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_tasks_process_code_unique").on(table.processId, table.code),
  uniqueIndex("prevention_risk_tasks_scope_name_unique").on(table.worksiteId, table.normalizedName),
])

export const preventionRiskPositions = pgTable("prevention_risk_positions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => preventionRiskTasks.id, { onDelete: "cascade" }),
  worksiteId: text("worksite_id").references(() => worksites.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name"),
  workerPositionKey: text("worker_position_key"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_positions_task_code_unique").on(table.taskId, table.code),
  uniqueIndex("prevention_risk_positions_scope_name_unique").on(table.worksiteId, table.normalizedName),
])
```

Matrices: agregar columnas (conservar todas las existentes) y restricciones. Agregar después de `status`:

```ts
  /* Revisión en curso (§6 del spec). `status` es el ciclo de vida y aquí
   * `published` significa VIGENTE; se conserva el valor para que los
   * consumidores que filtran `status = 'published'` sigan funcionando. */
  reviewState: text("review_state").notNull().default("none"),
  period: integer("period"),
  /** Matriz creada con la metodología anterior (inherente/residual): sólo lectura. */
  isLegacy: boolean("is_legacy").notNull().default(false),
```

Agregar después de `publishedHashSha256` el bloque de encabezado:

```ts
  // ── Encabezado RE-04 (prellenado desde faena y empresa; editable) ──
  iperCode: text("iper_code"),
  elaboratedOn: text("elaborated_on"),
  updatedOn: text("updated_on"),
  companyName: text("company_name"),
  companyRut: text("company_rut"),
  companyAddress: text("company_address"),
  companyCommune: text("company_commune"),
  economicActivity: text("economic_activity"),
  adherentNumber: text("adherent_number"),
  worksiteName: text("worksite_name"),
  /* Representante de CHOME en la faena (Administrador de contrato). NO el
   * representante legal corporativo: ver spec §4.8. */
  siteRepresentativeUserId: text("site_representative_user_id").references(() => users.id),
  siteRepresentativeName: text("site_representative_name"),
  headcountTotal: integer("headcount_total"),
  headcountMale: integer("headcount_male"),
  headcountFemale: integer("headcount_female"),
  headcountOther: integer("headcount_other"),
```

En la lista de restricciones de matrices, **conservar** el CHECK `prevention_risk_matrices_status_valid` antiguo en esta parte A. Agregar:

```ts
  uniqueIndex("prevention_risk_matrices_scope_period_open_unique").on(table.worksiteId, table.period)
    .where(sql`${table.status} <> 'superseded' AND ${table.period} IS NOT NULL`),
  check("prevention_risk_matrices_review_state_valid", sql`${table.reviewState} IN ('none', 'in_review', 'observed', 'pending_approval')`),
  check("prevention_risk_matrices_dates_order", sql`${table.elaboratedOn} IS NULL OR ${table.updatedOn} IS NULL OR ${table.updatedOn} >= ${table.elaboratedOn}`),
  check("prevention_risk_matrices_headcount_sum", sql`${table.headcountTotal} IS NULL OR ${table.headcountMale} IS NULL OR ${table.headcountFemale} IS NULL OR ${table.headcountOther} IS NULL OR ${table.headcountMale} + ${table.headcountFemale} + ${table.headcountOther} = ${table.headcountTotal}`),
  check("prevention_risk_matrices_headcount_non_negative", sql`coalesce(${table.headcountTotal}, 0) >= 0 AND coalesce(${table.headcountMale}, 0) >= 0 AND coalesce(${table.headcountFemale}, 0) >= 0 AND coalesce(${table.headcountOther}, 0) >= 0`),
  check("prevention_risk_matrices_period_valid", sql`${table.period} IS NULL OR ${table.period} BETWEEN 2000 AND 2100`),
```

Entries: reemplazar la definición completa por:

```ts
export const preventionRiskEntries = pgTable("prevention_risk_entries", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "cascade" }),
  /** N° visible del RE-04. Orden, no identidad: sin índice único (se renumera al insertar/borrar). */
  rowNumber: integer("row_number"),
  // Nulos mientras la fila se completa en la grilla.
  processId: text("process_id").references(() => preventionRiskProcesses.id, { onDelete: "restrict" }),
  taskId: text("task_id").references(() => preventionRiskTasks.id, { onDelete: "restrict" }),
  positionId: text("position_id").references(() => preventionRiskPositions.id, { onDelete: "restrict" }),
  locationId: text("location_id").references(() => preventionRiskLocations.id, { onDelete: "restrict" }),
  hazardCode: text("hazard_code").notNull(),
  hazard: text("hazard"),
  riskFactorId: text("risk_factor_id").references(() => preventionRiskFactors.id, { onDelete: "restrict" }),
  isRoutine: boolean("is_routine"),
  risk: text("risk"),
  probableDamage: text("probable_damage"),
  exposedFemale: integer("exposed_female").notNull().default(0),
  exposedMale: integer("exposed_male").notNull().default(0),
  exposedOther: integer("exposed_other").notNull().default(0),
  probability: integer("probability"),
  consequence: integer("consequence"),
  /* MR y clasificación RE-04 (lib/prevention/miper/methodology.ts#classify).
   * Generadas: ningún camino —UI, seed, script— puede guardar una clasificación
   * incoherente con P×C. */
  magnitude: integer("magnitude").generatedAlwaysAs(sql`"probability" * "consequence"`),
  classification: text("classification").generatedAlwaysAs(sql`CASE WHEN "probability" IS NULL OR "consequence" IS NULL THEN NULL WHEN "probability" * "consequence" <= 2 THEN 'tolerable' WHEN "probability" * "consequence" = 4 THEN 'moderate' WHEN "probability" * "consequence" = 8 THEN 'important' ELSE 'intolerable' END`),
  controlledStatus: text("controlled_status"),
  // ── Metodología anterior (filas legacy). Nulas en el modelo RE-04; se eliminan
  //    en una migración posterior, cuando no quede ninguna fila legacy. ──
  riskFactor: text("risk_factor"),
  expectedEventOrDamage: text("expected_event_or_damage"),
  exposedPeopleDescription: text("exposed_people_description"),
  exposedPeopleCount: integer("exposed_people_count"),
  genderConsiderations: text("gender_considerations"),
  sensitiveWorkerConsiderations: text("sensitive_worker_considerations"),
  specialMethodologyReference: text("special_methodology_reference"),
  inherentDimensions: jsonb("inherent_dimensions"),
  inherentScore: numeric("inherent_score", { precision: 12, scale: 4, mode: "number" }),
  inherentLevel: text("inherent_level"),
  residualDimensions: jsonb("residual_dimensions"),
  residualScore: numeric("residual_score", { precision: 12, scale: 4, mode: "number" }),
  residualLevel: text("residual_level"),
  isCritical: boolean("is_critical").notNull().default(false),
  responsibleUserId: text("responsible_user_id").references(() => users.id),
  responsibleSnapshot: text("responsible_snapshot"),
  evidenceReference: text("evidence_reference"),
  sourceRowNumber: integer("source_row_number"),
  sourceOriginal: jsonb("source_original"),
  sourceNormalized: jsonb("source_normalized"),
  normalizationDecision: text("normalization_decision"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_risk_entries_matrix_row_idx").on(table.matrixId, table.rowNumber),
  index("prevention_risk_entries_matrix_level_idx").on(table.matrixId, table.residualLevel),
  check("prevention_risk_entries_inherent_level_valid", sql`${table.inherentLevel} IS NULL OR ${table.inherentLevel} IN ('low', 'medium', 'high', 'critical')`),
  check("prevention_risk_entries_residual_level_valid", sql`${table.residualLevel} IS NULL OR ${table.residualLevel} IN ('low', 'medium', 'high', 'critical')`),
  check("prevention_risk_entries_exposed_count_valid", sql`${table.exposedPeopleCount} IS NULL OR ${table.exposedPeopleCount} >= 0`),
  check("prevention_risk_entries_version_positive", sql`${table.version} > 0`),
  check("prevention_risk_entries_probability_valid", sql`${table.probability} IS NULL OR ${table.probability} IN (1, 2, 4)`),
  check("prevention_risk_entries_consequence_valid", sql`${table.consequence} IS NULL OR ${table.consequence} IN (1, 2, 4)`),
  check("prevention_risk_entries_controlled_valid", sql`${table.controlledStatus} IS NULL OR ${table.controlledStatus} IN ('yes', 'partial', 'no')`),
  check("prevention_risk_entries_exposed_non_negative", sql`${table.exposedFemale} >= 0 AND ${table.exposedMale} >= 0 AND ${table.exposedOther} >= 0`),
  check("prevention_risk_entries_row_number_positive", sql`${table.rowNumber} IS NULL OR ${table.rowNumber} >= 1`),
])
```

Se elimina el índice único `prevention_risk_entries_matrix_identity_unique`, porque el RE-04 repite combinaciones actividad/tarea/puesto.

Controles: sólo cambia `responsibleSnapshot: text("responsible_snapshot")` (sin `.notNull()`): en una fila Tolerable, una medida puede no tener responsable.

Crear `db/schema/prevention/miper.ts`:

```ts
import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "../users"
import { preventionRiskEntries, preventionRiskMatrices } from "./risk-legal"

/* Cada envío a revisión congela una foto (lib/prevention/miper/snapshot.ts).
 * La revisora y Legal y RRHH revisan esa foto, no los datos vivos. */
export const preventionRiskReviewRounds = pgTable("prevention_risk_review_rounds", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  stage: text("stage").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  snapshotSha256: text("snapshot_sha256").notNull(),
  submittedByUserId: text("submitted_by_user_id").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }),
  openedByUserId: text("opened_by_user_id").references(() => users.id),
  decision: text("decision"),
  decidedByUserId: text("decided_by_user_id").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
  decisionComment: text("decision_comment"),
}, (table) => [
  uniqueIndex("prevention_risk_review_rounds_matrix_round_unique").on(table.matrixId, table.roundNumber),
  uniqueIndex("prevention_risk_review_rounds_one_open_unique").on(table.matrixId).where(sql`${table.decision} IS NULL`),
  check("prevention_risk_review_rounds_stage_valid", sql`${table.stage} IN ('technical', 'legal_rrhh')`),
  check("prevention_risk_review_rounds_decision_valid", sql`${table.decision} IS NULL OR ${table.decision} IN ('observed', 'approved')`),
  check("prevention_risk_review_rounds_decision_complete", sql`(${table.decision} IS NULL) = (${table.decidedByUserId} IS NULL)`),
])

/* Versión sellada = hoja "Modificaciones" del RE-04. Inmutable (trigger en la
 * migración 0344): corregir una versión es sellar la siguiente. */
export const preventionRiskMatrixVersions = pgTable("prevention_risk_matrix_versions", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "restrict" }),
  versionNumber: integer("version_number").notNull(),
  period: integer("period"),
  roundId: text("round_id").notNull().references(() => preventionRiskReviewRounds.id, { onDelete: "restrict" }),
  snapshot: jsonb("snapshot").notNull(),
  snapshotSha256: text("snapshot_sha256").notNull(),
  changeSummary: text("change_summary").notNull(),
  elaboratedByUserId: text("elaborated_by_user_id").notNull().references(() => users.id),
  technicalReviewerUserId: text("technical_reviewer_user_id").notNull().references(() => users.id),
  approverUserId: text("approver_user_id").notNull().references(() => users.id),
  elaboratedByName: text("elaborated_by_name").notNull(),
  technicalReviewerName: text("technical_reviewer_name").notNull(),
  approverName: text("approver_name").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prevention_risk_matrix_versions_matrix_number_unique").on(table.matrixId, table.versionNumber),
  check("prevention_risk_matrix_versions_number_positive", sql`${table.versionNumber} > 0`),
])

/* Observación general (entry_id nulo) o sobre una fila. Nunca se borra: la fila
 * puede eliminarse después (set null) y `entry_label` conserva a qué se refería. */
export const preventionRiskObservations = pgTable("prevention_risk_observations", {
  id: text("id").primaryKey(),
  matrixId: text("matrix_id").notNull().references(() => preventionRiskMatrices.id, { onDelete: "cascade" }),
  entryId: text("entry_id").references(() => preventionRiskEntries.id, { onDelete: "set null" }),
  entryLabel: text("entry_label"),
  roundId: text("round_id").notNull().references(() => preventionRiskReviewRounds.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  authorUserId: text("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  status: text("status").notNull().default("open"),
  response: text("response"),
  respondedByUserId: text("responded_by_user_id").references(() => users.id),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "string" }),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("prevention_risk_observations_matrix_status_idx").on(table.matrixId, table.status),
  check("prevention_risk_observations_stage_valid", sql`${table.stage} IN ('technical', 'legal_rrhh')`),
  check("prevention_risk_observations_status_valid", sql`${table.status} IN ('open', 'answered', 'resolved')`),
  check("prevention_risk_observations_body_length", sql`length(trim(${table.body})) >= 5`),
  check("prevention_risk_observations_answer_present", sql`${table.status} <> 'answered' OR ${table.response} IS NOT NULL`),
  check("prevention_risk_observations_resolution_present", sql`${table.status} <> 'resolved' OR ${table.resolvedByUserId} IS NOT NULL`),
])
```

En `db/schema/prevention/index.ts` agregar `export * from "./miper"`.

- [ ] **Step 4: Generar la migración 0344 y anexar el SQL de datos**

Run: `npm run db:generate -- --name miper_f1_modelo`
Expected: se crean `db/migrations/0344_miper_f1_modelo.sql` y `meta/0344_snapshot.json`.

Revisar el SQL generado:
- Debe contener `GENERATED ALWAYS AS (…) STORED` para `magnitude` y `classification`, y `ALTER COLUMN … DROP NOT NULL` en las columnas legacy.
- No debe aparecer ningún `DROP TABLE` ni `DROP COLUMN`.

Si drizzle-kit pregunta de forma interactiva si una columna se renombra, responder **"create column"**: no hay renombres en este cambio.

Anexar al final de `0344_miper_f1_modelo.sql`, sin tocar lo generado:

```sql
--> statement-breakpoint
-- MIPER F1: toda matriz existente es de la metodología anterior (inherente/residual).
UPDATE "prevention_risk_matrices" SET "is_legacy" = true;
--> statement-breakpoint
-- El flujo nuevo sólo conoce draft | published | superseded (0345 lo exige).
UPDATE "prevention_risk_matrices" SET "status" = 'draft' WHERE "status" IN ('in_review', 'reviewed', 'approved');
--> statement-breakpoint
INSERT INTO "prevention_risk_factors" ("id", "code", "name", "sort_order") VALUES
  ('riskfactor-locativo', 'locativo', 'Locativo', 10),
  ('riskfactor-mecanico', 'mecanico', 'Mecánico', 20),
  ('riskfactor-fisico', 'fisico', 'Físico', 30),
  ('riskfactor-quimico', 'quimico', 'Químico', 40),
  ('riskfactor-biologico', 'biologico', 'Biológico', 50),
  ('riskfactor-electrico', 'electrico', 'Eléctrico', 60),
  ('riskfactor-ergonomico', 'ergonomico', 'Ergonómico', 70),
  ('riskfactor-psicosocial', 'psicosocial', 'Psicosocial', 80),
  ('riskfactor-factor-humano', 'factor_humano', 'Factor humano', 90),
  ('riskfactor-ambiente', 'ambiente_trabajo', 'Ambiente de trabajo', 100),
  ('riskfactor-transito', 'transito', 'Tránsito', 110)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevention_risk_matrix_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las versiones selladas de la MIPER son inmutables';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS prevention_risk_matrix_versions_immutable_trg ON "prevention_risk_matrix_versions";
--> statement-breakpoint
CREATE TRIGGER prevention_risk_matrix_versions_immutable_trg
  BEFORE UPDATE OR DELETE ON "prevention_risk_matrix_versions"
  FOR EACH ROW EXECUTE FUNCTION prevention_risk_matrix_versions_immutable();
```

- [ ] **Step 5: Parte B: CHECK de estados y migración 0345**

En `preventionRiskMatrices`, reemplazar las dos restricciones antiguas:

```ts
  check("prevention_risk_matrices_status_valid", sql`${table.status} IN ('draft', 'published', 'superseded')`),
  check("prevention_risk_matrices_publish_evidence", sql`${table.status} NOT IN ('published', 'superseded') OR (${table.reviewedByUserId} IS NOT NULL AND ${table.approvedByUserId} IS NOT NULL)`),
```

Agregar:

```ts
  check("prevention_risk_matrices_superseded_idle", sql`${table.status} <> 'superseded' OR ${table.reviewState} = 'none'`),
```

Run: `npm run db:generate -- --name miper_f1_estados`
Expected: `0345_miper_f1_estados.sql`, que sólo reemplaza esos CHECK.

Luego:

```bash
node scripts/verify-migration-chain.mjs --update-checksums
npm run db:verify-migrations
npm run db:generate
```

Expected:
- `db:verify-migrations` sin errores.
- El último `db:generate` responde "No schema changes".

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:pglite -- db/__tests__/miper-constraints.test.ts db/schema-consistency.test.ts`
Expected: PASS. Si `schema-consistency` falla por una convención de nombres, corregir el nombre en el esquema **antes** de commitear y regenerar las dos migraciones:
1. Borrar los dos `.sql` y sus snapshots, que todavía no se han publicado.
2. Revertir `_journal.json` y `_sql-checksums.json` con `git checkout -- db/migrations/meta/_journal.json db/migrations/meta/_sql-checksums.json`.
3. Volver a generar.

Nunca editar el journal a mano.

- [ ] **Step 7: Aplicar en la base de desarrollo y commitear**

Run: `npm run db:migrate` (contra `bodega-dev-db`, según `.env.local`)
Expected: aplica 0344 y 0345 sin errores.

```bash
git add db/schema db/migrations db/__tests__/miper-constraints.test.ts tests/pglite-files.ts
git commit -m "feat(miper): modelo RE-04 (P×C generado, rondas, versiones inmutables, observaciones, factores)"
```

---

#### Task 6: Schemas de validación Zod

**Files:**
- Create: `lib/validation/prevention-module/miper.ts`
- Test: `lib/validation/prevention-module/miper.test.ts`

**Interfaces:**
- Produces (todas son `z.ZodObject`, con `z.infer` exportado como `…Input`):
  - Creación y encabezado: `createMiperSchema`, `miperHeaderSchema`.
  - Filas y medidas: `miperEntryValuesSchema`, `miperEntrySaveSchema`, `miperEntryRefSchema`, `miperControlSaveSchema`, `miperControlRefSchema`.
  - Flujo: `miperWorkflowSchema`, `miperCommentedDecisionSchema`, `miperApproveFinalSchema`.
  - Observaciones: `miperObservationSchema`, `miperObservationResponseSchema`, `miperObservationRefSchema`.
  - Otros: `miperDiscardSchema`, `riskFactorSaveSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/validation/prevention-module/miper.test.ts
import { describe, expect, it } from "vitest"
import { createMiperSchema, miperApproveFinalSchema, miperEntrySaveSchema, miperHeaderSchema, miperObservationSchema } from "./miper"

const header = {
  matrixId: "m1", expectedVersion: 1, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: "2026-05-02",
  companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero",
  economicActivity: "Transporte", adherentNumber: null, worksiteName: "Biodiversa",
  siteRepresentativeUserId: null, siteRepresentativeName: "Jean Paul", headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0,
  participationSummary: "", consultationEvidenceReference: "",
}

describe("schemas MIPER", () => {
  it("crear exige faena, período razonable y motivo", () => {
    expect(createMiperSchema.safeParse({ worksiteId: "ws", period: 2026, revisionReason: "Elaboración inicial 2026" }).success).toBe(true)
    expect(createMiperSchema.safeParse({ worksiteId: "ws", period: 1999, revisionReason: "Elaboración inicial 2026" }).success).toBe(false)
    expect(createMiperSchema.safeParse({ worksiteId: "ws", period: 2026, revisionReason: "corto" }).success).toBe(false)
  })
  it("encabezado: actualización ≥ elaboración y dotación que suma", () => {
    expect(miperHeaderSchema.safeParse(header).success).toBe(true)
    expect(miperHeaderSchema.safeParse({ ...header, updatedOn: "2026-01-01" }).success).toBe(false)
    expect(miperHeaderSchema.safeParse({ ...header, headcountMale: 10 }).success).toBe(false)
  })
  it("fila: P y C sólo 1, 2 o 4; admite fila incompleta; rechaza campos desconocidos", () => {
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", values: { probability: 4, consequence: 2 } }).success).toBe(true)
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", values: { probability: 3 } }).success).toBe(false)
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", values: {} }).success).toBe(true)
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", values: { classification: "tolerable" } }).success).toBe(false)
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", entryId: "e1", values: { hazard: "x" } }).success).toBe(false) // falta expectedVersion
  })
  it("observación y aprobación final exigen texto suficiente", () => {
    expect(miperObservationSchema.safeParse({ matrixId: "m1", entryId: "e1", body: "Revisar consecuencia" }).success).toBe(true)
    expect(miperObservationSchema.safeParse({ matrixId: "m1", body: "ok" }).success).toBe(false)
    expect(miperApproveFinalSchema.safeParse({ matrixId: "m1", expectedVersion: 3, changeSummary: "corto" }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/validation/prevention-module/miper.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write the implementation**

```ts
// lib/validation/prevention-module/miper.ts
import { z } from "zod"

const id = z.string().min(1)
const version = z.coerce.number().int().positive()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const scale = z.union([z.literal(1), z.literal(2), z.literal(4)], { message: "Usa Baja (1), Media (2) o Alta (4)." })
const optText = (max: number) => z.string().max(max).nullable().optional()
const headcount = z.coerce.number().int().min(0).max(100_000).nullable()

export const createMiperSchema = z.object({
  worksiteId: id,
  period: z.coerce.number().int().min(2000, "Período inválido").max(2100, "Período inválido"),
  sourceMatrixId: id.nullable().optional(),
  revisionReason: z.string().trim().min(10, "Describe el motivo en al menos 10 caracteres.").max(3000),
})

export const miperHeaderSchema = z.object({
  matrixId: id,
  expectedVersion: version,
  iperCode: z.string().trim().max(60).nullable(),
  elaboratedOn: isoDate.nullable(),
  updatedOn: isoDate.nullable(),
  companyName: z.string().trim().max(300).nullable(),
  companyRut: z.string().trim().max(30).nullable(),
  companyAddress: z.string().trim().max(300).nullable(),
  companyCommune: z.string().trim().max(120).nullable(),
  economicActivity: z.string().trim().max(300).nullable(),
  adherentNumber: z.string().trim().max(60).nullable(),
  worksiteName: z.string().trim().max(300).nullable(),
  siteRepresentativeUserId: id.nullable(),
  siteRepresentativeName: z.string().trim().max(300).nullable(),
  headcountTotal: headcount,
  headcountMale: headcount,
  headcountFemale: headcount,
  headcountOther: headcount,
  participationSummary: z.string().trim().max(5000),
  consultationEvidenceReference: z.string().trim().max(2000),
}).superRefine((value, ctx) => {
  if (value.elaboratedOn && value.updatedOn && value.updatedOn < value.elaboratedOn) {
    ctx.addIssue({ code: "custom", path: ["updatedOn"], message: "La fecha de actualización no puede ser anterior a la de elaboración." })
  }
  const parts = [value.headcountMale, value.headcountFemale, value.headcountOther]
  if (value.headcountTotal !== null && parts.every((part) => part !== null) && parts.reduce<number>((sum, part) => sum + (part ?? 0), 0) !== value.headcountTotal) {
    ctx.addIssue({ code: "custom", path: ["headcountTotal"], message: "Hombres + mujeres + otro debe sumar el total de trabajadores." })
  }
})

export const miperEntryValuesSchema = z.object({
  activity: optText(300),
  task: optText(300),
  position: optText(300),
  location: optText(300),
  exposedFemale: z.coerce.number().int().min(0).max(100_000).optional(),
  exposedMale: z.coerce.number().int().min(0).max(100_000).optional(),
  exposedOther: z.coerce.number().int().min(0).max(100_000).optional(),
  riskFactorId: id.nullable().optional(),
  isRoutine: z.boolean().nullable().optional(),
  hazard: optText(2000),
  risk: optText(2000),
  probableDamage: optText(3000),
  probability: scale.nullable().optional(),
  consequence: scale.nullable().optional(),
  controlledStatus: z.enum(["yes", "partial", "no"]).nullable().optional(),
}).strict()

export const miperEntrySaveSchema = z.object({
  matrixId: id,
  entryId: id.optional(),
  expectedVersion: version.optional(),
  insertAfterRowNumber: z.coerce.number().int().min(0).nullable().optional(),
  values: miperEntryValuesSchema,
}).refine((value) => !value.entryId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la fila; recarga la matriz." })

export const miperEntryRefSchema = z.object({ matrixId: id, entryId: id, expectedVersion: version.optional() })

export const miperControlSaveSchema = z.object({
  matrixId: id,
  entryId: id,
  controlId: id.optional(),
  expectedVersion: version.optional(),
  values: z.object({
    hierarchy: z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." }),
    description: z.string().trim().min(3, "Describe la medida.").max(3000),
    responsibleUserId: id.nullable().optional(),
    responsibleName: z.string().trim().max(300).nullable().optional(),
    dueDate: isoDate.nullable().optional(),
  }),
}).refine((value) => !value.controlId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la medida; recarga la matriz." })

export const miperControlRefSchema = z.object({ matrixId: id, controlId: id, expectedVersion: version })

export const miperWorkflowSchema = z.object({ matrixId: id, expectedVersion: version, comment: z.string().trim().max(3000).optional() })
export const miperCommentedDecisionSchema = miperWorkflowSchema.extend({ comment: z.string().trim().min(10, "Explica la decisión en al menos 10 caracteres.").max(3000) })
export const miperApproveFinalSchema = miperWorkflowSchema.extend({ changeSummary: z.string().trim().min(10, "Resume los cambios de esta versión (hoja Modificaciones).").max(3000) })

export const miperObservationSchema = z.object({ matrixId: id, entryId: id.nullable().optional(), body: z.string().trim().min(5, "La observación debe explicar qué revisar.").max(3000) })
export const miperObservationResponseSchema = z.object({ observationId: id, response: z.string().trim().min(5, "Explica qué corregiste o por qué se mantiene.").max(3000) })
export const miperObservationRefSchema = z.object({ observationId: id })

export const miperDiscardSchema = z.object({ matrixId: id, expectedVersion: version, reason: z.string().trim().min(10, "Indica por qué se descarta el borrador.").max(3000) })

export const riskFactorSaveSchema = z.object({
  id: id.optional(),
  code: z.string().trim().regex(/^[a-z0-9_]+$/, "Usa minúsculas, números y guion bajo.").min(2).max(60),
  name: z.string().trim().min(2).max(120),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
})

export type CreateMiperInput = z.infer<typeof createMiperSchema>
export type MiperHeaderInput = z.infer<typeof miperHeaderSchema>
export type MiperEntryValues = z.infer<typeof miperEntryValuesSchema>
export type MiperEntrySaveInput = z.infer<typeof miperEntrySaveSchema>
export type MiperControlSaveInput = z.infer<typeof miperControlSaveSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- lib/validation/prevention-module/miper.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts
git commit -m "feat(miper): schemas de validación del flujo RE-04"
```

---

#### Task 7: Base de servicios, diccionarios y fuentes del encabezado

**Files:**
- Create: `lib/services/miper/shared.ts`, `lib/services/miper/dictionaries.ts`, `lib/services/miper/prefill.ts`
- Modify: `lib/services/prevention-risk-legal.ts:73-93,101-103,129-141`: usar los helpers de `shared.ts` y `export type RiskLegalAccess = MiperAccess`
- Modify: `lib/services/system-settings.ts` (`CompanyProfile.adherentNumber`, clave `company_adherent_number`); `app/(app)/admin/configuracion/actions.ts` y `config-form.tsx` (campo "N° de adherente (mutualidad)")
- Modify: `lib/validation/masters.ts:87-95` (`commune`); `app/(app)/admin/faenas/actions.ts` y `worksite-form.tsx` (campo "Comuna")
- Test: `lib/__tests__/miper-dictionaries-prefill.test.ts` (PGlite; registrarlo en `tests/pglite-files.ts`)

**Interfaces:**
- Consumes: `normalizeMiperName`, `cleanMiperName`, `headcountFromSexCounts` (Task 2).
- Produces (`shared.ts`):
  - `type Client = DB | Tx` e `interface MiperAccess { userId: string; scope: WorksiteScope; permissions: readonly string[] }`.
  - Alcance y acceso: `scopeAllows(scope, worksiteId): boolean`, `requireAccess(access, permission, worksiteId?): void`, `scopeCondition(scope, column): SQL | undefined`.
  - Utilidades: `sha256(value: unknown): string`, `nowIso(): string`.
  - `miperHistory(client, args: { matrixId: string; worksiteId: string; object: MiperHistoryObject; objectId: string; changeType: string; reason?: string | null; before?: unknown; after?: unknown; actorUserId: string; actingAs: string }): Promise<void>`.
  - `type MiperHistoryObject = "matrix" | "header" | "entry" | "control" | "round" | "observation" | "version"`.
  - Matriz: `lockMatrix(client, matrixId)` devuelve la fila con `FOR UPDATE`; `assertEditable(matrix): void`.
  - Usuarios: `assertActiveUsers(client, ids)` y `userNames(client, ids): Promise<Map<string, string>>`.
  - `ACTING_AS_LABEL: Record<string, string>`.
- Produces (`dictionaries.ts`):
  - `type DictionaryKind = "activity" | "task" | "position" | "location"`.
  - `resolveDictionaryId(client, kind, worksiteId, raw: string | null | undefined): Promise<string | null>`.
  - `listDictionaryNames(client, worksiteId): Promise<{ activities: string[]; tasks: string[]; positions: string[]; locations: string[] }>`.
  - `listFreeTextSuggestions(client, worksiteId): Promise<{ hazards: string[]; risks: string[]; damages: string[]; measures: string[] }>`.
- Produces (`prefill.ts`):
  - `type MiperHeaderPrefill = { companyName: string; companyRut: string; companyAddress: string; economicActivity: string; adherentNumber: string; companyCommune: string | null; worksiteName: string; siteRepresentativeUserId: string | null; siteRepresentativeName: string | null; headcount: { total: number; male: number; female: number; other: number; unrecorded: number } }`.
  - `buildMiperHeaderPrefill(client, worksiteId): Promise<MiperHeaderPrefill>`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/miper-dictionaries-prefill.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { resolveDictionaryId, listDictionaryNames } = await import("@/lib/services/miper/dictionaries")
const { buildMiperHeaderPrefill } = await import("@/lib/services/miper/prefill")

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: "ws-d", name: "Biodiversa", code: "BIO", commune: "Cabrero" })
  await testDb.insert(schema.roles).values({ id: "rol-ac", name: "admin_contrato", label: "Administrador de contrato", isGlobal: false })
  await testDb.insert(schema.users).values([
    { id: "u-ac", name: "Juan Pérez", email: "jp@d.cl", hashedPassword: "x", isActive: true },
    { id: "u-other", name: "Otra Persona", email: "op@d.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.userRoles).values({ userId: "u-ac", roleId: "rol-ac" })
  await testDb.insert(schema.worksiteUsers).values([{ userId: "u-ac", worksiteId: "ws-d", isPrimary: true }, { userId: "u-other", worksiteId: "ws-d" }])
  await testDb.insert(schema.systemSettings).values([
    { key: "company_name", value: "Servicios Industriales Chome" },
    { key: "company_rut", value: "78.023.530-6" },
    { key: "company_adherent_number", value: "252086" },
  ])
  const base = { worksiteId: "ws-d", isActive: true }
  await testDb.insert(schema.workers).values([
    { id: "w1", name: "A", rut: "1-9", sex: "male", ...base },
    { id: "w2", name: "B", rut: "2-7", sex: "male", ...base },
    { id: "w3", name: "C", rut: "3-5", sex: "female", ...base },
    { id: "w4", name: "D", rut: "4-3", sex: null, ...base },
    { id: "w5", name: "E", rut: "5-1", sex: "female", worksiteId: "ws-d", isActive: false },
  ])
}, 60_000)

describe("diccionarios MIPER", () => {
  it("resuelve al mismo id escrituras casi iguales y no duplica", async () => {
    const a = await resolveDictionaryId(testDb, "activity", "ws-d", "Carga de lodo")
    const b = await resolveDictionaryId(testDb, "activity", "ws-d", "  carga DE  lodo ")
    expect(a).toBeTruthy()
    expect(b).toBe(a)
    expect((await listDictionaryNames(testDb, "ws-d")).activities).toEqual(["Carga de lodo"])
  })
  it("vacío resuelve a null; tareas, puestos y lugares cuelgan de la faena", async () => {
    expect(await resolveDictionaryId(testDb, "task", "ws-d", "   ")).toBeNull()
    for (const kind of ["task", "position", "location"] as const) expect(await resolveDictionaryId(testDb, kind, "ws-d", `Valor ${kind}`)).toBeTruthy()
    const names = await listDictionaryNames(testDb, "ws-d")
    expect(names.tasks).toEqual(["Valor task"])
    expect(names.locations).toEqual(["Valor location"])
  })
})

describe("prellenado del encabezado", () => {
  it("toma empresa, comuna, Administrador de contrato y dotación activa por sexo", async () => {
    const prefill = await buildMiperHeaderPrefill(testDb, "ws-d")
    expect(prefill).toMatchObject({
      companyName: "Servicios Industriales Chome", companyRut: "78.023.530-6", adherentNumber: "252086",
      companyCommune: "Cabrero", worksiteName: "Biodiversa",
      siteRepresentativeUserId: "u-ac", siteRepresentativeName: "Juan Pérez",
      headcount: { total: 4, male: 2, female: 1, other: 1, unrecorded: 1 },
    })
  })
})
```

Antes de escribir los inserts de `workers`, revisar las columnas obligatorias en `db/schema/worksites.ts:53-82` y ajustar los valores de `name`, `rut` y el resto de los campos requeridos para que el insert pase.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-dictionaries-prefill.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Write `shared.ts`**

```ts
// lib/services/miper/shared.ts
import { createHash } from "node:crypto"
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { DB, Tx } from "@/db"
import { preventionRiskMatrices, users } from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { recordModuleHistory } from "@/lib/audit"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"

export type Client = DB | Tx

export interface MiperAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

export type MiperHistoryObject = "matrix" | "header" | "entry" | "control" | "round" | "observation" | "version"

export const OUT_OF_SCOPE = "Registro preventivo no encontrado o fuera de alcance."

export function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

export function requireAccess(access: MiperAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new RiskLegalDomainError(OUT_OF_SCOPE)
  }
}

export function scopeCondition(scope: WorksiteScope, column: AnyPgColumn): SQL | undefined {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

export function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function nowIso() {
  return new Date().toISOString()
}

/** Con qué capacidad actuó la persona (§4.9 del spec): el permiso que ejerció. */
export const ACTING_AS_LABEL: Record<string, string> = {
  "prevention:risk:edit": "Prevencionista",
  "prevention:risk:review": "Jefatura del Depto. de Prevención",
  "prevention:risk:approve_legal": "Legal y RRHH",
  "prevention:risk:catalog:manage": "Administración del catálogo",
}

/**
 * Toda la línea de tiempo de un MIPER cuelga de la matriz (entity_id =
 * matrixId): la pestaña Historial se lee con el índice existente
 * `audit_log_entity_idx` sin JOIN. El objeto concreto (fila, medida, ronda…)
 * viaja en `newState.object/objectId`.
 */
export async function miperHistory(client: Client, args: {
  matrixId: string
  worksiteId: string
  object: MiperHistoryObject
  objectId: string
  changeType: string
  reason?: string | null
  before?: unknown
  after?: unknown
  actorUserId: string
  actingAs: string
}) {
  await recordModuleHistory(client, {
    module: "risk_legal:risk",
    entityType: "miper",
    entityId: args.matrixId,
    worksiteId: args.worksiteId,
    changeType: args.changeType,
    reason: args.reason ?? null,
    beforeState: args.before,
    afterState: args.after,
    actorUserId: args.actorUserId,
    extra: { object: args.object, objectId: args.objectId, actingAs: args.actingAs },
  })
}

export async function lockMatrix(client: Client, matrixId: string) {
  const [matrix] = await client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).for("update").limit(1)
  if (!matrix) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  return matrix
}

export function assertEditable(matrix: typeof preventionRiskMatrices.$inferSelect) {
  if (matrix.isLegacy) throw new RiskLegalDomainError("Esta MIPER usa la metodología anterior y es de solo lectura. Crea una MIPER nueva para el período.")
  if (matrix.status === "superseded") throw new RiskLegalDomainError("Esta MIPER fue reemplazada por la de otro período y ya no se puede modificar.")
}

export async function assertActiveUsers(client: Client, userIds: readonly (string | null | undefined)[]) {
  const uniqueIds = [...new Set(userIds.filter((userId): userId is string => Boolean(userId)))]
  if (uniqueIds.length === 0) return
  const active = await client.select({ id: users.id }).from(users).where(and(inArray(users.id, uniqueIds), eq(users.isActive, true)))
  if (active.length !== uniqueIds.length) throw new RiskLegalDomainError("La persona responsable no existe o está inactiva.")
}

export async function userNames(client: Client, userIds: readonly (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((userId): userId is string => Boolean(userId)))]
  if (ids.length === 0) return new Map<string, string>()
  const rows = await client.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}
```

En `lib/services/prevention-risk-legal.ts`:
1. Borrar las definiciones locales de `RiskLegalAccess`, `scopeAllows`, `requireAccess`, `scopeCondition`, `sha256` y `assertActiveUsers`.
2. Agregar:

   ```ts
   import { assertActiveUsers, requireAccess, scopeAllows, scopeCondition, sha256, type MiperAccess } from "@/lib/services/miper/shared"
   export type RiskLegalAccess = MiperAccess
   ```

3. `assertActiveUser` queda como envoltura local de `assertActiveUsers`.

- [ ] **Step 4: Write `dictionaries.ts` and `prefill.ts`**

```ts
// lib/services/miper/dictionaries.ts
import { and, asc, eq, isNotNull } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskLocations, preventionRiskMatrices,
  preventionRiskPositions, preventionRiskProcesses, preventionRiskTasks,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanMiperName, normalizeMiperName } from "@/lib/prevention/miper/names"
import type { Client } from "./shared"

export type DictionaryKind = "activity" | "task" | "position" | "location"

/**
 * Autocompletado que no obliga (§8.2): un nombre nuevo se crea, uno existente
 * —comparado por nombre normalizado— se reutiliza. Carrera entre dos pestañas:
 * `onConflictDoNothing` sobre el índice único y re-lectura.
 */
export async function resolveDictionaryId(client: Client, kind: DictionaryKind, worksiteId: string, raw: string | null | undefined): Promise<string | null> {
  const name = cleanMiperName(raw)
  if (!name) return null
  const normalizedName = normalizeMiperName(name)
  const suffix = nanoid(8)
  if (kind === "activity") {
    const table = preventionRiskProcesses
    await client.insert(table).values({ id: `riskprocess-${suffix}`, worksiteId, code: `A-${suffix}`, name, normalizedName })
      .onConflictDoNothing({ target: [table.worksiteId, table.normalizedName] })
    const [row] = await client.select({ id: table.id }).from(table).where(and(eq(table.worksiteId, worksiteId), eq(table.normalizedName, normalizedName))).limit(1)
    return row?.id ?? null
  }
  if (kind === "task") {
    const table = preventionRiskTasks
    await client.insert(table).values({ id: `risktask-${suffix}`, worksiteId, processId: null, code: `T-${suffix}`, name, normalizedName })
      .onConflictDoNothing({ target: [table.worksiteId, table.normalizedName] })
    const [row] = await client.select({ id: table.id }).from(table).where(and(eq(table.worksiteId, worksiteId), eq(table.normalizedName, normalizedName))).limit(1)
    return row?.id ?? null
  }
  if (kind === "position") {
    const table = preventionRiskPositions
    await client.insert(table).values({ id: `riskposition-${suffix}`, worksiteId, taskId: null, code: `P-${suffix}`, name, normalizedName })
      .onConflictDoNothing({ target: [table.worksiteId, table.normalizedName] })
    const [row] = await client.select({ id: table.id }).from(table).where(and(eq(table.worksiteId, worksiteId), eq(table.normalizedName, normalizedName))).limit(1)
    return row?.id ?? null
  }
  const table = preventionRiskLocations
  await client.insert(table).values({ id: `risklocation-${suffix}`, worksiteId, name, normalizedName })
    .onConflictDoNothing({ target: [table.worksiteId, table.normalizedName] })
  const [row] = await client.select({ id: table.id }).from(table).where(and(eq(table.worksiteId, worksiteId), eq(table.normalizedName, normalizedName))).limit(1)
  return row?.id ?? null
}

export async function listDictionaryNames(client: Client, worksiteId: string) {
  const [activities, tasks, positions, locations] = await Promise.all([
    client.select({ name: preventionRiskProcesses.name }).from(preventionRiskProcesses)
      .where(and(eq(preventionRiskProcesses.worksiteId, worksiteId), eq(preventionRiskProcesses.isActive, true), isNotNull(preventionRiskProcesses.normalizedName))).orderBy(asc(preventionRiskProcesses.name)),
    client.select({ name: preventionRiskTasks.name }).from(preventionRiskTasks)
      .where(and(eq(preventionRiskTasks.worksiteId, worksiteId), eq(preventionRiskTasks.isActive, true), isNotNull(preventionRiskTasks.normalizedName))).orderBy(asc(preventionRiskTasks.name)),
    client.select({ name: preventionRiskPositions.name }).from(preventionRiskPositions)
      .where(and(eq(preventionRiskPositions.worksiteId, worksiteId), eq(preventionRiskPositions.isActive, true), isNotNull(preventionRiskPositions.normalizedName))).orderBy(asc(preventionRiskPositions.name)),
    client.select({ name: preventionRiskLocations.name }).from(preventionRiskLocations)
      .where(and(eq(preventionRiskLocations.worksiteId, worksiteId), eq(preventionRiskLocations.isActive, true))).orderBy(asc(preventionRiskLocations.name)),
  ])
  const names = (rows: Array<{ name: string }>) => rows.map((row) => row.name)
  return { activities: names(activities), tasks: names(tasks), positions: names(positions), locations: names(locations) }
}

/** Valores ya escritos en MIPER no legacy de la faena, para sugerir sin obligar. */
export async function listFreeTextSuggestions(client: Client, worksiteId: string) {
  const inWorksite = and(eq(preventionRiskMatrices.worksiteId, worksiteId), eq(preventionRiskMatrices.isLegacy, false))
  const distinct = async (column: AnyPgColumn) => (await client.selectDistinct({ value: column }).from(preventionRiskEntries)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .where(and(inWorksite, isNotNull(column))).orderBy(asc(column)).limit(500)).map((row) => String(row.value))
  const [hazards, risks, damages, measures] = await Promise.all([
    distinct(preventionRiskEntries.hazard),
    distinct(preventionRiskEntries.risk),
    distinct(preventionRiskEntries.probableDamage),
    client.selectDistinct({ value: preventionRiskControls.description }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
      .where(inWorksite).orderBy(asc(preventionRiskControls.description)).limit(500).then((rows) => rows.map((row) => row.value)),
  ])
  return { hazards, risks, damages, measures }
}
```

```ts
// lib/services/miper/prefill.ts
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { roles, userRoles, users, workers, worksites, worksiteUsers } from "@/db/schema"
import { headcountFromSexCounts } from "@/lib/prevention/miper/names"
import { getCompanyProfile } from "@/lib/services/system-settings"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import type { Client } from "./shared"

export type MiperHeaderPrefill = {
  companyName: string; companyRut: string; companyAddress: string; economicActivity: string; adherentNumber: string
  companyCommune: string | null; worksiteName: string
  siteRepresentativeUserId: string | null; siteRepresentativeName: string | null
  headcount: { total: number; male: number; female: number; other: number; unrecorded: number }
}

/**
 * Antecedentes del RE-04 desde lo que la plataforma ya sabe (§4.8 del spec):
 * nada de esto se escribe dos veces. El representante es quien tiene el rol
 * `admin_contrato` en la faena —el representante de CHOME en ese contrato—,
 * nunca el representante legal corporativo.
 */
export async function buildMiperHeaderPrefill(client: Client, worksiteId: string): Promise<MiperHeaderPrefill> {
  const [profile, [worksite], [representative], sexCounts] = await Promise.all([
    getCompanyProfile(),
    client.select({ name: worksites.name, commune: worksites.commune }).from(worksites).where(eq(worksites.id, worksiteId)).limit(1),
    client.select({ id: users.id, name: users.name }).from(worksiteUsers)
      .innerJoin(userRoles, eq(userRoles.userId, worksiteUsers.userId))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, worksiteUsers.userId))
      .where(and(eq(worksiteUsers.worksiteId, worksiteId), eq(roles.name, "admin_contrato"), eq(users.isActive, true)))
      .orderBy(desc(worksiteUsers.isPrimary), asc(users.name)).limit(1),
    client.select({ sex: workers.sex, count: sql<number>`count(*)::int` }).from(workers)
      .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true))).groupBy(workers.sex),
  ])
  if (!worksite) throw new RiskLegalDomainError("Faena no encontrada.")
  return {
    companyName: profile.name,
    companyRut: profile.rut,
    companyAddress: profile.address,
    economicActivity: profile.businessActivity,
    adherentNumber: profile.adherentNumber,
    companyCommune: worksite.commune,
    worksiteName: worksite.name,
    siteRepresentativeUserId: representative?.id ?? null,
    siteRepresentativeName: representative?.name ?? null,
    headcount: headcountFromSexCounts(sexCounts),
  }
}
```

En `lib/services/system-settings.ts`:
- Agregar `adherentNumber: string` a `CompanyProfile`, `adherentNumber: ""` a `DEFAULT_COMPANY_PROFILE` y `adherentNumber: "company_adherent_number"` a `COMPANY_PROFILE_KEYS`.
- En `setCompanyProfile`, agregar `adherentNumber: cleanSetting(profile.adherentNumber)`.
- `getCompanyProfile` recorre `COMPANY_PROFILE_KEYS`: comprobar que el campo nuevo se lee sin más cambios.

En `app/(app)/admin/configuracion/actions.ts`:
- Agregar `companyAdherentNumber: z.string().trim().max(60, "Máximo 60 caracteres").optional()` al schema.
- Leer `formData.get("companyAdherentNumber") || undefined` y pasarlo como `adherentNumber`.

En `config-form.tsx`, junto al RUT, agregar un `Field label="N° de adherente (mutualidad)"` con `Input name="companyAdherentNumber"`.

En `lib/validation/masters.ts` (`worksiteSchema`), agregar `commune: z.string().max(120).optional().or(z.literal(""))`.

En `app/(app)/admin/faenas/actions.ts`, en las dos ramas (crear y editar), agregar `commune: formData.get("commune") || undefined` al parseo y `commune: d.commune || null` al insert/update.

En `worksite-form.tsx`, después de Región:

```tsx
<Field label="Comuna" htmlFor="ws-commune" error={state.fieldErrors?.commune?.[0]}>
  <Input id="ws-commune" name="commune" defaultValue={editWorksite?.commune ?? ""} placeholder="Cabrero" />
</Field>
```

Agregar `commune: string | null` al tipo de `editWorksite` donde se declara, junto a `region`.

- [ ] **Step 5: Run tests**

Run: `npm run test:pglite -- lib/__tests__/miper-dictionaries-prefill.test.ts && npm run test:fast -- lib/__tests__/system-settings.test.ts lib/__tests__/validation-masters.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio. Si `system-settings.test.ts` compara el perfil completo, agregarle `adherentNumber`.

- [ ] **Step 6: Commit**

```bash
git add lib/services/miper lib/services/prevention-risk-legal.ts lib/services/system-settings.ts lib/validation/masters.ts "app/(app)/admin" lib/__tests__/miper-dictionaries-prefill.test.ts lib/__tests__/system-settings.test.ts tests/pglite-files.ts
git commit -m "feat(miper): diccionarios por faena, prellenado del encabezado RE-04, comuna y N° de adherente"
```

---

#### Task 8: Servicio de matrices (crear, encabezado, descartar)

**Files:**
- Create: `lib/services/miper/matrices.ts`
- Test: `lib/__tests__/miper-matrices.test.ts` (PGlite; registrarlo)

**Interfaces:**
- Consumes: `shared.ts`, `prefill.ts` (Task 7); schemas (Task 6); `RE04_METHODOLOGY` (Task 1).
- Produces:
  - `ensureRe04Methodology(client, actorUserId): Promise<typeof preventionRiskMethodologies.$inferSelect>`
  - `createMiper(input: unknown, access: MiperAccess): Promise<{ id: string }>`
  - `updateMiperHeader(input: unknown, access: MiperAccess): Promise<{ version: number }>`
  - `discardMiperDraft(input: unknown, access: MiperAccess): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/miper-matrices.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const matrices = await import("@/lib/services/miper/matrices")

const scopeA = { mode: "some" as const, ids: ["ws-a"] }
const author = { userId: "u-author", scope: scopeA, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const outsider = { userId: "u-out", scope: { mode: "some" as const, ids: ["ws-b"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([{ id: "ws-a", name: "Faena A", code: "A", commune: "Cabrero" }, { id: "ws-b", name: "Faena B", code: "B" }])
  await testDb.insert(schema.users).values([
    { id: "u-author", name: "Autora", email: "a@m.cl", hashedPassword: "x", isActive: true },
    { id: "u-out", name: "Externa", email: "o@m.cl", hashedPassword: "x", isActive: true },
  ])
}, 60_000)

describe("crear MIPER", () => {
  it("crea un borrador por faena y período con el encabezado prellenado", async () => {
    const { id } = await matrices.createMiper({ worksiteId: "ws-a", period: 2026, revisionReason: "Elaboración inicial del período 2026." }, author)
    const [row] = await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, id))
    expect(row).toMatchObject({ status: "draft", reviewState: "none", period: 2026, isLegacy: false, worksiteName: "Faena A", companyCommune: "Cabrero", iperCode: "RE-04" })
    expect(row!.elaboratedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await expect(matrices.createMiper({ worksiteId: "ws-a", period: 2026, revisionReason: "Segundo intento del mismo período." }, author)).rejects.toThrow(/Ya existe un MIPER del período 2026/)
  })
  it("no crea fuera del alcance de faenas", async () => {
    await expect(matrices.createMiper({ worksiteId: "ws-a", period: 2027, revisionReason: "Intento desde otra faena." }, outsider)).rejects.toThrow(/fuera de alcance/)
  })
  it("un período nuevo copia filas y medidas de la vigente con ids nuevos", async () => {
    // Fuente sembrada directo en la base: esta prueba no depende del servicio de filas (Task 9).
    const { id: source } = await matrices.createMiper({ worksiteId: "ws-a", period: 2025, revisionReason: "Período anterior para copiar." }, author)
    await testDb.insert(schema.preventionRiskEntries).values({ id: "src-e1", matrixId: source, rowNumber: 1, hazardCode: "R-src", hazard: "Camión", probability: 2, consequence: 4 })
    await testDb.insert(schema.preventionRiskControls).values({ id: "src-c1", riskEntryId: "src-e1", description: "Procedimiento de carga", hierarchy: "administrative", responsibleSnapshot: "Supervisor", dueDate: "2026-12-31", status: "verified", effectivenessStatus: "effective" })
    await testDb.update(schema.preventionRiskMatrices).set({ status: "published", reviewedByUserId: "u-author", approvedByUserId: "u-out" }).where(eq(schema.preventionRiskMatrices.id, source))
    const { id: copy } = await matrices.createMiper({ worksiteId: "ws-a", period: 2028, sourceMatrixId: source, revisionReason: "Renovación anual del período 2028." }, author)
    const copied = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, copy))
    expect(copied).toHaveLength(1)
    expect(copied[0]!.id).not.toBe("src-e1")
    expect(copied[0]).toMatchObject({ probability: 2, consequence: 4, classification: "important", rowNumber: 1 })
    const controls = await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.riskEntryId, copied[0]!.id))
    expect(controls).toEqual([expect.objectContaining({ description: "Procedimiento de carga", status: "implemented", effectivenessStatus: "not_assessed" })])
  })
})

describe("encabezado y descarte", () => {
  it("guarda el encabezado con control de versión y rechaza incoherencias", async () => {
    const { id } = await matrices.createMiper({ worksiteId: "ws-a", period: 2030, revisionReason: "Período para probar el encabezado." }, author)
    const header = {
      matrixId: id, expectedVersion: 1, iperCode: "RE-04", elaboratedOn: "2030-01-10", updatedOn: "2030-02-01",
      companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero", economicActivity: "Transporte",
      adherentNumber: "252086", worksiteName: "Faena A", siteRepresentativeUserId: null, siteRepresentativeName: "Juan Pérez",
      headcountTotal: 3, headcountMale: 2, headcountFemale: 1, headcountOther: 0, participationSummary: "", consultationEvidenceReference: "",
    }
    expect(await matrices.updateMiperHeader(header, author)).toEqual({ version: 2 })
    await expect(matrices.updateMiperHeader(header, author)).rejects.toThrow(/cambió mientras/)
    await expect(matrices.updateMiperHeader({ ...header, expectedVersion: 2, headcountMale: 5 }, author)).rejects.toThrow()
  })
  it("descarta un borrador nunca enviado", async () => {
    const { id } = await matrices.createMiper({ worksiteId: "ws-a", period: 2031, revisionReason: "Borrador que se descartará." }, author)
    await matrices.discardMiperDraft({ matrixId: id, expectedVersion: 1, reason: "Creado por error en otro período." }, author)
    expect(await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, id))).toHaveLength(0)
  })
})
```

Registrar el archivo en `tests/pglite-files.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-matrices.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/miper/matrices.ts
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskMatrices, preventionRiskMethodologies,
  preventionRiskReviewRounds, worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { RE04_METHODOLOGY } from "@/lib/prevention/miper/methodology"
import { todayInChile } from "@/lib/utils"
import { createMiperSchema, miperDiscardSchema, miperHeaderSchema } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { buildMiperHeaderPrefill } from "./prefill"
import { assertActiveUsers, assertEditable, type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess } from "./shared"

const STALE = "La MIPER cambió mientras la editabas. Recarga antes de continuar."

export async function ensureRe04Methodology(client: Client, actorUserId: string) {
  await client.insert(preventionRiskMethodologies).values({ ...RE04_METHODOLOGY, createdByUserId: actorUserId }).onConflictDoNothing()
  const [methodology] = await client.select().from(preventionRiskMethodologies).where(eq(preventionRiskMethodologies.id, RE04_METHODOLOGY.id)).limit(1)
  if (!methodology) throw new Error("No se pudo preparar la metodología RE-04.")
  return methodology
}

export async function createMiper(input: unknown, access: MiperAccess) {
  const data = createMiperSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  return db.transaction(async (tx) => {
    const [worksite] = await tx.select({ id: worksites.id, name: worksites.name }).from(worksites)
      .where(and(eq(worksites.id, data.worksiteId), eq(worksites.isActive, true))).limit(1)
    if (!worksite) throw new RiskLegalDomainError("Faena no encontrada o inactiva.")
    const [open] = await tx.select({ id: preventionRiskMatrices.id }).from(preventionRiskMatrices).where(and(
      eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.period, data.period), ne(preventionRiskMatrices.status, "superseded"),
    )).limit(1)
    if (open) throw new RiskLegalDomainError(`Ya existe un MIPER del período ${data.period} para esta faena: ábrelo desde la lista.`)

    let source: typeof preventionRiskMatrices.$inferSelect | null = null
    if (data.sourceMatrixId) {
      const [row] = await tx.select().from(preventionRiskMatrices).where(and(
        eq(preventionRiskMatrices.id, data.sourceMatrixId), eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.status, "published"),
      )).limit(1)
      if (!row) throw new RiskLegalDomainError("La MIPER de origen no está vigente o es de otra faena.")
      if (row.isLegacy) throw new RiskLegalDomainError("La MIPER vigente usa la metodología anterior y no se puede copiar: crea la matriz vacía.")
      source = row
    }

    const methodology = await ensureRe04Methodology(tx, access.userId)
    const prefill = await buildMiperHeaderPrefill(tx, data.worksiteId)
    const [last] = await tx.select({ matrixVersion: preventionRiskMatrices.matrixVersion }).from(preventionRiskMatrices)
      .where(eq(preventionRiskMatrices.worksiteId, data.worksiteId)).orderBy(desc(preventionRiskMatrices.matrixVersion)).limit(1)
    const now = nowIso()
    const id = `riskmatrix-${nanoid()}`
    await tx.insert(preventionRiskMatrices).values({
      id,
      worksiteId: data.worksiteId,
      matrixVersion: (last?.matrixVersion ?? 0) + 1,
      title: `MIPER ${worksite.name} ${data.period}`,
      status: "draft",
      reviewState: "none",
      period: data.period,
      methodologyId: methodology.id,
      methodologySnapshot: { code: methodology.code, name: methodology.name, versionLabel: methodology.versionLabel, kind: methodology.kind, authoritySource: methodology.authoritySource, configuration: methodology.configuration },
      revisionReason: data.revisionReason,
      participationSummary: source?.participationSummary ?? "",
      consultationEvidenceReference: "",
      supersedesMatrixId: source?.id ?? null,
      iperCode: "RE-04",
      elaboratedOn: todayInChile(),
      updatedOn: null,
      companyName: prefill.companyName,
      companyRut: prefill.companyRut,
      companyAddress: prefill.companyAddress,
      companyCommune: prefill.companyCommune,
      economicActivity: prefill.economicActivity,
      adherentNumber: prefill.adherentNumber || null,
      worksiteName: prefill.worksiteName,
      siteRepresentativeUserId: prefill.siteRepresentativeUserId,
      siteRepresentativeName: prefill.siteRepresentativeName,
      headcountTotal: prefill.headcount.total,
      headcountMale: prefill.headcount.male,
      headcountFemale: prefill.headcount.female,
      headcountOther: prefill.headcount.other,
      createdByUserId: access.userId,
      createdAt: now,
      updatedAt: now,
    })

    if (source) {
      const sourceEntries = await tx.select().from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, source.id)).orderBy(asc(preventionRiskEntries.rowNumber))
      const newIdBySource = new Map(sourceEntries.map((entry) => [entry.id, `riskentry-${nanoid()}`]))
      if (sourceEntries.length > 0) {
        // `magnitude` y `classification` son generadas: no se insertan.
        await tx.insert(preventionRiskEntries).values(sourceEntries.map(({ magnitude: _m, classification: _c, ...entry }) => ({
          ...entry, id: newIdBySource.get(entry.id)!, matrixId: id, version: 1, createdAt: now, updatedAt: now,
        })))
        const sourceControls = await tx.select().from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, sourceEntries.map((entry) => entry.id)))
        if (sourceControls.length > 0) {
          await tx.insert(preventionRiskControls).values(sourceControls.map((control) => ({
            ...control,
            id: `riskcontrol-${nanoid()}`,
            riskEntryId: newIdBySource.get(control.riskEntryId)!,
            // La verificación es del período anterior: el nuevo parte sin ella.
            status: control.status === "verified" ? "implemented" : control.status,
            effectivenessStatus: "not_assessed",
            lastVerifiedByUserId: null,
            lastVerifiedAt: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
          })))
        }
      }
    }

    await miperHistory(tx, {
      matrixId: id, worksiteId: data.worksiteId, object: "matrix", objectId: id, changeType: "created",
      reason: data.revisionReason, after: { period: data.period, sourceMatrixId: source?.id ?? null }, actorUserId: access.userId, actingAs: "prevention:risk:edit",
    })
    return { id }
  })
}

export async function updateMiperHeader(input: unknown, access: MiperAccess) {
  const data = miperHeaderSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, "prevention:risk:edit", matrix.worksiteId)
    assertEditable(matrix)
    if (matrix.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE)
    await assertActiveUsers(tx, [data.siteRepresentativeUserId])
    const { matrixId: _id, expectedVersion: _v, ...fields } = data
    const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => matrix[key as keyof typeof matrix] !== value))
    const [updated] = await tx.update(preventionRiskMatrices).set({ ...fields, version: matrix.version + 1, updatedAt: nowIso() })
      .where(and(eq(preventionRiskMatrices.id, matrix.id), eq(preventionRiskMatrices.version, data.expectedVersion))).returning({ version: preventionRiskMatrices.version })
    if (!updated) throw new RiskLegalDomainError(STALE)
    if (Object.keys(changed).length > 0) {
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "header", objectId: matrix.id, changeType: "header_updated",
        before: Object.fromEntries(Object.keys(changed).map((key) => [key, matrix[key as keyof typeof matrix]])), after: changed,
        actorUserId: access.userId, actingAs: "prevention:risk:edit",
      })
    }
    return { version: updated.version }
  })
}

export async function discardMiperDraft(input: unknown, access: MiperAccess) {
  const data = miperDiscardSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, "prevention:risk:edit", matrix.worksiteId)
    if (matrix.status !== "draft" || matrix.isLegacy) throw new RiskLegalDomainError("Sólo se descarta un borrador RE-04 que nunca fue aprobado.")
    if (matrix.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE)
    const [round] = await tx.select({ id: preventionRiskReviewRounds.id }).from(preventionRiskReviewRounds).where(eq(preventionRiskReviewRounds.matrixId, matrix.id)).limit(1)
    if (round) throw new RiskLegalDomainError("Este borrador ya pasó por revisión: su historia se conserva y no se puede descartar.")
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
    // La traza sobrevive a la matriz: audit_log no tiene FK a ella.
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "matrix", objectId: matrix.id, changeType: "deleted",
      reason: data.reason, before: { period: matrix.period, entryCount: count }, actorUserId: access.userId, actingAs: "prevention:risk:edit",
    })
    await tx.delete(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrix.id))
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:pglite -- lib/__tests__/miper-matrices.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/miper/matrices.ts lib/__tests__/miper-matrices.test.ts tests/pglite-files.ts
git commit -m "feat(miper): crear MIPER por faena y período, encabezado y descarte de borrador"
```

---

#### Task 9: Servicio de filas y medidas

**Files:**
- Create: `lib/services/miper/entries.ts`
- Test: `lib/__tests__/miper-entries.test.ts` (PGlite; registrarlo)

**Interfaces:**
- Consumes: `shared.ts` y `dictionaries.ts` (Task 7); schemas (Task 6); `createMiper` (Task 8).
- Produces:
  - `type SavedEntry = { id: string; version: number; rowNumber: number; magnitude: number | null; classification: string | null }`
  - `saveMiperEntry(input: unknown, access): Promise<SavedEntry>`
  - `duplicateMiperEntry(input: unknown, access): Promise<SavedEntry>` (input `{ matrixId, entryId }`)
  - `deleteMiperEntry(input: unknown, access): Promise<void>` (input `{ matrixId, entryId, expectedVersion }`)
  - `saveMiperControl(input: unknown, access): Promise<{ id: string; version: number }>`
  - `deleteMiperControl(input: unknown, access): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/miper-entries.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const svc = await import("@/lib/services/miper/entries")

const author = { userId: "u-a", scope: { mode: "some" as const, ids: ["ws-e"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
let matrixId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: "ws-e", name: "Faena E", code: "E" })
  await testDb.insert(schema.users).values([
    { id: "u-a", name: "Autora", email: "a@e.cl", hashedPassword: "x", isActive: true },
    { id: "u-inactive", name: "Inactiva", email: "i@e.cl", hashedPassword: "x", isActive: false },
  ])
  matrixId = (await createMiper({ worksiteId: "ws-e", period: 2026, revisionReason: "Período para probar filas." }, author)).id
}, 60_000)

const rows = () => testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, matrixId)).orderBy(asc(schema.preventionRiskEntries.rowNumber))

describe("filas de la matriz", () => {
  it("crea una fila incompleta, la completa y la clasificación se calcula", async () => {
    const created = await svc.saveMiperEntry({ matrixId, values: { activity: "Transporte de lodo", task: "Descarga" } }, author)
    expect(created).toMatchObject({ rowNumber: 1, version: 1, classification: null })
    const updated = await svc.saveMiperEntry({ matrixId, entryId: created.id, expectedVersion: 1, values: { probability: 4, consequence: 4, hazard: "Volcamiento" } }, author)
    expect(updated).toMatchObject({ version: 2, magnitude: 16, classification: "intolerable" })
  })

  it("rechaza una edición con versión vieja (dos pestañas sobre la misma fila)", async () => {
    const [first] = await rows()
    await expect(svc.saveMiperEntry({ matrixId, entryId: first!.id, expectedVersion: 1, values: { risk: "Otro" } }, author)).rejects.toThrow(/La fila cambió mientras la editabas/)
  })

  it("insertar debajo renumera las siguientes; duplicar copia fila y medidas; eliminar compacta", async () => {
    const second = await svc.saveMiperEntry({ matrixId, values: { hazard: "Segunda" } }, author)
    expect(second.rowNumber).toBe(2)
    const between = await svc.saveMiperEntry({ matrixId, insertAfterRowNumber: 1, values: { hazard: "Entre medio" } }, author)
    expect(between.rowNumber).toBe(2)
    expect((await rows()).map((r) => r.hazard)).toEqual(["Volcamiento", "Entre medio", "Segunda"])

    const [first] = await rows()
    await svc.saveMiperControl({ matrixId, entryId: first!.id, values: { hierarchy: "engineering", description: "Topes de descarga", responsibleName: "Supervisor", dueDate: "2026-11-30" } }, author)
    const dup = await svc.duplicateMiperEntry({ matrixId, entryId: first!.id }, author)
    expect(dup.rowNumber).toBe(2)
    const dupControls = await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.riskEntryId, dup.id))
    expect(dupControls.map((c) => c.description)).toEqual(["Topes de descarga"])

    const target = (await rows())[1]!
    await svc.deleteMiperEntry({ matrixId, entryId: target.id, expectedVersion: target.version }, author)
    expect((await rows()).map((r) => r.rowNumber)).toEqual([1, 2, 3])
  })

  it("medidas: responsable activo, versión y borrado", async () => {
    const [first] = await rows()
    await expect(svc.saveMiperControl({ matrixId, entryId: first!.id, values: { hierarchy: "ppe", description: "Casco", responsibleUserId: "u-inactive", dueDate: "2026-11-30" } }, author)).rejects.toThrow(/inactiva/)
    const control = await svc.saveMiperControl({ matrixId, entryId: first!.id, values: { hierarchy: "ppe", description: "Casco", responsibleUserId: "u-a", dueDate: "2026-11-30" } }, author)
    const [row] = await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.id, control.id))
    expect(row!.responsibleSnapshot).toBe("Autora")
    const edited = await svc.saveMiperControl({ matrixId, entryId: first!.id, controlId: control.id, expectedVersion: 1, values: { hierarchy: "ppe", description: "Casco y barbiquejo", responsibleUserId: "u-a", dueDate: "2026-11-30" } }, author)
    expect(edited.version).toBe(2)
    await svc.deleteMiperControl({ matrixId, controlId: control.id, expectedVersion: 2 }, author)
    expect(await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.id, control.id))).toHaveLength(0)
  })

  it("una matriz legacy no admite cambios", async () => {
    await testDb.update(schema.preventionRiskMatrices).set({ isLegacy: true }).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await expect(svc.saveMiperEntry({ matrixId, values: { hazard: "x" } }, author)).rejects.toThrow(/solo lectura/)
    await testDb.update(schema.preventionRiskMatrices).set({ isLegacy: false }).where(eq(schema.preventionRiskMatrices.id, matrixId))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-entries.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/miper/entries.ts
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionPdtpSourceLinks, preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskMapMarkers, preventionRiskMatrices } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanMiperName } from "@/lib/prevention/miper/names"
import { miperControlRefSchema, miperControlSaveSchema, miperEntryRefSchema, miperEntrySaveSchema, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { resolveDictionaryId } from "./dictionaries"
import { assertActiveUsers, assertEditable, type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess, userNames } from "./shared"

const STALE_ENTRY = "La fila cambió mientras la editabas. Recarga la matriz para ver el cambio de la otra persona."
const STALE_CONTROL = "La medida cambió mientras la editabas. Recarga la matriz."
const EDIT = "prevention:risk:edit"

export type SavedEntry = { id: string; version: number; rowNumber: number; magnitude: number | null; classification: string | null }

function saved(row: typeof preventionRiskEntries.$inferSelect): SavedEntry {
  return { id: row.id, version: row.version, rowNumber: row.rowNumber ?? 0, magnitude: row.magnitude, classification: row.classification }
}

async function touchMatrix(client: Client, matrixId: string, now: string) {
  // Sin tocar `version`: ese es el candado del encabezado y del flujo. Sí
  // `updated_at`, que la bandeja usa para detectar "cambios sin enviar".
  await client.update(preventionRiskMatrices).set({ updatedAt: now }).where(eq(preventionRiskMatrices.id, matrixId))
}

async function activePdtpLink(client: Client, controlIds: string[]) {
  if (controlIds.length === 0) return false
  const [link] = await client.select({ id: preventionPdtpSourceLinks.id }).from(preventionPdtpSourceLinks)
    .where(and(eq(preventionPdtpSourceLinks.sourceType, "risk_control"), inArray(preventionPdtpSourceLinks.sourceId, controlIds), eq(preventionPdtpSourceLinks.isActive, true))).limit(1)
  return Boolean(link)
}

async function toColumns(client: Client, worksiteId: string, values: MiperEntryValues): Promise<Partial<typeof preventionRiskEntries.$inferInsert>> {
  const out: Partial<typeof preventionRiskEntries.$inferInsert> = {}
  if ("activity" in values) out.processId = await resolveDictionaryId(client, "activity", worksiteId, values.activity)
  if ("task" in values) out.taskId = await resolveDictionaryId(client, "task", worksiteId, values.task)
  if ("position" in values) out.positionId = await resolveDictionaryId(client, "position", worksiteId, values.position)
  if ("location" in values) out.locationId = await resolveDictionaryId(client, "location", worksiteId, values.location)
  if ("hazard" in values) out.hazard = cleanMiperName(values.hazard)
  if ("risk" in values) out.risk = cleanMiperName(values.risk)
  if ("probableDamage" in values) out.probableDamage = cleanMiperName(values.probableDamage)
  if (values.exposedFemale !== undefined) out.exposedFemale = values.exposedFemale
  if (values.exposedMale !== undefined) out.exposedMale = values.exposedMale
  if (values.exposedOther !== undefined) out.exposedOther = values.exposedOther
  if ("isRoutine" in values) out.isRoutine = values.isRoutine ?? null
  if ("probability" in values) out.probability = values.probability ?? null
  if ("consequence" in values) out.consequence = values.consequence ?? null
  if ("controlledStatus" in values) out.controlledStatus = values.controlledStatus ?? null
  if ("riskFactorId" in values) {
    if (values.riskFactorId) {
      const [factor] = await client.select({ isActive: preventionRiskFactors.isActive }).from(preventionRiskFactors).where(eq(preventionRiskFactors.id, values.riskFactorId)).limit(1)
      if (!factor || !factor.isActive) throw new RiskLegalDomainError("El factor de riesgo no existe o está desactivado en el catálogo.")
    }
    out.riskFactorId = values.riskFactorId ?? null
  }
  return out
}

export async function saveMiperEntry(input: unknown, access: MiperAccess): Promise<SavedEntry> {
  const data = miperEntrySaveSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const columns = await toColumns(tx, matrix.worksiteId, data.values)
    const now = nowIso()
    if (!data.entryId) {
      const [{ maxRow }] = await tx.select({ maxRow: sql<number>`coalesce(max(${preventionRiskEntries.rowNumber}), 0)::int` }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
      const after = Math.min(data.insertAfterRowNumber ?? maxRow, maxRow)
      if (after < maxRow) {
        await tx.update(preventionRiskEntries).set({ rowNumber: sql`${preventionRiskEntries.rowNumber} + 1` })
          .where(and(eq(preventionRiskEntries.matrixId, matrix.id), gt(preventionRiskEntries.rowNumber, after)))
      }
      const [created] = await tx.insert(preventionRiskEntries).values({
        id: `riskentry-${nanoid()}`, matrixId: matrix.id, rowNumber: after + 1, hazardCode: `R-${nanoid(8)}`, ...columns, createdAt: now, updatedAt: now,
      }).returning()
      await touchMatrix(tx, matrix.id, now)
      await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: created!.id, changeType: "entry_created", after: data.values, actorUserId: access.userId, actingAs: EDIT })
      return saved(created!)
    }
    const [current] = await tx.select().from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!current) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    if (current.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_ENTRY)
    const [updated] = await tx.update(preventionRiskEntries).set({ ...columns, version: current.version + 1, updatedAt: now })
      .where(and(eq(preventionRiskEntries.id, current.id), eq(preventionRiskEntries.version, current.version))).returning()
    if (!updated) throw new RiskLegalDomainError(STALE_ENTRY)
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: current.id, changeType: "entry_updated",
      before: Object.fromEntries(Object.keys(columns).map((key) => [key, current[key as keyof typeof current]])), after: columns,
      actorUserId: access.userId, actingAs: EDIT,
    })
    return saved(updated)
  })
}

const duplicateSchema = z.object({ matrixId: z.string().min(1), entryId: z.string().min(1) })

export async function duplicateMiperEntry(input: unknown, access: MiperAccess): Promise<SavedEntry> {
  const data = duplicateSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [source] = await tx.select().from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!source) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    const after = source.rowNumber ?? 0
    await tx.update(preventionRiskEntries).set({ rowNumber: sql`${preventionRiskEntries.rowNumber} + 1` })
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), gt(preventionRiskEntries.rowNumber, after)))
    const now = nowIso()
    const { magnitude: _m, classification: _c, ...copy } = source
    const [created] = await tx.insert(preventionRiskEntries).values({ ...copy, id: `riskentry-${nanoid()}`, rowNumber: after + 1, hazardCode: `R-${nanoid(8)}`, version: 1, createdAt: now, updatedAt: now }).returning()
    const controls = await tx.select().from(preventionRiskControls).where(eq(preventionRiskControls.riskEntryId, source.id)).orderBy(asc(preventionRiskControls.createdAt))
    if (controls.length > 0) {
      await tx.insert(preventionRiskControls).values(controls.map((control) => ({
        ...control, id: `riskcontrol-${nanoid()}`, riskEntryId: created!.id, status: "proposed", effectivenessStatus: "not_assessed",
        lastVerifiedAt: null, lastVerifiedByUserId: null, version: 1, createdAt: now, updatedAt: now,
      })))
    }
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: created!.id, changeType: "entry_duplicated", after: { sourceEntryId: source.id }, actorUserId: access.userId, actingAs: EDIT })
    return saved(created!)
  })
}

export async function deleteMiperEntry(input: unknown, access: MiperAccess) {
  const data = miperEntryRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [entry] = await tx.select().from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!entry) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    if (data.expectedVersion !== undefined && entry.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_ENTRY)
    const [marker] = await tx.select({ id: preventionRiskMapMarkers.id }).from(preventionRiskMapMarkers).where(eq(preventionRiskMapMarkers.riskEntryId, entry.id)).limit(1)
    if (marker) throw new RiskLegalDomainError("La fila está ubicada en el mapa de riesgos (CGRD): retira el marcador antes de eliminarla.")
    const controls = await tx.select().from(preventionRiskControls).where(eq(preventionRiskControls.riskEntryId, entry.id))
    if (await activePdtpLink(tx, controls.map((control) => control.id))) {
      throw new RiskLegalDomainError("Una medida de esta fila cubre una actividad del PDTP: retira ese vínculo de cobertura antes de eliminarla.")
    }
    await tx.delete(preventionRiskEntries).where(eq(preventionRiskEntries.id, entry.id))
    await tx.update(preventionRiskEntries).set({ rowNumber: sql`${preventionRiskEntries.rowNumber} - 1` })
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), gt(preventionRiskEntries.rowNumber, entry.rowNumber ?? 0)))
    const now = nowIso()
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: entry.id, changeType: "entry_deleted", before: { entry, controls }, actorUserId: access.userId, actingAs: EDIT })
  })
}

export async function saveMiperControl(input: unknown, access: MiperAccess) {
  const data = miperControlSaveSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [entry] = await tx.select({ id: preventionRiskEntries.id }).from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!entry) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    const responsibleUserId = data.values.responsibleUserId ?? null
    await assertActiveUsers(tx, [responsibleUserId])
    const responsibleSnapshot = responsibleUserId ? (await userNames(tx, [responsibleUserId])).get(responsibleUserId) ?? null : cleanMiperName(data.values.responsibleName)
    const values = { hierarchy: data.values.hierarchy, description: data.values.description, responsibleUserId, responsibleSnapshot, dueDate: data.values.dueDate ?? null }
    const now = nowIso()
    if (!data.controlId) {
      const [created] = await tx.insert(preventionRiskControls).values({ id: `riskcontrol-${nanoid()}`, riskEntryId: entry.id, ...values, status: "proposed", createdAt: now, updatedAt: now })
        .returning({ id: preventionRiskControls.id, version: preventionRiskControls.version })
      await touchMatrix(tx, matrix.id, now)
      await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: created!.id, changeType: "control_created", after: { entryId: entry.id, ...values }, actorUserId: access.userId, actingAs: EDIT })
      return created!
    }
    const [current] = await tx.select().from(preventionRiskControls).where(and(eq(preventionRiskControls.id, data.controlId), eq(preventionRiskControls.riskEntryId, entry.id))).limit(1)
    if (!current) throw new RiskLegalDomainError("La medida no existe en esta fila; recarga la matriz.")
    if (current.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_CONTROL)
    const [updated] = await tx.update(preventionRiskControls).set({ ...values, version: current.version + 1, updatedAt: now })
      .where(and(eq(preventionRiskControls.id, current.id), eq(preventionRiskControls.version, current.version)))
      .returning({ id: preventionRiskControls.id, version: preventionRiskControls.version })
    if (!updated) throw new RiskLegalDomainError(STALE_CONTROL)
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: current.id, changeType: "control_updated",
      before: { hierarchy: current.hierarchy, description: current.description, responsibleUserId: current.responsibleUserId, responsibleSnapshot: current.responsibleSnapshot, dueDate: current.dueDate },
      after: values, actorUserId: access.userId, actingAs: EDIT,
    })
    return updated
  })
}

export async function deleteMiperControl(input: unknown, access: MiperAccess) {
  const data = miperControlRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [row] = await tx.select({ control: preventionRiskControls }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .where(and(eq(preventionRiskControls.id, data.controlId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!row) throw new RiskLegalDomainError("La medida no existe en esta MIPER; recarga la matriz.")
    if (row.control.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_CONTROL)
    if (await activePdtpLink(tx, [row.control.id])) throw new RiskLegalDomainError("Esta medida cubre una actividad del PDTP: retira ese vínculo de cobertura antes de eliminarla.")
    await tx.delete(preventionRiskControls).where(eq(preventionRiskControls.id, row.control.id))
    const now = nowIso()
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: row.control.id, changeType: "control_deleted", before: row.control, actorUserId: access.userId, actingAs: EDIT })
  })
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:pglite -- lib/__tests__/miper-entries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/miper/entries.ts lib/__tests__/miper-entries.test.ts tests/pglite-files.ts
git commit -m "feat(miper): filas y medidas con concurrencia optimista, inserción, duplicado y borrado seguro"
```

---

#### Task 10: Foto viva y observaciones

**Files:**
- Create: `lib/services/miper/snapshots.ts`, `lib/services/miper/observations.ts`
- Test: `lib/__tests__/miper-snapshot-service.test.ts` (PGlite; registrarlo). Las observaciones se ejercitan en la Task 11.

**Interfaces:**
- Consumes: tipos de `snapshot.ts` (Task 3) y `shared.ts` (Task 7).
- Produces:
  - `buildMiperSnapshot(client, matrixId): Promise<MiperSnapshot>`
  - `snapshotSha(snapshot: MiperSnapshot): string`
  - `openRound(client, matrixId): Promise<typeof preventionRiskReviewRounds.$inferSelect | null>`
  - `addMiperObservation(input, access): Promise<{ id: string }>`
  - `respondMiperObservation(input, access): Promise<void>`
  - `resolveMiperObservation(input, access): Promise<void>`
  - `reopenMiperObservation(input, access): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/miper-snapshot-service.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry, saveMiperControl } = await import("@/lib/services/miper/entries")
const { buildMiperSnapshot, snapshotSha } = await import("@/lib/services/miper/snapshots")
const author = { userId: "u-s", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:edit"] }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: "ws-s", name: "Faena S", code: "S" })
  await testDb.insert(schema.users).values({ id: "u-s", name: "Autora", email: "s@s.cl", hashedPassword: "x", isActive: true })
}, 60_000)

describe("foto viva del MIPER", () => {
  it("lleva nombres de diccionario y factor, filas ordenadas y medidas", async () => {
    const { id } = await createMiper({ worksiteId: "ws-s", period: 2026, revisionReason: "Período para probar la foto." }, author)
    const a = await saveMiperEntry({ matrixId: id, values: { activity: "Carga", task: "Izaje", position: "Operador", location: "Patio", riskFactorId: "riskfactor-mecanico", hazard: "Carga suspendida", risk: "Golpe", probableDamage: "Fractura", probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true } }, author)
    await saveMiperEntry({ matrixId: id, values: { hazard: "Segunda" } }, author)
    await saveMiperControl({ matrixId: id, entryId: a.id, values: { hierarchy: "engineering", description: "Limitador de carga", responsibleName: "Mantención", dueDate: "2026-10-31" } }, author)
    const snapshot = await buildMiperSnapshot(testDb, id)
    expect(snapshot.header).toMatchObject({ period: 2026, worksiteName: "Faena S", iperCode: "RE-04" })
    expect(snapshot.entries.map((e) => e.rowNumber)).toEqual([1, 2])
    expect(snapshot.entries[0]).toMatchObject({ activity: "Carga", task: "Izaje", position: "Operador", location: "Patio", riskFactor: "Mecánico", magnitude: 8, classification: "important" })
    expect(snapshot.entries[0]!.controls).toEqual([expect.objectContaining({ description: "Limitador de carga", responsibleName: "Mantención", dueDate: "2026-10-31" })])
    expect(snapshotSha(snapshot)).toMatch(/^[a-f0-9]{64}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-snapshot-service.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write `snapshots.ts`**

```ts
// lib/services/miper/snapshots.ts
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskLocations, preventionRiskMatrices,
  preventionRiskPositions, preventionRiskProcesses, preventionRiskReviewRounds, preventionRiskTasks,
} from "@/db/schema"
import type { RiskClassification } from "@/lib/prevention/miper/methodology"
import type { ControlHierarchy, ControlledStatus, MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { type Client, sha256 } from "./shared"

export function snapshotSha(snapshot: MiperSnapshot) {
  return sha256(snapshot)
}

export async function buildMiperSnapshot(client: Client, matrixId: string): Promise<MiperSnapshot> {
  const [matrix] = await client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!matrix) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const rows = await client.select({
    entry: preventionRiskEntries,
    activity: preventionRiskProcesses.name,
    task: preventionRiskTasks.name,
    position: preventionRiskPositions.name,
    location: preventionRiskLocations.name,
    riskFactor: preventionRiskFactors.name,
  }).from(preventionRiskEntries)
    .leftJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId))
    .leftJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId))
    .leftJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId))
    .leftJoin(preventionRiskLocations, eq(preventionRiskLocations.id, preventionRiskEntries.locationId))
    .leftJoin(preventionRiskFactors, eq(preventionRiskFactors.id, preventionRiskEntries.riskFactorId))
    .where(eq(preventionRiskEntries.matrixId, matrixId))
    .orderBy(asc(preventionRiskEntries.rowNumber), asc(preventionRiskEntries.createdAt))
  const controls = rows.length === 0 ? [] : await client.select().from(preventionRiskControls)
    .where(inArray(preventionRiskControls.riskEntryId, rows.map((row) => row.entry.id)))
    .orderBy(asc(preventionRiskControls.createdAt))
  const controlsByEntry = new Map<string, typeof controls>()
  for (const control of controls) controlsByEntry.set(control.riskEntryId, [...(controlsByEntry.get(control.riskEntryId) ?? []), control])
  return {
    header: {
      period: matrix.period, iperCode: matrix.iperCode, elaboratedOn: matrix.elaboratedOn, updatedOn: matrix.updatedOn,
      companyName: matrix.companyName, companyRut: matrix.companyRut, companyAddress: matrix.companyAddress, companyCommune: matrix.companyCommune,
      economicActivity: matrix.economicActivity, adherentNumber: matrix.adherentNumber, worksiteName: matrix.worksiteName,
      siteRepresentativeUserId: matrix.siteRepresentativeUserId, siteRepresentativeName: matrix.siteRepresentativeName,
      headcountTotal: matrix.headcountTotal, headcountMale: matrix.headcountMale, headcountFemale: matrix.headcountFemale, headcountOther: matrix.headcountOther,
      participationSummary: matrix.participationSummary, consultationEvidenceReference: matrix.consultationEvidenceReference,
    },
    entries: rows.map(({ entry, activity, task, position, location, riskFactor }, index) => ({
      id: entry.id,
      rowNumber: entry.rowNumber ?? index + 1,
      activity, task, position, location,
      exposedFemale: entry.exposedFemale, exposedMale: entry.exposedMale, exposedOther: entry.exposedOther,
      riskFactorId: entry.riskFactorId, riskFactor,
      isRoutine: entry.isRoutine,
      hazard: entry.hazard, risk: entry.risk, probableDamage: entry.probableDamage,
      probability: entry.probability, consequence: entry.consequence, magnitude: entry.magnitude,
      classification: entry.classification as RiskClassification | null,
      controlledStatus: entry.controlledStatus as ControlledStatus | null,
      controls: (controlsByEntry.get(entry.id) ?? []).map((control) => ({
        id: control.id, hierarchy: control.hierarchy as ControlHierarchy, description: control.description,
        responsibleUserId: control.responsibleUserId, responsibleName: control.responsibleSnapshot, dueDate: control.dueDate, status: control.status,
      })),
    })),
  }
}

export async function openRound(client: Client, matrixId: string) {
  const [round] = await client.select().from(preventionRiskReviewRounds)
    .where(and(eq(preventionRiskReviewRounds.matrixId, matrixId), isNull(preventionRiskReviewRounds.decision))).limit(1)
  return round ?? null
}
```

- [ ] **Step 4: Write `observations.ts`**

```ts
// lib/services/miper/observations.ts
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { preventionRiskEntries, preventionRiskObservations } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { REVIEW_STAGE_FOR_STATE, STAGE_PERMISSION, type MiperReviewState, type ReviewStage } from "@/lib/prevention/miper/states"
import { miperObservationRefSchema, miperObservationResponseSchema, miperObservationSchema } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { openRound } from "./snapshots"
import { type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess } from "./shared"

/** Observar sólo mientras hay una ronda abierta, y sólo quien revisa esa etapa. */
export async function addMiperObservation(input: unknown, access: MiperAccess) {
  const data = miperObservationSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    const stage = REVIEW_STAGE_FOR_STATE[matrix.reviewState as MiperReviewState]
    if (!stage) throw new RiskLegalDomainError("Sólo se observa una MIPER que está en revisión técnica o pendiente de aprobación.")
    requireAccess(access, STAGE_PERMISSION[stage], matrix.worksiteId)
    const round = await openRound(tx, matrix.id)
    if (!round || round.stage !== stage) throw new RiskLegalDomainError("No hay una ronda de revisión abierta; recarga la MIPER.")
    let entryLabel: string | null = null
    if (data.entryId) {
      const [entry] = await tx.select({ rowNumber: preventionRiskEntries.rowNumber, hazard: preventionRiskEntries.hazard }).from(preventionRiskEntries)
        .where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
      if (!entry) throw new RiskLegalDomainError("La fila observada no existe en esta MIPER.")
      entryLabel = `Riesgo #${entry.rowNumber ?? "?"} · ${entry.hazard ?? "sin peligro descrito"}`
    }
    const id = `riskobs-${nanoid()}`
    await tx.insert(preventionRiskObservations).values({ id, matrixId: matrix.id, entryId: data.entryId ?? null, entryLabel, roundId: round.id, stage, authorUserId: access.userId, body: data.body })
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "observation", objectId: id, changeType: "observation_created", reason: data.body, after: { entryId: data.entryId ?? null, stage }, actorUserId: access.userId, actingAs: STAGE_PERMISSION[stage] })
    return { id }
  })
}

async function loadObservation(tx: Client, observationId: string) {
  const [observation] = await tx.select().from(preventionRiskObservations).where(eq(preventionRiskObservations.id, observationId)).limit(1)
  if (!observation) throw new RiskLegalDomainError("Observación no encontrada.")
  const matrix = await lockMatrix(tx, observation.matrixId)
  return { observation, matrix, permission: STAGE_PERMISSION[observation.stage as ReviewStage] }
}

/** Responde el prevencionista, una vez devuelta la MIPER. */
export async function respondMiperObservation(input: unknown, access: MiperAccess) {
  const data = miperObservationResponseSchema.parse(input)
  await db.transaction(async (tx) => {
    const { observation, matrix } = await loadObservation(tx, data.observationId)
    requireAccess(access, "prevention:risk:edit", matrix.worksiteId)
    if (matrix.reviewState !== "observed") throw new RiskLegalDomainError("Se responde una observación cuando la MIPER fue devuelta con observaciones.")
    if (observation.status !== "open") throw new RiskLegalDomainError("Esta observación ya fue respondida.")
    await tx.update(preventionRiskObservations).set({ status: "answered", response: data.response, respondedByUserId: access.userId, respondedAt: nowIso() }).where(eq(preventionRiskObservations.id, observation.id))
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "observation", objectId: observation.id, changeType: "observation_answered", reason: data.response, actorUserId: access.userId, actingAs: "prevention:risk:edit" })
  })
}

/** Quien revisa la etapa da por resuelta una respuesta. */
export async function resolveMiperObservation(input: unknown, access: MiperAccess) {
  const data = miperObservationRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const { observation, matrix, permission } = await loadObservation(tx, data.observationId)
    requireAccess(access, permission, matrix.worksiteId)
    if (observation.status !== "answered") throw new RiskLegalDomainError("Sólo se resuelve una observación respondida.")
    await tx.update(preventionRiskObservations).set({ status: "resolved", resolvedByUserId: access.userId, resolvedAt: nowIso() }).where(eq(preventionRiskObservations.id, observation.id))
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "observation", objectId: observation.id, changeType: "observation_resolved", actorUserId: access.userId, actingAs: permission })
  })
}

/** ...o la reabre si la respuesta no basta, durante la revisión de su etapa. */
export async function reopenMiperObservation(input: unknown, access: MiperAccess) {
  const data = miperObservationRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const { observation, matrix, permission } = await loadObservation(tx, data.observationId)
    requireAccess(access, permission, matrix.worksiteId)
    if (observation.status !== "answered") throw new RiskLegalDomainError("Sólo se reabre una observación respondida.")
    if (REVIEW_STAGE_FOR_STATE[matrix.reviewState as MiperReviewState] !== observation.stage) throw new RiskLegalDomainError("La observación se reabre durante la revisión de su etapa.")
    await tx.update(preventionRiskObservations).set({ status: "open" }).where(eq(preventionRiskObservations.id, observation.id))
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "observation", objectId: observation.id, changeType: "observation_reopened", actorUserId: access.userId, actingAs: permission })
  })
}
```

- [ ] **Step 5: Run test and commit**

Run: `npm run test:pglite -- lib/__tests__/miper-snapshot-service.test.ts`
Expected: PASS.

```bash
git add lib/services/miper/snapshots.ts lib/services/miper/observations.ts lib/__tests__/miper-snapshot-service.test.ts tests/pglite-files.ts
git commit -m "feat(miper): foto viva del documento y observaciones por fila"
```

---

#### Task 11: Flujo de revisión y sellado de versiones

**Files:**
- Create: `lib/services/miper/workflow.ts`
- Modify: `lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts:485-527` (`sourceId` por versión)
- Test: `lib/__tests__/miper-workflow.test.ts` (PGlite; registrarlo)

**Interfaces:**
- Consumes:
  - `MIPER_ACTION_RULES`, `REVIEW_STATE_LABEL` y `checkMiperCompleteness` (Task 4); `diffSnapshots` (Task 3).
  - `buildMiperSnapshot`, `snapshotSha` y `openRound` (Task 10); observaciones (Task 10).
  - Existentes: `createRiskReviewTriggerWithClient` (`prevention-risk-legal.ts`), `onRiskMatrixPublished`, `enqueueGeneratedDocumentTx` y `resolveOwnWorkSigning`.
- Produces:
  - `submitMiperForReview(input, access): Promise<{ roundId: string }>`
  - `openMiperReviewRound(input: { matrixId: string }, access): Promise<void>`
  - `returnMiperWithObservations(input, access): Promise<void>`
  - `approveMiperTechnicalReview(input, access): Promise<void>`
  - `requestMiperCorrections(input, access): Promise<void>`
  - `approveMiperFinal(input, access): Promise<{ versionId: string; versionNumber: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/miper-workflow.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
// El conector PDTP escribe con su propia conexión: acá sólo interesa que se llame.
const accredit = vi.fn()
vi.mock("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors", () => ({ onRiskMatrixPublished: (...args: unknown[]) => accredit(...args) }))

const { createMiper, updateMiperHeader } = await import("@/lib/services/miper/matrices")
const entries = await import("@/lib/services/miper/entries")
const obs = await import("@/lib/services/miper/observations")
const wf = await import("@/lib/services/miper/workflow")

const WS = "ws-w"
const scope = { mode: "some" as const, ids: [WS] }
const all = { mode: "all" as const, ids: [] as [] }
const author = { userId: "u-prev", scope, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-jefa", scope: all, permissions: ["prevention:risk:view", "prevention:risk:review", "prevention:risk:edit"] }
const legal = { userId: "u-legal", scope: all, permissions: ["prevention:risk:view", "prevention:risk:approve_legal"] }
const matrixRow = async (id: string) => (await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, id)))[0]!

async function completeMatrix(period: number) {
  const { id } = await createMiper({ worksiteId: WS, period, revisionReason: "Elaboración para probar el flujo." }, author)
  const m = await matrixRow(id)
  await updateMiperHeader({
    matrixId: id, expectedVersion: m.version, iperCode: "RE-04", elaboratedOn: `${period}-01-10`, updatedOn: null,
    companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero", economicActivity: "Transporte",
    adherentNumber: null, worksiteName: "Faena W", siteRepresentativeUserId: null, siteRepresentativeName: "Juan Pérez",
    headcountTotal: 5, headcountMale: 4, headcountFemale: 1, headcountOther: 0, participationSummary: "", consultationEvidenceReference: "",
  }, author)
  const e = await entries.saveMiperEntry({ matrixId: id, values: { activity: "Transporte", task: "Descarga", position: "Conductor", riskFactorId: "riskfactor-mecanico", hazard: "Camión en pendiente", risk: "Volcamiento", probableDamage: "Politraumatismo", probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true } }, author)
  await entries.saveMiperControl({ matrixId: id, entryId: e.id, values: { hierarchy: "administrative", description: "Procedimiento de descarga en pendiente", responsibleName: "Supervisor", dueDate: `${period}-06-30` } }, author)
  return { id, entryId: e.id }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena W", code: "W" })
  await testDb.insert(schema.users).values([
    { id: "u-prev", name: "Prevencionista", email: "p@w.cl", hashedPassword: "x", isActive: true },
    { id: "u-jefa", name: "Jefa Prevención", email: "j@w.cl", hashedPassword: "x", isActive: true },
    { id: "u-legal", name: "Gerencia Legal y RRHH", email: "l@w.cl", hashedPassword: "x", isActive: true },
  ])
}, 60_000)

describe("flujo MIPER de extremo a extremo (servicio)", () => {
  it("envío → observación por fila → corrección → reenvío → aprobación técnica → Legal y RRHH → v1 vigente", async () => {
    const { id, entryId } = await completeMatrix(2026)
    let m = await matrixRow(id)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)
    expect(m.reviewState).toBe("in_review")

    // La autora no puede revisar su propio envío aunque tenga el permiso.
    await expect(wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, { ...author, permissions: [...author.permissions, "prevention:risk:review"] })).rejects.toThrow(/Quien envió la MIPER no puede revisarla/)
    // Devolver sin observaciones no se puede.
    await expect(wf.returnMiperWithObservations({ matrixId: id, expectedVersion: m.version, comment: "Faltan ajustes en la evaluación." }, jefa)).rejects.toThrow(/al menos una observación/)

    const { id: obsId } = await obs.addMiperObservation({ matrixId: id, entryId, body: "Revisar consecuencia: el daño probable indica severidad alta." }, jefa)
    await wf.returnMiperWithObservations({ matrixId: id, expectedVersion: m.version, comment: "Revisar la consecuencia del riesgo #1." }, jefa)
    m = await matrixRow(id)
    expect(m.reviewState).toBe("observed")

    // Reenviar sin responder no se puede.
    await expect(wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)).rejects.toThrow(/Responde todas las observaciones/)
    const [row] = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, entryId))
    await entries.saveMiperEntry({ matrixId: id, entryId, expectedVersion: row!.version, values: { consequence: 4, probability: 4 } }, author) // → Intolerable
    await obs.respondMiperObservation({ observationId: obsId, response: "Se reevaluó: probabilidad alta, queda Intolerable." }, author)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)

    // La foto de la ronda es la que revisa la Jefa; editar después no la altera.
    const [editedAfter] = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, entryId))
    await entries.saveMiperEntry({ matrixId: id, entryId, expectedVersion: editedAfter!.version, values: { risk: "Volcamiento editado durante la revisión" } }, author)

    await wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, jefa)
    m = await matrixRow(id)
    expect(m.reviewState).toBe("pending_approval")
    const [resolved] = await testDb.select().from(schema.preventionRiskObservations).where(eq(schema.preventionRiskObservations.id, obsId))
    expect(resolved!.status).toBe("resolved")

    // La revisora técnica no firma también como Legal y RRHH.
    await expect(wf.approveMiperFinal({ matrixId: id, expectedVersion: m.version, changeSummary: "Emisión inicial del documento." }, { ...jefa, permissions: [...jefa.permissions, "prevention:risk:approve_legal"] })).rejects.toThrow(/revisión técnica no puede firmar/)
    const { versionNumber } = await wf.approveMiperFinal({ matrixId: id, expectedVersion: m.version, changeSummary: "Emisión inicial del documento." }, legal)
    expect(versionNumber).toBe(1)
    m = await matrixRow(id)
    expect(m).toMatchObject({ status: "published", reviewState: "none", reviewedByUserId: "u-jefa", approvedByUserId: "u-legal" })
    const [version] = await testDb.select().from(schema.preventionRiskMatrixVersions).where(eq(schema.preventionRiskMatrixVersions.matrixId, id))
    const sealed = version!.snapshot as { entries: Array<{ risk: string; classification: string }> }
    expect(sealed.entries[0]).toMatchObject({ risk: "Volcamiento", classification: "intolerable" })
    expect(accredit).toHaveBeenCalledWith(expect.objectContaining({ matrixId: id, matrixVersion: 1 }))
    const clocks = await testDb.select().from(schema.preventionPdtpUpdateObligations).where(eq(schema.preventionPdtpUpdateObligations.sourceId, id))
    expect(clocks).toHaveLength(1)
  })

  it("un MIPER vigente se modifica al instante y el cambio sella la v2; sin cambios no se envía", async () => {
    const [vigente] = await testDb.select().from(schema.preventionRiskMatrices).where(and(eq(schema.preventionRiskMatrices.worksiteId, WS), eq(schema.preventionRiskMatrices.status, "published")))
    const id = vigente!.id
    let m = await matrixRow(id)
    // La edición hecha durante la revisión anterior quedó pendiente: ese cambio SÍ permite enviar.
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)
    await wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, jefa)
    m = await matrixRow(id)
    const { versionNumber } = await wf.approveMiperFinal({ matrixId: id, expectedVersion: m.version, changeSummary: "Actualización del riesgo #1." }, legal)
    expect(versionNumber).toBe(2)
    m = await matrixRow(id)
    await expect(wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)).rejects.toThrow(/No hay cambios respecto de la versión vigente v2/)
    const versions = await testDb.select().from(schema.preventionRiskMatrixVersions).where(eq(schema.preventionRiskMatrixVersions.matrixId, id))
    expect(versions.map((v) => v.versionNumber).sort()).toEqual([1, 2])
  })

  it("aprobar el MIPER del período siguiente reemplaza al vigente", async () => {
    const { id } = await completeMatrix(2027)
    let m = await matrixRow(id)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)
    await wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, jefa)
    m = await matrixRow(id)
    await wf.approveMiperFinal({ matrixId: id, expectedVersion: m.version, changeSummary: "Emisión del período 2027." }, legal)
    const published = await testDb.select().from(schema.preventionRiskMatrices).where(and(eq(schema.preventionRiskMatrices.worksiteId, WS), eq(schema.preventionRiskMatrices.status, "published")))
    expect(published.map((row) => row.id)).toEqual([id])
  })

  it("Legal y RRHH puede devolver: vuelve a observada y el reenvío pasa otra vez por la Jefa", async () => {
    const { id, entryId } = await completeMatrix(2029)
    let m = await matrixRow(id)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    m = await matrixRow(id)
    await wf.approveMiperTechnicalReview({ matrixId: id, expectedVersion: m.version }, jefa)
    m = await matrixRow(id)
    await obs.addMiperObservation({ matrixId: id, entryId, body: "Falta identificar al responsable del procedimiento." }, legal)
    await wf.requestMiperCorrections({ matrixId: id, expectedVersion: m.version, comment: "Completar responsables antes de aprobar." }, legal)
    m = await matrixRow(id)
    expect(m.reviewState).toBe("observed")
    const [o] = await testDb.select().from(schema.preventionRiskObservations).where(and(eq(schema.preventionRiskObservations.matrixId, id), eq(schema.preventionRiskObservations.stage, "legal_rrhh")))
    await obs.respondMiperObservation({ observationId: o!.id, response: "Responsable asignado: supervisor de turno." }, author)
    await wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)
    expect((await matrixRow(id)).reviewState).toBe("in_review")
  })

  it("el envío exige completitud RE-04", async () => {
    const { id } = await createMiper({ worksiteId: WS, period: 2032, revisionReason: "Borrador incompleto para probar el envío." }, author)
    await entries.saveMiperEntry({ matrixId: id, values: { hazard: "Incompleto" } }, author)
    const m = await matrixRow(id)
    await expect(wf.submitMiperForReview({ matrixId: id, expectedVersion: m.version }, author)).rejects.toThrow(/No se puede enviar a revisión/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-workflow.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/miper/workflow.ts
import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionPdtpUpdateObligations, preventionRiskEntries, preventionRiskMatrices, preventionRiskMatrixVersions,
  preventionRiskObservations, preventionRiskReviewRounds,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { checkMiperCompleteness } from "@/lib/prevention/miper/completeness"
import { diffSnapshots, type MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { MIPER_ACTION_RULES, REVIEW_STATE_LABEL, type MiperReviewState, type MiperWorkflowAction } from "@/lib/prevention/miper/states"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"
import { onRiskMatrixPublished } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { createRiskReviewTriggerWithClient } from "@/lib/services/prevention-risk-legal"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { resolveOwnWorkSigning } from "@/lib/services/prevention-signing"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { miperApproveFinalSchema, miperCommentedDecisionSchema, miperWorkflowSchema } from "@/lib/validation/prevention-module/miper"
import { buildMiperSnapshot, openRound, snapshotSha } from "./snapshots"
import { type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess, userNames } from "./shared"

type Matrix = typeof preventionRiskMatrices.$inferSelect
const STALE = "La MIPER cambió mientras la revisabas. Recarga antes de continuar."

async function loadForAction(client: Client, matrixId: string, action: MiperWorkflowAction, access: MiperAccess, expectedVersion: number) {
  const matrix = await lockMatrix(client, matrixId)
  const rule = MIPER_ACTION_RULES[action]
  requireAccess(access, rule.permission, matrix.worksiteId)
  if (matrix.isLegacy || matrix.status === "superseded") throw new RiskLegalDomainError("Esta MIPER no admite cambios de flujo (reemplazada o de la metodología anterior).")
  if (!rule.from.includes(matrix.reviewState as MiperReviewState)) {
    throw new RiskLegalDomainError(`No se puede «${rule.label}» una MIPER en estado «${REVIEW_STATE_LABEL[matrix.reviewState as MiperReviewState] ?? matrix.reviewState}»; recarga para ver su estado actual.`)
  }
  if (matrix.version !== expectedVersion) throw new RiskLegalDomainError(STALE)
  return matrix
}

async function setReviewState(client: Client, matrix: Matrix, reviewState: MiperReviewState, now: string, extra: Partial<typeof preventionRiskMatrices.$inferInsert> = {}) {
  const [updated] = await client.update(preventionRiskMatrices).set({ reviewState, version: matrix.version + 1, updatedAt: now, ...extra })
    .where(and(eq(preventionRiskMatrices.id, matrix.id), eq(preventionRiskMatrices.version, matrix.version))).returning()
  if (!updated) throw new RiskLegalDomainError(STALE)
  return updated
}

async function nextRoundNumber(client: Client, matrixId: string) {
  const [{ max }] = await client.select({ max: sql<number>`coalesce(max(${preventionRiskReviewRounds.roundNumber}), 0)::int` }).from(preventionRiskReviewRounds).where(eq(preventionRiskReviewRounds.matrixId, matrixId))
  return max + 1
}

async function latestVersion(client: Client, matrixId: string) {
  const [version] = await client.select().from(preventionRiskMatrixVersions).where(eq(preventionRiskMatrixVersions.matrixId, matrixId)).orderBy(desc(preventionRiskMatrixVersions.versionNumber)).limit(1)
  return version ?? null
}

async function countObservations(client: Client, where: SQL | undefined) {
  const [{ count }] = await client.select({ count: sql<number>`count(*)::int` }).from(preventionRiskObservations).where(where)
  return count
}

function assertNotSubmitter(access: MiperAccess, submittedByUserId: string, message: string) {
  if (access.userId === submittedByUserId) throw new RiskLegalDomainError(message)
}

/** Al aprobar, lo respondido y no reabierto queda resuelto por quien aprueba. */
async function autoResolveAnswered(client: Client, matrixId: string, userId: string, now: string) {
  await client.update(preventionRiskObservations).set({ status: "resolved", resolvedByUserId: userId, resolvedAt: now })
    .where(and(eq(preventionRiskObservations.matrixId, matrixId), eq(preventionRiskObservations.status, "answered")))
}

export async function submitMiperForReview(input: unknown, access: MiperAccess) {
  const data = miperWorkflowSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "submit", access, data.expectedVersion)
    const snapshot = await buildMiperSnapshot(tx, matrix.id)
    const blocking = checkMiperCompleteness(snapshot).filter((issue) => issue.severity === "error")
    if (blocking.length > 0) {
      throw new RiskLegalDomainError(`No se puede enviar a revisión: hay ${blocking.length} pendiente(s). ${blocking.slice(0, 3).map((issue) => issue.message).join(" ")}`)
    }
    if (matrix.reviewState === "observed") {
      const open = await countObservations(tx, and(eq(preventionRiskObservations.matrixId, matrix.id), eq(preventionRiskObservations.status, "open")))
      if (open > 0) throw new RiskLegalDomainError(`Responde todas las observaciones antes de reenviar (${open} sin responder).`)
    }
    if (matrix.status === "published" && matrix.reviewState === "none") {
      const last = await latestVersion(tx, matrix.id)
      if (last && !diffSnapshots(last.snapshot as MiperSnapshot, snapshot).hasChanges) {
        throw new RiskLegalDomainError(`No hay cambios respecto de la versión vigente v${last.versionNumber}.`)
      }
    }
    const now = nowIso()
    const roundId = `riskround-${nanoid()}`
    await tx.insert(preventionRiskReviewRounds).values({
      id: roundId, matrixId: matrix.id, roundNumber: await nextRoundNumber(tx, matrix.id), stage: "technical",
      snapshot, snapshotSha256: snapshotSha(snapshot), submittedByUserId: access.userId, submittedAt: now,
    })
    await setReviewState(tx, matrix, "in_review", now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: roundId, changeType: "submitted", reason: data.comment ?? null, after: { entryCount: snapshot.entries.length }, actorUserId: access.userId, actingAs: "prevention:risk:edit" })
    return { roundId }
  })
}

/** Marca que la revisora abrió la ronda: distingue "Enviado" de "En revisión". */
export async function openMiperReviewRound(input: { matrixId: string }, access: MiperAccess) {
  await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, input.matrixId)
    const round = await openRound(tx, matrix.id)
    if (!round || round.openedAt) return
    const permission = round.stage === "technical" ? "prevention:risk:review" : "prevention:risk:approve_legal"
    if (!access.permissions.includes(permission) || access.userId === round.submittedByUserId) return
    requireAccess(access, permission, matrix.worksiteId)
    await tx.update(preventionRiskReviewRounds).set({ openedAt: nowIso(), openedByUserId: access.userId }).where(eq(preventionRiskReviewRounds.id, round.id))
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: round.id, changeType: "opened", actorUserId: access.userId, actingAs: permission })
  })
}

export async function returnMiperWithObservations(input: unknown, access: MiperAccess) {
  const data = miperCommentedDecisionSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "return", access, data.expectedVersion)
    const round = await openRound(tx, matrix.id)
    if (!round || round.stage !== "technical") throw new RiskLegalDomainError("No hay una ronda de revisión técnica abierta; recarga la MIPER.")
    assertNotSubmitter(access, round.submittedByUserId, "Quien envió la MIPER no puede revisarla.")
    const open = await countObservations(tx, and(eq(preventionRiskObservations.roundId, round.id), eq(preventionRiskObservations.status, "open")))
    if (open === 0) throw new RiskLegalDomainError("Registra al menos una observación antes de devolver la MIPER.")
    const now = nowIso()
    await tx.update(preventionRiskReviewRounds).set({ decision: "observed", decidedByUserId: access.userId, decidedAt: now, decisionComment: data.comment }).where(eq(preventionRiskReviewRounds.id, round.id))
    await setReviewState(tx, matrix, "observed", now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: round.id, changeType: "returned", reason: data.comment, after: { openObservations: open }, actorUserId: access.userId, actingAs: "prevention:risk:review" })
  })
}

export async function approveMiperTechnicalReview(input: unknown, access: MiperAccess) {
  const data = miperWorkflowSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "approve_technical", access, data.expectedVersion)
    const round = await openRound(tx, matrix.id)
    if (!round || round.stage !== "technical") throw new RiskLegalDomainError("No hay una ronda de revisión técnica abierta; recarga la MIPER.")
    assertNotSubmitter(access, round.submittedByUserId, "Quien envió la MIPER no puede revisarla.")
    const open = await countObservations(tx, and(eq(preventionRiskObservations.matrixId, matrix.id), eq(preventionRiskObservations.status, "open")))
    if (open > 0) throw new RiskLegalDomainError(`Hay ${open} observación(es) abierta(s): devuelve la MIPER o resuélvelas antes de aprobar.`)
    const now = nowIso()
    await autoResolveAnswered(tx, matrix.id, access.userId, now)
    await tx.update(preventionRiskReviewRounds).set({ decision: "approved", decidedByUserId: access.userId, decidedAt: now, decisionComment: data.comment ?? null }).where(eq(preventionRiskReviewRounds.id, round.id))
    await tx.insert(preventionRiskReviewRounds).values({
      id: `riskround-${nanoid()}`, matrixId: matrix.id, roundNumber: await nextRoundNumber(tx, matrix.id), stage: "legal_rrhh",
      snapshot: round.snapshot, snapshotSha256: round.snapshotSha256, submittedByUserId: round.submittedByUserId, submittedAt: now,
    })
    await setReviewState(tx, matrix, "pending_approval", now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: round.id, changeType: "technical_approved", reason: data.comment ?? null, actorUserId: access.userId, actingAs: "prevention:risk:review" })
  })
}

export async function requestMiperCorrections(input: unknown, access: MiperAccess) {
  const data = miperCommentedDecisionSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "request_corrections", access, data.expectedVersion)
    const round = await openRound(tx, matrix.id)
    if (!round || round.stage !== "legal_rrhh") throw new RiskLegalDomainError("No hay una aprobación Legal y RRHH pendiente; recarga la MIPER.")
    assertNotSubmitter(access, round.submittedByUserId, "Quien elaboró la MIPER no puede aprobarla.")
    const open = await countObservations(tx, and(eq(preventionRiskObservations.roundId, round.id), eq(preventionRiskObservations.status, "open")))
    if (open === 0) throw new RiskLegalDomainError("Registra al menos una observación antes de solicitar correcciones.")
    const now = nowIso()
    await tx.update(preventionRiskReviewRounds).set({ decision: "observed", decidedByUserId: access.userId, decidedAt: now, decisionComment: data.comment }).where(eq(preventionRiskReviewRounds.id, round.id))
    await setReviewState(tx, matrix, "observed", now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: round.id, changeType: "corrections_requested", reason: data.comment, actorUserId: access.userId, actingAs: "prevention:risk:approve_legal" })
  })
}

export async function approveMiperFinal(input: unknown, access: MiperAccess) {
  const data = miperApproveFinalSchema.parse(input)
  let accreditation: Parameters<typeof onRiskMatrixPublished>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "approve_final", access, data.expectedVersion)
    const legalRound = await openRound(tx, matrix.id)
    if (!legalRound || legalRound.stage !== "legal_rrhh") throw new RiskLegalDomainError("No hay una aprobación Legal y RRHH pendiente; recarga la MIPER.")
    const [technicalRound] = await tx.select().from(preventionRiskReviewRounds).where(and(
      eq(preventionRiskReviewRounds.matrixId, matrix.id), eq(preventionRiskReviewRounds.stage, "technical"), eq(preventionRiskReviewRounds.decision, "approved"),
    )).orderBy(desc(preventionRiskReviewRounds.roundNumber)).limit(1)
    if (!technicalRound?.decidedByUserId) throw new RiskLegalDomainError("Falta la revisión técnica aprobada de esta MIPER.")
    assertNotSubmitter(access, legalRound.submittedByUserId, "Quien elaboró la MIPER no puede aprobarla.")
    const signing = resolveOwnWorkSigning({ signedByUserId: technicalRound.decidedByUserId, actorUserId: access.userId, permissions: access.permissions, what: "Aprobar la MIPER como Legal y RRHH" })
    if (!signing.ok) throw new RiskLegalDomainError("Quien hizo la revisión técnica no puede firmar la aprobación Legal y RRHH: debe firmarla otra persona.")
    const open = await countObservations(tx, and(eq(preventionRiskObservations.matrixId, matrix.id), eq(preventionRiskObservations.status, "open")))
    if (open > 0) throw new RiskLegalDomainError(`Hay ${open} observación(es) abierta(s): solicita correcciones o resuélvelas antes de aprobar.`)

    const now = nowIso()
    await autoResolveAnswered(tx, matrix.id, access.userId, now)
    await tx.update(preventionRiskReviewRounds).set({ decision: "approved", decidedByUserId: access.userId, decidedAt: now, decisionComment: data.comment ?? null }).where(eq(preventionRiskReviewRounds.id, legalRound.id))

    const previous = await latestVersion(tx, matrix.id)
    const versionNumber = (previous?.versionNumber ?? 0) + 1
    const names = await userNames(tx, [legalRound.submittedByUserId, technicalRound.decidedByUserId, access.userId])
    const versionId = `riskversion-${nanoid()}`
    await tx.insert(preventionRiskMatrixVersions).values({
      id: versionId, matrixId: matrix.id, versionNumber, period: matrix.period, roundId: legalRound.id,
      snapshot: legalRound.snapshot, snapshotSha256: legalRound.snapshotSha256, changeSummary: data.changeSummary,
      elaboratedByUserId: legalRound.submittedByUserId, technicalReviewerUserId: technicalRound.decidedByUserId, approverUserId: access.userId,
      elaboratedByName: names.get(legalRound.submittedByUserId) ?? legalRound.submittedByUserId,
      technicalReviewerName: names.get(technicalRound.decidedByUserId) ?? technicalRound.decidedByUserId,
      approverName: names.get(access.userId) ?? access.userId,
      approvedAt: now,
    })

    const firstSeal = matrix.status === "draft"
    if (firstSeal) {
      // El período nuevo reemplaza al vigente de la faena. Antes del UPDATE de
      // esta matriz: el índice parcial admite un solo `published` por faena.
      const vigentes = await tx.select().from(preventionRiskMatrices).where(and(
        eq(preventionRiskMatrices.worksiteId, matrix.worksiteId), eq(preventionRiskMatrices.status, "published"), ne(preventionRiskMatrices.id, matrix.id),
      ))
      for (const vigente of vigentes) {
        await tx.update(preventionRiskMatrices).set({ status: "superseded", reviewState: "none", version: vigente.version + 1, updatedAt: now }).where(eq(preventionRiskMatrices.id, vigente.id))
        await miperHistory(tx, { matrixId: vigente.id, worksiteId: vigente.worksiteId, object: "matrix", objectId: vigente.id, changeType: "superseded", reason: `Reemplazada por la MIPER del período ${matrix.period}.`, after: { supersededByMatrixId: matrix.id }, actorUserId: access.userId, actingAs: "prevention:risk:approve_legal" })
      }
    }
    const effectiveFrom = matrix.effectiveFrom ?? todayInChile()
    const reviewDueAt = matrix.reviewDueAt ?? addDaysToPlainDate(effectiveFrom, 365)
    await setReviewState(tx, matrix, "none", now, {
      status: "published",
      reviewedByUserId: technicalRound.decidedByUserId, reviewedAt: technicalRound.decidedAt,
      approvedByUserId: access.userId, approvedAt: now,
      publishedByUserId: access.userId, publishedAt: now, publishedHashSha256: legalRound.snapshotSha256,
      effectiveFrom, reviewDueAt,
    })

    if (firstSeal) {
      await createRiskReviewTriggerWithClient(tx, {
        worksiteId: matrix.worksiteId, matrixId: matrix.id, triggerType: "annual", sourceType: "risk_matrix", sourceId: matrix.id,
        description: `Revisión anual de la MIPER del período ${matrix.period}.`, dueAt: reviewDueAt, idempotencyKey: `miper:annual:${matrix.id}`,
      }, access.userId)
    }
    // Cada versión sellada abre su propio reloj de 30 días para actualizar el PDTP (DS 44).
    await tx.insert(preventionPdtpUpdateObligations).values({
      id: `pdtpob-${nanoid()}`,
      idempotencyKey: `miper:pdtp30:${matrix.id}:v${versionNumber}`,
      worksiteId: matrix.worksiteId,
      sourceType: "risk_matrix",
      sourceId: matrix.id,
      sourceVersionSnapshot: `MIPER ${matrix.period} v${versionNumber} · ${legalRound.snapshotSha256}`,
      dueAt: addDaysToPlainDate(todayInChile(), 30),
    }).onConflictDoNothing()
    await enqueueGeneratedDocumentTx(tx, { kind: "miper", entityId: versionId, milestone: "aprobada", worksiteId: matrix.worksiteId, occurredAt: now, actorUserId: access.userId })
    const [{ count: entryCount }] = await tx.select({ count: sql<number>`count(*)::int` }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
    accreditation = { actorUserId: access.userId, matrixId: matrix.id, worksiteId: matrix.worksiteId, matrixVersion: versionNumber, publishedAt: now, entryCount }
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "version", objectId: versionId, changeType: "version_sealed",
      reason: signing.usedException ? `${data.changeSummary} [Firma propia con la excepción prevention:sign_own_work.]` : data.changeSummary,
      after: { versionNumber, snapshotSha256: legalRound.snapshotSha256 }, actorUserId: access.userId, actingAs: "prevention:risk:approve_legal",
    })
    return { versionId, versionNumber }
  })
  if (accreditation) await onRiskMatrixPublished(accreditation)
  return result
}
```

En `pdtp-accreditation-connectors.ts`, dentro de `onRiskMatrixPublished`:
1. Cambiar las dos apariciones de `` sourceId: `miper:${input.matrixId}` `` por `` sourceId: `miper:${input.matrixId}:v${input.matrixVersion}` ``.
2. Cambiar el `evidenceRef` a `` `MIPER v${input.matrixVersion} aprobada: ${input.matrixId}` ``.
3. Reescribir el comentario del bloque: "Cada versión sellada es una actualización del inventario (N°35). La MIPER es un documento vivo: la clave de idempotencia lleva la versión para que cada actualización aprobada cuente una vez".

- [ ] **Step 4: Run tests**

Run: `npm run test:pglite -- lib/__tests__/miper-workflow.test.ts && npm run test:fast -- lib/services/pdtp-adapters`
Expected: PASS. Si una prueba del conector afirma el `sourceId` antiguo, actualizarla al formato con versión.

- [ ] **Step 5: Commit**

```bash
git add lib/services/miper/workflow.ts lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts lib/__tests__/miper-workflow.test.ts tests/pglite-files.ts
git commit -m "feat(miper): revisión técnica, Legal y RRHH y sellado de versiones inmutables"
```

---

#### Task 12: Consultas: espacio de trabajo, bandeja, lista, historial y versión

**Files:**
- Create: `lib/services/miper/queries.ts`
- Test: `lib/__tests__/miper-queries.test.ts` (PGlite; registrarlo)

**Interfaces:**
- Consumes: Tasks 3, 4, 7 y 10.
- Produces (usados por la UI, las acciones y la exportación):
  - `type MiperListRow`, `type MiperObservationView`, `type MiperWorkspace` y `type MiperHistoryEvent` (definiciones en el código).
  - `getMiperWorkspace(matrixId, access): Promise<MiperWorkspace>`
  - `listMipers(access, filters?: { worksiteId?: string; period?: number; state?: string }): Promise<MiperListRow[]>`
  - `listMiperInbox(access): Promise<MiperListRow[]>`: cada fila con `inboxReason`.
  - `getMiperHistory(matrixId, access): Promise<MiperHistoryEvent[]>`
  - `getMiperVersion(versionId, access)` y `getMiperVersionForArchive(versionId)`: devuelven `{ version, worksiteId, worksiteName, worksiteCode, methodologySnapshot, versions }`.
  - `listMiperCreationOptions(access): Promise<{ worksites: Array<{ id; name; vigenteId; vigentePeriod; vigenteIsLegacy }> }>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/miper-queries.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry } = await import("@/lib/services/miper/entries")
const q = await import("@/lib/services/miper/queries")

const author = { userId: "u-q", scope: { mode: "some" as const, ids: ["ws-q"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-j", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:view", "prevention:risk:review"] }
const outsider = { userId: "u-o", scope: { mode: "some" as const, ids: ["ws-other"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
let matrixId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([{ id: "ws-q", name: "Faena Q", code: "Q" }, { id: "ws-other", name: "Otra", code: "O" }])
  await testDb.insert(schema.users).values([
    { id: "u-q", name: "Prevencionista Q", email: "q@q.cl", hashedPassword: "x", isActive: true },
    { id: "u-j", name: "Jefa", email: "j@q.cl", hashedPassword: "x", isActive: true },
    { id: "u-o", name: "Otra", email: "o@q.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksiteUsers).values({ userId: "u-q", worksiteId: "ws-q" })
  matrixId = (await createMiper({ worksiteId: "ws-q", period: 2026, revisionReason: "Período para probar consultas." }, author)).id
  await saveMiperEntry({ matrixId, values: { hazard: "Ruido", probability: 1, consequence: 2 } }, author)
  await saveMiperEntry({ matrixId, values: { hazard: "Volcamiento", probability: 4, consequence: 4 } }, author)
}, 60_000)

describe("consultas MIPER", () => {
  it("el espacio de trabajo trae foto, completitud, prellenado, diccionarios y responsables", async () => {
    const ws = await q.getMiperWorkspace(matrixId, author)
    expect(ws.label).toBe("Borrador")
    expect(ws.snapshot.entries.map((e) => e.classification)).toEqual(["tolerable", "intolerable"])
    expect(Object.keys(ws.entryVersions)).toHaveLength(2)
    expect(ws.completeness.some((i) => i.severity === "error")).toBe(true)
    expect(ws.riskFactors.length).toBeGreaterThan(5)
    expect(ws.responsibleOptions.map((o) => o.id)).toContain("u-q")
    expect(ws.pendingDiff.hasChanges).toBe(true)
  })
  it("fuera de alcance no se lee", async () => {
    await expect(q.getMiperWorkspace(matrixId, outsider)).rejects.toThrow(/fuera de alcance/)
  })
  it("la lista cuenta filas por clasificación y respeta el alcance", async () => {
    const rows = await q.listMipers(author)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.classificationCounts).toMatchObject({ tolerable: 1, intolerable: 1, moderate: 0, important: 0 })
    expect(await q.listMipers(outsider)).toHaveLength(0)
  })
  it("la bandeja muestra a la prevencionista su borrador y a la Jefa lo enviado", async () => {
    expect((await q.listMiperInbox(author)).map((r) => r.inboxReason)).toEqual(["Borrador"])
    expect(await q.listMiperInbox(jefa)).toHaveLength(0)
    // Forzar el estado sin pasar por la completitud: la bandeja sólo mira `review_state`.
    await testDb.update(schema.preventionRiskMatrices).set({ reviewState: "in_review" }).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await testDb.insert(schema.preventionRiskReviewRounds).values({ id: "rq", matrixId, roundNumber: 1, stage: "technical", snapshot: { header: {}, entries: [] }, snapshotSha256: "c".repeat(64), submittedByUserId: "u-q" })
    const inbox = await q.listMiperInbox(jefa)
    expect(inbox.map((r) => [r.id, r.inboxReason, r.submittedByName])).toEqual([[matrixId, "Pendiente de tu revisión", "Prevencionista Q"]])
  })
  it("el historial lista eventos con actor y capacidad", async () => {
    const events = await q.getMiperHistory(matrixId, author)
    expect(events.map((e) => e.changeType)).toEqual(expect.arrayContaining(["created", "entry_created"]))
    expect(events.find((e) => e.changeType === "created")).toMatchObject({ actorName: "Prevencionista Q", actingAs: "prevention:risk:edit" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-queries.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/miper/queries.ts
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  auditLog, preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskMatrices, preventionRiskMatrixVersions,
  preventionRiskObservations, preventionRiskReviewRounds, users, worksites, worksiteUsers,
} from "@/db/schema"
import { checkMiperCompleteness, type CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { RISK_CLASSIFICATIONS, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { diffSnapshots, type MiperSnapshot, type SnapshotDiff } from "@/lib/prevention/miper/snapshot"
import { miperStatusLabel } from "@/lib/prevention/miper/states"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { listDictionaryNames, listFreeTextSuggestions } from "./dictionaries"
import { buildMiperHeaderPrefill, type MiperHeaderPrefill } from "./prefill"
import { buildMiperSnapshot, openRound as findOpenRound } from "./snapshots"
import { type MiperAccess, requireAccess, scopeAllows, scopeCondition, userNames } from "./shared"

const VIEW = "prevention:risk:view"
const emptyCounts = (): Record<RiskClassification, number> => ({ tolerable: 0, moderate: 0, important: 0, intolerable: 0 })

export type MiperListRow = {
  id: string; worksiteId: string; worksiteName: string; period: number | null; status: string; reviewState: string; isLegacy: boolean
  versionNumber: number | null; label: string; updatedAt: string; submittedAt: string | null; submittedByName: string | null
  entryCount: number; classificationCounts: Record<RiskClassification, number>; hasUnsentChanges: boolean; inboxReason?: string
}
export type MiperObservationView = typeof preventionRiskObservations.$inferSelect & { authorName: string; responderName: string | null }

export type MiperWorkspace = {
  matrix: typeof preventionRiskMatrices.$inferSelect & { worksiteName: string }
  label: string
  snapshot: MiperSnapshot
  entryVersions: Record<string, number>
  controlVersions: Record<string, number>
  versions: Array<{ id: string; versionNumber: number; approvedAt: string; changeSummary: string; approverName: string; technicalReviewerName: string; elaboratedByName: string }>
  lastVersionSnapshot: MiperSnapshot | null
  openRound: { id: string; stage: "technical" | "legal_rrhh"; roundNumber: number; openedAt: string | null; submittedByUserId: string; submittedAt: string; snapshot: MiperSnapshot } | null
  reviewDiff: SnapshotDiff | null
  /** Contra qué foto se calculó `reviewDiff`: da los valores "antes" del diff campo por campo. */
  reviewBaselineSnapshot: MiperSnapshot | null
  pendingDiff: SnapshotDiff
  observations: MiperObservationView[]
  completeness: CompletenessIssue[]
  prefill: MiperHeaderPrefill
  riskFactors: Array<{ id: string; name: string; isActive: boolean }>
  dictionaries: { activities: string[]; tasks: string[]; positions: string[]; locations: string[]; hazards: string[]; risks: string[]; damages: string[]; measures: string[] }
  responsibleOptions: Array<{ id: string; name: string }>
}

function hasUnsentChanges(matrix: { status: string; reviewState: string; updatedAt: string; publishedAt: string | null }) {
  return matrix.status === "published" && matrix.reviewState === "none" && Boolean(matrix.publishedAt) && matrix.updatedAt > matrix.publishedAt!
}

export async function getMiperWorkspace(matrixId: string, access: MiperAccess): Promise<MiperWorkspace> {
  requireAccess(access, VIEW)
  const [row] = await db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId)).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.matrix.worksiteId)) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const matrix = row.matrix

  const [snapshot, versionRows, round, observationRows, prefill, factorRows, dictionaryNames, suggestions, responsibleRows, entryVersionRows, allRounds] = await Promise.all([
    buildMiperSnapshot(db, matrix.id),
    db.select().from(preventionRiskMatrixVersions).where(eq(preventionRiskMatrixVersions.matrixId, matrix.id)).orderBy(desc(preventionRiskMatrixVersions.versionNumber)),
    findOpenRound(db, matrix.id),
    db.select().from(preventionRiskObservations).where(eq(preventionRiskObservations.matrixId, matrix.id)).orderBy(asc(preventionRiskObservations.createdAt)),
    buildMiperHeaderPrefill(db, matrix.worksiteId),
    db.select({ id: preventionRiskFactors.id, name: preventionRiskFactors.name, isActive: preventionRiskFactors.isActive }).from(preventionRiskFactors).orderBy(asc(preventionRiskFactors.sortOrder), asc(preventionRiskFactors.name)),
    listDictionaryNames(db, matrix.worksiteId),
    listFreeTextSuggestions(db, matrix.worksiteId),
    db.select({ id: users.id, name: users.name }).from(worksiteUsers).innerJoin(users, eq(users.id, worksiteUsers.userId))
      .where(and(eq(worksiteUsers.worksiteId, matrix.worksiteId), eq(users.isActive, true))).orderBy(asc(users.name)),
    db.select({ id: preventionRiskEntries.id, version: preventionRiskEntries.version }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id)),
    db.select().from(preventionRiskReviewRounds).where(eq(preventionRiskReviewRounds.matrixId, matrix.id)).orderBy(desc(preventionRiskReviewRounds.roundNumber)),
  ])
  const controlVersionRows = entryVersionRows.length === 0 ? [] : await db.select({ id: preventionRiskControls.id, version: preventionRiskControls.version })
    .from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, entryVersionRows.map((entry) => entry.id)))

  const lastVersionSnapshot = (versionRows[0]?.snapshot as MiperSnapshot | undefined) ?? null
  let reviewDiff: SnapshotDiff | null = null
  let reviewBaselineSnapshot: MiperSnapshot | null = null
  if (round) {
    // "Modificados desde la revisión anterior": contra la última ronda técnica
    // previa; si es la primera, contra la versión vigente (o todo es nuevo).
    const previousTechnical = allRounds.find((candidate) => candidate.id !== round.id && candidate.stage === "technical" && candidate.roundNumber < round.roundNumber)
    const baseline = (previousTechnical?.snapshot as MiperSnapshot | undefined) ?? lastVersionSnapshot
    reviewDiff = diffSnapshots(baseline, round.snapshot as MiperSnapshot)
    reviewBaselineSnapshot = baseline
  }
  const names = await userNames(db, observationRows.flatMap((observation) => [observation.authorUserId, observation.respondedByUserId]))
  const responsibleOptions = [...responsibleRows]
  if (!responsibleOptions.some((option) => option.id === access.userId)) {
    const self = await userNames(db, [access.userId])
    const selfName = self.get(access.userId)
    if (selfName) responsibleOptions.push({ id: access.userId, name: selfName })
  }

  return {
    matrix: { ...matrix, worksiteName: row.worksiteName },
    label: miperStatusLabel({ status: matrix.status, reviewState: matrix.reviewState, versionNumber: versionRows[0]?.versionNumber ?? null, hasUnsentChanges: hasUnsentChanges(matrix), roundOpened: Boolean(round?.openedAt), isLegacy: matrix.isLegacy }),
    snapshot,
    entryVersions: Object.fromEntries(entryVersionRows.map((entry) => [entry.id, entry.version])),
    controlVersions: Object.fromEntries(controlVersionRows.map((control) => [control.id, control.version])),
    versions: versionRows.map((version) => ({ id: version.id, versionNumber: version.versionNumber, approvedAt: version.approvedAt, changeSummary: version.changeSummary, approverName: version.approverName, technicalReviewerName: version.technicalReviewerName, elaboratedByName: version.elaboratedByName })),
    lastVersionSnapshot,
    openRound: round ? { id: round.id, stage: round.stage as "technical" | "legal_rrhh", roundNumber: round.roundNumber, openedAt: round.openedAt, submittedByUserId: round.submittedByUserId, submittedAt: round.submittedAt, snapshot: round.snapshot as MiperSnapshot } : null,
    reviewDiff,
    reviewBaselineSnapshot,
    pendingDiff: diffSnapshots(lastVersionSnapshot, snapshot),
    observations: observationRows.map((observation) => ({ ...observation, authorName: names.get(observation.authorUserId) ?? "—", responderName: observation.respondedByUserId ? names.get(observation.respondedByUserId) ?? null : null })),
    completeness: checkMiperCompleteness(snapshot),
    prefill,
    riskFactors: factorRows,
    dictionaries: { ...dictionaryNames, ...suggestions },
    responsibleOptions,
  }
}

async function buildRows(matrixRows: Array<{ matrix: typeof preventionRiskMatrices.$inferSelect; worksiteName: string }>): Promise<MiperListRow[]> {
  if (matrixRows.length === 0) return []
  const ids = matrixRows.map((row) => row.matrix.id)
  const [counts, versions, rounds] = await Promise.all([
    db.select({ matrixId: preventionRiskEntries.matrixId, classification: preventionRiskEntries.classification, count: sql<number>`count(*)::int` })
      .from(preventionRiskEntries).where(inArray(preventionRiskEntries.matrixId, ids)).groupBy(preventionRiskEntries.matrixId, preventionRiskEntries.classification),
    db.select({ matrixId: preventionRiskMatrixVersions.matrixId, max: sql<number>`max(${preventionRiskMatrixVersions.versionNumber})::int` })
      .from(preventionRiskMatrixVersions).where(inArray(preventionRiskMatrixVersions.matrixId, ids)).groupBy(preventionRiskMatrixVersions.matrixId),
    db.select().from(preventionRiskReviewRounds).where(and(inArray(preventionRiskReviewRounds.matrixId, ids), isNull(preventionRiskReviewRounds.decision))),
  ])
  const submitters = await userNames(db, rounds.map((round) => round.submittedByUserId))
  const versionBy = new Map(versions.map((row) => [row.matrixId, row.max]))
  const roundBy = new Map(rounds.map((round) => [round.matrixId, round]))
  return matrixRows.map(({ matrix, worksiteName }) => {
    const classificationCounts = emptyCounts()
    let entryCount = 0
    for (const item of counts.filter((candidate) => candidate.matrixId === matrix.id)) {
      entryCount += item.count
      if (item.classification && (RISK_CLASSIFICATIONS as readonly string[]).includes(item.classification)) classificationCounts[item.classification as RiskClassification] += item.count
    }
    const round = roundBy.get(matrix.id)
    const unsent = hasUnsentChanges(matrix)
    const versionNumber = versionBy.get(matrix.id) ?? null
    return {
      id: matrix.id, worksiteId: matrix.worksiteId, worksiteName, period: matrix.period, status: matrix.status, reviewState: matrix.reviewState, isLegacy: matrix.isLegacy,
      versionNumber,
      label: miperStatusLabel({ status: matrix.status, reviewState: matrix.reviewState, versionNumber, hasUnsentChanges: unsent, roundOpened: Boolean(round?.openedAt), isLegacy: matrix.isLegacy }),
      updatedAt: matrix.updatedAt, submittedAt: round?.submittedAt ?? null, submittedByName: round ? submitters.get(round.submittedByUserId) ?? null : null,
      entryCount, classificationCounts, hasUnsentChanges: unsent,
    }
  })
}

export async function listMipers(access: MiperAccess, filters: { worksiteId?: string; period?: number; state?: string } = {}) {
  requireAccess(access, VIEW)
  const stateCondition = !filters.state ? undefined
    : ["draft", "published", "superseded"].includes(filters.state) ? eq(preventionRiskMatrices.status, filters.state)
    : eq(preventionRiskMatrices.reviewState, filters.state)
  const rows = await db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
    .where(and(
      scopeCondition(access.scope, preventionRiskMatrices.worksiteId),
      filters.worksiteId ? eq(preventionRiskMatrices.worksiteId, filters.worksiteId) : undefined,
      filters.period ? eq(preventionRiskMatrices.period, filters.period) : undefined,
      stateCondition,
    ))
    .orderBy(asc(worksites.name), desc(preventionRiskMatrices.period), desc(preventionRiskMatrices.createdAt))
  return buildRows(rows)
}

export async function listMiperInbox(access: MiperAccess) {
  requireAccess(access, VIEW)
  const can = (permission: string) => access.permissions.includes(permission)
  const conditions = []
  if (can("prevention:risk:edit")) {
    conditions.push(and(eq(preventionRiskMatrices.isLegacy, false), or(
      and(eq(preventionRiskMatrices.status, "draft"), inArray(preventionRiskMatrices.reviewState, ["none", "observed"])),
      and(eq(preventionRiskMatrices.status, "published"), eq(preventionRiskMatrices.reviewState, "observed")),
      and(eq(preventionRiskMatrices.status, "published"), eq(preventionRiskMatrices.reviewState, "none"), gt(preventionRiskMatrices.updatedAt, preventionRiskMatrices.publishedAt)),
    )))
  }
  if (can("prevention:risk:review")) conditions.push(eq(preventionRiskMatrices.reviewState, "in_review"))
  if (can("prevention:risk:approve_legal")) conditions.push(eq(preventionRiskMatrices.reviewState, "pending_approval"))
  if (conditions.length === 0) return []
  const rows = await db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
    .where(and(scopeCondition(access.scope, preventionRiskMatrices.worksiteId), ne(preventionRiskMatrices.status, "superseded"), or(...conditions)))
    .orderBy(asc(preventionRiskMatrices.updatedAt))
  const built = await buildRows(rows)
  return built.flatMap((item) => {
    let inboxReason: string | undefined
    if (item.reviewState === "in_review" && can("prevention:risk:review")) inboxReason = "Pendiente de tu revisión"
    else if (item.reviewState === "pending_approval" && can("prevention:risk:approve_legal")) inboxReason = "Pendiente de tu firma"
    else if (can("prevention:risk:edit") && !item.isLegacy) {
      inboxReason = item.reviewState === "observed" ? "Con observaciones" : item.hasUnsentChanges ? "Cambios sin enviar" : item.status === "draft" && item.reviewState === "none" ? "Borrador" : undefined
    }
    return inboxReason ? [{ ...item, inboxReason }] : []
  })
}

export type MiperHistoryEvent = { id: string; at: string; actorName: string | null; actingAs: string | null; changeType: string; object: string | null; reason: string | null }

export async function getMiperHistory(matrixId: string, access: MiperAccess): Promise<MiperHistoryEvent[]> {
  requireAccess(access, VIEW)
  const [matrix] = await db.select({ worksiteId: preventionRiskMatrices.worksiteId }).from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!matrix || !scopeAllows(access.scope, matrix.worksiteId)) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const rows = await db.select({ log: auditLog, actorName: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(inArray(auditLog.entityType, ["risk_legal:risk:miper", "risk_legal:risk:matrix"]), eq(auditLog.entityId, matrixId)))
    .orderBy(desc(auditLog.createdAt)).limit(500)
  return rows.map(({ log, actorName }) => {
    let state: Record<string, unknown> = {}
    try { state = JSON.parse(log.newState ?? "{}") as Record<string, unknown> } catch { state = {} }
    return { id: log.id, at: log.createdAt, actorName, actingAs: typeof state.actingAs === "string" ? state.actingAs : null, changeType: String(state.changeType ?? log.action), object: typeof state.object === "string" ? state.object : null, reason: log.reason }
  })
}

export async function getMiperVersion(versionId: string, access: MiperAccess) {
  requireAccess(access, VIEW)
  const [row] = await db.select({ version: preventionRiskMatrixVersions, worksiteId: preventionRiskMatrices.worksiteId, worksiteName: worksites.name, worksiteCode: worksites.code, methodologySnapshot: preventionRiskMatrices.methodologySnapshot })
    .from(preventionRiskMatrixVersions)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskMatrixVersions.matrixId))
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
    .where(eq(preventionRiskMatrixVersions.id, versionId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.worksiteId)) throw new RiskLegalDomainError("Versión MIPER no encontrada o fuera de alcance.")
  const versions = await db.select({ versionNumber: preventionRiskMatrixVersions.versionNumber, approvedAt: preventionRiskMatrixVersions.approvedAt, changeSummary: preventionRiskMatrixVersions.changeSummary, approverName: preventionRiskMatrixVersions.approverName, elaboratedByName: preventionRiskMatrixVersions.elaboratedByName })
    .from(preventionRiskMatrixVersions)
    .where(and(eq(preventionRiskMatrixVersions.matrixId, row.version.matrixId), sql`${preventionRiskMatrixVersions.versionNumber} <= ${row.version.versionNumber}`))
    .orderBy(asc(preventionRiskMatrixVersions.versionNumber))
  return { ...row, versions }
}

/** Para el archivado (cron, sin sesión): sólo lee una versión ya sellada. */
export async function getMiperVersionForArchive(versionId: string) {
  return getMiperVersion(versionId, { userId: "system:generated-documents", scope: { mode: "all", ids: [] }, permissions: [VIEW] })
}

export async function listMiperCreationOptions(access: MiperAccess) {
  requireAccess(access, "prevention:risk:edit")
  const rows = await db.select({ id: worksites.id, name: worksites.name }).from(worksites)
    .where(and(eq(worksites.isActive, true), scopeCondition(access.scope, worksites.id))).orderBy(asc(worksites.name))
  const vigentes = rows.length === 0 ? [] : await db.select({ id: preventionRiskMatrices.id, worksiteId: preventionRiskMatrices.worksiteId, period: preventionRiskMatrices.period, isLegacy: preventionRiskMatrices.isLegacy })
    .from(preventionRiskMatrices).where(and(inArray(preventionRiskMatrices.worksiteId, rows.map((row) => row.id)), eq(preventionRiskMatrices.status, "published")))
  const byWorksite = new Map(vigentes.map((vigente) => [vigente.worksiteId, vigente]))
  return { worksites: rows.map((row) => ({ id: row.id, name: row.name, vigenteId: byWorksite.get(row.id)?.id ?? null, vigentePeriod: byWorksite.get(row.id)?.period ?? null, vigenteIsLegacy: byWorksite.get(row.id)?.isLegacy ?? false })) }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:pglite -- lib/__tests__/miper-queries.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/services/miper/queries.ts lib/__tests__/miper-queries.test.ts tests/pglite-files.ts
git commit -m "feat(miper): consultas de espacio de trabajo, bandeja por rol, lista, historial y versiones"
```

---

#### Task 13: Catálogo de factores de riesgo (servicio)

**Files:**
- Create: `lib/services/miper/risk-factors.ts`
- Test: `lib/__tests__/miper-risk-factors.test.ts` (PGlite; registrarlo)

**Interfaces:**
- Consumes: `riskFactorSaveSchema` (Task 6); `shared.ts` (Task 7).
- Produces:
  - `listRiskFactors(): Promise<Array<{ id: string; code: string; name: string; sortOrder: number; isActive: boolean; usageCount: number }>>`
  - `saveRiskFactor(input: unknown, access: MiperAccess): Promise<{ id: string }>`
  - `setRiskFactorActive(input: { id: string; isActive: boolean }, access: MiperAccess): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/miper-risk-factors.test.ts
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const svc = await import("@/lib/services/miper/risk-factors")
const admin = { userId: "u-cat", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:catalog:manage"] }
const nobody = { userId: "u-no", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:view"] }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({ id: "u-cat", name: "Catálogo", email: "c@c.cl", hashedPassword: "x", isActive: true })
}, 60_000)

describe("catálogo de factores de riesgo", () => {
  it("lista los sembrados, crea uno nuevo y rechaza código duplicado", async () => {
    expect((await svc.listRiskFactors()).length).toBeGreaterThanOrEqual(11)
    const { id } = await svc.saveRiskFactor({ code: "radiacion", name: "Radiación", sortOrder: 120 }, admin)
    expect((await svc.listRiskFactors()).find((f) => f.id === id)).toMatchObject({ name: "Radiación", isActive: true, usageCount: 0 })
    await expect(svc.saveRiskFactor({ code: "radiacion", name: "Otro nombre", sortOrder: 1 }, admin)).rejects.toThrow(/Ya existe/)
  })
  it("sin permiso de catálogo no escribe; desactivar no borra", async () => {
    await expect(svc.saveRiskFactor({ code: "x_y", name: "XY", sortOrder: 1 }, nobody)).rejects.toThrow(/fuera de alcance/)
    await svc.setRiskFactorActive({ id: "riskfactor-transito", isActive: false }, admin)
    expect((await svc.listRiskFactors()).find((f) => f.id === "riskfactor-transito")?.isActive).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-risk-factors.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/miper/risk-factors.ts
import { asc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionRiskEntries, preventionRiskFactors } from "@/db/schema"
import { recordModuleHistory } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { riskFactorSaveSchema } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { type MiperAccess, nowIso, requireAccess } from "./shared"

const MANAGE = "prevention:risk:catalog:manage"

export async function listRiskFactors() {
  const rows = await db.select({
    id: preventionRiskFactors.id, code: preventionRiskFactors.code, name: preventionRiskFactors.name,
    sortOrder: preventionRiskFactors.sortOrder, isActive: preventionRiskFactors.isActive,
    usageCount: sql<number>`(select count(*)::int from ${preventionRiskEntries} where ${preventionRiskEntries.riskFactorId} = ${preventionRiskFactors.id})`,
  }).from(preventionRiskFactors).orderBy(asc(preventionRiskFactors.sortOrder), asc(preventionRiskFactors.name))
  return rows
}

export async function saveRiskFactor(input: unknown, access: MiperAccess) {
  const data = riskFactorSaveSchema.parse(input)
  requireAccess(access, MANAGE)
  const now = nowIso()
  const id = data.id ?? `riskfactor-${nanoid(10)}`
  try {
    if (data.id) {
      const [updated] = await db.update(preventionRiskFactors).set({ code: data.code, name: data.name, sortOrder: data.sortOrder, updatedAt: now }).where(eq(preventionRiskFactors.id, data.id)).returning({ id: preventionRiskFactors.id })
      if (!updated) throw new RiskLegalDomainError("Factor de riesgo no encontrado.")
    } else {
      await db.insert(preventionRiskFactors).values({ id, code: data.code, name: data.name, sortOrder: data.sortOrder, createdAt: now, updatedAt: now })
    }
  } catch (error) {
    if (error instanceof RiskLegalDomainError) throw error
    // Violación de los índices únicos de código o nombre.
    if (String((error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code) === "23505") throw new RiskLegalDomainError("Ya existe un factor de riesgo con ese código o nombre.")
    throw error
  }
  await recordModuleHistory(db, { module: "risk_legal:risk", entityType: "risk_factor", entityId: id, changeType: data.id ? "updated" : "created", afterState: data, actorUserId: access.userId })
  return { id }
}

export async function setRiskFactorActive(input: unknown, access: MiperAccess) {
  const data = z.object({ id: z.string().min(1), isActive: z.boolean() }).parse(input)
  requireAccess(access, MANAGE)
  const [updated] = await db.update(preventionRiskFactors).set({ isActive: data.isActive, updatedAt: nowIso() }).where(eq(preventionRiskFactors.id, data.id)).returning({ id: preventionRiskFactors.id })
  if (!updated) throw new RiskLegalDomainError("Factor de riesgo no encontrado.")
  await recordModuleHistory(db, { module: "risk_legal:risk", entityType: "risk_factor", entityId: data.id, changeType: data.isActive ? "reactivated" : "deactivated", actorUserId: access.userId })
}
```

- [ ] **Step 4: Run test and commit**

Run: `npm run test:pglite -- lib/__tests__/miper-risk-factors.test.ts`
Expected: PASS. Si la detección de `23505` no cubre el formato del error de PGlite, loguear `error` una vez en la prueba para ver su forma real y ajustar la condición. No capturar errores genéricos.

```bash
git add lib/services/miper/risk-factors.ts lib/__tests__/miper-risk-factors.test.ts tests/pglite-files.ts
git commit -m "feat(miper): servicio del catálogo de factores de riesgo"
```

---

#### Task 14: Retirar el flujo antiguo, permisos y acciones de servidor

Esta tarea cambia varias piezas acopladas que deben quedar compilando juntas.
- Se retira el flujo `draft → in_review → reviewed → approved → published` del servicio antiguo.
- Se retira el importador antiguo.
- Se actualizan los permisos.
- Se reescriben las acciones de servidor.
- La página `/prevencion/miper` queda con una versión mínima; la Task 16 la reemplaza.

**Files:**
- Modify: `lib/services/prevention-risk-legal.ts`.
- Modify: `lib/validation/prevention-module/risk-legal.ts` y `lib/__tests__/prevention-risk-legal.test.ts`.
- Delete: `lib/services/prevention-risk-import.ts`, `lib/services/prevention-risk-import.test.ts`, `app/(app)/prevencion/miper/miper-workbench.tsx` y `lib/__tests__/miper-ui-contract.test.ts`.
- Modify: `lib/services/pdtp/reminders.ts:450-500` y `lib/services/pdtp/reminders-signature-pending.test.ts:100-120`.
- Modify: `lib/services/pdtp/connectors.ts:164`, `lib/services/pdtp-adapters/fulfillment-contract-2026.ts:213-220` y `app/(app)/prevencion/pdtp/[programId]/pdtp-destination-labels.ts:45`.
- Modify: `lib/services/prevention-risk-map.ts:180-240`, `app/(app)/prevencion/cgrd/mapa/risk-map-data.ts` y `app/(app)/prevencion/cgrd/mapa/risk-map-panel.tsx`.
- Modify: `app/(app)/prevencion/miper/controles/[id]/page.tsx` y `app/(app)/dashboard/sections/prevention-section.tsx:106`.
- Modify: `modules/prevention/manifest.ts` y `lib/__tests__/prevention-rbac.test.ts`.
- Rewrite: `app/(app)/prevencion/miper/actions.ts`, `app/(app)/prevencion/miper/actions.test.ts` y `app/(app)/prevencion/miper/page.tsx` (mínima).
- Modify (fixtures, `isLegacy: true`):
  - `e2e/setup-db.ts:3084`
  - `scripts/capture-all-routes.ts:2444`
  - `lib/__tests__/prevention-permit-workflow-gates-pglite.test.ts:90`
  - `lib/__tests__/prevention-risk-control-ineffective-capa.test.ts:53`
  - `lib/__tests__/prevention-epp-postgres.test.ts:214`
- Modify (suites Postgres reales): `lib/__tests__/prevention-risk-legal-postgres.test.ts` y `lib/__tests__/prevention-incidents-postgres.test.ts:250-300`.

**Interfaces:**
- Consumes: todos los servicios de las Tasks 7–13; `effectiveRiskLevel` (Task 1); `pendingSignaturePermission` (Task 4).
- Produces: acciones de servidor en `app/(app)/prevencion/miper/actions.ts`, todas `(input: unknown) => Promise<ActionState>`:
  - Matriz: `createMiperAction` (con `data.id`), `updateMiperHeaderAction` (con `data.version`), `discardMiperDraftAction`.
  - Filas y medidas: `saveMiperEntryAction` (con `data: SavedEntry`), `duplicateMiperEntryAction`, `deleteMiperEntryAction`, `saveMiperControlAction` (con `data: { id, version }`), `deleteMiperControlAction`.
  - Flujo: `submitMiperAction`, `openMiperRoundAction`, `returnMiperAction`, `approveMiperTechnicalAction`, `requestMiperCorrectionsAction`, `approveMiperFinalAction`.
  - Observaciones: `addMiperObservationAction`, `respondMiperObservationAction`, `resolveMiperObservationAction`, `reopenMiperObservationAction`.
  - Catálogo: `saveRiskFactorAction`, `setRiskFactorActiveAction`.
  - Se conservan `verifyRiskControlAction` y `resolveRiskReviewTriggerAction`.

- [ ] **Step 1: Write the failing tests (acciones, RBAC, recordatorios)**

Reemplazar `app/(app)/prevencion/miper/actions.test.ts` por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const createMiper = vi.hoisted(() => vi.fn())
const saveMiperEntry = vi.hoisted(() => vi.fn())
const submitMiperForReview = vi.hoisted(() => vi.fn())
const approveMiperTechnicalReview = vi.hoisted(() => vi.fn())
const approveMiperFinal = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/lib/services/generated-documents/schedule", () => ({ scheduleGeneratedDocumentDrain: vi.fn() }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({ resolveRiskReviewTrigger: vi.fn(), verifyRiskControl: vi.fn() }))
vi.mock("@/lib/services/miper/matrices", () => ({ createMiper, updateMiperHeader: vi.fn(), discardMiperDraft: vi.fn() }))
vi.mock("@/lib/services/miper/entries", () => ({ saveMiperEntry, duplicateMiperEntry: vi.fn(), deleteMiperEntry: vi.fn(), saveMiperControl: vi.fn(), deleteMiperControl: vi.fn() }))
vi.mock("@/lib/services/miper/observations", () => ({ addMiperObservation: vi.fn(), respondMiperObservation: vi.fn(), resolveMiperObservation: vi.fn(), reopenMiperObservation: vi.fn() }))
vi.mock("@/lib/services/miper/workflow", () => ({ submitMiperForReview, openMiperReviewRound: vi.fn(), returnMiperWithObservations: vi.fn(), approveMiperTechnicalReview, requestMiperCorrections: vi.fn(), approveMiperFinal }))
vi.mock("@/lib/services/miper/risk-factors", () => ({ saveRiskFactor: vi.fn(), setRiskFactorActive: vi.fn() }))

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { approveMiperFinalAction, approveMiperTechnicalAction, createMiperAction, saveMiperEntryAction, submitMiperAction } from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const session = { user: { id: "trusted-user", permissions: ["prevention:risk:edit"] } }

describe("acciones MIPER: frontera de autorización", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("bloquea antes de llamar al servicio", async () => {
    guardPermission.mockResolvedValue(denied)
    await expect(createMiperAction({ worksiteId: "ws-foreign" })).resolves.toEqual(denied.error)
    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:edit")
    expect(createMiper).not.toHaveBeenCalled()
  })

  it.each([
    [submitMiperAction, "prevention:risk:edit"],
    [approveMiperTechnicalAction, "prevention:risk:review"],
    [approveMiperFinalAction, "prevention:risk:approve_legal"],
  ])("cada paso del flujo exige su propio permiso", async (action, permission) => {
    guardPermission.mockResolvedValue(denied)
    await action({ matrixId: "m1", expectedVersion: 1 })
    expect(guardPermission).toHaveBeenCalledWith(permission)
  })

  it("el actor, alcance y permisos salen de la sesión, no del input", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    createMiper.mockResolvedValue({ id: "m-new" })
    const state = await createMiperAction({ worksiteId: "ws-own", period: 2026, revisionReason: "x".repeat(12), userId: "spoofed" })
    expect(state).toEqual({ ok: true, data: { id: "m-new" } })
    expect(createMiper).toHaveBeenCalledWith(expect.anything(), { userId: "trusted-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:edit"] })
  })

  it("guardar una fila devuelve la versión nueva y no revalida la página", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    saveMiperEntry.mockResolvedValue({ id: "e1", version: 3, rowNumber: 1, magnitude: 8, classification: "important" })
    await expect(saveMiperEntryAction({ matrixId: "m1", entryId: "e1", expectedVersion: 2, values: { probability: 2 } })).resolves.toEqual({ ok: true, data: { id: "e1", version: 3, rowNumber: 1, magnitude: 8, classification: "important" } })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("los rechazos de dominio llegan con su motivo; lo inesperado queda genérico", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    submitMiperForReview.mockRejectedValueOnce(new RiskLegalDomainError("Responde todas las observaciones antes de reenviar (2 sin responder)."))
    await expect(submitMiperAction({ matrixId: "m1", expectedVersion: 4 })).resolves.toEqual({ ok: false, message: "Responde todas las observaciones antes de reenviar (2 sin responder)." })
    submitMiperForReview.mockRejectedValueOnce(new Error("relation does not exist"))
    const state = await submitMiperAction({ matrixId: "m1", expectedVersion: 4 })
    expect(state.ok).toBe(false)
    expect(state.message).not.toMatch(/relation/)
  })
})
```

En `lib/__tests__/prevention-rbac.test.ts`:
- En la lista esperada de permisos, reemplazar `"prevention:risk:approve"` y `"prevention:risk:publish"` por `"prevention:risk:approve_legal"` y `"prevention:risk:catalog:manage"`.
- Reemplazar el bloque de aserciones MIPER del test "pins who signs the MIPER…" por:

```ts
    expect(rolesFor("prevention:risk:review")).toEqual(["administrador", "jefa_chome", "prevencionista"])
    expect(rolesFor("prevention:risk:approve_legal")).toEqual(["administrador", "gerente_legal_rrhh"])
    expect(rolesFor("prevention:risk:catalog:manage")).toEqual(["administrador", "prevencionista"])
    // Quien levanta la matriz en faena no la firma en ningún paso.
    expect(rolesFor("prevention:risk:edit")).toContain("prevencionista_faena")
    expect(rolesFor("prevention:risk:review")).not.toContain("prevencionista_faena")
    expect(rolesFor("prevention:risk:approve_legal")).not.toContain("prevencionista_faena")
```

En `lib/services/pdtp/reminders-signature-pending.test.ts`, test "le pide a cada paso la firma que corresponde", los datos `risk` pasan a llevar `reviewState` y el resultado esperado cambia:

```ts
      risk: [
        { id: "miper-1", worksiteId: "ws-1", title: "MIPER en revisión", reviewState: "in_review", updatedAt: hace(10) },
        { id: "miper-2", worksiteId: "ws-1", title: "MIPER pendiente de Legal y RRHH", reviewState: "pending_approval", updatedAt: hace(10) },
      ],
    // …
    expect(permisos).toEqual(["prevention:risk:review", "prevention:risk:approve_legal"])
```

Además, en la línea 114, reemplazar `"prevention:risk:approve"` y `"prevention:risk:publish"` por `"prevention:risk:approve_legal"` en la lista de permisos del fixture de destinatarios.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/actions.test.ts" lib/__tests__/prevention-rbac.test.ts lib/services/pdtp/reminders-signature-pending.test.ts`
Expected: FAIL: las acciones nuevas no existen, los grants son los antiguos y los recordatorios leen `status`.

- [ ] **Step 3: Manifiesto de permisos**

En `modules/prevention/manifest.ts`:

1. En `permissions`, reemplazar `"prevention:risk:approve"` y `"prevention:risk:publish"` por `"prevention:risk:approve_legal"` y `"prevention:risk:catalog:manage"`.
2. En las descripciones:

```ts
    "prevention:risk:edit": { id: "p-prev-risk-edit", description: "Crear y corregir la MIPER de sus faenas, responder observaciones y enviarla a revisión" },
    "prevention:risk:review": { id: "p-prev-risk-review", description: "Revisar técnicamente la MIPER (Jefatura del Departamento de Prevención), observarla y aprobarla técnicamente" },
    "prevention:risk:approve_legal": { id: "p-prev-risk-approve-legal", description: "Aprobar la MIPER como Legal y RRHH o solicitar correcciones; la aprobación sella una versión inmutable" },
    "prevention:risk:catalog:manage": { id: "p-prev-risk-catalog", description: "Administrar el catálogo de factores de riesgo de la MIPER" },
```

   Borrar las entradas `approve` y `publish`.
3. En `defaultGrants`:
   - Borrar las seis líneas de `risk:approve`/`risk:publish` de `prevencionista`, `jefa_chome` y `administrador`, junto con el comentario de la firma que las acompaña.
   - Agregar:

```ts
    /* Aprobación final de la MIPER (spec 2026-09-30 §6.3): una sola firma
     * conjunta de Legal y RRHH. Es una clave nueva y no la antigua `approve`,
     * porque los grants por defecto sólo se aplican cuando el permiso aparece
     * por primera vez: reutilizarla habría dejado como aprobadores finales, sin
     * decisión de nadie, a los roles que ya la tenían en la base. */
    { roleSlug: "gerente_legal_rrhh", permission: "prevention:risk:view" },
    { roleSlug: "gerente_legal_rrhh", permission: "prevention:risk:approve_legal" },
    { roleSlug: "administrador", permission: "prevention:risk:approve_legal" },
    { roleSlug: "prevencionista", permission: "prevention:risk:catalog:manage" },
    { roleSlug: "administrador", permission: "prevention:risk:catalog:manage" },
```

4. Revisar `scripts/sync-rbac.ts` para ver si elimina permisos que ya no están en el manifiesto:
   - Si los elimina, no hay nada más que hacer.
   - Si no los elimina, anotarlo en el informe final (Task 21) como paso operativo: retirar `p-prev-risk-approve` y `p-prev-risk-publish` desde `/admin/roles`. Quedan inertes, porque ningún código los consulta.

   No escribir SQL de RBAC en migraciones.

- [ ] **Step 4: Retirar el flujo antiguo del servicio y de la validación**

En `lib/services/prevention-risk-legal.ts`, **borrar**:
- `createRiskMethodology` y `ensureIspRiskMethodology`.
- `createRiskMatrixDraftWithClient`, `createRiskMatrixDraft`, `resolveHierarchy`, `addRiskEntryWithClient` y `addRiskEntry`.
- `MATRIX_TRANSITIONS`, `MATRIX_PERMISSION`, `matrixSourceHash`, `repointRiskMapMarkers` y `transitionRiskMatrix`.
- `getPublishedRiskMatrix` y `getPublishedRiskMatrixForArchive`.

Después, quitar los imports que queden sin uso (`lint` los marca).

Ajustar lo que se conserva:

```ts
// verifyRiskControl: la prioridad de la CAPA sale del nivel efectivo
// (clasificación RE-04; residual sólo en filas legacy).
const { priority, dueInDays } = capaPriorityForCriticality(effectiveRiskLevel(row.entry) ?? "medium")
```

En `getRiskControlDetail`, cambiar los tres `innerJoin` de proceso, tarea y puesto por `leftJoin`, porque ahora son nulos mientras la fila se completa. En `controles/[id]/page.tsx`, usar `detail.process?.name ?? "—"` y lo mismo para tarea y puesto.

`getRiskDashboard` se conserva, porque lo usan el tablero de inicio y el mapa CGRD:
- Cambiar sus tres `innerJoin` de diccionario por `leftJoin`.
- Reemplazar el cálculo de `criticalBlockers` por:

```ts
  // Bloqueo crítico: fila vigente Intolerable (o crítica legacy) sin una medida
  // implementada/verificada o sin cobertura PDTP. Mismo criterio que antes, con
  // la clasificación RE-04 como fuente del nivel.
  const criticalBlockers = entries.filter(({ entry }) => {
    if (!publishedIds.has(entry.matrixId)) return false
    const critical = entry.classification === "intolerable" || (entry.classification === null && entry.isCritical)
    if (!critical) return false
    const entryControls = controlByEntry.get(entry.id) ?? []
    return !entryControls.some((control) => ["implemented", "verified"].includes(control.status))
      || !entryControls.some((control) => linkedControlIds.has(control.id))
  })
```

- Reemplazar la consulta `activePositions` por una que cuente los puestos del diccionario por faena:

```ts
  const activePositions = await db.select({ id: preventionRiskPositions.id }).from(preventionRiskPositions)
    .where(and(eq(preventionRiskPositions.isActive, true), scopeCondition(access.scope, preventionRiskPositions.worksiteId)))
```

  Con `scopeCondition` sobre una columna nula, las filas legacy (sin `worksiteId`) quedan fuera, que es lo correcto.

En `app/(app)/dashboard/sections/prevention-section.tsx:106`, cambiar `href="/prevencion/miper#bloqueos"` por `href="/prevencion/miper?tab=todas"`.

En `lib/validation/prevention-module/risk-legal.ts`, borrar:
- `riskLevelSchema`, `riskMethodologySchema`, `riskMatrixDraftSchema`, `riskControlSchema`, `riskEntrySchema` y `riskMatrixTransitionSchema`;
- el import de `normalizeRiskLevel` si queda sin uso.

En `lib/__tests__/prevention-risk-legal.test.ts`, borrar los casos que prueban esos schemas: "validates valid risk methodology…", "validates draft risk matrix…", los dos de "CRITICAL risk control", "normaliza el nivel de riesgo…", "un control no puede nacer verificado" y "validates matrix state transition schemas". Conservar los de revisión, triggers, el registro legal y la vigencia. Si el test "todo nivel almacenable tiene etiqueta y color…" sigue siendo válido para las columnas legacy, conservarlo.

Borrar `lib/services/prevention-risk-import.ts` y `lib/services/prevention-risk-import.test.ts`. Las tablas `prevention_risk_import_*` quedan hasta F3.

- [ ] **Step 5: Recordatorios, PDTP, mapa y fixtures**

En `lib/services/pdtp/reminders.ts`, reemplazar la consulta de matrices y el bucle de la MIPER:

```ts
    db.select({
      id: preventionRiskMatrices.id,
      worksiteId: preventionRiskMatrices.worksiteId,
      title: preventionRiskMatrices.title,
      reviewState: preventionRiskMatrices.reviewState,
      updatedAt: preventionRiskMatrices.updatedAt,
    }).from(preventionRiskMatrices).where(and(
      inArray(preventionRiskMatrices.reviewState, ["in_review", "pending_approval"]),
      eq(preventionRiskMatrices.isLegacy, false),
    )),
```

```ts
  /* La firma pendiente sale del estado de revisión: en revisión técnica espera
   * a la Jefatura; pendiente de aprobación, a Legal y RRHH. Mismas reglas que
   * el servicio de flujo (lib/prevention/miper/states.ts). */
  for (const matrix of riskMatrices) {
    const permission = pendingSignaturePermission(matrix.reviewState)
    if (!permission) continue
    pending.push({
      entityType: "risk_matrix", entityId: matrix.id, worksiteId: matrix.worksiteId,
      title: matrix.title, status: matrix.reviewState, updatedAt: matrix.updatedAt,
      permission, href: `/prevencion/miper/${matrix.id}?tab=revision`,
    })
  }
```

Importar `pendingSignaturePermission` desde `@/lib/prevention/miper/states`, quitar el import de `MATRIX_TRANSITIONS` y `MATRIX_PERMISSION`, y agregar `and` a los imports de drizzle si falta.

En `lib/services/pdtp/connectors.ts:164`, cambiar `executePermission: "prevention:risk:publish"` por `executePermission: "prevention:risk:approve_legal"`.

En `lib/services/pdtp-adapters/fulfillment-contract-2026.ts` (N°35):
- `permission: "prevention:risk:approve_legal"`.
- `href: (w) => \`/prevencion/miper?faena=${w}\`` queda igual.
- `segregated: "Aprobar una versión de la matriz exige que la firme Legal y RRHH, distinto de quien la elaboró y de quien la revisó técnicamente."`.

En `app/(app)/prevencion/pdtp/[programId]/pdtp-destination-labels.ts:45`, reemplazar la clave `"prevention:risk:publish": "publicar controles de riesgo"` por `"prevention:risk:approve_legal": "aprobar la MIPER (Legal y RRHH)"`.

Mapa de riesgos:
- En `lib/services/prevention-risk-map.ts`, en la consulta de marcadores (alrededor de la línea 205), agregar `classification: preventionRiskEntries.classification`. En el objeto devuelto (alrededor de la línea 233), reemplazar `residualLevel: row.residualLevel` por `riskLevel: effectiveRiskLevel(row) ?? "medium"`. En el tipo de la línea 188, reemplazar `residualLevel: string` por `riskLevel: string`.
- En `risk-map-data.ts`, en el bucle: `(entriesByWorksite[worksiteId] ??= []).push({ id: entry.id, hazard: entry.hazard ?? "Peligro sin describir", riskLevel: effectiveRiskLevel(entry) ?? "medium" })`, con el tipo `{ id: string; hazard: string; riskLevel: string }`.
- En `risk-map-panel.tsx`, renombrar `residualLevel` a `riskLevel` en los dos tipos (líneas 24 y 39) y en los usos de las líneas 167 y 173.

Fixtures que insertan matrices con la forma antigua: agregar `isLegacy: true` al insert de `preventionRiskMatrices` en los cinco archivos listados en **Files**. Esas filas representan datos de la metodología anterior.

Suites contra Postgres real:
- En `lib/__tests__/prevention-risk-legal-postgres.test.ts`, borrar los casos que usan el flujo antiguo. Son los que llaman `createRiskMatrixDraft`, `addRiskEntry`, `transitionRiskMatrix`, `ensureIspRiskMethodology`, `getRiskDashboard` con matrices creadas así, `getPublishedRiskMatrix` o `importer.*`: los casos de las líneas 69, 177, 196, 236, 333, 377, 427, 458, 523, 595 y 674, más el helper de la línea 1199. Conservar los del registro legal (720 en adelante).
  - Si un caso legal depende de una matriz publicada, sembrarla con un insert directo (`status: "published"`, `isLegacy: true`, firmantes presentes).
  - El flujo MIPER en Postgres real queda cubierto por las pruebas PGlite de las Tasks 8–12. Esas pruebas usan el mismo motor de Postgres (WASM), así que no se pierde la verificación de columnas generadas ni de triggers.
- En `lib/__tests__/prevention-incidents-postgres.test.ts`, reemplazar el bloque "Publicación real de la MIPER que resuelve el disparador" (desde `const risk = await import(...)` hasta la publicación) por el flujo nuevo:

```ts
    const matricesSvc = await import("@/lib/services/miper/matrices")
    const entriesSvc = await import("@/lib/services/miper/entries")
    const workflow = await import("@/lib/services/miper/workflow")
    const riskAccess = (userId: string, permissions: string[]) => ({ userId, scope: { mode: "some" as const, ids: ["ws-incidents"] }, permissions })
    const riskAuthor = riskAccess("incident-reporter", ["prevention:risk:view", "prevention:risk:edit"])
    const riskReviewer = riskAccess("incident-verifier", ["prevention:risk:review"])
    const riskApprover = riskAccess("incident-risk-approver", ["prevention:risk:approve_legal"])
    const { id: matrixId } = await matricesSvc.createMiper({ worksiteId: "ws-incidents", period: 2026, revisionReason: "Revisión obligatoria por accidente grave con barrera de ingeniería fallida." }, riskAuthor)
    const [created] = await getDb().select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await matricesSvc.updateMiperHeader({
      matrixId, expectedVersion: created!.version, iperCode: "RE-04", elaboratedOn: "2026-07-01", updatedOn: null,
      companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Dirección", companyCommune: "Comuna", economicActivity: "Servicios",
      adherentNumber: null, worksiteName: "Faena incidentes", siteRepresentativeUserId: null, siteRepresentativeName: "Administrador de contrato",
      headcountTotal: 4, headcountMale: 4, headcountFemale: 0, headcountOther: 0, participationSummary: "", consultationEvidenceReference: "",
    }, riskAuthor)
    const entry = await entriesSvc.saveMiperEntry({ matrixId, values: { activity: "Clasificación de residuos", task: "Operar línea de clasificación", position: "Operador de línea", riskFactorId: "riskfactor-mecanico", hazard: "Contacto con zona de riesgo por barrera insuficiente", risk: "Atrapamiento", probableDamage: "Lesión grave con tiempo perdido", probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true } }, riskAuthor)
    await entriesSvc.saveMiperControl({ matrixId, entryId: entry.id, values: { hierarchy: "engineering", description: "Barrera física con enclavamiento en la línea", responsibleName: "Jefatura de operaciones", dueDate: "2026-09-30" } }, riskAuthor)
    let [m] = await getDb().select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await workflow.submitMiperForReview({ matrixId, expectedVersion: m!.version }, riskAuthor)
    ;[m] = await getDb().select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await workflow.approveMiperTechnicalReview({ matrixId, expectedVersion: m!.version }, riskReviewer)
    ;[m] = await getDb().select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await workflow.approveMiperFinal({ matrixId, expectedVersion: m!.version, changeSummary: "Actualización por accidente grave." }, riskApprover)
```

Después de ese bloque, la suite usa el id de la matriz publicada para resolver el disparador: pasar `matrixId` donde antes pasaba `matrix.id`. Los usuarios `incident-verifier` e `incident-risk-approver` ya existen en el seed de esa suite; verificarlo en su `seedFixture`.

- [ ] **Step 6: Acciones nuevas y página mínima**

```ts
// app/(app)/prevencion/miper/actions.ts
"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"
import { scheduleGeneratedDocumentDrain } from "@/lib/services/generated-documents/schedule"
import { resolveRiskReviewTrigger, verifyRiskControl } from "@/lib/services/prevention-risk-legal"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { deleteMiperControl, deleteMiperEntry, duplicateMiperEntry, saveMiperControl, saveMiperEntry } from "@/lib/services/miper/entries"
import { createMiper, discardMiperDraft, updateMiperHeader } from "@/lib/services/miper/matrices"
import { addMiperObservation, reopenMiperObservation, resolveMiperObservation, respondMiperObservation } from "@/lib/services/miper/observations"
import { saveRiskFactor, setRiskFactorActive } from "@/lib/services/miper/risk-factors"
import type { MiperAccess } from "@/lib/services/miper/shared"
import { approveMiperFinal, approveMiperTechnicalReview, openMiperReviewRound, requestMiperCorrections, returnMiperWithObservations, submitMiperForReview } from "@/lib/services/miper/workflow"
import type { ActionState } from "@/lib/validation/prevention"

const BASE = "/prevencion/miper"
type Session = NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>

function accessFrom(session: Session): MiperAccess {
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

function matrixIdOf(input: unknown) {
  return typeof input === "object" && input && "matrixId" in input ? String((input as { matrixId: unknown }).matrixId) : null
}

/**
 * El error de dominio viaja con su mensaje (le dice a la persona qué hacer);
 * Zod, con sus campos; el resto se loguea y responde genérico para no filtrar
 * detalles de driver o SQL.
 */
function fail(error: unknown): ActionState {
  if (error instanceof RiskLegalDomainError) return { ok: false, message: error.message }
  if (error instanceof ZodError) return actionErrorResult(error, "Revisa los campos marcados.")
  return unexpectedActionError(error, "prevencion/miper/actions")
}

async function guarded<T>(permission: Permission, input: unknown, operation: (access: MiperAccess) => Promise<T>, options: { revalidate?: boolean; data?: (result: T) => Record<string, unknown>; after?: (session: Session) => Promise<void> } = {}): Promise<ActionState> {
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  try {
    const result = await operation(accessFrom(guard.session))
    if (options.revalidate !== false) {
      revalidatePath(BASE)
      const matrixId = matrixIdOf(input)
      if (matrixId) revalidatePath(`${BASE}/${matrixId}`)
    }
    if (options.after) await options.after(guard.session)
    const data = options.data?.(result)
    return data ? { ok: true, data } : { ok: true }
  } catch (error) {
    return fail(error)
  }
}

// ── Matriz ──
export async function createMiperAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => createMiper(input, access), { data: (result) => ({ id: result.id }) })
}
export async function updateMiperHeaderAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => updateMiperHeader(input, access), { data: (result) => ({ version: result.version }) })
}
export async function discardMiperDraftAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => discardMiperDraft(input, access))
}

// ── Filas y medidas. Guardar una celda no revalida: la grilla conserva su
//    estado y sólo necesita la versión nueva. Los cambios de estructura sí. ──
export async function saveMiperEntryAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => saveMiperEntry(input, access), { revalidate: false, data: (result) => ({ ...result }) })
}
export async function duplicateMiperEntryAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => duplicateMiperEntry(input, access), { data: (result) => ({ ...result }) })
}
export async function deleteMiperEntryAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => deleteMiperEntry(input, access))
}
export async function saveMiperControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => saveMiperControl(input, access), { data: (result) => ({ ...result }) })
}
export async function deleteMiperControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => deleteMiperControl(input, access))
}

// ── Flujo ──
export async function submitMiperAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => submitMiperForReview(input, access))
}
/** Sólo marca la apertura; el servicio ignora a quien no revisa esa etapa. */
export async function openMiperRoundAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => openMiperReviewRound({ matrixId: matrixIdOf(input) ?? "" }, access), { revalidate: false })
}
export async function returnMiperAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => returnMiperWithObservations(input, access))
}
export async function approveMiperTechnicalAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => approveMiperTechnicalReview(input, access))
}
export async function requestMiperCorrectionsAction(input: unknown) {
  return guarded("prevention:risk:approve_legal", input, (access) => requestMiperCorrections(input, access))
}
export async function approveMiperFinalAction(input: unknown) {
  // La versión sellada se arma y archiva después de responder.
  return guarded("prevention:risk:approve_legal", input, (access) => approveMiperFinal(input, access), {
    data: (result) => ({ ...result }),
    after: (session) => scheduleGeneratedDocumentDrain(session.user.id),
  })
}

// ── Observaciones: el servicio exige el permiso de la etapa observada. ──
export async function addMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => addMiperObservation(input, access))
}
export async function respondMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => respondMiperObservation(input, access))
}
export async function resolveMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => resolveMiperObservation(input, access))
}
export async function reopenMiperObservationAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => reopenMiperObservation(input, access))
}

// ── Catálogo ──
export async function saveRiskFactorAction(input: unknown) {
  return guarded("prevention:risk:catalog:manage", input, (access) => saveRiskFactor(input, access))
}
export async function setRiskFactorActiveAction(input: unknown) {
  return guarded("prevention:risk:catalog:manage", input, (access) => setRiskFactorActive(input, access))
}

// ── Se conservan del módulo anterior ──
export async function resolveRiskReviewTriggerAction(input: unknown) {
  return guarded("prevention:risk:review", input, (access) => resolveRiskReviewTrigger(input, access))
}
export async function verifyRiskControlAction(input: unknown) {
  const state = await guarded("prevention:risk:edit", input, (access) => verifyRiskControl(input, access))
  // La ficha del control es una ruta dinámica.
  revalidatePath(`${BASE}/controles/[id]`, "page")
  return state
}
```

Página mínima, que la Task 16 reemplaza:

```tsx
// app/(app)/prevencion/miper/page.tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata: Metadata = { title: "Matriz IPER (MIPER)" }

export default async function MiperPage() {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  return (
    <PageContainer width="wide">
      <PageHeader title="Matriz IPER (MIPER)" description="Identificación de peligros y evaluación de riesgos por faena y período."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "MIPER" }]} />} />
      <EmptyState title="Portada en construcción" description="La bandeja y la lista de MIPER se habilitan en la siguiente tarea." />
    </PageContainer>
  )
}
```

- [ ] **Step 7: Verificación completa de lo tocado**

Run:

```bash
npm run typecheck
npm run lint
npm run test:fast -- "app/(app)/prevencion/miper/actions.test.ts" lib/__tests__/prevention-rbac.test.ts lib/services/pdtp/reminders-signature-pending.test.ts lib/__tests__/prevention-risk-legal.test.ts lib/__tests__/risk-map-ui-contract.test.ts
npm run test:pglite -- lib/__tests__/prevention-risk-control-ineffective-capa.test.ts lib/__tests__/prevention-permit-workflow-gates-pglite.test.ts
```

Expected: todo en verde. Después, correr una por una las dos suites Postgres reales contra el contenedor e2e. La memoria del proyecto dice cómo: las variables `PREVENTION_RISK_DATABASE_URL` y `PREVENTION_INCIDENTS_DATABASE_URL` apuntan a `127.0.0.1:55432/bodega_test_*`, con `…_ALLOW_DESTRUCTIVE_RESET=true`.

```bash
PREVENTION_RISK_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/bodega_test_risk" PREVENTION_RISK_ALLOW_DESTRUCTIVE_RESET=true npm run test:fast -- lib/__tests__/prevention-risk-legal-postgres.test.ts
PREVENTION_INCIDENTS_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/bodega_test_incidents" PREVENTION_INCIDENTS_ALLOW_DESTRUCTIVE_RESET=true npm run test:fast -- lib/__tests__/prevention-incidents-postgres.test.ts
```

Expected: "passed", no "skipped". Confirmar el prefijo exacto de la variable en el `assertSafeDestructiveDatabase({ context })` de cada archivo.

- [ ] **Step 8: Commit**

```bash
git add -A lib/services lib/validation lib/__tests__ "app/(app)/prevencion" "app/(app)/dashboard/sections/prevention-section.tsx" modules/prevention/manifest.ts e2e/setup-db.ts scripts/capture-all-routes.ts
git commit -m "refactor(miper): retirar el flujo y el importador antiguos; permisos Legal y RRHH; acciones del flujo RE-04"
```

---

#### Task 15: Libro RE-04 desde la versión sellada, descarga y archivado

**Files:**
- Rewrite: `lib/reports/miper-workbook.ts`
- Modify: `app/api/prevencion/miper/[id]/export/route.ts` y su `route.test.ts`
- Modify: `lib/services/generated-documents/renderers.ts:176-185`
- Test: `lib/reports/miper-workbook.test.ts`

**Interfaces:**
- Consumes: `getMiperVersion` y `getMiperVersionForArchive` (Task 12); `MiperSnapshot` y etiquetas (Task 3); `CLASSIFICATION_LABEL`, `PROBABILITY_LEVELS`, `CONSEQUENCE_LEVELS` y `CLASSIFICATION_CRITERIA` (Task 1).
- Produces:
  - `type MiperVersionDetail = Awaited<ReturnType<typeof getMiperVersion>>`
  - `buildMiperWorkbook(detail: MiperVersionDetail): Promise<ExcelJS.Workbook>`
  - `miperFilenameBase(detail: MiperVersionDetail): string`
  - La ruta `GET /api/prevencion/miper/[versionId]/export` descarga la versión sellada.

- [ ] **Step 1: Write the failing test**

```ts
// lib/reports/miper-workbook.test.ts
import { describe, expect, it } from "vitest"
import { buildMiperWorkbook, miperFilenameBase } from "./miper-workbook"

const snapshot = {
  header: {
    period: 2026, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: "2026-08-19",
    companyName: "Servicios Industriales Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero",
    economicActivity: "Transporte de lodo sanitario", adherentNumber: "252086", worksiteName: "Biodiversa",
    siteRepresentativeUserId: "u1", siteRepresentativeName: "Jean Paul Recart", headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0,
    participationSummary: "", consultationEvidenceReference: "",
  },
  entries: [{
    id: "e1", rowNumber: 1, activity: "Gestión documental", task: "Trabajo administrativo", position: "Prevención de riesgos", location: "Oficina",
    exposedFemale: 1, exposedMale: 0, exposedOther: 0, riskFactorId: "rf", riskFactor: "Locativo", isRoutine: true,
    hazard: "Desplazamiento interior", risk: "Caída a mismo nivel", probableDamage: "Esguinces", probability: 2, consequence: 2, magnitude: 4, classification: "moderate" as const,
    controlledStatus: "partial" as const,
    controls: [
      { id: "c1", hierarchy: "administrative" as const, description: "Orden y limpieza", responsibleUserId: null, responsibleName: "Prevención", dueDate: "2026-12-31", status: "proposed" },
      { id: "c2", hierarchy: "ppe" as const, description: "Calzado de seguridad", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-31", status: "proposed" },
    ],
  }],
}

const detail = {
  version: { id: "v1", matrixId: "m1", versionNumber: 2, period: 2026, roundId: "r", snapshot, snapshotSha256: "a".repeat(64), changeSummary: "Actualización DS 44",
    elaboratedByUserId: "u1", technicalReviewerUserId: "u2", approverUserId: "u3", elaboratedByName: "María José Martínez", technicalReviewerName: "Lorena Alvarado", approverName: "Gerencia Legal y RRHH", approvedAt: "2026-08-19T15:00:00.000Z" },
  worksiteId: "ws", worksiteName: "Biodiversa", worksiteCode: "BIO", methodologySnapshot: {},
  versions: [
    { versionNumber: 1, approvedAt: "2026-05-02T12:00:00.000Z", changeSummary: "Emisión inicial", approverName: "Gerencia Legal y RRHH", elaboratedByName: "María José Martínez" },
    { versionNumber: 2, approvedAt: "2026-08-19T15:00:00.000Z", changeSummary: "Actualización DS 44", approverName: "Gerencia Legal y RRHH", elaboratedByName: "María José Martínez" },
  ],
}

function allText(sheet: import("exceljs").Worksheet) {
  const values: string[] = []
  sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value ?? ""))))
  return values.join(" | ")
}

describe("libro RE-04", () => {
  it("tiene las hojas del formato y el encabezado con el representante en faena", async () => {
    const wb = await buildMiperWorkbook(detail as never)
    expect(wb.worksheets.map((s) => s.name)).toEqual(["RE-04 IPER", "Modificaciones", "Criterios de Evaluación IPER"])
    const text = allText(wb.getWorksheet("RE-04 IPER")!)
    expect(text).toContain("78.023.530-6")
    expect(text).toContain("REPRESENTANTE DE LA EMPRESA EN LA FAENA (ADMINISTRADOR DE CONTRATO)")
    expect(text).not.toContain("REPRESENTANTE LEGAL")
    expect(text).toContain("María José Martínez")
    expect(text).toContain("Lorena Alvarado")
  })
  it("cada medida es una línea con su tipo; la clasificación va en texto", async () => {
    const wb = await buildMiperWorkbook(detail as never)
    const text = allText(wb.getWorksheet("RE-04 IPER")!)
    expect(text).toContain("MODERADO")
    expect(text).toContain("IV. Controles administrativos: Orden y limpieza")
    expect(text).toContain("V. Elementos de protección personal: Calzado de seguridad")
    expect(text).toContain("Parcialmente")
  })
  it("Modificaciones lista las versiones y el nombre de archivo lleva faena, período y versión", async () => {
    const wb = await buildMiperWorkbook(detail as never)
    expect(allText(wb.getWorksheet("Modificaciones")!)).toContain("Emisión inicial")
    expect(miperFilenameBase(detail as never)).toBe("RE-04-MIPER-BIO-2026-v2")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/reports/miper-workbook.test.ts`
Expected: FAIL: la firma y las hojas son las antiguas.

- [ ] **Step 3: Write the implementation**

```ts
// lib/reports/miper-workbook.ts
/**
 * Libro Excel RE-04 de una versión SELLADA de la MIPER. Lo comparten la
 * descarga (`app/api/prevencion/miper/[id]/export`) y el archivado automático
 * al aprobar, así que la copia archivada es el mismo libro que se descarga. Se
 * arma desde la foto de la versión, nunca desde los datos vivos: lo que se
 * archiva es exactamente lo que se aprobó. La hoja "Programa de Trabajo" llega
 * en F2.
 */
import ExcelJS from "exceljs"
import { sanitizeCell as safe } from "@/lib/reports/export-module/excel-builder"
import { CLASSIFICATION_CRITERIA, CLASSIFICATION_LABEL, CONSEQUENCE_LEVELS, PROBABILITY_LEVELS, RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import { CONTROL_HIERARCHY_LABEL, CONTROLLED_STATUS_LABEL, type MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import type { getMiperVersion } from "@/lib/services/miper/queries"
import { formatDate } from "@/lib/utils"

export type MiperVersionDetail = Awaited<ReturnType<typeof getMiperVersion>>

const FILL: Record<string, string> = { tolerable: "FFD9EAD3", moderate: "FFFFF2CC", important: "FFF4CCCC", intolerable: "FFC00000" }
const HEADER_FILL = "FF1F3864"

function headerStyle(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } }
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } } })
}

export function miperFilenameBase(detail: MiperVersionDetail) {
  return `RE-04-MIPER-${detail.worksiteCode}-${detail.version.period ?? "sin-periodo"}-v${detail.version.versionNumber}`
}

export async function buildMiperWorkbook(detail: MiperVersionDetail) {
  const snapshot = detail.version.snapshot as MiperSnapshot
  const h = snapshot.header
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma CHOME"

  const sheet = workbook.addWorksheet("RE-04 IPER", {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "12:13" },
  })
  sheet.mergeCells("A1:U1")
  sheet.getCell("A1").value = "Matriz de Identificación de Peligros y Evaluación de Riesgos (IPER)"
  sheet.getCell("A1").font = { bold: true, size: 14 }
  const headerRows: Array<[string, string, string, string]> = [
    ["CÓDIGO IPER", safe(h.iperCode ?? "RE-04"), "FECHA ELABORACIÓN", h.elaboratedOn ? formatDate(h.elaboratedOn) : ""],
    ["RAZÓN SOCIAL", safe(h.companyName ?? ""), "FECHA ACTUALIZACIÓN", h.updatedOn ? formatDate(h.updatedOn) : ""],
    ["RUT EMPLEADOR", safe(h.companyRut ?? ""), "PERÍODO / VERSIÓN", `${h.period ?? ""} · v${detail.version.versionNumber}`],
    ["DIRECCIÓN / COMUNA", safe([h.companyAddress, h.companyCommune].filter(Boolean).join(", ")), "N° DE ADHERENTE", safe(h.adherentNumber ?? "")],
    ["ACTIVIDAD ECONÓMICA PRINCIPAL", safe(h.economicActivity ?? ""), "NOMBRE CENTRO DE TRABAJO", safe(h.worksiteName ?? detail.worksiteName)],
    ["REPRESENTANTE DE LA EMPRESA EN LA FAENA (ADMINISTRADOR DE CONTRATO)", safe(h.siteRepresentativeName ?? ""), "N° TRABAJADORES (TOTAL / H / M / OTRO)", `${h.headcountTotal ?? ""} / ${h.headcountMale ?? ""} / ${h.headcountFemale ?? ""} / ${h.headcountOther ?? ""}`],
    ["NOMBRE QUIEN ELABORÓ", safe(detail.version.elaboratedByName), "NOMBRE QUIEN REVISÓ", safe(detail.version.technicalReviewerName)],
    ["NOMBRE QUIEN APROBÓ (LEGAL Y RRHH)", safe(detail.version.approverName), "FECHA DE APROBACIÓN", formatDate(detail.version.approvedAt)],
  ]
  headerRows.forEach(([labelA, valueA, labelB, valueB], index) => {
    const row = sheet.getRow(3 + index)
    row.getCell(1).value = labelA; row.getCell(4).value = valueA
    row.getCell(11).value = labelB; row.getCell(14).value = valueB
    row.getCell(1).font = { bold: true }; row.getCell(11).font = { bold: true }
  })

  const top = sheet.getRow(12)
  const labels = ["N°", "ACTIVIDAD", "TAREA", "PUESTO DE TRABAJO", "LUGAR DE TRABAJO ESPECÍFICO", "N° DE TRABAJADORES", "", "", "FACTORES DE RIESGO", "RUTINARIA / NO RUTINARIA", "PELIGRO", "RIESGO", "DAÑO PROBABLE", "EVALUACIÓN DEL RIESGO", "", "", "", "MEDIDA DE CONTROL", "¿ESTÁ CONTROLADO EL RIESGO?", "RESPONSABLE", "PLAZOS"]
  labels.forEach((label, index) => { top.getCell(index + 1).value = label })
  const sub = sheet.getRow(13)
  ;[[6, "F"], [7, "M"], [8, "OTRO"], [14, "PROBABILIDAD"], [15, "CONSECUENCIA"], [16, "MR"], [17, "CLASIFICACIÓN DEL RIESGO"]].forEach(([col, label]) => { sub.getCell(col as number).value = label as string })
  sheet.mergeCells("F12:H12"); sheet.mergeCells("N12:Q12")
  for (const col of [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 18, 19, 20, 21]) sheet.mergeCells(12, col, 13, col)
  headerStyle(top); headerStyle(sub)

  for (const entry of snapshot.entries) {
    const measures = entry.controls.map((control) => `${CONTROL_HIERARCHY_LABEL[control.hierarchy]}: ${control.description}`).join("\n")
    const responsible = [...new Set(entry.controls.map((control) => control.responsibleName).filter(Boolean))].join("\n")
    const deadlines = entry.controls.map((control) => (control.dueDate ? formatDate(control.dueDate) : "")).filter(Boolean).join("\n")
    const row = sheet.addRow([
      entry.rowNumber, safe(entry.activity ?? ""), safe(entry.task ?? ""), safe(entry.position ?? ""), safe(entry.location ?? ""),
      entry.exposedFemale, entry.exposedMale, entry.exposedOther, safe(entry.riskFactor ?? ""),
      entry.isRoutine === null ? "" : entry.isRoutine ? "Rutinaria" : "No rutinaria",
      safe(entry.hazard ?? ""), safe(entry.risk ?? ""), safe(entry.probableDamage ?? ""),
      entry.probability ?? "", entry.consequence ?? "", entry.magnitude ?? "",
      entry.classification ? CLASSIFICATION_LABEL[entry.classification].toUpperCase() : "",
      safe(measures), entry.controlledStatus ? CONTROLLED_STATUS_LABEL[entry.controlledStatus] : "", safe(responsible), deadlines,
    ])
    row.alignment = { vertical: "top", wrapText: true }
    if (entry.classification) {
      const cell = row.getCell(17)
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[entry.classification]! } }
      cell.font = { bold: true, color: { argb: entry.classification === "intolerable" ? "FFFFFFFF" : "FF000000" } }
    }
  }
  const widths = [5, 22, 22, 20, 20, 5, 5, 6, 16, 13, 28, 24, 26, 8, 8, 6, 14, 48, 14, 20, 12]
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: 13 }]

  const changes = workbook.addWorksheet("Modificaciones")
  headerStyle(changes.addRow(["Revisión", "Fecha", "Modificaciones", "Responsable", "Aprobó"]))
  for (const version of detail.versions) changes.addRow([version.versionNumber, formatDate(version.approvedAt), safe(version.changeSummary), safe(version.elaboratedByName), safe(version.approverName)])
  changes.columns = [{ width: 10 }, { width: 14 }, { width: 70 }, { width: 28 }, { width: 28 }]

  const criteria = workbook.addWorksheet("Criterios de Evaluación IPER")
  headerStyle(criteria.addRow(["PROBABILIDAD", "VALOR", "CRITERIO"]))
  for (const level of PROBABILITY_LEVELS) criteria.addRow([level.label, level.value, level.description])
  criteria.addRow([])
  headerStyle(criteria.addRow(["CONSECUENCIA", "VALOR", "CRITERIO"]))
  for (const level of CONSEQUENCE_LEVELS) criteria.addRow([level.label, level.value, level.description])
  criteria.addRow([])
  headerStyle(criteria.addRow(["CLASIFICACIÓN", "MR", "CRITERIO"]))
  const bandMr: Record<string, string> = { tolerable: "1 - 2", moderate: "4", important: "8", intolerable: "16" }
  for (const classification of RISK_CLASSIFICATIONS) criteria.addRow([CLASSIFICATION_LABEL[classification].toUpperCase(), bandMr[classification], CLASSIFICATION_CRITERIA[classification]])
  criteria.columns = [{ width: 30 }, { width: 10 }, { width: 110 }]
  criteria.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true } })

  return workbook
}
```

Ruta de descarga (`app/api/prevencion/miper/[id]/export/route.ts`): reemplazar el cuerpo del `try`.

```ts
    const { id } = await params
    const detail = await getMiperVersion(id, { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
    const workbook = await buildMiperWorkbook(detail)
    const entryCount = (detail.version.snapshot as { entries: unknown[] }).entries.length
    addExportMetadataSheet(workbook, session, { filters: { worksiteId: detail.worksiteId, versionId: detail.version.id, versionNumber: detail.version.versionNumber, snapshotSha256: detail.version.snapshotSha256 }, rowCount: entryCount })
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export", entityType: "prevention_risk_matrix_version", entityId: detail.version.id, entityCode: `MIPER-${detail.version.period}-v${detail.version.versionNumber}`, newState: { sheetCount: workbook.worksheets.length, entryCount, snapshotSha256: detail.version.snapshotSha256 }, reason: "Exportación Excel de versión MIPER sellada" })
    const bytes = await workbook.xlsx.writeBuffer()
    return new NextResponse(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": encodeContentDisposition(`${miperFilenameBase(detail)}.xlsx`, "attachment"), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
```

Cambiar el import `getPublishedRiskMatrix` por `import { getMiperVersion } from "@/lib/services/miper/queries"`. En `route.test.ts`, cambiar el mock a `vi.mock("@/lib/services/miper/queries", () => ({ getMiperVersion: mockGetMiperVersion }))` y el fixture a la forma `detail` de la Step 1. Mantener las aserciones de 401, 403, 404 y cabeceras.

En el renderer (`lib/services/generated-documents/renderers.ts`), reemplazar `produceMiper`:

```ts
async function produceMiper(row: Row): Promise<ProducedDocument> {
  // Desde F1 la entidad archivada es la versión sellada (inmutable). Una fila
  // en cola que apunte a una matriz del modelo anterior ya no tiene libro que
  // armar: se da por reemplazada.
  let detail
  try { detail = await getMiperVersionForArchive(row.entityId) } catch { return SUPERSEDED }
  const workbook = await buildMiperWorkbook(detail)
  const data = await workbook.xlsx.writeBuffer()
  return { outcome: "document", buffer: xlsxBuffer(data as ArrayBuffer), baseName: miperFilenameBase(detail) }
}
```

Actualizar los imports: quitar `preventionRiskMatrices` si queda sin uso y `getPublishedRiskMatrixForArchive`, y agregar `getMiperVersionForArchive`. En `lib/services/generated-documents/kinds.ts:64`, cambiar el `label` a `"Matriz MIPER aprobada (versión sellada)"`.

- [ ] **Step 4: Run tests**

Run: `npm run test:fast -- lib/reports/miper-workbook.test.ts "app/api/prevencion/miper" lib/services/generated-documents && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/reports/miper-workbook.ts lib/reports/miper-workbook.test.ts app/api/prevencion/miper lib/services/generated-documents
git commit -m "feat(miper): libro RE-04 desde la versión sellada para descarga y archivado"
```

---

#### Task 16: Componentes compartidos, portada, nueva MIPER y catálogo de factores

**Files:**
- Create: `components/prevention/risk-classification-badge.tsx`, `components/prevention/pc-select.tsx`
- Create: `lib/prevention/miper/grid-view.ts` (filtros y agrupación puros; los usa la Task 18)
- Rewrite: `app/(app)/prevencion/miper/page.tsx`
- Create: `app/(app)/prevencion/miper/miper-home.tsx`, `app/(app)/prevencion/miper/new-miper-dialog.tsx`
- Create: `app/(app)/prevencion/miper/factores/page.tsx`, `app/(app)/prevencion/miper/factores/risk-factors-admin.tsx`
- Modify: `components/layout/top-bar.tsx:33,77` (buscador propio en el espacio de trabajo)
- Test: `components/prevention/risk-classification-badge.test.tsx`, `components/prevention/pc-select.test.tsx`, `lib/prevention/miper/grid-view.test.ts`, `components/layout/top-bar-own-search.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 12 y 14.
- Produces:
  - `RiskClassificationBadge({ classification: RiskClassification | null; magnitude?: number | null; size?: "sm" | "md" })`
  - `PcSelect({ kind: "probability" | "consequence"; value: number | null; onChange: (value: 1 | 2 | 4 | null) => void; id?: string; ariaLabel: string; disabled?: boolean; showDescription?: boolean; className?: string })`
  - `grid-view.ts`:
    - `type GridFilters = { search: string; classifications: RiskClassification[]; controlled: ControlledStatus | "all"; factorId: string; onlyObserved: boolean; onlyModified: boolean }`
    - `EMPTY_FILTERS: GridFilters`
    - `type GroupBy = "none" | "activity" | "position" | "classification"`
    - `filterRows(rows: MiperEntrySnapshot[], filters: GridFilters, ctx: { observed: ReadonlySet<string>; modified: ReadonlySet<string> }): MiperEntrySnapshot[]`
    - `groupRows(rows: MiperEntrySnapshot[], by: GroupBy): Array<{ key: string; label: string; rows: MiperEntrySnapshot[] }>`
  - `hidesShellSearch(pathname: string): boolean`, exportado desde `top-bar.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/prevention/risk-classification-badge.test.tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RiskClassificationBadge } from "./risk-classification-badge"

describe("RiskClassificationBadge", () => {
  it("siempre muestra el nombre, no sólo el color", () => {
    const { getByText } = render(<RiskClassificationBadge classification="intolerable" magnitude={16} />)
    expect(getByText(/Intolerable/)).toBeTruthy()
    expect(getByText(/16/)).toBeTruthy()
  })
  it("Intolerable es relleno sólido; los demás, tinte con texto -ink", () => {
    const solid = render(<RiskClassificationBadge classification="intolerable" />).container.firstElementChild!
    expect(solid.className).toContain("bg-[var(--color-danger)]")
    const tint = render(<RiskClassificationBadge classification="moderate" />).container.firstElementChild!
    expect(tint.className).toContain("text-[var(--color-warning-ink)]")
  })
  it("sin P o C dice 'Sin evaluar'", () => {
    expect(render(<RiskClassificationBadge classification={null} />).getByText("Sin evaluar")).toBeTruthy()
  })
})
```

```tsx
// components/prevention/pc-select.test.tsx
// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PcSelect } from "./pc-select"

describe("PcSelect", () => {
  it("ofrece Baja, Media y Alta con su valor y devuelve número", () => {
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(<PcSelect kind="probability" value={null} onChange={onChange} ariaLabel="Probabilidad fila 1" />)
    const select = getByLabelText("Probabilidad fila 1") as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(["—", "Baja (1)", "Media (2)", "Alta (4)"])
    fireEvent.change(getByRole("combobox"), { target: { value: "4" } })
    expect(onChange).toHaveBeenCalledWith(4)
  })
  it("con showDescription muestra el criterio del nivel elegido", () => {
    const { getByText } = render(<PcSelect kind="consequence" value={4} onChange={() => {}} ariaLabel="Consecuencia" showDescription />)
    expect(getByText(/amputaciones/)).toBeTruthy()
  })
})
```

```ts
// lib/prevention/miper/grid-view.test.ts
import { describe, expect, it } from "vitest"
import { EMPTY_FILTERS, filterRows, groupRows } from "./grid-view"
import type { MiperEntrySnapshot } from "./snapshot"

const row = (id: string, over: Partial<MiperEntrySnapshot>): MiperEntrySnapshot => ({
  id, rowNumber: 1, activity: null, task: null, position: null, location: null, exposedFemale: 0, exposedMale: 0, exposedOther: 0,
  riskFactorId: null, riskFactor: null, isRoutine: null, hazard: null, risk: null, probableDamage: null, probability: null, consequence: null,
  magnitude: null, classification: null, controlledStatus: null, controls: [], ...over,
})
const rows = [
  row("a", { rowNumber: 1, activity: "Transporte", position: "Conductor", hazard: "Camión en pendiente", classification: "intolerable", controlledStatus: "no", riskFactorId: "rf-mec" }),
  row("b", { rowNumber: 2, activity: "Transporte", position: "Peoneta", hazard: "Ruido", classification: "tolerable", controlledStatus: "yes", riskFactorId: "rf-fis" }),
  row("c", { rowNumber: 3, activity: "Oficina", position: "Conductor", hazard: "Pantalla", classification: "important", controlledStatus: "partial" }),
]
const ctx = { observed: new Set(["c"]), modified: new Set(["b"]) }

describe("vista de la grilla", () => {
  it("busca sin tildes en actividad, tarea, puesto, peligro, riesgo y medidas", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, search: "camion" }, ctx).map((r) => r.id)).toEqual(["a"])
  })
  it("filtra por clasificación, controlado, factor, observadas y modificadas", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, classifications: ["important", "intolerable"] }, ctx).map((r) => r.id)).toEqual(["a", "c"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, controlled: "no" }, ctx).map((r) => r.id)).toEqual(["a"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, factorId: "rf-fis" }, ctx).map((r) => r.id)).toEqual(["b"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, onlyObserved: true }, ctx).map((r) => r.id)).toEqual(["c"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, onlyModified: true }, ctx).map((r) => r.id)).toEqual(["b"])
  })
  it("agrupa por actividad, puesto o clasificación (de mayor a menor gravedad)", () => {
    expect(groupRows(rows, "activity").map((g) => [g.label, g.rows.length])).toEqual([["Oficina", 1], ["Transporte", 2]])
    expect(groupRows(rows, "classification").map((g) => g.label)).toEqual(["Intolerable", "Importante", "Tolerable"])
    expect(groupRows(rows, "none")).toEqual([{ key: "all", label: "", rows }])
  })
})
```

```ts
// components/layout/top-bar-own-search.test.ts
import { describe, expect, it } from "vitest"
import { hidesShellSearch } from "./top-bar"

describe("buscador de la shell", () => {
  it("se oculta en el espacio de trabajo de una MIPER (dos tablas, buscadores propios)", () => {
    expect(hidesShellSearch("/prevencion/miper/riskmatrix-abc")).toBe(true)
  })
  it("se mantiene en la portada, el catálogo y la ficha de control", () => {
    expect(hidesShellSearch("/prevencion/miper")).toBe(false)
    expect(hidesShellSearch("/prevencion/miper/factores")).toBe(false)
    expect(hidesShellSearch("/prevencion/miper/controles/ctrl-1")).toBe(false)
  })
})
```

Si importar `top-bar.tsx` en un test de entorno `node` falla porque el módulo es de cliente, mover `ROUTES_WITH_OWN_SEARCH`, `FORM_ROUTE` y `hidesShellSearch` a `components/layout/top-bar-search-routes.ts`, importarlos desde ahí en `top-bar.tsx` y ajustar el import del test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- components/prevention lib/prevention/miper/grid-view.test.ts components/layout/top-bar-own-search.test.ts`
Expected: FAIL (módulos y export inexistentes).

- [ ] **Step 3: Componentes compartidos y vista de grilla**

```tsx
// components/prevention/risk-classification-badge.tsx
import { CheckCircle, Info, Warning, WarningOctagon } from "@phosphor-icons/react/dist/ssr"
import { CLASSIFICATION_LABEL, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { cn } from "@/lib/utils"

/* El color nunca es la única señal (§8.3 del spec): rótulo + ícono + forma.
 * Texto siempre con tokens -ink; el Intolerable, relleno sólido y texto blanco. */
const STYLE: Record<RiskClassification, { className: string; Icon: typeof Info }> = {
  tolerable: { className: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]", Icon: CheckCircle },
  moderate: { className: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]", Icon: Info },
  important: { className: "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)] border border-[var(--color-danger-line)]", Icon: Warning },
  intolerable: { className: "bg-[var(--color-danger)] text-white font-semibold", Icon: WarningOctagon },
}

export function RiskClassificationBadge({ classification, magnitude, size = "md" }: { classification: RiskClassification | null; magnitude?: number | null; size?: "sm" | "md" }) {
  if (!classification) return <span className="text-xs text-[var(--color-text-subtle)]">Sin evaluar</span>
  const { className, Icon } = STYLE[classification]
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md", size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-xs", className)}>
      <Icon aria-hidden weight="bold" className="size-3.5" />
      {CLASSIFICATION_LABEL[classification]}
      {typeof magnitude === "number" ? <span className="tabular-nums opacity-90">· MR {magnitude}</span> : null}
    </span>
  )
}
```

```tsx
// components/prevention/pc-select.tsx
"use client"

import { CONSEQUENCE_LEVELS, PROBABILITY_LEVELS, isScaleValue, type MiperScaleValue } from "@/lib/prevention/miper/methodology"
import { cn } from "@/lib/utils"

/**
 * Probabilidad o consecuencia RE-04. `<select>` nativo a propósito: en una
 * grilla de cientos de filas un popover por celda pesa, y el nativo ya da
 * teclado y lector de pantalla. El criterio del nivel va en `title` (grilla) o
 * visible debajo (`showDescription`, en la ficha de la fila).
 */
export function PcSelect({ kind, value, onChange, id, ariaLabel, disabled, showDescription, className }: {
  kind: "probability" | "consequence"
  value: number | null
  onChange: (value: MiperScaleValue | null) => void
  id?: string
  ariaLabel: string
  disabled?: boolean
  showDescription?: boolean
  className?: string
}) {
  const levels = kind === "probability" ? PROBABILITY_LEVELS : CONSEQUENCE_LEVELS
  const selected = levels.find((level) => level.value === value)
  return (
    <div className="min-w-0">
      <select
        id={id}
        aria-label={ariaLabel}
        title={selected?.description}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => {
          const next = Number(event.target.value)
          onChange(isScaleValue(next) ? next : null)
        }}
        className={cn("h-8 w-full rounded-md border border-[var(--color-border)] bg-white px-1.5 text-sm disabled:opacity-60", className)}
      >
        <option value="">—</option>
        {levels.map((level) => <option key={level.value} value={level.value} title={level.description}>{`${level.label.split(" (")[0]} (${level.value})`}</option>)}
      </select>
      {showDescription && selected ? <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{selected.description}</p> : null}
    </div>
  )
}
```

```ts
// lib/prevention/miper/grid-view.ts
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, type RiskClassification } from "./methodology"
import { normalizeMiperName } from "./names"
import type { ControlledStatus, MiperEntrySnapshot } from "./snapshot"

export type GridFilters = {
  search: string
  classifications: RiskClassification[]
  controlled: ControlledStatus | "all"
  factorId: string
  onlyObserved: boolean
  onlyModified: boolean
}
export const EMPTY_FILTERS: GridFilters = { search: "", classifications: [], controlled: "all", factorId: "all", onlyObserved: false, onlyModified: false }
export type GroupBy = "none" | "activity" | "position" | "classification"

export function activeFilterCount(filters: GridFilters) {
  return (filters.search ? 1 : 0) + (filters.classifications.length ? 1 : 0) + (filters.controlled !== "all" ? 1 : 0)
    + (filters.factorId !== "all" ? 1 : 0) + (filters.onlyObserved ? 1 : 0) + (filters.onlyModified ? 1 : 0)
}

export function filterRows(rows: MiperEntrySnapshot[], filters: GridFilters, ctx: { observed: ReadonlySet<string>; modified: ReadonlySet<string> }) {
  const needle = normalizeMiperName(filters.search)
  return rows.filter((row) => {
    if (needle) {
      const haystack = normalizeMiperName([row.activity, row.task, row.position, row.location, row.hazard, row.risk, row.probableDamage, ...row.controls.map((c) => c.description)].filter(Boolean).join(" "))
      if (!haystack.includes(needle)) return false
    }
    if (filters.classifications.length && (!row.classification || !filters.classifications.includes(row.classification))) return false
    if (filters.controlled !== "all" && row.controlledStatus !== filters.controlled) return false
    if (filters.factorId !== "all" && row.riskFactorId !== filters.factorId) return false
    if (filters.onlyObserved && !ctx.observed.has(row.id)) return false
    if (filters.onlyModified && !ctx.modified.has(row.id)) return false
    return true
  })
}

export function groupRows(rows: MiperEntrySnapshot[], by: GroupBy) {
  if (by === "none") return [{ key: "all", label: "", rows }]
  const groups = new Map<string, MiperEntrySnapshot[]>()
  for (const row of rows) {
    const key = by === "activity" ? row.activity ?? "" : by === "position" ? row.position ?? "" : row.classification ?? ""
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const entries = [...groups.entries()]
  if (by === "classification") {
    const order = [...RISK_CLASSIFICATIONS].reverse() as string[]
    entries.sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    return entries.map(([key, groupRows]) => ({ key: key || "none", label: key ? CLASSIFICATION_LABEL[key as RiskClassification] : "Sin evaluar", rows: groupRows }))
  }
  entries.sort(([a], [b]) => (a || "￿").localeCompare(b || "￿", "es"))
  return entries.map(([key, groupRows]) => ({ key: key || "none", label: key || (by === "activity" ? "Sin actividad" : "Sin puesto"), rows: groupRows }))
}
```

En `components/layout/top-bar.tsx`, después de `FORM_ROUTE`:

```ts
/** El espacio de trabajo de una MIPER tiene dos tablas (matriz y programa)
 *  con buscadores propios rotulados: la regla de búsqueda pide ocultar el de
 *  la shell. La portada, el catálogo y la ficha de control lo conservan. */
const OWN_SEARCH_PATTERNS = [/^\/prevencion\/miper\/(?!factores(?:\/|$)|controles(?:\/|$))[^/]+$/]

export function hidesShellSearch(pathname: string) {
  return ROUTES_WITH_OWN_SEARCH.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || OWN_SEARCH_PATTERNS.some((pattern) => pattern.test(pathname))
    || FORM_ROUTE.test(pathname)
}
```

Reemplazar el cálculo de `hideSearch` (línea 77) por `const hideSearch = hidesShellSearch(pathname)`.

- [ ] **Step 4: Portada y nueva MIPER**

```tsx
// app/(app)/prevencion/miper/page.tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listMiperCreationOptions, listMiperInbox, listMipers } from "@/lib/services/miper/queries"
import { codeYear } from "@/lib/utils"
import { MiperHome } from "./miper-home"

export const metadata: Metadata = { title: "Matriz IPER (MIPER)" }

type SearchParams = { tab?: string; faena?: string; periodo?: string; estado?: string }

export default async function MiperPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const params = await searchParams
  const period = params.periodo && /^\d{4}$/.test(params.periodo) ? Number(params.periodo) : undefined
  const canEdit = can(session, "prevention:risk:edit")
  const [inbox, all, creation] = await Promise.all([
    listMiperInbox(access),
    listMipers(access, { worksiteId: params.faena || undefined, period, state: params.estado || undefined }),
    canEdit ? listMiperCreationOptions(access) : Promise.resolve({ worksites: [] }),
  ])
  return (
    <MiperHome
      inbox={inbox}
      all={all}
      creationWorksites={creation.worksites}
      currentYear={codeYear()}
      permissions={{ canEdit, canManageCatalog: can(session, "prevention:risk:catalog:manage") }}
    />
  )
}
```

Comprobar que `codeYear()` sin argumentos devuelve el año de hoy en Chile (su firma está en `lib/utils`). Si exige una fecha, usar `codeYear(todayInChile())`.

```tsx
// app/(app)/prevencion/miper/miper-home.tsx
"use client"

import Link from "next/link"
import { useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import { formatDate } from "@/lib/utils"
import type { MiperListRow } from "@/lib/services/miper/queries"
import { NewMiperDialog, type CreationWorksite } from "./new-miper-dialog"

const TABS = new Set(["porhacer", "todas"])
const STATE_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "draft", label: "Borrador" },
  { value: "in_review", label: "En revisión técnica" },
  { value: "observed", label: "Con observaciones" },
  { value: "pending_approval", label: "Pendiente Legal y RRHH" },
  { value: "published", label: "Vigente" },
  { value: "superseded", label: "Reemplazado" },
]

function Distribution({ row }: { row: MiperListRow }) {
  const present = [...RISK_CLASSIFICATIONS].reverse().filter((cls) => row.classificationCounts[cls] > 0)
  if (present.length === 0) return <span className="text-xs text-[var(--color-text-subtle)]">Sin riesgos evaluados</span>
  return <span className="flex flex-wrap gap-1">{present.map((cls) => <span key={cls} className="inline-flex items-center gap-1"><RiskClassificationBadge classification={cls} size="sm" /><span className="text-xs tabular-nums">{row.classificationCounts[cls]}</span></span>)}</span>
}

export function MiperHome({ inbox, all, creationWorksites, currentYear, permissions }: {
  inbox: MiperListRow[]
  all: MiperListRow[]
  creationWorksites: CreationWorksite[]
  currentYear: number
  permissions: { canEdit: boolean; canManageCatalog: boolean }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = TABS.has(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "porhacer"
  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== "all" && !(key === "tab" && value === "porhacer")) params.set(key, value)
    else params.delete(key)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "?", { scroll: false })
  }, [router, searchParams])
  const worksiteOptions = [...new Map(all.map((row) => [row.worksiteId, row.worksiteName])).entries()]
  const periodOptions = [...new Set(all.map((row) => row.period).filter((p): p is number => p !== null))].sort((a, b) => b - a)

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Matriz IPER (MIPER)"
        description="Identificación de peligros y evaluación de riesgos por faena y período, con revisión técnica y aprobación Legal y RRHH."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "MIPER" }]} />}
        actions={<div className="flex gap-2">
          {permissions.canManageCatalog && <Button asChild variant="secondary"><Link href="/prevencion/miper/factores">Factores de riesgo</Link></Button>}
          {permissions.canEdit && <NewMiperDialog worksites={creationWorksites} currentYear={currentYear} />}
        </div>}
      />
      <Tabs value={tab} onValueChange={(value) => setParam("tab", value)}>
        <TabsList>
          <TabsTrigger value="porhacer">Por hacer ({inbox.length})</TabsTrigger>
          <TabsTrigger value="todas">Todas</TabsTrigger>
        </TabsList>
        <TabsContent value="porhacer" className="space-y-2">
          {inbox.length === 0 ? (
            <EmptyState
              title="No tienes MIPER pendientes"
              description={permissions.canEdit ? "Cuando tengas un borrador, observaciones por responder o cambios sin enviar, aparecerán aquí. Para empezar, crea la MIPER de una faena." : "Cuando una MIPER espere tu revisión o tu firma, aparecerá aquí."}
              action={permissions.canEdit ? <NewMiperDialog worksites={creationWorksites} currentYear={currentYear} /> : undefined}
            />
          ) : inbox.map((row) => (
            <Link key={row.id} href={`/prevencion/miper/${row.id}`} className="block rounded-2xl border border-slate-200/70 bg-white p-4 hover:border-[var(--color-border-strong)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-signal-ink)]">{row.inboxReason}</p>
                  <p className="mt-1 font-semibold">{row.worksiteName} · {row.period ?? "sin período"}</p>
                  <p className="text-sm text-[var(--color-text-subtle)]">{row.label}{row.submittedByName ? ` · enviada por ${row.submittedByName}${row.submittedAt ? ` el ${formatDate(row.submittedAt)}` : ""}` : ""} · {row.entryCount} riesgos · modificada {formatDate(row.updatedAt)}</p>
                </div>
                <Distribution row={row} />
              </div>
            </Link>
          ))}
        </TabsContent>
        <TabsContent value="todas" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={searchParams.get("faena") ?? "all"} onValueChange={(value) => setParam("faena", value)}>
              <SelectTrigger aria-label="Faena" className="w-56"><SelectValue placeholder="Todas las faenas" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksiteOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={searchParams.get("periodo") ?? "all"} onValueChange={(value) => setParam("periodo", value)}>
              <SelectTrigger aria-label="Período" className="w-40"><SelectValue placeholder="Todos los períodos" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los períodos</SelectItem>{periodOptions.map((period) => <SelectItem key={period} value={String(period)}>{period}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={searchParams.get("estado") ?? "all"} onValueChange={(value) => setParam("estado", value)}>
              <SelectTrigger aria-label="Estado" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{STATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DataTable
            caption="MIPER por faena y período"
            columns={[
              { key: "worksiteName", label: "Faena", sortable: true },
              { key: "period", label: "Período", sortable: true },
              { key: "label", label: "Estado" },
              { key: "entryCount", label: "Riesgos", numeric: true },
              { key: "distribution", label: "Clasificación" },
              { key: "updatedAt", label: "Modificada", sortable: true },
            ]}
            rows={all as unknown as Record<string, unknown>[]}
            searchKeys={["worksiteName", "label"]}
            emptyTitle="Sin MIPER para estos filtros"
            emptyDescription={permissions.canEdit ? "Cambia los filtros o crea la MIPER de una faena." : "Cambia los filtros para ver otras faenas o períodos."}
            renderRow={(raw) => {
              const row = raw as unknown as MiperListRow
              return (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/prevencion/miper/${row.id}`)}>
                  <TableCell><Link href={`/prevencion/miper/${row.id}`} className="font-medium hover:underline">{row.worksiteName}</Link></TableCell>
                  <TableCell>{row.period ?? "—"}</TableCell>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="tabular-nums">{row.entryCount}</TableCell>
                  <TableCell><Distribution row={row} /></TableCell>
                  <TableCell>{formatDate(row.updatedAt)}</TableCell>
                </TableRow>
              )
            }}
          />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
```

Antes de usar `DataTable`, leer las props obligatorias restantes de `components/ui/data-table.types.ts` (por ejemplo, alguna para identificar filas) y completarlas.

```tsx
// app/(app)/prevencion/miper/new-miper-dialog.tsx
"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { createMiperAction } from "./actions"

export type CreationWorksite = { id: string; name: string; vigenteId: string | null; vigentePeriod: number | null; vigenteIsLegacy: boolean }

export function NewMiperDialog({ worksites, currentYear }: { worksites: CreationWorksite[]; currentYear: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [source, setSource] = useState<"vigente" | "vacia">("vigente")
  const operation = useOperation()
  const worksite = worksites.find((item) => item.id === worksiteId)
  const canCopy = Boolean(worksite?.vigenteId && !worksite.vigenteIsLegacy)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createMiperAction({
      worksiteId,
      period: Number(form.get("period")),
      revisionReason: String(form.get("revisionReason") ?? ""),
      sourceMatrixId: canCopy && source === "vigente" ? worksite!.vigenteId : null,
    }), (result) => {
      setOpen(false)
      const id = result.data?.id
      if (typeof id === "string") router.push(`/prevencion/miper/${id}?tab=antecedentes`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button disabled={worksites.length === 0}>Nueva MIPER</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva MIPER</DialogTitle>
            <DialogDescription>Una MIPER por faena y período. Los antecedentes se completan con los datos de la faena y la empresa.</DialogDescription>
          </DialogHeader>
          <Field label="Faena" required>
            <Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setSource("vigente") }}>
              <SelectTrigger><SelectValue placeholder="Selecciona la faena" /></SelectTrigger>
              <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Período" required><Input name="period" type="number" min={2000} max={2100} defaultValue={currentYear} required /></Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Punto de partida</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" checked={canCopy && source === "vigente"} disabled={!canCopy} onChange={() => setSource("vigente")} />
              {canCopy ? `Copiar la MIPER vigente (${worksite!.vigentePeriod ?? "sin período"})` : worksite?.vigenteIsLegacy ? "La MIPER vigente usa la metodología anterior y no se puede copiar" : "La faena no tiene MIPER vigente"}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" checked={!canCopy || source === "vacia"} onChange={() => setSource("vacia")} />
              Matriz vacía
            </label>
          </fieldset>
          <Field label="Motivo" required helper="Por ejemplo: elaboración inicial, renovación anual, cambio de proceso.">
            <Textarea name="revisionReason" required minLength={10} />
          </Field>
          {operation.message && <p role="status" className="text-sm text-[var(--color-danger-ink)]">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !worksiteId}>Crear borrador</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

Confirmar en `components/ui/field.tsx` si la prop de ayuda se llama `helper` o `hint` y usar la correcta.

- [ ] **Step 5: Catálogo de factores**

```tsx
// app/(app)/prevencion/miper/factores/page.tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { listRiskFactors } from "@/lib/services/miper/risk-factors"
import { RiskFactorsAdmin } from "./risk-factors-admin"

export const metadata: Metadata = { title: "Factores de riesgo · MIPER" }

export default async function RiskFactorsPage() {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:catalog:manage")) redirect("/forbidden")
  return <RiskFactorsAdmin factors={await listRiskFactors()} />
}
```

```tsx
// app/(app)/prevencion/miper/factores/risk-factors-admin.tsx
"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import { saveRiskFactorAction, setRiskFactorActiveAction } from "../actions"

type Factor = { id: string; code: string; name: string; sortOrder: number; isActive: boolean; usageCount: number }

export function RiskFactorsAdmin({ factors }: { factors: Factor[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Factor | "new" | null>(null)
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => saveRiskFactorAction({ id: editing !== "new" ? editing?.id : undefined, code: form.get("code"), name: form.get("name"), sortOrder: form.get("sortOrder") }), () => setEditing(null))
  }
  const current = editing && editing !== "new" ? editing : null
  return (
    <PageContainer width="form">
      <PageHeader title="Factores de riesgo" description="Clasificación controlada del RE-04. Un factor en uso se desactiva, no se borra."
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "MIPER", href: "/prevencion/miper" }, { label: "Factores de riesgo" }]} />}
        actions={<Button onClick={() => setEditing("new")}>Nuevo factor</Button>} />
      <DataTable
        caption="Factores de riesgo"
        columns={[{ key: "sortOrder", label: "Orden", numeric: true }, { key: "name", label: "Factor" }, { key: "code", label: "Código" }, { key: "usageCount", label: "En uso", numeric: true }, { key: "isActive", label: "Estado" }, { key: "actions", label: "" }]}
        rows={factors as unknown as Record<string, unknown>[]}
        searchKeys={["name", "code"]}
        renderRow={(raw) => {
          const factor = raw as unknown as Factor
          return (
            <TableRow key={factor.id}>
              <TableCell className="tabular-nums">{factor.sortOrder}</TableCell>
              <TableCell>{factor.name}</TableCell>
              <TableCell className="font-mono text-xs">{factor.code}</TableCell>
              <TableCell className="tabular-nums">{factor.usageCount}</TableCell>
              <TableCell>{factor.isActive ? "Activo" : "Desactivado"}</TableCell>
              <TableCell className="space-x-2 text-right">
                <Button size="sm" variant="secondary" onClick={() => setEditing(factor)}>Editar</Button>
                <Button size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => setRiskFactorActiveAction({ id: factor.id, isActive: !factor.isActive }))}>{factor.isActive ? "Desactivar" : "Reactivar"}</Button>
              </TableCell>
            </TableRow>
          )
        }}
      />
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader><DialogTitle>{current ? `Editar ${current.name}` : "Nuevo factor de riesgo"}</DialogTitle></DialogHeader>
            <Field label="Nombre" required><Input name="name" defaultValue={current?.name ?? ""} required minLength={2} /></Field>
            <Field label="Código" required><Input name="code" defaultValue={current?.code ?? ""} required pattern="[a-z0-9_]+" /></Field>
            <Field label="Orden" required><Input name="sortOrder" type="number" min={0} defaultValue={current?.sortOrder ?? 200} required /></Field>
            <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
```

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:fast -- components/prevention lib/prevention/miper components/layout && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add components/prevention lib/prevention/miper/grid-view.ts lib/prevention/miper/grid-view.test.ts components/layout "app/(app)/prevencion/miper"
git commit -m "feat(miper): portada por rol, nueva MIPER, catálogo de factores y componentes de clasificación"
```

---

#### Task 17: Espacio de trabajo: página, pestañas, barra de flujo y antecedentes

**Files:**
- Create: `app/(app)/prevencion/miper/[id]/page.tsx`, `app/(app)/prevencion/miper/[id]/loading.tsx`
- Create: `app/(app)/prevencion/miper/[id]/miper-workspace.tsx`, `app/(app)/prevencion/miper/[id]/workflow-bar.tsx`, `app/(app)/prevencion/miper/[id]/antecedentes-form.tsx`, `app/(app)/prevencion/miper/[id]/summary-strip.tsx`
- Create: `lib/prevention/miper/workspace-mode.ts` y su test

**Interfaces:**
- Consumes: `getMiperWorkspace` y `getMiperHistory` (Task 12); acciones (Task 14); `RiskClassificationBadge` (Task 16).
- Produces:
  - `type WorkspaceMode = { canEdit: boolean; canReviewTechnical: boolean; canApproveLegal: boolean; canObserve: boolean; canRespond: boolean; isSubmitter: boolean; readOnlyReason: string | null }`
  - `resolveWorkspaceMode(input: { status: string; reviewState: string; isLegacy: boolean; openRoundStage: "technical" | "legal_rrhh" | null; submittedByUserId: string | null; userId: string; permissions: readonly string[]; inScope: boolean }): WorkspaceMode`
  - `MiperWorkspaceView` (cliente) con props `{ workspace: MiperWorkspace; history: MiperHistoryEvent[]; mode: WorkspaceMode; userId: string }`. Las Tasks 18 y 19 enchufan la grilla, el `Sheet`, la revisión y el historial en sus pestañas.

- [ ] **Step 1: Write the failing test for the mode**

```ts
// lib/prevention/miper/workspace-mode.test.ts
import { describe, expect, it } from "vitest"
import { resolveWorkspaceMode } from "./workspace-mode"

const base = { status: "draft", reviewState: "none", isLegacy: false, openRoundStage: null, submittedByUserId: null, userId: "u1", permissions: ["prevention:risk:view", "prevention:risk:edit"], inScope: true } as const

describe("modo del espacio de trabajo", () => {
  it("la prevencionista edita su borrador; no observa ni aprueba", () => {
    expect(resolveWorkspaceMode(base)).toMatchObject({ canEdit: true, canObserve: false, canReviewTechnical: false, canApproveLegal: false, readOnlyReason: null })
  })
  it("en revisión técnica la Jefa observa y decide, salvo que ella haya enviado", () => {
    const jefa = { ...base, reviewState: "in_review", openRoundStage: "technical" as const, submittedByUserId: "u9", permissions: ["prevention:risk:view", "prevention:risk:review"] }
    expect(resolveWorkspaceMode(jefa)).toMatchObject({ canReviewTechnical: true, canObserve: true, canEdit: false })
    expect(resolveWorkspaceMode({ ...jefa, submittedByUserId: "u1" })).toMatchObject({ canReviewTechnical: false, canObserve: false, isSubmitter: true })
  })
  it("pendiente de aprobación: Legal y RRHH decide; la prevencionista puede seguir editando (irá a la ronda siguiente)", () => {
    const pending = { ...base, reviewState: "pending_approval", openRoundStage: "legal_rrhh" as const, submittedByUserId: "u9" }
    expect(resolveWorkspaceMode({ ...pending, permissions: ["prevention:risk:view", "prevention:risk:approve_legal"] })).toMatchObject({ canApproveLegal: true, canObserve: true })
    expect(resolveWorkspaceMode(pending)).toMatchObject({ canEdit: true, canApproveLegal: false })
  })
  it("con observaciones la prevencionista responde", () => {
    expect(resolveWorkspaceMode({ ...base, reviewState: "observed" })).toMatchObject({ canEdit: true, canRespond: true })
  })
  it("legacy, reemplazada o fuera de faena: sólo lectura, con el motivo", () => {
    expect(resolveWorkspaceMode({ ...base, isLegacy: true }).readOnlyReason).toMatch(/metodología anterior/)
    expect(resolveWorkspaceMode({ ...base, status: "superseded" }).readOnlyReason).toMatch(/reemplazada/)
    expect(resolveWorkspaceMode({ ...base, inScope: false }).canEdit).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/prevention/miper/workspace-mode.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write `workspace-mode.ts`**

```ts
// lib/prevention/miper/workspace-mode.ts
/**
 * Qué puede hacer la persona en el espacio de trabajo. Es un reflejo de las
 * reglas del servicio (lib/services/miper/*) para mostrar u ocultar controles;
 * la autorización real la vuelve a hacer el servidor en cada acción.
 */
export type WorkspaceMode = {
  canEdit: boolean
  canReviewTechnical: boolean
  canApproveLegal: boolean
  canObserve: boolean
  canRespond: boolean
  isSubmitter: boolean
  readOnlyReason: string | null
}

export function resolveWorkspaceMode(input: {
  status: string; reviewState: string; isLegacy: boolean
  openRoundStage: "technical" | "legal_rrhh" | null; submittedByUserId: string | null
  userId: string; permissions: readonly string[]; inScope: boolean
}): WorkspaceMode {
  const has = (permission: string) => input.permissions.includes(permission)
  const readOnlyReason = input.isLegacy ? "Esta MIPER usa la metodología anterior: es de solo lectura. Crea la MIPER del período para trabajar con el formato RE-04."
    : input.status === "superseded" ? "Esta MIPER fue reemplazada por la de otro período: se conserva como historia."
    : null
  const isSubmitter = input.submittedByUserId === input.userId
  const canEdit = !readOnlyReason && input.inScope && has("prevention:risk:edit")
  const canReviewTechnical = !readOnlyReason && input.reviewState === "in_review" && input.openRoundStage === "technical" && has("prevention:risk:review") && !isSubmitter
  const canApproveLegal = !readOnlyReason && input.reviewState === "pending_approval" && input.openRoundStage === "legal_rrhh" && has("prevention:risk:approve_legal") && !isSubmitter
  return {
    canEdit,
    canReviewTechnical,
    canApproveLegal,
    canObserve: canReviewTechnical || canApproveLegal,
    canRespond: canEdit && input.reviewState === "observed",
    isSubmitter,
    readOnlyReason,
  }
}
```

- [ ] **Step 4: Página y espacio de trabajo**

```tsx
// app/(app)/prevencion/miper/[id]/page.tsx
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolveWorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import { getMiperHistory, getMiperWorkspace } from "@/lib/services/miper/queries"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { scopeAllows } from "@/lib/services/miper/shared"
import { MiperWorkspaceView } from "./miper-workspace"

export const metadata: Metadata = { title: "MIPER" }

export default async function MiperWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  const { id } = await params
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  let workspace, history
  try {
    ;[workspace, history] = await Promise.all([getMiperWorkspace(id, access), getMiperHistory(id, access)])
  } catch (error) {
    if (error instanceof RiskLegalDomainError) notFound()
    throw error
  }
  const mode = resolveWorkspaceMode({
    status: workspace.matrix.status, reviewState: workspace.matrix.reviewState, isLegacy: workspace.matrix.isLegacy,
    openRoundStage: workspace.openRound?.stage ?? null, submittedByUserId: workspace.openRound?.submittedByUserId ?? null,
    userId: session.user.id, permissions: session.user.permissions, inScope: scopeAllows(access.scope, workspace.matrix.worksiteId),
  })
  return <MiperWorkspaceView workspace={workspace} history={history} mode={mode} userId={session.user.id} />
}
```

```tsx
// app/(app)/prevencion/miper/[id]/loading.tsx
import { Skeleton } from "@/components/ui/skeleton"
export default function Loading() {
  return <div className="space-y-3 px-4 py-3 md:px-8"><Skeleton className="h-8 w-72" /><Skeleton className="h-10 w-full" /><Skeleton className="h-96 w-full" /></div>
}
```

```tsx
// app/(app)/prevencion/miper/[id]/summary-strip.tsx
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { formatDate } from "@/lib/utils"

/**
 * Franja de resumen en TEXTO (regla A1: nada de tarjetas de KPI sobre la
 * matriz). Es la cabecera de la vista de revisión del §8.4 y sirve igual a la
 * prevencionista.
 */
export function SummaryStrip({ snapshot, authorName, submittedAt, versionLabel }: { snapshot: MiperSnapshot; authorName: string | null; submittedAt: string | null; versionLabel: string }) {
  const entries = snapshot.entries
  const count = (cls: string) => entries.filter((entry) => entry.classification === cls).length
  const uncontrolled = entries.filter((entry) => entry.controlledStatus === "no").length
  const controls = entries.flatMap((entry) => entry.controls.map((control) => ({ control, entry })))
  const noResponsible = controls.filter(({ control, entry }) => entry.classification !== "tolerable" && !control.responsibleUserId && !control.responsibleName).length
  const noDeadline = controls.filter(({ control }) => !control.dueDate).length
  const h = snapshot.header
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-3 text-sm">
      <div><dt className="sr-only">Faena</dt><dd className="font-semibold">{h.worksiteName} · {h.period}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Versión </dt><dd className="inline">{versionLabel}</dd></div>
      {authorName && <div><dt className="inline text-[var(--color-text-subtle)]">Elaboró </dt><dd className="inline">{authorName}{submittedAt ? ` · enviada ${formatDate(submittedAt)}` : ""}</dd></div>}
      <div><dt className="inline text-[var(--color-text-subtle)]">Dotación </dt><dd className="inline tabular-nums">{h.headcountTotal ?? "—"}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Riesgos </dt><dd className="inline tabular-nums">{entries.length}</dd></div>
      <div className="flex flex-wrap gap-1.5">
        <dt className="sr-only">Distribución por clasificación</dt>
        {[...RISK_CLASSIFICATIONS].reverse().map((cls) => <dd key={cls} className="inline-flex items-center gap-1"><RiskClassificationBadge classification={cls} size="sm" /><span className="tabular-nums">{count(cls)}</span></dd>)}
      </div>
      <div><dt className="inline text-[var(--color-text-subtle)]">No controlados </dt><dd className="inline tabular-nums">{uncontrolled}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Medidas sin responsable </dt><dd className="inline tabular-nums">{noResponsible}</dd></div>
      <div><dt className="inline text-[var(--color-text-subtle)]">Medidas sin plazo </dt><dd className="inline tabular-nums">{noDeadline}</dd></div>
    </dl>
  )
}
```

La cifra "actividades en el programa" del §8.4 llega en F2; en F1 no se muestra.

```tsx
// app/(app)/prevencion/miper/[id]/workflow-bar.tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { approveMiperFinalAction, approveMiperTechnicalAction, discardMiperDraftAction, requestMiperCorrectionsAction, returnMiperAction, submitMiperAction } from "../actions"

type Dialogs = "return" | "approveTechnical" | "requestCorrections" | "approveFinal" | "discard" | "blocking" | null

export function WorkflowBar({ workspace, mode, issues, openObservations }: { workspace: MiperWorkspace; mode: WorkspaceMode; issues: CompletenessIssue[]; openObservations: number }) {
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [changeSummary, setChangeSummary] = useState("")
  const operation = useOperation({ feedback: "toast" })
  const { matrix } = workspace
  const blocking = issues.filter((issue) => issue.severity === "error")
  const base = { matrixId: matrix.id, expectedVersion: matrix.version }
  const close = () => setDialog(null)
  const canSubmit = mode.canEdit && ["none", "observed"].includes(matrix.reviewState) && (matrix.status === "draft" || matrix.reviewState === "observed" || workspace.pendingDiff.hasChanges)
  const neverSubmitted = matrix.status === "draft" && matrix.reviewState === "none" && workspace.versions.length === 0 && !workspace.openRound
  const latest = workspace.versions[0]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {latest && <Button asChild variant="secondary"><a href={`/api/prevencion/miper/${latest.id}/export`}>Descargar v{latest.versionNumber} (Excel)</a></Button>}
      {mode.canEdit && neverSubmitted && <Button variant="secondary" onClick={() => setDialog("discard")}>Descartar borrador</Button>}
      {canSubmit && (
        <Button onClick={() => blocking.length > 0 ? setDialog("blocking") : operation.run(() => submitMiperAction(base))} disabled={operation.pending}>
          {matrix.reviewState === "observed" ? "Reenviar a revisión" : "Enviar a revisión"}{blocking.length > 0 ? ` (${blocking.length} pendientes)` : ""}
        </Button>
      )}
      {mode.canReviewTechnical && <>
        <Button variant="secondary" onClick={() => setDialog("return")}>Devolver con observaciones</Button>
        <Button onClick={() => setDialog("approveTechnical")} disabled={openObservations > 0} title={openObservations > 0 ? "Hay observaciones abiertas: devuelve la MIPER o resuélvelas." : undefined}>Aprobar revisión técnica</Button>
      </>}
      {mode.canApproveLegal && <>
        <Button variant="secondary" onClick={() => setDialog("requestCorrections")}>Solicitar correcciones</Button>
        <Button onClick={() => setDialog("approveFinal")} disabled={openObservations > 0}>Aprobar (Legal y RRHH)</Button>
      </>}

      <Dialog open={dialog === "blocking"} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Faltan {blocking.length} datos para enviar</DialogTitle>
            <DialogDescription>Corrige lo siguiente en la matriz o en los antecedentes. Cada fila marcada en la grilla muestra su detalle.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
            {blocking.slice(0, 40).map((issue, index) => {
              const row = issue.entryId ? workspace.snapshot.entries.find((entry) => entry.id === issue.entryId)?.rowNumber : null
              return <li key={index}>{row ? `Riesgo #${row}: ` : "Antecedentes: "}{issue.message}</li>
            })}
          </ul>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={dialog === "return"} onOpenChange={(open) => { if (!open) close() }} title="Devolver con observaciones"
        description={`La MIPER vuelve a la prevencionista con ${openObservations} observación(es) abierta(s).`} confirmLabel="Devolver" variant="warning"
        reasonLabel="Comentario para la prevencionista" loading={operation.pending}
        onConfirm={(reason) => operation.run(() => returnMiperAction({ ...base, comment: reason }), close)} />
      <ConfirmDialog open={dialog === "approveTechnical"} onOpenChange={(open) => { if (!open) close() }} title="Aprobar revisión técnica"
        description="La MIPER pasa a aprobación de Legal y RRHH. Las observaciones respondidas quedan resueltas." confirmLabel="Aprobar revisión técnica" loading={operation.pending}
        onConfirm={() => operation.run(() => approveMiperTechnicalAction(base), close)} />
      <ConfirmDialog open={dialog === "requestCorrections"} onOpenChange={(open) => { if (!open) close() }} title="Solicitar correcciones"
        description="La MIPER vuelve a la prevencionista; después de corregirla pasa otra vez por la revisión técnica." confirmLabel="Solicitar correcciones" variant="warning"
        reasonLabel="Qué debe corregirse" loading={operation.pending}
        onConfirm={(reason) => operation.run(() => requestMiperCorrectionsAction({ ...base, comment: reason }), close)} />
      <ConfirmDialog open={dialog === "discard"} onOpenChange={(open) => { if (!open) close() }} title="Descartar borrador"
        description="El borrador se elimina. Queda registrado en la auditoría." confirmLabel="Descartar" variant="destructive" reasonLabel="Motivo" loading={operation.pending}
        onConfirm={(reason) => operation.run(() => discardMiperDraftAction({ ...base, reason }), () => { window.location.assign("/prevencion/miper") })} />

      <Dialog open={dialog === "approveFinal"} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar la MIPER (Legal y RRHH)</DialogTitle>
            <DialogDescription>Se sella la versión v{(latest?.versionNumber ?? 0) + 1} con lo revisado técnicamente. La versión anterior se conserva.</DialogDescription>
          </DialogHeader>
          <Field label="Resumen de cambios (hoja Modificaciones)" required>
            <Textarea value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} minLength={10} placeholder={latest ? "Qué cambió respecto de la versión anterior" : "Emisión inicial del documento."} />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={close}>Cancelar</Button>
            <Button disabled={operation.pending || changeSummary.trim().length < 10} onClick={() => operation.run(() => approveMiperFinalAction({ ...base, changeSummary }), () => { close(); setChangeSummary("") })}>Aprobar y sellar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {mode.readOnlyReason && <span className="text-sm text-[var(--color-text-subtle)]">{mode.readOnlyReason}</span>}
      {mode.isSubmitter && workspace.openRound && <span className="text-sm text-[var(--color-text-subtle)]">Enviaste esta ronda: la revisa otra persona.</span>}
      <Link href="/prevencion/miper" className="sr-only">Volver a la lista</Link>
    </div>
  )
}
```

Confirmar en `components/ui/confirm-dialog.tsx` qué props exige el modo con motivo (`reasonLabel`, y quizá `requireReason` o `minReasonLength`) y ajustar. Una devolución o una solicitud de correcciones sin comentario la rechaza el servidor (mínimo 10 caracteres), y el diálogo debería impedirla antes.

```tsx
// app/(app)/prevencion/miper/[id]/antecedentes-form.tsx
"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { HEADER_FIELD_LABEL } from "@/lib/prevention/miper/snapshot"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { updateMiperHeaderAction } from "../actions"

type Header = MiperWorkspace["snapshot"]["header"]

export function AntecedentesForm({ workspace, editable }: { workspace: MiperWorkspace; editable: boolean }) {
  const router = useRouter()
  const { prefill, matrix } = workspace
  const [header, setHeader] = useState<Header>(workspace.snapshot.header)
  const [version, setVersion] = useState(matrix.version)
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const set = <K extends keyof Header>(key: K, value: Header[K]) => setHeader((current) => ({ ...current, [key]: value }))
  const num = (value: string) => (value === "" ? null : Number(value))

  /** Valor prellenado desde su fuente: se muestra y se puede restaurar. */
  const sources: Partial<Record<keyof Header, { value: string | number | null; from: string }>> = {
    companyName: { value: prefill.companyName, from: "perfil de empresa" },
    companyRut: { value: prefill.companyRut, from: "perfil de empresa" },
    companyAddress: { value: prefill.companyAddress, from: "perfil de empresa" },
    economicActivity: { value: prefill.economicActivity, from: "perfil de empresa" },
    adherentNumber: { value: prefill.adherentNumber || null, from: "perfil de empresa" },
    companyCommune: { value: prefill.companyCommune, from: "ficha de la faena" },
    worksiteName: { value: prefill.worksiteName, from: "ficha de la faena" },
    siteRepresentativeName: { value: prefill.siteRepresentativeName, from: "Administrador de contrato asignado a la faena" },
    headcountTotal: { value: prefill.headcount.total, from: "trabajadores activos de la faena" },
    headcountMale: { value: prefill.headcount.male, from: "trabajadores activos" },
    headcountFemale: { value: prefill.headcount.female, from: "trabajadores activos" },
    headcountOther: { value: prefill.headcount.other, from: "trabajadores activos (incluye sin sexo registrado)" },
  }
  function sourceHint(key: keyof Header) {
    const source = sources[key]
    if (!source || source.value === null || source.value === "") return undefined
    const differs = source.value !== header[key]
    return (
      <span>
        Desde {source.from}: {String(source.value)}
        {differs && editable && <button type="button" className="ml-2 underline" onClick={() => {
          set(key, source.value as never)
          if (key === "siteRepresentativeName") set("siteRepresentativeUserId", prefill.siteRepresentativeUserId)
        }}>Restaurar</button>}
      </span>
    )
  }
  function textField(key: keyof Header, options: { required?: boolean } = {}) {
    return (
      <Field label={HEADER_FIELD_LABEL[key]} required={options.required} helper={sourceHint(key)}>
        <Input value={(header[key] as string | null) ?? ""} disabled={!editable} onChange={(event) => set(key, (event.target.value || null) as never)} />
      </Field>
    )
  }
  function numberField(key: "headcountTotal" | "headcountMale" | "headcountFemale" | "headcountOther") {
    return (
      <Field label={HEADER_FIELD_LABEL[key]} required helper={sourceHint(key)}>
        <Input type="number" min={0} value={header[key] ?? ""} disabled={!editable} onChange={(event) => set(key, num(event.target.value))} />
      </Field>
    )
  }
  const sum = (header.headcountMale ?? 0) + (header.headcountFemale ?? 0) + (header.headcountOther ?? 0)
  const sumMismatch = header.headcountTotal !== null && sum !== header.headcountTotal

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    operation.run(() => updateMiperHeaderAction({ matrixId: matrix.id, expectedVersion: version, ...header, period: undefined, siteRepresentativeUserId: header.siteRepresentativeUserId }), (result) => {
      if (typeof result.data?.version === "number") setVersion(result.data.version)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-2xl border border-slate-200/70 bg-white p-6">
      <section className="grid gap-4 md:grid-cols-3">
        <h2 className="md:col-span-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Identificación</h2>
        {textField("iperCode")}
        <Field label="Período"><Input value={header.period ?? ""} disabled /></Field>
        <Field label={HEADER_FIELD_LABEL.elaboratedOn} required><DatePicker value={header.elaboratedOn ?? undefined} disabled={!editable} onChange={(iso) => set("elaboratedOn", iso)} /></Field>
        <Field label={HEADER_FIELD_LABEL.updatedOn} error={header.updatedOn && header.elaboratedOn && header.updatedOn < header.elaboratedOn ? "No puede ser anterior a la fecha de elaboración." : undefined}>
          <DatePicker value={header.updatedOn ?? undefined} min={header.elaboratedOn ?? undefined} disabled={!editable} onChange={(iso) => set("updatedOn", iso)} />
        </Field>
        {textField("companyName")}
        {textField("companyRut")}
        {textField("companyAddress")}
        {textField("companyCommune")}
        {textField("economicActivity")}
        {textField("adherentNumber")}
        {textField("worksiteName")}
      </section>
      <section className="grid gap-4 md:grid-cols-4">
        <h2 className="md:col-span-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Dotación</h2>
        {numberField("headcountTotal")}{numberField("headcountMale")}{numberField("headcountFemale")}{numberField("headcountOther")}
        {sumMismatch && <p role="alert" className="md:col-span-4 text-sm text-[var(--color-danger-ink)]">Hombres + mujeres + otro suman {sum} y el total declarado es {header.headcountTotal}.</p>}
        {prefill.headcount.unrecorded > 0 && <p className="md:col-span-4 text-xs text-[var(--color-text-subtle)]">{prefill.headcount.unrecorded} trabajador(es) activo(s) no tienen el sexo registrado y se cuentan como "otro". Complétalo en la ficha del trabajador.</p>}
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <h2 className="md:col-span-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Responsables</h2>
        {textField("siteRepresentativeName", { required: true })}
        <Field label="Elaboró / revisó / aprobó" helper="Se registran solos con el flujo de revisión: no se escriben.">
          <Input disabled value={workspace.versions[0] ? `${workspace.versions[0].elaboratedByName} / ${workspace.versions[0].technicalReviewerName} / ${workspace.versions[0].approverName}` : "Se completa al aprobar la primera versión"} />
        </Field>
      </section>
      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Participación</h2>
        <Field label={HEADER_FIELD_LABEL.participationSummary}><Textarea value={header.participationSummary} disabled={!editable} onChange={(event) => set("participationSummary", event.target.value)} /></Field>
        <Field label={HEADER_FIELD_LABEL.consultationEvidenceReference}><Input value={header.consultationEvidenceReference} disabled={!editable} onChange={(event) => set("consultationEvidenceReference", event.target.value)} /></Field>
      </section>
      {editable && <div className="flex justify-end"><Button type="submit" disabled={operation.pending || sumMismatch}>Guardar antecedentes</Button></div>}
    </form>
  )
}
```

`miperHeaderSchema` es un objeto no estricto: el `period: undefined` del payload se descarta. Si el typecheck protesta, construir el payload con desestructuración: `const { period: _p, ...rest } = header`.

```tsx
// app/(app)/prevencion/miper/[id]/miper-workspace.tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Callout } from "@/components/ui/callout"
import { checkMiperCompleteness, issuesByEntry } from "@/lib/prevention/miper/completeness"
import { CLASSIFICATION_CRITERIA } from "@/lib/prevention/miper/methodology"
import { changesByEntry, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperHistoryEvent, MiperWorkspace } from "@/lib/services/miper/queries"
import { openMiperRoundAction } from "../actions"
import { AntecedentesForm } from "./antecedentes-form"
import { SummaryStrip } from "./summary-strip"
import { WorkflowBar } from "./workflow-bar"
import { MatrixGrid } from "./matrix-grid"
import { EntrySheet } from "./entry-sheet"
import { ReviewPanel } from "./review-panel"
import { HistoryPanel } from "./history-panel"

const TABS = new Set(["antecedentes", "matriz", "revision", "historial"])

export function MiperWorkspaceView({ workspace, history, mode, userId }: { workspace: MiperWorkspace; history: MiperHistoryEvent[]; mode: WorkspaceMode; userId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = TABS.has(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "matriz"
  const openEntryId = searchParams.get("fila")
  // En revisión se muestra la FOTO enviada (lo que se decide); si no, lo vivo.
  const reviewing = mode.canReviewTechnical || mode.canApproveLegal
  const source = reviewing && workspace.openRound ? workspace.openRound.snapshot : workspace.snapshot
  const [rows, setRows] = useState<MiperEntrySnapshot[]>(source.entries)
  useEffect(() => { setRows(source.entries) }, [source])
  const liveSnapshot = useMemo(() => ({ header: source.header, entries: rows }), [source.header, rows])
  const issues = useMemo(() => checkMiperCompleteness(liveSnapshot), [liveSnapshot])
  const diff = reviewing ? workspace.reviewDiff : workspace.pendingDiff
  const changes = useMemo(() => (diff ? changesByEntry(diff) : new Map()), [diff])
  const openObservations = workspace.observations.filter((observation) => observation.status === "open").length
  const observedEntryIds = useMemo(() => new Set(workspace.observations.filter((o) => o.entryId && o.status !== "resolved").map((o) => o.entryId!)), [workspace.observations])
  const intolerable = rows.filter((row) => row.classification === "intolerable").length

  useEffect(() => {
    if (reviewing && workspace.openRound && !workspace.openRound.openedAt) void openMiperRoundAction({ matrixId: workspace.matrix.id })
  }, [reviewing, workspace.openRound, workspace.matrix.id])

  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  const versionLabel = workspace.versions[0] ? `v${workspace.versions[0].versionNumber}` : "sin versión aprobada"
  return (
    <PageContainer width="full">
      <PageHeader
        title={`MIPER ${workspace.matrix.worksiteName} ${workspace.matrix.period ?? ""}`}
        description={workspace.label}
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "MIPER", href: "/prevencion/miper" }, { label: `${workspace.matrix.worksiteName} ${workspace.matrix.period ?? ""}` }]} />}
        actions={<WorkflowBar workspace={workspace} mode={mode} issues={issues} openObservations={openObservations} />}
      />
      <div className="space-y-3">
        <SummaryStrip snapshot={liveSnapshot} authorName={workspace.openRound ? workspace.versions[0]?.elaboratedByName ?? null : null} submittedAt={workspace.openRound?.submittedAt ?? null} versionLabel={versionLabel} />
        {reviewing && <Callout tone="info" title="Estás revisando la versión enviada">Los cambios que la prevencionista haga después del envío quedan para la ronda siguiente.</Callout>}
        {intolerable > 0 && (
          <Callout tone="danger" role="alert" title={`${intolerable} riesgo(s) Intolerable(s)`}>
            {CLASSIFICATION_CRITERIA.intolerable}
          </Callout>
        )}
        <Tabs value={tab} onValueChange={(value) => setParam("tab", value === "matriz" ? null : value)}>
          <TabsList>
            <TabsTrigger value="antecedentes">Antecedentes</TabsTrigger>
            <TabsTrigger value="matriz">Matriz ({rows.length})</TabsTrigger>
            <TabsTrigger value="revision">Revisión{openObservations > 0 ? ` (${openObservations})` : ""}</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>
          <TabsContent value="antecedentes"><AntecedentesForm workspace={workspace} editable={mode.canEdit && !reviewing} /></TabsContent>
          <TabsContent value="matriz">
            <MatrixGrid
              matrixId={workspace.matrix.id}
              rows={rows}
              onRowsChange={setRows}
              entryVersions={workspace.entryVersions}
              editable={mode.canEdit && !reviewing}
              riskFactors={workspace.riskFactors}
              dictionaries={workspace.dictionaries}
              issuesByEntry={issuesByEntry(issues)}
              observedEntryIds={observedEntryIds}
              changeByEntry={changes}
              canObserve={mode.canObserve}
              onOpenEntry={(entryId) => setParam("fila", entryId)}
              onStructureChanged={() => router.refresh()}
            />
          </TabsContent>
          <TabsContent value="revision"><ReviewPanel workspace={workspace} mode={mode} onOpenEntry={(entryId) => { setParam("fila", entryId) }} /></TabsContent>
          <TabsContent value="historial"><HistoryPanel workspace={workspace} history={history} /></TabsContent>
        </Tabs>
      </div>
      <EntrySheet
        workspace={workspace}
        entry={rows.find((row) => row.id === openEntryId) ?? null}
        baseline={reviewing ? workspace.reviewBaselineSnapshot : workspace.lastVersionSnapshot}
        change={openEntryId ? changes.get(openEntryId) ?? null : null}
        mode={mode}
        userId={userId}
        onClose={() => setParam("fila", null)}
        onChanged={() => router.refresh()}
      />
    </PageContainer>
  )
}
```

Mientras no existan `MatrixGrid`, `EntrySheet`, `ReviewPanel` e `HistoryPanel` (Tasks 18–19), crear en este paso esos cuatro archivos como componentes que devuelven `null` y exportan las props tipadas, para que la página compile y se pueda probar la pestaña Antecedentes. Las Tasks 18 y 19 los reemplazan por completo. Son archivos que esas tareas ya declaran, así que no queda código muerto.

- [ ] **Step 5: Verificación en navegador de la pestaña Antecedentes**

1. Levantar el entorno local con la skill `run` o como indica la memoria del proyecto: Chromium del repo y base de desarrollo migrada.
2. Crear una MIPER desde la portada.
3. Comprobar en la pestaña Antecedentes:
   - Los valores prellenados muestran su origen.
   - "Restaurar" devuelve el valor de la fuente.
   - La suma de la dotación incoherente muestra el aviso y bloquea "Guardar".
   - Guardar muestra el toast y persiste al recargar.
   - La consola no tiene errores.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:fast -- lib/prevention/miper && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add "app/(app)/prevencion/miper/[id]" lib/prevention/miper/workspace-mode.ts lib/prevention/miper/workspace-mode.test.ts
git commit -m "feat(miper): espacio de trabajo con barra de flujo, resumen y antecedentes RE-04"
```

---

#### Task 18: Grilla de la matriz

**Files:**
- Create (reemplaza el stub de la Task 17): `app/(app)/prevencion/miper/[id]/matrix-grid.tsx`
- Create: `app/(app)/prevencion/miper/[id]/use-row-saver.ts`
- Test: `app/(app)/prevencion/miper/[id]/use-row-saver.test.ts`

**Interfaces:**
- Consumes: `saveMiperEntryAction`, `duplicateMiperEntryAction` y `deleteMiperEntryAction` (Task 14); `grid-view.ts`, `PcSelect` y `RiskClassificationBadge` (Task 16); `classify` (Task 1).
- Produces:
  - `useRowSaver(matrixId, initialVersions)`, que devuelve `{ save(entryId, values): Promise<{ ok: true; version; magnitude; classification } | { ok: false; message }> }`.
  - `MatrixGrid` con las props que usa `miper-workspace.tsx` (Task 17).

- [ ] **Step 1: Write the failing test for the saver**

```ts
// app/(app)/prevencion/miper/[id]/use-row-saver.test.ts
// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

import { useRowSaver } from "./use-row-saver"

describe("useRowSaver", () => {
  it("serializa los guardados de una fila y usa la versión devuelta por el anterior", async () => {
    let release!: () => void
    saveMiperEntryAction
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true, data: { version: 2, magnitude: null, classification: null } }) }))
      .mockResolvedValueOnce({ ok: true, data: { version: 3, magnitude: 8, classification: "important" } })
    const { result } = renderHook(() => useRowSaver("m1", { e1: 1 }))
    const first = result.current.save("e1", { hazard: "A" })
    const second = result.current.save("e1", { probability: 2 })
    await Promise.resolve()
    expect(saveMiperEntryAction).toHaveBeenCalledTimes(1)
    release()
    await first
    await expect(second).resolves.toEqual({ ok: true, version: 3, magnitude: 8, classification: "important" })
    expect(saveMiperEntryAction.mock.calls.map(([input]) => input.expectedVersion)).toEqual([1, 2])
  })
  it("devuelve el motivo del rechazo sin romper la cola", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: false, message: "La fila cambió mientras la editabas." }).mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: null, classification: null } })
    const { result } = renderHook(() => useRowSaver("m1", { e9: 1 }))
    await expect(result.current.save("e9", { hazard: "x" })).resolves.toEqual({ ok: false, message: "La fila cambió mientras la editabas." })
    await expect(result.current.save("e9", { hazard: "y" })).resolves.toMatchObject({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/use-row-saver.test.ts"`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write `use-row-saver.ts`**

```ts
// app/(app)/prevencion/miper/[id]/use-row-saver.ts
"use client"

import { useCallback, useRef } from "react"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { saveMiperEntryAction } from "../actions"

export type RowSaveResult = { ok: true; version: number; magnitude: number | null; classification: string | null } | { ok: false; message: string }

/**
 * Guardado automático por fila (§8.2). Las ediciones de una misma fila se
 * encolan: cada una espera a la anterior y envía la versión que ésta devolvió,
 * así dos celdas editadas seguidas no chocan con el candado optimista. Filas
 * distintas guardan en paralelo.
 */
export function useRowSaver(matrixId: string, initialVersions: Record<string, number>) {
  const versions = useRef<Record<string, number>>({ ...initialVersions })
  const queues = useRef<Record<string, Promise<unknown>>>({})
  const save = useCallback((entryId: string, values: MiperEntryValues): Promise<RowSaveResult> => {
    const previous = queues.current[entryId] ?? Promise.resolve()
    const run: Promise<RowSaveResult> = previous.catch(() => undefined).then(async () => {
      const state = await saveMiperEntryAction({ matrixId, entryId, expectedVersion: versions.current[entryId], values })
      if (!state.ok) return { ok: false as const, message: state.message ?? "No se pudo guardar la fila." }
      const data = state.data as { version: number; magnitude: number | null; classification: string | null }
      versions.current[entryId] = data.version
      return { ok: true as const, version: data.version, magnitude: data.magnitude, classification: data.classification }
    })
    queues.current[entryId] = run
    return run
  }, [matrixId])
  const sync = useCallback((next: Record<string, number>) => { versions.current = { ...versions.current, ...next } }, [])
  return { save, sync }
}
```

- [ ] **Step 4: Write `matrix-grid.tsx`**

```tsx
// app/(app)/prevencion/miper/[id]/matrix-grid.tsx
"use client"

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { PcSelect } from "@/components/prevention/pc-select"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { activeFilterCount, EMPTY_FILTERS, filterRows, groupRows, type GridFilters, type GroupBy } from "@/lib/prevention/miper/grid-view"
import { classify, magnitudeOf, RISK_CLASSIFICATIONS, CLASSIFICATION_LABEL, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { CONTROL_HIERARCHY_LABEL, CONTROLLED_STATUS_LABEL, type ControlledStatus, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { deleteMiperEntryAction, duplicateMiperEntryAction, saveMiperEntryAction } from "../actions"
import { useRowSaver } from "./use-row-saver"

type Props = {
  matrixId: string
  rows: MiperEntrySnapshot[]
  onRowsChange: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  entryVersions: Record<string, number>
  editable: boolean
  riskFactors: MiperWorkspace["riskFactors"]
  dictionaries: MiperWorkspace["dictionaries"]
  issuesByEntry: Map<string, CompletenessIssue[]>
  observedEntryIds: Set<string>
  changeByEntry: Map<string, EntryChange>
  canObserve: boolean
  onOpenEntry: (entryId: string) => void
  onStructureChanged: () => void
}

type TextKey = "activity" | "task" | "position" | "location" | "hazard" | "risk" | "probableDamage"
const TEXT_LIST: Record<TextKey, keyof MiperWorkspace["dictionaries"]> = {
  activity: "activities", task: "tasks", position: "positions", location: "locations", hazard: "hazards", risk: "risks", probableDamage: "damages",
}
const COLUMNS = [
  { key: "rowNumber", label: "N°", width: "w-12", sticky: "left-0" },
  { key: "activity", label: "Actividad", width: "w-44", sticky: "left-12" },
  { key: "task", label: "Tarea", width: "w-44", sticky: "left-56" },
  { key: "position", label: "Puesto de trabajo", width: "w-40" },
  { key: "location", label: "Lugar específico", width: "w-36" },
  { key: "exposedFemale", label: "F", width: "w-14" },
  { key: "exposedMale", label: "M", width: "w-14" },
  { key: "exposedOther", label: "Otro", width: "w-14" },
  { key: "riskFactorId", label: "Factor de riesgo", width: "w-36" },
  { key: "isRoutine", label: "Rutinaria", width: "w-32" },
  { key: "hazard", label: "Peligro", width: "w-52" },
  { key: "risk", label: "Riesgo", width: "w-44" },
  { key: "probableDamage", label: "Daño probable", width: "w-44" },
  { key: "probability", label: "Probabilidad", width: "w-28" },
  { key: "consequence", label: "Consecuencia", width: "w-28" },
  { key: "classification", label: "MR · Clasificación", width: "w-40" },
  { key: "controlledStatus", label: "¿Controlado?", width: "w-32" },
  { key: "controls", label: "Medidas de control", width: "w-56" },
  { key: "actions", label: "", width: "w-28" },
] as const

const selectClass = "h-8 w-full rounded-md border border-[var(--color-border)] bg-white px-1.5 text-sm disabled:opacity-60"
const inputClass = "h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-focus)] focus:bg-white aria-[invalid=true]:border-[var(--color-danger-line)]"

/** Mueve el foco a la misma columna de la fila vecina (flechas / Enter), estilo planilla. */
function moveFocus(event: KeyboardEvent<HTMLElement>, delta: number) {
  const target = event.currentTarget
  const row = Number(target.dataset.row), col = target.dataset.col
  const table = target.closest("table")
  const next = table?.querySelector<HTMLElement>(`[data-grid-cell][data-row="${row + delta}"][data-col="${col}"]`)
  if (next) { event.preventDefault(); next.focus() }
}

function cellKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)) { event.currentTarget.blur(); moveFocus(event, 1) }
  else if (event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)) { event.currentTarget.blur(); moveFocus(event, -1) }
  else if (event.key === "Escape") { event.currentTarget.value = event.currentTarget.defaultValue; event.currentTarget.blur() }
}

export function MatrixGrid(props: Props) {
  const { matrixId, rows, onRowsChange, entryVersions, editable, riskFactors, dictionaries, issuesByEntry, observedEntryIds, changeByEntry, onOpenEntry, onStructureChanged } = props
  const { save, sync } = useRowSaver(matrixId, entryVersions)
  useEffect(() => { sync(entryVersions) }, [entryVersions, sync])
  const [filters, setFilters] = useState<GridFilters>(EMPTY_FILTERS)
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  const [pendingDelete, setPendingDelete] = useState<MiperEntrySnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const modified = useMemo(() => new Set([...changeByEntry.values()].filter((c) => c.kind !== "removed").map((c) => c.entryId)), [changeByEntry])
  const visible = useMemo(() => filterRows(rows, filters, { observed: observedEntryIds, modified }), [rows, filters, observedEntryIds, modified])
  const groups = useMemo(() => groupRows(visible, groupBy), [visible, groupBy])
  const activeFactors = riskFactors.filter((factor) => factor.isActive)

  async function change(entry: MiperEntrySnapshot, values: MiperEntryValues) {
    // Optimista: la fila cambia y se reclasifica al instante; el servidor confirma.
    onRowsChange((current) => current.map((row) => {
      if (row.id !== entry.id) return row
      const next = { ...row, ...values } as MiperEntrySnapshot
      if ("riskFactorId" in values) next.riskFactor = riskFactors.find((f) => f.id === values.riskFactorId)?.name ?? null
      next.magnitude = magnitudeOf(next.probability, next.consequence)
      next.classification = classify(next.probability, next.consequence)
      return next
    }))
    const key = `${entry.id}:${Object.keys(values).join(",")}`
    const result = await save(entry.id, values)
    if (!result.ok) {
      setCellErrors((current) => ({ ...current, [key]: result.message }))
      toast.error(`Riesgo #${entry.rowNumber}: ${result.message}`)
      return
    }
    setCellErrors((current) => { const { [key]: _removed, ...rest } = current; return rest })
  }

  async function structural(operation: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true)
    const state = await operation()
    setBusy(false)
    if (!state.ok) { toast.error(state.message ?? "No se pudo completar la acción."); return }
    onStructureChanged()
  }

  const addBelow = (entry: MiperEntrySnapshot | null) => structural(() => saveMiperEntryAction({
    matrixId,
    insertAfterRowNumber: entry?.rowNumber ?? null,
    values: entry ? { activity: entry.activity, task: entry.task, position: entry.position, location: entry.location, isRoutine: entry.isRoutine } : {},
  }))

  function textCell(entry: MiperEntrySnapshot, key: TextKey, rowIndex: number, colIndex: number) {
    const errorKey = `${entry.id}:${key}`
    return (
      <input
        data-grid-cell data-row={rowIndex} data-col={colIndex}
        aria-label={`${COLUMNS[colIndex]!.label} riesgo ${entry.rowNumber}`}
        aria-invalid={Boolean(cellErrors[errorKey]) || undefined}
        title={cellErrors[errorKey]}
        list={`miper-list-${key}`}
        className={inputClass}
        defaultValue={entry[key] ?? ""}
        key={`${entry.id}-${key}-${entry[key] ?? ""}`}
        onKeyDown={cellKeyDown}
        onBlur={(event) => {
          const value = event.target.value.replace(/\s+/g, " ").trim()
          if (value !== (entry[key] ?? "")) void change(entry, { [key]: value || null })
        }}
      />
    )
  }

  function numberCell(entry: MiperEntrySnapshot, key: "exposedFemale" | "exposedMale" | "exposedOther", rowIndex: number, colIndex: number) {
    return (
      <input
        data-grid-cell data-row={rowIndex} data-col={colIndex} type="number" min={0}
        aria-label={`Expuestos ${COLUMNS[colIndex]!.label} riesgo ${entry.rowNumber}`}
        className={cn(inputClass, "tabular-nums")}
        defaultValue={entry[key]}
        key={`${entry.id}-${key}-${entry[key]}`}
        onKeyDown={cellKeyDown}
        onBlur={(event) => {
          const value = Math.max(0, Number(event.target.value || 0))
          if (value !== entry[key]) void change(entry, { [key]: value })
        }}
      />
    )
  }

  function renderRow(entry: MiperEntrySnapshot, rowIndex: number) {
    const issues = issuesByEntry.get(entry.id) ?? []
    const errors = issues.filter((issue) => issue.severity === "error")
    const change_ = changeByEntry.get(entry.id)
    const observed = observedEntryIds.has(entry.id)
    const stickyBg = entry.classification === "intolerable" ? "bg-[var(--color-danger-tint)]" : "bg-white"
    return (
      <tr key={entry.id} className={cn("border-b align-top", entry.classification === "intolerable" && "bg-[var(--color-danger-tint)]")}>
        <td className={cn("sticky left-0 z-10 px-2 py-1 text-sm tabular-nums", stickyBg)}>
          <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => onOpenEntry(entry.id)} aria-label={`Abrir detalle del riesgo ${entry.rowNumber}`}>{entry.rowNumber}</button>
          <div className="mt-0.5 flex flex-col gap-0.5">
            {change_ && <span className="rounded bg-[var(--color-signal-tint)] px-1 text-[10px] font-semibold text-[var(--color-signal-ink)]">{change_.kind === "added" ? "Nueva" : "Modificada"}</span>}
            {observed && <span className="rounded bg-[var(--color-warning-tint)] px-1 text-[10px] font-semibold text-[var(--color-warning-ink)]">Observada</span>}
            {errors.length > 0 && <span className="rounded bg-[var(--color-danger-tint)] px-1 text-[10px] font-semibold text-[var(--color-danger-ink)]" title={errors.map((issue) => issue.message).join("\n")}>{errors.length} pend.</span>}
          </div>
        </td>
        {editable ? <>
          <td className={cn("sticky left-12 z-10 px-1 py-1", stickyBg)}>{textCell(entry, "activity", rowIndex, 1)}</td>
          <td className={cn("sticky left-56 z-10 px-1 py-1", stickyBg)}>{textCell(entry, "task", rowIndex, 2)}</td>
          <td className="px-1 py-1">{textCell(entry, "position", rowIndex, 3)}</td>
          <td className="px-1 py-1">{textCell(entry, "location", rowIndex, 4)}</td>
          <td className="px-1 py-1">{numberCell(entry, "exposedFemale", rowIndex, 5)}</td>
          <td className="px-1 py-1">{numberCell(entry, "exposedMale", rowIndex, 6)}</td>
          <td className="px-1 py-1">{numberCell(entry, "exposedOther", rowIndex, 7)}</td>
          <td className="px-1 py-1">
            <select aria-label={`Factor de riesgo riesgo ${entry.rowNumber}`} className={selectClass} value={entry.riskFactorId ?? ""} onChange={(event) => void change(entry, { riskFactorId: event.target.value || null })}>
              <option value="">—</option>
              {activeFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.name}</option>)}
              {entry.riskFactorId && !activeFactors.some((factor) => factor.id === entry.riskFactorId) && <option value={entry.riskFactorId}>{entry.riskFactor ?? "Factor desactivado"}</option>}
            </select>
          </td>
          <td className="px-1 py-1">
            <select aria-label={`Rutinaria riesgo ${entry.rowNumber}`} className={selectClass} value={entry.isRoutine === null ? "" : entry.isRoutine ? "yes" : "no"} onChange={(event) => void change(entry, { isRoutine: event.target.value === "" ? null : event.target.value === "yes" })}>
              <option value="">—</option><option value="yes">Rutinaria</option><option value="no">No rutinaria</option>
            </select>
          </td>
          <td className="px-1 py-1">{textCell(entry, "hazard", rowIndex, 10)}</td>
          <td className="px-1 py-1">{textCell(entry, "risk", rowIndex, 11)}</td>
          <td className="px-1 py-1">{textCell(entry, "probableDamage", rowIndex, 12)}</td>
          <td className="px-1 py-1"><PcSelect kind="probability" ariaLabel={`Probabilidad riesgo ${entry.rowNumber}`} value={entry.probability} onChange={(value) => void change(entry, { probability: value })} /></td>
          <td className="px-1 py-1"><PcSelect kind="consequence" ariaLabel={`Consecuencia riesgo ${entry.rowNumber}`} value={entry.consequence} onChange={(value) => void change(entry, { consequence: value })} /></td>
        </> : <>
          <td className={cn("sticky left-12 z-10 px-2 py-1 text-sm", stickyBg)}>{entry.activity ?? "—"}</td>
          <td className={cn("sticky left-56 z-10 px-2 py-1 text-sm", stickyBg)}>{entry.task ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.position ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.location ?? "—"}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.exposedFemale}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.exposedMale}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.exposedOther}</td>
          <td className="px-2 py-1 text-sm">{entry.riskFactor ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.isRoutine === null ? "—" : entry.isRoutine ? "Rutinaria" : "No rutinaria"}</td>
          <td className="px-2 py-1 text-sm">{entry.hazard ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.risk ?? "—"}</td>
          <td className="px-2 py-1 text-sm">{entry.probableDamage ?? "—"}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.probability ?? "—"}</td>
          <td className="px-2 py-1 text-sm tabular-nums">{entry.consequence ?? "—"}</td>
        </>}
        <td className="px-2 py-1"><RiskClassificationBadge classification={entry.classification} magnitude={entry.magnitude} /></td>
        <td className="px-1 py-1">
          {editable ? (
            <select aria-label={`¿Controlado? riesgo ${entry.rowNumber}`} className={selectClass} value={entry.controlledStatus ?? ""} onChange={(event) => void change(entry, { controlledStatus: (event.target.value || null) as ControlledStatus | null })}>
              <option value="">—</option><option value="yes">Sí</option><option value="partial">Parcialmente</option><option value="no">No</option>
            </select>
          ) : <span className="text-sm">{entry.controlledStatus ? CONTROLLED_STATUS_LABEL[entry.controlledStatus] : "—"}</span>}
        </td>
        <td className="px-2 py-1">
          <button type="button" className="flex w-full flex-wrap gap-1 text-left" onClick={() => onOpenEntry(entry.id)} aria-label={`Medidas de control del riesgo ${entry.rowNumber} (${entry.controls.length})`}>
            {entry.controls.length === 0 ? <span className="text-xs text-[var(--color-text-subtle)]">{editable ? "+ Agregar medida" : "Sin medidas"}</span>
              : entry.controls.map((control) => <span key={control.id} title={`${CONTROL_HIERARCHY_LABEL[control.hierarchy]}: ${control.description}`} className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs">{CONTROL_HIERARCHY_LABEL[control.hierarchy].split(".")[0]}. {control.description.slice(0, 28)}{control.description.length > 28 ? "…" : ""}</span>)}
          </button>
        </td>
        <td className="px-1 py-1">
          <div className="flex gap-1">
            {editable && <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void addBelow(entry)} aria-label={`Agregar fila debajo del riesgo ${entry.rowNumber}`} title="Agregar debajo (copia actividad, tarea, puesto y lugar)">+</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void structural(() => duplicateMiperEntryAction({ matrixId, entryId: entry.id }))} aria-label={`Duplicar riesgo ${entry.rowNumber}`} title="Duplicar">⧉</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPendingDelete(entry)} aria-label={`Eliminar riesgo ${entry.rowNumber}`} title="Eliminar">✕</Button>
            </>}
            {props.canObserve && <Button size="sm" variant="secondary" onClick={() => onOpenEntry(entry.id)} aria-label={`Observar riesgo ${entry.rowNumber}`}>Observar</Button>}
          </div>
        </td>
      </tr>
    )
  }

  let rowIndex = 0
  return (
    <section className="space-y-3">
      {/* Filtros primarios (A2): búsqueda, clasificación, controlado, factor, agrupación + atajos de revisión. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs">Buscar en la matriz
          <Input className="h-9 w-64" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Actividad, peligro, medida…" />
        </label>
        <label className="flex flex-col text-xs">Clasificación
          <select className={cn(selectClass, "h-9 w-40")} value={filters.classifications.length === 1 ? filters.classifications[0] : "all"} onChange={(event) => setFilters({ ...filters, classifications: event.target.value === "all" ? [] : [event.target.value as RiskClassification] })}>
            <option value="all">Todas</option>{RISK_CLASSIFICATIONS.map((cls) => <option key={cls} value={cls}>{CLASSIFICATION_LABEL[cls]}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs">¿Controlado?
          <select className={cn(selectClass, "h-9 w-36")} value={filters.controlled} onChange={(event) => setFilters({ ...filters, controlled: event.target.value as GridFilters["controlled"] })}>
            <option value="all">Todos</option><option value="yes">Sí</option><option value="partial">Parcialmente</option><option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-col text-xs">Factor
          <select className={cn(selectClass, "h-9 w-40")} value={filters.factorId} onChange={(event) => setFilters({ ...filters, factorId: event.target.value })}>
            <option value="all">Todos</option>{riskFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs">Agrupar por
          <select className={cn(selectClass, "h-9 w-40")} value={groupBy} onChange={(event) => { setGroupBy(event.target.value as GroupBy); setCollapsed(new Set()) }}>
            <option value="none">Sin agrupar</option><option value="activity">Actividad</option><option value="position">Puesto de trabajo</option><option value="classification">Clasificación</option>
          </select>
        </label>
        {editable && <Button className="ml-auto" disabled={busy} onClick={() => void addBelow(null)}>Agregar fila</Button>}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtros rápidos">
        {([
          ["Solo Importantes", filters.classifications.length === 1 && filters.classifications[0] === "important", () => setFilters({ ...filters, classifications: ["important"] })],
          ["Solo Intolerables", filters.classifications.length === 1 && filters.classifications[0] === "intolerable", () => setFilters({ ...filters, classifications: ["intolerable"] })],
          ["No controlados", filters.controlled === "no", () => setFilters({ ...filters, controlled: "no" })],
          ["Observados", filters.onlyObserved, () => setFilters({ ...filters, onlyObserved: !filters.onlyObserved })],
          ["Modificados", filters.onlyModified, () => setFilters({ ...filters, onlyModified: !filters.onlyModified })],
        ] as Array<[string, boolean, () => void]>).map(([label, active, onClick]) => (
          <button key={label} type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-[var(--color-signal-ink)] bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]" : "border-[var(--color-border)]")}>{label}</button>
        ))}
        {activeFilterCount(filters) > 0 && <button type="button" className="text-xs underline" onClick={() => setFilters(EMPTY_FILTERS)}>Quitar filtros ({activeFilterCount(filters)})</button>}
        <span className="ml-auto text-xs text-[var(--color-text-subtle)]">{visible.length} de {rows.length} riesgos</span>
      </div>

      {Object.entries(TEXT_LIST).map(([key, list]) => (
        <datalist key={key} id={`miper-list-${key}`}>{dictionaries[list].map((value) => <option key={value} value={value} />)}</datalist>
      ))}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="font-medium">La matriz aún no tiene registros de evaluación</p>
          <p className="mt-1 text-sm text-[var(--color-text-subtle)]">Cada fila es una situación concreta de exposición: actividad, tarea, puesto, peligro y riesgo.</p>
          {editable && <Button className="mt-3" onClick={() => void addBelow(null)}>Agregar la primera fila</Button>}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200/70 bg-white md:block">
            <table className="min-w-[2400px] table-fixed border-collapse">
              <caption className="sr-only">Matriz de identificación de peligros y evaluación de riesgos</caption>
              <thead className="sticky top-0 z-20 bg-[var(--color-surface-2)]">
                <tr>{COLUMNS.map((column) => <th key={column.key} scope="col" className={cn(column.width, "px-2 py-2 text-left text-xs font-semibold", "sticky" in column && column.sticky && `sticky ${column.sticky} z-30 bg-[var(--color-surface-2)]`)}>{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <GroupRows key={group.key} label={group.label} count={group.rows.length} collapsed={collapsed.has(group.key)}
                    onToggle={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next })}>
                    {group.rows.map((entry) => renderRow(entry, rowIndex++))}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          </div>
          {/* Móvil: lectura en tarjetas (§8.2); la edición es de escritorio. */}
          <ul className="space-y-2 md:hidden">
            {visible.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => onOpenEntry(entry.id)} className="w-full rounded-xl border bg-white p-3 text-left">
                  <div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold">#{entry.rowNumber} · {entry.hazard ?? "Peligro sin describir"}</span><RiskClassificationBadge classification={entry.classification} size="sm" /></div>
                  <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{[entry.activity, entry.task, entry.position].filter(Boolean).join(" · ")}</p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title={`Eliminar el riesgo #${pendingDelete?.rowNumber ?? ""}`} description="La fila y sus medidas se eliminan. Queda registrado en el historial." confirmLabel="Eliminar" variant="destructive"
        loading={busy}
        onConfirm={() => { const entry = pendingDelete!; setPendingDelete(null); void structural(() => deleteMiperEntryAction({ matrixId, entryId: entry.id, expectedVersion: entryVersions[entry.id] })) }} />
    </section>
  )
}

const GroupRows = memo(function GroupRows({ label, count, collapsed, onToggle, children }: { label: string; count: number; collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      {label && (
        <tr className="bg-[var(--color-surface-2)]">
          <td colSpan={COLUMNS.length} className="px-2 py-1.5">
            <button type="button" aria-expanded={!collapsed} onClick={onToggle} className="text-sm font-semibold">{collapsed ? "▸" : "▾"} {label} <span className="font-normal text-[var(--color-text-subtle)]">({count})</span></button>
          </td>
        </tr>
      )}
      {!collapsed && children}
    </>
  )
})
```

Notas para quien implementa:
- `useRef` no se usa; quitarlo del import si `lint` lo marca.
- Las celdas de texto son no controladas (`defaultValue` más una `key` que incluye el valor), así una edición en curso no se pisa con el re-render. Cuando el servidor devuelve la fila tras un `router.refresh()`, la `key` cambia y la celda se reinicia con el valor confirmado.
- Verificar que existan los tokens `--color-surface-2`, `--color-border`, `--color-focus`, `--color-signal-tint`, `--color-signal-ink` y `--color-danger-tint` (buscar en `app/globals.css`). Si alguno no existe, usar el más cercano definido ahí. No inventar tokens (regla 8 de layout).
- Revisar las variantes de `Button` (`ghost`, `secondary`) en `components/ui/button.tsx`.

- [ ] **Step 5: Verificación en navegador de la grilla**

Con el entorno local y una MIPER en borrador, comprobar:
1. **Agregar y editar:** "Agregar fila", escribir actividad, tarea y peligro, elegir P = Alta y C = Alta. La clasificación cambia al instante a "Intolerable · MR 16" y aparece la alerta crítica. Al recargar, el valor persiste.
2. **Filas nuevas:** "+" en la fila crea una debajo con actividad, tarea, puesto y lugar heredados. Duplicar copia la fila con sus medidas. Eliminar pide confirmación y renumera.
3. **Teclado:** las flechas arriba y abajo y Enter mueven de fila en la misma columna, y Tab avanza por las celdas.
4. **Filtros:** la búsqueda sin tildes encuentra; "Solo Intolerables" filtra; agrupar por actividad y plegar un grupo funciona.
5. **Concurrencia:** en dos pestañas, editar la misma celda. La segunda muestra el toast "La fila cambió mientras la editabas…" y la celda queda marcada.
6. **Consola:** sin errores ni advertencias de hidratación.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:fast -- "app/(app)/prevencion/miper" && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add "app/(app)/prevencion/miper/[id]/matrix-grid.tsx" "app/(app)/prevencion/miper/[id]/use-row-saver.ts" "app/(app)/prevencion/miper/[id]/use-row-saver.test.ts"
git commit -m "feat(miper): grilla editable con guardado por fila, teclado, filtros y agrupación"
```

---

#### Task 19: Ficha de la fila, pestaña Revisión e Historial

**Files:**
- Create: `app/(app)/prevencion/miper/[id]/observation-item.tsx`
- Create (reemplazan los stubs de la Task 17): `app/(app)/prevencion/miper/[id]/entry-sheet.tsx`, `app/(app)/prevencion/miper/[id]/review-panel.tsx`, `app/(app)/prevencion/miper/[id]/history-panel.tsx`
- Create: `lib/prevention/miper/history-labels.ts` y su test

**Interfaces:**
- Consumes:
  - Acciones de observaciones y medidas (Task 14).
  - `MiperWorkspace` y `MiperHistoryEvent` (Task 12); `WorkspaceMode` (Task 17).
  - `ENTRY_FIELD_LABEL` y `CONTROL_HIERARCHY_LABEL` (Task 3); `PcSelect` y `RiskClassificationBadge` (Task 16); `DatePicker`, `Sheet*` y `Field`.
- Produces:
  - `EntrySheet({ workspace, entry, baseline, change, mode, userId, onClose, onChanged })`
  - `ReviewPanel({ workspace, mode, onOpenEntry })`
  - `HistoryPanel({ workspace, history })`
  - `historyLabel(changeType: string): string` y `ACTING_AS_TEXT: Record<string, string>`

- [ ] **Step 1: Write the failing test for the history labels**

```ts
// lib/prevention/miper/history-labels.test.ts
import { describe, expect, it } from "vitest"
import { ACTING_AS_TEXT, historyLabel } from "./history-labels"

describe("rótulos del historial MIPER", () => {
  it("cada evento del flujo tiene un rótulo en español", () => {
    for (const type of ["created", "header_updated", "entry_created", "entry_updated", "entry_deleted", "control_created", "submitted", "opened", "returned", "technical_approved", "corrections_requested", "version_sealed", "observation_created", "observation_answered", "observation_resolved", "superseded", "deleted"]) {
      expect(historyLabel(type)).not.toBe(type)
    }
    expect(historyLabel("version_sealed")).toBe("Aprobada y sellada por Legal y RRHH")
  })
  it("un evento desconocido no se muestra crudo como enum", () => {
    expect(historyLabel("algo_nuevo")).toBe("Cambio registrado")
  })
  it("la capacidad con que actuó se muestra con el nombre del rol", () => {
    expect(ACTING_AS_TEXT["prevention:risk:approve_legal"]).toBe("Legal y RRHH")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/prevention/miper/history-labels.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Write `history-labels.ts`**

```ts
// lib/prevention/miper/history-labels.ts
/** Rótulos del historial (§4.9): nunca se muestra el `changeType` crudo (A6). */
const LABELS: Record<string, string> = {
  created: "MIPER creada",
  header_updated: "Antecedentes modificados",
  entry_created: "Riesgo agregado",
  entry_updated: "Riesgo modificado",
  entry_duplicated: "Riesgo duplicado",
  entry_deleted: "Riesgo eliminado",
  control_created: "Medida agregada",
  control_updated: "Medida modificada",
  control_deleted: "Medida eliminada",
  submitted: "Enviada a revisión",
  opened: "Revisión iniciada",
  returned: "Devuelta con observaciones",
  technical_approved: "Revisión técnica aprobada",
  corrections_requested: "Legal y RRHH solicitó correcciones",
  version_sealed: "Aprobada y sellada por Legal y RRHH",
  observation_created: "Observación registrada",
  observation_answered: "Observación respondida",
  observation_resolved: "Observación resuelta",
  observation_reopened: "Observación reabierta",
  superseded: "Reemplazada por el período siguiente",
  deleted: "Borrador descartado",
}

export function historyLabel(changeType: string) {
  return LABELS[changeType] ?? "Cambio registrado"
}

export const ACTING_AS_TEXT: Record<string, string> = {
  "prevention:risk:edit": "Prevencionista",
  "prevention:risk:review": "Jefatura del Depto. de Prevención",
  "prevention:risk:approve_legal": "Legal y RRHH",
  "prevention:risk:catalog:manage": "Administración del catálogo",
}
```

Borrar `ACTING_AS_LABEL` de `lib/services/miper/shared.ts` (Task 7) si nada lo usa. La fuente única de ese rótulo pasa a ser este archivo, que el cliente también puede importar.

- [ ] **Step 4: Observación, ficha, revisión e historial**

```tsx
// app/(app)/prevencion/miper/[id]/observation-item.tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { STAGE_LABEL } from "@/lib/prevention/miper/states"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperObservationView } from "@/lib/services/miper/queries"
import { formatDateTime } from "@/lib/utils"
import { reopenMiperObservationAction, resolveMiperObservationAction, respondMiperObservationAction } from "../actions"

const STATUS_TEXT: Record<string, { label: string; className: string }> = {
  open: { label: "Abierta", className: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]" },
  answered: { label: "Respondida", className: "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]" },
  resolved: { label: "Resuelta", className: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]" },
}

export function ObservationItem({ observation, mode, onOpenEntry, onChanged }: { observation: MiperObservationView; mode: WorkspaceMode; onOpenEntry?: (entryId: string) => void; onChanged: () => void }) {
  const [response, setResponse] = useState("")
  const operation = useOperation({ feedback: "toast", onSuccess: onChanged })
  const status = STATUS_TEXT[observation.status] ?? STATUS_TEXT.open!
  const canDecide = (observation.stage === "technical" && mode.canReviewTechnical) || (observation.stage === "legal_rrhh" && mode.canApproveLegal)
  return (
    <article className="rounded-xl border p-3 text-sm" aria-label={`Observación ${observation.entryLabel ?? "general"}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
        {observation.entryId && onOpenEntry
          ? <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onOpenEntry(observation.entryId!)}>{observation.entryLabel}</button>
          : <span className="font-medium">{observation.entryLabel ?? "Observación general"}</span>}
        <span className="text-xs text-[var(--color-text-subtle)]">{STAGE_LABEL[observation.stage as keyof typeof STAGE_LABEL]} · {observation.authorName} · {formatDateTime(observation.createdAt)}</span>
      </header>
      <p className="mt-2 whitespace-pre-wrap">{observation.body}</p>
      {observation.response && (
        <p className="mt-2 border-l-2 pl-3 text-[var(--color-text-subtle)]">
          <span className="font-medium text-[var(--color-text)]">Respuesta de {observation.responderName ?? "la prevencionista"}:</span> {observation.response}
        </p>
      )}
      {mode.canRespond && observation.status === "open" && (
        <div className="mt-2 space-y-2">
          <Textarea aria-label="Tu respuesta" value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Qué corregiste o por qué se mantiene" />
          <Button size="sm" disabled={operation.pending || response.trim().length < 5} onClick={() => operation.run(() => respondMiperObservationAction({ observationId: observation.id, response }), () => setResponse(""))}>Responder</Button>
        </div>
      )}
      {canDecide && observation.status === "answered" && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => resolveMiperObservationAction({ observationId: observation.id }))}>Dar por resuelta</Button>
          <Button size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => reopenMiperObservationAction({ observationId: observation.id }))}>Reabrir</Button>
        </div>
      )}
    </article>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/entry-sheet.tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { useOperation } from "@/lib/hooks/use-operation"
import { CLASSIFICATION_CRITERIA } from "@/lib/prevention/miper/methodology"
import { CONTROL_HIERARCHY_LABEL, CONTROLLED_STATUS_LABEL, ENTRY_FIELD_LABEL, type ControlHierarchy, type EntryChange, type MiperControlSnapshot, type MiperEntrySnapshot, type MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { formatDate } from "@/lib/utils"
import { addMiperObservationAction, deleteMiperControlAction, saveMiperControlAction } from "../actions"
import { ObservationItem } from "./observation-item"

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Rutinaria" : "No rutinaria"
  if (value === "yes" || value === "partial" || value === "no") return CONTROLLED_STATUS_LABEL[value]
  return String(value)
}

function ControlEditor({ workspace, entryId, control, onDone }: { workspace: MiperWorkspace; entryId: string; control: MiperControlSnapshot | null; onDone: () => void }) {
  const [hierarchy, setHierarchy] = useState<ControlHierarchy>(control?.hierarchy ?? "administrative")
  const [description, setDescription] = useState(control?.description ?? "")
  const [responsibleUserId, setResponsibleUserId] = useState(control?.responsibleUserId ?? "")
  const [responsibleName, setResponsibleName] = useState(control?.responsibleUserId ? "" : control?.responsibleName ?? "")
  const [dueDate, setDueDate] = useState(control?.dueDate ?? "")
  const operation = useOperation({ feedback: "toast", onSuccess: onDone })
  const matrixId = workspace.matrix.id
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? workspace.controlVersions[control.id] : undefined,
    values: { hierarchy, description, responsibleUserId: responsibleUserId || null, responsibleName: responsibleUserId ? null : responsibleName || null, dueDate: dueDate || null },
  }))
  return (
    <div className="grid gap-3 rounded-xl border p-3 md:grid-cols-2">
      <Field label="Tipo de control (jerarquía)" required>
        <select aria-label="Tipo de control" className="h-9 w-full rounded-md border px-2 text-sm" value={hierarchy} onChange={(event) => setHierarchy(event.target.value as ControlHierarchy)}>
          {Object.entries(CONTROL_HIERARCHY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Plazo" required><DatePicker ariaLabel="Plazo de la medida" value={dueDate || undefined} onChange={setDueDate} /></Field>
      <Field label="Medida de control" required className="md:col-span-2">
        <Input aria-label="Descripción de la medida" list="miper-list-measures" value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label="Responsable (persona de la faena)">
        <select aria-label="Responsable de la medida" className="h-9 w-full rounded-md border px-2 text-sm" value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)}>
          <option value="">Otra persona o cargo…</option>
          {workspace.responsibleOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </Field>
      {!responsibleUserId && <Field label="Responsable (nombre o cargo)"><Input aria-label="Nombre o cargo responsable" value={responsibleName} onChange={(event) => setResponsibleName(event.target.value)} placeholder="Supervisor de turno" /></Field>}
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" disabled={operation.pending || description.trim().length < 3} onClick={save}>{control ? "Guardar medida" : "Agregar medida"}</Button>
        {control && <Button size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => deleteMiperControlAction({ matrixId, controlId: control.id, expectedVersion: workspace.controlVersions[control.id] }))}>Eliminar medida</Button>}
      </div>
    </div>
  )
}

export function EntrySheet({ workspace, entry, baseline, change, mode, userId: _userId, onClose, onChanged }: {
  workspace: MiperWorkspace
  entry: MiperEntrySnapshot | null
  baseline: MiperSnapshot | null
  change: EntryChange | null
  mode: WorkspaceMode
  userId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [observation, setObservation] = useState("")
  const [editingControl, setEditingControl] = useState<string | "new" | null>(null)
  const operation = useOperation({ feedback: "toast", onSuccess: onChanged })
  const editable = mode.canEdit && !(mode.canReviewTechnical || mode.canApproveLegal)
  if (!entry) return <Sheet open={false} onOpenChange={() => onClose()}><SheetContent /></Sheet>
  const before = baseline?.entries.find((item) => item.id === entry.id) ?? null
  const observations = workspace.observations.filter((item) => item.entryId === entry.id)
  const fields: Array<[string, unknown]> = [
    ["activity", entry.activity], ["task", entry.task], ["position", entry.position], ["location", entry.location],
    ["exposedFemale", entry.exposedFemale], ["exposedMale", entry.exposedMale], ["exposedOther", entry.exposedOther],
    ["riskFactor", entry.riskFactor], ["isRoutine", entry.isRoutine], ["hazard", entry.hazard], ["risk", entry.risk],
    ["probableDamage", entry.probableDamage], ["probability", entry.probability], ["consequence", entry.consequence], ["controlledStatus", entry.controlledStatus],
  ]
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Riesgo #{entry.rowNumber}</SheetTitle>
          <SheetDescription>{entry.hazard ?? "Peligro sin describir"} → {entry.risk ?? "riesgo sin describir"}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <div className="flex flex-wrap items-center gap-2"><RiskClassificationBadge classification={entry.classification} magnitude={entry.magnitude} /></div>
          {entry.classification && (entry.classification === "important" || entry.classification === "intolerable") && (
            <p role="note" className="rounded-lg bg-[var(--color-danger-tint)] p-3 text-sm text-[var(--color-danger-ink)]">{CLASSIFICATION_CRITERIA[entry.classification]}</p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {fields.map(([key, value]) => <div key={key}><dt className="text-xs text-[var(--color-text-subtle)]">{ENTRY_FIELD_LABEL[key]}</dt><dd>{display(value)}</dd></div>)}
          </dl>

          {change && change.kind !== "removed" && (
            <section aria-label="Cambios respecto de la revisión anterior">
              <h3 className="text-sm font-semibold">{change.kind === "added" ? "Riesgo nuevo en esta ronda" : "Cambios respecto de la revisión anterior"}</h3>
              {change.kind === "modified" && (
                <ul className="mt-2 space-y-1 text-sm">
                  {change.fields.filter((field) => field !== "controls").map((field) => (
                    <li key={field}><span className="font-medium">{ENTRY_FIELD_LABEL[field]}:</span> <del className="text-[var(--color-text-subtle)]">{display(before?.[field as keyof MiperEntrySnapshot])}</del> → <ins className="no-underline">{display(entry[field as keyof MiperEntrySnapshot])}</ins></li>
                  ))}
                  {change.fields.includes("controls") && (
                    <li><span className="font-medium">Medidas de control:</span> antes {before?.controls.map((control) => control.description).join("; ") || "ninguna"} → ahora {entry.controls.map((control) => control.description).join("; ") || "ninguna"}</li>
                  )}
                </ul>
              )}
            </section>
          )}

          <section aria-label="Medidas de control" className="space-y-2">
            <h3 className="text-sm font-semibold">Medidas de control ({entry.controls.length})</h3>
            {entry.controls.length === 0 && <p className="text-sm text-[var(--color-text-subtle)]">Sin medidas. {entry.classification === "important" || entry.classification === "intolerable" ? "Este riesgo exige al menos una, con responsable y plazo." : ""}</p>}
            {entry.controls.map((control) => editingControl === control.id
              ? <ControlEditor key={control.id} workspace={workspace} entryId={entry.id} control={control} onDone={() => { setEditingControl(null); onChanged() }} />
              : (
                <div key={control.id} className="flex items-start justify-between gap-2 rounded-xl border p-3 text-sm">
                  <div>
                    <p className="font-medium">{CONTROL_HIERARCHY_LABEL[control.hierarchy]}</p>
                    <p>{control.description}</p>
                    <p className="text-xs text-[var(--color-text-subtle)]">Responsable: {control.responsibleName ?? "sin asignar"} · Plazo: {control.dueDate ? formatDate(control.dueDate) : "sin plazo"}</p>
                    {workspace.matrix.status === "published" && <Link className="text-xs underline" href={`/prevencion/miper/controles/${control.id}`}>Verificar eficacia del control</Link>}
                  </div>
                  {editable && <Button size="sm" variant="secondary" onClick={() => setEditingControl(control.id)}>Editar</Button>}
                </div>
              ))}
            {editable && (editingControl === "new"
              ? <ControlEditor workspace={workspace} entryId={entry.id} control={null} onDone={() => { setEditingControl(null); onChanged() }} />
              : <Button size="sm" onClick={() => setEditingControl("new")}>Agregar medida</Button>)}
            <datalist id="miper-list-measures">{workspace.dictionaries.measures.map((value) => <option key={value} value={value} />)}</datalist>
          </section>

          <section aria-label="Observaciones del riesgo" className="space-y-2">
            <h3 className="text-sm font-semibold">Observaciones ({observations.length})</h3>
            {observations.map((item) => <ObservationItem key={item.id} observation={item} mode={mode} onChanged={onChanged} />)}
            {mode.canObserve && (
              <div className="space-y-2">
                <Textarea aria-label="Nueva observación" value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Ej.: Revisar consecuencia. De acuerdo con el daño probable indicado debería evaluarse nuevamente la severidad." />
                <Button size="sm" disabled={operation.pending || observation.trim().length < 5} onClick={() => operation.run(() => addMiperObservationAction({ matrixId: workspace.matrix.id, entryId: entry.id, body: observation }), () => setObservation(""))}>Registrar observación</Button>
              </div>
            )}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
```

Confirmar en `components/ui/sheet.tsx` los nombres y props de `SheetContent`, `SheetBody` y `SheetHeader` (lado, ancho, etc.), y en `components/ui/field.tsx` si `Field` acepta `className`. Para renderizar el `Sheet` cerrado sin fila, basta con devolver `null` si el componente no requiere montaje previo para su animación.

```tsx
// app/(app)/prevencion/miper/[id]/review-panel.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { STAGE_LABEL } from "@/lib/prevention/miper/states"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { formatDateTime } from "@/lib/utils"
import { addMiperObservationAction } from "../actions"
import { ObservationItem } from "./observation-item"

export function ReviewPanel({ workspace, mode, onOpenEntry }: { workspace: MiperWorkspace; mode: WorkspaceMode; onOpenEntry: (entryId: string) => void }) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const groups = [
    { key: "open", title: "Abiertas" },
    { key: "answered", title: "Respondidas (pendientes de confirmar)" },
    { key: "resolved", title: "Resueltas" },
  ] as const
  const openCount = workspace.observations.filter((item) => item.status === "open").length
  return (
    <section className="space-y-4">
      {workspace.openRound && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Ronda {workspace.openRound.roundNumber} · {STAGE_LABEL[workspace.openRound.stage]} · enviada {formatDateTime(workspace.openRound.submittedAt)}{workspace.openRound.openedAt ? ` · abierta ${formatDateTime(workspace.openRound.openedAt)}` : " · aún no abierta por la revisora"}
        </p>
      )}
      {mode.canRespond && (
        <Callout tone="warning" title={openCount > 0 ? `Tienes ${openCount} observación(es) por responder` : "Todas las observaciones están respondidas"}>
          Corrige la matriz donde corresponda, responde cada observación y luego usa "Reenviar a revisión".
        </Callout>
      )}
      {mode.canObserve && (
        <div className="space-y-2 rounded-2xl border border-slate-200/70 bg-white p-4">
          <p className="text-sm font-medium">Observación general</p>
          <Textarea aria-label="Observación general" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Algo que no corresponde a una fila en particular (antecedentes, participación, cobertura)." />
          <Button size="sm" disabled={operation.pending || body.trim().length < 5} onClick={() => operation.run(() => addMiperObservationAction({ matrixId: workspace.matrix.id, entryId: null, body }), () => setBody(""))}>Registrar observación general</Button>
        </div>
      )}
      {workspace.observations.length === 0 ? (
        <EmptyState title="Sin observaciones" description={mode.canObserve ? "Observa una fila desde la matriz (botón «Observar») o registra una observación general." : "Cuando la revisión registre observaciones, aparecerán aquí con su respuesta."} />
      ) : groups.map((group) => {
        const items = workspace.observations.filter((item) => item.status === group.key)
        if (items.length === 0) return null
        return (
          <details key={group.key} open={group.key !== "resolved"} className="space-y-2">
            <summary className="cursor-pointer text-sm font-semibold">{group.title} ({items.length})</summary>
            <div className="mt-2 space-y-2">{items.map((item) => <ObservationItem key={item.id} observation={item} mode={mode} onOpenEntry={onOpenEntry} onChanged={() => router.refresh()} />)}</div>
          </details>
        )
      })}
    </section>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/history-panel.tsx
import { EmptyState } from "@/components/ui/empty-state"
import { ACTING_AS_TEXT, historyLabel } from "@/lib/prevention/miper/history-labels"
import type { MiperHistoryEvent, MiperWorkspace } from "@/lib/services/miper/queries"
import { formatDate, formatDateTime } from "@/lib/utils"

/**
 * Versiones selladas (la hoja "Modificaciones") y bitácora de eventos. No usa
 * `EntityTimeline`: ése dibuja transiciones de estado (from → to) de
 * `status_history`, y acá la mayoría de los eventos no son cambios de estado
 * (filas, medidas, observaciones).
 */
export function HistoryPanel({ workspace, history }: { workspace: MiperWorkspace; history: MiperHistoryEvent[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Versiones aprobadas</h2>
        {workspace.versions.length === 0 ? <EmptyState title="Aún sin versiones" description="La primera versión se sella cuando Legal y RRHH aprueba la MIPER." /> : (
          <ol className="space-y-2">
            {workspace.versions.map((version) => (
              <li key={version.id} className="rounded-xl border bg-white p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Versión {version.versionNumber} · {formatDate(version.approvedAt)}</span>
                  <a className="underline" href={`/api/prevencion/miper/${version.id}/export`}>Descargar Excel</a>
                </div>
                <p className="mt-1">{version.changeSummary}</p>
                <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Elaboró {version.elaboratedByName} · Revisó {version.technicalReviewerName} · Aprobó {version.approverName}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Bitácora</h2>
        <ol className="space-y-1 text-sm">
          {history.map((event) => (
            <li key={event.id} className="flex flex-wrap gap-x-2 border-b py-1.5">
              <time className="tabular-nums text-[var(--color-text-subtle)]" dateTime={event.at}>{formatDateTime(event.at)}</time>
              <span className="font-medium">{historyLabel(event.changeType)}</span>
              <span>{event.actorName ?? "Sistema"}{event.actingAs ? ` (${ACTING_AS_TEXT[event.actingAs] ?? "otro rol"})` : ""}</span>
              {event.reason && <span className="w-full text-[var(--color-text-subtle)]">{event.reason}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Verificación en navegador del ciclo de revisión**

Con tres sesiones (prevencionista, Jefa y Legal y RRHH), recorrer los pasos 7 a 10 y 16 a 17 del §12 del spec:
1. **Jefa:** abre la ronda (el rótulo pasa a "En revisión por Prevención"), observa el riesgo 1 desde la grilla y lo devuelve.
2. **Prevencionista:** responde en la pestaña Revisión, corrige la fila y reenvía.
3. **Jefa:** ve el badge "Modificada" y el diff campo por campo en la ficha, y aprueba.
4. **Legal y RRHH:** aprueba con el resumen de cambios. Queda "Vigente · v1" y "Descargar v1 (Excel)" baja el libro RE-04.
5. **Prevencionista:** agrega un riesgo al vigente y ve "cambios pendientes de revisión".
6. **Historial:** muestra los eventos con actor y rol.

Registrar la consola y la red en cada paso.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:fast -- lib/prevention/miper "app/(app)/prevencion/miper" && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add "app/(app)/prevencion/miper/[id]" lib/prevention/miper/history-labels.ts lib/prevention/miper/history-labels.test.ts lib/services/miper/shared.ts
git commit -m "feat(miper): ficha del riesgo con medidas y diff, pestaña de revisión e historial de versiones"
```

---

#### Task 20: E2E del flujo F1 y recorrido de navegador con informe

**Files:**
- Modify: `e2e/setup-db.ts` (tres usuarios y roles MIPER)
- Create: `e2e/prevencion-miper-flujo.spec.ts`
- Modify: `e2e/prevencion-miper-matriz.spec.ts`
- Create: `qa/reports/<fecha>-miper-f1.md`, con la fecha de la ejecución en el nombre

**Interfaces:**
- Consumes: la UI de las Tasks 16–19 y los helpers `login`, `expectPageTitle`, `textoVisible` y `pickCurrentMonthDate` de `e2e/helpers.ts`.

- [ ] **Step 1: Sembrar usuarios E2E**

En `e2e/setup-db.ts`, después del bloque del jefe de terreno:

```ts
  /* MIPER F1 (spec 2026-09-30): las tres firmas del flujo, cada una con sólo su
   * permiso, para que el E2E pruebe la segregación real y no la del admin. */
  const miperRoles = [
    { id: "rol-prev-faena-e2e", name: "prevencionista_faena", label: "Prevencionista faena", isGlobal: false, permissions: ["p-prev-risk-view", "p-prev-risk-edit"] },
    { id: "rol-prev-jefa-e2e", name: "prevencionista", label: "Jefe del Departamento de Prevención de Riesgos", isGlobal: true, permissions: ["p-prev-risk-view", "p-prev-risk-review"] },
    { id: "rol-legal-e2e", name: "gerente_legal_rrhh", label: "Gerencia Legal y Recursos Humanos", isGlobal: true, permissions: ["p-prev-risk-view", "p-prev-risk-approve-legal"] },
  ]
  for (const role of miperRoles) {
    await db.insert(schema.roles).values({ id: role.id, name: role.name, label: role.label, description: `${role.label} — E2E MIPER`, isGlobal: role.isGlobal })
    await db.insert(schema.rolePermissions).values(role.permissions.map((permissionId) => ({ roleId: role.id, permissionId })))
  }
  const miperUsers = [
    { id: "user-prev-faena-e2e", name: "Prevencionista Faena E2E", email: "prev.faena@e2e.chome.cl", roleId: "rol-prev-faena-e2e", scoped: true },
    { id: "user-jefa-prev-e2e", name: "Jefa Prevención E2E", email: "jefa.prevencion@e2e.chome.cl", roleId: "rol-prev-jefa-e2e", scoped: false },
    { id: "user-legal-e2e", name: "Legal y RRHH E2E", email: "legal.rrhh@e2e.chome.cl", roleId: "rol-legal-e2e", scoped: false },
  ]
  for (const user of miperUsers) {
    await db.insert(schema.users).values({ id: user.id, name: user.name, email: user.email, hashedPassword: password, avatarColor: "200", isActive: true, createdAt: now, updatedAt: now })
    await db.insert(schema.userRoles).values({ userId: user.id, roleId: user.roleId })
    if (user.scoped) await db.insert(schema.worksiteUsers).values({ userId: user.id, worksiteId: "ws-e2e", isPrimary: true })
  }
```

Verificar tres cosas:
- Que `roles.name` no choque con otro rol sembrado en `setup-db.ts` (buscar `name: "prevencionista"`). Si choca, reutilizar el rol existente y agregarle los permisos.
- Que los ids `p-prev-risk-approve-legal` y `p-prev-risk-catalog` coincidan con el manifiesto (Task 14).
- Que `SYSTEM_PERMISSIONS` los incluya.

- [ ] **Step 2: Escribir el E2E**

```ts
// e2e/prevencion-miper-flujo.spec.ts
import { test, expect, type Browser, type Page } from "@playwright/test"
import { expectPageTitle, login, pickCurrentMonthDate, textoVisible } from "./helpers"

/**
 * E2E MIPER F1 — pasos 1–5, 7–10, 16 y 17 del §12 del spec 2026-09-30.
 * Tres personas con sólo su permiso: la segregación es la del producto, no la
 * del admin. El programa de trabajo (pasos 6 y 11–15) llega en F2.
 */
test.describe.configure({ mode: "serial" })

const PERIOD = "2030"
let miperUrl = ""

async function as(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await login(page, email)
  return page
}

const cell = (page: Page, column: string, row = 1) => page.getByRole("combobox", { name: `${column} riesgo ${row}`, exact: true })
const textCell = (page: Page, column: string, row = 1) => page.getByRole("combobox", { name: `${column} riesgo ${row}`, exact: true })

test("la prevencionista crea la MIPER, la completa y la envía a revisión", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto("/prevencion/miper")
  await expectPageTitle(page, "Matriz IPER (MIPER)")
  await page.getByRole("button", { name: "Nueva MIPER" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Nueva MIPER" })
  await dialog.getByRole("combobox").first().click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  await dialog.getByLabel("Período").fill(PERIOD)
  await dialog.getByRole("radio", { name: "Matriz vacía" }).check()
  await dialog.getByLabel("Motivo").fill("Elaboración inicial del período para la prueba E2E.")
  await dialog.getByRole("button", { name: "Crear borrador" }).click()
  await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?tab=antecedentes/)
  miperUrl = page.url().split("?")[0]!

  // Antecedentes (paso 2): representante en faena y dotación coherente.
  await page.getByLabel("Representante de la empresa en la faena (Administrador de contrato)").fill("Administrador E2E")
  await page.getByLabel("N° total de trabajadores").fill("3")
  await page.getByLabel("Trabajadores hombres").fill("2")
  await page.getByLabel("Trabajadoras mujeres").fill("1")
  await page.getByLabel("Trabajadores otro").fill("0")
  await page.getByRole("button", { name: "Guardar antecedentes" }).click()
  await expect(textoVisible(page, /Guardad|actualizad/i)).toBeVisible()

  // Matriz (pasos 3–5): fila con P×C y clasificación automática.
  await page.getByRole("tab", { name: /Matriz/ }).click()
  await page.getByRole("button", { name: "Agregar la primera fila" }).click()
  await expect(textCell(page, "Actividad")).toBeVisible()
  const fill = async (column: string, value: string) => { await textCell(page, column).fill(value); await textCell(page, column).press("Tab") }
  await fill("Actividad", "Transporte de lodo")
  await fill("Tarea", "Descarga en predio")
  await fill("Puesto de trabajo", "Conductor profesional")
  await fill("Peligro", "Camión en pendiente")
  await fill("Riesgo", "Volcamiento")
  await fill("Daño probable", "Politraumatismo")
  await cell(page, "Factor de riesgo").selectOption({ label: "Mecánico" })
  await cell(page, "Rutinaria").selectOption("yes")
  await cell(page, "Probabilidad").selectOption("4")
  await cell(page, "Consecuencia").selectOption("4")
  await expect(textoVisible(page, "Intolerable · MR 16")).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: "Intolerable" })).toBeVisible()
  await cell(page, "¿Controlado?").selectOption("partial")

  // Medida con jerarquía, responsable y plazo.
  await page.getByRole("button", { name: /Medidas de control del riesgo 1/ }).click()
  const sheet = page.getByRole("dialog", { name: "Riesgo #1" })
  await sheet.getByRole("button", { name: "Agregar medida" }).click()
  await sheet.getByLabel("Tipo de control").selectOption("engineering")
  await sheet.getByLabel("Descripción de la medida").fill("Topes de descarga y señalero en pendiente")
  await sheet.getByLabel("Nombre o cargo responsable").fill("Supervisor de turno")
  await pickCurrentMonthDate(page, /Plazo de la medida/)
  await sheet.getByRole("button", { name: "Agregar medida" }).click()
  await expect(sheet.getByText("Topes de descarga y señalero en pendiente")).toBeVisible()
  await page.keyboard.press("Escape")

  // Envío (paso 7).
  await page.reload()
  await page.getByRole("button", { name: /^Enviar a revisión$/ }).click()
  await expect(textoVisible(page, "Enviado a revisión")).toBeVisible()
})

test("la Jefa observa el riesgo y la prevencionista corrige y reenvía", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto("/prevencion/miper")
  await expect(textoVisible(jefa, "Pendiente de tu revisión")).toBeVisible()
  await jefa.goto(miperUrl)
  await jefa.reload() // la apertura de la ronda se registra al entrar
  await expect(textoVisible(jefa, "En revisión por Prevención")).toBeVisible()
  await jefa.getByRole("button", { name: "Observar riesgo 1", exact: true }).click()
  const sheet = jefa.getByRole("dialog", { name: "Riesgo #1" })
  await sheet.getByLabel("Nueva observación").fill("Revisar consecuencia. De acuerdo con el daño probable indicado debería evaluarse nuevamente la probabilidad.")
  await sheet.getByRole("button", { name: "Registrar observación" }).click()
  await expect(sheet.getByText("Abierta")).toBeVisible()
  await jefa.keyboard.press("Escape")
  await jefa.getByRole("button", { name: "Devolver con observaciones" }).click()
  await jefa.getByRole("dialog").getByRole("textbox").fill("Revisar la evaluación del riesgo #1.")
  await jefa.getByRole("dialog").getByRole("button", { name: "Devolver" }).click()
  await expect(textoVisible(jefa, "Con observaciones")).toBeVisible()

  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(`${miperUrl}?tab=revision`)
  await prev.getByLabel("Tu respuesta").fill("Se reevaluó la probabilidad: el tránsito en pendiente es ocasional.")
  await prev.getByRole("button", { name: "Responder" }).click()
  await prev.getByRole("tab", { name: /Matriz/ }).click()
  await cell(prev, "Probabilidad").selectOption("2")
  await expect(textoVisible(prev, "Importante · MR 8")).toBeVisible()
  await prev.reload()
  await prev.getByRole("button", { name: "Reenviar a revisión" }).click()
  await expect(textoVisible(prev, /Enviado a revisión|En revisión por Prevención/)).toBeVisible()

  await jefa.reload()
  await expect(textoVisible(jefa, "Modificada")).toBeVisible()
  await jefa.getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await jefa.getByRole("dialog").getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(textoVisible(jefa, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("Legal y RRHH aprueba: queda vigente v1 y un cambio posterior queda pendiente", async ({ browser }) => {
  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(miperUrl)
  await legal.getByRole("button", { name: "Aprobar (Legal y RRHH)" }).click()
  await legal.getByLabel("Resumen de cambios (hoja Modificaciones)").fill("Emisión inicial del documento.")
  await legal.getByRole("button", { name: "Aprobar y sellar" }).click()
  await expect(textoVisible(legal, "Vigente · v1")).toBeVisible()
  const download = legal.waitForEvent("download")
  await legal.getByRole("link", { name: "Descargar v1 (Excel)" }).click()
  expect((await download).suggestedFilename()).toMatch(/^RE-04-MIPER-E2E-001-2030-v1\.xlsx$/)

  // Paso 16: el vigente es mutable; el cambio queda pendiente de revisión.
  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(miperUrl)
  await prev.getByRole("button", { name: "Agregar fila", exact: true }).click()
  await expect(textCell(prev, "Actividad", 2)).toBeVisible()
  await textCell(prev, "Peligro", 2).fill("Superficie resbaladiza")
  await textCell(prev, "Peligro", 2).press("Tab")
  await prev.reload()
  await expect(textoVisible(prev, "Vigente v1 · cambios pendientes de revisión")).toBeVisible()

  // Paso 17: historial con actor y rol.
  await prev.getByRole("tab", { name: "Historial" }).click()
  await expect(textoVisible(prev, "Aprobada y sellada por Legal y RRHH")).toBeVisible()
  await expect(textoVisible(prev, "Devuelta con observaciones")).toBeVisible()
  await expect(textoVisible(prev, "Legal y RRHH E2E (Legal y RRHH)")).toBeVisible()
})
```

Si `pickCurrentMonthDate` elige hoy y la validación exige un plazo, hoy sirve (no hay regla de plazo futuro en F1). Si el `ConfirmDialog` de devolución rotula de otra forma su campo de motivo, ajustar el locator al rol real (`textbox`). `cell` y `textCell` son iguales a propósito: los dos son `combobox`, porque un `input` con `list` tiene ese rol ARIA, igual que un `select`. Dejar uno solo si el revisor lo pide.

En `e2e/prevencion-miper-matriz.spec.ts`, primer test: título `"Matriz IPER (MIPER)"`. En vez de `getByText("Faena E2E").first()`, ir a la pestaña "Todas" y usar `await expect(textoVisible(page, "Faena E2E")).toBeVisible()`, porque la matriz legacy del fixture aparece ahí como "Vigente · metodología anterior".

- [ ] **Step 3: Correr los E2E**

Run: `npm run test:e2e -- e2e/prevencion-miper-flujo.spec.ts e2e/prevencion-miper-matriz.spec.ts e2e/prevencion-cgrd-risk-map.spec.ts`
Expected: PASS en los tres. El mapa CGRD sigue funcionando con el fixture legacy.

Si un paso falla:
- Diagnosticar con el trace (`--trace on`) antes de tocar código.
- Un locator que apunta al nodo móvil oculto se corrige en la prueba.
- Un defecto de producto se corrige en su tarea de origen, con su prueba.

- [ ] **Step 4: Recorrido asistido en navegador e informe**

Con el MCP Playwright y el Chromium del repo, como indica la memoria del proyecto:
1. Recorrer en escritorio (1440×900) y móvil (390×844):
   - la portada con los tres roles;
   - el catálogo de factores;
   - el espacio de trabajo en cada modo (edición, revisión técnica, aprobación, vigente, legacy de solo lectura);
   - la ficha de una fila;
   - las pestañas Revisión e Historial;
   - la descarga Excel.
2. En cada pantalla, revisar el checklist de UI de `AGENTS.md`:
   - test de los 5 segundos;
   - A1 (sin tiles sobre la matriz) y A2 (filtros primarios);
   - estados vacíos con CTA;
   - acciones de página en el header;
   - feedback de carga y mutación;
   - confirmación de acciones destructivas;
   - `DatePicker` en todas las fechas;
   - foco visible;
   - desborde en móvil;
   - consola y red.
3. Escribir `qa/reports/<AAAA-MM-DD>-miper-f1.md`, con las categorías del contrato de QA:
   - bugs de producto confirmados;
   - hallazgos funcionales, de UX e inconsistencias;
   - advertencias de automatización;
   - brechas de cobertura (declarar lo que no se recorrió: programa de trabajo, alertas, dashboard e importación, que son F2 y F3);
   - errores de consola y fallas de red;
   - recomendaciones priorizadas.
4. Nunca escribir "100 % auditado".
5. Copiar el contenido también a `qa/reports/latest.md`, si ese es el uso vigente del repositorio (ver `git log -- qa/reports/latest.md`).

- [ ] **Step 5: Commit**

```bash
git add e2e/setup-db.ts e2e/prevencion-miper-flujo.spec.ts e2e/prevencion-miper-matriz.spec.ts qa/reports
git commit -m "test(miper): E2E del flujo F1 con tres firmas segregadas e informe de recorrido"
```

---

#### Task 21: Puertas finales, manual y entrega

**Files:**
- Modify: `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`

- [ ] **Step 1: Actualizar el capítulo del manual**

Reescribir la parte MIPER del capítulo 04 para el flujo nuevo:
- MIPER vivo por faena y período.
- Evaluación P×C con las bandas RE-04.
- Grilla y medidas con jerarquía I–V.
- Revisión técnica por la Jefatura del Departamento de Prevención, con observaciones por fila.
- Aprobación Legal y RRHH, versiones selladas e historial.
- Cambios posteriores en un MIPER vigente.

Explicar el Programa de Trabajo en una línea: "llega en la fase siguiente". La sección del mapa ya remite al capítulo 17 (CGRD); no tocarla.

- [ ] **Step 2: Correr todas las puertas**

```bash
npm run typecheck
npm run lint
npm run check:secrets
npm run test:fast
npm run test:pglite
npm run db:verify-migrations
npm run db:generate        # debe responder "No schema changes"
npm run test:e2e
npm run doctor
```

Expected: todo en verde. Si alguna falla por algo ajeno a F1, verificar con `git stash` sobre `main` que ya fallaba antes. Si es así, reportarlo como preexistente con la evidencia; si no, corregirlo.

- [ ] **Step 3: Commit y resumen**

```bash
git add docs/manual-prevencion
git commit -m "docs(miper): capítulo del manual para el flujo RE-04 de la F1"
```

El resumen final para la persona usuaria debe seguir la sección 4 de `AGENTS.md`:
- qué cambió y los archivos clave;
- las pruebas y puertas ejecutadas, con resultado;
- la verificación en navegador;
- la ruta del informe QA;
- los riesgos que quedan:
  - F2 y F3 pendientes;
  - si hay que retirar a mano los permisos antiguos `approve`/`publish` en `/admin/roles` (Task 14, Step 3);
  - que la migración de limpieza de columnas legacy queda para después de verificar que producción no tiene filas legacy.

---

### Después de F1

F2 (Programa de Trabajo) y F3 (consolas, alertas, exportación e importación) tienen cada una su propio plan, que se escribe cuando esta fase esté integrada. Cada plan parte del spec y del código que dejó la fase anterior. F2 activa en el validador la regla del Intolerable sin actividad (`requireProgramLink: true`) y agrega la pestaña "Programa" al espacio de trabajo.
