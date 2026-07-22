# Plan de integración: los 14 formularios/registros SG-SST 2026 sobre el motor PDTP

Estado: **EN EJECUCIÓN** · Fecha: 2026-07-14
- ✅ **Fase A entregada** (2026-07-14): definiciones single-sujeto sembradas —
  Taller (06, act. 27) y Observación Planeada genérica (14, act. 41). Cero
  esquema. Ver `lib/sst/definitions/inspeccion-taller*.ts`,
  `observacion-planeada*.ts`, `scripts/seed-pdtp-checklists-2026.ts`.
- ✅ **Fase B entregada** (2026-07-14): soporte multi-sujeto — migración aditiva
  `subjectType/subjectId/subjectLabel` + reindex `UNIQUE(executionId, subjectId)`
  (`db/migrations/0055_goofy_roulette.sql`); servicios `getOrCreateExecutionChecklist
  (…, subject?)`, `listExecutionChecklists`, `recalcExecutionQuantityFromInstances`;
  prefijo `[subjectLabel]` en hallazgos; UI multi-instancia con diálogo "Agregar
  sujeto". Backward-compat total (Fase A y tests existentes intactos).
- ✅ **Fase C entregada** (2026-07-14): 7 definiciones multi-sujeto —
  Inspección Equipos Móviles (05, act 33), Carros (07, act 34), Contenedores
  (08, act 29), Extintores (10, act 24), EPP (11, act 64/65), Observación
  Ampliroll (12, act 40) y Observación Maquinaria (13, act 41). Las
  observaciones 12/13 comparten `observacion-seguridad-sections.ts`. El seed
  reemplaza la plantilla genérica de act 41 por la real PR-SGC-25. UI con
  selectores reales de flota/trabajadores por worksiteId (extintor/contenedor
  siguen label libre). Cero esquema adicional.
- ⏭️ **Siguiente**: Fase D (Evidencia objetiva 04 — "hallazgo manual con daño
  potencial→prioridad") y Fase E (Asistencia reuniones/charlas — Nivel 0
  evidencia PDF inmediato).

Estado original: **PROPUESTA** · Fecha: 2026-07-14
Fuente de requisitos: `docx revisado/00-INDICE-MODULOS.md` … `13-*.md` (14 markdowns)
Base técnica existente: `PLAN_PDTP_CHECKLIST_ACCION_SEGUIMIENTO.md` (motor ya implementado)
Alcance: **cómo** integrar el contenido de esos formularios al programa preventivo — **no** cómo reconstruirlo.

---

## 0. Tesis del plan (léase antes que nada)

Los 14 markdowns describen un SaaS de prevención "desde cero": proponen ~30 entidades nuevas
(`Cronograma`, `ActividadProgramada`, `InspecciónEquipoMóvil`, `ItemInspección`,
`ObservaciónSeguridad`, `SeguimientoHallazgo`, `Compromiso`, `EvidenciaObjetiva`…). **Esa es la
lectura que hay que rechazar.** El repositorio **ya tiene** ese SaaS construido y en producción:

- El **cronograma anual** (módulo 01) **es** `pdtpPrograms → pdtpActivities → pdtpActivitySchedule`.
  El programa 2026 (fuente vigente desde 2026-07-22) es **87 actividades, 8 objetivos, 8 hojas**
  (`db/seed/pdtp-catalog-2026.json`; la semilla aún refleja las 89 previas y debe
  regenerarse tras la quita de N°4 y N°8 — ver §2.0 de PLAN_AJUSTE_INTEGRAL_PREVENCION_PDTP_SGSST_2026).
- El **seguimiento y control de hallazgos** (módulo 09) **es** `pdtpActionPlan → pdtpActionPlanFollowups`
  + la página `/prevencion/pdtp/acciones`.
- El patrón **checklist → observación → acción → seguimiento → % cumplimiento** ya está
  implementado end-to-end (ver `PLAN_PDTP_CHECKLIST_ACCION_SEGUIMIENTO.md`, fases 0-6 completas):
  `pdtpActivityChecklists` (plantilla) → `pdtpExecutionChecklists` (instancia) →
  `pdtpExecutionChecklistResponses` (ítem) → `pdtpActionPlan` → `pdtpActionPlanFollowups`,
  con **cumplimiento integral ponderado** (`0.5·ejecución + 0.3·verificación + 0.2·cierre`).
- El **motor de checklist** (`ChecklistDefinition` en `lib/sst/types.ts` + `lib/sst/checklist.ts`)
  ya modela secciones, ítems tipados (`FieldKind`), aplicabilidad por rol/cargo (`appliesWhen`),
  cómputo de cumplimiento y columna de acción correctiva.

Por lo tanto, **integrar los 14 formularios ≠ construir 14 módulos**. Integrarlos significa, en el
99% de los casos, **una sola cosa**:

> **Escribir la `ChecklistDefinition` de cada formulario y adjuntarla como plantilla
> (`pdtpActivityChecklists`) a la actividad 2026 que le corresponde.** Cero tablas nuevas para la
> mayoría; una sola migración aditiva para el único caso que el motor hoy no cubre
> (varias instancias de checklist por ejecución, p.ej. "un extintor = una inspección").

Todo lo demás del plan es: (a) el mapeo formulario→actividad, (b) la única extensión de esquema
necesaria, (c) el hueco real (asistencia de reuniones/charlas — módulo 02 de capacitaciones queda
diferido a su propio módulo futuro), y (d) la lista explícita de lo
que **NO** hay que construir para no duplicar el motor.

---

## 1. Inventario de lo que ya existe (fundamento reutilizable)

| Capacidad | Dónde vive | Qué cubre de los markdowns |
|---|---|---|
| Programa/cronograma anual + hojas + calendario P vs R | `db/schema/prevention/pdtp.ts` (`pdtpPrograms`, `pdtpActivities`, `pdtpActivitySchedule`, `pdtpActivityScheduleOverrides`, `pdtpSheets`) · `db/seed/pdtp-catalog-2026.json` | **Módulo 01 completo** |
| Ejecución mensual/semanal por faena con cantidad + evidencia + flujo aprobación | `pdtpExecutions` (status draft→submitted→approved/rejected, `evidenceText/Url/Photos`) | Registro P/R de todos los módulos |
| Motor de checklist tipado (secciones, ítems, `appliesWhen`, `countsForCompliance`, acción correctiva) | `lib/sst/types.ts`, `lib/sst/checklist.ts`; definiciones reales en `lib/sst/definitions/` | **Módulos 04-08, 10-14** (todo el contenido de inspección/observación) |
| Plantilla de checklist por actividad + instancia llenada + respuestas por ítem | `pdtpActivityChecklists`, `pdtpExecutionChecklists`, `pdtpExecutionChecklistResponses`; servicios `lib/services/pdtp/checklists.ts`, `execution-checklists.ts` | Estructura `Inspección*`/`ItemInspección*` de los markdowns |
| Plan de acción auto-generado desde `no_cumple` + CRUD manual + transiciones + vencidos | `pdtpActionPlan`; `lib/services/pdtp/action-plan.ts` (`generateActionPlanFromChecklist`, `verify/reopen`, `getActionPlanClosureRate`) | **Módulo 09** (`SeguimientoHallazgo`), `HallazgoNoPlaneado` (04), medidas correctivas de toda inspección |
| Bitácora de seguimiento con evidencia | `pdtpActionPlanFollowups`; `lib/services/pdtp/followups.ts` | Seguimiento de cierres de 04/09 |
| Cumplimiento integral 3 ejes + panel | `lib/services/pdtp/compliance.ts` (`getPdtpIntegralCompliance`, `getAverageVerificationCompliance`, `getActionPlanClosureRate`) · `pdtp-indicators-panel.tsx` | Dashboards/KPI de todos los módulos |
| Recordatorios (semanal + acciones vencidas) | `lib/services/pdtp/reminders.ts` + `app/api/cron/pdtp-weekly-reminders` | Alertas/escalamiento de 04/09/10/11 |
| Export Excel multi-hoja (programa + plan de acción + seguimiento) | `lib/services/pdtp/sheets.ts` (`buildPdtpExport`) + `app/api/prevencion/pdtp/export` | Reportería Excel de todos (regla del proyecto: Excel, no CSV) |
| Subida/GC de evidencia fotográfica | `app/api/prevencion/pdtp/evidence/*` (+ `evidence-gc`) | Fotos "antes/después" de 04, fotos de hallazgos |
| **Registro de equipos/flota** (patente, código interno, tipo, faena, SOAP/rev. técnica/permiso/seguro con vencimientos, estado operacional, documentos) | `db/schema/fuel-vehicles.ts` (`fuelVehicles`, `fleetVehicleDocuments`, `fuelEquipmentTypes`) · UI `app/(app)/flota/` | **Sujeto** de módulos 05/07 (equipos, carros); sección DOCUMENTOS ya tiene su fuente de verdad |
| **Registro de trabajadores** (rut, nombre, cargo, supervisor, prevencionista, faena) | `db/schema/worksites.ts` (`workers`) | **Sujeto** de módulos 03/11/12/13 |
| Permisos RBAC del dominio | `modules/prevention/manifest.ts`: `prevention:pdtp:checklist:manage/fill`, `prevention:pdtp:action:manage/verify` | Cubre roles de todos los formularios (PRF/ADM/JT/SUP) |

**Conclusión del inventario:** el sujeto de datos (equipos, trabajadores), el contenedor de
ejecución (executions), el motor de verificación (checklist), el cierre (action plan/followups),
el KPI (integral), la evidencia (API) y el export (Excel) **ya existen**. Falta **contenido**
(las definiciones) y **una** pieza estructural (multi-sujeto).

---

## 2. El reframe: los 14 markdowns → el modelo PDTP

Cada markdown se clasifica en uno de **cuatro patrones de integración**. La columna "Actividad
2026" referencia el `n` en `db/seed/pdtp-catalog-2026.json`.

| # | Markdown | Actividad(es) 2026 (`n`) | Patrón | Trabajo neto |
|---|---|---|---|---|
| 01 | Cronograma Actividades SG-SST | *(todo el programa)* | **A — ya cubierto** | 0 (es el propio PDTP) |
| 09 | Seguimiento y Control | 76 + plan de acción transversal | **A — ya cubierto** | 0 (es `pdtpActionPlan`/`Followups` + `/pdtp/acciones`) |
| 06 | Inspección Taller de Mantención | 27 | **B — solo definición** | 1 `ChecklistDefinition`, sujeto = faena |
| 04 | Evidencia Objetiva (no planeada) | 40, 41 | **B′ — definición ligera / acción directa** | Ver §5.4 (caso especial) |
| 14 | Observaciones Planeadas | 41 | **B — solo definición** | 1 `ChecklistDefinition` genérica |
| 05 | Inspección Equipos Móviles | 33, 34 (y cruces con 24, 25/26) | **C — checklist multi-sujeto** | 1 def + extensión §4, sujeto = `fuelVehicles` |
| 07 | Inspección Carros | 28, 33/34 | **C — multi-sujeto** | 1 def, sujeto = `fuelVehicles` (carro) |
| 08 | Inspección Contenedores | 29 | **C — multi-sujeto** | 1 def, sujeto = contenedor (label libre v1) |
| 10 | Inspección Extintores | 24 | **C — multi-sujeto** | 1 def, sujeto = extintor (label libre v1) |
| 11 | Inspección Uso/Estado EPP | 64, 65 (+ 23, 63) | **C — multi-sujeto** | 1 def, sujeto = `workers` (matriz por trabajador) |
| 12 | Observación Camión Ampliroll | 40/41 (conductual) | **C — multi-sujeto** | 1 def (22 ítems), sujeto = `workers` (operador) |
| 13 | Observación Maquinaria Pesada | 40/41 (conductual) | **C — multi-sujeto** | 1 def (22 ítems), sujeto = `workers` (operador) |
| 03 | Lista de Asistencia (RE-07) | evidencia de 13, 37, 38, 53… | **D — hueco real** | Ver §6 (roster reuniones/charlas + compromisos→acción) |
| 02 | Capacitaciones y Campañas | 15, 16, 46-49, 51-59, 63, 85-89 | **FUERA DE ALCANCE** | Módulo propio futuro — ver §6.0 |

> **Alcance — módulo 02 diferido.** Las capacitaciones y campañas **no** se integran aquí: serán un
> **módulo dedicado a futuro** (roster de participantes, material, evaluación pre/post, certificados,
> cobertura por trabajador). Las actividades 15/16/46-49/51-59/63/85-89 **siguen existiendo** como
> filas del programa 2026 (se ejecutan con cantidad + evidencia como cualquier actividad PDTP); lo que
> se difiere es su superficie de captura específica. El módulo 03 (Lista de Asistencia) **sí** entra,
> pero acotado a **reuniones y charlas** (CPHS, línea de mando, charlas diarias) — el roster de
> capacitaciones vivirá en el módulo 02 futuro.

Patrones:
- **A** = ya está construido; el trabajo es *documentar* que el markdown se satisface aquí, no crear nada.
- **B** = redactar una `ChecklistDefinition` y sembrarla como plantilla. **Cero esquema.**
- **C** = igual que B, pero requiere la **única extensión estructural** (una ejecución sostiene N
  instancias de checklist, una por sujeto: equipo/trabajador/extintor…). Ver §4.
- **D** = el motor de checklist no modela "lista de asistentes con firma"; requiere el mínimo
  incremento de §6.

---

## 3. Por qué se rechaza el esquema literal de los markdowns

El usuario pidió explícitamente no tomar el esquema sugerido de forma literal. Se rechaza por
razones concretas, no estéticas:

1. **Fuente única de verdad de hallazgos.** Los markdowns proponen `HallazgoNoPlaneado`,
   `SeguimientoHallazgo`, "medidas de control" por inspección, "acción correctiva" por observación:
   **cinco tuberías de cierre distintas**. En el repo hay **una** (`pdtpActionPlan`). Duplicarla
   parte el % de cierre, el escalamiento por vencidos y el export en cinco silos incoherentes.
2. **Un solo modelo de cumplimiento.** El `% = buenas/total` de cada markdown ya lo calcula
   `getApplicableItems` + `calculateInstanceCompliance` sobre `ChecklistDefinition`. Reimplementarlo
   por módulo garantiza que "el 78% de la inspección de carros" y "el 78% del programa" se calculen
   distinto.
3. **Un solo registro de equipos y de trabajadores.** `InspecciónEquipoMóvil.placa_patente`,
   `InspecciónCarro.patente_carro`, `Extintor.código`, `EvaluaciónEPP.trabajador` son punteros a
   entidades que **ya existen** (`fuelVehicles`, `workers`). Crear inventarios paralelos desincroniza
   vencimientos de documentación (que hoy viven en `fuelVehicles.*ExpiresAt`) y estado operacional.
4. **Un solo cronograma.** El "avance P vs R mensual/anual" del módulo 01 ya es
   `pdtpActivitySchedule` vs `pdtpExecutions`. No hay dos cronogramas para lo que este plan integra.

Regla de oro para toda la integración: **si un campo del markdown ya tiene dueño en el repo, es una
referencia, no una columna nueva.**

---

## 4. La única decisión de esquema: checklist **multi-sujeto** por ejecución

### 4.1 El problema

Hoy el motor asume **una** instancia de checklist por ejecución:

- `pdtpExecutions` — `UNIQUE(activityId, worksiteId, year, month, week)`: una ejecución por
  actividad/faena/período.
- `pdtpExecutionChecklists` — `UNIQUE(executionId)`: **una** instancia por ejecución.

Eso encaja para "Inspección taller" (una por faena/mes). **No encaja** para los patrones **C**:
"Inspección de extintores" (actividad 24) verifica *N extintores* en el mes; cada extintor es una
inspección con su propio %, sus propios `no_cumple` y su propia acción. Igual con equipos (05),
carros (07), contenedores (08), EPP por trabajador (11) y observaciones por operador (12/13).

### 4.2 Opciones evaluadas

| Opción | Idea | Veredicto |
|---|---|---|
| **1. Instancia por sujeto dentro de la ejecución** | Añadir `subjectType/subjectId/subjectLabel` a `pdtpExecutionChecklists`; una ejecución → N instancias. `executedQuantity` = nº instancias completadas. | ✅ **Recomendada.** 3 columnas + reindex; reutiliza responses/action-plan/compliance sin tocarlos. |
| 2. Una ejecución por sujeto | Codificar el sujeto en `executionId`. | ❌ Explota filas de ejecución, rompe la grilla P/R de la hoja y la semántica de cantidad (una fila por actividad/período). |
| 3. Grilla repetible dentro de la definición | Un checklist con una "sub-fila" por sujeto. | ❌ Abusa de `ChecklistDefinition`, pierde %/acción por sujeto, imposible de exportar por sujeto. |

### 4.3 Diseño recomendado (Opción 1) — aditivo, una migración

En `pdtpExecutionChecklists` añadir:

```
subjectType   text            -- 'equipo' | 'trabajador' | 'contenedor' | 'extintor' | 'carro' | null
subjectId     text NOT NULL DEFAULT ''   -- fuelVehicles.id / workers.id / '' (instancia única de faena)
subjectLabel  text            -- denormalizado para mostrar: patente, nombre, "Extintor #7 / acopio"
```

- **Cambiar** `UNIQUE(executionId)` → `UNIQUE(executionId, subjectId)`.
  Usar `subjectId DEFAULT ''` (no NULL) evita el problema de "NULLs distintos" en el índice único:
  la instancia única de faena (patrón B) usa `subjectId=''`; las multi-sujeto usan el id real.
  El caso legado (una instancia existente) migra a `subjectId=''` sin colisiones.
- `subjectId` **no** es FK física (un extintor/contenedor puede no tener registro; ver §7). La
  integridad hacia `fuelVehicles`/`workers` se valida en el servicio cuando `subjectType ∈ {equipo,
  carro, trabajador}`. `subjectLabel` siempre se persiste para el export.

### 4.4 Servicios a tocar (mínimo)

- `getOrCreateExecutionChecklist(executionId, …)` → aceptar `{subjectType, subjectId, subjectLabel}`;
  hoy crea una por ejecución (`execution-checklists.ts:44`).
- `getExecutionChecklist(executionId)` → `listExecutionChecklists(executionId)` (varias).
- `getAverageVerificationCompliance(executionIds)` (`execution-checklists.ts:234`) — ya promedia por
  instancia vía `porcentajeCumplimiento`; solo asegurar que agrega **todas** las instancias de cada
  ejecución (hoy asume una).
- `generateActionPlanFromChecklist(instanceId, …)` (`action-plan.ts:71`) — **sin cambios**: ya opera
  por instancia y escribe al `pdtpActionPlan` de la ejecución. Solo prefijar `hallazgo` con
  `subjectLabel` (p.ej. "[EQ-042] Alarma de retroceso: no cumple").
- Al completar/enviar cada instancia, recalcular `pdtpExecutions.executedQuantity =
  count(instancias completadas)` para que el eje **ejecución** del cumplimiento integral sea correcto.

Todo lo demás (`pdtpExecutionChecklistResponses`, `pdtpActionPlan`, `pdtpActionPlanFollowups`,
`getActionPlanClosureRate`, export) **no cambia**.

---

## 5. Especificación por formulario (patrones B y C)

Cada formulario es una `ChecklistDefinition` (mismo shape que `lib/sst/definitions/trabajador-nuevo.ts`).
Convención: los ítems "cumple/no cumple" usan `cumple_nocumple_na_obs`; "Bueno/Regular/Malo" y
"Si/No" se **normalizan a cumple/no_cumple** (regular y malo → `no_cumple`, con el matiz en la
observación) para que el % y la generación de acciones sean homogéneos. `hasActionCorrectiva: true`
en las secciones que deben capturar la acción en línea.

> **Regla de normalización B/R/M → cumple/no_cumple:** `B=cumple`, `R=no_cumple` (prioridad media),
> `M=no_cumple` (prioridad alta). El detalle (R vs M) va en `accionCorrectiva`/`observacion`. Esto
> mapea directo al `prioridad → plazo` del plan de acción (`alta=2d, media=7d, baja=15d`,
> `checklist-domain.ts`). Si más adelante se requiere severidad automática real, se añade un
> `FieldKind` `estado_brm` — **no antes** (hoy sería especulativo).

### 5.1 Inspección Equipos Móviles — módulo 05 → actividad 33/34 (patrón C, sujeto=`fuelVehicles`)

- **Secciones** (del markdown 05): `documentos` (4 ítems, `cumple_nocumple_na_obs`),
  `estado_cabina` (14), `accesorios_emergencia` (9), `luces` (8), `levante_cabina` (3), `ruedas` (3),
  `calefaccion` (2), `estado_mecanico` (11), `observaciones` (`text`, `countsForCompliance:false`).
- **Aplicabilidad condicional** con `appliesWhen`: ítems "solo camión carretera" (gata, cruceta,
  botiquín, caja herramientas, rueda repuesto, linterna) → sección `appliesWhen:['camion_carretera']`;
  ítems ampliroll → `appliesWhen:['ampliroll']`. El `subjectType='equipo'` trae el `fuelEquipmentTypes`
  del `fuelVehicles`, que decide qué secciones aplican (se pasa como "cargoKeys" a
  `getApplicableItems`).
- **DOCUMENTOS = fuente de verdad cruzada:** los 4 ítems documentales (licencia, permiso circulación,
  revisión técnica, seguro) **se pre-cargan** desde `fuelVehicles.circulationPermitExpiresAt`,
  `technicalReviewExpiresAt`, `insuranceExpiresAt` (vencido→`no_cumple` automático). No se re-teclea.
- **Bloqueo operacional** (regla de negocio del markdown): si frenos/dirección = `no_cumple`, el
  servicio marca `fuelVehicles.operationalStatus` sugerido = "fuera de servicio" (acción alta). Esto
  es la única escritura *hacia* flota; opcional en v1, valiosa.
- Firmas operador/inspector/revisor → `closingAct.signatureRoles`.

### 5.2 Inspección Taller de Mantención — módulo 06 → actividad 27 (patrón B, sujeto=faena `''`)

- 16 ítems `si_no_obs` (Si/No/Parcial/NA → `cumple`/`no_cumple`/`no_cumple`+obs/`na`) en una sección
  `countsForCompliance:true`, `hasActionCorrectiva:true`. Firmas ejecutor + acompañante.
- **Sin multi-sujeto**: una instancia por faena/mes (`subjectId=''`). Es el caso más simple y el
  primero a entregar (valida el flujo completo sin tocar esquema).

### 5.3 Inspección Carros (07) / Contenedores (08) / Extintores (10) — patrón C

- **Carros (07):** secciones luces(7)/neumáticos(7)/documentos(3)/otros(6), B/R/M normalizado.
  Sujeto=`fuelVehicles` (el carro, vinculado a su camión vía `subjectLabel`). Triple firma.
- **Contenedores (08):** 14 ítems B/R/M/NA/NT (`NT`=no_tiene → item `na` + obs "no tiene"). Sujeto =
  contenedor por **`subjectLabel` libre** en v1 (no hay inventario de contenedores; ver §7). Ítems
  críticos (soportes de levante, cadenas de fijación) en `M` → acción alta.
- **Extintores (10):** por extintor, mezcla campos de **estado** (manómetro, sello, rótulo, manguera,
  CECMEC → `cumple_nocumple_obs`) y campos de **inventario** (tipo, peso, empresa recarga, fecha
  recarga → `select`/`text`/`date`, `countsForCompliance:false`). Sujeto = extintor por `subjectLabel`
  libre en v1. La alerta "recarga vencida" es **follow-up** (§7/§8), no v1.

### 5.4 Evidencia Objetiva No Planeada — módulo 04 → actividad 40/41 (patrón B′, caso especial)

El markdown 04 **no es un checklist periódico**: es un registro *ad-hoc* de condiciones subestándar
detectadas en terreno, con foto, daño potencial y responsable de cierre. Encaja **mejor como
creación directa de ítems de plan de acción** que como checklist:

- La "caminata/observación en terreno" (actividad 41) tiene su ejecución mensual. Dentro de ella,
  cada hallazgo no planeado = un `pdtpActionPlan` con `origen='manual'`, `hallazgo`+`accion`,
  `prioridad` derivada del **daño potencial** del markdown (leve=baja/15d, moderado=media/7d,
  grave=alta/2d, fatal=alta/inmediato), foto vía `evidencePhotos`.
- No se necesita `ChecklistDefinition` para 04. Se necesita **exponer "agregar hallazgo manual" con
  campo daño-potencial→prioridad** en el panel de plan de acción (que ya existe:
  `execution-action-plan-panel.tsx`, `createActionPlanItem`). Extensión mínima de UI, cero esquema.

### 5.5 Inspección Uso/Estado EPP — módulo 11 → actividad 64/65 (patrón C, sujeto=`workers`)

- El markdown 11 es una **matriz trabajador × EPP**. En el motor: **una instancia por trabajador**
  (`subjectType='trabajador'`, `subjectId=workers.id`), definición = 10 ítems EPP.
- Cada EPP combina "usa (Si/No/NA)" + "estado (B/R/M)". Lazy-correcto: **un ítem por EPP**,
  `cumple_nocumple_na_obs`, donde `no_cumple` = "no lo usa **o** está en mal estado" y el motivo va
  en `observacion`. Evita inventar una segunda dimensión y mantiene el % limpio. Excepción:
  **Bloqueador solar** = `entregado_obs` (se verifica registro de entrega, no estado — igual que la
  sección EPP de `trabajador-nuevo-sections.ts`).
- Cobertura ("% trabajadores con EPP completo") = derivada de instancias completadas / trabajadores
  de la faena.

### 5.6 Observaciones de Seguridad — módulos 12 + 13 → **una** definición configurable (patrón C, sujeto=`workers`)

- Los propios markdowns 12/13 lo dicen: 95% de estructura compartida. **Una** `ChecklistDefinition`
  "Observación de seguridad" con 3 secciones (ingreso/término, desplazamiento, operación), 22 ítems
  `si_no_obs`. Las 7 diferencias terminológicas ampliroll↔maquinaria se resuelven con **dos
  plantillas** que comparten secciones (como `trabajador-nuevo`/`trabajador-antiguo` comparten
  `*-sections.ts`), **no** con dos módulos.
- Sujeto = operador (`workers`). `% = buenas/22` = el `calculateInstanceCompliance` estándar.
  "Se reinstruye" = derivado (`hay algún no_cumple`) o campo del `closingAct`. Firmas observador +
  operador + prevención; "huella" = una firma más en `signatureRoles`.
- **Módulo 14 (Observaciones Planeadas)** — el markdown no existe en `docx revisado/` (referenciado en
  el índice, archivo ausente). La actividad 41 sí existe. Se cubre con una plantilla genérica de
  observación planeada (misma maquinaria); confirmar contenido con el cliente antes de redactarla.

---

## 6. El hueco real: Lista de Asistencia (03) para reuniones y charlas

### 6.0 Módulo 02 (Capacitaciones y Campañas) — diferido a módulo propio

Las capacitaciones y campañas **no** se integran en este plan: tendrán su **propio módulo a futuro**
(roster de participantes, material, evaluación pre/post, certificados, cobertura por trabajador). Sus
actividades del programa 2026 (objetivos 4/5/8) permanecen como filas ejecutables con
cantidad + evidencia; su superficie de captura específica se construye en ese módulo, no aquí.

Implicancia práctica: **no se toca la hoja `capacitacion` ni se construye ningún roster de
capacitación** en este alcance. Cuando el módulo 02 se aborde, se recomienda que **consuma** el mismo
`workers` y enrute compromisos/hallazgos a `pdtpActionPlan` (para no re-duplicar el motor), pero eso
es diseño de ese módulo, no de éste.

### 6.1 Lo que sí entra: RE-07 para reuniones y charlas

El módulo 03 es transversal, pero acotado a lo que **sí** es actividad PDTP y no capacitación:
reuniones CPHS (act. 13), reuniones de línea de mando, charlas de seguridad (act. 37, 38, 53). Es lo
único que el motor de checklist **no** modela: una **nómina de asistentes con firma** + un **relator**.

**Qué NO construir aquí:**
- **No** una tabla `Compromiso` (acta de reunión): un compromiso *es* una acción con responsable y
  plazo → se enruta a `pdtpActionPlan` (`origen='manual'`), reutilizando estado/seguimiento/vencidos.

**Qué construir, escalonado:**
- **Nivel 0 (cero tablas, inmediato):** la lista de asistencia firmada se sube como **evidencia**
  (PDF/foto) en `pdtpExecutions.evidencePhotos`/`evidenceUrl`. Satisface la exigencia legal de
  "evidencia de asistencia" de reuniones/charlas sin esquema nuevo. Suficiente para arrancar.
- **Nivel 1 (una tabla, cuando se pida cobertura por trabajador):** `pdtp_attendance`
  `(id, executionId FK, workerId FK nullable, workerName, rut, empresa, firmaUrl)`. Habilita KPI
  "cobertura de charlas/reuniones por trabajador", historial por persona y asistentes externos
  (`workerId=null` + `empresa`). Reutiliza `workers` como directorio. Compromisos → `pdtpActionPlan`.
- El RE-07 imprimible se genera con el `buildPdtpExport`/PDF existente a partir de `pdtp_attendance`.

Recomendación: **entregar Nivel 0 ya**; subir a Nivel 1 solo cuando el KPI de cobertura sea un
requisito confirmado (no especular con la tabla).

---

## 7. Vinculación de sujetos: reutilizar flota y trabajadores

- **Equipos y carros (05/07):** `subjectId = fuelVehicles.id`. El selector de sujeto al "iniciar
  verificación" filtra `fuelVehicles` por `worksiteId` de la ejecución y por
  `equipmentTypeId`/`type`. Documentación (SOAP, rev. técnica, permiso, seguro) se lee de las
  columnas `*ExpiresAt` — no se re-captura.
- **Trabajadores (11/12/13):** `subjectId = workers.id`, filtrados por `worksiteId`. Reincidencia y
  cobertura salen de consultar instancias históricas por `subjectId`.
- **Extintores y contenedores (08/10):** **no hay registro** en el repo. Decisión v1: **`subjectLabel`
  de texto libre** (`subjectType='extintor'|'contenedor'`, `subjectId=''` o código tecleado). Se
  captura todo en el checklist sin inventario permanente.
  - *Follow-up (no v1):* si se requieren alertas de "recarga vencida" (extintor) o "estado
    operativo/fuera de servicio" (contenedor), añadir inventarios mínimos `pdtp_extinguishers` /
    `pdtp_containers` (código, faena, tipo/peso/próxima recarga | estado). **No construir hasta que la
    alerta sea un requisito** — construirlo ahora es inventario especulativo.

---

## 8. Cumplimiento integral con multi-sujeto (cómo suben los ejes)

El cálculo integral (`getPdtpIntegralCompliance`, `compliance.ts:111`) se mantiene; solo cambia cómo
se alimenta cada eje cuando hay N instancias por ejecución:

| Eje | Peso | Con multi-sujeto |
|---|---|---|
| **Ejecución** | 0.5 | `executedQuantity` = nº instancias completadas; contra `plannedQuantity` (= nº sujetos a inspeccionar). |
| **Verificación** | 0.3 | `getAverageVerificationCompliance` promedia `porcentajeCumplimiento` de **todas** las instancias (equipos/trabajadores), no una. |
| **Cierre** | 0.2 | `getActionPlanClosureRate` sin cambios (acciones por ejecución, ya agregadas). |

Así "se inspeccionaron 8/10 extintores (ejecución 80%), promedio conforme 92% (verificación), 3/4
hallazgos cerrados (cierre 75%)" produce un integral coherente y auditable por sujeto.

---

## 9. Autoría y seed de las definiciones

- **Dónde viven:** las definiciones nuevas son datos (`definitionJson`), no código de negocio. Se
  redactan como objetos `ChecklistDefinition` en un seed `db/seed/pdtp-checklists-2026/` (una por
  formulario) y se siembran como `pdtpActivityChecklists` de la actividad 2026 correspondiente
  (`savePdtpActivityChecklist`, `checklists.ts:44`), con `version:'01'`, `isActive:true`.
- **Reutilización de secciones:** las dos observaciones (12/13) comparten `OBSERVACION_SECTIONS`
  igual que `lib/sst/definitions/*-sections.ts`.
- **Editor:** el editor JSON-asistido con validación zod ya existe (fase 1 del plan PDTP). El editor
  visual sigue siendo follow-up; **no** es bloqueante para sembrar estas ~9 definiciones (se escriben
  una vez, se versionan en el repo).
- **Catálogo/plantillas reutilizables:** sembrar también en la biblioteca de plantillas para que una
  faena clone "Inspección de equipos móviles" sin re-teclear (`ensureDefaultChecklist`/catálogo ya
  existente).

---

## 10. Permisos (sin claves nuevas)

Los 4 permisos existentes cubren todo: `prevention:pdtp:checklist:fill` (llenar cualquier
inspección/observación), `:checklist:manage` (editar plantillas), `:action:manage` (hallazgos y
seguimiento, incluye 04 y compromisos de reunión), `:action:verify` (verificar cierre). El acceso a
`fuelVehicles`/`workers` como sujeto reutiliza los permisos de flota/prevención ya vigentes.
**No se añaden claves RBAC** — evita re-sembrar y re-testear parity.

---

## 11. Plan de entrega por fases (incremental, cada fase deployable)

| Fase | Contenido | Esquema | Esfuerzo | Desbloquea |
|---|---|---|---|---|
| **A. Definiciones single-sujeto** | Redactar y sembrar def. Taller (06) y Observación planeada genérica (14); validar flujo completo (iniciar→llenar→enviar→acción→cierre→integral) sin tocar esquema. | 0 | 2-3 d | 06, 14 |
| **B. Multi-sujeto** | Migración §4.3 (`subjectType/subjectId/subjectLabel` + reindex); servicios §4.4; UI "agregar sujeto" en la página de ejecución; rollup §8. | 1 migración aditiva | 4-6 d | habilita C |
| **C. Inspecciones/observaciones multi-sujeto** | Def. 05, 07, 08, 10, 11, 12, 13 + seeds + selector de sujeto (flota/trabajadores/label libre) + pre-carga documental desde `fuelVehicles`. | 0 | 5-8 d | 05,07,08,10,11,12,13 |
| **D. Evidencia objetiva (04)** | "Agregar hallazgo manual" con daño-potencial→prioridad en el panel de acción + foto. | 0 | 1-2 d | 04 |
| **E. Asistencia reuniones/charlas** | Nivel 0 (evidencia PDF) inmediato; Nivel 1 (`pdtp_attendance` + cobertura + RE-07) si se confirma KPI; compromisos→acción. **02 fuera (módulo futuro).** | 0 → 1 tabla | 1 d → +3 d | 03 |
| **F. Follow-ups conocidos** | Wire de fotos en seguimiento (`ExecutionActionPlanPanel` → `/api/prevencion/pdtp/evidence`); badges de estado checklist/acciones en la hoja; inventarios extintor/contenedor + alertas **solo si se piden**; report uso diario (§12). | según scope | opcional | pulido |

Orden crítico: **A → B → C** es la columna vertebral. D y E son paralelizables tras A. F es pulido.

---

## 12. Casos que se dejan explícitamente fuera de v1 (y por qué)

- **Report de uso diario de equipos (actividades 25/26).** Es **diario** y por equipo — choca con el
  grano mensual/semanal de `pdtpExecutions`. Modelarlo como ejecución PDTP distorsiona la grilla. Si
  se requiere, es una **superficie diaria aparte** que reutiliza `ChecklistDefinition` pero **no**
  `pdtpExecutions`. Fuera de v1; decisión de producto antes de diseñar.
- **Inventarios de extintores/contenedores con alertas de vencimiento.** Especulativo hasta que la
  alerta sea requisito (§7). v1 usa `subjectLabel` libre.
- **Editor visual de checklist.** JSON-asistido es suficiente para ~9 definiciones versionadas.
- **Geolocalización de fotos, mapa de calor (04), firma biométrica/huella real.** Nice-to-have; la
  evidencia fotográfica y firmas de rol ya cubren la exigencia legal.

---

## 13. Lo que se construye vs. lo que NO se construye (resumen anti-scope)

**Se construye (todo aditivo):**
- ~9 `ChecklistDefinition` (datos, seeds) — el grueso del valor, cero esquema.
- 1 migración: `subjectType/subjectId/subjectLabel` en `pdtpExecutionChecklists` + reindex.
- UI: selector de sujeto en la página de ejecución; "hallazgo manual con daño potencial" en el panel
  de acción; (opcional) `pdtp_attendance` + roster.
- Ajustes de servicio: `listExecutionChecklists`, agregación multi-instancia en verificación,
  `executedQuantity` = instancias completadas, pre-carga documental desde `fuelVehicles`.

**NO se construye (duplicaría el motor existente):**
- ❌ Módulo/tablas de Cronograma (es `pdtpPrograms/Activities/Schedule`).
- ❌ Módulo/tablas de Seguimiento y Control (es `pdtpActionPlan/Followups` + `/pdtp/acciones`).
- ❌ `InspecciónEquipoMóvil`, `ItemInspección*`, `ObservaciónSeguridad`, `SeguimientoHallazgo`,
  `HallazgoNoPlaneado`, `EvidenciaObjetiva` (son `pdtpExecutionChecklists/Responses/ActionPlan`).
- ❌ Tabla `Compromiso` (es `pdtpActionPlan origen='manual'`).
- ❌ Inventarios paralelos de equipos/carros/trabajadores (son `fuelVehicles`/`workers`).
- ❌ Cualquier superficie de capacitaciones/campañas (módulo 02) — **diferida a su módulo propio** (§6.0); aquí no se toca la hoja `capacitacion`.
- ❌ Claves RBAC nuevas (los 4 permisos existentes bastan).

---

## 14. Decisiones a confirmar con el cliente antes de codificar

1. **Sujeto de extintores/contenedores:** ¿label libre v1 o inventario permanente desde el inicio?
   (Recomendado: label libre; inventario solo si se necesita la alerta de recarga/estado.)
2. **Asistencia de reuniones/charlas (03):** ¿basta evidencia PDF (Nivel 0) o se requiere cobertura
   por trabajador y RE-07 imprimible (Nivel 1) en v1? *(Capacitaciones/campañas — módulo 02 — quedan
   fuera; módulo propio futuro.)*
3. **Bloqueo operacional automático** (05): ¿la inspección con frenos/dirección `no_cumple` debe
   escribir `fuelVehicles.operationalStatus='fuera_de_servicio'`, o solo sugerirlo?
4. **Observaciones planeadas (módulo 14):** falta el markdown; confirmar los ítems reales.
5. **Report de uso diario (25/26):** ¿entra como superficie diaria propia o queda como cantidad +
   evidencia en el PDTP?
6. **Normalización B/R/M:** ¿aceptable colapsar Regular/Malo a `no_cumple` (con prioridad
   media/alta), o se exige preservar la escala de 3 estados en la BD (requiere `FieldKind` nuevo)?

---

## 15. Cómo se valida el éxito

- Un prevencionista abre la actividad "Inspección de extintores" de junio, agrega los N extintores de
  la faena, llena el checklist de cada uno, los `no_cumple` generan acciones con plazo por prioridad,
  y el **cumplimiento integral** de esa actividad refleja ejecución (N/N), verificación (promedio) y
  cierre (acciones cerradas) — **sin una sola tabla nueva de "InspecciónExtintores"**.
- Una observación de operador (12/13) calcula `buenas/22`, marca reinstrucción y firma triple con la
  misma maquinaria que una inspección de taller.
- El export Excel del programa trae, en las hojas ya existentes de plan de acción/seguimiento, los
  hallazgos de **todos** los formularios, no de silos separados.
- El dashboard PDTP muestra el ponderado de 3 ejes alimentado por checklists de equipos, EPP,
  observaciones y talleres — un solo número, una sola fuente.
```
