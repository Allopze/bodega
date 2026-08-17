# TODO — remediación auditoría 6 áreas de Prevención (2026-08-16)

Informe: https://claude.ai/code/artifact/e3bcaa18-34f7-4432-b11c-d557f579046e
Base: `ac766b9`. 57 hallazgos verificados (0 CRITICAL, 0 HIGH, 18 MEDIUM, 26 LOW, 13 INFO).

Se trabaja **por causa raíz**, no hallazgo por hallazgo: 45 de los 57 caen en 6 grupos
con un arreglo cada uno.

## Reglas de esta tanda

- [ ] No tocar las áreas ya auditadas y corregidas (CAPA, permisos, incidentes,
      documentación, campañas, indicadores, EPP, higiene).
- [ ] Ningún cambio de esquema sin releer `_journal.json` en el momento de generar.
- [ ] `npm run typecheck` + `npm run lint` + `npm test` verdes antes de cerrar cada fase.
- [ ] Lo que exija decisión de Prevención se implementa con el criterio **conservador**
      y se marca como revisable, no se deja a medias.

---

## Fase 1 — Grupo C: el arreglo ya existe en un módulo hermano (5 MEDIUM)

Cinco MEDIUM que se cierran **reutilizando código existente**, sin diseño nuevo.

- [x] **MIPER-02** — `lib/services/pdtp/xlsx-security.ts` promovido a
      `lib/services/xlsx-security.ts` con `maxBytes`/`maxRowsPerSheet` parametrizados
      (PDTP 15 MB/2.000 filas vs MIPER 20 MB/5.000 no eran compatibles; el 20 MB de
      MIPER lo fija `next.config.ts:19-22`). Envolvente validada antes de ExcelJS, y
      corte de tamaño/extensión en `stageRiskImportAction`. **Extra:** el mismo orden
      invertido existía en `scripts/pdtp-bootstrap-prod.ts` y se corrigió.
- [x] **MOC-02** — `bumpChangeVersion()` en SQL + `for("update")` en
      `evaluateChangeDimension`. 13/13 en Postgres real, con los dos TOCTOU nuevos.
- [x] **PPA-04** — `clientSubmissionId` + UNIQUE (migración 0175) +
      `onConflictDoNothing` con recuperación de la fila original, sin duplicar
      `ppa_status_history` ni renotificar. `recoverStalePpas()` para los `syncing`
      huérfanos. 12/12 pglite + 15 en `offline-queue.test.ts`.
- [x] **LEGAL-02** — índice único parcial + supersesión automática **por código**
      (no por `supersedesRequirementId`, que el formulario nunca envía), con
      `FOR UPDATE`. Migración 0174 sanea duplicados previos de forma idempotente.
- [x] **EMERGENCIAS-03** — validación en lote (no N+1) de faena + `isActive` +
      duplicados, antes de `assessDrillCompletion` para que un repetido no infle el
      conteo de presentes. 4 pruebas en Postgres real, con todo-o-nada.

### ⚠️ Regresión propia detectada y corregida en esta fase

- [x] `lib/__tests__/pdtp-checklist-action-plan.test.ts` (4 tests) se rompió con el
      commit `2c1bc00` de la tanda anterior: mi cambio de SoD en CAPA (F-01) prohibió
      la autoverificación en toda prioridad, y el fixture verificaba con el mismo
      usuario que creaba. **No se detectó entonces porque `npm test` excluye las 64
      suites PGlite** (`vitest.config.ts:19`) y esa tanda nunca corrió `test:pglite`.
      Verificado con worktree en `d507949`: ahí pasaba. Corregido sembrando `u2` como
      verificador distinto. 30/30 verde.
      **Lección para el resto de las fases: correr `npm run test:pglite` además de `npm test`.**

## Fase 2 — Grupo B: UTC en vez del día civil chileno (6 hallazgos)

- [x] **MOC-09, EMERGENCIAS-12** — `getUTCFullYear()` en generación de códigos.
      Corregidos los **9** puntos del módulo, no sólo los dos del informe: `GC-`,
      `PE-`, `CAPA-`, `INC-`, `INSP-`, `PT-`, `CAP-`, `CPHS-` y `RD-`.
- [x] **EMERGENCIAS-07** — la alerta de equipos decide "vencido" con fecha UTC.
      Vivía en `lib/services/prevention-attention.ts:45`, no en el servicio de
      emergencias (ahí ya se usaba el día chileno).
- [x] **MIPER-09, LEGAL-08** — `toISOString().slice(0,10)` como "hoy".
- [x] **CPHS-03** — meses de certificación contados por fecha de registro y no del hecho.
      Se cuenta por `heldAt` y **todo** `gatherCertificationEvidence` pasó a
      calendario chileno: si no, el expediente mezclaba dos calendarios.
- [x] Helper `codeYear()` en `lib/utils.ts`, junto a `todayInChile()`.
- [ ] ⏸️ **Pendiente: la regla de lint** que prohíba `getUTCFullYear()` y
      `toISOString().slice(0,10)` fuera de `lib/utils.ts`. Se dejó fuera a
      propósito de esta pasada: exige plugin (`eslint-plugin-no-restricted-syntax`
      o una regla local) y hay que decidir antes las excepciones legítimas —
      aritmética sobre fechas planas (`addDays`), nombres de archivo de export y
      claves de idempotencia diarias, que hoy son usos correctos. Mientras tanto
      el barrido queda cubierto por la prueba de regresión de
      `prevention-dia-civil-chileno.test.ts`, que falla si vuelve a aparecer un
      `getUTCFullYear()` generando códigos en `lib/services/prevention-*.ts`.
- [x] ⚠️ `miper-ui-contract.test.ts:13` fija hoy la cadena incorrecta para estabilizar
      hidratación SSR — actualizado. La garantía era estructural (el servidor
      resuelve `today` y lo baja como prop; el cliente no lo recalcula), así que
      sigue en pie: se cambió la cadena esperada y se **agregó** la afirmación de
      que el workbench tampoco llama a `todayInChile(`.

## Fase 3 — Grupo D: validación de pertenencia en el servicio (5 hallazgos)

Los cinco tienen la misma forma: el servicio acepta un id entrante sin resolverlo,
mientras la pantalla que lo produce sí lo filtra. Referencia: `addEmergencyRole`.

- [x] **MIPER-07** — guard en `createRiskMatrixDraftWithClient` (embudo real de los dos
      llamadores) con JOIN a `preventionCommittees`, porque la sesión no lleva faena
      propia. Se acepta `scheduled` y sólo se rechaza `cancelled`: el borrador MIPER se
      prepara *para* la sesión que viene. Mensaje único para no filtrar ids ajenos.
- [x] **CPHS-07** — guard de nivel dentro de la transacción y **antes** del CAS, para que
      un código erróneo no consuma versión. Además la lectura congelada descarta filas de
      otro nivel, lo que neutraliza sin migración lo que ya estuviera guardado.
- [x] **MOC-04** — `superRefine` con `path: ["impacted"]` para que el formulario lo pinte
      donde corresponde; el CHECK de base sigue siendo la garantía de fondo.
- [x] **LEGAL-07** — ⚠️ **desviación deliberada:** FK agregada (migración 0176) y
      `supersedesRequirementId` recalculado al publicar, pero **se declinó** la
      "validación de mismo código" que pedía el informe: en una renumeración normativa el
      artículo nuevo lleva otro código, así que exigir igualdad sería incorrecto. El
      control real es la supersesión por código de LEGAL-02 + índice parcial.

**Pendiente que destapó MIPER-07 (no es regresión, es alcance):** el crédito Oro
`iper_committee_participation` sigue inalcanzable porque **ningún formulario envía
`committeeMeetingId`** — `MatrixDialog` manda 6 campos y ese no está. El guard lo vuelve
confiable, no alcanzable. Falta un selector de sesión en el diálogo. → va a Fase 7.

## Fase 4 — MIPER: lo que lo deja 🔴 NO APTO (5 MEDIUM)

El único área con veredicto rojo. Publicar la primera versión funciona; el resto del
ciclo está roto o sin cablear.

- [x] **MIPER-06** — `MatrixDialog` recibe las matrices publicadas de la faena y envía
      `sourceMatrixId`, con la vigente por defecto. El servicio ya sabía copiar.
- [x] **MIPER-05** — `repointRiskMapMarkers` reapunta por **identidad estable**
      (proceso/tarea/puesto/código), no por id de fila, y los marcadores cuyo peligro
      desapareció se eliminan dejando historial (`changeType: "orphaned"`, con
      coordenadas). `addRiskMapMarker` ahora exige matriz publicada.
      **+ cierre mío:** el camino de *lectura* tampoco filtraba, así que una fila
      histórica anterior a ambas reglas seguía pintándose. Filtrado en
      `prevention-risk-map.ts` en vez de borrarlas por migración: un marcador es trabajo
      manual de posicionamiento y no se destruye sin que alguien lo decida.
      (Verificado: 0 marcadores huérfanos en la base de desarrollo.)
- [x] **MIPER-04** — causa raíz: `issuesFor` ahora usa el **mismo** schema que corre la
      activación, y `fingerprint` dejó de incluir el texto del peligro (era lo que colaba
      choques contra el índice de identidad). Error por fila con `rowNumber` + acción
      `reopenRiskImportBatch` y diálogo "Reabrir lote", que no concede aprobación.
- [x] **MIPER-10** — `in_review → draft` con motivo obligatorio, permiso
      `prevention:risk:review`, historial y botón "Devolver a borrador".
- [x] **MIPER-08** — `'verified'` fuera del enum de escritura, `verifyRiskControl` nuevo
      con evidencia obligatoria y SoD por identidad (contra autor de la versión +
      responsables de control y peligro), CAS por `version`, y disparador
      `critical_control_failure` si resulta ineficaz. Permiso nuevo
      `prevention:risk:override_segregation` en el manifest.
- [x] **MIPER-01** — fuente única en `lib/prevention/risk-levels.ts` (4 niveles;
      `moderate` desaparece por ser otro nombre de `medium`), `riskLevelSchema`, CHECKs
      en 0177 con normalización previa, UI y barrido de seeds/e2e.
      **+ cierre mío:** el export Excel era el único lector que no pasaba por
      `riskLevelLabel()` — el archivo que recibe un fiscalizador decía "high" en vez de
      "Alto". Corregido, junto con `inherentDimensions`, que volcaba el JSON crudo.

## Fase 5 — Emergencias y CPHS: ciclos que no sostienen un segundo año

- [x] **EMERGENCIAS-02** — `archiveEmergencyPlan` con motivo, CAS, historial y permiso
      `:approve`. **Sin migración:** el índice ya era parcial (`WHERE status <> 'archived'`,
      desde 0093) — faltaba la transición que lo libera, no el índice.
      Extra: `createEmergencyPlan` pre-chequea el plan vigente y da mensaje de dominio en
      vez del error crudo del driver.
- [x] **EMERGENCIAS-01** — helper único `loadEditablePlan` por el que pasan las 4 altas
      (−12 líneas de guard duplicado). Se eligió el patrón de `publishDocumentVersion` y
      **no** `contentDigest`: la aprobación acá es un solo acto, no una revisión multipaso,
      así que una huella defendería un hueco inexistente.
      ⚠️ **Techo aceptado:** con el plan aprobado tampoco se da de alta un extintor nuevo;
      hay que archivar y reemitir. Vía futura: alta de inventario por `worksiteId`.
- [x] **EMERGENCIAS-04** — `updateEmergencyResource` contra la **faena** (no el plan), baja
      como `out_of_service` en vez de borrar, y `ne(status,'out_of_service')` en
      `prevention-attention.ts` — sin esto la baja era cosmética y el equipo retirado
      seguía pidiendo inspección para siempre. Los 4 contadores se **cablearon** (no se
      eliminaron): al excluir `out_of_service` de la bandeja, ese estado se quedaba sin
      ninguna pantalla.
- [x] **EMERGENCIAS-10** — `cancelEmergencyDrill` con motivo, CAS e historial.
      Reprogramar = cancelar + reprogramar, deliberado: mover la fecha borraría que el
      simulacro anterior no se realizó.
- [x] **CPHS-01** — `assessQuorum` exige mayoría **y** `missingRepresentations.length === 0`;
      `closeCommitteeMeeting` nombra la representación ausente. Sigue calculándose sobre
      integrantes y un invitado no lo altera (decisiones respetadas).
      ⚠️ **REVISABLE POR PREVENCIÓN** marcado en el docblock de `lib/prevention/cphs.ts`,
      con la vía de reversión escrita. El test que fijaba el comportamiento contrario se
      **corrigió en su sitio** (mismo `it`, expectativa invertida, comentario reescrito),
      no se borró ni se silenció.
- [x] **CPHS-02** — reconciliación **al cerrar** la sesión (no dentro de
      `replaceCommitteeMember`): la asistencia se ajusta al padrón vigente al momento del
      hecho, y un `memberId` ajeno al comité se rechaza. Desviación de forma respecto del
      enunciado, cubre el caso y además el inverso.
- [x] **CPHS-06** — `reopenCertificationDossier` `rejected → draft` con CAS, motivo e
      historial. Un expediente `certified` explícitamente no se reabre.

## Fase 6 — Requisitos legales: vigencia efectiva

- [x] **LEGAL-01** — al publicar se superan todas las versiones publicadas del código con
      `FOR UPDATE` y las aplicabilidades de la anterior dejan de contar, con asiento de
      historial `superseded`. **No se migran a la versión nueva, a propósito:** migrarlas
      fabricaría un pronunciamiento que nadie hizo, y las evaluaciones que cuelgan de ellas
      están fechadas contra el texto anterior — arrastrarlas re-fecharía evidencia.
- [x] **LEGAL-03** — `isLegalRequirementInForce()` / `legalRequirementInForceCondition()`
      aplicados en las 7 consultas que miden vigencia, con día civil chileno.
- [x] **LEGAL-05** — `assessLegalCompliance` bloquea `compliant` con CAPA en estado
      distinto de `verified/closed/cancelled`, nombrando el código en español.
- [x] **LEGAL-06** — `legalGapReason()` convierte `nextAssessmentAt` y `evidenceDueAt`
      vencidos en brecha aunque el estado siga `compliant`.
      ⚠️ La rama `evidenceDueAt` **no tiene aserción propia** (sólo se siembra el campo) → Fase 8.
- [x] **LEGAL-04** — índice parcial para proceso nulo (migración **0178**) +
      `onConflictDoNothing` traduciendo el choque al mensaje de concurrencia. En SQL
      `NULL != NULL`, que era justo por donde se colaban las filas duplicadas.
- [x] **LEGAL-09** — 3 diccionarios + `legalStatusVariant()` en `lib/prevention/badges.ts`,
      con test de contrato que contrasta contra los CHECK del esquema: todo valor
      almacenable tiene etiqueta, no sólo los del camino feliz.

### ⚠️ Bug que introdujo esta fase y corregí yo

- [x] **Ventana muerta de vigencia.** `transitionLegalRequirement` superaba la versión
      anterior **en el acto de publicar**, sin mirar si la nueva entra en vigor después.
      Publicar una enmienda con anticipación —caso normal: la norma se dicta hoy y rige el
      mes que viene— dejaba al artículo sin regir por ninguna de las dos filas:
      `counts.applicable` caía y `proposeLegalApplicability` rechazaba ambas.
      Dos correcciones: (a) `isLegalRequirementInForce` acepta `superseded` mientras su
      `validTo` no haya pasado, que es la semántica que el propio comentario del código ya
      declaraba; (b) `validTo` pasa a ser el día **anterior** a la entrada en vigor del
      reemplazo, porque cerrarlo en la misma fecha dejaba ambas versiones vigentes ese día
      — la misma ambigüedad de frontera ya detectada en documentación.
      4 casos nuevos en el test puro, y 2 aserciones de la suite gated actualizadas.

## Fase 7 — Grupo A residual: estados y columnas muertas (INFO/LOW)

Decidir por línea: **implementar la transición o borrarla del CHECK.** No dejar a medias.

**Los 21 cerrados.** Migraciones nuevas: **0179** (CHECK de simetría PPA) y **0180**
(`held` fuera del CHECK, `status` de acuerdos, `term_ends_on` de integrante).

- [x] **PPA-01** *(MEDIUM, seguridad sin autenticar)* — dos cuotas: IP (30/5min, consumida
      **siempre y antes de validar**, es la única que el cliente no puede rotar) + identidad
      (5/15min, por UX). `workerRut` exige dígito verificador, o la identidad seguía siendo
      cadena libre. **El caso NAT está afirmado**: dos trabajadores tras la misma IP pasan y
      sus contadores no se mezclan.
- [x] **PPA-02** — `getPpaByToken` consulta sólo por hash; fuera el `or` con el token en
      claro y el auto-upgrade que mataba el enlace del trabajador al usarlo. Verificado que
      la migración 0057 ya había hasheado todo: la rama era redundante, no un puente vivo.
- [x] **PPA-03** — `assertNotPpaDriven` en los dos envoltorios de petición (no en los
      `*WithClient`, por donde entra el PPA) + UI que oculta transición/asignación y enlaza
      al PPA. Red de seguridad idempotente para filas heredadas.
- [x] **PPA-06** — revocación en transacción con `isNull(...)` (idempotente ante dos
      responsables) y asiento en `ppa_status_history` con actor.
- [x] **PPA-07** — `CloseCaseButton` borrado, no montado: no comprobaba estado y hardcodeaba
      el comentario de cierre, o sea archivaba una observación que nadie escribió.
- [x] **PPA-08** — 4 CHECK de simetría fecha↔actor (no sólo los 2 nombrados: misma clase de
      estado imposible). `verification_comment` queda fuera a propósito y documentado.
- [x] **CPHS-04** — la cadencia usaba `closedAt` en el job y `heldAt` en la pantalla: el acta
      de enero firmada en marzo daba el comité al día en marzo. Unificado en `heldAt`.
      ⚠️ **El verificador lo marcó como el único punto de la fase sin cobertura** → test de
      contrato agregado por mí, con control negativo verificado (revertir el arreglo lo
      pone en rojo).
- [x] **CPHS-08** — el acuerdo perdió su columna `status` y el contador se deriva de la CAPA
      (`INNER JOIN`, `status NOT IN ('closed','cancelled')`). Coherente con "CAPA motor único".
- [x] **CPHS-09** — las dos mitades: `held` **fuera del CHECK**, y `closed` de programa
      **hecho alcanzable** con `closeProgram()` — un programa anual sin estado terminal era
      problema funcional, no sólo código muerto. Barrido: `grep held` devuelve cero.
- [x] **CPHS-11** — `term_ends_on` de integrante eliminado (el del **delegado** se queda: ese
      sí se aplica). 0 filas con dato en desarrollo.
- [x] **CPHS-12** — `notification-create.ts`: el correo se arma sobre los ids realmente
      insertados. Revisados los 14 consumidores de `dedupeKey`; el hermano singular ya estaba sano.
- [x] **CPHS-13** — alcance de faena en `listManagementReviews` (`or(isNull, scoped)`) y
      `requireAccess` con la faena de la revisión tras cargarla.
- [x] **CPHS-14** — `expireLapsedCommittees` en transacción, con bump e historial `expired`.
- [x] **EMERGENCIAS-05** — cableado el escritor de `pdtpActivityNumbers` que faltaba
      (siguiendo el precedente de inspecciones: cablear, no borrar el conector).
- [x] **EMERGENCIAS-06** — `executedAt` acotado por arriba y contra `scheduledFor`.
- [x] **EMERGENCIAS-08** — `includeCompliance` partido en tres, cada uno con su permiso;
      las consultas apagadas ni se emiten.
- [x] **EMERGENCIAS-09** — ⚠️ **desviación justificada**: no se agregó reloj de vigencia; se
      corrigió el rótulo ("Vigentes" → "Sin archivar") porque la periodicidad ya vive en el
      programa anual y un segundo calendario competiría con el del PDTP.
- [x] **EMERGENCIAS-11** — el filtro de faena va **antes** del tope de 2000, y una faena
      fuera de alcance devuelve `[]` en vez de dotación ajena.
- [x] **MOC-03** — reevaluar reconcilia: reutiliza la CAPA abierta, crea otra si la anterior
      está cerrada, y cancela con motivo si se desmarca.
- [x] **MOC-05** — `plannedReviewDate` validada y **dejó de ser decorativa**: nuevo
      `kind: "change_review"` en `getPreventionAttention`.
- [x] **MIPER-11** — `if (!updated) throw` reemplaza al `updated!` que disfrazaba de éxito
      una aprobación que no actualizó nada. El test reproduce la carrera con dos
      transacciones reales, no la simula.
- [x] **LEGAL-06** *(bonus)* — la rama `evidenceDueAt` que quedó sin aserción en Fase 6 ya
      la tiene.

## Fase 8 — Cierre

- [x] Suite de fechas con reloj a las 23:00 America/Santiago (`prevention-dia-civil-chileno.test.ts`).
- [x] Tests P0 del informe escritos y verdes.
- [x] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [x] `npm run db:verify-migrations` (181 entradas, hasta 0180).
- [x] Actualizar este archivo y el informe con lo efectivamente cerrado.
- [ ] ⏸️ **`npm run test:e2e` — NUNCA se corrió en toda esta serie.** 88 specs, ~21 tocan lo
      cambiado. Es el hueco de verificación más grande que queda: ninguna de las 7 fases lo
      ejecutó. Ver §1 de "lo que falta" abajo.

---

## Estado

**Fase 1:** ✅ cerrada — 5/5 + regresión propia corregida. Migraciones 0174 y 0175.
**Fase 2:** ✅ cerrada — 6/6 hallazgos, barrido extendido a 9 puntos de código.
  Suite nueva: `lib/__tests__/prevention-dia-civil-chileno.test.ts` (12 casos, reloj a
  las 23:00 de Chile). Queda abierta sólo la regla de lint, diferida a propósito.

### Gates al cierre de Fases 1-2

- `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run db:verify-migrations` ✅ (176 entradas, hasta 0175)
- `npm test` → ✅ **498 passed | 26 skipped (524)**, cero rojos.
- `npm run test:pglite` → ✅ **64/64 archivos, 675/675 tests**, cero rojos.
- Suites Postgres real (permisos, higiene, indicadores, cambios, emergencias, riesgo) → ✅ verdes.

**El árbol quedó completamente verde por primera vez en esta serie de tandas.**
De aquí en adelante cada fase corre `npm test` **y** `npm run test:pglite`: `npm test`
excluye 64 archivos (`vitest.config.ts:19`) y ese fue el agujero por el que se coló la
regresión de la tanda anterior.

### ✅ Los 3 rojos ajenos, corregidos (decisión del usuario: "arregla los rojos")

1. **`submit-request-action.test.ts`** (10 tests, Compras) — **bomba de tiempo**, no un bug
   de código. El fixture quemaba `requiredDate: "2026-08-15"` y `requestSchema` rechaza
   fechas pasadas contra el día civil chileno (`lib/validation/operations.ts:28`); al
   llegar el 2026-08-16 la suite se puso roja sola, sin que cambiara una línea. Ahora la
   fecha se calcula relativa: `addDaysToPlainDate(todayInChile(), 30)`. **14/14 verde.**
2. **`prevention-pdtp.test.ts`** — la rama `sourceType: "audit"` de
   `linkPdtpActivitySource` exige una corrida real del motor de inspecciones con
   plantilla `kind='audit'`, y el fixture pasaba un id suelto. Sembrada la plantilla + la
   corrida, y agregada su limpieza al `beforeEach` (FK `restrict` sobre `users`).
   **60/60 verde.** Origen confirmado por `git log -S`: commit `b9e0016`, tres commits
   antes que los míos — **ajeno**, no lo introdujo LEGAL-02 como se sospechaba.
3. **`prevention-emergency-list.test.ts`** — `getEmergencyDashboardCounts` ganó 4
   contadores de recursos y el `toEqual` exacto no los contemplaba. Afirmados
   explícitamente en cero (la fixture no siembra inventario) para que el `toEqual` siga
   siendo exacto y detecte contadores nuevos sin test. **1/1 verde.**
   *Nota: es la otra mitad de EMERGENCIAS-04 — esos contadores se calculan y se
   descartan por tipado estructural. Se cierra en Fase 5.*

### Deuda anotada por los agentes (no arreglada, para decidir)

- `prevention-dia-civil-chileno.test.ts` levanta PGlite pero **no está en `tests/pglite-files.ts`**:
  cae en el proyecto por defecto con `fileParallelism` y timeout 20 s → riesgo de flake sólo-en-CI.
- Siguen existiendo **3 copias de `todayInChile()`** (`lib/utils.ts`, `prevention-cphs-access.ts:32`,
  copia privada en `prevention-emergency.ts:50`). Equivalentes hoy; deuda de duplicación.
- `EmergencyDomainError` es abstracción muerta: `run()` ya devuelve `error.message` de cualquier `Error`.
- `derivePpaPublicToken` es determinista sobre `AUTH_SECRET`: tras rotarlo, un reenvío desde la
  cola offline deriva un token distinto → enlace muerto (sin pérdida de datos).
- Topes compartidos de `xlsx-security.ts` sin parametrizar (80 MB descomprimido, 32 hojas,
  256 columnas): un `.xlsx` MIPER legítimo cerca de su tope de 20 MB podría rechazarse.

**Fase 3:** ✅ cerrada — 4/4 (MIPER-07, CPHS-07, MOC-04, LEGAL-07 con desviación justificada).
**Fase 4:** ✅ cerrada — 6/6. MIPER-01 lo dejó a medias el agente (faltaba el export Excel)
  y lo cerré yo, junto con el filtro de lectura de marcadores de MIPER-05.
  Migraciones nuevas: 0176 (FK de supersesión) y 0177 (CHECKs de nivel de riesgo).

### Gates al cierre de Fases 3-4

- `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run db:verify-migrations` ✅ (178 entradas, hasta 0177)
- `npm test` ✅ **498 passed | 26 skipped (524)** · 4150 tests
- `npm run test:pglite` ✅ **64/64 archivos, 677 tests** (línea base 675 → +2 de CPHS-07)
- 13 suites Postgres real ✅ **149/149**

⚠️ **Tercer agujero de cobertura detectado** (van tres): `npm test` reporta verde pero
**salta las 13 suites `prevention-*-postgres.test.ts`** — son los 26 archivos / 197
"skipped", y ahí vive casi todo el test de Fases 3 y 4. Hay que correr las tres cosas:
`npm test`, `npm run test:pglite` y las suites gated con `PREVENTION_*_DATABASE_URL`.

### Deuda nueva anotada (no arreglada)

- **Nombre de FK truncado en 0176**: Postgres emite `NOTICE 42622` y guarda
  `prevention_legal_requirements_supersedes_requirement_id_prevent`. Funciona, pero un
  `DROP CONSTRAINT` futuro con el nombre del `.sql` fallaría.
- El crédito Oro `iper_committee_participation` sigue inalcanzable (ver Fase 3) → Fase 7.
**Fase 5:** ✅ cerrada — 7/7 (Emergencias ×4, CPHS ×3). CPHS-01 con marca de revisable.
**Fase 6:** ✅ cerrada — 6/6 + un bug que la propia fase introdujo (ventana muerta de
  vigencia) detectado por el verificador y corregido por mí. Migración 0178.
**Fase 7:** ✅ cerrada — 21/21 + 8 de deuda acumulada. Migraciones 0179 y 0180.
  Dos cierres míos tras la verificación: el test de contrato de CPHS-04 (era el único punto
  de la fase sin cobertura, con control negativo verificado) y la copia local de los
  enunciados del informe.
**Fase 8:** ✅ cerrada — informe actualizado con el estado de remediación.

## ✅ LOS 57 HALLAZGOS ESTÁN CORREGIDOS

### Gates finales (las tres superficies)

- `npm run typecheck` ✅ · `npm run lint` ✅
- `npm test` ✅ **498 passed | 26 skipped (524)** · **4164 tests**
- `npm run test:pglite` ✅ **65 archivos** · **703 tests**
- 13 suites Postgres real ✅ **174 tests**
- `npm run db:verify-migrations` ✅ **181 entradas, hasta 0180**
- Cambio total desde `ac766b9`: **129 archivos, +5.708 / −764**, 7 migraciones (0174–0180).

### Lo que descubrió la remediación y el informe no decía

1. **El crédito Oro `iper_committee_participation` del CPHS sigue inalcanzable**: ningún
   formulario envía `committeeMeetingId`. El guard de MIPER-07 lo volvió confiable, no
   alcanzable. Falta un selector de sesión en `MatrixDialog`, lo que exige cargar las
   sesiones del comité en el payload de `getRiskDashboard`. **Pendiente real.**
2. **El export Excel de MIPER** era el único lector del nivel de riesgo que no traducía:
   normalizar el vocabulario habría entregado "high" a un fiscalizador donde antes decía
   "Alto". Corregido.
3. **Publicar una enmienda legal con anticipación** dejaba al artículo sin regir por ninguna
   de las dos versiones — bug que introdujo la propia corrección de vigencia (Fase 6) y que
   detectó la verificación adversarial de esa fase. Corregido.
4. **Una regresión mía de la tanda anterior** (`pdtp-checklist-action-plan.test.ts`, 4 tests)
   llevaba rota desde el commit `2c1bc00` porque `npm test` excluye las 64 suites PGlite.

### ✅ CPHS-01 resuelto contra el texto real del DS 54 (2026-08-16)

El criterio conservador de la Fase 5 **era más estricto que la ley** y había que ajustarlo.
Texto verificado en SUSESO y Dirección del Trabajo, **DS 54 art. 17**:

> «El Comité Paritario de Higiene y Seguridad podrá funcionar siempre que concurran un
> representante patronal y un representante de los trabajadores.»

Y el mismo artículo resuelve la asimetría **por los votos, no por el quórum**: «cuando no
concurran todos los representantes de una parte, se entenderá que los asistentes disponen
de la totalidad de los votos de su respectiva representación».

**Ajuste aplicado:** se retiró la exigencia de mayoría (`effective >= required`) de la
condición de `reached`; se conserva la de ambas representaciones, que es lo que la norma sí
manda. `required`/`effective` siguen calculándose porque el acta los informa, pero no deciden.

**Por qué importaba:** un comité de 3+3 que junta 1+1 —el caso corriente— no habría podido
cerrar acta. Un guard más estricto que la ley no protege: impide operar y empuja a registrar
fuera del sistema. El fixture de los tests era de 2+2, donde 1+1 ya daba mayoría, así que
**ningún test cubría la divergencia**: se agregó el caso 3+3 explícito.

Fuentes: [SUSESO DS 54 art. 17](https://www.suseso.gob.cl/612/w3-propertyvalue-199578.html) ·
[DT — Decreto Supremo N° 54](https://www.dt.gob.cl/legislacion/1624/w3-article-95820.html)
- **EMERGENCIAS-09**: se corrigió el rótulo en vez de agregar un reloj de vigencia,
  argumentando que la periodicidad ya vive en el programa anual y un segundo calendario
  competiría con el del PDTP. Decisión de producto, escrita en el código.

### Deuda que queda anotada (no bloqueante)

- Quedan **9 copias privadas de `todayInChile()`** (permits, epp, training ×2, inspections,
  hygiene, risk-legal, operativos). La Fase 7 consolidó las 2 señaladas; el ítem subestimaba
  el alcance real.
- Regla de lint del Grupo B: ver el reporte del agente de deuda para si `no-restricted-syntax`
  alcanza sin plugin externo.
- Nombre de FK truncado en 0176 (funciona; un `DROP CONSTRAINT` futuro con el nombre del
  `.sql` fallaría).

### Lección de proceso (tres veces tropezada)

`npm test` **no** es el gate completo: excluye 64 archivos PGlite **y** salta 13 suites
Postgres gated. Hay que correr las tres superficies. Las suites gated, además, con
`--no-file-parallelism`, o el cluster muere con `out of shared memory`.

### Gates al cierre de Fases 5-6

- `npm run typecheck` ✅ · `npm run lint` ✅ · `db:verify-migrations` ✅ (179 entradas, hasta 0178)
- `npm test` ✅ 498 passed | 26 skipped (524) · 4157 tests
- `npm run test:pglite` ✅ 64/64 archivos · 680 tests
- 13 suites Postgres real ✅ 164/164
  (⚠️ correrlas en paralelo mata el cluster con `out of shared memory`: 13 `DROP SCHEMA`
  simultáneos. Usar `--no-file-parallelism`. Es del entorno, no del código.)
