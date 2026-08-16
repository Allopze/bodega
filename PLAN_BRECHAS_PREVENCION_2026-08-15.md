# Plan de implementación — brechas de cobertura de Prevención

> **EJECUTADO Y VERIFICADO — 2026-08-15.** Todas las fases implementadas.
> `npx tsc --noEmit` limpio, `eslint` limpio, **4087 tests en verde**.
> Migraciones **0169** (interacciones externas), **0170** (protocolos MINSAL) y
> **0171** (equipos de emergencia, con backfill). Pendiente al desplegar:
> `npm run db:migrate` y **`npm run db:sync-rbac`** — la Fase 2 agrega dos permisos y
> sin el sync no llegan a una base ya poblada.

## Contexto

`BRECHAS_COBERTURA_PREVENCION_2026-08-15.md` documentó 13 brechas del módulo de Prevención
frente al **DS 44/2024**, **ISO 45001:2018** y dos implementaciones reales (Safeti, EHS Insight).
Tres son elementos que el DS 44 declara obligatorios y no existen. Este plan las convierte en
fases ejecutables.

Al explorar el código para planificarlas, **tres entradas del backlog resultaron mal
planteadas**. Corregirlas es la mitad del valor de este documento:

| Brecha | Lo que decía el backlog | Lo que dice el código |
|---|---|---|
| **B-01 Auditoría** | Módulo nuevo (~6 tablas) | `preventionInspectionTemplates.kind` **ya admite `'audit'`**, `INSPECTION_KIND_LABELS.audit` ya existe, el `<Select>` de la UI ya lo ofrece ([inspection-catalog.tsx:258](app/(app)/prevencion/inspecciones/catalogo/inspection-catalog.tsx#L258)) y el `sourceType 'audit'` ya está en `pdtp_source_links`. **Cero tablas nuevas.** |
| **B-03 Contratistas** | Registro de contratistas + DS 76 | Chome es la **empresa contratista**, no la principal (`preventionInspectionRuns.origin` incluye `'mandante'`; [permits.ts:8](db/schema/prevention/permits.ts#L8)). El DS 76 recae en su cliente. Lo que sí aplica es el **Art. 20**, que es simétrico: *"deberán informarse mutuamente de los riesgos, las medidas y los planes de emergencia"*. **Se reemplaza por 1 tabla.** |
| **B-13 Instrumento vs entrega** | Falta separarlos | **Ya existe**: `sstDocumentDistributionTargets` con destinatario polimórfico, `assignDocumentVersionRecipients`, `acknowledgeDocumentVersion` con lock, recordatorios y `[id]/distribution-tab.tsx`. **Se descarta.** |

Resultado: 13 brechas → **11 reales**, y la P0 más cara pasa a ser la más barata.

---

## Principios

1. **Reusar motor antes que crear tabla.** El repo ya tiene tres motores maduros: inspecciones
   (plantilla versionada → programación → corrida → hallazgo → CAPA), la biblioteca documental
   (documento → versión → publicación → distribución nominativa → acuse firmado) y CAPA.
   Casi todas las brechas son superficie sobre uno de esos tres.
2. **Enganchar a CAPA y a PDTP, no reinventar seguimiento.** Todo hallazgo termina en
   `createCapaActionWithClient` dentro de la transacción del módulo.
3. `modules/` está FROZEN (AGENTS.md): solo `manifest.ts`. La lógica va a `lib/services/`,
   `lib/validation/prevention-module/`, `lib/prevention/` y `app/(app)/prevencion/<x>/actions.ts`.

---

## Fase 1 — Superficie sobre motores existentes · sin esquema nuevo ✅ IMPLEMENTADA

La fase de mayor valor por línea de código. Cierra una P0 y dos P2 sin una sola migración.

> **Estado 2026-08-15:** completa y verificada. 4065 tests en verde, typecheck y lint limpios.
> Cambios sobre lo planeado: (a) Auditorías quedó en `/prevencion/auditorias`, no en
> `?kind=audit`, porque `isHrefActive` compara sólo el pathname y las dos filas se habrían
> resaltado juntas; (b) la pantalla del motor se extrajo a `inspections-screen.tsx` y la comparten
> ambas rutas; (c) `WeeklyScheduledSection` se movió a Aprobaciones con sus tests, y
> `PendingApprovalSection` se borró por ser la versión pobre de la misma cola.

### 1.1 · B-01 Auditoría del SGSST (P0 — DS 44 art. 22 n°4 · ISO 45001 §9.2)

- **Crear** `lib/sst/definitions/auditoria-sgsst.ts` — una `ChecklistDefinition` cuyas secciones
  son los elementos del **Art. 22** (política, estructura organizacional, diagnóstico y
  programación, evaluación periódica) cruzados con las cláusulas ISO 45001 §4–§10.
  Usar `ChecklistDefinition` de [lib/sst/types.ts](lib/sst/types.ts); mirar
  `inspeccion-taller.ts` como molde de forma.
- **Registrar** en `CHECKLIST_DEFINITIONS` de [lib/sst/definitions/index.ts](lib/sst/definitions/index.ts).
  No agregarla a `PERSON_EVALUATION_DEFINITION_CODES`.
- **Backend: nada.** `importInspectionTemplate` ya valida `kind: z.enum([...,"audit"])`
  ([prevention-inspections.ts:101](lib/services/prevention-inspections.ts#L101)) y el ciclo completo
  —aprobación con segregación autor≠aprobador, programa anual, corrida, hallazgos con criticidad,
  `createFindingCapa`, revisión con ejecutante≠revisor— ya funciona.
- **Filtro por `kind`** en `listInspectionRuns` / `listInspectionTemplates`. `templateKind` ya
  viaja en ambas lecturas ([:666](lib/services/prevention-inspections.ts#L666), [:687](lib/services/prevention-inspections.ts#L687)).
- **Sidebar**: fila `Auditorías` → `/prevencion/inspecciones?kind=audit`, grupo `"Seguimiento"`,
  en [modules/prevention/manifest.ts](modules/prevention/manifest.ts).
- **Rama `audit`** en `linkPdtpActivitySource` ([prevention-risk-legal.ts:723](lib/services/prevention-risk-legal.ts#L723))
  para que resuelva un `sourceVersionSnapshot` real en vez de caer en `"Fuente manual"`.

> **Decisión de permisos:** reusar `prevention:inspections:*`. Un permiso `prevention:audit:*`
> separado obligaría a duplicar los guards de todo el motor por un solo `kind`.

### 1.2 · B-11 Deduplicar la bandeja PDTP (P2)

`/pdtp/obligaciones` y `/pdtp/aprobaciones` llaman ambas a `listPendingPdtpExecutions`.

- En [pdtp/obligaciones/page.tsx](app/(app)/prevencion/pdtp/obligaciones/page.tsx): quitar
  `listPendingPdtpExecutions` y `findPdtpWeeklyPending` del `Promise.all` y los props
  `pendingApproval` / `weeklyPending`.
- En `pdtp-obligations-workbench.tsx`: borrar las dos pestañas correspondientes. Queda dedicada
  a los casos `on_demand`/`triggered`, que es su razón de existir.
- Mover la bandeja de **pendientes calendarizados** (`findPdtpWeeklyPending`) a
  [pdtp/aprobaciones/page.tsx](app/(app)/prevencion/pdtp/aprobaciones/page.tsx), junto a las
  ejecuciones pendientes.

### 1.3 · B-10 Mapa de riesgos como destino propio (P2 — DS 44 art. 62)

Es un instrumento distinto de la matriz IPER, con exigibilidad propia, y hoy está escondido como
pestaña. `riskMap` ya es un prop independiente en
[miper-workbench.tsx:134](app/(app)/prevencion/miper/miper-workbench.tsx#L134), así que
`RiskMapPanel` se monta en `/prevencion/miper/mapa` sin tocar servicios.
Fila nueva en el sidebar, grupo `"Programa"`, bajo Matriz IPER.

**Verificación de fase:** `npx vitest run lib/__tests__/navigation.test.ts` (las filas nuevas rompen
la aserción de orden y el check de contigüidad — actualizar ambas), luego crear una plantilla de
auditoría end-to-end desde la UI y llevarla hasta CAPA.

---

## Fase 2 — Interacciones con externos (B-03' + B-05 + B-06 fusionadas, P0+P1)

> **Revisión posterior a la aprobación:** la Fase 5 (coordinación Art. 20) se fusiona aquí.
> Coordinación con el mandante, fiscalización DT/SEREMI y visita del organismo administrador
> comparten ~90% de columnas: fecha, contraparte externa, acta, compromisos con plazo. Tres
> tablas serían tres servicios, tres páginas, tres `sourceType` y tres whitelists de doc-links
> para el mismo formulario.

- **Crear** `db/schema/prevention/external-engagements.ts`:
  - `prevention_external_engagements` — `code` único, `worksiteId`, `kind`
    (check `coordinacion|fiscalizacion|organismo_administrador`), `direction`
    (check `received|delivered`), `counterpartyType`, `counterpartyName`, `counterpartyRut`,
    `occurredOn`, `subject`, `outcome`, `officialReference`, `closedAt`, `version`.
  - `check ..._direction_consistent`: `kind = 'coordinacion' OR direction = 'received'`.
    **Este check es lo que justifica la fusión**: el Art. 20 es simétrico, una fiscalización
    nunca lo es.
  - `check ..._official_ref_required`: `kind = 'coordinacion' OR length(official_reference) >= 3`.
  - `prevention_external_engagement_history` — copiar la forma de `preventionInspectionHistory`.
  - Línea en [db/schema/prevention/index.ts](db/schema/prevention/index.ts).
- **Sin tabla de hallazgos ni de compromisos.** Cada medida prescrita es una fila CAPA:
  `sourceItemId = '${engagementId}:${n}'` da idempotencia por el `uniqueIndex` existente, y
  `normativaLegal` guarda el artículo que citó el fiscalizador. Una tabla de compromisos sería
  un CAPA peor. ⚠️ Numerar por orden de creación monotónico, nunca por índice de array: si el
  usuario reordena las medidas, la renumeración crea CAPAs huérfanas.
- **`sourceType` nuevo `external_visit` en CAPA** — 3 puntos textuales: el check
  `prevention_capa_source_type_valid` en [capa.ts](db/schema/prevention/capa.ts) (+migración),
  `capaCreateSchema.sourceType` en [prevention-capa.ts:54](lib/services/prevention-capa.ts#L54),
  y `CAPA_SOURCE_LABELS` + `capaSourceHref` en [lib/prevention/capa.ts](lib/prevention/capa.ts).
- **Servicio** `lib/services/prevention-external-visits.ts` copiando el molde de acceso de
  `prevention-inspections.ts` (`requireAccess` / `scopeAllows` / `scopeCondition` / `history`).
  Usar `sourceItemId` al crear la CAPA: su `uniqueIndex` da idempotencia por hallazgo gratis.
- Ruta `app/(app)/prevencion/visitas/` + fila en el sidebar, grupo `"Seguimiento"`.

> **Por qué importa el Art. 70:** las medidas que prescribe el organismo administrador son de
> cumplimiento obligatorio. Hoy no hay dónde registrarlas, y por lo tanto no hay forma de
> demostrar que se cumplieron.

---

## Fase 3 — Protocolos MINSAL (B-04, P1)

Hoy el protocolo es **texto libre en dos columnas** (`preventionExposureAgents.surveillanceProtocol`
y `preventionSurveillancePrograms.protocol`, cuyo hint de UI dice literalmente *"Ej: PREXOR,
CEAL-SM, vigilancia sílice"*). El fiscalizador pregunta por protocolo; hoy no se puede responder
"¿qué % del PREXOR tengo cumplido?".

El protocolo es **ortogonal al `agentType`** (PREXOR es `physical`, sílice `chemical`, psicosocial
`psychosocial`), así que se injerta sin tocar ese check.

> **Revisión posterior a la aprobación:** el catálogo NO lleva tabla. Ocho protocolos que
> cambian cuando cambia el MINSAL son una constante TS, igual que `lib/sst/definitions`.
> Solo la aplicabilidad por faena necesita persistirse.

- **`lib/prevention/minsal-protocols.ts`** (constante, no tabla): PREXOR, psicosocial (CEAL-SM),
  sílice (PLANESI), citostáticos, hiperbaria, frío/calor, UV, TMERT-EESS. Cada uno con `code`,
  `name`, `legalBasis`, `defaultPeriodicityMonths`, `agentTypeHint` y `checklistDefinitionCode?`.
- En [db/schema/prevention/hygiene.ts](db/schema/prevention/hygiene.ts), **una sola tabla**:
  - `prevention_protocol_applicabilities` — `protocolCode`, `worksiteId`, `status`
    (check `applicable|not_applicable|pending_assessment`), `justification`, `periodicityMonths`,
    `lastAssessedOn`, `nextAssessmentOn`, `version`.
  - `uniqueIndex` sobre `(worksite_id, protocol_code)`.
  - `check ..._justification_required`: `status <> 'not_applicable' OR length(justification) >= 10`
    — descartar un protocolo obligatorio sin justificar es lo que la DT sanciona.
- **Las columnas de protocolo existentes se validan solo en Zod, sin `check` SQL.**
  `preventionExposureAgents.surveillanceProtocol` y `preventionSurveillancePrograms.protocol` son
  texto libre hoy, y `prevention-hygiene-postgres.test.ts:170` inserta `"Protocolo Sílice MINSAL"`
  como texto: un enum estricto en la BD lo rompe. Validación en el borde, tolerante con lo legado.
- **El % de cumplimiento no se calcula de nuevo**: `checklistDefinitionCode` apunta a una
  definición del catálogo, y el porcentaje es el `compliancePercent` de la última corrida del motor
  de inspecciones para esa plantilla y faena. Las "tareas" del protocolo son los ítems de la
  definición.
- `MINSAL_PROTOCOL_LABELS` en [lib/prevention/hygiene.ts](lib/prevention/hygiene.ts), al lado de
  `AGENT_TYPE_LABELS`.
- **Extraer los schemas Zod inline** (`agentSchema` :94, `programSchema` :266) a
  `lib/validation/prevention-module/hygiene.ts`, que hoy no existe — es el único dominio de
  Prevención sin su archivo de validación.
- `listMinsalProtocols` + join en `listSurveillancePrograms`, para "cobertura por protocolo".
- **UI: pestaña dentro de Higiene y vigilancia**, no fila nueva del sidebar. El módulo ya tiene
  dashboard; un destino más por un eje de clasificación no lo justifica.
- `sourceType` nuevo `protocolo_minsal` en `pdtp_source_links` (5 puntos, ver §Transversales).

---

## Fase 4 — Reglamento Interno (B-02, P0 — DS 44 arts. 56–61)

**Cero tablas nuevas.** Es un documento versionado con distribución nominativa, y la biblioteca ya
hace exactamente eso.

- Alta de `sstDocumentCategory` + `sstDocumentType` para RIOHS.
- **Plantilla del contenido mínimo del Art. 58** como `contentOutline`: preámbulo (art. 67 ley
  16.744 + art. 154 Código del Trabajo) y capítulo de disposiciones generales con los ocho literales
  (a) exámenes médicos, (b) notificación e investigación de accidentes, (c) facilidades a CPHS y
  Depto. Prevención, (d) responsabilidades de jefaturas, (e) selección/uso/mantención de EPP,
  (f) riesgo grave e inminente, (g) plan de emergencias, (h) propuestas y reclamos.
  Más arts. 59 (obligaciones), 60 (prohibiciones) y 61 (sanciones).
- **Al publicar, distribuir a toda la dotación** vía `assignDocumentVersionRecipients`.
  ⚠️ Tiene tope de 200 destinatarios: para una dotación mayor hay que paginar la asignación
  o subir el tope conscientemente.
- Vista de cobertura: *"% de la dotación con acuse del RIOHS vigente"*, leyendo
  `listDocumentDistribution`. Los recordatorios ya existen en
  `lib/services/prevention-document-ack-reminders.ts`.

---

## Fase 5 — *(fusionada en la Fase 2)*

La coordinación del Art. 20 comparte tabla con fiscalizaciones y visitas del organismo
administrador. Ver Fase 2.

---

## Fase 6 — Equipos de emergencia (B-07, P1)

`preventionEmergencyResources` **ya es el inventario** (`name`, `kind`, `location`,
`lastInspectedAt`, `nextInspectionAt`, `status`). Tiene tres defectos:

1. **Cuelga del plan con `onDelete: cascade`.** Archivar un plan y crear el siguiente borra el
   inventario. Un extintor pertenece a la faena, no al documento.
   → `worksiteId` notNull + `planId` nullable. **Requiere backfill desde el plan antes de relajar
   la FK** — es la migración más delicada del plan.
2. **No hay vencimiento del equipo.** `nextInspectionAt` es la próxima revisión, distinto de la
   carga del extintor o la caducidad del botiquín. → `expiresAt`, `serialNumber` opcional.
3. **Nadie consulta las fechas.** No están en `getEmergencyDashboardCounts`
   ([:506](lib/services/prevention-emergency.ts#L506)) y no existe `prevention-emergency-reminders.ts`
   (sí existen los de capa, cphs, training e incident). → crearlo copiando cualquiera de los cuatro,
   y sumar el contador de vencidos al dashboard y a la cola operacional.

---

## Fase 7 — Cierre barato

- **B-08 Comité Bipartito (SENCE) — recomendación: diferir y decirlo.** `preventionCommittees`
  tiene un `uniqueIndex` de comité activo por faena **sin discriminador de tipo**: meter el
  bipartito ahí exige reescribir ese índice y auditar `resolvePreventiveOrganization`,
  `assessOrganizationCompliance` y `cphsAttentionItems` para que no lo cuente como paritario. Es
  la migración más arriesgada de las 12 brechas para la de menor valor. Su producto real son dos
  actas (constitución y plan anual de capacitación), o sea documentos: cubrirlo con un
  `sstDocumentType` es el diff de cero líneas de esquema.
- **B-12 Subagrupar Registro documental por sujeto.** *Verificar antes de construir*: la biblioteca
  ya tiene carpetas jerárquicas (`sstDocumentFolders`, árbol autorreferente). Si una convención de
  carpetas raíz `Empresa / Trabajador / Contratista / Externa` resuelve el caso, esto es
  configuración, no código.
- **B-09 Calendario transversal — la versión barata.** No existe componente `Calendar` en el repo
  (solo `date-picker`), y construir uno para unir once columnas de fecha distintas no se paga.
  `/pendientes` **ya agrega por `overdue`/`today` con `source_due_at`**
  ([operational-work-queue.ts:866](lib/services/operational-work-queue.ts#L866)). Agrupar ahí por
  semana/mes cubre el 90% del valor. Si después se pide un calendario visual, ya estará el dato.

---

## Trabajos transversales

Hacer una vez, no por fase:

1. **Ampliar `DOCUMENT_LINK_ENTITY_TYPES`** ([links.ts:20-33](lib/services/prevention-documents/links.ts#L20))
   para auditorías, visitas externas y coordinación. La whitelist TS es **más estrecha que el check
   SQL** de `sst_document_links`; hay que ampliar ambos y extender `resolveDocumentLinkTarget`.
   Sin esto, ninguna fase nueva puede adjuntar evidencia real.
2. **Receta de `sourceType` nuevo en `pdtp_source_links`** (5 puntos): check SQL en
   [risk-legal.ts:389](db/schema/prevention/risk-legal.ts#L389), `z.enum` en
   [validation/prevention-module/risk-legal.ts:164](lib/validation/prevention-module/risk-legal.ts#L164),
   rama en `linkPdtpActivitySource`, y en `pdtp-coverage-workbench.tsx` el label map, `sourceHref`,
   el `<SelectItem>` y la lista que decide si `sourceId` es obligatorio.
3. **Bug huérfano, arreglar de paso:** el check SQL de `pdtp_source_links` admite `'incident'`
   pero el `z.enum` no lo incluye → valor inalcanzable desde la aplicación. Decidir si se agrega
   al enum o se quita del check.

**Lo que NO hay que hacer:** generalizar `sstDocumentDistributionTargets` a `(entityType, entityId)`.
Sirve tal cual para la Fase 4, y las otras dos implementaciones de acuse nominativo (asistencia a
capacitación, cuadrilla de permisos) no están pidiendo unificarse. Es sobre-ingeniería hasta que
aparezca un tercer consumidor real.

---

## Orden, paralelismo y dependencias

```
Fase 1  (sin esquema)  ─┬─→ Fase 2  (visitas)
                        ├─→ Fase 3  (protocolos)     ← independientes entre sí
                        └─→ Fase 4  (RIOHS)

Transversal 1 (document links) ─→ requisito de Fases 2 y 5
Transversal 2 (sourceType)     ─→ requisito de Fases 1.1 y 3

Fase 5, 6, 7 ─ sin dependencias, en cualquier momento
```

Fase 1 primero **siempre**: cierra una P0 con cero riesgo de migración y valida que el motor de
inspecciones aguanta el caso auditoría antes de comprometerse a nada más.
Las fases 2, 3 y 4 son paralelizables entre personas distintas.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **RBAC no viaja en migraciones** | Cada permiso nuevo exige `npm run db:sync-rbac`. `ensureSystemRbac()` solo corre en el bootstrap del primer usuario. |
| **`preventionEmergencyResources.planId` es cascade** | La migración de Fase 6 necesita backfill de `worksiteId` **antes** de relajar la FK. Es la única migración con riesgo de pérdida de datos. |
| **Tests que se rompen con cada fila nueva del sidebar** | `lib/__tests__/navigation.test.ts` (orden exacto + contigüidad de grupos), `navigation-targets-exist.test.ts` (la ruta debe existir), `prevention-rbac.test.ts` (paridad de permisos). |
| **Journal de migraciones** | Siguiente es `0169`. Nunca editar `_journal.json` ni un `.sql` existente: cambiar `db/schema/*.ts` y `npm run db:generate`. |
| **Tope de 200 en `assignDocumentVersionRecipients`** | Fase 4: paginar o subir el tope de forma consciente, no toparse con él en producción. |

---

## Verificación

**Por fase:**
1. `npx tsc --noEmit` y `npx eslint <archivos tocados>` — ambos deben salir limpios.
2. `npx vitest run` — la suite completa son 4067 tests, ~73s.
3. Migraciones: `npm run db:generate` → revisar el `.sql` generado a mano → `npm run db:migrate`
   → `npm run db:sync-rbac`.

**End-to-end, lo que realmente prueba cada fase:**
- **Fase 1**: importar la plantilla de auditoría, aprobarla con un usuario distinto al autor,
  programarla anual, ejecutar una corrida, generar un hallazgo `critical`, verificar que abre CAPA
  y que la revisión la exige. Confirmar que `/pdtp/obligaciones` ya no muestra la bandeja de
  aprobación y `/pdtp/aprobaciones` sí muestra ambas.
- **Fase 2**: registrar una visita con hallazgo, verificar que la CAPA nace con
  `sourceType: 'external_visit'` y que reintentar el mismo hallazgo no duplica (idempotencia por
  `sourceItemId`).
- **Fase 3**: crear un programa de vigilancia con `protocolId = prexor` y comprobar que la
  cobertura por protocolo cuadra con la cobertura por agente.
- **Fase 4**: publicar un RIOHS, verificar que la distribución alcanza a toda la dotación de la
  faena y que un trabajador puede acusar recibo una sola vez (el segundo intento es idempotente).
- **Fase 6**: archivar un plan de emergencia y confirmar que el inventario sobrevive.

**Regresión visual:** las fases 1.1, 1.3 y 2 agregan filas al sidebar de Prevención, que acaba de
reorganizarse en cuatro grupos. Confirmar que las filas nuevas caen en el grupo correcto y que el
test de contigüidad sigue verde.
