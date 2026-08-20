# Plan — Mecánicos en el flujo de inspecciones + Reporte de Equipos

## Contexto

El motor de inspecciones de Prevención (`prevention_inspection_*`) está completo y en producción: plantillas versionadas con snapshot congelado, programación con cron diario, ejecución con evidencia fotográfica y cola offline, hallazgos derivados automáticamente de las no conformidades, CAPA obligatoria para hallazgos graves, y revisión segregada de quien ejecutó. Lo que **no** existe es la participación del taller.

Tres huecos concretos lo impiden:

1. **No hay rol de mecánico.** El más cercano, `jefe_mantencion`, no tiene ni un solo permiso `prevention:inspections:*` ni `prevention:capa:*` ([modules/prevention/manifest.ts:557-558](modules/prevention/manifest.ts#L557-L558)).
2. **Una inspección no puede apuntar a un equipo de flota.** `subjectResourceId` es FK exclusiva a `prevention_emergency_resources` ([db/schema/prevention/inspections.ts:91](db/schema/prevention/inspections.ts#L91)) y `listInspectionSubjects` sólo lista esa tabla ([lib/services/prevention-inspections.ts:502](lib/services/prevention-inspections.ts#L502)). Un "KA-122" entra como `subjectLabel` texto libre: sin historial por equipo, sin cruce con mantenciones.
3. **El Reporte de Equipos no está digitalizado.** Documentado como bloqueado en [docs/superpowers/specs/2026-08-12-pdtp-actividades-accionables-design.md:307](docs/superpowers/specs/2026-08-12-pdtp-actividades-accionables-design.md#L307) por dos motivos que **ya caducaron**: "los conductores no tienen cuenta" (resuelto: lo digita el supervisor/mecánico) y "choca con el grano mensual de `pdtpExecutions`" ([PLAN_INTEGRACION_PROGRAMA_2026_FORMULARIOS.md:430](PLAN_INTEGRACION_PROGRAMA_2026_FORMULARIOS.md#L430)) — resuelto: el motor de inspecciones soporta `frequency: 'daily'`.

**Resultado buscado:** el operador sigue llenando el papel en terreno; el supervisor o mecánico lo digita contra el equipo real de flota; una falla genera hallazgo → CAPA asignada al mecánico → mantención programada enlazada; cerrar la mantención alimenta la evidencia de la CAPA. El equipo con falla grave se **propone** sacar de servicio, nunca se bloquea solo.

### Decisiones tomadas (no re-litigar)

| Decisión | Elección |
|---|---|
| Papel del mecánico | Ejecuta inspecciones de equipos **y** repara vía CAPA |
| Reporte de Equipos | Se digitaliza completo |
| Quién lo llena | Supervisor/mecánico lo digita; operadores como texto + foto del papel firmado |
| Falla grave (frenos/dirección) | **Proponer**, no bloquear |
| Derivación | CAPA (obligatoria) **+** mantención propuesta enlazada |
| Trazabilidad | Inspección vinculada al vehículo de flota |

---

## Fases

Dependencias: **F1 → F4, F5**. **F5 → F6**. F2 y F3 son independientes y paralelizables desde el inicio. F0 va antes que F2.

### F0 · Verificación previa (sin código)

Dos comprobaciones que, si salen mal, invalidan fases enteras:

1. **¿Existe ya un rol `mecanico` creado a mano desde `/admin/roles` en producción?** `ensureSystemRbac` hace upsert por `roles.id` pero `roles.name` es UNIQUE ([db/schema/users.ts:58](db/schema/users.ts#L58)); si alguien ya creó `mecanico` con id `role-<nanoid>`, agregarlo a `SYSTEM_ROLES` con `id: "rol-mecanico"` hace **fallar `db:sync-rbac` en el deploy**. Consulta: `SELECT id, name, is_global FROM roles WHERE name = 'mecanico'`. Si existe, o se renombra el existente, o se adopta su `id` en `SYSTEM_ROLES`.
2. **Numeración de migraciones.** La última es `0190_inspection_subject_resource`. Hay trabajo concurrente en este checkout ([memoria: concurrent-editing](/home/allopze/.claude/projects/-home-allopze-dev-chome-bodega/memory/concurrent-editing-2026-07-28.md)); confirmar `db/migrations/meta/_journal.json` antes de generar, porque la colisión de numeración ya mordió antes.

---

### F1 · Sujeto de flota en el motor de inspecciones

**Decisión de diseño: columna `subject_vehicle_id` FK nueva, no par polimórfico.**

Descarto `subjectKind` + `subjectRef` sin FK aunque sea el patrón "general": es exactamente lo que hizo el motor PDTP (`subjectId` referencia `fuelVehicles.id`/`workers.id` **sin FK física**, [lib/validation/prevention-module/pdtp.ts:341-345](lib/validation/prevention-module/pdtp.ts#L341-L345)) y por eso no puede garantizar que el sujeto exista. La columna con FK real:

- Conserva integridad referencial y `ON DELETE set null`, igual que `subjectResourceId`.
- No toca la evidencia congelada existente: cero backfill, cero riesgo sobre runs históricos.
- El discriminador para la UI ya existe: `subjectType` (text libre, [inspections.ts:83](db/schema/prevention/inspections.ts#L83)).
- Es aditiva y nullable — respeta la trampa conocida de `ADD COLUMN NOT NULL`.

**Migración `0191_inspection_subject_vehicle.sql`** (patrón calcado de [0190](db/migrations/0190_inspection_subject_resource.sql)):

```sql
ALTER TABLE "prevention_inspection_programs" ADD COLUMN "subject_vehicle_id" text;
ALTER TABLE "prevention_inspection_runs"     ADD COLUMN "subject_vehicle_id" text;
ALTER TABLE "prevention_inspection_programs" ADD CONSTRAINT "..._subject_vehicle_id_fuel_vehicles_id_fk"
  FOREIGN KEY ("subject_vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE set null;
ALTER TABLE "prevention_inspection_runs"     ADD CONSTRAINT "..._subject_vehicle_id_fuel_vehicles_id_fk"
  FOREIGN KEY ("subject_vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE set null;
CREATE INDEX "prevention_inspection_run_subject_vehicle_idx"
  ON "prevention_inspection_runs" USING btree ("subject_vehicle_id");
-- Invariante explícita: un run tiene a lo más un sujeto tipado.
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_run_single_subject"
  CHECK (num_nonnulls("subject_resource_id", "subject_vehicle_id") <= 1);
```

**Archivos:**

- [db/schema/prevention/inspections.ts](db/schema/prevention/inspections.ts) — `subjectVehicleId` en `preventionInspectionPrograms` (junto a :63) y `preventionInspectionRuns` (junto a :91), + el `check` y el índice.
- **Nuevo:** `listFleetVehicles(session, { worksiteId, activeOnly })` en [lib/services/fleet.ts](lib/services/fleet.ts). La consulta "vehículos activos de una faena" está inlineada en ~8 sitios; el modelo a extraer es [prevencion/pdtp/.../page.tsx:63-72](app/(app)/prevencion/pdtp/[programId]/ejecucion/[executionId]/page.tsx#L63-L72). Debe usar `worksiteScopeSql` ([lib/auth/scope.ts:85-94](lib/auth/scope.ts#L85-L94)), no `inArray` a mano. **No** migrar los otros 7 call-sites en este plan — fuera de alcance, se hace cuando se toquen.
- [lib/services/prevention-inspections.ts](lib/services/prevention-inspections.ts):
  - `listInspectionSubjects` (:502) → devuelve la unión etiquetada: recursos de emergencia + vehículos de flota, cada uno con su `kind` discriminador (`"resource" | "vehicle"`). Mantener el `requireAccess(..., "prevention:inspections:view", worksiteId)`.
  - `createInspectionRun` (:548) → validar `subjectVehicleId` contra `fuel_vehicles` con el **mismo criterio de faena** que ya aplica al recurso (:570-581): el vehículo debe pertenecer a `data.worksiteId`. `subjectLabel` se congela desde `plate` + `code` ("KA-122 · ABCD-12").
  - `createInspectionProgram` / `updateInspectionProgram` (:374, :408) → aceptar `subjectVehicleId`.
  - `completeInspectionRun` (:929-950) → el bloque que escribe `lastInspectedAt`/`nextInspectionAt` en `preventionEmergencyResources` sólo aplica a recursos; **no** inventar campos equivalentes en `fuel_vehicles` (no existen). Dejar el `if (run.subjectResourceId)` como está.
- [lib/services/prevention-inspection-scheduler.ts:98](lib/services/prevention-inspection-scheduler.ts#L98) — propagar `subjectVehicleId` del programa al run materializado, junto a `subjectType`.
- UI: [inspections-screen.tsx:89-96](app/(app)/prevencion/inspecciones/inspections-screen.tsx#L89-L96) precarga `subjectsByWorksite`; el picker en `inspection-run-list.tsx` agrupa por tipo. Usar `OptionSelect` ([components/ui/option-select.tsx](components/ui/option-select.tsx)) con centinela `__none__`, nunca `<select>` nativo.

**No simplificar:** la validación de faena del vehículo. Sin ella un id de otra faena entra por la acción y filtra la patente ajena — es el mismo agujero que el comentario de :570 ya cierra para recursos.

---

### F2 · Rol `mecanico` (RBAC)

Sin migración: *"RBAC is seeded via seed/sync, never in migrations"* ([AGENTS.md:47-49](AGENTS.md#L47-L49)).

**Permisos exactos** (mínimo funcional, sin sobre-otorgar):

| Permiso | Por qué |
|---|---|
| `prevention:inspections:view` + `:execute` | Ejecutar el Reporte de Equipos y derivar hallazgos a CAPA |
| `prevention:capa:view` + `:complete` | Ver su acción, avanzarla y registrar evidencia |
| `operations:view_work` | `/pendientes` y el chip **"Mis tareas"** ([operational-work-queue.ts:1160](lib/services/operational-work-queue.ts#L1160)) — es la única superficie real de "mis acciones" |
| `flota:view` | Ver el equipo inspeccionado |
| `mantenciones:view` + `:create` + `:edit` | Registrar y cerrar la mantención derivada |

**Deliberadamente NO se otorgan:** `prevention:inspections:review` (la norma exige que quien revisa no sea quien ejecutó — `assessRunReview` ya lo bloquea, pero el permiso invitaría al error), `prevention:capa:verify` y `:close` (segregación: [prevention-capa.ts:218-226](lib/services/prevention-capa.ts#L218-L226) prohíbe que el responsable verifique).

**Archivos:**

- [lib/auth/system-rbac.ts:33](lib/auth/system-rbac.ts#L33) — `{ id: "rol-mecanico", name: "mecanico", label: "Mecánico", description: "...", isGlobal: false }`.
- [lib/auth/role-scope.ts:2-13](lib/auth/role-scope.ts#L2-L13) — agregar `mecanico` a `WORKSITE_SCOPED_ROLE_NAMES`: es rol de faena, y sin faenas asignadas **no ve nada** (`resolveWorksiteScope` → `{mode:"none"}` → `sql\`false\``).
- `defaultGrants` en [modules/prevention/manifest.ts](modules/prevention/manifest.ts) (bloque de inspecciones ~:833 y de CAPA ~:698), [modules/mantenciones/manifest.ts:31](modules/mantenciones/manifest.ts#L31), [modules/flota/manifest.ts](modules/flota/manifest.ts), [modules/operations/manifest.ts](modules/operations/manifest.ts).
- **Además, a `jefe_mantencion`**: `prevention:inspections:view` + `prevention:capa:view`. Hoy no ve nada de lo que su taller va a recibir. Es lectura pura, sin riesgo de segregación.

**Tests a actualizar** (rompen por igualdad exacta de arrays ordenados alfabéticamente):

- [lib/__tests__/prevention-rbac.test.ts:151-341](lib/__tests__/prevention-rbac.test.ts#L151-L341) — insertar `"mecanico"` y `"jefe_mantencion"` en su **posición alfabética** en cada `toEqual` afectado.
- [lib/__tests__/auth-bootstrap-permissions.test.ts:22-54](lib/__tests__/auth-bootstrap-permissions.test.ts#L22-L54) — paridad rol↔grant.
- Fixtures: [e2e/setup-db.ts](e2e/setup-db.ts) y [scripts/capture-all-routes.ts:1177-1183](scripts/capture-all-routes.ts#L1177-L1183).

**Trampa del sync:** `ensureSystemRbac` **no actualiza `isGlobal` en roles existentes** — su `SET` sólo cubre `name`, `label`, `description` ([lib/auth/bootstrap.ts:22-26](lib/auth/bootstrap.ts#L22-L26)). Si F0 encuentra un `mecanico` preexistente con el flag mal puesto, hay que corregirlo desde `/admin/roles` o por UPDATE manual.

**Deploy:** `db:migrate` → **`npm run db:sync-rbac`** → código. Orden no negociable ([scripts/deploy-prod.sh:109-113](scripts/deploy-prod.sh#L109-L113)).

---

### F3 · Desacoplar el selector de responsable CAPA

**Bug real, independiente de todo lo demás.** El diálogo que deriva un hallazgo a CAPA se puebla con `listInspectionAssignees` ([prevention-inspections.ts:1597](lib/services/prevention-inspections.ts#L1597)), que devuelve **usuarios con `prevention:inspections:execute`**. Un mecánico que sólo repara no aparece en el selector, aunque el servicio lo aceptaría (`assertActiveResponsible` sólo exige que exista y esté activo).

Y el módulo CAPA ya resuelve esto bien con otra función: `listAssignableCapaUsers` ([prevention-capa.ts:785-800](lib/services/prevention-capa.ts#L785-L800)) devuelve usuarios activos **con fila en `worksite_users` de esa faena** — el criterio correcto.

**Fix de raíz — una consulta, dos guardas:**

1. Extraer el `selectDistinct` de `listAssignableCapaUsers` a `listWorksiteAssignableUsers(worksiteId, scope)` (sin chequeo de permiso), en `lib/services/prevention-capa.ts`.
2. `listAssignableCapaUsers` pasa a ser el wrapper con `requirePermission(..., "prevention:capa:view")`.
3. En [inspecciones/[runId]/page.tsx:31](app/(app)/prevencion/inspecciones/[runId]/page.tsx#L31), reemplazar `listInspectionAssignees` por la función base, guardada por `prevention:inspections:execute`.

`listInspectionAssignees` **se conserva** para lo que sí le corresponde: poblar `assignedToUserId` de programas y ejecuciones, donde el criterio "quien puede ejecutar" sí es el correcto. Sólo deja de usarse para el responsable de CAPA.

**Además** (descubribilidad, barato y de alto impacto): [capa-list.tsx:231](app/(app)/prevencion/capa/[id]/../capa-list.tsx#L231) muestra `"Usuario asignado"` en vez del nombre cuando no hay `responsibleSnapshot`. Resolver el nombre en `listCapaActionsPage` y mostrarlo. Sin esto el mecánico no se encuentra a sí mismo en la lista.

---

### F4 · Definición del Reporte de Equipos

**Depende de F1** (el sujeto es el vehículo).

**Nuevo `FieldKind: 'number'`.** El horómetro es dato de cálculo: alimenta `maintenance_records.hourMeterReading` en F5 y los umbrales de `getUsageMaintenanceAlerts`. Capturarlo como `text` admite "134.122", "134122" y "134,122" en la misma columna y lo vuelve inservible. El costo real es de cuatro ediciones puntuales:

- [lib/sst/types.ts:9-27](lib/sst/types.ts#L9-L27) — sumar `'number'` a la unión `FieldKind`.
- [lib/prevention/inspections.ts:158](lib/prevention/inspections.ts#L158) — agregarlo a `NON_SCORABLE_KINDS` (es dato, no juicio de conformidad).
- `validateAnswerRow` (:223) — para `kind: 'number'`, exigir que `value` parsee a número finito ≥ 0.
- [inspection-run-detail.tsx:190-225](app/(app)/prevencion/inspecciones/[runId]/inspection-run-detail.tsx#L190-L225) — una rama más en `NonScorableField`: `<Input type="number" inputMode="decimal">`.

**Archivos nuevos:** `lib/sst/definitions/reporte-equipos-sections.ts` y `lib/sst/definitions/reporte-equipos.ts`, siguiendo el par que ya usan las 12 definiciones. Registrar en [lib/sst/definitions/index.ts](lib/sst/definitions/index.ts) (`CHECKLIST_DEFINITIONS['reporte_equipos']` + export).

**Estructura fiel al papel:**

| Sección | `countsForCompliance` | Ítems / kinds |
|---|---|---|
| `identificacion` | `false` | Área de trabajo (`text`), Turno (`select`: día/tarde/noche), Operador entrante (`text`), Operador saliente (`text`) — la faena, la fecha y el código de equipo **no son ítems**: son el `worksiteId`, el `scheduledFor` y el sujeto del run |
| `horometro` | `false` | Horómetro inicio (`number`), Horómetro término (`number`) |
| `control_mantencion` | `false` | HR/KM faltantes: ac. motor, ac. transmisión, ac. corona, otro (`number`); Lavado hora 1/2, Sopleteo hora 1/2/3, Engrase hora 1 (`text`); Carga combustible litros (`number`) |
| `estado_camion` | `true` | Los 19 ítems NORMAL/FALLA del cuerpo: luces, baliza, bocina, alarma de retroceso, fugas de aceite o aire, espejos, cinturón de seguridad, freno de servicio, freno de mano, estado de carrocería, neumáticos y llantas, nivel de agua, nivel de aceite motor, nivel de aceite hidráulico, extintor, tableros de instrumentos, dirección, estado del asiento, pernos y tuercas de rueda |
| `estado_acoplado` | `true` | Los mismos ítems marcados "SI APLICA" en el papel, como sección aparte |
| `exclusivo_carga` | `true` | Rotor, garra, link y pasadores, orugas, balde (cargador frontal / excavadora) |
| `exclusivo_camion` | `true` | Estado de ampliroll |
| `observaciones` | `false` | Observaciones (`textarea`), Solucionado durante el turno (`textarea`) |

**Escala:** todos los ítems de estado usan `cumple_nocumple_na_obs` (NORMAL = cumple, FALLA = no cumple, N/A para las celdas que el papel deja en blanco por no aplicar al equipo). No usar B/R/M: el papel no tiene estado intermedio.

**`danoPotencial`** — es lo que deriva criticidad del hallazgo y prioridad/plazo de la CAPA ([capaPriorityForCriticality](lib/prevention/inspections.ts#L127)):
- `fatal`: freno de servicio, freno de mano, dirección.
- `grave`: alarma de retroceso, bocina, luces, cinturón de seguridad, neumáticos y llantas, pernos y tuercas de rueda, extintor, fugas de aceite o aire, link y pasadores.
- `moderado`: espejos, baliza, asiento, niveles, tableros, rotor, garra, orugas, balde, ampliroll.
- `leve`: estado de carrocería.

**Acta de cierre** — la triple firma del papel:
```ts
closingAct: {
  title: 'Cierre del reporte de turno',
  resultOptions: [
    { value: 'operativo', label: 'Equipo operativo' },
    { value: 'operativo_con_observaciones', label: 'Operativo con observaciones' },
    { value: 'fuera_de_servicio', label: 'Equipo fuera de servicio' },
  ],
  hasRestrictions: true,
  signatureRoles: ['operador_entrante', 'operador_saliente', 'supervisor_turno'],
}
```
Las firmas se registran como rol + nombre + `signedAt` estampado por el servidor ([completeInspectionRun:915-923](lib/services/prevention-inspections.ts#L915-L923)); el trazo real vive en la **foto del papel firmado**, adjunta como evidencia de respuesta vía [api/prevencion/inspecciones/evidence](app/api/prevencion/inspecciones/evidence/route.ts). Esa foto es la evidencia legal — no simplificarla fuera.

La impresión sale gratis: [print/document.tsx](app/(print)/prevencion/inspecciones/[runId]/print/document.tsx) ya renderiza secciones, cumplimiento, hallazgos y acta con firmas.

---

### F5 · Propuesta de fuera de servicio + mantención derivada

**Depende de F1 y F4.**

**Dónde engancharlo: en `createFindingCapa`, no en `completeInspectionRun`.** Razón: completar es un cálculo automático que **borra y recrea los hallazgos abiertos sin CAPA** ([:882-888](lib/services/prevention-inspections.ts#L882-L888)); enganchar ahí dejaría mantenciones huérfanas cada vez que alguien reabre y vuelve a cerrar. Derivar a CAPA, en cambio, es el acto deliberado de una persona y ya es la puerta única de la derivación.

**Migración `0192_maintenance_from_inspection.sql`:**

```sql
ALTER TABLE "maintenance_records" ADD COLUMN "inspection_finding_id" text;
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_inspection_finding_id_fk"
  FOREIGN KEY ("inspection_finding_id") REFERENCES "public"."prevention_inspection_findings"("id") ON DELETE set null;
-- Idempotencia: un hallazgo genera a lo más una mantención.
CREATE UNIQUE INDEX "maintenance_record_finding_unique"
  ON "maintenance_records" ("inspection_finding_id") WHERE "inspection_finding_id" IS NOT NULL;
```

**5.a — Mantención propuesta.** Extender el schema Zod de `createFindingCapa` ([:1024-1029](lib/services/prevention-inspections.ts#L1024-L1029)) con `createMaintenance?: boolean`. Cuando viene `true` y el run tiene `subjectVehicleId`, dentro de **la misma transacción**:

- Insertar en `maintenance_records`: `vehicleId` del run, `worksiteId` del run, `maintenanceType: 'correctiva'`, `status: 'scheduled'`, `maintenanceDate` = `targetDate` de la CAPA (ya calculado por `capaPriorityForCriticality`), `hourMeterReading`/`odometerReading` leídos de la respuesta del ítem de horómetro del run según `fuelVehicles.meterType`, `inspectionFindingId` = el hallazgo.
- **No** reutilizar `createMaintenanceRecord` ([lib/services/maintenance.ts:230](lib/services/maintenance.ts#L230)): recibe `session` y abre su propia escritura; aquí hace falta participar de la transacción existente. Extraer `createMaintenanceRecordWithClient(tx, input, actorUserId)` con el cuerpo actual y dejar `createMaintenanceRecord` como wrapper — mismo patrón que `createCapaActionWithClient`. **Conservar el doble chequeo de faena** de :234-242 (faena imputada + faena del vehículo).
- `recordAudit` con `entityType: "maintenance_record"`, como el resto del módulo.

En el diálogo ([inspection-run-detail.tsx:953](app/(app)/prevencion/inspecciones/[runId]/inspection-run-detail.tsx#L953)): un checkbox "Programar mantención del equipo", visible **sólo** si el run tiene sujeto vehículo.

**5.b — Propuesta de fuera de servicio (no bloqueo).** La CAPA ya nace con `requiresImmediateStop: true` para criticidad `critical`, y la lista CAPA ya tiene el filtro rápido `immediate_stop`. Falta el puente al vehículo:

- **Extraer** la lógica de intervalos operacionales, hoy inlineada en [app/(app)/combustibles/actions-module/vehicles.ts:183-186](app/(app)/combustibles/actions-module/vehicles.ts#L183-L186), a `setVehicleOperationalStatus(tx, { vehicleId, status, reason, actorUserId })` en `lib/services/fleet.ts`. Cierra el intervalo abierto y abre el nuevo, respetando el índice único parcial que garantiza **un solo intervalo abierto por vehículo** ([db/schema/fuel-vehicles.ts:80](db/schema/fuel-vehicles.ts#L80)). Es el fix de raíz: hoy esa lógica está duplicada en tres puntos del mismo archivo.
- **Notificar, no escribir.** Al derivar un hallazgo `critical` sobre un vehículo, `createFindingCapa` emite —post-commit, con `notifySafely` ([:1010](lib/services/prevention-inspections.ts#L1010))— una notificación a quienes tengan `combustibles:manage_vehicles` en esa faena, con `entityHref` al vehículo y el hallazgo como motivo.
- Nueva server action `proposeVehicleOutOfServiceAction` guardada por `combustibles:manage_vehicles`, que confirma el cambio llamando a `setVehicleOperationalStatus` con `reason` = descripción del hallazgo + código del run. **Nadie con permiso de inspecciones cambia el estado del equipo por su cuenta.**

**Qué pasa si se reabre la inspección:** `transitionInspectionRun` hacia `in_progress` limpia cumplimiento y conteos, y `completeInspectionRun` sólo borra hallazgos **abiertos sin CAPA**. Un hallazgo ya derivado sobrevive, y con él su mantención y su CAPA. Correcto y sin trabajo extra.

---

### F6 · Cerrar el círculo: mantención completada → evidencia CAPA

**Depende de F5.**

En `updateMaintenanceRecord` ([lib/services/maintenance.ts:276](lib/services/maintenance.ts#L276)), cuando la transición lleva a `status: 'completed'` y la fila tiene `inspectionFindingId`: insertar una fila en `prevention_capa_evidence` (`kind: 'document'`, `reference` = id/código de la mantención, `description` = tipo + fecha + taller) contra la CAPA enlazada al hallazgo.

**Escribir la fila directamente en la transacción, no vía `addCapaEvidenceWithClient`** ([prevention-capa.ts:599](lib/services/prevention-capa.ts#L599)): ese servicio exige `prevention:capa:complete` al actor, y quien cierra la mantención puede ser un `jefe_mantencion` que no lo tiene. Es evidencia generada por el sistema, no declarada por una persona; acoplarla a un permiso de Prevención rompería el flujo por el lado equivocado. Documentarlo con comentario en el sitio.

Esto importa porque `in_progress → pending_verification` **exige evidencia** cuando `evidenceRequired` (default `true`) y el conteo **excluye las notas** ([:467](lib/services/prevention-capa.ts#L467)): sin este puente, el mecánico repara, cierra la mantención, y su CAPA sigue trabada pidiendo evidencia que ya existe en otro módulo.

---

### F7 · Programación diaria y acreditación PDTP

- **Seed de la plantilla.** Agregar a `PDTP_2026_INSPECTION_SPECS` ([lib/services/pdtp-adapters/inspection-templates-2026.ts:49](lib/services/pdtp-adapters/inspection-templates-2026.ts#L49)): `{ n: 25, definitionCode: "reporte_equipos", name: "Reporte de Uso Diario de Equipos", kind: "inspection" }`. Se instala **aprobada**, como las otras diez.
- **Actividad 26 ("Revisión y firma del report") queda fuera y manual.** `onInspectionCompleted` dispara al **completar**, no al revisar ([:981](lib/services/prevention-inspections.ts#L981)); acreditar "revisión y firma" en el momento de la ejecución falsificaría la evidencia. Extender el conector para disparar también en `reviewed` cambia el contrato para las diez plantillas existentes — es un ajuste aparte, no parte de esto. Declarar `pdtpActivityNumbers: [25, 28]` y dejar 26 documentada como pendiente.
- **Programación:** un `prevention_inspection_programs` por equipo con `frequency: 'daily'`, `intervalDays: 1`, `subjectVehicleId` y `assignedToUserId` = supervisor de la faena. El cron ([materializeProgramRuns](lib/services/prevention-inspection-scheduler.ts#L44)) los materializa con idempotencia por `(programId, scheduledFor)`.
- **Ojo de escala:** `MAX_PROGRAMS_PER_RUN = 500` (:42). Con 18 equipos activos en 6 faenas hay margen de sobra, pero un programa diario por equipo crece lineal con la flota — dejar el número dicho en el commit.

---

### F8 · Verificación

**Unitarios (vitest, sin BD):**
- `validateAnswerRow` con `kind: 'number'`: rechaza `"abc"`, `"-5"`, acepta `"134122"` y `"134122.5"`.
- `fieldKindIsScorable('number') === false`.
- La definición `reporte_equipos` pasa `itemsFromDefinition` y `assessRunCompletion` con un set completo de respuestas; y **falla** si falta un ítem de estado.
- `capaPriorityForCriticality` sobre el `danoPotencial` de frenos → `critical` + `requiresImmediateStop`.

**PGlite** (patrón de [lib/__tests__/prevention-inspections-postgres.test.ts](lib/__tests__/prevention-inspections-postgres.test.ts)):
- `createInspectionRun` con `subjectVehicleId` de **otra faena** → rechaza.
- El CHECK `single_subject` rechaza un run con ambos sujetos.
- `createFindingCapa` con `createMaintenance: true` crea CAPA + mantención en una transacción; el índice único impide la segunda.
- Completar la mantención inserta la evidencia CAPA y desbloquea `pending_verification`.
- Reabrir el run **no** borra el hallazgo derivado ni su mantención.

**RBAC:** actualizar los `toEqual` de [prevention-rbac.test.ts](lib/__tests__/prevention-rbac.test.ts) y correr `auth-bootstrap-permissions.test.ts` — verifica que todo `defaultGrant` apunte a un `roleSlug` que existe en `SYSTEM_ROLES` (si no, **revienta en import**, no en el test).

**E2E** (extender [e2e/prevencion-inspecciones.spec.ts](e2e/prevencion-inspecciones.spec.ts), hoy 48 líneas de smoke): sesión de mecánico → abre el reporte diario de un equipo → responde con una FALLA en frenos → completa con acta y triple firma → deriva a CAPA marcando "programar mantención" → verifica que la mantención aparece en `/mantenciones` y la CAPA en `/pendientes` con el chip "Mis tareas".
Recordatorios del harness: `PGHOST=/var/run/postgresql`; **las corridas no se solapan** (comparten servidor y BD); cuidado con el clic antes de hidratar.

**Manual, extremo a extremo:** `npm run db:migrate` → `npm run db:sync-rbac` → `npm run db:seed-pdtp-inspection-templates` → crear usuario con rol `mecanico` + faena en `/admin/usuarios` → crear el programa diario del equipo → `runProgramNowAction` desde el catálogo → digitar el reporte de la foto (KA-122, horómetro 134122→135120, bocina y alarma de retroceso en FALLA) → confirmar que se derivan dos hallazgos, que la CAPA de la alarma queda `high` a 7 días, y que la mantención nace `scheduled`.

---

## Riesgos y trampas

| Riesgo | Mitigación |
|---|---|
| **Rol `mecanico` preexistente creado por UI** rompe `db:sync-rbac` por `roles.name` UNIQUE | F0 lo verifica antes de tocar `SYSTEM_ROLES` |
| **`isGlobal` no se actualiza** en roles ya persistidos | Corregir desde `/admin/roles`; no confiar en el sync |
| `defaultGrants` con `roleSlug` desconocido | **Lanza en import** ([system-rbac.ts:77](lib/auth/system-rbac.ts#L77)) y tumba build, tests y app. Agregar el rol a `SYSTEM_ROLES` **antes** que los grants |
| Numeración de migraciones | Trabajo concurrente en el checkout; confirmar el journal antes de generar |
| Mecánico ve **toda** la CAPA de su faena, no sólo la suya | Limitación conocida de `listCapaActionsPage`; el filtro real es el chip "Mis tareas" de `/pendientes`. Acotar la lista exigiría tocar el servicio y la UI — **fuera de alcance**, se dice explícito |
| Aviso de asignación llega **al día siguiente** | No hay notificación en la asignación; llega por el cron [prevention-capa-reminders.ts:77-89](lib/services/prevention-capa-reminders.ts#L77-L89). Aceptado; si molesta, es un `createNotifications` en `createFindingCapa` |
| Tailwind escanea `.md` | Clases con pipe en documentos rompen el build — ya pasó dos veces |
| Un programa diario por equipo crece con la flota | Cota `MAX_PROGRAMS_PER_RUN = 500` documentada en el commit |

## Fuera de alcance (explícito)

- **Cuentas para operadores** y modo quiosco: se digita el papel, decisión tomada.
- **Actividad PDTP 26** ("revisión y firma"): requiere que el conector acredite en `reviewed`, cambio de contrato para las diez plantillas existentes.
- **Migrar los 7 call-sites restantes** a `listFleetVehicles`: se hará cuando se toque cada uno.
- **Filtro "mis acciones" en `/prevencion/capa`**: existe en `/pendientes`, duplicarlo no aporta.
- **Input de archivo para evidencia CAPA**: hoy es referencia de texto libre; F6 la genera automática, que es el caso que importa aquí.
- **Bloqueo operacional automático**: decisión tomada — proponer, no bloquear.
