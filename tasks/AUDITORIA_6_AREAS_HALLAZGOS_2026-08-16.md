# Auditoría 6 áreas de Prevención — hallazgos (copia local)

Informe navegable: https://claude.ai/code/artifact/e3bcaa18-34f7-4432-b11c-d557f579046e

Copia local **para que los agentes puedan leer los enunciados**: en la Fase 7 el verificador
no pudo contrastar 3 hallazgos (PPA-07, PPA-08, CPHS-04) porque el informe sólo existía como
URL, y tuvo que inferir a qué cambio correspondían. Base `ac766b9`, 57 hallazgos verificados
adversarialmente (0 CRITICAL, 0 HIGH).

## CPHS-01 [MEDIUM] — El quórum se alcanza sin ningún representante de las personas trabajadoras, y `required` es la mitad —no la mayoría— cuando los titulares son pares
**Área:** CPHS · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `lib/prevention/cphs.ts:99-122` · **Componente:** `assessQuorum`

**Evidencia:** El cálculo sólo cuenta cabezas; no exige presencia de ambas representaciones:
```ts
104 export function assessQuorum(args: {
105   members: CommitteeMemberRow[]
106   attendedMemberIds: string[]
107 }): { reached: boolean; required: number; effective: number } {
108   const active = args.members.filter((member) => member.status === "active")
109   const titulars = active.filter((member) => member.seat === "titular")
110   const attended = new Set(args.attendedMemberIds)
111   const required = Math.ceil(titulars.length / 2)
112 
113   let effective = titulars.filter((member) => attended.has(member.id)).length
114   for (const representation of ["company", "workers"] as const) {
115     const absentTitulars = titulars.filter((member) => member.representation === representation && !attended.has(member.id)).length
116     const presentSubstitutes = active.filter((member) =>
117       member.seat === "suplente" && member.representation === representation && attended.has(member.id)).length
118     effective += Math.min(absentTitulars, presentSubstitutes)
119   }
120 
121   return { reached: titulars.length > 0 && effective >= required, required, effective }
122 }
```
El propio docstring dice «Quórum: mayoría de titulares activos presentes» (líneas 99-103), pero `Math.ceil(n/2)` con n par devuelve exactamente la mitad (6 titulares → 3), que es empate, no mayoría. La composición estándar del CPHS es 3+3 titulares, es decir justo el caso par. `lib/services/prevention-cphs.ts:672-684` usa esta función como única puerta para cerrar el acta, y `app/(app)/prevencion/cphs/[committeeId]/committee-detail.tsx:466-469` la reusa como vista previa, así que no hay segunda barrera en ninguna capa. La prueba `lib/__tests__/prevention-cphs-calc.test.ts:88-99` incluso fija como correcto `attendedMemberIds: ["w1","s1"]` → `reached: true`, es decir quórum con cero representantes de la empresa.

**Escenario:** 1. Comité con 3 titulares de empresa (c1,c2,c3) y 3 de trabajadores (w1,w2,w3).
2. Sesión convocada; asisten sólo c1, c2 y c3.
3. Con `prevention:cphs:manage` se abre «Cerrar acta», se marcan c1,c2,c3 y se envía `closeCommitteeMeeting`.
4. `assessQuorum`: titulars=6, required=ceil(6/2)=3, effective=3 → `reached: true`.
5. El acta se cierra con `quorumReached: true`, se persisten las minutas y cada acuerdo genera una acción CAPA vinculante.

**Actual:** El acta queda cerrada como sesión válida con la mitad de los titulares y sin ningún representante de las personas trabajadoras; los acuerdos derivan a CAPA como si fueran acuerdos del comité paritario.
**Esperado:** El cierre debe rechazarse: el DS 54 art. 17 exige que la reunión se efectúe «con la asistencia de a lo menos un representante patronal y uno de los trabajadores», y si la regla interna declarada es mayoría de titulares, con 6 titulares el mínimo debería ser 4 (floor(n/2)+1), no 3.
**Impacto:** Actas jurídicamente inválidas registradas como válidas, con acuerdos y acciones correctivas derivadas de una sesión que no fue paritaria. Es el requisito central del órgano; además la certificación Bronce (`monthly_meetings`) cuenta esas actas como cumplimiento.
**Causa raíz:** El quórum se modeló como un conteo agregado de titulares y suplentes sin la restricción de composición por representación, y el umbral usa `ceil(n/2)` (mitad) en lugar de `floor(n/2)+1` (mayoría) que es lo que declara su propia documentación.
**Corrección:** En `assessQuorum` (lib/prevention/cphs.ts:104) calcular la cobertura por representación (titular presente, o suplente presente de la misma representación cubriendo a un titular ausente) y devolver `reached` sólo si ambas representaciones tienen al menos un asistente efectivo, además de `effective >= required` con `required = Math.floor(titulars.length / 2) + 1`. Añadir al resultado los campos por lado (p. ej. `companyEffective`/`workersEffective`) para que el mensaje de error de `closeCommitteeMeeting` (lib/services/prevention-cphs.ts:682-684) explique cuál falta; el diálogo ya reusa la misma función, así que la vista previa se corrige sola. Actualizar `lib/__tests__/prevention-cphs-calc.test.ts:71-99`, que hoy fija el comportamiento incorrecto.

**⚠️ Matiz del verificador:** Code matches the citation exactly (lib/prevention/cphs.ts:104-122): `const required = Math.ceil(titulars.length / 2)` and `return { reached: titulars.length > 0 && effective >= required, ... }`, with no representation term. I checked every other layer for a second gate and found none: `closeCommitteeMeeting` (lib/services/prevention-cphs.ts:670-684) calls `assessQuorum` and throws only on `!quorum.reached`; the dialog (committee-detail.tsx:466-469) reuses the same function as a preview; there is no DB CHECK on quorum in db/schema/prevention/cphs.ts:178-185 (only `closed_has_minutes`); no comment or design-doc entry documents a decision (the only quorum notes in docs/superpowers/specs/2026-08-13-modulo-sst-cphs-design.md:372 and schema:191-194 are about guests not counting). So the REAL half of the finding — a session can reach quorum with zero members of one representation, e.g. the test at lib/__tests__/prevention-cphs-calc.test.ts:88-97 asserts `reached: true` with only `w1`+`s1` present — stands. The OTHER half is wrong: DS 54 art. 17 sets the functioning quorum at one representative per side, not a numeric majority, so `ceil(n/2)` is already STRICTER than the norm and the `floor(n/2)+1` claim rests only on the docstring's loose wording, not on any legal or documented requirement. The composition gap is a real compliance hole but does not produce a wrong count or corrupt data, and it requires the whole worker (or company) bench to be absent while the other side shows up in full — HIGH overstates it.

---

## CPHS-03 [MEDIUM] — La certificación mide «meses con acta cerrada» por la fecha de cierre en el sistema (instante UTC), no por la fecha de la sesión
**Área:** CPHS · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs-certification.ts:144-152, 265-267` · **Componente:** `gatherCertificationEvidence`

**Evidencia:** La consulta de sesiones ni siquiera trae `heldAt`:
```ts
144     client.select({
145       closedAt: preventionCommitteeMeetings.closedAt,
146       scheduledFor: preventionCommitteeMeetings.scheduledFor,
147       status: preventionCommitteeMeetings.status,
148       agendaSentAt: preventionCommitteeMeetings.agendaSentAt,
149       sentToManagementAt: preventionCommitteeMeetings.sentToManagementAt,
150     })
```
y el mes se deriva del timestamp de cierre:
```ts
265   const closedInPeriod = meetingRows.filter((row) =>
266     row.status === "closed" && row.closedAt !== null && row.closedAt.slice(0, 4) === String(args.periodYear))
267   const monthsWithClosedMeeting = new Set(closedInPeriod.map((row) => row.closedAt!.slice(0, 7))).size
```
`closedAt` lo fija el servidor al cerrar (`closedAt: now` con `nowIso()` = UTC, lib/services/prevention-cphs.ts:686 y 729), mientras que la fecha real de la sesión es `heldAt`, capturada aparte. El requisito Bronce compara `monthsWithClosedMeeting >= monthsElapsed` (lib/prevention/cphs-certification.ts:165-174). Todo el resto del período se recorta igual con cortes UTC: incidentes entre `${periodStart}T00:00:00.000Z` y `${periodEnd}T23:59:59.999Z` (líneas 180-181), inspecciones por `executedAt.slice(0,4)` (249), IPER por `createdAt.slice(0,4)` (256), invitados por `scheduledFor.slice(0,7)` (259-262) — en Chile (UTC-3/-4) las 21:00-24:00 caen ya en el día/mes/año UTC siguiente.

**Escenario:** 1. El comité sesiona el 28 de enero y el acta se cierra en la plataforma el 3 de febrero (situación normal: se redacta y firma después).
2. Vuelve a sesionar el 25 de febrero y cierra el acta el 2 de marzo.
3. Se abre el expediente Bronce del año y se consulta el requisito «Reuniones mensuales».

**Actual:** Enero aparece sin acta cerrada (su acta cuenta como febrero); el detalle dice «1 de 2 meses del período con acta cerrada» y el requisito queda `not_met`. Al presentar el expediente se abre una acción CAPA de brecha con plazo de 60 días por un incumplimiento inexistente. El efecto inverso también ocurre: un acta cerrada el 1 de marzo por una sesión de febrero «rellena» marzo.
**Esperado:** El mes debe derivarse de la fecha de la sesión (`heldAt`) convertida a día calendario chileno, no del instante UTC en que se registró el cierre.
**Impacto:** El indicador legal más visible de la certificación (sesionar todos los meses) puede reportar brechas falsas o cumplimientos falsos, y esas brechas se congelan en el expediente presentado y generan CAPA reales.
**Causa raíz:** Se usó el timestamp de registro (`closedAt`) como proxy de la fecha del hecho (`heldAt`), y todos los cortes de período se hacen con `slice()` sobre cadenas UTC en vez de la noción de día calendario chileno que el repo ya tiene en `todayInChile()`.
**Corrección:** Traer `heldAt` en la consulta de sesiones y derivar el mes desde él con la zona `America/Santiago` (reusar el formateador de `lib/services/prevention-cphs-access.ts:30-34`, extrayéndolo a un helper `chileMonth(instant)`), aplicando el mismo criterio a incidentes, inspecciones, IPER e invitados. De paso, `monthsElapsed = Number(cappedEnd.slice(5,7))` (líneas 123-124) cuenta el mes en curso como transcurrido, por lo que el día 1 de cada mes el requisito ya exige el acta de ese mes: descontar el mes en curso o documentar la decisión.

---

## EMERGENCIAS-01 [MEDIUM] — Un plan aprobado sigue siendo mutable: se le agregan escenarios, roles, recursos y contactos sin re-aprobación y sin subir `version`
**Área:** Emergencias · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-emergency.ts:133-153,162-190,206-232,242-262` · **Componente:** `addEmergencyScenario / addEmergencyRole / addEmergencyResource / addEmergencyContact`

**Evidencia:** Las cuatro altas hijas tienen exactamente el mismo guardia de estado, y sólo bloquean `archived`:

```ts
// :139 (idéntico en :168, :212, :248)
if (plan.status === "archived") throw new Error("Un plan archivado no admite cambios.")
```

Ninguna de las cuatro toca la fila del plan: no hay `tx.update(preventionEmergencyPlans)` en ellas (el único update del plan en todo el archivo está en `approveEmergencyPlan`, :294-303). Es decir, `version`, `updatedAt`, `approvedByUserId` y `approvedAt` quedan congelados en el instante de la aprobación mientras el contenido sigue creciendo.

La UI habilita esas altas sobre un plan aprobado: `app/(app)/prevencion/emergencias/[planId]/plan-detail.tsx:126,157,188,227` usan `canManage && plan.status !== "archived"`, no `isDraft`. Y esas acciones sólo exigen `prevention:emergency:manage` (actions.ts:55-77), no `prevention:emergency:approve`.

Además el CAS de aprobación queda ciego a los cambios de contenido: `approveEmergencyPlan` compara `plan.version !== data.expectedVersion` (:281) pero ninguna mutación hija incrementa esa versión.

**Escenario:** 1. El prevencionista P crea el plan de la faena A y agrega 1 escenario (incendio) y 1 rol.
2. El aprobador Q abre el detalle, revisa esos dos elementos y ve `version = 1`.
3. Antes de que Q pulse "Aprobar plan", P agrega un segundo escenario con un procedimiento de respuesta distinto (`addEmergencyScenario`). El plan sigue en `version = 1`.
4. Q aprueba con `expectedVersion: 1`. El CAS pasa: aprueba contenido que nunca revisó, sin ninguna advertencia.
5. Ya con el plan aprobado, P sigue agregando escenarios, roles del organigrama, recursos y contactos indefinidamente. El registro sigue diciendo `approvedByUserId = Q`, `approvedAt = <paso 4>`, `version = 2`.

**Actual:** El plan aprobado (el que la faena declara vigente y el que habilita programar simulacros) admite contenido nuevo indefinidamente sin que intervenga nadie con `prevention:emergency:approve`, y el registro de aprobación queda atestiguando un contenido que ya no es el que existía cuando se aprobó. No es posible reconstruir desde la fila del plan qué versión estaba en vigor en una fecha dada (sólo desde `prevention_emergency_history`, que registra las altas sueltas pero no un corte del plan).
**Esperado:** O bien las altas hijas se rechazan sobre un plan `approved` (obligando a un ciclo de nueva versión), o bien cada alta hija incrementa `preventionEmergencyPlans.version` y devuelve el plan a `draft` exigiendo re-aprobación. En cualquiera de los dos casos el CAS de `approveEmergencyPlan` debe detectar que el contenido cambió entre la revisión y la firma.
**Impacto:** El único control de segregación del módulo (crear ≠ aprobar, :284) se elude por completo después de la aprobación: quien sólo tiene `manage` fija procedimientos de respuesta a emergencia y designa el organigrama de un plan "aprobado" sin firma de nadie. Ante una fiscalización DS 44 arts. 18-19 no se puede acreditar qué plan estaba efectivamente aprobado en la fecha del incidente.
**Causa raíz:** El guardia de mutación se escribió contra `archived` (estado que además nunca se alcanza, ver EMERGENCIAS-02) en vez de contra "no editable después de aprobado", y las tablas hijas no participan de la versión del padre — exactamente la clase de defecto que la auditoría previa encontró en CAPA.
**Corrección:** En las cuatro altas, reemplazar el guardia por `if (plan.status !== "draft") throw new Error(...)` y, si se quiere permitir edición controlada, hacerlo dentro del ciclo de nueva versión de EMERGENCIAS-02. Si en cambio se decide permitir enriquecer un plan vigente, entonces cada alta debe hacer el CAS del padre en la misma transacción (`update ... set version = version + 1, updatedAt = now where id = ? and version = ?`) y devolver el plan a `draft`. La UI debe alinearse: `plan-detail.tsx:126,157,188,227` deben condicionar a `isDraft`, no a `!== "archived"`.

**⚠️ Matiz del verificador:** Citas exactas. Las cuatro altas hijas repiten literalmente 'if (plan.status === "archived") throw new Error("Un plan archivado no admite cambios.")' (:139, :168, :212, :248) y ninguna toca la fila del plan; grep de 'update(preventionEmergency' sobre todo el repo devuelve SOLO :294 (aprobar) y :411 (completar simulacro). La UI habilita las altas con 'canManage && plan.status !== "archived"' (plan-detail.tsx:126,157,188,227), no con isDraft. No hay decision deliberada: ningun comentario la justifica y ningun test la fija (prevention-emergency-postgres.test.ts cubre segregacion de aprobacion y CAPA, nada post-aprobacion). El motor hermano si bloquea: prevention-inspections.ts:195 'if (template.status !== "draft") throw new Error("Solo una plantilla en borrador puede cambiar sus actividades PDTP.")'. El defecto es real. Bajo a MEDIUM por dos mitigantes omitidos: (a) cada alta escribe en prevention_emergency_history con actor, afterState y timestamp (history(), :84-95), asi que el cambio queda trazado y no es adulteracion encubierta; (b) el TOCTOU del paso 3-4 exige prevention:emergency:manage y una ventana de segundos, y el contenido solo crece (no existe borrado ni edicion de escenarios/roles). No hay bypass de permisos ni perdida de datos.

---

## EMERGENCIAS-02 [MEDIUM] — No existe ninguna ruta que archive un plan: una faena queda con un único plan de emergencia para siempre y el segundo intento revienta con el error crudo de Postgres
**Área:** Emergencias · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-emergency.ts:108-123; db/schema/prevention/emergency.ts:29-37` · **Componente:** `createEmergencyPlan / preventionEmergencyPlans`

**Evidencia:** El esquema declara el ciclo de vida por versiones:

```ts
// db/schema/prevention/emergency.ts:30-33
// Una faena puede tener planes archivados de versiones anteriores, pero
// sólo un plan vigente (draft o approved) a la vez.
uniqueIndex("prevention_emergency_plan_active_worksite_unique").on(table.worksiteId)
  .where(sql`${table.status} <> 'archived'`),
```

El índice está vivo en la base (`db/migrations/0093_whole_mastermind.sql:132`). Pero `archived` no lo escribe nadie: `grep -rn "update(preventionEmergency"` sobre todo el repo devuelve exactamente dos ocurrencias, `prevention-emergency.ts:294` (aprobar plan) y `:411` (completar simulacro). Las cinco menciones restantes de `"archived"` en el servicio son sólo lecturas de guardia (:139,:168,:212,:248,:283). No hay `archiveEmergencyPlanAction`, ni botón, ni job.

`createEmergencyPlan` inserta directo sin comprobar si la faena ya tiene plan:

```ts
// :112-119
const [created] = await db.insert(preventionEmergencyPlans).values({
  id: `pemgp-${nanoid()}`,
  worksiteId: data.worksiteId,
  ...
```

Y el selector de faena del diálogo ofrece todas las faenas del alcance sin excluir las que ya tienen plan (`emergencias-dialogs.tsx:40-42`, alimentado por `listEmergencyWorksites`, :614-624, que sólo filtra `isActive`). El error resultante llega literal al usuario: `actions.ts:38` devuelve `error.message` y `lib/hooks/use-operation.ts` lo pinta tal cual.

**Escenario:** 1. La faena A tiene su plan de emergencia 2026 aprobado.
2. Llega 2027 y Prevención debe emitir el plan del nuevo período (o rehacer el plan tras un cambio mayor de proceso).
3. Se abre "Nuevo plan", se elige la faena A y se envía.
4. Postgres rechaza por `prevention_emergency_plan_active_worksite_unique`.
5. Se busca cómo archivar el plan anterior: no hay acción, ni botón, ni endpoint.

**Actual:** El usuario ve en el diálogo el texto crudo del error de Postgres (`duplicate key value violates unique constraint "prevention_emergency_plan_active_worksite_unique"`), que además filtra el nombre del índice. La faena queda atrapada con su primer plan de forma permanente: el estado `archived` es inalcanzable y el versionado que el esquema describe no existe.
**Esperado:** Una acción `archiveEmergencyPlan` (permiso `prevention:emergency:approve`, con motivo, registrada en `prevention_emergency_history`) que libere el índice parcial, y `createEmergencyPlan` que detecte el plan vigente antes de insertar y devuelva un mensaje de dominio ("La faena ya tiene un plan vigente; archívalo antes de emitir el siguiente") en vez del error de la base.
**Impacto:** El módulo no puede sostener la renovación periódica del plan, que es su razón de ser regulatoria. Como efecto colateral, tampoco hay historial de versiones: `preventionEmergencyDrills.planId` es `onDelete: restrict`, así que ni siquiera borrando a mano se sale del bloqueo si el plan ya tiene simulacros.
**Causa raíz:** El ciclo de vida se diseñó en el esquema (índice parcial + estado `archived` + comentario) y se implementó sólo la mitad: la transición `draft → approved`. La transición `approved → archived` y la emisión de la versión siguiente nunca se escribieron.
**Corrección:** Agregar `archiveEmergencyPlan(input, access)` con permiso `prevention:emergency:approve`, CAS sobre `version`, `reason` obligatorio e inserción en `preventionEmergencyHistory` (`changeType: "archived"`), reutilizando el mismo patrón de `approveEmergencyPlan` (:275-308). En `createEmergencyPlan`, consultar antes el plan no archivado de la faena y lanzar el mensaje de dominio. Opcionalmente, una acción de "emitir nueva versión" que archive el vigente y clone escenarios/roles/contactos dentro de una sola transacción — eso además cierra EMERGENCIAS-01 con un camino usable.

**⚠️ Matiz del verificador:** Verificado en los tres puntos. El indice esta vivo: db/migrations/0093_whole_mastermind.sql:132 'CREATE UNIQUE INDEX "prevention_emergency_plan_active_worksite_unique" ON "prevention_emergency_plans" USING btree ("worksite_id") WHERE ... status <> ''archived''. Nadie escribe 'archived': las unicas escrituras a tablas de emergencia en TODO el repo son :294 y :411, y las cinco menciones restantes son guardias de lectura. createEmergencyPlan inserta directo (:112-119) y listEmergencyWorksites (:614-624) solo filtra isActive, asi que el selector ofrece faenas ya con plan (emergencias-dialogs.tsx:41). El mensaje crudo si llega al usuario: actions.ts:38 'return { ok: false, message: error instanceof Error ? error.message : ... }' y use-operation.ts lo pinta tal cual ('El mensaje viene del servicio/action, mostrandose tal cual'). Incluso el propio plan de la Fase 6 declara como verificacion 'archivar un plan de emergencia y confirmar que el inventario sobrevive' (PLAN_BRECHAS_PREVENCION_2026-08-15.md:329), paso hoy inejecutable. Bajo a MEDIUM: es una transicion de ciclo de vida nunca construida (mitad draft->approved implementada), con frecuencia anual por faena, y con paliativo real derivado del propio EMERGENCIAS-01 (el plan aprobado sigue admitiendo altas, asi que la faena no queda sin poder documentar). Ademas 0171 desacoplo el inventario del plan (planId nullable, onDelete set null), que era el dano irreversible.

---

## EMERGENCIAS-04 [MEDIUM] — El inventario de equipos de emergencia es de sólo alta: no hay forma de registrar una inspección, ni de cambiar el estado, ni de cargar el vencimiento — la alerta que el módulo emite no se puede apagar nunca
**Área:** Emergencias · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-emergency.ts:206-232,522-560; app/(app)/prevencion/emergencias/[planId]/plan-detail.tsx:404-447` · **Componente:** `addEmergencyResource / getEmergencyDashboardCounts / AddResourceDialog`

**Evidencia:** Tres huecos encadenados, todos verificados por grep sobre el repo completo:

1. **No hay update.** `grep -rn "update(preventionEmergency"` devuelve sólo `:294` (plan) y `:411` (simulacro). `lastInspectedAt`, `nextInspectionAt`, `status` y `expiresAt` se escriben únicamente en el insert de `addEmergencyResource` (:214-227) y ya no se pueden modificar jamás.

2. **La UI no envía los campos nuevos.** El diálogo manda exactamente cinco campos:
```tsx
// plan-detail.tsx:413-420
addEmergencyResourceAction({
  planId, name: ..., kind: ..., location: ...,
  lastInspectedAt: lastInspectedAt || null,
  nextInspectionAt: nextInspectionAt || null,
})
```
`expiresAt` y `serialNumber` —agregados por `db/migrations/0171_exotic_valeria_richards.sql` y aceptados por `resourceSchema` (:197-203)— no tienen control en el formulario, así que en producción quedan siempre `NULL`.

3. **Los contadores que sí se calculan se tiran.** `getEmergencyDashboardCounts` calcula cuatro agregados de recursos (:538-543, `overdueInspection`, `expired`, `outOfService`, `totalResources`) y los devuelve (:555-558), pero `grep -rn "resourcesOverdueInspection|resourcesExpired|resourcesOutOfService|totalResources"` no encuentra ni un consumidor: la interfaz `counts` de `emergency-list.tsx:57-65` sólo declara los seis campos de planes y simulacros.

La alerta sí es visible: `lib/services/prevention-attention.ts:211-233,252-270` construye ítems `emergency_resource` ("Equipo de emergencia vencido", "Inspección de equipo atrasada") que se pintan en la portada de Prevención (`prevention-home.tsx:33-42`).

**Escenario:** 1. Se registra un extintor con `nextInspectionAt = 2026-07-01`.
2. Pasa el 1 de julio. La portada de Prevención muestra "Inspección de equipo atrasada · Extintor · …" en rojo.
3. Prevención inspecciona el extintor en terreno y entra a marcarlo: en el detalle del plan la tabla de recursos es de sólo lectura (plan-detail.tsx:204-218, sin columna de acciones) y no existe ninguna acción de servicio que actualice la fila.
4. La alerta queda encendida para siempre. La única salida es un UPDATE a mano en la base.

**Actual:** El módulo emite una alerta de cumplimiento que no ofrece ningún camino para atenderla, y el vencimiento del equipo (`expiresAt`), que es la mitad del propósito de la funcionalidad recién agregada, no se puede cargar desde la aplicación: el filtro `expired` del panel y la rama "Equipo de emergencia vencido" de la portada son inalcanzables con datos creados por la UI.
**Esperado:** Una acción `recordEmergencyResourceInspection` / `updateEmergencyResource` (permiso `prevention:emergency:manage`, alcance por `resource.worksiteId`, CAS o al menos historial) que actualice `lastInspectedAt`, `nextInspectionAt`, `expiresAt` y `status`; el formulario de alta con los campos `expiresAt` y `serialNumber`; y los cuatro contadores de recursos mostrados en el panel o eliminados de la consulta.
**Impacto:** El inventario de equipos de emergencia (DS 594: extintores, botiquines, camillas) queda congelado en el momento del alta. Las alertas rojas permanentes entrenan al usuario a ignorar la portada de Prevención, que es donde también aparecen los vencimientos de higiene.
**Causa raíz:** La funcionalidad se construyó de atrás hacia adelante (esquema → índices → consultas de alerta) sin cerrar el camino de escritura: la migración 0171 y las consultas de lectura entraron el 2026-08-15, el formulario no se tocó.
**Corrección:** Agregar la acción de actualización de recurso reutilizando el patrón de `addEmergencyResource` (:206-232) —resolver el recurso, `requireAccess(access, "prevention:emergency:manage", resource.worksiteId)`, update, `history(...)`— y una fila de acción en la tabla de recursos de `plan-detail.tsx`. Agregar los dos `Field` faltantes al diálogo de alta. Y o se muestran los cuatro contadores de recursos en `emergency-list.tsx`, o se saca la tercera consulta de `getEmergencyDashboardCounts` (:538-543), que hoy corre en cada carga de la página para nada.

---

## LEGAL-01 [MEDIUM] — Al publicar una versión enmendada del requisito, las aplicabilidades de la versión anterior siguen vivas: el registro cuenta dos veces la misma obligación y nadie queda obligado a re-evaluar
**Área:** Requisitos legales · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-legal.ts:557-585, lib/services/prevention-risk-legal.ts:883-895` · **Componente:** `transitionLegalRequirement / getLegalDashboard`

**Evidencia:** La rama de publicación sólo marca superada la versión previa:
```
if (data.toStatus === "published") {
  const hash = sha256({ code: requirement.code, ... })
  Object.assign(updates, { publishedHashSha256: hash, publishedByUserId: access.userId, publishedAt: now })
  if (requirement.supersedesRequirementId) {
    ... .set({ status: "superseded", version: previous.version + 1, updatedAt: now }) ...
  }
}
```
No toca `prevention_legal_applicabilities`, no inserta en `preventionPdtpUpdateObligations` y no crea ningún `preventionRiskReviewTrigger` (el tipo `'legal_change'` existe en el enum del schema :240 y en zod :88 pero NINGÚN punto del repo lo emite — grep de `legal_change` sólo devuelve las dos definiciones). Y el dashboard une aplicabilidades con requisitos SIN filtrar estado:
```
db.select({ applicability: ..., requirement: ..., worksiteName: worksites.name })
  .from(preventionLegalApplicabilities)
  .innerJoin(preventionLegalRequirements, eq(preventionLegalRequirements.id, preventionLegalApplicabilities.requirementId))
  ...
  .where(scopeCondition(access.scope, preventionLegalApplicabilities.worksiteId))
```
y la brecha se calcula sobre ese mismo conjunto: `applicability.applicabilityStatus === "applicable" && (...)` (:893). El propio test de integración deja el estado final probatorio: en prevention-risk-legal-postgres.test.ts:172-204 se crea la aplicabilidad de ws-risk-a contra v1, se publica v2 y se crea OTRA aplicabilidad de ws-risk-a contra v2; la primera queda `applicable`+`noncompliant` para siempre.

**Escenario:** 1. Prevención registra DS44-ART7 v1, se revisa, aprueba y publica.
2. Para la faena A se propone y aprueba la aplicabilidad; se evalúa `noncompliant` (se abre CAPA).
3. El regulador modifica el artículo: se crea la v2 con `sourceRequirementId` = v1 y se publica. v1 pasa a `superseded`.
4. Se propone y aprueba la aplicabilidad de la faena A contra la v2 y se evalúa `compliant`.
5. Se abre /prevencion/requisitos-legales y se exporta el Excel.

**Actual:** El KPI "Aplicables" cuenta 2 para una sola obligación de la faena A (la de v1 superada y la de v2), la pestaña Brechas sigue mostrando la brecha de v1 aunque el texto legal ya no exista, la hoja "Aplicabilidad" del export repite la misma faena/código dos veces, y `getPdtpCoverage` (:1015) sigue devolviendo como activo el `preventionPdtpSourceLinks` que apunta al requisito superado (la consulta de links no filtra por estado del requisito), de modo que una actividad del PDTP aparece cubierta por un texto derogado. Ninguna faena recibe tarea ni reloj para re-evaluarse contra la v2.
**Esperado:** Al publicar una versión que supera a otra, el sistema debe (a) marcar las aplicabilidades de la versión superada como cerradas/históricas para que dejen de contarse en aplicables y brechas, (b) crear una obligación o disparador `legal_change` por faena afectada con plazo, y (c) marcar como obsoletos —o al menos señalizar— los vínculos PDTP que apuntan al requisito superado.
**Impacto:** El indicador de cumplimiento legal, que es la salida del módulo ante un fiscalizador de la DT/SUSESO, se degrada con cada enmienda: mezcla obligaciones vigentes con derogadas y muestra brechas de textos que ya no rigen. Peor: la enmienda de una norma —el evento que MÁS obliga a re-evaluar— no genera ninguna tarea, así que las faenas pueden seguir operando contra el texto antiguo sin que nada lo evidencie.
**Causa raíz:** La supersesión se modeló sólo a nivel de la fila del requisito (estado + hash), sin propagación a las entidades dependientes ni emisión del disparador `legal_change` que el modelo de datos ya preveía.
**Corrección:** En la rama `published` de `transitionLegalRequirement`, dentro de la misma transacción: (1) seleccionar las aplicabilidades de `requirement.supersedesRequirementId` con `applicabilityStatus IN ('applicable','not_applicable')` y, por cada faena, llamar al ya existente `createRiskReviewTriggerWithClient(tx, {triggerType: 'legal_change', sourceType: 'legal_requirement', sourceId: requirement.id, dueAt: addDays(todayInChile(), 30), idempotencyKey: `legal:change:${requirement.id}:${worksiteId}`}, access.userId)` — el helper ya es idempotente vía UNIQUE; (2) añadir un estado terminal a la aplicabilidad superada (p. ej. `applicabilityStatus='superseded'` en el CHECK de schema :350) o, con menos cambio, filtrar en `getLegalDashboard` (:889) por `eq(preventionLegalRequirements.status,'published')` para aplicables y brechas, y (3) retirar (`isActive=false`) los `preventionPdtpSourceLinks` de tipo `legal_requirement` que apunten al requisito superado, con `retirementReason` — la tabla ya tiene esas columnas (schema :383-384).

**⚠️ Matiz del verificador:** Core observation verified, but two of its supporting claims are wrong and the root cause is misdiagnosed.

VERIFIED: the publish branch (lib/services/prevention-risk-legal.ts:557-585) only rewrites the previous requirement row — `.set({ status: "superseded", version: previous.version + 1, updatedAt: now })` — and never touches `preventionLegalApplicabilities`. `getLegalDashboard` (:889) joins `preventionLegalApplicabilities` → `preventionLegalRequirements` with `.where(scopeCondition(access.scope, preventionLegalApplicabilities.worksiteId))` and no predicate on `preventionLegalRequirements.status`, and the gap rule (:893) is `applicability.applicabilityStatus === "applicable" && (applicability.complianceStatus !== "compliant" || !applicability.evidenceReference)`. So the v1 row survives in the register, in the KPI `Aplicables` (workbench.tsx:60) and in the Brechas tab/Excel sheet forever. `legal_change` is indeed emitted nowhere (grep: only db/schema/prevention/risk-legal.ts:240 and lib/validation/prevention-module/risk-legal.ts:88).

WRONG: (a) the claim that publication 'no inserta en preventionPdtpUpdateObligations' implies a hole — the PDTP clock is inserted per applicability in `approveLegalApplicability` (:652-660, idempotencyKey `legal:pdtp:${item.id}:${item.version+1}`), so the v2 applicability does get its 30-day obligation. (b) the alleged root cause ('falta propagación a las entidades dependientes') conflicts with the deliberate design visible in the test the auditor cites: lib/__tests__/prevention-risk-legal-postgres.test.ts publishes v2 with reason 'Nueva versión del requisito publicada sin sobrescribir evidencia' — keeping the old applicability + assessments is intentional evidence preservation. The actual defect is narrower: the dashboard/export never separate historical from live rows, while the sibling consumer `getPdtpCoverage` (:937) DOES filter — `eq(preventionLegalRequirements.status, "published")`. (c) Reachability of the exact scenario is limited: supersession needs `sourceRequirementId`, which no UI form sends (see LEGAL-02), so through the UI both versions stay `published` rather than v1 becoming `superseded`. Duplicate counting happens either way, hence not refuted, but HIGH overstates it — no data is lost or corrupted, the distortion is in one dashboard/export.

---

## LEGAL-02 [MEDIUM] — Nada impide dos versiones simultáneamente 'vigentes' del mismo código, y la supersesión es inalcanzable desde la interfaz (el formulario nunca envía sourceRequirementId)
**Área:** Requisitos legales · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `db/schema/prevention/risk-legal.ts:319-325, app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx:47, lib/services/prevention-risk-legal.ts:503-514` · **Componente:** `preventionLegalRequirements / CreateRequirementDialog / createLegalRequirementDraft`

**Evidencia:** El único índice único es por (código, número de versión), no por publicado:
```
uniqueIndex("prevention_legal_requirements_code_version_unique").on(table.code, table.requirementVersion),
index("prevention_legal_requirements_status_topic_idx").on(table.status, table.topic),
```
Compárese con la tabla hermana del mismo archivo, que SÍ lo tiene: `uniqueIndex("prevention_risk_matrices_one_published_scope_unique").on(table.worksiteId).where(sql\`${table.status} = 'published'\`)` (:109). En el servicio, la supersesión es condicional a un campo que la UI nunca manda:
```
let source = null
if (data.sourceRequirementId) { ... }
const [latest] = await tx.select({ requirementVersion: ... }).where(eq(preventionLegalRequirements.code, data.code)).orderBy(desc(...)).limit(1)
... requirementVersion: (latest?.requirementVersion ?? 0) + 1, supersedesRequirementId: source?.id ?? null,
```
El diálogo de creación envía exactamente estos campos y ninguno más: `{ code, sourceType, authority, sourceTitle, sourceReference, sourceUrl, article, requirement, versionLabel, validFrom, topic, chomeRole, evidenceRequired, frequency }` (workbench.tsx:47) — sin `sourceRequirementId` y sin `validTo`. El flujo de enmienda sólo existe en la prueba de integración (prevention-risk-legal-postgres.test.ts:182), que llama al servicio directamente.

**Escenario:** 1. Un prevencionista publica DS44-ART7 v1.
2. Cambia la norma; usa "Nuevo requisito" con el mismo código DS44-ART7 y el texto nuevo.
3. El servicio le asigna requirementVersion=2 y `supersedesRequirementId=null` (la UI no puede indicarlo).
4. Lo lleva por in_review → reviewed → approved → published.

**Actual:** Quedan v1 y v2 en estado `published` a la vez. El KPI "Requisitos vigentes" cuenta ambas, la lista del registro muestra dos filas con el mismo código y artículo pero texto distinto, ambas ofrecen el botón "Evaluar aplicabilidad", y `getPdtpCoverage` (:930-938) ofrece las dos como fuentes legales distintas para cubrir una actividad. No hay forma desde la interfaz de dejar sólo una vigente.
**Esperado:** Sólo una versión de un mismo código puede estar `published`; el formulario debe permitir declarar qué versión se está reemplazando (o inferirla automáticamente de la última publicada del mismo código) y la publicación debe superar a la anterior.
**Impacto:** El registro legal —cuya función es ser la única fuente de verdad sobre qué obliga hoy— admite dos textos contradictorios vigentes para el mismo artículo, y en la práctica la ruta que la UI ofrece es precisamente la que produce ese estado. Además es la condición que habilita el doble conteo descrito en LEGAL-01.
**Causa raíz:** El invariante "una sola versión vigente por código" se dejó al parámetro opcional `sourceRequirementId` en vez de a una restricción de base de datos, y la interfaz nunca expuso ese parámetro.
**Corrección:** Dos cambios pequeños: (1) añadir el índice parcial que ya usa la tabla de matrices en el mismo archivo — `uniqueIndex("prevention_legal_requirements_one_published_code_unique").on(table.code).where(sql\`${table.status} = 'published'\`)` — con su migración; (2) en `createLegalRequirementDraft`, si no viene `sourceRequirementId`, resolver automáticamente la última versión `published` del mismo `code` y usarla como `supersedes`, que es lo que el usuario quiere decir al reutilizar el código. Así la UI no necesita campo nuevo y el flujo de enmienda deja de ser inalcanzable.

---

## MIPER-01 [MEDIUM] — La MIPER no tiene modelo de evaluación de riesgo: el nivel es texto libre, no se deriva de ninguna fórmula y el residual nunca se compara con el inherente
**Área:** MIPER · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `lib/validation/prevention-module/risk-legal.ts:60-65; app/(app)/prevencion/miper/miper-workbench.tsx:193,195; app/(app)/prevencion/miper/risk-map-panel.tsx:16-30,318-319; app/(app)/prevencion/miper/controles/[id]/page.tsx:24-29` · **Componente:** `riskEntrySchema / AddRiskDialog / RISK_LEVEL_LABEL`

**Evidencia:** El contrato acepta cualquier cadena como nivel y cualquier número ≥0 como puntaje, sin relación entre ambos ni entre inherente y residual:

lib/validation/prevention-module/risk-legal.ts:60-65
```
  inherentDimensions: z.record(z.string(), z.unknown()),
  inherentScore: z.coerce.number().min(0).nullable().optional(),
  inherentLevel: z.string().trim().min(1).max(100),
  residualDimensions: z.record(z.string(), z.unknown()),
  residualScore: z.coerce.number().min(0).nullable().optional(),
  residualLevel: z.string().trim().min(1).max(100),
```
No hay `superRefine` que exija residual ≤ inherente (el mismo archivo sí usa `superRefine` para controles críticos en la línea 41 y para evaluación legal en la 156, o sea el patrón existe y aquí se omitió). El esquema de BD tampoco tiene CHECK: db/schema/prevention/risk-legal.ts:147-152 sólo valida `exposed_people_count >= 0` y `version > 0`.

El formulario manda el MISMO campo de texto libre como "dimensiones" y como "nivel" (miper-workbench.tsx:193):
```
inherentDimensions: { assessment: v.get("inherent") }, inherentLevel: v.get("inherent"), residualDimensions: { assessment: v.get("residual") }, residualLevel: v.get("residual")
```
y los campos son inputs libres (miper-workbench.tsx:195): `<Field label="Evaluación inherente"><Input name="inherent" required /></Field><Field label="Riesgo residual"><Input name="residual" required /></Field>`.

El importador toma lo que diga el Excel sin normalizar (prevention-risk-import.ts:193,196): `inherentLevel: original.inherentLevel?.trim() ?? ""`.

Y los consumidores asumen un vocabulario inglés que ninguna ruta de escritura produce (risk-map-panel.tsx:16-30):
```
const RISK_LEVEL_LABEL: Record<string, string> = { low: "Bajo", moderate: "Moderado", medium: "Medio", high: "Alto", critical: "Crítico" }
const RISK_LEVEL_COLOR: Record<string, string> = { low: "var(--color-success)", ... critical: "var(--color-danger)" }
```
con el fallback `RISK_LEVEL_COLOR[marker.residualLevel] ?? "var(--color-text-subtle)"` (línea 171) y `marker.residualLevel === "high" || marker.residualLevel === "critical"` (línea 318). El propio seed escribe español: scripts/seed-demo-gaps.ts:474 `const NIVELES = ["Bajo", "Medio", "Alto", "Crítico"]`.

Además la metodología ISP que se registra declara dimensiones probabilidad×consecuencia (prevention-risk-legal.ts:161 `configuration: { dimensions: ["probability", "consequence"], allowsSpecialMethodology: true }`) pero nada en el código lee esa configuración para calcular nada.

**Escenario:** 1. Un prevencionista abre "Agregar peligro" en una MIPER borrador.
2. Escribe "Evaluación inherente" = "bajo" y "Riesgo residual" = "CRITICO ALTISIMO" (o al revés: inherente "2" y residual "25").
3. Guarda; el servidor acepta y persiste ambos textos tal cual (addRiskEntryWithClient, prevention-risk-legal.ts:307-312).
4. Publica la versión y abre /prevencion/miper/mapa con un marcador sobre ese peligro.

**Actual:** Se almacena un riesgo residual mayor que el inherente (lógicamente imposible: el control no puede aumentar el riesgo) sin ninguna advertencia; `inherentDimensions` queda como `{assessment:"bajo"}`, es decir sin probabilidad ni consecuencia; y en el mapa el marcador se pinta gris neutro y la insignia dice literalmente "CRITICO ALTISIMO" porque ningún valor real coincide con las claves low/medium/high/critical.
**Esperado:** El nivel debe derivarse en UN solo lugar a partir de dimensiones acotadas (probabilidad × consecuencia según la metodología snapshoteada), pertenecer a un enum cerrado compartido por servidor y cliente, y la validación debe rechazar residual > inherente.
**Impacto:** La matriz de riesgos —el instrumento central del DS 44 art. 7— no es comparable, ordenable ni auditable: dos filas con el mismo peligro pueden decir "Alto", "ALTO" y "4". El mapa de riesgos (requisito Oro Mutual) queda sin código de color efectivo. La priorización de controles y el KPI de riesgos críticos dependen de un checkbox (`isCritical`) desconectado del nivel evaluado. Ante fiscalización no se puede demostrar el método de evaluación aplicado.
**Causa raíz:** Nunca se implementó la evaluación: el nivel se modeló como texto libre de extremo a extremo y la UI reutiliza un único input tanto para las dimensiones como para el nivel, mientras que las capas de lectura se escribieron contra un enum que jamás se definió ni se aplicó en escritura.
**Corrección:** Definir el enum canónico (`low|moderate|medium|high|critical`) y la función pura de scoring en un módulo compartido (por ejemplo lib/prevention/risk-level.ts, junto a lib/prevention/permits.ts que ya es el precedente de reglas puras compartidas): `deriveRiskLevel(dimensions, methodologyConfiguration)`. En riskEntrySchema: `inherentDimensions`/`residualDimensions` con probabilidad y consecuencia enteras acotadas, `inherentLevel`/`residualLevel` con `z.enum`, y un `superRefine` que exija `residualScore <= inherentScore` y `rank(residualLevel) <= rank(inherentLevel)`. En el formulario, reemplazar los dos `<Input>` por selects de probabilidad/consecuencia y mostrar el nivel calculado (no editable). En el importador, mapear el texto del Excel al enum y marcar "needs_review" lo que no mapee. Añadir CHECK en prevention_risk_entries para el enum y para residual ≤ inherente.

**⚠️ Matiz del verificador:** Citations are accurate but the framing ("HIGH: no risk-evaluation model") mixes a defensible design choice with one real defect. Verified: `lib/validation/prevention-module/risk-legal.ts:60-65` is verbatim as quoted (`inherentLevel: z.string().trim().min(1).max(100)`, no superRefine tying residual to inherent), `db/schema/prevention/risk-legal.ts:147-152` has only `exposed_count_valid` and `version_positive`, and `miper-workbench.tsx:193` really does send `inherentDimensions: { assessment: v.get("inherent") }, inherentLevel: v.get("inherent")` from a single free `<Input name="inherent" required />`. HOWEVER the free-text level is coherent with the module's stated multi-methodology design: `methodologySnapshot` is a frozen jsonb per matrix, the schema exposes `specialMethodologyReference`, and the ISP methodology is registered with `allowsSpecialMethodology: true` — with several methodologies whose scales differ, a shared numeric enum and a `residual <= inherent` invariant are not obviously correct, and nothing in the code claims a formula exists. What IS a real, reachable defect is the vocabulary mismatch the auditor found: no write path produces `low|moderate|medium|high|critical` (form sends the raw input, `prevention-risk-import.ts:193,196` sends the raw Excel cell, `scripts/seed-demo-gaps.ts:474` writes `["Bajo","Medio","Alto","Crítico"]`), so `risk-map-panel.tsx:171` `RISK_LEVEL_COLOR[marker.residualLevel] ?? "var(--color-text-subtle)"` paints EVERY marker grey and `:318` `marker.residualLevel === "high" || marker.residualLevel === "critical"` never fires — the risk map's severity colour coding is dead in production. Labels degrade gracefully (`?? marker.residualLevel`), so it is cosmetic-but-material on a Gold-certification screen, not a HIGH data-integrity defect.

---

## MIPER-02 [MEDIUM] — La importación MIPER carga el .xlsx del usuario directo en ExcelJS sin la validación de envolvente ZIP que el propio repo ya tiene (zip bomb / DoS)
**Área:** MIPER · **Categoría:** Seguridad · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-import.ts:23,235-248` · **Componente:** `stageRiskImport`

**Evidencia:** prevention-risk-import.ts:235-248 (única validación previa a la carga):
```
  if (!args.fileName.toLowerCase().endsWith(".xlsx")) throw new Error("La importación MIPER exige un archivo Excel.")
  if (!args.buffer.length || args.buffer.length > MAX_BYTES) throw new Error("El Excel MIPER está vacío o supera 20 MB.")
  ...
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(args.buffer as never, { ignoreNodes: ["dataValidations", "conditionalFormatting", "hyperlinks"] }) }
  catch { throw new Error("El archivo no es un Excel válido.") }
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error("El Excel no contiene hojas.")
  if (sheet.rowCount - 1 > MAX_ROWS) throw new Error(`El Excel supera ${MAX_ROWS} filas.`)
```
La comprobación de nombre es sobre `file.name` (controlado por el cliente) y la de filas ocurre DESPUÉS de descomprimir. No hay verificación de firma ZIP, de entradas del directorio central, de ratio de expansión ni de cifrado.

El repo ya resuelve exactamente esto y lo usa en el importador hermano: lib/services/pdtp/imports.ts:157-182
```
  validatePdtpXlsxEnvelope({ name: input.fileName, type: input.mimeType, size: buffer.length, buffer })
  ...
  await workbook.xlsx.load(input.bytes as never)
  validateLoadedPdtpWorkbook(workbook)
```
con límites en lib/services/pdtp/xlsx-security.ts:3-9 (15 MB comprimido, 80 MB expandidos, 20 MB por entrada, 2.000 entradas, 32 hojas) y rechazo de ZIP64/cifrado/rutas internas. Ningún archivo de MIPER importa `xlsx-security` (grep sobre todo el repo: sólo lo usan pdtp/imports.ts y los dos scripts de bootstrap).

Además MAX_BYTES es 20 MB (prevention-risk-import.ts:23), más permisivo que el límite PDTP de 15 MB.

**Escenario:** 1. Un usuario con `prevention:risk:edit` (rol prevencionista_faena, acotado a una faena) abre la pestaña de importación MIPER.
2. Sube un .xlsx de ~5 MB construido como zip bomb: una entrada `xl/worksheets/sheet1.xml` con ratio de compresión ~1000:1.
3. `stageRiskImportAction` pasa las dos comprobaciones (extensión y 20 MB) y llama a `workbook.xlsx.load`.

**Actual:** ExcelJS descomprime y parsea varios GB de XML en el proceso Node del servidor antes de que se evalúe el límite de filas; el contenedor se queda sin memoria y cae, afectando a toda la plataforma (no sólo a la faena del atacante). Variantes: ZIP64, entradas cifradas o miles de entradas internas también llegan intactas a ExcelJS.
**Esperado:** El archivo debe rechazarse antes de descomprimirse, con los mismos límites que el importador PDTP.
**Impacto:** Denegación de servicio de toda la aplicación desde una cuenta operativa de baja jerarquía y desde una faena acotada. Es el único importador de archivos del módulo Prevención que no pasa por el guard que el equipo ya escribió para este mismo riesgo.
**Causa raíz:** El importador MIPER se escribió antes o en paralelo al endurecimiento del importador PDTP y nunca se reutilizó el guard compartido; la validación quedó reducida a extensión y tamaño comprimido.
**Corrección:** Reutilizar el guard existente en `stageRiskImport`: llamar a `validatePdtpXlsxEnvelope({ name: args.fileName, type: <mime del File>, size: args.buffer.length, buffer: args.buffer })` antes de `workbook.xlsx.load` y a `validateLoadedPdtpWorkbook(workbook)` inmediatamente después; propagar el `mimeType` real del `File` desde stageRiskImportAction (hoy no se envía). Si el nombre genérico molesta, renombrar el módulo a lib/services/xlsx-security.ts — es lógica de plataforma, no de PDTP. Alinear MAX_BYTES con PDTP_XLSX_MAX_BYTES en vez de mantener dos límites.

**⚠️ Matiz del verificador:** Observation confirmed, severity overstated. `prevention-risk-import.ts:235-248` is verbatim as quoted: only `.endsWith(".xlsx")` on the client-supplied `file.name` (`actions.ts:101` passes `file.name`) and `buffer.length > MAX_BYTES` (20 MB, line 23) precede `await workbook.xlsx.load(...)`; the `sheet.rowCount - 1 > MAX_ROWS` check is at line 248, after decompression, so it cannot bound expansion. `grep -rn xlsx-security` over the repo returns only `lib/services/pdtp/imports.ts`, the two bootstrap scripts, its own test and `app/api/prevencion/pdtp/import/route.ts` — no MIPER file reuses `validatePdtpXlsxEnvelope`, which does check ZIP signature, central-directory entries, encryption flag, per-entry and total uncompressed bytes (`xlsx-security.ts:3-9,37-83`). So the guard genuinely exists one directory over and was not applied here. But the actor must hold `prevention:risk:edit` (manifest.ts:648-659: prevencionista / prevencionista_faena / administrador — trusted internal staff, no self-service signup), the impact is availability only (OOM), and there is no data-exfiltration or integrity path. That is MEDIUM hardening debt, not HIGH.

---

## MIPER-03 [MEDIUM] — El espacio de claves de idempotencia de los disparadores de revisión es escribible por el cliente: se puede suprimir silenciosamente la revisión anual MIPER de otra faena
**Área:** MIPER · **Categoría:** Worksite Scope · **Confianza:** Alta
**Ubicación:** `app/(app)/prevencion/miper/actions.ts:82-86; lib/services/prevention-risk-legal.ts:462-481,433-444; lib/services/prevention-incidents.ts:1002-1013` · **Componente:** `createRiskReviewTriggerAction / createRiskReviewTriggerWithClient`

**Evidencia:** La acción acepta el `idempotencyKey` del cliente y sólo valida el permiso y el alcance de la FAENA QUE EL PROPIO CLIENTE DECLARA (prevention-risk-legal.ts:477-481):
```
export async function createRiskReviewTrigger(input: unknown, access: RiskLegalAccess) {
  const data = riskReviewTriggerSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  return db.transaction((tx) => createRiskReviewTriggerWithClient(tx, data, access.userId))
}
```
con `idempotencyKey: z.string().trim().min(5).max(500)` (lib/validation/prevention-module/risk-legal.ts:94) y sin validar que `matrixId`/`sourceId` pertenezcan a `worksiteId`.

La clave es UNIQUE global (db/migrations/0076_equal_menace.sql:315 `CONSTRAINT "prevention_risk_review_triggers_idempotency_key_unique" UNIQUE("idempotency_key")`), y ante colisión el helper devuelve la fila AJENA sin comprobar nada (prevention-risk-legal.ts:462-475):
```
  const [created] = await client.insert(preventionRiskReviewTriggers).values({...}).onConflictDoNothing().returning()
  if (created) await history(...)
  if (created) return created
  const [existing] = await client.select().from(preventionRiskReviewTriggers).where(eq(preventionRiskReviewTriggers.idempotencyKey, data.idempotencyKey)).limit(1)
  return existing!
```
Los productores usan claves derivadas de ids adivinables/observables: `miper:annual:${matrix.id}` (línea 443), `miper:pdtp30:${matrix.id}` (447) e `incident:miper:${incident.id}` (prevention-incidents.ts:1010).

En publicación el resultado se ignora (prevention-risk-legal.ts:435-444): se llama a `createRiskReviewTriggerWithClient` sin comprobar que lo devuelto corresponda a esta matriz/faena, y la publicación continúa con éxito.

`createRiskReviewTriggerAction` no tiene NINGÚN llamador en la UI (grep en todo el repo: sólo su definición), o sea es superficie de ataque pura.

El rol `prevencionista_faena` tiene `prevention:risk:edit` (modules/prevention/manifest.ts:651) y NO es global (lib/auth/scope.ts:8-17), es decir un usuario acotado a una faena puede ejecutar esto.

**Escenario:** 1. Un `prevencionista_faena` de la faena A obtiene el id de la matriz borrador de la faena C (aparece en el export/URL de quien sí la ve, o se adivina si comparte pantalla).
2. Invoca directamente el Server Action `createRiskReviewTriggerAction({ worksiteId: "A", triggerType: "manual", sourceType: "manual", sourceId: "x", description: "...", dueAt: "2030-01-01", idempotencyKey: "miper:annual:<matrixId de C>" })`. Pasa `requireAccess` porque la faena declarada es la suya.
3. Semanas después, la jefatura publica la MIPER de la faena C.
4. En `transitionRiskMatrix` (toStatus="published") se ejecuta `createRiskReviewTriggerWithClient` con la clave `miper:annual:<matrixId de C>`; el INSERT choca con la fila del atacante, `onConflictDoNothing` no inserta y se devuelve la fila de la faena A.

**Actual:** La publicación de la faena C termina con éxito pero NO se crea su tarea de revisión anual: no queda fila en `prevention_risk_review_triggers` con `worksiteId = C`, no se registra historial (`if (created) await history(...)`) y el dashboard de C —filtrado por alcance en getRiskDashboard:843— nunca la muestra. La obligación de revisión anual desaparece silenciosamente. La misma técnica aplica a `incident:miper:<incidentId>` (el disparador del incidente queda en otra faena) y a `miper:pdtp30:<matrixId>` (reloj de 30 días del PDTP).
**Esperado:** Las claves de idempotencia generadas por el sistema no deben ser escribibles por el cliente, y la fila devuelta al colisionar debe verificarse contra la faena y el origen solicitados; si no coincide, la operación debe fallar en vez de continuar.
**Impacto:** Un usuario de baja jerarquía acotado a una faena puede eliminar de forma silenciosa y persistente una obligación legal (revisión anual de la MIPER, DS 44) de otra faena, sin dejar rastro en el historial. También permite ocultar el disparador MIPER de un incidente y el reloj PDTP de 30 días. Y aunque no haya atacante, el helper puede devolver una fila que no corresponde al origen pedido y el llamador la usa como si correspondiera (prevention-incidents.ts:1013 evalúa `miperTrigger?.status === "completed"` sobre esa fila).
**Causa raíz:** Un identificador de deduplicación interno se expuso como campo del contrato público del Server Action, en un espacio de nombres global compartido por todos los productores, y el camino de colisión confía ciegamente en la fila preexistente.
**Corrección:** Quitar `idempotencyKey` de `riskReviewTriggerSchema` y derivarlo en el servidor (`manual:${worksiteId}:${nanoid()}` para el alta manual); los productores internos siguen construyendo la suya. En `createRiskReviewTriggerWithClient`, tras el fallback por conflicto, verificar `existing.worksiteId === data.worksiteId && existing.sourceType === data.sourceType && existing.sourceId === data.sourceId` y lanzar si no coincide (así la publicación falla ruidosamente en vez de perder la tarea). Validar además que `matrixId` pertenezca a `worksiteId`. Si `createRiskReviewTriggerAction` no tiene UI, borrarla (lo más barato) — sigue el criterio de retiro de superficie muerta ya aplicado a `prevention_pdtp_source_links.sourceType='incident'` (db/schema/prevention/risk-legal.ts:389-392).

**⚠️ Matiz del verificador:** Mechanism fully confirmed; the cross-faena scenario as written is not the reachable one. Verified verbatim: `riskReviewTriggerSchema` takes `idempotencyKey: z.string().trim().min(5).max(500)` from the client (validation:94); `createRiskReviewTrigger` (service:477-481) only does `requireAccess(access, "prevention:risk:edit", data.worksiteId)` on the CLIENT-DECLARED worksite and never checks that `matrixId`/`sourceId` belong to it; the key is globally unique (`db/schema/prevention/risk-legal.ts`: `idempotencyKey: text("idempotency_key").notNull().unique()`); on conflict the helper returns the pre-existing foreign row unchecked (service:470-474 `onConflictDoNothing()` then `select ... where eq(idempotencyKey)` → `return existing!`); and `transitionRiskMatrix` discards the return value at :435-444 while using the guessable key `miper:annual:${matrix.id}`. `createRiskReviewTriggerAction` (actions.ts:82-86) is a live "use server" export with no UI caller (grep: only its definition and a vi.mock). The step-1 premise is where it breaks down: matrix ids are nanoids and faena C's ids are filtered out of every read path by `scopeCondition`, so an attacker scoped to A cannot normally learn C's matrix id. The reachable variant the auditor missed is self-suppression: `dashboard.matrices` ships full rows (including ids of the attacker's OWN approved-but-unpublished matrices) to the client, so a prevencionista_faena can pre-burn `miper:annual:<their own matrix id>` with a far-future `dueAt` and silence their own 365-day review reminder. Real design flaw (internal dedup key exposed in a global namespace + blind trust on collision), but insider-only, no UI, and no cross-tenant reach — MEDIUM.

---

## MIPER-04 [MEDIUM] — Un lote de importación aprobado puede quedar imposible de activar y de corregir: la validación de staging es más débil que la de activación y ya no hay marcha atrás
**Área:** MIPER · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-import.ts:101-104,204-217,311-342,344-357,359-409` · **Componente:** `stageRiskImport / issuesFor / resolveRiskImportRow / activateRiskImportBatch`

**Evidencia:** En staging las reglas son de "no vacío" (prevention-risk-import.ts:204-217):
```
function issuesFor(row: NormalizedRiskImportRow) {
  const issues: string[] = []
  if (!row.process.name) issues.push("Proceso vacío")
  ...
  if (row.hazard.length < 3) issues.push("Peligro insuficiente")
```
No hay ninguna comprobación de longitud MÁXIMA ni de mínimos de código, pero los códigos se autogeneran a partir del nombre completo (línea 101-104):
```
function slug(value: string, fallback: string) {
  const normalized = normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return normalized || fallback
}
```
y en activación se re-valida con un contrato mucho más estricto (activateRiskImportBatch:390-399 → addRiskEntryWithClient → `riskEntrySchema.parse`), que exige `process.code` ≤ 80, `process.name` ≥ 2, `hazardCode` ≤ 100, `controls[].description` ≥ 3 (lib/validation/prevention-module/risk-legal.ts:48-54,30).

El bucle de activación es todo-o-nada dentro de una transacción (prevention-risk-import.ts:389-401): la primera fila que no parsee aborta el lote completo.

Y ya no hay forma de arreglarlo: corregir filas exige lote en `staged` (línea 322 `if (row.batch.status !== "staged") throw new Error("Sólo un lote en revisión admite correcciones.")`), pero aprobar lo dejó en `approved` (línea 354). No existe ninguna transición que devuelva el lote a `staged` ni que lo marque `rejected` (el estado `rejected` del enum de lotes, db/schema/prevention/risk-legal.ts:265, no lo escribe nadie; el `rejected` de la línea 332 es de FILA, no de lote).

El error que ve el usuario es genérico: `run()` en app/(app)/prevencion/miper/actions.ts:45 convierte el ZodError en `{ ok:false, message: "Revisa los campos marcados" }` sin número de fila.

**Escenario:** 1. Se importa un Excel MIPER real cuya columna "Proceso" trae un nombre largo, por ejemplo "Mantención preventiva de equipos de levante en el área de acopio y despacho" (>80 caracteres al slugificar), y sin columna "Código proceso".
2. `normalizeRow` genera `process.code = slug(...)` de más de 80 caracteres; `issuesFor` no observa nada y la fila queda `ready`.
3. Un segundo usuario aprueba el lote (`approveRiskImportBatch`): no hay filas `needs_review`, el lote pasa a `approved`.
4. Alguien pulsa "Activar": `addRiskEntryWithClient` hace `riskEntrySchema.parse` y falla con `process.code` > 80.

**Actual:** La transacción completa se revierte: no se crea ninguna entrada, el lote sigue `approved` y el usuario ve "Revisa los campos marcados" sin saber qué fila ni qué campo. Como el lote ya no está `staged`, `resolveRiskImportRow` rechaza cualquier corrección y no existe camino para devolverlo a `staged` ni para descartarlo: el lote queda muerto para siempre y el único remedio es re-subir el archivo… que tampoco funciona, porque el índice único (worksiteId, checksum) hace que `stageRiskImport` devuelva el mismo lote muerto (línea 238-239).
**Esperado:** Lo que valida el staging debe ser el mismo contrato que valida la activación, de modo que una fila `ready` sea siempre activable; y ante un fallo debe poder identificarse la fila y corregirse o descartarse el lote.
**Impacto:** Cada lote afectado bloquea permanentemente la carga de una MIPER completa para esa faena — y como el checksum es único por faena, el mismo archivo no se puede volver a subir. Es un callejón sin salida operativo en el camino principal de alta de datos del módulo (el formulario manual es la única alternativa y exige retipear cientos de filas).
**Causa raíz:** Dos conjuntos de reglas para el mismo dato (`issuesFor` en staging vs `riskEntrySchema` en activación) y una máquina de estados de lote sin aristas de retorno ni de descarte.
**Corrección:** Validar en staging con el contrato real: en `normalizeRow`/`issuesFor`, correr `riskEntrySchema.omit({ matrixId:true, sourceRowNumber:true, sourceOriginal:true, sourceNormalized:true, normalizationDecision:true }).safeParse(normalized)` —exactamente lo que ya hace `resolveRiskImportRow` en la línea 326— y volcar los `issues` del error, de modo que la fila caiga en `needs_review` en vez de `ready`. Acotar además `slug()` con `.slice(0, 80)`. Añadir una transición `rejectRiskImportBatch` (usar el estado `rejected` que ya existe en el enum) y permitir volver de `approved` a `staged` con permiso `prevention:risk:approve`. En el bucle de activación, envolver el parse por fila para reportar `rowNumber` en el mensaje.

**⚠️ Matiz del verificador:** The two-validation-sets defect is real and I found the reachability the auditor's own example does not quite reach; the dead-end is real but has a workaround, so HIGH is too strong. Confirmed: `issuesFor` (`prevention-risk-import.ts:204-217`) only checks emptiness/minimums and never a maximum, while activation goes `activateRiskImportBatch:392 → addRiskEntryWithClient → riskEntrySchema.parse` (service:281) with `process.code` max 80, `responsibleSnapshot` max 300, `genderConsiderations` min 3, `controls[].description` min 3. The auditor's own example is marginal — `slug("Mantención preventiva de equipos de levante en el área de acopio y despacho")` is ~74 chars, under the 80 cap — but the gap is trivially reachable by other columns `issuesFor` never inspects: a "Enfoque de género" cell of `-` survives staging (normalizeRow:189 keeps it because `"-" || default` is truthy) and fails `min(3)` at activation; likewise a 2-char control from `parseControls` vs `description: min(3)`. The all-or-nothing loop is confirmed (`db.transaction` at :369, no per-row try), as is the missing return edge: `resolveRiskImportRow:322` demands `batch.status !== "staged"` → throw, `approveRiskImportBatch:354` sets `approved`, and nothing writes `rejected` on a batch (the `rejected` at :332 is a ROW status) — grep confirms no un-approve path. The error really is row-less (`actions.ts:45` maps ZodError → "Revisa los campos marcados."). What tempers it: the operator can fix the Excel and re-import (the checksum idempotency at :238 keys on `(worksiteId, checksum)`, so an edited file yields a fresh batch), and nothing is corrupted — the tx rolls back. Dead batch + opaque error, not an unrecoverable module.

---

## MIPER-05 [MEDIUM] — Los marcadores del mapa de riesgos quedan anclados a entradas de la matriz reemplazada al publicar una nueva versión
**Área:** MIPER · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-legal.ts:220-245; lib/services/prevention-risk-map.ts:181-217; app/(app)/prevencion/miper/risk-map-data.ts:24-32; lib/services/prevention-cphs-certification.ts:229-232` · **Componente:** `createRiskMatrixDraftWithClient / listRiskMapsForScope`

**Evidencia:** Al crear una revisión se COPIAN las entradas con identificadores nuevos (prevention-risk-legal.ts:223-233):
```
      const newEntryIdBySource = new Map(entries.map((entry) => [entry.id, `riskentry-${nanoid()}`]))
      ...
      await client.insert(preventionRiskEntries).values(entries.map((entry) => ({ ...entry, id: newEntryIdBySource.get(entry.id)!, matrixId: matrix.id, version: 1, ... })))
```
Los marcadores apuntan a la entrada vieja por FK `onDelete: "restrict"` (db/schema/prevention/risk-legal.ts:181) y NADIE los reasigna: el único código que toca `preventionRiskMapMarkers` fuera de la lectura son `addRiskMapMarker` y `removeRiskMapMarker` (grep completo del repo).

La lectura del mapa une marcador→entrada SIN filtrar por estado de la matriz (prevention-risk-map.ts:189-196):
```
  const markerRows = await db.select({ marker: preventionRiskMapMarkers, hazard: preventionRiskEntries.hazard, residualLevel: preventionRiskEntries.residualLevel })
    .from(preventionRiskMapMarkers)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskMapMarkers.riskEntryId))
    .where(inArray(preventionRiskMapMarkers.layoutId, layouts.map((layout) => layout.id)))
```
mientras que el selector para AÑADIR marcadores sí se limita a matrices publicadas (risk-map-data.ts:24-32). O sea: se escribe contra la versión vigente y se lee contra lo que quedó.

La cabecera del servicio afirma lo contrario de lo que ocurre (prevention-risk-map.ts:1-5): "un plano de planta por faena con marcadores ubicados sobre la imagen, cada uno enlazado a una entrada de la MIPER vigente".

Y la certificación cuenta marcadores sin mirar a qué versión pertenecen (prevention-cphs-certification.ts:229-232 `markerCount: sql<number>\`count(${preventionRiskMapMarkers.id})::int\``).

**Escenario:** 1. En la faena A se publica la MIPER v1 con el peligro "Atropello por equipo móvil" (entrada E1) y se ubican 20 marcadores sobre el plano.
2. Se crea la revisión v2 desde v1: las 20 entradas se copian como E1'…E20' y v1 pasa a `superseded`.
3. Se publica v2, eliminando en ella un peligro ya controlado y agregando dos nuevos.

**Actual:** El mapa sigue mostrando los 20 marcadores apuntando a E1…E20 (entradas de la versión SUPERSEDED): el peligro eliminado sigue dibujado en el plano, los dos peligros nuevos no aparecen, y el nivel residual mostrado es el de la versión antigua aunque la vigente lo haya cambiado. Nada advierte de la desincronización y la certificación CPHS sigue contando 20 marcadores como cumplimiento.
**Esperado:** Al publicar una nueva versión los marcadores deben re-apuntar a la entrada equivalente de la versión vigente (el mapeo `newEntryIdBySource` ya existe en ese mismo bloque), o bien la lectura debe excluir/marcar los marcadores cuya entrada ya no pertenece a la matriz publicada.
**Impacto:** El mapa de riesgos (DS 44 art. 62, requisito Oro Mutual) que se exhibe en el lugar de trabajo muestra peligros retirados y omite peligros vigentes, con niveles residuales obsoletos. Es información de seguridad visible para las personas trabajadoras y para el fiscalizador, y el indicador de certificación la valida como correcta.
**Causa raíz:** El versionado de la matriz clona filas con ids nuevos (correcto para la inmutabilidad) pero no se propagó a la única tabla que referencia entradas por id desde fuera de la matriz.
**Corrección:** En `createRiskMatrixDraftWithClient`, tras insertar las entradas copiadas, reapuntar los marcadores del plano activo de esa faena usando el `newEntryIdBySource` ya disponible — es un solo UPDATE, y hacerlo en la publicación (no en el borrador) evita mover el mapa antes de que la versión sea vigente. Como red de seguridad, filtrar en `listRiskMapsForScope` por matriz publicada y devolver los marcadores huérfanos marcados para que el panel los muestre como "pendiente de reubicar".

---

## MIPER-06 [MEDIUM] — El camino de revisión versionada (copiar la versión anterior) no está cableado en la UI: `supersedesMatrixId` siempre queda NULL y cada versión nueva nace vacía
**Área:** MIPER · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `app/(app)/prevencion/miper/miper-workbench.tsx:100-103; lib/services/prevention-risk-legal.ts:184-246; lib/validation/prevention-module/risk-legal.ts:25` · **Componente:** `MiperHeaderActions (nueva versión) / createRiskMatrixDraftWithClient`

**Evidencia:** El diálogo "Nueva versión" envía sólo seis campos y nunca `sourceMatrixId` (miper-workbench.tsx:100-103):
```
    operation.run(() => createRiskMatrixDraftAction({
      worksiteId: values.get("worksiteId"), title: values.get("title"), methodologyId: values.get("methodologyId"),
      revisionReason: values.get("revisionReason"), participationSummary: values.get("participationSummary"), consultationEvidenceReference: values.get("consultationEvidenceReference"),
    }), () => setOpen(false))
```
Grep de `sourceMatrixId` en todo el repo: sólo aparece en el esquema (validation:25), en el servicio (prevention-risk-legal.ts:185-186,246) y en lib/__tests__/prevention-risk-legal-postgres.test.ts:94. Ningún componente ni acción lo envía.

En consecuencia, `supersedesMatrixId: source?.id ?? null` (prevention-risk-legal.ts:213) es siempre null en producción, y todo el bloque de copia de entradas y controles (líneas 220-245) es código muerto salvo en pruebas.

El otro camino que sí crea contenido es la importación (`activateRiskImportBatch` → `sourceImportBatchId`), que tampoco fija `sourceMatrixId`.

**Escenario:** 1. La faena A tiene la MIPER v1 publicada con 180 peligros.
2. Llega la revisión anual (disparador `miper:annual:...`) o un cambio operacional.
3. El prevencionista pulsa "Nueva versión" y completa el formulario.

**Actual:** Se crea la v2 como borrador VACÍO, sin ninguno de los 180 peligros y sin `supersedesMatrixId`, de modo que (a) hay que retipear la matriz completa o re-importar un Excel, y (b) la cadena de versiones no queda registrada en la fila: el enlace v1→v2 sólo existe en el texto de una fila de historial (prevention-risk-legal.ts:415-425). Al publicar, v1 se marca `superseded` sin que ninguna columna diga por cuál versión fue reemplazada.
**Esperado:** Crear una versión debe permitir partir de la versión publicada vigente (copiando peligros y controles) y dejar `supersedesMatrixId` apuntando a ella, que es exactamente lo que el servicio ya implementa y prueba.
**Impacto:** En la práctica la revisión anual de la MIPER es inviable (retipear cientos de filas), lo que empuja a no revisar o a publicar matrices incompletas. Además se pierde la trazabilidad de linaje en la propia fila: reconstruir qué versión estaba vigente en una fecha exige leer `prevention_risk_legal_history` en vez de seguir `supersedesMatrixId`/`effectiveFrom`.
**Causa raíz:** La funcionalidad se implementó y probó en la capa de servicio pero nunca se expuso en el formulario; el diálogo de creación es el mismo para "primera versión" y para "revisión".
**Corrección:** Añadir al diálogo "Nueva versión" un selector opcional "Partir de la versión publicada" alimentado con `dashboard.matrices.filter(m => m.status === "published" && m.worksiteId === worksiteId)` y enviar su id como `sourceMatrixId`. Nada más: el servicio ya valida que la fuente esté publicada y en la misma faena (prevention-risk-legal.ts:186) y ya copia entradas y controles.

---

## MIPER-08 [MEDIUM] — Un control crítico se declara "verificado" por su propio autor, sin evidencia, en el mismo POST que lo crea — y después no existe ninguna ruta para verificarlo ni para revocarlo
**Área:** MIPER · **Categoría:** SoD · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-legal.ts:325-346,857-862; lib/validation/prevention-module/risk-legal.ts:39; app/(app)/prevencion/miper/controles/[id]/page.tsx:9-14` · **Componente:** `addRiskEntryWithClient`

**Evidencia:** El estado del control llega del cliente y el servidor estampa la verificación con el usuario que está creando la entrada (prevention-risk-legal.ts:339-343):
```
      status: control.status,
      evidenceReference: control.evidenceReference ?? null,
      effectivenessStatus: control.status === "verified" ? "effective" : "not_assessed",
      lastVerifiedByUserId: control.status === "verified" ? access.userId : null,
      lastVerifiedAt: control.status === "verified" ? now : null,
```
El contrato permite ese valor sin exigir evidencia (validation:39): `status: z.enum(["proposed", "implemented", "verified", "ineffective"]).default("proposed")`; el único `superRefine` del control exige estándar y frecuencia sólo cuando `isCritical` (líneas 41-44). El CHECK de BD tampoco liga verificación con evidencia (db/schema/prevention/risk-legal.ts:216-218).

No existe NINGÚN camino de actualización de controles: grep `update(preventionRiskControls` en todo el repo devuelve cero resultados (los únicos UPDATE sobre tablas MIPER son a `preventionRiskMatrices` en prevention-risk-legal.ts:406,430 y a `preventionRiskMapLayouts` en prevention-risk-map.ts:83). Las columnas `lastVerifiedByUserId`, `lastVerifiedAt`, `effectivenessStatus`, `dueDate` y `verificationFrequency` sólo se escriben en el INSERT.

Ese estado es justo lo que apaga la alerta de riesgo crítico (prevention-risk-legal.ts:857-862):
```
  const criticalBlockers = entries.filter(({ entry }) => {
    if (!publishedIds.has(entry.matrixId) || !entry.isCritical) return false
    const entryControls = controlByEntry.get(entry.id) ?? []
    return !entryControls.some((control) => control.isCritical && ["implemented", "verified"].includes(control.status))
      || !entryControls.some((control) => linkedControlIds.has(control.id))
```
Síntoma colateral del mismo diseño: la ficha de control traduce un estado que la BD no tiene y no traduce el que sí tiene (controles/[id]/page.tsx:9-14 `CONTROL_STATUS = { planned: ..., implemented: ..., verified: ..., ineffective: ... }`, sin `proposed` ni `retired`), así que un control recién creado muestra la cadena cruda "proposed".

**Escenario:** 1. Un prevencionista con `prevention:risk:edit` agrega un peligro crítico en su MIPER borrador e incluye el control crítico con `status: "verified"` (el formulario actual envía "proposed", pero la acción acepta cualquiera de los cuatro valores del enum).
2. Guarda, envía a revisión y el circuito segregado publica la matriz.
3. Se abre el panel MIPER.

**Actual:** El control queda `verified` / `effectiveness: effective` con `lastVerifiedByUserId` = su propio autor, `lastVerifiedAt` = el instante de creación y `evidenceReference` NULL. El riesgo crítico desaparece de "Bloqueos críticos". Y si más tarde la verificación en terreno falla, no hay ninguna acción que permita pasarlo a `ineffective`: el registro es inmutable de por vida.
**Esperado:** La verificación de un control crítico es un acto posterior, con evidencia y con un actor distinto del que lo propuso/implementó; al crear la entrada el control debería nacer como máximo `implemented`, y `verified` debería requerir una acción propia con segregación por identidad (el criterio ya aplicado en lib/services/prevention-capa.ts).
**Impacto:** El indicador que la plataforma usa para demostrar que todo riesgo crítico tiene un control crítico operativo se satisface con una autodeclaración sin evidencia, y como no existe ruta de verificación posterior, ese es el ÚNICO modo de satisfacerlo. La frecuencia de verificación (`verificationFrequency`) que exige el CHECK de BD para controles críticos no genera ninguna tarea ni recordatorio.
**Causa raíz:** El ciclo de vida del control se modeló en el esquema (estados, verificador, eficacia, frecuencia) pero sólo se implementó su alta; el estado terminal quedó disponible como campo de entrada del alta.
**Corrección:** Acotar el enum de alta a `proposed | implemented` (`riskControlSchema.status`) y añadir una acción `verifyRiskControl` con permiso `prevention:risk:review`, que exija `evidenceReference`, rechace `control.responsibleUserId === actor` y `createdBy === actor`, escriba `lastVerifiedByUserId/At` y `effectivenessStatus`, y haga CAS sobre `preventionRiskControls.version` bumpeando también la matriz padre. Añadir CHECK `status <> 'verified' OR (last_verified_by_user_id IS NOT NULL AND length(coalesce(evidence_reference,'')) >= 3)`. De paso corregir `CONTROL_STATUS` en la ficha (`proposed`, `retired`).

**⚠️ Matiz del verificador:** The lifecycle gap is real; the "apaga la alerta de riesgo crítico" framing is not. Confirmed by grep: zero occurrences of `update(preventionRiskControls` in the repo, so `lastVerifiedByUserId`, `lastVerifiedAt`, `effectivenessStatus`, `dueDate` and `verificationFrequency` are write-once at INSERT (service:334-343) — a critical control can never later be verified, re-verified on its declared frequency, marked `ineffective`, or `retired` (a status the CHECK allows: `db/schema/prevention/risk-legal.ts` `status IN ('proposed','implemented','verified','ineffective','retired')`). Confirmed too that :339-343 stamps `lastVerifiedByUserId: control.status === "verified" ? access.userId : null` from the same POST, with no evidence requirement in schema (validation:39) or CHECK. The label bug is real and reachable: `controles/[id]/page.tsx:9-14` maps `planned` (not a valid DB status) and omits `proposed`/`retired`, so every control created by the current form — which hardcodes `status: "proposed"` (workbench:193) — renders the raw string "proposed" once its matrix is published (`getRiskControlDetail` at service:1072 only serves `published|superseded` matrices). What I refute is the escalation: `criticalBlockers` (service:857-862) requires BOTH a critical control in `["implemented","verified"]` AND `linkedControlIds.has(control.id)`, and that PDTP link is created by `linkPdtpActivitySource`, gated on `prevention:pdtp:program:manage` (service:714) — a different permission. So a lone author cannot silence the alert, and "implemented" would serve just as well as "verified" if they could; the self-verification field is bookkeeping, not the gate.

---

## MOC-02 [MEDIUM] — Evaluar una dimensión no incrementa la versión del cambio ni bloquea su fila: el CAS de aprobación no ve la evaluación y se puede aprobar sobre una evaluación obsoleta, o evaluar después de aprobado
**Área:** MOC (gestión del cambio) · **Categoría:** Concurrencia · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-change.ts:144-196 (esp. 147-150, 176-191) vs 212-243` · **Componente:** `evaluateChangeDimension / approveChangeRequest`

**Evidencia:** `evaluateChangeDimension` escribe la fila hija y, cuando el cambio está en 'draft', también toca el padre — pero **nunca** mueve `version`:

```ts
// lib/services/prevention-change.ts:176-191
const [updated] = await tx.update(preventionChangeAssessments).set({
  evaluated: true, impacted: data.impacted, notes: ..., actionRequired: ...,
  capaActionId, evaluatedByUserId: access.userId, evaluatedAt: now, updatedAt: now,
}).where(eq(preventionChangeAssessments.id, assessment.id)).returning()
...
if (request.status === "draft") {
  await tx.update(preventionChangeRequests).set({ status: "under_evaluation", updatedAt: now })
    .where(eq(preventionChangeRequests.id, request.id))
}
```
Nótese que ni siquiera esa transición de estado del padre incrementa `version`.

La lectura del padre no toma bloqueo (no hay `FOR UPDATE` en ninguna función de este archivo; compárese con el patrón usado en todo PDTP, p. ej. lib/services/pdtp/obligations.ts:185):
```ts
// L147
const [request] = await tx.select().from(preventionChangeRequests).where(eq(...id...)).limit(1)
// L150
if (!OPEN_STATUSES.includes(request.status)) throw new Error("Un cambio ya decidido no admite nuevas evaluaciones.")
```

Y la aprobación confía en ese `version` como única defensa contra decidir sobre datos viejos (L218, L235-239).

El propio repositorio ya diagnosticó y arregló esta clase de bug en el módulo hermano, con el docstring explícito:
```ts
// lib/services/prevention-permits.ts:108-120
/**
 * Toda mutación hija (controles, aislamientos, mediciones) es una entrada de la
 * habilitación: si no mueve `version`, el CAS de `transitionWorkPermit` no ve el
 * cambio y activa el permiso con una evaluación ya obsoleta.
 * Se incrementa en SQL, no con `version + 1` leído en memoria, para no perder el
 * bump si dos mutaciones hijas corren a la vez.
 */
async function bumpPermitVersion(client: Client, permitId: string, now: string) { ... }
```
MOC no tiene equivalente.

Prueba directa de que la versión no se mueve: en lib/__tests__/prevention-change-postgres.test.ts la variable `changeVersion` se fija en 1 al crear (L79) y la aprobación posterior a **seis** evaluaciones sigue pasando con `expectedVersion: changeVersion` (L152-154) y tiene éxito.

**Escenario:** Escenario A — aprobación sobre evaluación obsoleta (no requiere simultaneidad estricta):
1. Se crea el cambio (version = 1) y un evaluador evalúa las seis dimensiones. La versión sigue en 1.
2. El aprobador abre /prevencion/gestion-cambio/<id>. La página le entrega `version: 1` y `readiness.ready = true`; la dimensión 'risk' figura como 'No impacta', sin acción.
3. Antes de que decida, el evaluador pulsa 'Reevaluar' en 'risk' y la cambia a impacta = sí con acción CAPA obligatoria y plazo. La versión del cambio sigue en 1.
4. El aprobador pulsa 'Aprobar cambio' con `expectedVersion: 1`.
5. El CAS `WHERE version = 1` pasa. El cambio queda aprobado.

Escenario B — evaluación posterior a la decisión (dos transacciones concurrentes, READ COMMITTED):
1. T1 (aprobar) y T2 (evaluar) leen la solicitud en L215 y L147 respectivamente: ambas ven `status = 'under_evaluation'`.
2. T1 supera la comprobación de L219, actualiza la fila del cambio a 'approved' y confirma.
3. T2 ya superó su comprobación de L150 y actualiza una fila distinta (la evaluación) y crea su acción CAPA; nada la bloquea ni la invalida; confirma.

**Actual:** A: el cambio se aprueba con una evaluación de riesgo que el aprobador nunca vio, y con una acción CAPA obligatoria de la que no tuvo noticia. La columna `version` existe precisamente para impedirlo y no lo hace. B: una evaluación queda registrada con `evaluatedAt` posterior a `approvedAt` sobre un cambio ya aprobado, violando la invariante que L150 declara ("Un cambio ya decidido no admite nuevas evaluaciones"), y se crea una CAPA colgando de un cambio ya decidido.
**Esperado:** A: el CAS debería fallar con 'El cambio cambió mientras lo editabas' y forzar al aprobador a releer la evaluación vigente. B: la evaluación concurrente debería serializarse contra la aprobación y fallar con 'Un cambio ya decidido no admite nuevas evaluaciones'.
**Impacto:** Es una aprobación fraudulentamente respaldada: el registro dice que el aprobador autorizó un cambio a la vista de las seis dimensiones, cuando el contenido de una de ellas cambió después de que lo leyera. En un cambio de riesgo alto o crítico, es la firma de autorización de una evaluación de riesgo que no se leyó. El escenario B además rompe la inmutabilidad del expediente ya decidido.
**Causa raíz:** La convención de bloqueo optimista del repositorio (versión en el padre + CAS) se aplicó sólo a las dos escrituras que tocan la fila padre. Las escrituras hijas (evaluaciones) se trataron como independientes, cuando de hecho son la entrada sobre la que se calcula `assessChangeReadiness` en la aprobación. Es la misma falla que ya se corrigió en permisos de trabajo, no replicada aquí.
**Corrección:** 1. Añadir en lib/services/prevention-change.ts un `bumpChangeVersion(client, requestId, now)` calcado de `bumpPermitVersion` (lib/services/prevention-permits.ts:116-120), incrementando en SQL: `.set({ version: sql\`${preventionChangeRequests.version} + 1\`, updatedAt: now })`, y llamarlo al final de `evaluateChangeDimension` (fusionándolo con el UPDATE de L189 cuando el estado pasa de 'draft' a 'under_evaluation', para no emitir dos UPDATE).
2. Bloquear la fila padre al entrar en la transacción de evaluación, con el patrón ya usado en PDTP: `await tx.execute(sql\`SELECT id FROM ${preventionChangeRequests} WHERE id = ${data.changeRequestId} FOR UPDATE\`)` antes del SELECT de L147. Hacer lo mismo en aprobar y rechazar cierra la carrera en ambos sentidos.
3. Actualizar prevention-change-postgres.test.ts: hoy documenta el defecto al aprobar con `expectedVersion: 1` tras seis evaluaciones; debe releer la versión.

**⚠️ Matiz del verificador:** The mechanical observation is true: `evaluateChangeDimension` never touches `version` (L176-191 updates only the assessment row and, when draft, sets `status`/`updatedAt` on the parent), there is no `FOR UPDATE` anywhere in prevention-change.ts, and prevention-permits.ts:107-120 does carry the quoted `bumpPermitVersion` docstring («si no mueve `version`, el CAS de `transitionWorkPermit` no ve el cambio y activa el permiso con una evaluación ya obsoleta»). The test evidence also holds (changeVersion stays 1 through six evaluations, approval at L152-154 succeeds). BUT the framing 'el CAS de aprobación no ve la evaluación' overstates the impact: the approval gate does NOT rely on the client's snapshot. `approveChangeRequest` re-reads the assessments inside its own transaction at L222-223 (`select({dimension, evaluated}) ... where changeRequestId = request.id`) and `assessChangeReadiness` (lib/prevention/change.ts:71-78) consumes only `evaluated` (monotonically true once set) and the `plannedReviewDate` supplied in the approve payload — never `impacted`, `actionRequired` or the CAPA. So Scenario A cannot flip `readiness.ready`; the residue is that the approver may act on assessment *content* (impacted/notes/CAPA) that changed since page render. Scenario B is real: under READ COMMITTED T2 passes L150 before T1 commits and then updates a different row, so an evaluation plus a new CAPA can land on an already-approved change, breaking the stated invariant «Un cambio ya decidido no admite nuevas evaluaciones» that the postgres test asserts only in the sequential case. Real gap, narrow window, not HIGH.

---

## MOC-03 [MEDIUM] — Reevaluar una dimensión crea una acción CAPA duplicada y huérfana la anterior, que queda abierta y sin vínculo
**Área:** MOC (gestión del cambio) · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-change.ts:159-185 · app/(app)/prevencion/gestion-cambio/[changeId]/change-detail.tsx:191` · **Componente:** `evaluateChangeDimension`

**Evidencia:** La evaluación es idempotente en la fila de la dimensión (hay UNIQUE en `(changeRequestId, dimension)` y se hace UPDATE), pero **no** en la CAPA derivada: crea una nueva incondicionalmente en cada llamada con `actionRequired = true`, sin mirar si la dimensión ya tenía una:

```ts
// lib/services/prevention-change.ts:159-173
let capaActionId: string | null = null
if (data.actionRequired) {
  const capa = await createCapaActionWithClient(tx, {
    sourceType: "change", sourceId: request.id, worksiteId: request.worksiteId,
    finding: `${data.dimension}: ...`, actionDescription: data.actionDescription!,
    ..., targetDate: data.targetDate!, evidenceRequired: true,
  }, access.userId)
  capaActionId = capa.id
}
```
No se lee `assessment.capaActionId` (la fila anterior sí se cargó en L152-156 y está disponible). Y el UPDATE siguiente pisa el vínculo con la variable local, que vale `null` cuando ya no se requiere acción:

```ts
// L176-185
}).set({ evaluated: true, ..., actionRequired: data.actionRequired, capaActionId, ... })
```

`createCapaActionWithClient` (lib/services/prevention-capa.ts:227-289) inserta siempre: no tiene clave de idempotencia ni consulta previa por `(sourceType, sourceId, sourceItemId)`; de hecho `sourceItemId` —que serviría para identificar la dimensión— no se envía desde aquí y queda NULL. La acción nace en `status: "pending"` (L254).

La reevaluación es un camino normal y visible en la UI, no un caso límite:
```tsx
// change-detail.tsx:191
<Button size="sm" variant="secondary">{assessment.evaluated ? "Reevaluar" : "Evaluar"}</Button>
```
No hay borrado ni cancelación de la CAPA anterior en ninguna rama.

**Escenario:** 1. En la dimensión 'permit' se evalúa con impacto y acción requerida: se crea CAPA-2026-AAA (pendiente, plazo 2026-11-01) y la evaluación queda enlazada a ella.
2. El evaluador nota una errata en la descripción de la acción, pulsa 'Reevaluar', deja marcado 'Requiere una acción correctiva' y corrige el texto.
3. Se crea CAPA-2026-BBB. La evaluación pasa a apuntar a BBB. CAPA-2026-AAA sigue pendiente, con el mismo hallazgo, sin que nadie la referencie desde el MOC.
4. Variante: en el paso 2 el evaluador desmarca 'Requiere una acción correctiva' porque el control existente ya cubría el impacto. `capaActionId` se fija en NULL y CAPA-2026-AAA queda abierta, huérfana e invisible desde el cambio (la celda muestra '—').

**Actual:** Cada reevaluación con acción requerida inserta una acción CAPA nueva en el registro legal de acciones correctivas. Las anteriores quedan abiertas, pendientes, con plazo corriendo, entrando en los listados, en el KPI de vencidas (`capaQuickFilterWhere("overdue")`) y en los recordatorios, sin ningún camino desde el MOC para verlas o cerrarlas. Desmarcar la casilla las desconecta silenciosamente sin cancelarlas.
**Esperado:** La reevaluación debe reconciliar la acción existente, no duplicarla: si la dimensión ya tiene `capaActionId` y sigue requiriendo acción, actualizar esa acción (o dejarla y no crear otra); si deja de requerirla, cancelar explícitamente la acción anterior dejando motivo y actor en la transición CAPA. Nunca debe quedar una acción CAPA con `sourceType='change'` sin referencia desde su dimensión.
**Impacto:** Contaminación del registro de acciones correctivas —que es documentación legal— con duplicados y huérfanas que nadie puede cerrar por su origen. Infla los indicadores de CAPA abiertas y vencidas del dashboard, y genera recordatorios sobre acciones que el evaluador cree haber sustituido o retirado. Basta pulsar dos veces un botón visible para provocarlo.
**Causa raíz:** La derivación a CAPA se escribió pensando sólo en la primera evaluación (camino 'Evaluar'), pero la UI ofrece 'Reevaluar' sobre el mismo registro. `evaluateChangeDimension` es un upsert en su fila hija y un insert puro en su efecto lateral: falta la rama de reconciliación para el estado previo, que ya está cargado en `assessment`.
**Corrección:** En lib/services/prevention-change.ts, dentro de la transacción y usando `assessment.capaActionId` que ya está en memoria:
1. Si `data.actionRequired && assessment.capaActionId` → no crear nada nuevo; actualizar la acción existente con `updateCapaActionWithClient` (lib/services/prevention-capa.ts:312) pasando su `version` leída, y conservar `capaActionId = assessment.capaActionId`.
2. Si `!data.actionRequired && assessment.capaActionId` → cancelar la acción con `transitionCapaActionWithClient` a `cancelled`, con motivo 'La reevaluación del cambio retiró el requisito de acción', antes de poner el vínculo a NULL.
3. Pasar `sourceItemId: data.dimension` en la creación, para que la acción sea identificable por dimensión y para poder añadir un índice único parcial `(source_type, source_id, source_item_id) WHERE source_type = 'change'` como red de seguridad en la BD.

---

## PPA-01 [MEDIUM] — El límite de envíos del formulario público se indexa por una identidad que envía el propio atacante: rotando `workerId`/`workerRut` se obtienen escrituras ilimitadas sin autenticación
**Área:** PPA · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `app/(public)/ppa/actions.ts:26-53` · **Componente:** `submitPpaAction`

**Evidencia:** La clave del limitador se deriva del payload del cliente, sin ningún fallback a IP cuando ese payload trae identidad:

```ts
26:  const preParsed = ppaSubmitSchema.safeParse(input)
27:  const rateLimitIdentity = preParsed.success
28:    ? (preParsed.data.workerId
29:        || (preParsed.data.workerRut ? cleanRut(preParsed.data.workerRut) : "")
30:        || clientIp)
31:    : clientIp
32:  const rateLimitKey = `ppa:${rateLimitIdentity}`
34:  const limitRes = await checkRateLimit(rateLimitKey)
...
53:  await recordFailure(rateLimitKey)
```

`workerId` es `z.string().min(1).optional()` y `workerRut` es `z.string().trim().max(20)` sin validación de RUT (lib/validation/ppa.ts:19-21), así que ambos aceptan basura arbitraria. `createPpaSubmission` no exige que existan: si `workerId` no resuelve o pertenece a otra faena, cae silenciosamente a identificación manual (lib/services/ppa-module/evaluaciones.ts:72-82) y la fila se inserta igual. No hay `middleware.ts` en el repo (verificado: no existe ni en raíz ni en src/), de modo que este limitador es la única barrera. `checkRateLimit`/`recordFailure` (lib/services/rate-limit.ts:87-111) bloquean 5 intentos por clave / 15 min — por clave, no por origen.

**Escenario:** 1. Un anónimo abre POST a la Server Action de /ppa (o simplemente automatiza el formulario público).
2. Envía un payload válido con `workerId: "x1"`, faena real tomada de la lista pública que la propia página entrega.
3. Repite con `workerId: "x2"`, `"x3"`, … (o `workerRut` incrementales). Cada clave arranca su propio contador de 5.
4. Respondiendo `seguroComenzar: "no"` cada envío evalúa `detenido`, con lo que además se dispara `notifyManyUser` a todos los usuarios con `ppa:review` de esa faena (evaluaciones.ts:157-175).

**Actual:** Escrituras ilimitadas: una fila en `ppa_submissions`, una en `ppa_status_history` y una en `operational_activity` por envío, más una notificación por cada revisor de la faena en cada envío detenido. El panel /prevencion/ppa y la cola operacional quedan inundados de casos falsos que un prevencionista debe revisar uno a uno, y el registro legal del módulo queda contaminado sin forma de distinguir el ruido.
**Esperado:** El límite debe estar anclado a algo que el emisor no controla (IP/red) y sólo afinarse con la identidad declarada. Un atacante que rote identidades debe seguir topando contra el límite de su origen.
**Impacto:** DoS de bajo costo y contaminación permanente de un registro de seguridad legalmente exigible, desde una superficie sin autenticación. También ruido de notificaciones que desensibiliza a los revisores frente a detenciones reales.
**Causa raíz:** La corrección UX-01 (evitar que un NAT compartido bloquee a trabajadores distintos) sustituyó la clave por IP en vez de sumarla: la identidad declarada pasó a ser la única dimensión del límite.
**Corrección:** Consumir DOS cuotas: la de identidad (la actual, para UX) y una por IP con umbral más alto, usando `consumeFixedWindowLimit` que ya existe en lib/services/rate-limit.ts:25-45 y cuenta también los éxitos (`ppa-ip:${clientIp}`, p. ej. 30/15 min). Rechazar si cualquiera de las dos se agota. Complementariamente, exigir `validateRut` (lib/rut.ts) sobre `workerRut` en `ppaSubmitSchema` para que la identidad manual no sea una cadena libre.

**⚠️ Matiz del verificador:** Citation matches `app/(public)/ppa/actions.ts:26-32`: `const rateLimitIdentity = preParsed.success ? (preParsed.data.workerId || (preParsed.data.workerRut ? cleanRut(...) : "") || clientIp) : clientIp`, and `ppaSubmitSchema` (lib/validation/ppa.ts:19-21) validates neither field, so rotating `workerId` does start a fresh 5-attempt counter. No middleware.ts exists and `createPpaSubmission` only requires a real `worksiteId` (evaluaciones.ts:40-44) — the worksite list is public — so the flood is reachable. Two things break the HIGH framing. (1) The scoping is a deliberate, tested decision, not an oversight: `lib/__tests__/ppa-actions.test.ts:154-165` asserts `expect(mockRecordFailure).toHaveBeenCalledWith("ppa:work-42")` under the title "escopa el rate limit por workerId cuando está presente (UX-01)". (2) The stated root cause and implied fix are wrong: `clientIp` is `h.get("x-forwarded-for")?.split(",")[0]` — the LEFTMOST, i.e. client-supplied, hop (same pattern as lib/auth/auth.ts:91), so re-adding the IP dimension would be just as forgeable; the real fix is a trusted-proxy IP or a per-worksite quota. Impact is spam records plus reviewer notifications on an endpoint that is unauthenticated by design (the action's own header comment says so) — no authz bypass, no disclosure, no mutation of existing records. MEDIUM.

---

## PPA-04 [MEDIUM] — La cola offline no tiene clave de idempotencia: una sincronización interrumpida duplica el PPA o lo pierde en silencio
**Área:** PPA · **Categoría:** Concurrencia · **Confianza:** Alta
**Ubicación:** `lib/pwa/hooks.ts:49-96` · **Componente:** `syncOne / getPendingPpas / submitPpaAction`

**Evidencia:** El payload que cruza la red es el del formulario, sin identificador propio (`ppaSubmitSchema`, lib/validation/ppa.ts:10-44, no tiene ningún campo de deduplicación) y el servidor no consulta nada previo antes de insertar (`createPpaSubmission`, evaluaciones.ts:98-155). El estado local se mueve así:

```ts
// lib/pwa/hooks.ts:57-90
57:  await updatePpaStatus(item.id, { status: "syncing", attempts: item.attempts + 1 })
...
62:    const res = await submitPpaAction(item.payload as …)
...
85:    await updatePpaStatus(item.id, {
86:      status: item.attempts + 1 >= MAX_SYNC_ATTEMPTS ? "failed" : "pending",
```

Y sólo se reintenta lo que quedó en `pending`:

```ts
// lib/pwa/offline-queue.ts:116-125
116: export async function getPendingPpas(): Promise<QueuedPpa[]> {
118:     const index = store.index("status")
120:       const req = index.getAll("pending")
```

`countPendingPpas` (offline-queue.ts:172-181) también cuenta sólo `pending`, así que un elemento atascado en `syncing` desaparece del contador que ve el trabajador.

**Escenario:** Caso A (duplicado): el trabajador recupera señal en faena; `syncOne` envía; el servidor inserta el PPA y notifica a los revisores; la conexión se corta antes de que llegue la respuesta. El `catch` (líneas 76-94) reclasifica el ítem como `pending` y el siguiente evento `online` lo reenvía → segundo PPA idéntico.
Caso B (pérdida): el mismo envío se corta y el trabajador cierra la pestaña / se apaga el teléfono antes de que corra el `catch`. El ítem queda en `syncing`.

**Actual:** A: dos filas en `ppa_submissions` para una sola evaluación, dos casos detenidos que revisar, dos notificaciones. B: el ítem en `syncing` no lo devuelve `getPendingPpas` en ningún arranque posterior, no lo cuenta `countPendingPpas` y nada lo reintenta: la evaluación nunca llega al servidor y el trabajador, que vio «PPA guardado offline. Se enviará automáticamente», cree lo contrario. Silencio total.
**Esperado:** Reintentar debe ser seguro (a lo sumo un PPA por evaluación) y ningún elemento encolado debe quedar en un estado del que no se sale.
**Impacto:** En A ensucia el registro y duplica trabajo de revisión. En B se pierde una evaluación preventiva que quizá era una detención de trabajo — pérdida silenciosa de un registro de seguridad, que es el peor modo de falla de un formulario offline-first.
**Causa raíz:** La cola implementa entrega "a lo más una vez" desde el punto de vista del cliente sin que el servidor aporte deduplicación; el estado intermedio `syncing` no es reanudable.
**Corrección:** Añadir la clave que ya se genera localmente: enviar `clientSubmissionId: item.id` (ya único, offline-queue.ts:100) en el payload, validarlo en `ppaSubmitSchema`, persistirlo en `ppa_submissions` con índice UNIQUE parcial, y en `createPpaSubmission` devolver el registro existente (con su token) en vez de insertar cuando la clave ya está. Con eso, tratar los ítems `syncing` antiguos como reintentables en `getPendingPpas` (p. ej. `syncing` con `updatedAt` de más de unos minutos) deja de ser peligroso y cierra el caso B.

---

## CPHS-02 [LOW] — La asistencia nominativa no se registra para integrantes incorporados después de la convocatoria (caso típico: un reemplazo), aunque sí cuentan para el quórum
**Área:** CPHS · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs.ts:616-629, 686-693` · **Componente:** `scheduleCommitteeMeeting / closeCommitteeMeeting`

**Evidencia:** Las filas de asistencia se crean una sola vez, al convocar:
```ts
616     // Se convoca a todos los integrantes activos; la asistencia se marca al cerrar.
617     const members = await tx.select({ id: preventionCommitteeMembers.id })
...
624       await tx.insert(preventionCommitteeAttendance).values(members.map((member) => ({
625         id: `cphsa-${nanoid()}`,
626         meetingId: id,
627         memberId: member.id,
628       })))
```
y al cerrar sólo se hace UPDATE, sin insertar las que falten ni verificar cuántas filas se tocaron:
```ts
687     if (data.attendedMemberIds.length > 0) {
688       await tx.update(preventionCommitteeAttendance).set({ attended: true })
689         .where(and(
690           eq(preventionCommitteeAttendance.meetingId, row.meeting.id),
691           inArray(preventionCommitteeAttendance.memberId, data.attendedMemberIds),
692         ))
693     }
```
En cambio el quórum (líneas 670-684) se calcula sobre TODOS los integrantes activos del comité leídos en ese momento, no sobre las filas convocadas. `replaceCommitteeMember` (líneas 273-284) crea una fila de integrante NUEVA, y el diálogo de cierre ofrece `activeMembers` (app/(app)/prevencion/cphs/[committeeId]/page.tsx:92-101 → committee-detail.tsx:277-279), de modo que el reemplazante aparece con casilla marcable.

**Escenario:** 1. Sesión convocada el 5 de marzo con 6 integrantes activos → 6 filas de asistencia.
2. El 10 de marzo renuncia un titular y se registra su reemplazo con `replaceCommitteeMember` (nuevo `memberId`).
3. El 15 de marzo se cierra el acta marcando como presentes al reemplazante y a otros 3.
4. `assessQuorum` cuenta al reemplazante (está activo) y el cierre se autoriza.
5. El UPDATE de asistencia no encuentra fila para el reemplazante (no existe) y no falla.

**Actual:** El acta se cierra afirmando quórum alcanzado, pero la asistencia nominativa —el registro que exige la norma y que alimenta la columna «asistencia» de la UI y la certificación— no contiene al reemplazante; además el integrante reemplazado sigue contando como «convocado». La discrepancia no genera error ni aviso.
**Esperado:** Todo integrante marcado como presente debe quedar con su fila de asistencia del acta, y el conteo convocados/asistentes debe cuadrar con el quórum que autorizó el cierre.
**Impacto:** El acta cerrada tiene una asistencia nominativa incompleta e inconsistente con su propio quórum; ante una fiscalización o una auditoría Mutual el registro no respalda la validez de la sesión.
**Causa raíz:** El conjunto convocado se materializa en la convocatoria y nunca se reconcilia con el padrón de integrantes vigente al cerrar; el cierre asume que toda fila existe y no comprueba el resultado del UPDATE.
**Corrección:** En `closeCommitteeMeeting`, antes del UPDATE, insertar las filas faltantes para los `attendedMemberIds` que sean integrantes activos del comité y no tengan fila (`tx.insert(preventionCommitteeAttendance)...onConflictDoNothing()` — el índice único `prevention_committee_attendance_unique` sobre (meetingId, memberId) lo hace seguro), y validar que todo id enviado pertenezca al comité (ya se leen los integrantes en la línea 670, basta cruzar contra ese arreglo y rechazar los desconocidos en vez de ignorarlos en silencio). Mismo tratamiento para `data.excuses`.

**⚠️ Matiz del verificador:** Citations are accurate. `scheduleCommitteeMeeting` materialises attendance once (prevention-cphs.ts:616-629: `// Se convoca a todos los integrantes activos; la asistencia se marca al cerrar.` then a single INSERT over the members active at that moment), and `closeCommitteeMeeting` only UPDATEs (lines 687-693) without checking rowcount, while the quorum is computed over a fresh read of ALL committee members (lines 670-681). `replaceCommitteeMember` does create a brand-new member row (line 273 `tx.insert(preventionCommitteeMembers)`) on a still-active committee, and the close dialog is fed `activeMembers` (committee-detail.tsx:126 `members.filter((item) => item.status === "active")`, passed at line 279), so the replacement is checkable and does count for quorum. I found no reconciliation anywhere and no test pinning it (the postgres test only asserts the 5 rows created at scheduling, prevention-cphs-postgres.test.ts:141-144). So the observation holds, but the consequences are narrower than MEDIUM implies: the quorum itself is still computed correctly (the person really did attend), nothing throws, no CAPA or acta content is wrong — what is lost is one nominative attendance row and the accuracy of the `attended/convened` counters in listCommitteeMeetings (prevention-cphs.ts:895-896), and it only bites when a member joins between convocation and closure.

---

## CPHS-04 [LOW] — `heldAt` del acta no tiene cota superior: un acta con fecha futura silencia para siempre el aviso de cadencia, que además se calcula con dos fuentes distintas
**Área:** CPHS · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs.ts:636-651, 556-583, 876-879` · **Componente:** `closeCommitteeMeeting / getCommitteeStatus / listCommittees`

**Evidencia:** El esquema Zod acepta cualquier instante:
```ts
639   heldAt: z.iso.datetime({ offset: true }),
```
sin comparación contra `nowIso()`, `scheduledFor` ni `constitutedOn`, y la tabla tampoco tiene CHECK (db/schema/prevention/cphs.ts:155-185). La cadencia de la UI se calcula sobre ese valor:
```ts
558     db.select({ heldAt: preventionCommitteeMeetings.heldAt })
...
564       .orderBy(desc(preventionCommitteeMeetings.heldAt)).limit(1),
...
581     cadence: assessMeetingCadence(lastClosed[0]?.heldAt ?? null, nowIso()),
```
y el listado usa `MAX(t.held_at)` (línea 878). En cambio el job de recordatorios usa otra columna:
```ts
82       lastClosedAt: max(preventionCommitteeMeetings.closedAt),
```
(lib/services/prevention-cphs-reminders.ts:80-89), y la certificación usa `closedAt` para los meses. `assessMeetingCadence` (lib/prevention/cphs.ts:134-140) devuelve meses negativos para una fecha futura, por lo que `overdue` es `false`.

**Escenario:** 1. Al cerrar el acta se tipea 2027 en vez de 2026 en «Realizada el» (el campo es `datetime-local` libre, committee-detail.tsx:497).
2. El acta se guarda con `heldAt` en 2027.
3. Se abre /prevencion/cphs y el detalle del comité.

**Actual:** La ficha del comité muestra «Cadencia: Al día» y el listado no marca atraso, indefinidamente, aunque el comité no vuelva a sesionar; el job de recordatorios sí alerta (usa `closedAt`), de modo que la pantalla y la notificación se contradicen.
**Esperado:** `heldAt` debe estar acotado (no futuro, no anterior a la constitución del comité) y la «última sesión» debe tener una sola definición en las tres capas.
**Impacto:** El indicador de cadencia mensual —obligación del DS 44/DS 54 y requisito Bronce— puede quedar en verde permanentemente por un dato de entrada no validado, y la UI contradice al sistema de avisos.
**Causa raíz:** Fecha de hecho aceptada sin cota y tres definiciones distintas de «última sesión cerrada» (`heldAt` en la UI, `closedAt` en el job y en la certificación).
**Corrección:** Acotar `heldAt` en `closeMeetingSchema` con un `superRefine`: `heldAt <= nowIso()` y `heldAt >= committee.constitutedOn` (la validación contra el comité ya tiene el registro cargado en la línea 660). Unificar la fuente: usar `heldAt` en las tres capas (UI, `prevention-cphs-reminders.ts:80-89` y `gatherCertificationEvidence`, ver CPHS-03) o `closedAt` en las tres, pero no mezclarlas.

**⚠️ Matiz del verificador:** The absence of an upper bound is real: `heldAt: z.iso.datetime({ offset: true })` (prevention-cphs.ts:639) with no superRefine against `nowIso()`, `scheduledFor` or `constitutedOn`; db/schema/prevention/cphs.ts:178-185 has no CHECK on `held_at`; and the input is a bare `<Input type="datetime-local" required value={heldAt} .../>` (committee-detail.tsx:536) with no `max`. `assessMeetingCadence` does yield negative months for a future date (`months = (now.getUTCFullYear() - last.getUTCFullYear()) * 12 + ...`, cphs.ts:138) so `overdue` is false. But the headline 'silencia para siempre el aviso de cadencia' is wrong: the daily reminder job reads a different column — `lastClosedAt: max(preventionCommitteeMeetings.closedAt)` (prevention-cphs-reminders.ts:82) — and is invoked for real via app/api/cron/prevention-cphs-alerts/route.ts:19, so the actual overdue NOTIFICATION still fires on schedule. The damage is confined to the on-screen cadence badge (getCommitteeStatus:581) and the `MAX(t.held_at)` column of the list (line 878), from a typo the user can see and no path corrects. That is a missing input bound with cosmetic blast radius, not MEDIUM.

---

## CPHS-06 [LOW] — Un expediente rechazado es un callejón sin salida: no se puede re-presentar ni crear otro para el mismo nivel y año
**Área:** CPHS · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs-certification.ts:346-388, 683-721; db/schema/prevention/cphs.ts:311-314` · **Componente:** `createCertificationDossier / recordAuditResult`

**Evidencia:** `recordAuditResult` deja el expediente en `certified` o `rejected` y ninguna función exportada del servicio admite esos estados: `recordManualEvaluation` (483), `submitCertificationDossier` (539) y `updateDossierAdministrativeData` (647) exigen `status === "draft"`, y `recordAuditResult` exige `status === "submitted"` (689). Crear uno nuevo está bloqueado:
```ts
362     if (existing) {
363       throw new Error(`Ya existe un expediente ${CERTIFICATION_LEVEL_LABELS[data.level]} ${data.periodYear} para este comité.`)
364     }
```
reforzado por `uniqueIndex("prevention_certification_dossier_unique").on(committeeId, level, periodYear)`. La UI sólo ofrece acciones para `draft` y `submitted` (certification-panel.tsx:76-81).

**Escenario:** 1. Se presenta el expediente Bronce 2026 con 3 brechas.
2. Mutual rechaza; se registra el resultado con `outcome: "rejected"`.
3. El comité cierra las 3 brechas dentro del plazo de 60 días y quiere volver a presentarse.

**Actual:** No hay acción posible: el expediente rechazado no admite cambios ni re-presentación, y crear otro Bronce 2026 falla por duplicado. El nivel queda bloqueado hasta el año siguiente.
**Esperado:** Tras cerrar las brechas debe existir un camino de re-presentación (reabrir el expediente rechazado o permitir un segundo intento del mismo nivel y año), coherente con el plazo de 60 días que el propio modelo registra.
**Impacto:** El proceso de certificación queda sin salida justo después del evento que el sistema instrumenta con más detalle (las brechas con CAPA a 60 días); el trabajo de cierre de brechas no puede materializarse en una nueva presentación.
**Causa raíz:** La máquina de estados del expediente es lineal y terminal en `rejected`, sin transición de reapertura, mientras la unicidad (comité, nivel, año) impide el rodeo de crear otro.
**Corrección:** Agregar una transición explícita `rejected → draft` (p. ej. `reopenCertificationDossier`) con permiso `prevention:cphs:certify`, CAS sobre `version`, motivo obligatorio y registro en `recordGovernanceHistory`, que limpie `submittedAt/submittedByUserId/auditedOn/auditResult` y descongele el expediente; alternativa más simple: añadir un `attempt` al índice único. Reusar el patrón de reapertura ya presente en el módulo de incidentes.

**⚠️ Matiz del verificador:** The dead end is real and I confirmed every exit is closed: recordAuditResult sets `status: data.outcome` ∈ {certified, rejected} (prevention-cphs-certification.ts:696-697); recordManualEvaluation (483), submitCertificationDossier (539) and updateDossierAdministrativeData (647) all require `status !== "draft"` → throw; recordAuditResult itself requires `status === "submitted"` (689); createCertificationDossier throws `Ya existe un expediente ...` (362-364) backed by `uniqueIndex("prevention_certification_dossier_unique").on(committeeId, level, periodYear)` (schema:312); and the header actions render nothing for certified/rejected (`{selected?.status === "draft" && ...}` / `{selected?.status === "submitted" && <AuditResultDialog .../>}`). So a rejected Bronce 2026 cannot be re-presented, and no other dossier for that (comité, nivel, año) can be created. That said, this is a missing transition — a feature gap in a state machine — not a malfunction: nothing is corrupted, no wrong data is produced, and the adjacent year or a different level remains available. MEDIUM overstates a 'no hay botón para reabrir'.

---

## CPHS-07 [LOW] — `recordManualEvaluation` acepta códigos de requisito de otro nivel y esas filas contaminan el expediente congelado
**Área:** CPHS · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs-certification.ts:469-478, 415-457` · **Componente:** `recordManualEvaluation / getCertificationDossier`

**Evidencia:** Sólo se valida que el código exista en el catálogo y sea manual, nunca que pertenezca al nivel del expediente:
```ts
471   const definition = findRequirement(data.requirementCode)
472   if (!definition) throw new Error("El requisito indicado no existe en el catálogo.")
473   if (definition.check.kind !== "manual") {
474     throw new Error("Este requisito lo evalúa el sistema con los datos del período: no admite declaración manual.")
475   }
```
`findRequirement` busca en `CERTIFICATION_REQUIREMENTS` completo (lib/prevention/cphs-certification.ts:391-393), que incluye Bronce, Plata y Oro. Mientras el expediente está en borrador la fila extra es invisible porque `evaluateLevel` filtra por nivel, pero una vez congelado la lectura devuelve TODAS las filas almacenadas:
```ts
417       requirements = stored.map((row) => {
```
y el resumen se calcula sobre ese arreglo (línea 453, `summarizeEvaluation(requirements)`).

**Escenario:** 1. Sobre un expediente Bronce en borrador se invoca `recordManualEvaluationAction` con `requirementCode: "road_safety"` (nivel Oro, manual) y `status: "met"` — payload aceptado por el server action, aunque la UI no ofrezca ese botón.
2. Se presenta el expediente: el bucle de congelado sólo recorre los 11 requisitos Bronce, así que la fila Oro queda intacta.
3. Se abre el expediente presentado.

**Actual:** El expediente Bronce congelado muestra 12 requisitos —incluido uno de Oro— y el resumen «cumplidos/aplicables» se calcula sobre 12, alterando el conteo que se presenta como evidencia de auditoría.
**Esperado:** Una declaración manual sólo debe admitirse para requisitos del nivel del expediente, y la vista congelada debe mostrar exactamente los requisitos evaluados de ese nivel.
**Impacto:** El snapshot que sirve de evidencia ante la auditoría puede incluir requisitos ajenos al nivel y su resumen deja de cuadrar; es manipulable desde el server action sin pasar por la UI.
**Causa raíz:** Falta el cruce nivel-del-expediente ↔ nivel-del-requisito en la única capa que valida (el servicio), y la lectura congelada confía en que lo almacenado corresponde al nivel.
**Corrección:** En `recordManualEvaluation`, tras `loadDossier`, exigir `definition.level === context.dossier.level`; y en la rama congelada de `getCertificationDossier` filtrar `stored` por los códigos de `requirementsForLevel(dossier.level)` para que un dato heredado no altere el resumen.

---

## CPHS-12 [LOW] — El job de recordatorios CPHS no es idempotente respecto del correo: la deduplicación sólo cubre la notificación en la app
**Área:** CPHS · **Categoría:** Integración · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs-reminders.ts:116-161; lib/services/notification-create.ts:132-152` · **Componente:** `runPreventionCphsReminders / createNotifications`

**Evidencia:** El job siempre pasa `dedupeKey` (líneas 123, 139, 160), y `createNotifications` sí filtra los INSERT:
```ts
140     const skipUserIds = new Set(existing.map((r) => r.userId))
141     const toInsert = values.filter((v) => !skipUserIds.has(v.userId))
142     if (toInsert.length === 0) return
143     await db.insert(notifications).values(toInsert)
```
Pero el envío de correo posterior se arma sobre el arreglo completo de destinatarios, no sobre `toInsert`:
```ts
149   const targetUsers = await db
150     .select({ id: users.id, email: users.email, name: users.name, emailNotifications: users.emailNotifications })
151     .from(users)
152     .where(inArray(users.id, userIds))
```
(el `return` de la línea 142 sólo salva el caso en que TODOS estaban deduplicados; basta un destinatario nuevo para que todos los demás reciban el correo otra vez).

**Escenario:** 1. Se ejecuta `runPreventionCphsReminders` por la mañana: 3 managers reciben la alerta de mandato por vencer.
2. Se agrega un cuarto manager a la faena.
3. Se vuelve a ejecutar el job el mismo día (reintento manual, doble instancia o cuando se programe el cron).

**Actual:** Los 3 managers originales reciben el mismo correo por segunda vez aunque no se cree una segunda notificación en la app.
**Esperado:** Una ejecución repetida no debe producir avisos repetidos por ningún canal; el `dedupeKey` debería gobernar también el correo.
**Impacto:** Ruido de correo en cada reejecución del job (y el cron aún no está programado, así que hoy las corridas son manuales y repetibles); erosiona la confianza en las alertas de mandato y cadencia.
**Causa raíz:** En `createNotifications` la deduplicación se aplica al INSERT pero el envío de correo se calcula sobre la lista original de destinatarios. Es un servicio compartido, no exclusivo del CPHS.
**Corrección:** En lib/services/notification-create.ts, construir `targetUsers` a partir de los ids realmente insertados (`toInsert.map(v => v.userId)`) en lugar de `userIds`. Es un cambio de una línea en el punto por el que pasan todos los jobs, no sólo el de CPHS.

---

## EMERGENCIAS-03 [LOW] — Los participantes de un simulacro no se validan contra la faena ni contra la vigencia del trabajador (la misma validación sí existe para los roles del organigrama)
**Área:** Emergencias · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-emergency.ts:384-392` · **Componente:** `completeEmergencyDrill`

**Evidencia:** Los participantes se insertan tal cual llegan del cliente, sin ninguna consulta a `workers`:

```ts
// :384-392
if (data.participants.length > 0) {
  await tx.insert(preventionEmergencyDrillParticipants).values(data.participants.map((item) => ({
    id: `pemgdp-${nanoid()}`,
    drillId: drill.id,
    workerId: item.workerId,
    present: item.present,
    roleName: item.roleName ?? null,
  })))
}
```

El schema Zod sólo exige `workerId: z.string().min(1)` (:348-352). La única barrera restante es la FK a `workers.id`: cualquier trabajador existente del sistema es aceptable.

El contraste está en el mismo archivo: `addEmergencyRole` sí valida las dos cosas para el titular y el reemplazo:

```ts
// :170-177
if (!assignee || !assignee.isActive) throw new Error("La persona titular no existe o está inactiva.")
if (assignee.worksiteId !== plan.worksiteId) throw new Error("El titular del rol debe pertenecer a la faena del plan.")
```

El filtro por faena existe sólo en la capa de presentación (`[planId]/page.tsx:40`: `allWorkers.filter((worker) => worker.worksiteId === detail.plan.worksiteId)`), es decir, del lado que el atacante controla.

**Escenario:** 1. Un usuario con `prevention:emergency:drill_execute` y alcance sobre la faena A abre el simulacro programado de A.
2. Invoca `completeEmergencyDrillAction` con un payload construido a mano: `participants: [{ workerId: "<id de un trabajador de la faena C>", present: true }]`.
3. `requireAccess` pasa (el simulacro es de A), `assessDrillCompletion` pasa (hay un presente), y la inserción pasa (la FK sólo exige que el trabajador exista).
4. El simulacro queda `completed` con un participante que nunca estuvo en esa faena. Lo mismo con un trabajador desvinculado (`isActive = false`).

**Actual:** El acta de asistencia del simulacro —evidencia del cumplimiento del DS 44— admite trabajadores de otras faenas y trabajadores inactivos, y el requisito de "al menos un presente" (`assessDrillCompletion`, lib/prevention/emergency.ts:87) se puede satisfacer con alguien que no pertenece a la faena.
**Esperado:** Antes de insertar, resolver los `workerId` recibidos y rechazar si alguno no existe, está inactivo o su `worksiteId` difiere del `drill.worksiteId`, con el mismo mensaje y la misma forma que `addEmergencyRole`.
**Impacto:** Registro legal de asistencia falsificable desde el boundary de la Server Action, y una faena puede acreditar un simulacro con dotación ajena. También rompe la coherencia interna: `preventionEmergencyDrillParticipants` no tiene columna de faena, así que el error es indetectable a posteriori sin un join.
**Causa raíz:** La validación de pertenencia se implementó una sola vez (roles) y se dio por cubierta en participantes porque la UI ya filtra la lista; no se replicó en el servicio.
**Corrección:** En `completeEmergencyDrill`, antes del insert: `const ids = [...new Set(data.participants.map(p => p.workerId))]` y una consulta única `select id, isActive, worksiteId from workers where id in (ids)`; rechazar si `rows.length !== ids.length`, si alguno tiene `isActive = false` o si algún `worksiteId !== drill.worksiteId`. El `new Set` además evita la violación del índice único `prevention_emergency_drill_participant_unique` cuando el payload trae ids repetidos (hoy eso sale como error crudo de Postgres al usuario vía actions.ts:38).

**⚠️ Matiz del verificador:** La asimetria es real y verificada. completeEmergencyDrill inserta participantes sin consultar workers (:384-392), el schema solo pide 'workerId: z.string().min(1)' (:349) y assessDrillCompletion (lib/prevention/emergency.ts:85-94) solo cuenta presentes y exige outcome. addEmergencyRole si valida ambas cosas (:171-172). Peor aun, el comentario de listEmergencyWorkers (:626-630) afirma 'el servicio rechaza personas de otra faena', lo cual es falso para participantes. Pero el impacto real es LOW, no MEDIUM: exige forjar el payload de la Server Action a un usuario que YA tiene prevention:emergency:drill_execute y alcance sobre esa faena (requireAccess sobre drill.worksiteId, :373); la FK exige que el trabajador exista y el uniqueIndex 'prevention_emergency_drill_participant_unique' (emergency.ts:153) impide duplicados; el dano se limita a una fila de asistencia espuria, sin escalada de permisos, sin lectura de datos ajenos (el atacante debe conocer el id) y sin efecto en cobertura PDTP (esa rama esta muerta, ver EMERGENCIAS-05).

---

## EMERGENCIAS-05 [LOW] — La auto-acreditación PDTP de los simulacros es código inalcanzable: `pdtpActivityNumbers` del plan no tiene ningún escritor
**Área:** Emergencias · **Categoría:** Integración · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-emergency.ts:428-442; db/schema/prevention/emergency.ts:23-25` · **Componente:** `completeEmergencyDrill / onEmergencyDrillCompleted`

**Evidencia:** El servicio lee la columna para decidir si acredita:

```ts
// :431-442
const [plan] = await tx.select({ pdtpActivityNumbers: preventionEmergencyPlans.pdtpActivityNumbers })
  .from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, drill.planId)).limit(1)
const activityNumbers = Array.isArray(plan?.pdtpActivityNumbers) ? plan.pdtpActivityNumbers : []
if (activityNumbers.length > 0) { accreditation = { ... } }
```

`grep -rn "pdtpActivityNumbers" --include=*.ts --include=*.tsx` sobre todo el repo devuelve, para emergencias, exactamente tres líneas: la definición del esquema (`emergency.ts:25`) y estas dos lecturas. No hay Server Action, ni formulario, ni script de seed que la escriba. La migración que la creó la dejó nullable sin default: `db/migrations/0109_medical_blob.sql:1` → `ALTER TABLE "prevention_emergency_plans" ADD COLUMN "pdtp_activity_numbers" jsonb;` (compárese con `0111_lyrical_moira_mactaggert.sql:17`, donde otra tabla sí recibe `DEFAULT '[85]'::jsonb NOT NULL`).

El conector existe y funciona (`lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts:258-276`), y su cabecera documenta el camino como vigente: "Emergencia/Simulacro → actividades pasadas explícitamente o configuradas en el plan de emergencia".

**Escenario:** 1. La faena A tiene el PDTP del año con la actividad de simulacro de emergencia entre sus obligaciones.
2. Se completa el simulacro con participantes y resultado satisfactorio.
3. `plan.pdtpActivityNumbers` es `NULL` (no hay forma de que sea otra cosa) → `activityNumbers = []` → `accreditation` queda `null` → `onEmergencyDrillCompleted` nunca se invoca (y aunque se invocara, retorna en su primera línea por `activityNumbers.length === 0`).
4. La cobertura del PDTP no registra el simulacro.

**Actual:** Ningún simulacro acredita nunca una actividad del PDTP. La rama completa (:434-442) es código muerto en producción, y el bloque `if (accreditation)` de :447 jamás se ejecuta.
**Esperado:** O bien el plan expone la configuración de actividades PDTP (campo en el formulario de creación/edición del plan, validado contra el catálogo de actividades), o bien el conector se llama con los números de actividad fijos del simulacro, como ya se hace con CPHS (`PDTP_CPHS_ACTIVITY_NUMBERS`) y con la revisión por la dirección (`PDTP_MANAGEMENT_REVIEW_ACTIVITY_NUMBER = 9`).
**Impacto:** Prevención tiene que marcar a mano en el PDTP una actividad que el sistema ya observó, con el riesgo de doble contabilidad o de olvido. El fallo es completamente silencioso: no hay log, no hay aviso, la operación devuelve éxito.
**Causa raíz:** El campo de configuración se agregó al esquema y el conector se cableó, pero la superficie que lo llena (formulario o constante) nunca se construyó — mismo patrón que EMERGENCIAS-04.
**Corrección:** Lo más barato y consistente con el resto del módulo: definir la constante `PDTP_EMERGENCY_DRILL_ACTIVITY_NUMBERS` junto a `PDTP_CPHS_ACTIVITY_NUMBERS` en `lib/services/pdtp/worksites.ts` y usarla como fallback cuando `plan.pdtpActivityNumbers` sea `NULL`. Si el número de actividad depende de la faena, entonces agregar el campo al formulario del plan y validarlo contra el catálogo. Si la vinculación se descarta, borrar la columna, la lectura :431-433 y el conector `onEmergencyDrillCompleted`.

**⚠️ Matiz del verificador:** El hecho es correcto: preventionEmergencyPlans.pdtpActivityNumbers no tiene ningun escritor. El grep completo del repo muestra escritores solo para campanas, cursos y plantillas de inspeccion; para emergencias aparecen unicamente emergency.ts:25 y las dos lecturas de :431-433. Verifique tambien los inserts de planes: scripts/seed-demo.ts:768-777 y capture-all-routes.ts:2180 no fijan el campo (el pdtpActivityNumbers:[63] de capture-all-routes:2054 es de una plantilla de inspeccion, no de un plan). Migracion 0109_medical_blob.sql:1 lo dejo nullable sin default. Pero el marco es exagerado: (a) no es un bug de comportamiento sino una rama inerte que degrada a no-op de forma segura (activityNumbers=[] y onEmergencyDrillCompleted retorna en su primera linea); (b) la cobertura PDTP del simulacro NO queda sin camino: existe el vinculo manual con sourceType 'emergencia' sobre el plan, admitido por el check SQL (risk-legal.ts:393) y el z.enum (validation/prevention-module/risk-legal.ts:166), y probado en lib/__tests__/pdtp-coverage-sources.test.ts:94-118 ('vincula un plan de emergencia aprobado y rechaza uno fuera de la faena autorizada'); (c) el propio diseno lo describe como configuracion declarativa pendiente: 'las N 83 a N 89 se resuelven declarando el numero, sin codigo nuevo' (docs/superpowers/specs/2026-08-12-pdtp-actividades-accionables-design.md:415). LOW.

---

## EMERGENCIAS-06 [LOW] — `executedAt` del simulacro no tiene cota: se acepta una fecha futura o anterior a la creación del propio simulacro
**Área:** Emergencias · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-emergency.ts:340-359,410-424; db/schema/prevention/emergency.ts:136-143` · **Componente:** `completeEmergencyDrill / completeDrillSchema`

**Evidencia:** El schema sólo exige formato:

```ts
// :343
executedAt: z.string().datetime({ offset: true }),
```

El `superRefine` (:355-359) sólo cubre la relación entre `outcome` y `targetDate`. El servicio escribe el valor sin compararlo con nada:

```ts
// :411-414
const [updated] = await tx.update(preventionEmergencyDrills).set({
  status: "completed",
  executedAt: data.executedAt,
```

No se compara contra `nowIso()` (que sí se calcula en :410 para `updatedAt`), ni contra `drill.scheduledFor`, ni contra `drill.createdAt`. Los CHECK de la tabla tampoco lo acotan: `prevention_emergency_drill_completed_consistent` (:141) sólo exige que `executed_at` y `outcome` no sean nulos cuando el estado es `completed`.

Mismo patrón con las métricas: `durationMinutes` y `evacuationSeconds` son `z.number().int().positive()` (:344-345), sin cota superior — un simulacro de 999.999 minutos es válido.

**Escenario:** 1. Un usuario con `drill_execute` completa un simulacro programado para el 2026-09-10.
2. Envía `executedAt: "2030-01-01T10:00:00.000Z"` (o `"2020-01-01T…"`, anterior incluso a la creación del simulacro).
3. La transacción pasa: `assessDrillCompletion` no mira fechas, el CAS de versión pasa, los CHECK de la tabla pasan.
4. La fila queda `status='completed'`, `executedAt=2030-01-01`.

**Actual:** El registro de ejecución del simulacro admite instantes imposibles. Como `executedAt` es lo que se pasa como `occurredAt` a la acreditación PDTP (:438) y lo que ordena la evidencia del cumplimiento, una fecha fuera de rango imputaría el simulacro a un período del programa que no corresponde (hoy enmascarado por EMERGENCIAS-05).
**Esperado:** `executedAt` debe estar acotado: no posterior al instante actual (con un margen mínimo de reloj) y no anterior a `drill.createdAt`. La auditoría previa ya fijó exactamente esta regla para las mediciones en `lib/services/prevention-permits.ts`.
**Impacto:** Evidencia legal con fecha arbitraria; métricas de evacuación sin techo que distorsionan cualquier promedio; imputación potencialmente errónea al período del PDTP.
**Causa raíz:** La validación de este servicio se concentró en las reglas de contenido (participantes, resultado, CAPA) y no en el rango temporal; `z.string().datetime()` valida forma, no dominio.
**Corrección:** En `completeEmergencyDrill`, tras cargar el `drill`: rechazar si `data.executedAt > nowIso()` ("Un simulacro no puede registrarse como ejecutado en el futuro.") y si `data.executedAt < drill.createdAt` ("La fecha de ejecución es anterior a la programación del simulacro."). Reutilizar el mismo mensaje/forma que ya usa el módulo de permisos para las mediciones futuras. Poner cota superior razonable a `durationMinutes` y `evacuationSeconds` en el schema (p. ej. `.max(1440)` y `.max(7200)`).

**⚠️ Matiz del verificador:** Las citas son exactas: 'executedAt: z.string().datetime({ offset: true })' (:343), el superRefine (:355-359) solo ata outcome con targetDate, el servicio escribe el valor sin comparar (:411-414) y el CHECK 'prevention_emergency_drill_completed_consistent' (emergency.ts:141) solo exige no-nulos. Tambien es cierto que el repo tiene la convencion en otros modulos (mediciones de higiene y permisos rechazan fecha futura, ver prevention-hygiene-calc.test.ts:163-166) y que servicios hermanos si validan orden de fechas (prevention-incidents.ts:140 'La hora de conocimiento no puede ser anterior a la ocurrencia'; prevention-cphs.ts:56). Pero MEDIUM no se sostiene: el camino normal usa datetime-local precargado con la hora actual (plan-detail.tsx:581 'setExecutedAt(toLocalInputValue(new Date()))'), quien completa ya tiene drill_execute sobre la faena, el registro queda auditado en prevention_emergency_history con beforeState/afterState, y la consecuencia es una fecha inverosimil en un acta propia, no corrupcion ni escalada. El apunte de durationMinutes/evacuationSeconds sin cota superior es un nitpick. LOW.

---

## EMERGENCIAS-07 [LOW] — La alerta de equipos de emergencia decide "vencido" con la fecha UTC, no con el día civil chileno
**Área:** Emergencias · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-attention.ts:45,252-270` · **Componente:** `getPreventionAttention / complianceAttentionItems`

**Evidencia:** ```ts
// lib/services/prevention-attention.ts:45
const today = new Date().toISOString().slice(0, 10)
```

Ese `today` es el que decide el tono y el título de cada ítem de equipo de emergencia:

```ts
// :252-270
const expired = row.expiresAt !== null && row.expiresAt <= soon
const dueDate = expired ? row.expiresAt : row.nextInspectionAt
if (!dueDate) continue
const overdue = dueDate < today
items.push({
  ...
  title: expired
    ? (overdue ? "Equipo de emergencia vencido" : "Equipo de emergencia por vencer")
    : (overdue ? "Inspección de equipo atrasada" : "Inspección de equipo por vencer"),
  ...
  tone: overdue ? "danger" : "warning",
})
```

Y también la ventana de 30 días: `const soon = addDaysIso(today, 30)` (:198, con `addDaysIso` en :176-180).

El repo ya tiene el helper correcto —`todayInChile()` en `lib/utils.ts:275-278`, sobre `chileDateParts`— y el propio módulo de emergencias usa una copia local equivalente para lo mismo (`lib/services/prevention-emergency.ts:34-38`, `Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" })`). Es decir, dos superficies que muestran el mismo dato usan dos nociones distintas de "hoy".

**Escenario:** 1. Un extintor tiene `nextInspectionAt = '2026-08-16'` (mañana, en calendario chileno).
2. Un usuario abre la portada de Prevención el 2026-08-15 a las 21:30 hora de Chile (UTC-3 en horario de verano).
3. `new Date().toISOString().slice(0,10)` devuelve `'2026-08-16'`.
4. `overdue = '2026-08-16' < '2026-08-16'` → `false`… pero para un equipo con fecha `'2026-08-15'` (hoy en Chile, todavía en plazo) el cálculo da `'2026-08-15' < '2026-08-16'` → `true`.
5. El equipo se pinta en rojo como "Inspección de equipo atrasada" un día antes de estarlo. El panel de emergencias, en cambio, usa `todayInChile()` (prevention-emergency.ts:540) y lo cuenta como al día.

**Actual:** Entre las ~20:00/21:00 y la medianoche de Chile, la portada de Prevención adelanta un día el vencimiento de los equipos de emergencia (y de los protocolos MINSAL, que comparten el mismo `today`), contradiciendo al panel del propio módulo, que sí usa el día civil chileno.
**Esperado:** `const today = todayInChile()` importado de `@/lib/utils`, y `addDaysIso` operando sobre esa fecha civil.
**Impacto:** Ítems marcados como vencidos antes de tiempo cada tarde-noche, y desacuerdo visible entre dos pantallas del mismo módulo. Es la clase de defecto que ya se corrigió a nivel de plataforma (ver la nota de zona horaria del repo) y que aquí quedó sin migrar.
**Causa raíz:** El archivo se escribió con `toISOString().slice(0,10)` antes de que `todayInChile()` fuera la convención, y no se barrió al normalizar. Nota de alcance: el archivo es compartido, así que el arreglo beneficia también a CAPA/PPA/CPHS, pero el consumidor auditado aquí es el de equipos de emergencia.
**Corrección:** Una línea: reemplazar `:45` por `const today = todayInChile()` (ya importable desde `@/lib/utils`). De paso, considerar reemplazar la copia local de `todayInChile` en `lib/services/prevention-emergency.ts:34-38` por el helper compartido, para que exista una sola definición.

**⚠️ Matiz del verificador:** Confirmado como violacion de convencion explicita del repo. prevention-attention.ts:45 es literalmente 'const today = new Date().toISOString().slice(0, 10)', y lib/utils.ts documenta lo contrario en el propio helper: 'Comparar esas columnas contra toISOString().slice(0,10) las mide en UTC y adelanta el corte del dia 3-4 horas: entre las 20:00 y la medianoche chilena, lo que vence hoy aparece vencido. Usa esto, no toISOString()'. El modulo de emergencias si usa dia civil chileno (prevention-emergency.ts:34-38 y :540-541), de modo que el panel y la portada discrepan. Rebajo a LOW: el efecto es de borde, entre ~20:00 y medianoche CLT, y solo cambia el titulo y el tono (danger vs warning) mas el orden por TONE_RANK; el item aparece igual en ambos casos porque la ventana de inclusion es 'soon = today+30'. No hay decision de negocio ni escritura de datos que dependa de ese valor.

---

## EMERGENCIAS-08 [LOW] — El bloque de vencimientos es todo-o-nada: `prevention:hygiene:view` por sí solo entrega los equipos de emergencia, y `prevention:emergency:view` entrega los protocolos de higiene
**Área:** Emergencias · **Categoría:** RBAC · **Confianza:** Alta
**Ubicación:** `app/(app)/prevencion/prevention-home.tsx:39-42; lib/services/prevention-attention.ts:103,193-250` · **Componente:** `getPreventionAttention / complianceAttentionItems`

**Evidencia:** La portada calcula un único booleano con un OR de dos permisos de módulos distintos:

```tsx
// prevention-home.tsx:39-42
// Reevaluaciones de protocolos MINSAL y equipos de emergencia vencidos:
// fechas que ya existían en la base y que ninguna pantalla leía.
includeCompliance: can(session, "prevention:hygiene:view") || can(session, "prevention:emergency:view"),
```

Y el servicio, con ese único flag, agrega las dos familias de ítems juntas:

```ts
// prevention-attention.ts:103
if (args.includeCompliance) items.push(...await complianceAttentionItems(scope, today, limit))
```

`complianceAttentionItems` (:193-250) consulta en paralelo `preventionProtocolApplicabilities` (higiene) y `preventionEmergencyResources` (emergencias) y las empuja a la misma lista, sin volver a discriminar por permiso. Compárese con las tres familias anteriores, que sí tienen un flag por permiso cada una (`includeActions`, `includeEvaluations`, `includePpa`, `includeCphs`, líneas 35-38).

**Escenario:** 1. Un usuario tiene `prevention:hygiene:view` pero NO `prevention:emergency:view` (perfil de higienista).
2. Abre `/prevencion`.
3. `includeCompliance` es `true` por la primera mitad del OR.
4. La portada le lista "Equipo de emergencia vencido · Extintor · Bodega de inflamables sector B" con nombre, tipo y ubicación del equipo y el nombre de la faena — datos del módulo de emergencias, al que no tiene acceso (si pincha el enlace `/prevencion/emergencias` recibe `/forbidden`).
5. El caso simétrico: un usuario sólo con `prevention:emergency:view` recibe las reevaluaciones de protocolos MINSAL de higiene.

**Actual:** Un permiso concede visibilidad sobre datos de otro módulo. El alcance de faena sí se respeta (el `scope` se aplica a las dos consultas), pero el alcance por módulo no.
**Esperado:** Dos flags independientes (`includeHygieneCompliance`, `includeEmergencyCompliance`), cada uno gobernando su propia consulta, siguiendo el patrón que el mismo archivo ya usa para las otras cuatro familias.
**Impacto:** Fuga de datos operativos entre módulos con RBAC granular; además genera enlaces que terminan en `/forbidden`, lo que se lee como un error del sistema. La sensibilidad es moderada (ubicación de equipos, aplicabilidad de protocolos por faena), no es dato médico.
**Causa raíz:** Las dos familias se agregaron en el mismo cambio ("fechas que ya existían y ninguna pantalla leía") y se agruparon bajo un solo parámetro por conveniencia, uniendo dos dominios de permiso con un OR.
**Corrección:** Partir `includeCompliance` en dos parámetros y devolver desde `complianceAttentionItems` sólo la familia pedida (o dividirla en dos funciones, `hygieneAttentionItems` y `emergencyResourceAttentionItems`, que es más limpio dado que ya son dos consultas independientes en el mismo `Promise.all`). En `prevention-home.tsx`, pasar `can(session, "prevention:hygiene:view")` y `can(session, "prevention:emergency:view")` por separado.

**⚠️ Matiz del verificador:** El codigo es como se cita: prevention-home.tsx:39-42 pasa 'includeCompliance: can(session, "prevention:hygiene:view") || can(session, "prevention:emergency:view")' y prevention-attention.ts:103 dispara con ese unico flag complianceAttentionItems, que consulta protocolos MINSAL y equipos de emergencia sin volver a discriminar (:200-233). Pero el escenario estrella del hallazgo es INALCANZABLE con el catalogo de roles enviado: en modules/prevention/manifest.ts todos los roles con prevention:hygiene:view (prevencionista, prevencionista_faena, cphs, jefe_terreno, jefa_chome, administrador, lineas 872-883) tienen tambien prevention:emergency:view (lineas 887-903). No existe el perfil 'higienista sin emergencias' salvo que alguien arme un rol a medida en /admin/roles. El caso realmente alcanzable es el simetrico e inverso al enunciado: admin_contrato tiene emergency:view sin hygiene:view y ve items de protocolos MINSAL cuyo enlace /prevencion/higiene le da /forbidden. Es sobre-exposicion intra-modulo de nombre/tipo/ubicacion de equipo mas un enlace muerto: LOW, no MEDIUM.

---

## EMERGENCIAS-10 [LOW] — Un simulacro programado no se puede cancelar ni reprogramar: el estado `cancelled` existe en el CHECK y en la UI pero ninguna acción lo escribe
**Área:** Emergencias · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `db/schema/prevention/emergency.ts:139; lib/services/prevention-emergency.ts:318-338; app/(app)/prevencion/emergencias/[planId]/plan-detail.tsx:293-299` · **Componente:** `scheduleEmergencyDrill / completeEmergencyDrill`

**Evidencia:** El CHECK admite tres estados:

```ts
// db/schema/prevention/emergency.ts:139
check("prevention_emergency_drill_status_valid", sql`${table.status} IN ('scheduled', 'completed', 'cancelled')`),
```

Las dos únicas escrituras de `status` son `"scheduled"` en el insert (:326-333, por defecto de columna) y `"completed"` en :412. No existe `cancelEmergencyDrill` ni ninguna acción que actualice `scheduledFor`. La UI, en cambio, ya tiene la rama de presentación lista y muerta: `plan-detail.tsx:284` y `emergency-list.tsx:225,247` renderizan `item.status === "cancelled" ? "outline" : …`, y `EMERGENCY_DRILL_STATUS_LABELS` declara `cancelled: "Cancelado"` (`lib/prevention/emergency.ts:28`).

En el detalle, la única acción disponible sobre un simulacro programado es completar:
```tsx
// plan-detail.tsx:295-297
{drill.status === "scheduled" && (
  <CompleteDrillDialog drill={drill} eligibleWorkers={eligibleWorkers} assignees={assignees} />
)}
```

**Escenario:** 1. Se programa un simulacro de incendio para el 2026-09-10.
2. La faena para por clima y el simulacro no se realiza; se reprograma en terreno para octubre.
3. En el sistema no hay forma de cancelarlo ni de mover la fecha: la única salida es completarlo con datos falsos, o programar un segundo simulacro y dejar el primero colgado.
4. El primero queda en `scheduled` para siempre, contando en `totalDrills` y ensuciando la lista.

**Actual:** Los simulacros que no se ejecutan se acumulan indefinidamente en estado `scheduled`, sin trazabilidad de por qué no ocurrieron, y hay tres ramas de UI que nunca se pueden ver.
**Esperado:** Una acción `cancelEmergencyDrill` con permiso `prevention:emergency:drill_execute`, CAS sobre `version`, motivo obligatorio e historial (`changeType: "cancelled"`), y opcionalmente reprogramación de un simulacro aún `scheduled`.
**Impacto:** Bajo en integridad (no corrompe nada), medio en usabilidad y en calidad del registro: la evidencia de por qué una faena no ejecutó un simulacro programado no queda en ninguna parte.
**Causa raíz:** El estado se previó en el esquema y en las etiquetas de la UI, y la acción no se escribió — el mismo patrón que EMERGENCIAS-02 con `archived`.
**Corrección:** Copiar la forma de `completeEmergencyDrill` (:367-450) recortada: cargar el simulacro, `requireAccess(..., "prevention:emergency:drill_execute", drill.worksiteId)`, exigir `status === "scheduled"`, CAS sobre `version`, `reason` obligatorio en el payload y fila en `preventionEmergencyHistory`. Sin CAPA ni participantes.

---

## LEGAL-03 [LOW] — La vigencia del requisito (validFrom/validTo) es decorativa: ninguna consulta la lee, la interfaz no permite fijar validTo y no existe transición para retirar un requisito publicado
**Área:** Requisitos legales · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `db/schema/prevention/risk-legal.ts:300-301, lib/services/prevention-risk-legal.ts:540, app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx:47` · **Componente:** `preventionLegalRequirements / LEGAL_TRANSITIONS / CreateRequirementDialog`

**Evidencia:** Las columnas existen y son obligatorias/opcionales:
```
validFrom: text("valid_from").notNull(),
validTo: text("valid_to"),
```
Grep en todo el repo de `validTo`/`valid_to` fuera de pruebas devuelve exactamente tres usos, todos de escritura o presentación: el zod (`validation/.../risk-legal.ts:108`), la escritura en el insert (`prevention-risk-legal.ts:524`), el hash de publicación (`:558`) y la columna del Excel (`export/route.ts:23`). Ninguna consulta lo compara con una fecha. Lo mismo con `validFrom`. Las transiciones no tienen salida desde publicado:
```
const LEGAL_TRANSITIONS: Record<string, readonly string[]> = { draft: ["in_review"], in_review: ["reviewed"], reviewed: ["approved"], approved: ["published"] }
```
Y el formulario de creación no envía `validTo` en absoluto (workbench.tsx:47), ni existe ningún otro formulario o acción que lo actualice — no hay acción de edición de requisito en actions.ts.

**Escenario:** 1. Se registra un requisito contractual con vigencia hasta 2026-12-31 (o simplemente se publica uno y luego la norma se deroga sin norma sustitutiva).
2. Llega el 2027-01-01 (o la fecha de derogación).
3. Se abre el registro legal y se exporta.

**Actual:** El requisito sigue apareciendo como "Vigente" en el KPI y en la lista, se le pueden seguir proponiendo aplicabilidades y evaluando cumplimiento, y sigue ofreciéndose como fuente de cobertura PDTP. No hay ninguna manera —ni por interfaz ni por acción de servidor— de fijarle `validTo` ni de sacarlo de `published`, porque la única salida del estado publicado es que otra versión lo supere (y esa vía tiene el problema de LEGAL-02).
**Esperado:** Un requisito cuya vigencia terminó no debería contarse como vigente ni admitir nuevas evaluaciones de cumplimiento; y debe existir un camino explícito para declarar el fin de vigencia de una obligación que no se reemplaza por otra.
**Impacto:** La organización arrastra obligaciones derogadas en su registro y no puede acreditar el control de vigencia que exige el DS 44; a la inversa, un requisito con `validFrom` futuro se cuenta como vigente desde que se publica. Es una brecha funcional, no sólo estética, porque el conteo de "vigentes" y las brechas asociadas quedan mal.
**Causa raíz:** Se modeló el dato de vigencia pero no la regla que lo consume ni el camino de retiro; el ciclo de vida se cerró en 'published' como estado terminal implícito.
**Corrección:** Mínimo viable: (1) filtrar por vigencia donde ya se filtra por estado — en `getLegalDashboard` y en la lista de `sourceOptions.legalRequirements` de `getPdtpCoverage` (:930-938), añadir `sql\`${preventionLegalRequirements.validFrom} <= ${todayInChile()} AND (${preventionLegalRequirements.validTo} IS NULL OR ${preventionLegalRequirements.validTo} >= ${todayInChile()})\``, y rechazar en `proposeLegalApplicability` y `assessLegalCompliance` un requisito fuera de vigencia; (2) añadir el campo `validTo` (DatePicker, ya usado en el mismo formulario) al diálogo de creación y un CHECK `valid_to IS NULL OR valid_to >= valid_from` como el que ya existe en `pdtp_programs_validity_check` (db/schema/prevention/pdtp.ts:69).

**⚠️ Matiz del verificador:** Every fact checks out, but this is a missing lifecycle feature rather than a malfunction, and it is the same underlying gap as LEGAL-02 counted twice.

VERIFIED: schema :300-301 `validFrom: text("valid_from").notNull(), validTo: text("valid_to")`. A repo-wide grep for validTo|valid_to outside tests/migrations returns only writes and presentation: validation/risk-legal.ts:108, service :524 (insert), :558 (publication hash), export/route.ts:23 (Excel column). No query compares either column to a date. `LEGAL_TRANSITIONS` at :540 is literally `{ draft: ["in_review"], in_review: ["reviewed"], reviewed: ["approved"], approved: ["published"] }` — no key for `published` or `superseded`, so a published requirement can only leave that state as a side effect of another version's publication (:560-584), which the UI cannot trigger. actions.ts exports only create/transition/propose/approve/assess — no update action, and workbench.tsx:47 omits validTo.

QUALIFICATION: nothing computes a wrong number from this; the observable consequence is a stale 'Vigente' badge on a derogated norm. There is no path by which a user even records a validTo today, so the 'la vigencia es decorativa' framing is right but the impact is a feature gap, not MEDIUM-grade breakage.

---

## LEGAL-04 [LOW] — El índice único de aplicabilidad no protege el caso más común (proceso nulo = "Toda la faena"): dos propuestas simultáneas crean filas duplicadas para el mismo requisito y faena
**Área:** Requisitos legales · **Categoría:** Concurrencia · **Confianza:** Alta
**Ubicación:** `db/schema/prevention/risk-legal.ts:347-353, db/migrations/0076_equal_menace.sql:384, lib/services/prevention-risk-legal.ts:607-628` · **Componente:** `proposeLegalApplicability / prevention_legal_applicabilities_requirement_scope_unique`

**Evidencia:** El índice es un único btree ordinario sobre tres columnas, una de ellas anulable:
```
uniqueIndex("prevention_legal_applicabilities_requirement_scope_unique").on(table.requirementId, table.worksiteId, table.processId),
```
y en la migración se creó sin cláusula alguna sobre nulos: `CREATE UNIQUE INDEX "prevention_legal_applicabilities_requirement_scope_unique" ON "prevention_legal_applicabilities" USING btree ("requirement_id","worksite_id","process_id");`. En PostgreSQL los NULL son distintos entre sí en un índice único salvo `NULLS NOT DISTINCT`, que no está. `process_id` es NULL exactamente en el caso por defecto de la interfaz: el selector "Proceso opcional" ofrece "Toda la faena" y envía `processId: v.get("processId") || null` (workbench.tsx:80). La unicidad se apoya entonces sólo en un SELECT previo sin bloqueo:
```
const existingConditions = [eq(...requirementId, data.requirementId), eq(...worksiteId, data.worksiteId), data.processId ? eq(...processId, data.processId) : isNull(...processId)]
const [existing] = await tx.select().from(preventionLegalApplicabilities).where(and(...existingConditions)).limit(1)
...
const [saved] = existing ? await tx.update(...) : await tx.insert(...)
```
Sin `for('update')` y sin ordenar el `limit(1)`.

**Escenario:** 1. Dos prevencionistas (o un doble envío del mismo formulario, o un reintento del cliente) proponen la aplicabilidad del requisito R para la faena A con "Toda la faena" casi a la vez.
2. Ambas transacciones ejecutan el SELECT en READ COMMITTED y ninguna encuentra fila previa.
3. Ambas ejecutan el INSERT; el índice único no las bloquea porque `process_id` es NULL en las dos.

**Actual:** Quedan dos filas de aplicabilidad para el mismo requisito y la misma faena. Ambas aparecen en el KPI "Aplicables", ambas exigen aprobación por separado, ambas pueden evaluarse con resultados distintos (una `compliant`, otra `noncompliant`), y las propuestas posteriores actualizan una de las dos al azar porque el `limit(1)` no tiene `orderBy`. En `getPdtpCoverage` la consulta de fuentes legales (:930-938) devuelve el requisito duplicado en el desplegable.
**Esperado:** Una sola decisión de aplicabilidad por (requisito, faena, proceso), con el proceso nulo tratado como un valor más; la segunda escritura concurrente debe fallar contra la restricción, no crear un duplicado.
**Impacto:** Contradicción interna del registro legal (la misma obligación cumplida y no cumplida a la vez en la misma faena) y conteos inflados en el tablero y en el Excel. Además el propio índice da una falsa sensación de que el invariante está protegido en la base.
**Causa raíz:** Se confió la unicidad a un índice único sobre una columna anulable, asumiendo semántica NULLS NOT DISTINCT, y el código complementa con un SELECT-luego-INSERT sin bloqueo de fila.
**Corrección:** Reemplazar el índice por uno que trate el nulo como valor: `uniqueIndex(...).on(table.requirementId, table.worksiteId, sql\`coalesce(${table.processId}, '')\`)` (o `NULLS NOT DISTINCT` si el Postgres de producción es >=15), con su migración; y de paso convertir el par SELECT/INSERT en un `onConflictDoUpdate` sobre esa restricción, que elimina la carrera sin añadir bloqueos. Antes de aplicar la migración hay que deduplicar filas existentes.

**⚠️ Matiz del verificador:** The Postgres semantics claim is correct and I confirmed the DDL, but the reachable failure is a narrow two-actor race, not the 'caso más común'.

VERIFIED: schema :348 `uniqueIndex("prevention_legal_applicabilities_requirement_scope_unique").on(table.requirementId, table.worksiteId, table.processId)` with `processId: text("process_id").references(...)` (nullable, :331). db/migrations/0076_equal_menace.sql:384 emits it with no NULLS NOT DISTINCT clause; the only NULLS NOT DISTINCT in the whole migration set is db/migrations/0024_strong_polaris.sql:17 for pdtp_sheets, proving the team knows the modifier and did not use it here. `proposeLegalApplicability` (:607-628) does `select(...).where(and(...isNull(preventionLegalApplicabilities.processId)))` then branches to update-or-insert with no `for('update')`.

QUALIFICATION: the sequential case — the overwhelmingly common one — is handled correctly by that SELECT, so no duplicate arises from normal use. The failure needs two transactions interleaved inside the same READ COMMITTED window; the double-submit variant the finding offers is blocked client-side (`<Button type="submit" disabled={operation.pending}>`, workbench.tsx:81) and server actions are not auto-retried. Consequence is a duplicate register row, not corruption or a lost obligation.

---

## LEGAL-05 [LOW] — Una brecha se puede declarar cumplida mientras su CAPA sigue abierta, y la CAPA queda huérfana del registro legal
**Área:** Requisitos legales · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-legal.ts:666-710, lib/services/prevention-risk-legal.ts:893` · **Componente:** `assessLegalCompliance / getLegalDashboard`

**Evidencia:** La evaluación sólo comprueba estado de aplicabilidad y versión; no mira las evaluaciones ni las CAPA anteriores:
```
if (item.applicabilityStatus !== "applicable") throw new Error("Sólo un requisito aplicable y aprobado puede evaluarse.")
if (item.version !== data.expectedVersion) throw new Error("La aplicabilidad cambió mientras la revisabas.")
let capaActionId: string | null = null
if (data.status === "partial" || data.status === "noncompliant") { ... crea CAPA ... }
```
Para `compliant` el único requisito adicional es texto de evidencia de 3 caracteres (validation :157). Nada consulta `preventionLegalAssessments` previos ni el estado de `preventionCapaActions`. En sentido inverso tampoco hay realimentación: grep de `legal_requirement` en lib/services/prevention-capa.ts devuelve únicamente el enum de `sourceType` (:56) — cerrar o cancelar la CAPA no toca la aplicabilidad. Y la brecha desaparece del tablero en cuanto el estado cambia: `applicability.applicabilityStatus === "applicable" && (applicability.complianceStatus !== "compliant" || !applicability.evidenceReference)` (:893).

**Escenario:** 1. Se evalúa el requisito R en la faena A como `noncompliant`; se crea la CAPA C con fecha objetivo a 30 días.
2. Al día siguiente, la misma persona (o cualquiera con `prevention:legal:assess` sobre la faena) vuelve a evaluar el mismo requisito como `compliant` escribiendo cualquier texto en "Evidencia".
3. La CAPA C sigue en estado `pending`, sin evidencia y sin verificar.

**Actual:** La aplicabilidad pasa a `compliant`, desaparece de la pestaña Brechas y de la hoja "Brechas" del Excel, y el KPI "Con evidencia y cumplimiento" sube. La CAPA C queda abierta en el módulo CAPA sin ninguna referencia visible desde el registro legal (la aplicabilidad no guarda el `capaActionId`; sólo lo guarda la fila histórica de evaluación).
**Esperado:** No se debería poder declarar cumplido un requisito que tiene una CAPA abierta derivada de su última evaluación de brecha; o, como mínimo, el cierre debe exigir que esa CAPA esté verificada/cerrada, o registrar explícitamente que se cierra sin ella.
**Impacto:** Permite blanquear el registro legal sin resolver la causa: exactamente la debilidad que un fiscalizador busca. El módulo pierde la trazabilidad brecha→CAPA→cierre que justifica haber creado la CAPA en la misma transacción.
**Causa raíz:** El ciclo brecha→CAPA→cierre se implementó como dos escrituras independientes en el tiempo, sin ninguna guarda que lea la CAPA de la evaluación anterior al momento de re-evaluar.
**Corrección:** En `assessLegalCompliance`, antes de aceptar `status === 'compliant'`, buscar la última evaluación de la aplicabilidad con `capaActionId` no nulo (`preventionLegalAssessments` ya tiene índice por `(applicability_id, assessed_at)`) y, si esa CAPA no está en `verified`/`closed`/`cancelled`, rechazar con un mensaje explícito. Reutilizar el cliente de transacción para leer `preventionCapaActions.status` — no hace falta helper nuevo.

**⚠️ Matiz del verificador:** The mechanical observation is true; the 'CAPA huérfana' framing is false and the harm is much smaller than stated.

VERIFIED: `assessLegalCompliance` (:666-710) guards only `item.applicabilityStatus !== "applicable"` and `item.version !== data.expectedVersion`; it never reads `preventionLegalAssessments` or `preventionCapaActions`. For `compliant` the extra bar is validation/risk-legal.ts:157 `if (value.status === "compliant" && (value.evidenceReference?.length ?? 0) < 3)`.

REFUTED PART: the CAPA is not orphaned. It is created with `sourceType: "legal_requirement", sourceId: item.requirementId, sourceItemId: item.id` (:679-681) into the single CAPA engine, and `listCapaActions`/`listCapaActionsPage` (lib/services/prevention-capa.ts:600-655) expose it unfiltered by source in /prevencion/capa plus the dashboard prevention section — with its own overdue quick-filter. So the corrective action keeps its own clock and owner; it simply is not mirrored back into the legal register, which is the documented single-CAPA-engine architecture. Adding a guard that blocks a `compliant` re-assessment while a CAPA is open would also forbid the legitimate sequence (fix and record evidence first, close/verify the CAPA afterwards). What remains is a real but minor register-hygiene hole: the exported legal register can read 'Cumple' while the linked action is still pending.

---

## LEGAL-06 [LOW] — Las fechas de re-evaluación y de vencimiento de evidencia se guardan y se exportan pero nada las vigila: no hay obligación periódica efectiva
**Área:** Requisitos legales · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `db/schema/prevention/risk-legal.ts:338, db/schema/prevention/risk-legal.ts:364, lib/services/prevention-risk-legal.ts:883-895` · **Componente:** `preventionLegalApplicabilities.evidenceDueAt / preventionLegalAssessments.nextAssessmentAt / getLegalDashboard`

**Evidencia:** Ambas columnas existen (`evidenceDueAt: text("evidence_due_at")`, `nextAssessmentAt: text("next_assessment_at")`), la interfaz las captura (workbench.tsx:81 "Fecha límite de evidencia" y :93 "Próxima evaluación") y el servicio las escribe (:618 y :703). El grep completo del repo por `nextAssessmentAt|next_assessment_at` y `evidenceDueAt|evidence_due_at` fuera de pruebas no devuelve ni una sola LECTURA con comparación de fechas: sólo el schema, el zod, las dos escrituras, las dos columnas del Excel y los formularios. `getLegalDashboard` (:885-894) no las consulta ni las usa para clasificar. Contrasta con el mecanismo que sí existe para el reloj PDTP en el mismo archivo: `refreshPdtpUpdateObligationDeadlines` (:831-833) marca `overdue` comparando `dueAt < todayInChile()` — pero se invoca únicamente desde `getPdtpCoverage` (:899), nunca desde el módulo legal, y no cubre estas dos fechas.

**Escenario:** 1. Se aprueba la aplicabilidad de un requisito con "Fecha límite de evidencia" 2026-08-20.
2. Se evalúa `compliant` fijando "Próxima evaluación" 2026-09-01 (el campo `frequency` del requisito dice "Anual y por disparador").
3. Pasan el 20 de agosto y el 1 de septiembre sin que nadie actúe.

**Actual:** Nada cambia en ninguna pantalla: la aplicabilidad sigue mostrándose como cumplida, no aparece en Brechas (la brecha sólo mira `complianceStatus` y la existencia de texto de evidencia, :893), no hay KPI de vencidas, no hay tarea ni recordatorio, y sólo se detecta abriendo el Excel y comparando fechas a mano.
**Esperado:** Una evaluación de cumplimiento cuya fecha de próxima evaluación ya pasó debe dejar de contar como cumplimiento vigente (o al menos aparecer marcada como vencida), igual que el reloj de 30 días del PDTP pasa a `overdue`.
**Impacto:** La obligación de evaluación periódica del cumplimiento legal —que es justamente lo que el campo `frequency` del requisito declara— no está sostenida por ningún mecanismo: el registro puede mostrar 100% de cumplimiento con evaluaciones de hace tres años.
**Causa raíz:** Se capturó el dato de periodicidad sin implementar el cálculo de vencimiento ni ningún consumidor; el patrón correcto ya existe a 40 líneas de distancia (`refreshPdtpUpdateObligationDeadlines`) pero no se aplicó al dominio legal.
**Corrección:** Sin tabla ni cron nuevos: en `getLegalDashboard`, traer por aplicabilidad la última evaluación (ya se consultan todas en :892) y añadir al conjunto `gaps` las aplicables cuya última evaluación tenga `nextAssessmentAt < todayInChile()`, más las que tengan `evidenceDueAt < todayInChile()` sin `evidenceReference`. Es una condición añadida al filtro que ya existe en :893, y el workbench y el Excel la heredan gratis porque ambos consumen `dashboard.gaps`.

**⚠️ Matiz del verificador:** Half of this is genuinely uncovered; the other half is already covered by the standing gap rule the auditor quotes.

VERIFIED: schema :338 `evidenceDueAt: text("evidence_due_at")` and :364 `nextAssessmentAt: text("next_assessment_at")`; the only non-test occurrences repo-wide are validation :133/:148, the two writes (:618, :703), the two Excel columns (export/route.ts:26 and :29) and the two DatePickers (workbench.tsx:81, :93). No date comparison anywhere, and `refreshPdtpUpdateObligationDeadlines` (:831-833, `sql`${preventionPdtpUpdateObligations.dueAt} < ${todayInChile()}`) is only called from `getPdtpCoverage` (:899).

REFUTED PART: the `evidenceDueAt` half does not produce the alleged silence. The gap rule at :893 is `applicabilityStatus === "applicable" && (complianceStatus !== "compliant" || !evidenceReference)`, so an approved applicable row without evidence is already a permanent entry in the Brechas tab and the Brechas sheet from the moment it is approved — the missing-evidence obligation never goes unwatched, with or without a due date. Only the `nextAssessmentAt` half is a real hole: a row assessed `compliant` with evidence never re-enters the gap list when its next-assessment date passes, so the register can report full compliance on stale evidence.

---

## LEGAL-07 [LOW] — supersedesRequirementId no tiene clave foránea ni validación de que el código coincida: un requisito puede superar a otro sin relación
**Área:** Requisitos legales · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `db/schema/prevention/risk-legal.ts:307, lib/services/prevention-risk-legal.ts:503-508, lib/services/prevention-risk-legal.ts:560-584` · **Componente:** `preventionLegalRequirements.supersedesRequirementId / createLegalRequirementDraft / transitionLegalRequirement`

**Evidencia:** La columna es texto suelto, sin `.references()`, a diferencia de todas las demás relaciones de la tabla:
```
supersedesRequirementId: text("supersedes_requirement_id"),
publishedHashSha256: text("published_hash_sha256"),
createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
```
Y la validación del origen sólo comprueba que esté publicado, nunca que sea el mismo código:
```
const sourceRows = await tx.select().from(preventionLegalRequirements).where(and(eq(preventionLegalRequirements.id, data.sourceRequirementId), eq(preventionLegalRequirements.status, "published"))).limit(1)
source = sourceRows[0] ?? null
if (!source) throw new Error("El requisito fuente no está publicado.")
```
Al publicar, la supersesión se ejecuta sin volver a comparar nada: `if (previous?.status === "published") { ...set({ status: "superseded" ...}) }` (:562-570).

**Escenario:** 1. Un usuario con `prevention:legal:assess` crea el requisito con código "OTRO-ART1" y pasa como `sourceRequirementId` el id del requisito publicado "DS44-ART7" (por error de copiar/pegar de un id, o llamando directamente a la Server Action).
2. El borrador recorre revisión y aprobación —los revisores ven el texto nuevo, no el vínculo de supersesión, que no se muestra en ninguna pantalla.
3. Se publica.

**Actual:** DS44-ART7 pasa a `superseded` por un requisito de otro código: desaparece de las fuentes legales del PDTP (:937 filtra por `published`) y deja de estar vigente, sin que nadie lo haya decidido. Además, como no hay FK, un `supersedes_requirement_id` puede apuntar a un id inexistente sin que la base lo impida.
**Esperado:** Sólo una versión del MISMO código debería poder superar a otra, y la columna debería tener FK autorreferencial para impedir referencias huérfanas.
**Impacto:** Bajo en probabilidad (requiere pasar un id ajeno) pero alto en efecto: retira silenciosamente una obligación vigente del registro. Lo agrava que la supersesión no se muestra en la interfaz de revisión, así que el control segregado no puede detectarla.
**Causa raíz:** El vínculo de versión se modeló como texto libre y su regla de negocio (mismo código) quedó implícita.
**Corrección:** Añadir `.references((): AnyPgColumn => preventionLegalRequirements.id, { onDelete: "set null" })` a la columna (el archivo ya importa `AnyPgColumn` en el servicio; en el schema se usa el patrón de autorreferencia habitual de Drizzle) y una línea en `createLegalRequirementDraft`: `if (source.code !== data.code) throw new Error("Una nueva versión debe compartir el código del requisito que reemplaza.")`. Mostrar además el vínculo "reemplaza a" en la ficha del requisito para que el revisor lo vea.

---

## LEGAL-09 [LOW] — La ficha del requisito muestra el estado de cumplimiento en inglés crudo para las aplicabilidades no aplicables
**Área:** Requisitos legales · **Categoría:** Otro · **Confianza:** Alta
**Ubicación:** `app/(app)/prevencion/requisitos-legales/[id]/page.tsx:25-30, app/(app)/prevencion/requisitos-legales/[id]/page.tsx:42` · **Componente:** `LegalRequirementDetailPage / COMPLIANCE_STATUS`

**Evidencia:** El diccionario de la página de detalle no incluye el valor `not_applicable`, que sí es un estado real de la columna:
```
const COMPLIANCE_STATUS: Record<string, string> = {
  not_assessed: "Sin evaluar",
  compliant: "Cumple",
  partial: "Cumplimiento parcial",
  noncompliant: "No cumple",
}
```
y se renderiza con caída al valor crudo y variante de advertencia:
```
<Badge variant={applicability.complianceStatus === "compliant" ? "success" : "warning"}>{COMPLIANCE_STATUS[applicability.complianceStatus] ?? applicability.complianceStatus}</Badge>
```
`approveLegalApplicability` fija exactamente ese valor cuando la decisión es no aplicable: `const complianceStatus = finalStatus === "not_applicable" ? "not_applicable" : "not_assessed"` (servicio :645). El diccionario del workbench (legal-requirements-workbench.tsx:24) sí lo traduce, así que la inconsistencia es sólo de esta pantalla.

**Escenario:** 1. Se aprueba una decisión de "No aplicable" para la faena B.
2. Se abre /prevencion/requisitos-legales/{id}.

**Actual:** La tarjeta de la faena B muestra una insignia ámbar con el texto literal "not_applicable" junto a la insignia correcta "No aplicable".
**Esperado:** Texto en español ("No aplica") y variante neutra, no de advertencia: una no aplicabilidad aprobada no es un pendiente.
**Impacto:** Cosmético, pero es una pantalla que se enseña a fiscalizadores y auditores de certificación; el término en inglés y el color ámbar sugieren un problema donde hay una decisión formalmente aprobada.
**Causa raíz:** Diccionario de etiquetas duplicado en dos archivos con contenidos distintos; el de la ficha se quedó sin el valor añadido después.
**Corrección:** Exportar el mapa `STATUS` que ya existe en legal-requirements-workbench.tsx:24 (o moverlo a un módulo compartido, p. ej. junto al resto de etiquetas de prevención) y consumirlo desde la ficha, en lugar de mantener dos diccionarios.

---

## MIPER-07 [LOW] — `committeeMeetingId` de la matriz se acepta sin verificar faena ni estado de la sesión, y ninguna pantalla lo envía, pese a que la certificación Oro lo cuenta
**Área:** MIPER · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-legal.ts:210; lib/validation/prevention-module/risk-legal.ts:21-23; lib/services/prevention-cphs-certification.ts:326` · **Componente:** `createRiskMatrixDraftWithClient`

**Evidencia:** El campo entra sin ninguna comprobación (prevention-risk-legal.ts:210): `committeeMeetingId: data.committeeMeetingId ?? null`. El esquema sólo exige que sea una cadena (validation:23 `committeeMeetingId: z.string().min(1).nullable().optional()`), a diferencia de los demás referidos del mismo método, que sí se verifican (worksite activo y metodología activa en las líneas 177-182, matriz fuente por faena y estado en la 186, lote de importación por faena y estado en la 191-196).

La FK sólo garantiza existencia global (db/schema/prevention/risk-legal.ts:89 `references(() => preventionCommitteeMeetings.id)`), y `prevention_committee_meetings` no tiene `worksiteId`: cuelga de `committeeId` (db/schema/prevention/cphs.ts:158), así que la pertenencia a la faena exige un join que aquí no se hace. Tampoco se exige que la sesión esté realizada (`status`/`heldAt`, cphs.ts:161,169).

El comentario del esquema declara el propósito (risk-legal.ts:86-88): "`participation_summary` es texto libre y sirve para describir; esto la vuelve verificable, que es lo que exige la certificación Mutual para acreditar participación del CPHS".

La certificación lo cuenta tal cual (prevention-cphs-certification.ts:326): `iperRevisionsWithCommittee: periodIper.filter((row) => row.committeeMeetingId !== null).length`.

Y ninguna UI lo envía: grep de `committeeMeetingId` sólo devuelve el esquema, el servicio, la certificación y la definición de tabla; el diálogo de creación (miper-workbench.tsx:100-103) no lo incluye.

**Escenario:** 1. Un usuario con `prevention:risk:edit` en la faena A invoca `createRiskMatrixDraftAction` con `worksiteId: "A"` y `committeeMeetingId` de una sesión del comité de la faena C —o de una sesión de la propia faena A que está sólo `scheduled` y nunca se realizó.
2. La matriz se crea y avanza el circuito hasta publicarse.
3. Se calcula el panel de certificación CPHS.

**Actual:** La matriz queda acreditada como "revisada en sesión del comité paritario" contra una sesión de otra faena o contra una reunión que nunca ocurrió, y `iperRevisionsWithCommittee` sube. Por el otro lado, un equipo que SÍ revisó la matriz en su comité no puede acreditarlo: no hay campo en el formulario, así que el indicador sólo puede alcanzarse llamando al Server Action a mano.
**Esperado:** La sesión referida debe pertenecer al comité de la misma faena y estar realizada (`held`/`closed`); y debe existir un selector en el formulario para elegirla legítimamente.
**Impacto:** El único dato verificable de participación del CPHS en la MIPER —la pieza que la certificación Mutual pide— es a la vez falsificable a través de faenas e inalcanzable desde la aplicación. El indicador de certificación no mide lo que dice medir.
**Causa raíz:** El campo se agregó al esquema y a la métrica de certificación sin cerrar ni la validación de pertenencia en el servicio ni el cableado en la UI.
**Corrección:** En `createRiskMatrixDraftWithClient`, si viene `committeeMeetingId`, resolverlo con join a `preventionCommittees` y exigir `preventionCommittees.worksiteId === data.worksiteId` y un estado de sesión realizado, lanzando el mismo error de "fuera de alcance" que usan los demás referidos. Añadir el selector de sesión al diálogo "Nueva versión" (limitado a las sesiones cerradas del comité de la faena elegida).

**⚠️ Matiz del verificador:** Both facts check out but the security scenario is barely reachable; the real residue is a dead metric. Confirmed: `prevention-risk-legal.ts:210` is a bare `committeeMeetingId: data.committeeMeetingId ?? null` with no join, in the same function that DOES verify worksite active + methodology active (:177-182), source matrix by worksite+status (:186) and import batch by worksite+status (:191-196); `prevention_committee_meetings` hangs off `committeeId` with no `worksiteId` (cphs.ts:158) so the FK proves nothing about the faena; and repo-wide grep for `committeeMeetingId` returns only validation:23, service:210, cphs-certification.ts:202,326 and the table definition — no UI ever sends it. Consequence in practice: since nothing writes the column, `iperRevisionsWithCommittee: periodIper.filter((row) => row.committeeMeetingId !== null).length` (certification:326) is permanently 0 — the certification credit is unreachable, which is the opposite of the alleged inflation. The forgery path needs direct Server-Action invocation plus a committee-meeting id from a faena the caller cannot list, so it is a latent validation gap, not a live one.

---

## MIPER-09 [LOW] — La fecha "hoy" de la pantalla MIPER se calcula en UTC y se usa como vigencia por defecto al publicar y como umbral de vencimiento
**Área:** MIPER · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `app/(app)/prevencion/miper/page.tsx:30; app/(app)/prevencion/miper/miper-workbench.tsx:172,204; lib/__tests__/miper-ui-contract.test.ts:13` · **Componente:** `MiperPage / MatrixTransition`

**Evidencia:** app/(app)/prevencion/miper/page.tsx:30
```
  const today = new Date().toISOString().slice(0, 10)
```
se pasa al workbench y se usa (a) como umbral de atraso de los disparadores (miper-workbench.tsx:172): `<Badge variant={trigger.dueAt < today ? "danger" : "warning"}>` y (b) como valor por defecto de la fecha de vigencia al publicar (miper-workbench.tsx:204): `{next[0] === "published" && <Field label="Vigente desde"><DatePicker name="effectiveFrom" defaultValue={today} /></Field>}`, que se envía siempre en el payload de `transitionRiskMatrixAction`.

Ese valor gana sobre el cálculo correcto del servidor: `const effectiveFrom = data.effectiveFrom ?? todayInChile()` (prevention-risk-legal.ts:399) — el fallback en hora de Chile sólo actúa si el cliente NO manda la fecha, y el formulario siempre la manda.

De ahí se derivan dos plazos legales: `const reviewDueAt = addDays(effectiveFrom, 365)` (línea 400) y `dueAt: addDays(effectiveFrom, 30)` para la obligación PDTP (línea 452).

El repo ya tiene el helper correcto y estable para SSR: lib/utils.ts:275 `export function todayInChile(...)`, y el propio servicio mantiene una copia local (prevention-risk-legal.ts:83-87). El test de contrato fija hoy la versión incorrecta: lib/__tests__/miper-ui-contract.test.ts:13 `expect(page).toContain("const today = new Date().toISOString().slice(0, 10)")`.

**Escenario:** 1. Es el 15 de enero a las 22:30 en Chile (UTC-3 en horario de verano); en UTC ya es el 16.
2. La jefatura abre /prevencion/miper y publica la versión aprobada aceptando la vigencia por defecto.

**Actual:** `effectiveFrom` se guarda como 2026-01-16 —un día que aún no comienza en Chile—, `reviewDueAt` queda en 2027-01-16 y el reloj PDTP en 2026-02-15; el acta y el export declaran una vigencia posterior a la publicación real. En el mismo tramo horario, los disparadores que vencen hoy en Chile ya se pintan como atrasados.
**Esperado:** `effectiveFrom` por defecto y el umbral de vencimiento deben ser el día civil chileno (`todayInChile()`), consistente con el resto de los plazos del módulo.
**Impacto:** Corrimiento de un día en la vigencia declarada de la MIPER y en los dos plazos legales que se derivan de ella (revisión anual y actualización del PDTP en 30 días), en la ventana horaria en que efectivamente se trabaja en faena. Es exactamente la clase de error que este código base ya corrigió en otros módulos.
**Causa raíz:** Se necesitaba una fecha estable entre SSR e hidratación y se resolvió con `toISOString()` en vez del helper de día civil chileno, que es igual de estable.
**Corrección:** Sustituir por `const today = todayInChile()` (import desde @/lib/utils) en page.tsx y actualizar la aserción de lib/__tests__/miper-ui-contract.test.ts:13 para que exija `todayInChile()` — el contrato que ese test quiere proteger (una única fecha del servidor pasada por props) se conserva. Ya que se toca, considerar acotar `effectiveFrom` en `riskMatrixTransitionSchema` para que no pueda ser posterior a hoy en Chile (hoy se puede publicar con vigencia en 2030 y postergar la revisión anual a 2031).

**⚠️ Matiz del verificador:** Mechanically correct, but it is a house-wide pattern with a one-day cosmetic blast radius, not a MIPER-specific MEDIUM. Verified: `miper/page.tsx:30` is `const today = new Date().toISOString().slice(0, 10)`; `miper-workbench.tsx:204` uses it as `<DatePicker name="effectiveFrom" defaultValue={today} />` and :203 always forwards it on publish, so `const effectiveFrom = data.effectiveFrom ?? todayInChile()` (service:399) never falls back, and `addDays(effectiveFrom, 365)` (:400) plus `addDays(effectiveFrom, 30)` (:452) inherit the shift. Chile is UTC-3/-4, so between ~20:00 and midnight local the UTC date is tomorrow — the error is a single day, in the future, on a value the publisher sees rendered in the DatePicker before submitting. Two things cut the severity: the same `new Date().toISOString().slice(0, 10)` appears in a dozen sibling prevention screens (`cphs/page.tsx:39`, `inspecciones/inspections-screen.tsx:94`, `higiene/programas/[programId]/program-detail.tsx:58`, `nueva/nueva-evaluacion-form.types.ts:42`, …), so this is a module-wide convention rather than a MIPER regression; and `lib/__tests__/miper-ui-contract.test.ts:13` deliberately pins the string to keep SSR/hydration stable, meaning any fix must swap in `todayInChile()` and update that assertion, not simply delete the line.

---

## MIPER-10 [LOW] — La máquina de estados de la MIPER no tiene retorno: el revisor no puede rechazar y las entradas de un borrador no se pueden corregir ni borrar
**Área:** MIPER · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-legal.ts:355-360,285; app/(app)/prevencion/miper/miper-workbench.tsx:199` · **Componente:** `MATRIX_TRANSITIONS`

**Evidencia:** prevention-risk-legal.ts:355-360
```
const MATRIX_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["in_review"],
  in_review: ["reviewed"],
  reviewed: ["approved"],
  approved: ["published"],
}
```
No hay aristas de vuelta ni un estado `rejected`/`cancelled` en el CHECK de la tabla (db/schema/prevention/risk-legal.ts:110: `'draft','in_review','reviewed','approved','published','superseded'`). La UI refleja lo mismo: `next` sólo ofrece el paso siguiente (miper-workbench.tsx:199).

Y el contenido sólo es editable en `draft` —`if (matrix.status !== "draft") throw new Error("Sólo una versión MIPER en borrador admite cambios.")` (prevention-risk-legal.ts:285)— pero incluso en `draft` no existe ninguna forma de modificar ni eliminar una entrada ya creada: grep de `update(preventionRiskEntries` y `delete(preventionRiskEntries` en todo el repo devuelve cero resultados. El índice único (matrixId, processId, taskId, positionId, hazardCode) (schema:148) impide además re-crearla corregida con la misma identidad.

**Escenario:** 1. Se cargan 180 peligros en una MIPER borrador y se envía a revisión.
2. El revisor detecta que 12 filas tienen el nivel residual equivocado.

**Actual:** El revisor sólo tiene el botón "Revisar" (aprobar el paso) o no hacer nada. No puede devolver la versión a borrador, el autor no puede corregir las 12 filas, y las entradas erróneas ya no son editables ni eliminables. La versión queda bloqueada en `in_review` para siempre, consumiendo un número de versión, y el único camino es crear otra versión desde cero y volver a cargar los 180 peligros (que además, por MIPER-06, nace vacía).
**Esperado:** El revisor debe poder rechazar y devolver a `draft` con fundamento, y una entrada de un borrador debe poder corregirse o eliminarse.
**Impacto:** Cualquier error detectado en revisión obliga a rehacer la matriz completa; en la práctica presiona a aprobar con errores. Deja además filas zombi en `in_review`/`reviewed` que el panel sigue listando.
**Causa raíz:** Se modeló únicamente el camino feliz del circuito de aprobación y no se implementó ninguna operación de edición sobre entradas ya creadas.
**Corrección:** Añadir a `MATRIX_TRANSITIONS` las aristas de retorno `in_review: ["reviewed","draft"]` y `reviewed: ["approved","draft"]` (permiso `prevention:risk:review`, motivo obligatorio, registro en historial — la infraestructura de `history()` y el CAS por `version` ya está) y una acción `removeRiskEntry`/`updateRiskEntry` restringida a `matrix.status === "draft"`, borrando en cascada sus controles.

---

## MOC-04 [LOW] — La UI permite 'requiere acción' sin 'impacta', combinación que Zod acepta y que revienta contra un CHECK de PostgreSQL, mostrando el error crudo de la base de datos al usuario
**Área:** MOC (gestión del cambio) · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-change.ts:129-136 · db/schema/prevention/change.ts:69 · app/(app)/prevencion/gestion-cambio/[changeId]/change-detail.tsx:199-201` · **Componente:** `evaluateSchema / evaluateChangeDimension`

**Evidencia:** La base de datos exige que una acción requerida implique impacto (constraint viva, migración 0094):
```ts
// db/schema/prevention/change.ts:69
check("prevention_change_assessment_impact_consistent", sql`${table.impacted} = true OR ${table.actionRequired} = false`),
```

El `superRefine` del schema comprueba descripción y plazo, pero no esa implicación:
```ts
// lib/services/prevention-change.ts:129-136
}).superRefine((value, ctx) => {
  if (value.actionRequired && !value.actionDescription) { ... }
  if (value.actionRequired && !value.targetDate) { ... }
})
```

Y la UI expone las dos casillas como estados independientes, sin ninguna dependencia entre ellas:
```tsx
// change-detail.tsx:199-201
<Checkbox label="El cambio impacta esta dimensión" checked={impacted} onChange={(e) => setImpacted(e.target.checked)} />
<Field label="Notas" ...>...</Field>
<Checkbox label="Requiere una acción correctiva o preventiva nueva" checked={actionRequired} onChange={(e) => setActionRequired(e.target.checked)} />
```

El mensaje del fallo llega literal al usuario: `run()` (actions.ts:34-36) devuelve `error.message`, y `useOperation` lo muestra tal cual (lib/hooks/use-operation.ts:19: "El mensaje viene del servicio/action, mostrándose tal cual").

**Escenario:** 1. Un evaluador abre 'Evaluar' en la dimensión 'training'.
2. No marca 'El cambio impacta esta dimensión' (a su juicio el impacto es indirecto) pero sí marca 'Requiere una acción correctiva o preventiva nueva'.
3. Rellena descripción de la acción, responsable y plazo, y envía.
4. `parseZ` acepta (superRefine sólo mira descripción y plazo). La acción llega al servicio.
5. El servicio crea la acción CAPA (L161-172) y luego ejecuta el UPDATE de la evaluación (L176-185), que viola `prevention_change_assessment_impact_consistent`.
6. La transacción aborta entera (la CAPA se revierte correctamente) y el catch de `run` devuelve el mensaje de PostgreSQL.

**Actual:** El diálogo muestra al prevencionista un texto del tipo «new row for relation "prevention_change_assessments" violates check constraint "prevention_change_assessment_impact_consistent"». No hay forma de saber qué corregir; el trabajo del formulario se pierde y el nombre interno de la restricción y de la tabla quedan expuestos en la interfaz.
**Esperado:** O bien el schema rechaza la combinación en el boundary con un mensaje en la lengua del dominio anclado al campo ('Una dimensión que requiere acción tiene que declararse como impactada'), o bien la UI deriva `impacted` de `actionRequired` para que la combinación sea inalcanzable. En ningún caso debe llegar a la base de datos ni mostrarse un error de PostgreSQL.
**Impacto:** Camino de usuario perfectamente alcanzable con dos clics que termina en un error incomprensible y pierde el formulario. Filtra nombres internos de tablas y restricciones a la interfaz. La regla de negocio existe en la BD y no tiene espejo en la capa de validación, que es donde el usuario podría entenderla.
**Causa raíz:** La invariante `actionRequired ⇒ impacted` se escribió sólo como CHECK de PostgreSQL. Las otras dos invariantes de la misma familia (`actionRequired ⇒ descripción` y `actionRequired ⇒ plazo`) sí se replicaron en el `superRefine`; ésta se olvidó, y la UI trata las dos casillas como ortogonales.
**Corrección:** 1. Añadir la tercera cláusula al `superRefine` de `evaluateSchema` (lib/services/prevention-change.ts:129-136), junto a las dos que ya están:
```ts
if (value.actionRequired && !value.impacted) {
  ctx.addIssue({ code: "custom", path: ["impacted"], message: "Una dimensión que requiere acción debe declararse como impactada." })
}
```
Con eso `parseZ` la ancla al campo y el servicio la rechaza igual si la llamada no viene de la UI.
2. En change-detail.tsx, marcar 'Requiere acción' debe marcar 'Impacta' (o deshabilitar la segunda casilla mientras la primera esté sin marcar), para que la combinación no se pueda ni intentar.

**⚠️ Matiz del verificador:** Every cited fact checks out. The CHECK is live in an applied migration: db/migrations/0094_melted_sheva_callister.sql:16 `CONSTRAINT "prevention_change_assessment_impact_consistent" CHECK ("impacted" = true OR "action_required" = false)`. The superRefine at prevention-change.ts:129-136 covers only actionDescription and targetDate. The UI checkboxes are genuinely orthogonal — change-detail.tsx:199 `<Checkbox label="El cambio impacta esta dimensión" checked={impacted} onChange={...} />` and L201 `<Checkbox label="Requiere una acción correctiva o preventiva nueva" checked={actionRequired} onChange={...} />` with no coupling, and submit() at L175-185 forwards `impacted` and `actionRequired` independently. I looked for the missing guard in the action layer and it is not there: `evaluateChangeDimensionAction` only does `guardPermission` + `parseZ(evaluateSchema, input)`. The raw message does reach the user: actions.ts `run()` returns `error instanceof Error ? error.message : ...` and use-operation.ts:19 sets it verbatim («El mensaje viene del servicio/action, mostrándose tal cual»). However the severity is overstated: the transaction aborts atomically (the CAPA is rolled back with it), no state is corrupted, and the rejected combination is invalid by design — the only harm is an untranslated Postgres string instead of a Spanish validation message on a combination the user should not be entering.

---

## MOC-05 [LOW] — La 'fecha de revisión posterior' no se valida como posterior ni tiene cota, y nadie la vigila: ningún proceso detecta una revisión vencida, y no existe el concepto de cambio temporal con vigencia
**Área:** MOC (gestión del cambio) · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-change.ts:200-204,224 · lib/prevention/change.ts:66-80 · app/(app)/prevencion/gestion-cambio/[changeId]/change-detail.tsx:265` · **Componente:** `approveSchema / assessChangeReadiness`

**Evidencia:** El schema sólo valida el formato:
```ts
// lib/services/prevention-change.ts:200-204
export const approveSchema = z.object({
  changeRequestId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  plannedReviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
```
Y la regla de negocio sólo comprueba presencia, pese a que su propio docstring dice 'posterior':
```ts
// lib/prevention/change.ts:76-78
if (!input.plannedReviewDate) {
  blockers.push("El cambio no declara una fecha de revisión posterior.")
}
```
No hay comparación con `todayInChile()` en ningún punto, pese a que el módulo hermano CPHS sí impone esta clase de regla (lib/services/prevention-cphs.ts:56 «El término del mandato debe ser posterior a la constitución», lib/services/prevention-cphs-organization.ts:52). El selector tampoco acota: `<DatePicker name="plannedReviewDate" />` (change-detail.tsx:265) sin `min` ni `max`, y el componente los soporta (components/ui/date-picker.tsx:26-30).

Después de la aprobación la columna es decorativa. Grep completo de `plannedReviewDate` / `planned_review_date` en todo el árbol: sólo esquema, servicio (escritura y lectura para el detalle), la ficha de solo lectura de change-detail.tsx:74 y seeds/tests. Ninguna consulta la compara con hoy, ninguna la ordena, no aparece en el listado, y no hay ningún cron: `ls app/api/cron/` da 18 trabajos (prevention-capa-reminders, prevention-cphs-alerts, prevention-document-ack-reminders, prevention-incident-reminders, prevention-training-reminders…) y **ninguno** toca gestión del cambio.

El esquema tampoco distingue cambio temporal de permanente: no existe ninguna columna de temporalidad ni de vigencia en db/schema/prevention/change.ts:16-43.

**Escenario:** 1. El aprobador abre el diálogo 'Aprobar cambio' con el calendario sin cota y selecciona 2026-01-10 (pasado) por error de mes, o 2199-01-01.
2. `assessChangeReadiness` sólo ve que la cadena no está vacía: `ready = true`.
3. El CHECK `prevention_change_approved_consistent` sólo exige `planned_review_date IS NOT NULL`. El cambio se aprueba.
4. La ficha muestra 'Fecha de revisión: 2026-01-10'. Nada la marca como vencida.
5. Camino realista y más grave: se elige una fecha correcta, 2026-12-01. Llega el 2027-03-01. Nadie ha revisado. No hay recordatorio, ni bandeja de vencidos, ni columna en el listado, ni consulta que compare esa fecha con hoy en ningún lugar del sistema.

**Actual:** Un cambio se aprueba con una fecha de revisión anterior a su propia aprobación, o absurdamente lejana, sin que nada lo impida. Y una vez aprobado, la fecha no dispara nada: la revisión posterior de la vigencia de la evaluación —que es el motivo declarado de que exista la columna, y la única barrera del módulo contra que un cambio 'temporal' se vuelva permanente sin control— no ocurre nunca por diseño.
**Esperado:** `approveChangeRequest` debe rechazar `plannedReviewDate <= todayInChile()` (y acotar el horizonte razonable, p. ej. un año), el `DatePicker` debe pasar `min`, y debe existir un camino que exponga las revisiones vencidas: al menos una columna/filtro en el listado, idealmente un cron idempotente que notifique como ya hacen los cinco recordatorios de Prevención existentes.
**Impacto:** El único control temporal del MOC es inoperante. Un cambio de alto riesgo aprobado con una evaluación válida 'hasta la revisión' se queda vigente indefinidamente sin que nadie reciba señal, que es exactamente el fallo que el docstring de lib/prevention/change.ts:59-64 dice estar evitando ('el mismo defecto que cerrar sin conclusiones'). Además una fecha de revisión en el pasado deja el expediente internamente incoherente ante una fiscalización.
**Causa raíz:** La compuerta de aprobación se diseñó como una comprobación de completitud de formulario (¿está el campo?) en vez de una regla temporal, y la fase de seguimiento posterior a la aprobación nunca se construyó — coherente con MOC-01: el ciclo se detiene en 'approved'.
**Corrección:** 1. En lib/prevention/change.ts, dar a `assessChangeReadiness` un parámetro `today` y añadir el bloqueo temporal junto al de presencia:
```ts
if (input.plannedReviewDate && input.plannedReviewDate <= today) {
  blockers.push("La fecha de revisión debe ser posterior a la aprobación.")
}
```
La comparación lexicográfica de 'YYYY-MM-DD' basta y evita objetos Date. Pasar `todayInChile()` (lib/utils.ts:275) desde `approveChangeRequest` (L224) y desde `getChangeRequestDetail` (L307). Es la función de cálculo puro que ya tiene test propio (prevention-change-calc.test.ts).
2. Pasar `min={todayInChile()}` al `DatePicker` de change-detail.tsx:265 (la prop ya existe).
3. Exponer el vencimiento: añadir `plannedReviewDate` como columna ordenable en change-list.tsx y contar 'revisión vencida' en las métricas. Si se quiere aviso activo, un cron con el patrón idempotente de lib/services/prevention-capa-reminders.ts.
4. Para cambio temporal vs permanente: la vía barata es no añadir tabla nueva sino un `isTemporary boolean` + reutilizar `plannedReviewDate` como fin de vigencia, con CHECK `(is_temporary = false) OR (planned_review_date IS NOT NULL)`. Decisión de producto: no lo implementaría antes de confirmar que se necesita.

**⚠️ Matiz del verificador:** Partly a misreading, partly documented-as-not-built, with a small true residue. The misreading: the auditor treats «fecha de revisión posterior» as a promise of a future-date check. In the docstrings (prevention-change.ts:207-208, lib/prevention/change.ts:59-64, db/schema/prevention/change.ts:11-14) 'posterior' modifies 'revisión' — it means a *subsequent review*, i.e. declare when someone will re-check that the evaluation still held; it is not an assertion about the date's relation to today. The plan states the rule the same way: «Aprobar exige las seis dimensiones evaluadas y una fecha de revisión posterior **declarada** (`assessChangeReadiness`)». So the presence-only check at lib/prevention/change.ts:76-78 matches its specification. The monitoring half is a documented product pendiente, not a defect: PLAN_P1_PREVENCION.md 'Pendientes de la capacidad 9' asks precisely «si `implemented`/`closed` deben cerrarse manualmente o requieren evidencia de la revisión posterior» — the follow-up phase is knowingly unbuilt, same root as MOC-01. The grep results are accurate (no cron under app/api/cron touches gestión del cambio; plannedReviewDate appears only in schema, service, detail card and tests) and `<DatePicker name="plannedReviewDate" />` at change-detail.tsx:265 indeed passes no `min`, which DatePickerProps supports. That last item — a past date being selectable — is the only genuine residue.

---

## PPA-02 [LOW] — El fallback heredado de `getPpaByToken` convierte el hash almacenado en una credencial válida por sí misma y, al usarlo, destruye de forma irreversible el enlace legítimo
**Área:** PPA · **Categoría:** Seguridad · **Confianza:** Alta
**Ubicación:** `lib/services/ppa-module/evaluaciones.ts:194-206` · **Componente:** `getPpaByToken`

**Evidencia:** ```ts
194:    // El segundo término mantiene válidos enlaces emitidos antes de la
195:    // migración. Al primer uso se convierten a hash en la misma aplicación.
196:    .where(or(eq(ppaSubmissions.publicToken, tokenHash), eq(ppaSubmissions.publicToken, token)))
...
202:  if (r.submission.publicToken === token) {
203:    await db.update(ppaSubmissions)
204:      .set({ publicToken: tokenHash, updatedAt: new Date().toISOString() })
205:      .where(and(eq(ppaSubmissions.id, r.submission.id), eq(ppaSubmissions.publicToken, token)))
206:  }
```

El segundo término compara el valor recibido **contra la columna tal cual**. Como la columna guarda `H = sha256(T)`, presentar `H` como token satisface `publicToken = token` y la función devuelve el registro. Es exactamente la propiedad que la migración 0057 quiso eliminar: su comentario dice «Se almacenan como SHA-256 para que una lectura de la base no permita reutilizar enlaces públicos» (db/migrations/0057_hash_ppa_public_tokens.sql:1-3), y esa misma migración ya rellenó todo lo histórico (`UPDATE … WHERE public_token !~ '^[0-9a-f]{64}$'`), de modo que en Postgres no queda ninguna fila en claro que el fallback deba rescatar.

Además, en ese acierto la rama 202-206 escribe `sha256(H)` sobre la columna: el token real `T` deja de resolver por ambos términos (`sha256(T)=H ≠ sha256(H)` y `T ≠ sha256(H)`).

El invariante «el valor sin hash … nunca se persiste» (lib/services/ppa-module/public-token.ts:3-6) tampoco se cumple fuera de producción: scripts/seed-demo-gaps.ts:254 inserta `publicToken: id("tok")` en claro y scripts/capture-all-routes.ts:2996 inserta `"capture-ppa-token"`.

**Escenario:** 1. Alguien obtiene lectura de `ppa_submissions.public_token` (respaldo, réplica de lectura, export de soporte, lectura vía SQLi) — el escenario contra el que se introdujo el hash.
2. Abre `/ppa/result/<H>` con el hash copiado tal cual.
3. La consulta empareja por el segundo término del `or`, `publicTokenRevokedAt` es NULL y la página pública se renderiza.
4. En la misma petición, la línea 203 reescribe la columna a `sha256(H)`.

**Actual:** El resultado del PPA (tarea, estado, motivos de detención, supervisor y prevencionista asignados) se sirve a quien sólo posee el hash, y el enlace del trabajador queda muerto para siempre sin registro de que algo pasó: no hay fila en `ppa_status_history` ni `publicTokenRevokedAt`, sólo un `updatedAt` movido.
**Esperado:** Sólo el token en claro debe abrir el recurso. Conocer el hash almacenado no debe otorgar acceso ni permitir alterar la columna.
**Impacto:** Anula la defensa en profundidad que justificó la migración 0057 y añade una vía de corrupción silenciosa e irreversible del enlace de capacidad.
**Causa raíz:** El fallback perezoso se dejó en el código de producción después de que el backfill de 0057 lo volviera innecesario allí; sigue existiendo por los entornos PGlite/seed que insertan tokens en claro.
**Corrección:** Eliminar el segundo término del `or` y todo el bloque 202-206: consultar sólo por `tokenHash`. Para que los entornos de prueba/captura sigan funcionando, cambiar los seeds a `publicToken: hashPpaPublicToken(tokenEnClaro)` (scripts/seed-demo-gaps.ts:254, scripts/capture-all-routes.ts:2996), que es la misma función que usa `createPpaSubmission`.

**⚠️ Matiz del verificador:** Code matches: evaluaciones.ts:196 `where(or(eq(publicToken, tokenHash), eq(publicToken, token)))` and :202-206 rewrites the column with `hashPpaPublicToken(H)`, so presenting the stored hash does resolve the row and does invalidate the real token. But the framing overstates it. The fallback is explicitly deliberate and documented in the very migration the auditor quotes — db/migrations/0057 header: «PGlite no distribuye pgcrypto: la aplicación mantiene fallback de lectura y hace el upgrade perezoso de enlaces históricos», and the backfill is guarded by `IF to_regprocedure('digest(bytea,text)') IS NOT NULL`, i.e. it is a no-op wherever pgcrypto is absent, which is exactly when the fallback is load-bearing. More importantly the attack is not incremental: the precondition is read access to `ppa_submissions.public_token`, and the only thing the token unlocks is `app/(public)/ppa/result/[token]/page.tsx`, a read-only page rendering a strict subset of that same row (estado, triggeredReasons, tipoTrabajo) with no mutation path. An attacker who can read the column already has everything the page would show. The app never leaks the column itself (`PpaRow = Omit<PpaSubmission, "publicToken">`, evaluaciones.ts:24; calculos.ts selects explicit columns). Real but low-value hardening (drop the OR once seeds hash their tokens).

---

## PPA-03 [LOW] — El módulo CAPA puede mover la acción de un PPA sin pasar por el flujo PPA, y deja el caso de trabajo detenido en un bloqueo del que no existe salida salvo cancelarlo
**Área:** PPA · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `app/(app)/prevencion/capa/actions.ts:36-62` · **Componente:** `transitionCapaActionAction / declarePpaCorrection / verifyPpaCorrection`

**Evidencia:** `transitionCapaActionAction` opera sobre cualquier acción por id, sin mirar `sourceType`:

```ts
36:export async function transitionCapaActionAction(input: {
37:  actionId: string
...
45:  const guard = await guardPermission(permissionForTransition(input.toStatus))
```

La lista /prevencion/capa no excluye el origen `ppa` (app/(app)/prevencion/capa/page.tsx:33 pasa `sourceType: source`, indefinido por defecto) y la ficha monta `<CapaControls>` sin condicionar por origen (app/(app)/prevencion/capa/[id]/page.tsx:134-155).

El flujo PPA, en cambio, exige un estado CAPA exacto en cada paso:

```ts
// lib/services/ppa-module/reportes.ts:182-190
182:    if (capa.status === "pending" || capa.status === "reopened") { … in_progress … }
190:    if (capa.status !== "in_progress") throw new Error("La acción CAPA no está disponible para declarar implementación.")
// reportes.ts:231-233
231:    if (capa.version !== data.expectedCapaVersion || capa.status !== "pending_verification") {
232:      throw new Error("La acción CAPA cambió o no está pendiente de verificación.")
```

Y el RBAC por defecto entrega al mismo rol las dos puertas: `prevencionista_faena` tiene `ppa:correct` (modules/ppa/manifest.ts:42-43) y `prevention:capa:complete` (modules/prevention/manifest.ts:690), pero **no** tiene `ppa:cancel` (no aparece en modules/ppa/manifest.ts:40-70).

**Escenario:** 1. Un PPA queda `en_correccion` con su CAPA en `pending` tras la revisión.
2. El prevencionista de faena adjunta evidencia y, en vez de usar el panel del PPA, abre /prevencion/capa/<id> (la acción aparece en su lista) y pulsa las transiciones equivalentes: `pending → in_progress → pending_verification`. Ambas exigen sólo `prevention:capa:complete`, que tiene.
3. Vuelve al PPA y pulsa «Declarar controles implementados».

**Actual:** `declarePpaCorrection` lanza «La acción CAPA no está disponible para declarar implementación» (reportes.ts:190) porque la CAPA ya está en `pending_verification`. El PPA sigue en `en_correccion`, así que `verifyPpaCorrection` también rechaza (exige estado `pendiente_verificacion`, reportes.ts:225) y `authorizePpaRestart` nunca podrá ejecutarse (exige `verifiedAt`, reportes.ts:278). El caso queda bloqueado de forma permanente: la única transición que aún acepta `en_correccion` es `cancelPpa`, y ese permiso no lo tiene el rol que provocó el bloqueo. Variante equivalente con `prevention:capa:verify`: la CAPA pasa a `verified` sin que `verifyPpaCorrection` grabe nunca `verifiedAt`, y el PPA queda igual de bloqueado desde `pendiente_verificacion`.
**Esperado:** O bien la acción CAPA de origen `ppa` es de solo lectura desde el módulo CAPA (el flujo PPA es su único conductor), o bien el flujo PPA tolera que la CAPA ya esté en el estado destino y sincroniza en vez de abortar. En ningún caso una tarea detenida debe quedar sin camino de reinicio.
**Impacto:** Un trabajo detenido no puede reiniciarse por el sistema. Operativamente empuja a reiniciar la tarea por fuera de la plataforma o a cancelar y rehacer el PPA (perdiendo la trazabilidad del caso original, que es justamente la evidencia legal de la detención). No requiere mala fe: basta que un usuario legítimo trabaje desde la pantalla equivocada.
**Causa raíz:** La unificación en el motor CAPA único (retiro de `ppa_corrective_actions` como espejo) dejó dos conductores para la misma fila —el panel del PPA y la ficha CAPA— sin declarar cuál manda ni tolerancia a que el otro se adelante.
**Corrección:** Lo más corto: bloquear el conductor duplicado. En `transitionCapaActionAction` (y en `updateCapaActionAction`) rechazar cuando la acción tenga `sourceType === "ppa"` con un mensaje que remita a /prevencion/ppa/<sourceId>, y ocultar `<CapaControls>` de transición en la ficha para ese origen (el dato ya está en `bundle.action.sourceType`, app/(app)/prevencion/capa/[id]/page.tsx:43). Como red de seguridad, hacer idempotentes los pasos del PPA: en `declarePpaCorrection`, si `capa.status === "pending_verification"` continuar en vez de lanzar; en `verifyPpaCorrection`, aceptar `verified` como equivalente y limitarse a sellar `verifiedAt`.

**⚠️ Matiz del verificador:** The drift is real: capa/page.tsx passes `sourceType: source` (undefined by default) so ppa-sourced actions are listed, and capa-controls.tsx:161-166 renders «Iniciar implementación» / «Enviar a verificación» purely on `permissions.complete` + status, with no source check. But the headline claim — «un bloqueo del que no existe salida salvo cancelarlo» — is false. `TRANSITIONS.pending_verification = ["verified","reopened","cancelled"]` (prevention-capa.ts:135) and capa-controls.tsx:167-169 renders «Devolver a implementación» → `reopened` for anyone with `prevention:capa:verify`; `declarePpaCorrection` explicitly accepts that state (reportes.ts:182 `if (capa.status === "pending" || capa.status === "reopened")`), so one click restores the PPA flow. The same holds from `verified`/`closed` (TRANSITIONS lines 136-137). And the escape is always available to the people who must act anyway: `verifyPpaCorrection` calls `transitionCapaActionWithClient(..., toStatus: "verified")`, which requires `prevention:capa:verify` (TRANSITION_PERMISSION:146), so every PPA verifier holds it by construction (prevencionista/jefa_chome/administrador, manifest.ts:694/698/703). No safety gate is skipped either: `pending_verification` still enforces evidence (assertCapaTransition:189) and the PPA cannot reach `pendiente_verificacion` without its CAPA landing there. What is left is a confusing dead-end error, not a lock and not an SoD hole.

---

## PPA-06 [LOW] — `revokePpaToken` recibe el id del usuario y lo descarta: revocar el acceso público no deja constancia de quién lo hizo
**Área:** PPA · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/ppa-module/evaluaciones.ts:216-233` · **Componente:** `revokePpaToken`

**Evidencia:** ```ts
216: export async function revokePpaToken(
217:   id: string,
218:   userId: string,          // <- nunca se usa en el cuerpo
219:   worksiteIds: string[] | "all",
220: ): Promise<void> {
...
229:   await db.update(ppaSubmissions).set({
230:     publicTokenRevokedAt: new Date().toISOString(),
231:     updatedAt: new Date().toISOString(),
232:   }).where(eq(ppaSubmissions.id, id))
233: }
```

El parámetro se pasa desde la acción (`revokePpaToken(id, session.user.id, worksiteIds)`, app/(app)/prevencion/ppa/actions.ts:249) y se pierde. No se inserta fila en `ppa_status_history` ni se llama a `recordOperationalActivity`, a diferencia del resto de operaciones del módulo (cf. `recordPpaHistory` en lib/services/ppa-module/reportes.ts:53-72, usada por review/declare/verify/authorize/cancel/close). El esquema tampoco tiene columna para el actor (db/schema/ppa.ts:41 sólo guarda `public_token_revoked_at`).

**Escenario:** 1. Un usuario con `ppa:manage` pulsa «Revocar» en la ficha de un PPA.
2. El trabajador reclama que su enlace dejó de funcionar.
3. Se busca en la trazabilidad del caso quién y por qué lo revocó.

**Actual:** La línea de tiempo del PPA no muestra el evento; sólo cambió `updated_at` y apareció una marca de revocación anónima. No hay forma de atribuir la acción.
**Esperado:** Revocar una credencial de acceso es una acción de seguridad y debe quedar atribuida, como las demás transiciones del caso.
**Impacto:** Pérdida de trazabilidad en la única operación del módulo que corta el acceso del trabajador a su resultado. Bajo impacto operativo, alto valor de auditoría, coste de arreglo mínimo.
**Causa raíz:** La firma se escribió previendo la atribución pero la implementación nunca la usó; nadie lo notó porque TypeScript no marca parámetros sin usar en la posición intermedia.
**Corrección:** Envolver el UPDATE en `db.transaction` y añadir `recordOperationalActivity({ eventType: "ppa.token_revoked", … })` con `actorSnapshot` del `userId`, o —mejor, porque queda a la vista del usuario— una fila de `ppa_status_history` con `fromStatus = toStatus = existing.estado`, `reason: "Acceso público revocado"` y `actorUserId: userId`. Aprovechar para hacer el UPDATE condicional (`… AND public_token_revoked_at IS NULL`) y cerrar el TOCTOU entre la lectura de la línea 222 y la escritura de la 229.

---

## PPA-07 [LOW] — Código muerto: `CloseCaseButton` no se monta en ninguna parte y aplica una regla de cierre distinta de la vigente; la decisión `autorizado` de revisión es inalcanzable
**Área:** PPA · **Categoría:** Otro · **Confianza:** Alta
**Ubicación:** `app/(app)/prevencion/ppa/[id]/close-case-button.tsx:11-56` · **Componente:** `CloseCaseButton / reviewPpa`

**Evidencia:** `grep -rn "CloseCaseButton\|close-case-button" app lib e2e` sólo devuelve su propia definición: no hay ningún import. La ficha cierra el caso desde `PpaWorkflowPanel` (app/(app)/prevencion/ppa/[id]/page.tsx:249-265), que exige comentario del usuario (`closeComment.trim().length < 5`, ppa-workflow-panel.tsx). El componente huérfano, en cambio, envía un texto enlatado:

```tsx
21:      const res = await closePpaAction({
22:        ppaId,
23:        expectedPpaVersion: ppaVersion,
24:        comment: "Cierre administrativo posterior a verificación satisfactoria.",
25:      })
```

En paralelo, `PpaDecision` incluye `"autorizado"` (lib/ppa/types.ts:102, lib/validation/ppa.ts:52) y `reviewPpa` le reserva una rama (lib/services/ppa-module/reportes.ts:93), pero el único emisor sólo ofrece `correccion` y `rechazado` (review-panel.tsx:18-26) y ambas ramas vivas convergen en `en_correccion`.

**Escenario:** 1. Alguien retoma el módulo y monta `CloseCaseButton` creyendo que es el control vigente.
2. Los cierres pasan a grabarse todos con el mismo comentario enlatado, cumpliendo el `min(5)` del esquema sin aportar la observación real.

**Actual:** Dos implementaciones de la misma regla de negocio con exigencias distintas conviviendo en el árbol, una de ellas invisible para cualquier lectura de la UI.
**Esperado:** Una sola ruta de cierre. Los valores del enum que ningún emisor produce se retiran del contrato.
**Impacto:** Deuda de mantenimiento y riesgo de regresión en la calidad del registro de cierre. Sin impacto en runtime hoy.
**Causa raíz:** Restos de la iteración anterior del flujo (cierre por botón simple) que el panel de workflow reemplazó sin borrarlos.
**Corrección:** Borrar app/(app)/prevencion/ppa/[id]/close-case-button.tsx. Retirar `"autorizado"` de `PpaDecision` y del `z.enum` de `ppaReviewSchema`, y simplificar el ternario de reportes.ts:90-95 a `data.decision === "rechazado" ? "rechazado" : "en_correccion"`; conservar la entrada en `DECISION_PPA_LABELS` sólo si hay filas históricas con ese valor (verificar con un `SELECT DISTINCT decision`).

**⚠️ Matiz del verificador:** First half confirmed: `grep -rn "CloseCaseButton|close-case-button" app lib e2e components` returns only the declaration at close-case-button.tsx:11 — the file is orphaned, and it does hardcode `comment: "Cierre administrativo posterior a verificación satisfactoria."` while the live control (ppa-workflow-panel.tsx:150-154) requires `closeComment.trim().length >= 5` typed by the user. Second half is misframed: the `autorizado` branch is not leftover, it is a documented deliberate design — reportes.ts:88-90 carries the comment «Autorizar la propuesta de corrección no equivale a autorizar el trabajo. El PPA permanece en corrección hasta que la acción sea verificada», which is precisely why both live decisions converge on `en_correccion`. So the finding reduces to one unused component file plus an unused enum member; LOW, and the "someone remounts it" scenario is speculative.

---

## CPHS-05 [INFORMATIONAL] — El plazo de 60 días para cerrar brechas se ancla en la presentación del expediente y no en la auditoría, contradiciendo lo que documentan el esquema y la constante
**Área:** CPHS · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs-certification.ts:543-558, 575-590; db/schema/prevention/cphs.ts:302-303` · **Componente:** `submitCertificationDossier / recordAuditResult`

**Evidencia:** El plazo se calcula al presentar:
```ts
544     const today = todayInChile()
545     const gapsDeadline = addDays(today, GAP_CLOSURE_DAYS)
546     const [updated] = await tx.update(preventionCertificationDossiers).set({
547       status: "submitted",
...
550       gapsDeadlineOn: gapsDeadline,
```
y ese mismo valor es el `targetDate` de cada CAPA de brecha (líneas 579-588). Sin embargo la documentación del campo dice otra cosa: db/schema/prevention/cphs.ts:302-303 «Plazo de 60 días que da Mutual para cerrar brechas **tras la auditoría**», y lib/prevention/cphs-certification.ts:35-36 «Plazo que da Mutual para cerrar brechas **tras la auditoría**». `recordAuditResult` (líneas 683-721) registra `auditedOn` y nunca recalcula `gapsDeadlineOn` ni los plazos de las CAPA ya creadas.

**Escenario:** 1. El 1 de marzo se presenta el expediente Bronce con 3 brechas → `gapsDeadlineOn = 30 de abril` y 3 CAPA con ese plazo.
2. Mutual audita el 15 de abril y el resultado se registra con `recordAuditResult`.
3. El equipo dispone, según la norma, hasta el 14 de junio para cerrar las brechas.

**Actual:** Las CAPA vencen el 30 de abril (15 días después de la auditoría) y aparecen atrasadas en /pendientes; el expediente muestra un «Plazo de brechas» que no corresponde al que otorga Mutual.
**Esperado:** El plazo de 60 días debe contarse desde `auditedOn` y propagarse a las acciones CAPA de brecha al registrar el resultado de la auditoría.
**Impacto:** Plazos de cierre de brecha mal calculados y acciones correctivas que se reportan vencidas antes de tiempo; el dato que el expediente presenta como compromiso ante Mutual es incorrecto.
**Causa raíz:** El plazo se ancló en el evento disponible en el momento de congelar (la presentación) en lugar del evento que la propia documentación señala (la auditoría), y no hay recálculo posterior.
**Corrección:** Mover el cálculo a `recordAuditResult`: al registrar el resultado, fijar `gapsDeadlineOn = addDays(data.auditedOn, GAP_CLOSURE_DAYS)` y actualizar el `targetDate` de las CAPA vinculadas por `preventionCertificationEvaluations.capaActionId` dentro de la misma transacción (reusando el servicio CAPA en vez de un UPDATE directo). Si se prefiere mantener un plazo provisorio al presentar, dejarlo explícito en el texto de la UI y en los comentarios del esquema para que las tres fuentes digan lo mismo.

**⚠️ Matiz del verificador:** The textual contradiction is real: `const today = todayInChile(); const gapsDeadline = addDays(today, GAP_CLOSURE_DAYS)` inside submitCertificationDossier (prevention-cphs-certification.ts:544-545), reused as each gap CAPA's `targetDate` (line 586), while db/schema/prevention/cphs.ts:302 and lib/prevention/cphs-certification.ts:35 both say 'tras la auditoría', and recordAuditResult (683-721) recomputes only `validUntilOn`, never `gapsDeadlineOn`. But the implementation is not silently at odds with itself — the UI states the implemented rule to the user verbatim: `detail: \`${GAP_CLOSURE_DAYS} días desde la presentación\`` and `value: selected.gapsDeadlineOn ? ... : "Se define al presentar"` (certificacion/certification-panel.tsx metrics block), alongside 'Vigencia · Anual desde la auditoría' which IS anchored on `auditedOn` (line 700). The design doc D-C likewise ties the deadline to submission ('las brechas de certificación son acciones CAPA ... targetDate = plazo de 60 días'). No external source in the repo establishes that Mutual counts the 60 days from the audit other than the two comments themselves, and the implemented anchor is strictly earlier (more conservative). This is a stale doc-comment inconsistency, not a MEDIUM defect.

---

## CPHS-08 [INFORMATIONAL] — El indicador «Acuerdos del comité abiertos» del dashboard es estructuralmente cero: ningún acuerdo se crea ni pasa nunca a estado `open`/`closed`
**Área:** CPHS · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs.ts:702-721; lib/services/dashboard-domains-data.ts:200-204` · **Componente:** `closeCommitteeMeeting / getFieldControlDomainData`

**Evidencia:** El único INSERT de acuerdos fija siempre el mismo estado:
```ts
714       await tx.insert(preventionCommitteeAgreements).values({
715         id: `cphsag-${nanoid()}`,
716         meetingId: row.meeting.id,
717         description: agreement.description,
718         capaActionId: capa.id,
719         status: "capa_linked",
720       })
```
(el esquema Zod exige `actionDescription` y `targetDate` por acuerdo, líneas 643-649, así que siempre hay CAPA). No existe ningún UPDATE sobre `preventionCommitteeAgreements` en todo el repo. El dashboard cuenta justamente el estado inalcanzable:
```ts
204       .where(and(committeeScope, eq(preventionCommitteeAgreements.status, "open"))),
```
y se pinta como tarjeta «Acuerdos del comité abiertos» en app/(app)/dashboard/sections/field-control-section.tsx:98-105.

**Escenario:** 1. Un comité cierra actas con acuerdos durante todo el año.
2. Las CAPA derivadas quedan abiertas y vencidas.
3. Se abre el dashboard, sección Control en terreno.

**Actual:** La tarjeta «Acuerdos del comité abiertos» muestra 0 permanentemente, en cualquier faena y período; los estados `open` y `closed` de la tabla nunca ocurren, de modo que el acuerdo tampoco refleja el cierre de su CAPA.
**Esperado:** O el indicador refleja los acuerdos cuya CAPA sigue abierta, o la tarjeta se retira; y el estado del acuerdo debería seguir al de su acción correctiva.
**Impacto:** Un indicador de gobernanza del dashboard es ruido garantizado (siempre 0) y el seguimiento de acuerdos del comité no tiene señal propia: quien mire el tablero concluye que no hay acuerdos pendientes.
**Causa raíz:** La columna `status` de acuerdos quedó como estado muerto tras derivar todo a CAPA, y el consumidor del dashboard nunca se actualizó al nuevo modelo.
**Corrección:** Reescribir la consulta del dashboard para contar acuerdos cuyo `capaActionId` apunte a una acción CAPA no cerrada (JOIN con `preventionCapaActions`), que es la señal real; o bien eliminar la tarjeta y la columna `status` si el acuerdo ya no tiene ciclo propio. Evitar reintroducir un espejo de estado: el motor único de CAPA es la fuente (ver decisión «CAPA motor único»).

**⚠️ Matiz del verificador:** Facts check out. The only application INSERT hardcodes the terminal value — `status: "capa_linked"` (prevention-cphs.ts:714-720) — and every agreement necessarily has a CAPA because the Zod schema makes `actionDescription` and `targetDate` mandatory per agreement (lines 643-649). I grepped every reference to `preventionCommitteeAgreements` in the repo: the only other writes are scripts/seed-demo.ts:832 and scripts/capture-all-routes.ts:2380 (demo/screenshot fixtures), and there is no UPDATE anywhere; the postgres test even pins the invariant (`expect(agreements.every((row) => row.status === "capa_linked" && row.capaActionId)).toBe(true)`). The dashboard does count `eq(preventionCommitteeAgreements.status, "open")` (dashboard-domains-data.ts:204). But calling it a defect overstates it: the tile's own subtitle is 'Sin cerrar ni derivar a CAPA' (field-control-section.tsx:103), so 0 is the semantically CORRECT answer, not a wrong number — the flaw is a permanently-zero tile occupying a dashboard slot, i.e. dead weight, not a miscount.

---

## CPHS-09 [INFORMATIONAL] — Estados declarados pero inalcanzables: `held` en sesiones y `closed` en programas, con guardas y ramas de UI muertas
**Área:** CPHS · **Categoría:** Arquitectura · **Confianza:** Alta
**Ubicación:** `db/schema/prevention/cphs.ts:181, 87; app/(app)/prevencion/cphs/[committeeId]/committee-detail.tsx:278-292; lib/services/prevention-cphs-program.ts:188` · **Componente:** `preventionCommitteeMeetings / preventionCommitteePrograms`

**Evidencia:** El CHECK admite cuatro estados de sesión: `sql`${table.status} IN ('scheduled', 'held', 'closed', 'cancelled')`` (línea 181), pero ninguna escritura del repo produce `held` (grep de `status: "held"` en los servicios CPHS: sin resultados; las únicas transiciones son scheduled→closed en prevention-cphs.ts:723-731 y scheduled→cancelled en 318-322). La UI, en cambio, ramifica sobre ese estado:
```tsx
278                           {(meeting.status === "scheduled" || meeting.status === "held") && (
...
288                           {meeting.status === "held" && (
```
Lo mismo con el programa: el CHECK admite `('draft','active','closed')` (línea 87) y `addProgramActivity` protege `if (context.program.status === "closed") throw ...` (prevention-cphs-program.ts:188), pero la única actualización de programa es draft→active (prevention-cphs-program.ts:143-152); no existe acción de cierre.

**Escenario:** 1. Un desarrollador lee el esquema y asume el flujo scheduled → held → closed y planifica sobre él.
2. O un usuario espera poder cerrar el programa anual al terminar el año.

**Actual:** `held` nunca ocurre: las dos ramas de UI son inalcanzables y sugieren un flujo que no existe. El programa nunca se cierra: se queda `active` para siempre y su guarda de cierre es letra muerta.
**Esperado:** O se implementan las transiciones (marcar la sesión como realizada; cerrar el programa del año) o se eliminan del CHECK, de la UI y de las guardas.
**Impacto:** Deuda que induce a error en el mantenimiento y deja al programa anual sin estado terminal (un programa de 2026 sigue vigente en 2027 y su cumplimiento sigue acumulando actividades atrasadas).
**Causa raíz:** Máquinas de estado declaradas con más estados de los que las operaciones implementan.
**Corrección:** Decidir por estado: si `held` no aporta, quitarlo del CHECK (migración) y borrar las dos ramas de committee-detail.tsx; para el programa, agregar `closeProgram` (CAS sobre `version`, historial en `recordGovernanceHistory`) o retirar `closed` del CHECK y la guarda de la línea 188.

**⚠️ Matiz del verificador:** Both halves verified. The CHECK does allow four meeting states (`sql\`${table.status} IN ('scheduled', 'held', 'closed', 'cancelled')\``, schema:181) and a repo-wide grep for `"held"` outside that CHECK returns only the two dead UI branches (committee-detail.tsx:278 and :288) — no writer produces it; the only transitions are scheduled→closed (prevention-cphs.ts:723-731) and scheduled→cancelled (318-322), and neither seed-demo.ts nor capture-all-routes.ts writes 'held'. Likewise `('draft','active','closed')` (schema:87) against a single draft→active update (prevention-cphs-program.ts:143-152), leaving `if (context.program.status === "closed") throw ...` (line 188) unreachable. However the 'failure scenario' is a developer misreading a schema, not a user-visible defect: nothing computes a wrong result, nothing is unreachable that a user needs, and the dead branches render duplicate-but-valid controls. This is dead code / an over-declared enum.

---

## CPHS-11 [INFORMATIONAL] — El término del período del integrante (`termEndsOn`) se captura y almacena, pero no se aplica en ninguna regla ni se muestra
**Área:** CPHS · **Categoría:** Lógica · **Confianza:** Alta
**Ubicación:** `db/schema/prevention/cphs.ts:138; lib/services/prevention-cphs.ts:93, 120, 281; lib/prevention/cphs.ts:71-122` · **Componente:** `preventionCommitteeMembers.termEndsOn`

**Evidencia:** La columna existe y se escribe (`termEndsOn: data.termEndsOn ?? null`, línea 120; se hereda en el reemplazo, línea 281) y viaja hasta el cliente (app/(app)/prevencion/cphs/[committeeId]/page.tsx:99 → committee-detail.tsx:75), pero ninguna lógica la lee: `assessCommitteeParity` y `assessQuorum` filtran sólo por `status === "active"` (lib/prevention/cphs.ts:72 y 108), `gatherCertificationEvidence` cuenta `activeMembers` igual (lib/services/prevention-cphs-certification.ts:237), no hay job que cambie el estado del integrante por vencimiento (el único job de vencimiento es `expireLapsedCommittees`, sobre comités), y la tabla de integrantes de la UI ni siquiera pinta la columna (committee-detail.tsx:171-215).

**Escenario:** 1. Se incorpora un titular con `termEndsOn` = 2026-03-31.
2. Pasa el 1 de abril sin renuncia ni reemplazo formal.
3. Se cierra el acta de abril contando a esa persona como presente.

**Actual:** El integrante con período vencido sigue `active`: cuenta para el quórum, para la paridad y para «integrantes con orientación vigente» de la certificación, y su vencimiento no se ve en pantalla ni genera aviso.
**Esperado:** O el vencimiento del período se aplica (excluir del padrón activo o avisar como el mandato del comité) o el campo se elimina para no sugerir un control que no existe.
**Impacto:** Quórum y paridad calculados sobre integrantes cuyo período ya terminó; el dato inducirá a error a quien lo consulte por base de datos.
**Causa raíz:** Campo agregado sin regla asociada; la vigencia sólo se modeló a nivel de comité (`mandateEndsOn`).
**Corrección:** Elegir una de las dos vías: (a) excluir del padrón activo a los integrantes con `termEndsOn < todayInChile()` en `assessCommitteeParity`/`assessQuorum` (pasando la fecha como argumento, igual que `isMandateExpired`) y avisar desde `runPreventionCphsReminders` reusando `selectMandateWarningThreshold`; o (b) borrar la columna y su captura en los formularios. No dejarlo a medias.

**⚠️ Matiz del verificador:** The observation is accurate: I grepped every `termEndsOn` occurrence. For committee MEMBERS it is only written (prevention-cphs.ts:120, inherited at 281) and shipped to the client (page.tsx:97 → committee-detail.tsx:75); no rule reads it — `assessCommitteeParity` and `assessQuorum` filter on `status === "active"` only (cphs.ts:72, 108), `gatherCertificationEvidence` counts `memberRows.filter((member) => member.status === "active")` (certification:237), and the members table renders Persona/Representación/Asiento/Cargo/Fuero/Estado with no term column (committee-detail.tsx:171-215). The contrast the auditor did not draw is that the DELEGATE version of the same column IS enforced (prevention-cphs-organization.ts:72 expires by `lt(termEndsOn, today)`, plus a DB CHECK at schema:63) while the member one has neither. But this is not a live defect: under DS 54 a member's term is the committee's mandate, and THAT is enforced by `expireLapsedCommittees` + `isMandateExpired`, so an unused per-member date is a latent field with no wrong behaviour attached.

---

## CPHS-13 [INFORMATIONAL] — La revisión por la dirección no filtra ni verifica faena: hoy sin impacto porque el permiso sólo lo tienen roles globales
**Área:** CPHS · **Categoría:** Worksite Scope · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs.ts:795-806, 908-915` · **Componente:** `closeManagementReview / listManagementReviews`

**Evidencia:** El listado no aplica ninguna condición de alcance, a diferencia del resto del módulo que usa `cphsScopeCondition`:
```ts
909   requireAccess(access, "prevention:governance:review")
910   return db.select({ review: preventionManagementReviews, worksiteName: worksites.name })
911     .from(preventionManagementReviews)
912     .leftJoin(worksites, eq(preventionManagementReviews.worksiteId, worksites.id))
913     .orderBy(desc(preventionManagementReviews.heldAt))
914     .limit(200)
```
y el cierre valida el permiso sin la faena de la revisión (sí la valida por compromiso, línea 808):
```ts
797   requireAccess(access, "prevention:governance:review")
```
Mitigación actual: `prevention:governance:review` sólo está concedido a `jefa_chome` y `administrador` (modules/prevention/manifest.ts:860-863), ambos roles globales (lib/auth/scope.ts:9-17), por lo que `resolveWorksiteScope` siempre devuelve `mode: "all"`; la prueba lib/__tests__/prevention-rbac.test.ts:329-331 fija esa concesión.

**Escenario:** 1. Se concede `prevention:governance:review` a un rol acotado (p. ej. `admin_contrato` o `prevencionista_faena`, ambos ya presentes en el módulo con permisos CPHS).
2. Ese usuario abre /prevencion/cphs, pestaña Revisiones, o invoca `closeManagementReviewAction` con el id de una revisión de otra faena.

**Actual:** Vería y podría cerrar revisiones de faenas fuera de su alcance; hoy no ocurre sólo por la composición de roles, no por una barrera de código.
**Esperado:** Que el alcance se aplique en el propio servicio, como en el resto del módulo, para que un cambio de RBAC no abra una fuga.
**Impacto:** Ninguno con la configuración actual; deuda de defensa en profundidad en la única lectura del módulo sin predicado de alcance.
**Causa raíz:** Se asumió que el permiso implica visibilidad global en vez de expresarlo en la consulta.
**Corrección:** Aplicar `cphsScopeCondition(access.scope, preventionManagementReviews.worksiteId)` en `listManagementReviews` (contemplando las revisiones corporativas con `worksiteId` nulo, p. ej. `or(isNull(worksiteId), scoped)`), y en `closeManagementReview` verificar `requireAccess(access, "prevention:governance:review", review.worksiteId ?? undefined)` una vez cargada la revisión.

---

## CPHS-14 [INFORMATIONAL] — `expireLapsedCommittees` cambia el estado del comité sin incrementar `version` ni dejar traza en el historial de gobernanza
**Área:** CPHS · **Categoría:** Estado · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-cphs.ts:856-867` · **Componente:** `expireLapsedCommittees`

**Evidencia:** ```ts
857 export async function expireLapsedCommittees() {
858   const today = todayInChile()
859   const updated = await db.update(preventionCommittees)
860     .set({ status: "expired", updatedAt: nowIso() })
861     .where(and(
862       eq(preventionCommittees.status, "active"),
863       sql`${preventionCommittees.mandateEndsOn} < ${today}`,
864     ))
865     .returning({ id: preventionCommittees.id })
866   return { expired: updated.length }
867 }
```
Es el único cambio de estado del módulo que no llama a `recordGovernanceHistory` (compárese con `dissolveCommittee`, líneas 152-164, que además incrementa `version`). La tabla `prevention_governance_history` se documenta como «Historial inmutable» del gobierno del comité (db/schema/prevention/cphs.ts:342-356).

**Escenario:** 1. Un comité vigente (version 4) supera su `mandateEndsOn`.
2. El job diario lo marca `expired`.
3. Se revisa el historial del comité para explicar por qué dejó de estar vigente.

**Actual:** El historial no registra el vencimiento (sólo constitución, registro DT y disolución), y `version` sigue en 4 pese a haber cambiado el estado, de modo que un formulario cargado antes del vencimiento conserva un `expectedVersion` válido (la guarda de estado de `dissolveCommittee` lo detiene, pero por estado, no por versión).
**Esperado:** Todo cambio de estado del comité debe quedar en la bitácora y avanzar la versión, como el resto de las transiciones del módulo.
**Impacto:** Traza de gobernanza incompleta ante una fiscalización; inconsistencia menor del bloqueo optimista.
**Causa raíz:** El job se escribió como un UPDATE masivo sin pasar por el patrón de transición del módulo.
**Corrección:** Envolver el UPDATE en una transacción que devuelva las filas completas, incrementar `version` (`sql`${preventionCommittees.version} + 1``) y registrar una entrada por comité con `recordGovernanceHistory(tx, { entityType: "committee", changeType: "expired", ... })`, reusando el helper que ya importa el servicio.

---

## EMERGENCIAS-09 [INFORMATIONAL] — El plan no tiene dimensión temporal: ni fecha de revisión periódica ni periodicidad de simulacros; un plan aprobado en 2024 se sigue mostrando como "Vigente" indefinidamente
**Área:** Emergencias · **Categoría:** Lógica · **Confianza:** Media
**Ubicación:** `db/schema/prevention/emergency.ts:13-37,119-143; lib/services/prevention-emergency.ts:522-560` · **Componente:** `preventionEmergencyPlans / preventionEmergencyDrills / getEmergencyDashboardCounts`

**Evidencia:** La tabla de planes tiene `approvedAt` (:21) pero ninguna columna de vigencia, revisión ni próxima actualización — el listado completo de columnas es `id, worksiteId, code, title, status, description, approvedByUserId, approvedAt, createdByUserId, pdtpActivityNumbers, version, createdAt, updatedAt` (:14-28). La tabla de simulacros tampoco lleva periodicidad ni próxima fecha exigible (:119-135).

En consecuencia, ninguna consulta puede preguntar por vencimiento del plan. El panel cuenta estado, no vigencia:

```ts
// :527-528
approvedPlans: sql<number>`count(*) filter (where ${preventionEmergencyPlans.status} = 'approved')::int`,
draftPlans: sql<number>`count(*) filter (where ${preventionEmergencyPlans.status} = 'draft')::int`,
```

y la UI etiqueta ese contador como vigencia: `emergency-list.tsx:102` → `{ label: "Planes aprobados", value: counts.approvedPlans, detail: "Vigentes" }`. `getPreventionAttention` sólo levanta vencimientos de recursos, nunca de planes ni de simulacros (`prevention-attention.ts:211-233`). No existe ningún job, cron ni recordatorio que toque estas tablas (`grep` sobre el repo no encuentra consumidores fuera de los ya citados), así que tampoco hay problema de idempotencia que reportar: no hay nada que corra dos veces.

**Escenario:** 1. La faena A aprueba su plan de emergencia el 2024-03-01.
2. Pasan dos años sin revisión, sin simulacros y con cambios de proceso.
3. El panel sigue mostrando el plan bajo "Planes aprobados · Vigentes" y el detalle sigue con la insignia verde "Aprobado".
4. Nada en el sistema —ni el panel, ni la portada de Prevención, ni un recordatorio— indica que el plan está desactualizado ni que la faena debe un simulacro.

**Actual:** El sistema afirma vigencia a partir de un estado que nunca caduca. La obligación de revisión periódica del plan y la periodicidad de simulacros quedan enteramente fuera del software.
**Esperado:** Una fecha civil chilena de próxima revisión en el plan (`reviewDueOn`, poblada al aprobar con el período que fije Prevención) y una periodicidad de simulacros por plan o por escenario, ambas alimentando `getPreventionAttention` como ya lo hacen los equipos, y el contador "Vigentes" calculado contra esa fecha en vez del estado.
**Impacto:** El indicador de portada induce a error: "Vigentes" no significa vigente. Es también la brecha que impide que el módulo cumpla su función de recordatorio para la obligación periódica del DS 44 arts. 18-19.
**Causa raíz:** El ciclo de vida se modeló como máquina de estados (`draft/approved/archived`) sin eje temporal; el único vencimiento que el módulo conoce es el de los equipos, agregado después y por otra vía.
**Corrección:** Agregar `reviewDueOn text` al plan (fecha civil `YYYY-MM-DD`), calculada en `approveEmergencyPlan` desde `todayInChile()` más el período configurado — usar `addDaysToPlainDate` de `lib/utils.ts:281-283` o el helper de meses equivalente, nunca aritmética sobre `Date` UTC. Emitir el ítem de atención reutilizando `complianceAttentionItems` (mismo patrón que los recursos) y cambiar el contador del panel a "aprobados y dentro de su período de revisión". Para la periodicidad de simulacros, el camino barato es apoyarse en el PDTP (que ya es el motor de obligaciones periódicas del sistema) en vez de construir un segundo calendario aquí — eso además le da sentido a EMERGENCIAS-05.

**⚠️ Matiz del verificador:** Los hechos son ciertos: el listado de columnas de preventionEmergencyPlans (emergency.ts:14-28) no tiene vigencia ni proxima revision, preventionEmergencyDrills (:119-135) no tiene periodicidad, el panel cuenta estado (:527-528) y emergency-list.tsx:102 rotula 'Planes aprobados / Vigentes'. Pero esto no describe un defecto de codigo: no hay comportamiento incorrecto, ninguna consulta miente sobre el dato que tiene, y con el ciclo de vida existente 'aprobado' si equivale a 'no archivado', o sea vigente. Es una brecha de alcance funcional, y ademas es la misma brecha que EMERGENCIAS-02 vista por el otro lado (sin transicion a archived no puede haber caducidad de plan): reportarla aparte a MEDIUM es contar dos veces el mismo ciclo de vida a medio construir. Nota adicional: la portada si levanta vencimientos de equipos (prevention-attention.ts:252-270), asi que 'el modulo no tiene ningun reloj' es inexacto. INFORMATIONAL.

---

## EMERGENCIAS-11 [INFORMATIONAL] — El límite de 2000 trabajadores se aplica antes del filtro por faena: en alcance global, dotación de la faena del plan puede desaparecer de los selectores de organigrama y participantes
**Área:** Emergencias · **Categoría:** Lógica · **Confianza:** Media
**Ubicación:** `lib/services/prevention-emergency.ts:631-648; app/(app)/prevencion/emergencias/[planId]/page.tsx:36-40` · **Componente:** `listEmergencyWorkers / PlanEmergenciaPage`

**Evidencia:** El servicio trae la dotación de todo el alcance, ordenada por apellido y truncada:

```ts
// :641-647
.from(workers)
.where(and(
  eq(workers.isActive, true),
  access.scope.mode === "some" ? inArray(workers.worksiteId, access.scope.ids) : undefined,
))
.orderBy(asc(workers.lastName), asc(workers.firstName))
.limit(2000)
```

El filtro por la faena del plan ocurre después, en memoria, en la página:

```tsx
// [planId]/page.tsx:40
const eligibleWorkers = allWorkers.filter((worker) => worker.worksiteId === detail.plan.worksiteId)
```

Para `scope.mode === "all"` no hay `where` de faena en absoluto, así que el corte de 2000 se aplica sobre la dotación activa completa de la empresa, ordenada alfabéticamente.

**Escenario:** 1. La empresa supera los 2000 trabajadores activos.
2. Un prevencionista con rol global (alcance `all`) abre el plan de la faena A.
3. `listEmergencyWorkers` devuelve los primeros 2000 por apellido de toda la empresa.
4. Los trabajadores de la faena A cuyos apellidos caen después del corte no aparecen: no se pueden designar como titular ni reemplazo de un rol, ni marcar como presentes en un simulacro.
5. No hay ningún aviso — la lista simplemente sale incompleta.

**Actual:** Truncamiento silencioso que depende del apellido y del tamaño total de la empresa, no de la faena. `CompleteDrillDialog` construye el payload de participantes exactamente a partir de esa lista (`plan-detail.tsx:574`), así que el acta de asistencia nace incompleta.
**Esperado:** Filtrar por la faena en SQL. La faena del plan ya se conoce en la página antes de la consulta (`detail.plan.worksiteId`), así que el límite debería aplicarse sobre la dotación de esa faena, no sobre la de la empresa.
**Impacto:** Depende del tamaño de la dotación: nulo hoy si la empresa está muy por debajo de 2000 activos, silencioso y difícil de diagnosticar cuando lo supere. No compromete integridad ni permisos.
**Causa raíz:** `listEmergencyWorkers` se diseñó como consulta genérica de alcance y el recorte por faena se dejó a la vista; el `limit` quedó del lado equivocado del filtro.
**Corrección:** Agregar un parámetro `worksiteId` a `listEmergencyWorkers` (intersecándolo con el alcance, como hace `worksiteScopeSql` en `lib/auth/scope.ts`) y llamarla desde `[planId]/page.tsx` con `detail.plan.worksiteId`, eliminando el `.filter` en memoria de la línea 40. El `limit(2000)` pasa entonces a ser por faena, que es holgado.

**⚠️ Matiz del verificador:** El codigo esta bien leido (:641-647 filtra por alcance y trunca a 2000; [planId]/page.tsx:40 filtra por faena en memoria), pero el encuadre como defecto de Emergencias es incorrecto por dos razones que el auditor no verifico. Primero, es una convencion del repo, no una decision local: el bloque es identico, campo por campo y con el mismo limit(2000), en prevention-permits.ts:795-808, prevention-cphs.ts:940-953, prevention-hygiene.ts:515 y prevention-training.ts:866,918 (dos veces). Arreglarlo solo aqui no cambia nada. Segundo, el umbral es inalcanzable a la escala modelada: el propio seed dimensiona faenas de 25 a 120 trabajadores (scripts/seed-demo.ts:661 'const trabajadores = int(25, 120)'), asi que hacen falta ~20 faenas simultaneas en alcance global para topar el corte. Truncamiento silencioso latente, si; hallazgo MEDIUM del modulo Emergencias, no.

---

## EMERGENCIAS-12 [INFORMATIONAL] — El código del plan usa el año UTC: un plan creado el 31 de diciembre después de las 21:00 en Chile nace etiquetado con el año siguiente
**Área:** Emergencias · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-emergency.ts:115` · **Componente:** `createEmergencyPlan`

**Evidencia:** ```ts
// :115
code: `PE-${new Date().getUTCFullYear()}-${nanoid(6).toUpperCase()}`,
```

El mismo archivo tiene, doce líneas más arriba, el helper correcto para la fecha civil chilena (`todayInChile`, :34-38) y lo usa bien en el panel (:540-541). El repo tiene además `todayInChile()` en `lib/utils.ts:275-278`.

**Escenario:** 1. Se crea el plan de emergencia de la faena A el 2026-12-31 a las 21:30 hora de Chile (UTC-3).
2. En UTC ya es 2027-01-01, así que `getUTCFullYear()` devuelve 2027.
3. El plan queda con código `PE-2027-XXXXXX` aunque se emitió el 31 de diciembre de 2026 y `createdAt` lo confirma.

**Actual:** Etiqueta con el año equivocado durante las últimas tres o cuatro horas de cada 31 de diciembre.
**Esperado:** `PE-${todayInChile().slice(0, 4)}-…`.
**Impacto:** Sólo cosmético: ninguna lógica deriva del año del código (la unicidad la da el `nanoid`, y el índice único de la tabla es por `code` completo). Se reporta porque es la misma clase de defecto de fecha que el resto del informe y cuesta una línea. Nota: `lib/services/prevention-capa.ts:224` (`createCode`) tiene exactamente el mismo patrón, fuera del alcance de esta área.
**Causa raíz:** Formateo de fecha con la API nativa en UTC en vez del helper de día civil chileno del repo.
**Corrección:** `code: \`PE-${todayInChile().slice(0, 4)}-${nanoid(6).toUpperCase()}\`` usando el helper local ya definido en :36 (o, mejor, importando el de `@/lib/utils` y borrando la copia local de :34-38).

---

## LEGAL-08 [INFORMATIONAL] — La fecha por defecto de "Vigente desde" se calcula en UTC, no en calendario chileno: entre las 20:00 y medianoche propone el día siguiente
**Área:** Requisitos legales · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx:48` · **Componente:** `CreateRequirementDialog`

**Evidencia:** En el campo de vigencia del diálogo de creación:
```
<Field label="Vigente desde"><DatePicker name="validFrom" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
```
`toISOString()` devuelve UTC; Chile está en UTC-4/-3, así que a partir de las 20:00 (o 21:00 en horario de verano) hora local el valor por defecto ya es la fecha del día siguiente. El repositorio tiene el helper correcto para esto: `todayInChile()` en lib/utils.ts:275 (y `chileDateParts` en :262), que es lo que usa el servicio (`prevention-risk-legal.ts:83-87`).

**Escenario:** 1. Un prevencionista abre "Nuevo requisito" a las 21:30 del 15 de agosto en Chile.
2. Deja el valor por defecto de "Vigente desde" y completa el resto.
3. Guarda el borrador.

**Actual:** El requisito queda con `validFrom` = 2026-08-16, un día después del que el usuario cree haber puesto. Como el campo no se valida contra ninguna otra fecha ni se muestra prominente, el error pasa al hash de publicación (`sha256({... validFrom ...})`, servicio :558) y al Excel sin que nadie lo note.
**Esperado:** El valor por defecto debe ser el día civil chileno, igual que en el resto del código de fechas del repositorio.
**Impacto:** Bajo hoy porque `validFrom` no se usa para filtrar (ver LEGAL-03), pero queda registrado en el hash de publicación y en el registro legal exportable; y si se implementa LEGAL-03 el error pasa a tener efecto funcional.
**Causa raíz:** Se usó `toISOString().slice(0,10)` como atajo en el cliente en vez del helper de calendario chileno que ya existe en lib/utils.ts.
**Corrección:** Sustituir por `todayInChile()` de `@/lib/utils` (es una función pura, segura en el cliente). Conviene además revisar si otros formularios del módulo repiten el atajo.

**⚠️ Matiz del verificador:** The code and the timezone arithmetic are exactly as described — workbench.tsx:48 contains `<Field label="Vigente desde"><DatePicker name="validFrom" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>`, DatePicker seeds its uncontrolled state straight from it (`React.useState(defaultValue ?? "")`, components/ui/date-picker.tsx), and `toISOString()` is UTC regardless of TZ, so from 20:00/21:00 Chile the default is tomorrow.

BUT the framing 'se usó un atajo en vez del helper que ya existe' is misleading: `toISOString().slice(0,10)` is the prevailing convention here, present in 22 files under app/ and components/ (dashboard/sections/shared.ts, miper/page.tsx, incidentes/[id]/re20-panel.tsx, inspecciones/inspections-screen.tsx, epp-preventivo/epp-gap-list.tsx, cphs/page.tsx, …). Fixing only this call site is arbitrary; it is a repo-wide convention gap, not a module defect. Impact is also the smallest possible: it is a pre-filled default the user sees and can change in the picker, on a column that no query ever reads (see LEGAL-03).

---

## MIPER-11 [INFORMATIONAL] — Aprobar un lote de importación en carrera devuelve éxito sin haber aprobado nada
**Área:** MIPER · **Categoría:** Concurrencia · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-risk-import.ts:344-357` · **Componente:** `approveRiskImportBatch`

**Evidencia:** prevention-risk-import.ts:353-356
```
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionRiskImportBatches).set({ status: "approved", approvedByUserId: access.userId, approvedAt: now }).where(and(eq(preventionRiskImportBatches.id, batch.id), eq(preventionRiskImportBatches.status, "staged"))).returning()
    return updated!
```
El `WHERE ... status = 'staged'` es un compare-and-swap correcto, pero cuando no afecta filas `updated` es `undefined` y el `!` no lanza: la función devuelve `undefined` y `run()` (app/(app)/prevencion/miper/actions.ts:41-43) responde `{ ok: true }`. Todas las operaciones hermanas de este archivo sí lanzan en ese caso (por ejemplo prevention-risk-legal.ts:431 `if (!updated) throw new Error("La MIPER cambió mientras la revisabas...")`). El mismo patrón está en `resolveRiskImportRow` (línea 340 `return updated!`).

**Escenario:** 1. Dos aprobadores abren el mismo lote `staged` y pulsan "Aprobar" casi a la vez.
2. Ambas transacciones leen `status = 'staged'` y pasan la guardia de la línea 350.
3. La primera confirma; la segunda desbloquea, reevalúa el WHERE y no encuentra filas.

**Actual:** El segundo aprobador ve la operación como exitosa aunque no aprobó nada; el lote queda con `approvedByUserId` del primero. El registro de quién aprobó no coincide con lo que la interfaz le confirmó al segundo, y la segregación "quien importó no aprueba" (línea 349) se evaluó contra un estado ya superado.
**Esperado:** Debe lanzarse el mismo error de conflicto que el resto del módulo ("el lote cambió mientras lo revisabas").
**Impacto:** Falso positivo en una decisión con responsabilidad nominal (aprobación de la carga de una MIPER). No corrompe datos, pero engaña al segundo aprobador sobre un acto que queda registrado a nombre de otro.
**Causa raíz:** Aserción de no-nulidad (`!`) usada donde el resto del código base usa una guardia explícita con throw.
**Corrección:** Reemplazar `return updated!` por `if (!updated) throw new Error("El lote cambió mientras lo revisabas. Recarga antes de continuar."); return updated` en `approveRiskImportBatch` y en `resolveRiskImportRow`.

**⚠️ Matiz del verificador:** The code observation is exact but the stated harm is wrong. `prevention-risk-import.ts:353-356` is verbatim as quoted and `return updated!` is a TypeScript non-null assertion that is erased at runtime, so a lost CAS race does return `undefined` and `run()` (actions.ts:38-48) reports `{ ok: true }` — that part is true, and it does deviate from the sibling pattern at prevention-risk-legal.ts:431. But the headline "devuelve éxito sin haber aprobado nada" is false: the WHERE only misses because the FIRST transaction already set `status='approved'`, so the second approver's requested end state (batch approved, `needs_review` rows already blocked by :351-352, SoD already enforced by :349) holds when the message is shown. Nothing is lost but the second actor's identity in `approvedByUserId`, which is the correct semantics for a CAS. No caller dereferences the return (actions.ts:118 discards it), so there is no crash path either. Worth a one-line guard for consistency; no user-visible defect today.

---

## MOC-09 [INFORMATIONAL] — El código del cambio usa el año UTC: entre las 21:00 y medianoche del 31 de diciembre en Chile se emite con el año siguiente
**Área:** MOC (gestión del cambio) · **Categoría:** Datos · **Confianza:** Alta
**Ubicación:** `lib/services/prevention-change.ts:96` · **Componente:** `createChangeRequest`

**Evidencia:** ```ts
// lib/services/prevention-change.ts:96
code: `GC-${new Date().getUTCFullYear()}-${nanoid(6).toUpperCase()}`,
```
El código es el identificador civil del expediente y lleva el año UTC, mientras que el repositorio tiene una función explícita para el día civil chileno, `todayInChile()` (lib/utils.ts:275), usada sistemáticamente en el resto de Prevención (prevention-cphs.ts:858, prevention-emergency.ts:540-541, prevention-epp.ts, prevention-hygiene.ts, prevention-capa.ts:45).

El mismo patrón está en `createCode()` de CAPA (lib/services/prevention-capa.ts:223-225: `CAPA-${new Date().getUTCFullYear()}-...`), así que el arreglo debería ser compartido y no local a este archivo.

**Escenario:** 1. Chile está en horario de verano (UTC-3). Son las 21:30 del 31 de diciembre de 2026 en faena.
2. Un prevencionista registra un cambio urgente.
3. `new Date().getUTCFullYear()` ya devuelve 2027 (en UTC son las 00:30 del 1 de enero).
4. El código emitido es `GC-2027-XXXXXX`, pero `createdAt` corresponde al 31-12-2026 en hora de Chile y el expediente pertenece al ejercicio 2026.

**Actual:** Durante una ventana de tres horas cada fin de año, el año del código no coincide con el año civil chileno del registro. La correlación por año (búsqueda, archivo, informes anuales) devuelve el expediente en el ejercicio equivocado.
**Esperado:** El año del código debe salir del día civil chileno: `todayInChile().slice(0, 4)`.
**Impacto:** Muy bajo en volumen (tres horas al año), pero afecta a un identificador impreso en documentación y usado para correlacionar por ejercicio, que no se puede corregir después sin romper referencias externas.
**Causa raíz:** Se usó el reloj UTC para derivar una fecha civil, la clase de error que este repositorio ya identificó y aisló en `todayInChile()`. La función existe; aquí no se usó.
**Corrección:** Cambiar a `todayInChile().slice(0, 4)` en lib/services/prevention-change.ts:96 y, en la misma pasada, en lib/services/prevention-capa.ts:224 — es el mismo defecto y el mismo arreglo de una línea; corregir sólo MOC deja el hermano roto.

**⚠️ Matiz del verificador:** The line is exactly as quoted (`code: `GC-${new Date().getUTCFullYear()}-${nanoid(6).toUpperCase()}``, prevention-change.ts:96) and `todayInChile()` does exist, but this is a uniform convention across the whole Prevención module, not a MOC slip: prevention-emergency.ts:115 `PE-${new Date().getUTCFullYear()}`, prevention-cphs.ts:607 `CPHS-...` and :763 `RD-...`, prevention-training.ts:83 `CAP-...`, prevention-permits.ts:82 `PT-...`, prevention-inspections.ts:339 `INSP-...`, prevention-capa.ts:223-225 `CAPA-...` — seven identical call sites. The impact is cosmetic: the code is an opaque unique identifier whose discriminator is a `nanoid(6)` suffix; nothing in the tree parses, filters, sorts or reports on the year segment (the only `code` consumers are the unique index, the search key in change-list.tsx and the page header), and the divergence window is ~3-4 hours once a year. Severity LOW is too high for a repo-wide cosmetic convention; if it is worth fixing it is one shared helper, as the auditor themselves notes.

---

## PPA-08 [INFORMATIONAL] — El esquema sólo protege la coherencia del trío de cancelación; verificación, autorización y cierre pueden quedar a medias si algo escribe fuera del servicio
**Área:** PPA · **Categoría:** Datos · **Confianza:** Media
**Ubicación:** `db/schema/ppa.ts:74-82` · **Componente:** `ppaSubmissions (constraints)`

**Evidencia:** Las únicas restricciones son:

```ts
79:  check("ppa_submissions_estado_check", sql`… IN ('aprobado_auto', …, 'cerrado')`),
80:  check("ppa_submissions_version_check", sql`${table.version} >= 1`),
81:  check("ppa_submissions_cancel_check", sql`(cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL) OR (… length(cancellation_reason) >= 5)`),
```

No hay equivalente para `(verified_at, verified_by_user_id)`, `(authorized_at, authorized_by_user_id)` ni `(closed_at, closed_by_user_id, estado='cerrado')`, pese a que el dominio los trata como indivisibles. Hoy el servicio los escribe siempre en pareja (lib/services/ppa-module/reportes.ts:252-258, 287-292, 353-355), así que no hay estado inconsistente alcanzable por la UI — por eso es informativo. Pero la tabla ya recibe escrituras desde fuera del servicio PPA: lib/services/prevention-privacy-rights.ts:258 y :262-269 actualizan identidad del titular directamente, sin pasar por el motor de estados y sin incrementar `version`.

**Escenario:** Un futuro backfill, script de datos o nueva ruta escribe `closed_at` sin `estado='cerrado'` (o `verified_at` sin verificador). La base lo acepta.

**Actual:** El registro quedaría con un cierre a medias que los listados y el export leerían como válido, sin que nada lo detecte.
**Esperado:** La base debería rechazar cualquier combinación que el dominio no admite, igual que ya hace con la cancelación.
**Impacto:** Ninguno hoy; es defensa en profundidad para el invariante más caro de reconstruir a posteriori (la trazabilidad de quién verificó, autorizó y cerró un trabajo detenido).
**Causa raíz:** El CHECK de cancelación se añadió reaccionando a un caso concreto y no se generalizó a los otros tres pares actor/marca temporal.
**Corrección:** Migración con tres CHECK simétricos al de cancelación: `(verified_at IS NULL) = (verified_by_user_id IS NULL)`, `(authorized_at IS NULL) = (authorized_by_user_id IS NULL)` y `(estado = 'cerrado') = (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)`. Verificar antes con un SELECT que no haya filas históricas que las incumplan (el flujo actual no debería producirlas).

---
