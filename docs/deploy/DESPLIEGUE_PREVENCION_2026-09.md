# Despliegue de Prevención (PDTP) 2026-09

Procedimiento para llevar a producción la rama **`prevencion/integracion-final`**, con las
correcciones de la revisión final (`prevencion/revision-final-fixes`). Reemplaza la versión
anterior de este documento, que describía sólo la rama `prevencion/fixes-production-readiness`
y la migración 0329.

Qué trae respecto de `main`, que termina en la migración 0328:

- **Seis migraciones, de 0329 a 0334** (sección 1). Tres agregan columnas o índices. 0331
  cambia los estados posibles de un "No aplica". 0333 cambia tres FK de `CASCADE` a `RESTRICT`
  y crea dos índices sin `CONCURRENTLY`. 0334 (rama `prevencion/c07-m02b`) crea dos tablas
  nuevas y vacías: solicitudes de "no aplica"/cancelación de ocurrencias y registro de subidas.
- Los cambios de comportamiento de las tandas T0 a T7b y de la revisión final. El detalle
  está en `qa/reports/2026-09-26-prevencion-*.md`, `qa/reports/2026-09-27-prevencion-*.md` y
  `qa/reports/2026-09-27-prevencion-revision-final.md`. Lo que ven los usuarios está en la
  sección 3.
- **11 crons de Prevención** en el contenedor `cron` y dos procesos de un solo tiro que sólo
  informan (sección 5).

El despliegue en sí es el de siempre (`npm run deploy:prod`). Este documento cubre lo que hay
que hacer **antes**, las contingencias, la vuelta atrás y la verificación **después**.

## 1. Las migraciones y su riesgo

| Migración | Qué hace | Riesgo | Control |
|---|---|---|---|
| **0329** | Columna `pdtp_activities.manual_evidence_policy` (`file_required` por omisión, CHECK con `declaration_allowed`). Índice único parcial "un programa `active` por año". Marca como `declaration_allowed` las N°11, 15, 16, 18, 52, 57 y 66–78 del programa 2026 | El índice único **falla** si un año tiene dos programas activos | Q1. `scripts/migration-preflight.mjs` corre dentro de `migrate.mjs` y aborta con `PDTP años con programas activos duplicados` antes de tocar el esquema |
| **0330** | Columnas del cierre anual en `pdtp_programs` (`year_closed_at`, `year_closed_by_user_id` con FK `SET NULL`, `year_close_reason`) y el CHECK `year_closed_at IS NULL OR status IN ('closed','archived')` | Ninguno sobre los datos existentes: las columnas nacen nulas y el CHECK se cumple | — |
| **0331** | "No aplica" con revisión (T2, D8). Estados nuevos `pending_review` y `rejected`, columnas `reviewed_by_user_id`, `reviewed_at` y `review_reason`. Índice único por celda sobre `active` **y** `pending_review`, que reemplaza al de sólo `active`. CHECK de revisión: sólo un `not_applicable` puede quedar en revisión o rechazado, quien revisa no es quien declaró y un rechazo lleva un motivo de 10 caracteres | Hoy sólo existen filas `active` y `withdrawn`, así que ni el índice ni los CHECK chocan con datos existentes. El riesgo está en la **vuelta atrás** (sección 4) | Q5: conteo de estados antes y después |
| **0332** | Columna `worksites.deactivated_at`: una faena dada de baja debe los meses anteriores a su baja al cerrar el año | Ninguno: es aditiva y nula | — |
| **0333** | `ON DELETE RESTRICT` (antes `CASCADE`) en `pdtp_executions.activity_id`, `pdtp_execution_deviations.activity_id` y `pdtp_period_closures.program_id`. Índices `pdtp_executions_activity_worksite_year_idx` y `pdtp_obligations_activity_worksite_idx`. Borra el índice redundante `pdtp_executions_scheduled_instance_idx` | **Bloqueos.** Recrear cada FK valida la tabla hija completa con bloqueo sobre ella y sobre la padre. `CREATE INDEX` sin `CONCURRENTLY` bloquea las escrituras de `pdtp_executions` y `pdtp_obligations` mientras construye. La validación no puede fallar: la FK con `CASCADE` ya impedía los huérfanos | Q6: tamaño de las tablas |

| **0334** | Tablas nuevas `pdtp_scheduled_instance_outcome_requests` (el "no aplica" y la cancelación de una ocurrencia programada nacen en revisión, PREV-C07) y `pdtp_evidence_uploads` (dueño y sha256 de cada archivo subido a `storage/pdtp-evidence/`, PREV-M02-B). Sólo `CREATE TABLE`, FK e índices sobre las tablas nuevas; no toca filas existentes ni trae `DROP` | **Mínimo.** Las FK nuevas toman un bloqueo breve (`SHARE ROW EXCLUSIVE`) sobre `users`, `worksites`, `pdtp_activities` y `pdtp_scheduled_instances`, pero validan tablas vacías. Riesgo de comportamiento, no de datos: (a) desde el despliegue un "no aplica"/cancelación de ocurrencia no cambia el % hasta aprobarse; (b) un archivo subido **antes** del despliegue y todavía sin vincular ya no se puede vincular (regla heredada, ver sección 3) | Después: `select count(*) from pdtp_scheduled_instance_outcome_requests` y `from pdtp_evidence_uploads` en 0 justo tras migrar; la segunda crece con cada subida. Los "no aplica" y cancelaciones de ocurrencias anteriores siguen con su estado (no se revisan de nuevo) |

Las seis se aplican en la misma corrida del servicio `migrate`, en orden, cada una en su
transacción. Ninguna trae un `DROP` sin `IF EXISTS`, porque `npm run db:verify-migrations`
lo exige.

## 2. Antes: consultas de solo lectura sobre producción

Correrlas contra la base de producción con un usuario de solo lectura. Ninguna escribe.

**Q1 (0329). Años con dos programas activos.** Si devuelve filas, la migración se bloquea.
Prevención decide cuál queda activo y pasa la otra versión a `closed` antes de desplegar.

```sql
select year, array_agg(id order by version) as programas
from pdtp_programs where status = 'active'
group by year having count(*) > 1;
```

**Q2. Envíos pendientes que dejarán de poder aprobarse.** Después del despliegue, aprobar
exige un archivo real, salvo en las 19 actividades con excepción. Tampoco se aprueba una fila
migrada que sólo tiene su texto automático (PREV-B02, PREV-M03). Como 0329 todavía no existe
al correr la consulta, la excepción se expresa con la lista de números de la migración. Las
filas que devuelve se rechazan con un motivo para que se reenvíen con evidencia.

```sql
with pendientes as (
  select e.id, a.n, e.worksite_id, e.month, e.week, e.origin, e.evidence_status,
         e.evidence_url, e.evidence_photos, e.evidence_text,
         (p.year = 2026 and a.n in (11, 15, 16, 18, 52, 57, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78)) as excepcion
  from pdtp_executions e
  join pdtp_activities a on a.id = e.activity_id
  join pdtp_programs p on p.id = a.program_id and p.status = 'active'
  where e.status = 'submitted' and e.origin <> 'integration' and e.executed_quantity > 0
)
select id, n, worksite_id, month, week, origin, evidence_status
from pendientes
where not (
    coalesce(evidence_url, '') like 'storage/pdtp-evidence/%'
    or exists (select 1 from jsonb_array_elements_text(evidence_photos) f where f like 'storage/pdtp-evidence/%')
  )
  and not (
    excepcion and coalesce(trim(evidence_text), '') <> '' and evidence_status <> 'migrated_without_attachment'
  )
order by n, month, week;
```

La consulta no comprueba que los archivos sigan en disco. Una fila con una ruta válida cuyo
archivo desapareció tampoco se podrá aprobar, y el cron `pdtp-evidence-integrity` la informa
después del despliegue. Las filas de un mes ya cerrado no se pueden rechazar hasta reabrir el
mes.

**Q3. Candidatas a excepción.** Son las actividades activas cuyo respaldo podría vivir fuera
de la plataforma. Cualquier excepción nueva se decide con Prevención **antes** del despliegue
y va en una migración nueva (`npm run db:generate -- --custom`), nunca editando 0329.

```sql
select a.n, a.activity, a.mechanism, a.schedule_mode, a.evidence_requirement
from pdtp_activities a join pdtp_programs p on p.id = a.program_id
where p.status = 'active' and a.status = 'active'
  and a.n not in (11, 15, 16, 18, 52, 57, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78)
order by a.n;
```

**Q4. Referencias de evidencia con formato antiguo.** Deberían ser 0. La descarga PDTP sólo
sirve rutas `storage/pdtp-evidence/<nombre>`, y una referencia antigua no cuenta como archivo
para aprobar.

```sql
select count(*) from pdtp_executions
where origin <> 'integration'
  and (
    (coalesce(evidence_url, '') <> '' and evidence_url not like 'storage/pdtp-evidence/%')
    or exists (select 1 from jsonb_array_elements_text(evidence_photos) f where f not like 'storage/pdtp-evidence/%')
  );
```

**Q5 (0331). Estados de los desvíos.** Antes del despliegue sólo debe haber `active` y
`withdrawn`. Guardar el resultado. Después del despliegue, la misma consulta muestra los
`pending_review` que se vayan creando, y es la que se usa antes de una vuelta atrás.

```sql
select status, kind, count(*) from pdtp_execution_deviations group by status, kind order by status, kind;
```

**Q6 (0333). Tamaño de las tablas que se bloquean.** Sirve para estimar cuánto duran los
bloqueos. La validación de una FK recorre la tabla hija completa y cada índice ordena la suya.
Con decenas de miles de filas, que es lo que se espera hoy, debería tomar segundos. Esa cifra
es una estimación y no se midió sobre producción. Con esos números basta desplegar fuera del
horario de terreno. Si las filas son millones, hay que programar una ventana.

```sql
select c.relname as tabla, c.reltuples::bigint as filas_estimadas,
       pg_size_pretty(pg_total_relation_size(c.oid)) as tamano
from pg_class c
where c.relkind = 'r'
  and c.relname in ('pdtp_executions', 'pdtp_execution_deviations', 'pdtp_period_closures',
                    'pdtp_obligations', 'pdtp_activities', 'pdtp_programs')
order by pg_total_relation_size(c.oid) desc;
```

**Q7 (D6). Cierres mensuales que quedarán "desviados".** El cálculo del porcentaje cambió
(sección 3). La foto de un cierre ya emitido no cambia, pero su ficha mostrará "desviado" si el
recálculo ya no coincide. No es un SELECT: el digest se recalcula con el código. Correrlo
**desde un checkout de la versión nueva**, contra producción, con un usuario de solo lectura:

```sh
DATABASE_URL=<usuario de solo lectura> npm run pdtp:report-closure-drift
```

El script sólo lee (`reportPdtpPeriodClosureDrift`, probado en `pdtp-period-closures.test.ts`).
Imprime cuántos cierres revisó y cuáles quedarían desviados. Si son pocos, basta comunicarlo a
la jefatura. Si son muchos, conviene evaluar una foto `schemaVersion 2` antes de desplegar.

## 3. Antes: comunicación a los usuarios

La jefatura de Prevención avisa a los responsables **48 h antes**. Esto es lo que cambia para
ellos:

- **Evidencia obligatoria.** Para declarar una actividad como realizada hay que adjuntar una
  foto o un PDF. Las excepciones son las actividades del RE-20 y las de ingreso de personal
  (las 19 de Q3), donde basta una observación escrita que diga dónde está el respaldo. Los
  envíos pendientes sin archivo (Q2) se devolverán para completarlos.
- **Envíos de otra persona.** Un envío pendiente de otra persona ya no se puede reemplazar.
  Si la actividad tiene una asignación nominal vigente, la registra la persona asignada o quien
  administra el programa.
- **Porcentajes.** Cuentan sólo lo aprobado, y lo que está "por aprobar" aparece aparte. Cada
  actividad aporta como máximo lo que tenía planificado en el mes, así que hacer de más una
  actividad ya no compensa otra que quedó en cero. Una semana registrada a mano y acreditada
  desde su módulo cuenta una sola vez. **Los porcentajes pueden bajar.** El Excel de la planilla
  trae la columna "Ejecutado computable" y el RE-36 aplica la misma regla.
- **"No aplica" con revisión.** Todo "No aplica" nuevo queda **en revisión** hasta que otra
  persona con permiso de aprobación lo acepte o lo rechace. Mientras tanto, la semana sigue
  contando en el denominador y el mes no se puede cerrar. Los "No aplica" que ya estaban
  vigentes antes del despliegue siguen activos.
- **"No aplica" y cancelación de una ocurrencia programada (0334).** Igual que el de una
  semana: exige un motivo de al menos 10 caracteres, queda **en revisión** y la ocurrencia sigue
  contando hasta que otra persona con permiso de aprobación lo acepte en Aprobaciones ("No aplica
  por revisar"). El "no aplica" no se puede declarar sobre una ocurrencia que todavía no ocurre;
  la cancelación sí (por ejemplo, una ocurrencia duplicada). Quien lo pidió puede retirarlo desde
  la misma sección. Un mes con solicitudes pendientes no se puede cerrar. Los "no aplica" y
  cancelaciones de ocurrencias anteriores al despliegue quedan como están.
- **Cierre del año.** El año se cierra formalmente desde el 1 de enero siguiente, con un
  motivo, cuando cada faena tiene cerrados todos sus meses. Si en un mes se activó una revisión
  (v2), ese mes se cierra **en cada versión**: la anterior cierra sus semanas y la nueva las
  suyas. El aviso dice cuál falta, por ejemplo "marzo (v1)".
- **Archivos de evidencia.** Un archivo subido que todavía no se envió se conserva 24 horas. Si
  el envío llega después y el archivo ya no está, el formulario avisa que "ya no está en el
  almacenamiento" y hay que volver a subirlo. Un archivo ya vinculado a una faena no se puede
  reutilizar en otra: hay que subirlo de nuevo desde la faena que corresponde.
- **Archivos recién subidos (0334).** Un archivo que todavía no se envió sólo lo puede usar
  quien lo subió y en la faena para la que lo subió. Si otra persona o desde otra faena intenta
  usarlo, el formulario pide subir uno propio. **Los archivos subidos antes del despliegue y que
  todavía no se habían enviado no se pueden usar**: el aviso dice que "no tiene registro de
  subida" y hay que volver a subirlos. Los que ya estaban vinculados a una faena se siguen
  pudiendo reenviar desde esa misma faena.
- **Obligaciones.** Un caso registrado a mano siempre queda como manual y lleva motivo. Los
  casos integrados los abre sólo el sistema, desde el módulo de origen.

## 4. Contingencias y vuelta atrás

`deploy-prod.sh` imprime al inicio `imagen: <IMAGE> (rollback: <PREV_IMAGE>)`. Por defecto son
`ghcr.io/allopze/bodega:latest` y `ghcr.io/allopze/bodega:prev`. Si el `docker-compose.yml`
cambió, también imprime `saved previous Compose definition: <ruta>`.

### Falla un paso antes de "Recreating app container"

Esto incluye la migración, los scripts encadenados del servicio `migrate`
(`ensure-prevention-program-slots`, `backfill-cphs-mandatory-sessions` y
`reconcile-epp-delivery-scale`) y los pasos de datos y diagnóstico posteriores.

- En este punto el rollback automático todavía no está armado. `app` y `cron` siguen corriendo
  con la imagen anterior.
- Pero la imagen nueva ya quedó con la etiqueta de producción, y el compose nuevo ya está
  instalado. Un reinicio levantaría código nuevo contra el esquema viejo, o un `cron` viejo con
  el crontab nuevo. En el servidor de producción:

  ```sh
  docker tag ghcr.io/allopze/bodega:prev ghcr.io/allopze/bodega:latest   # los nombres que imprimió el script
  cp "<ruta impresa en 'saved previous Compose definition'>" "$PROD_DIR/docker-compose.yml"   # sólo si la imprimió
  ```

- Para saber en qué estado quedó la base, mirar hasta dónde llegó el log de `migrate` y el
  `created_at` máximo de `drizzle.__drizzle_migrations` (`select max(created_at) from
  drizzle.__drizzle_migrations`). Cada migración registra el `when` de su entrada en
  `db/migrations/meta/_journal.json`: `1790267545962` es 0328 y `1790477821468` es 0333; los
  de 0329 a 0332 están entre esos dos en el mismo archivo. No contar filas: una base que pasó
  por el corte de línea base (`MIGRATION_BASELINE_CUTOVER.md`) no tiene una por migración.
  - **Ninguna de 0329–0333 aplicada:** el preflight o la primera migración abortaron. Hay que
    corregir la causa (normalmente Q1) y volver a desplegar.
  - **Alguna o todas aplicadas:** volver a desplegar es seguro, porque las migraciones
    aplicadas no se repiten y los scripts encadenados son idempotentes. **No** conviene dejar
    corriendo el código viejo sobre ese esquema más de lo indispensable (ver abajo).
- No volver a desplegar sin haber restituido la etiqueta. El script copia la imagen actual
  sobre `:prev` al empezar, y se perdería el punto de vuelta bueno.

### Falla la verificación posterior (health, cron, smoke)

Con `ROLLBACK_ARMED=1`, el script revierte `app` y `cron` y restaura el compose. La excepción es
un log que diga `DTE cutover state: encrypted_only` o `unknown`, o `no previous image exists`.
En esos casos la vuelta atrás es manual, con una imagen compatible con el keyring.

### El código anterior sobre el esquema nuevo NO es transparente

La versión anterior de este documento decía que el código viejo funcionaba con el esquema
nuevo. Era cierto con 0329 sola. **Con 0330, 0331, 0332 y 0333 ya no lo es:**

- **0333 (`RESTRICT`).** El `deletePdtpProgram` y el borrado de actividades del código viejo
  contaban con la cascada. Con `RESTRICT`, borrar un borrador o una actividad que tenga
  ejecuciones, desvíos o cierres **falla** con un error de FK (`23001`). No se pierde nada: la
  operación se rechaza y el usuario ve un error genérico.
- **0331 (estados del "No aplica").** El código viejo sólo conoce `active` y `withdrawn`.
  - No ve los "No aplica" en `pending_review`. La celda aparece sin desvío y permite registrar
    una ejecución encima. Pero si alguien declara otro "No aplica" en esa celda, choca con el
    índice único nuevo ("Ya existe un desvío activo").
  - Los "No aplica" que se declaren con el código viejo nacen `active`, **sin revisión**.
  - Ignora los `rejected`, que es lo correcto.
- **0330.** El código viejo no conoce el cierre anual: un año cerrado volvería a aceptar
  registros y acreditaciones.
- **0334.** El código viejo no conoce las solicitudes: un "no aplica" o una cancelación de
  ocurrencia vuelven a aplicarse al instante y sin revisión, y las solicitudes pendientes quedan
  sin bandeja (no se pierden; se revisan al volver al código nuevo, aunque la ocurrencia pudo
  cambiar entretanto y la aprobación lo rechazará si ya tiene resultado). El código viejo tampoco
  escribe el registro de subidas: los archivos que se suban mientras corra quedarán "sin registro"
  para el código nuevo y habrá que volver a subirlos si no alcanzaron a vincularse. Las tablas
  nuevas no molestan al código viejo.
- **0332.** El código viejo no fija `deactivated_at` al dar de baja una faena. Después, el
  cierre anual no le exigirá a esa faena los meses anteriores a la baja.

Qué hacer:

1. **Preferir siempre corregir hacia adelante:** arreglar y volver a desplegar. Las cinco
   migraciones admiten volver a desplegar la versión nueva sin pasos extra.
2. Si de todos modos hace falta el código anterior (por ejemplo, la app nueva no arranca y no
   hay un arreglo rápido), tratarlo como una **ventana de congelamiento del PDTP**. Avisar a
   Prevención que durante la ventana no registre "No aplica", no borre programas ni
   actividades y no cierre años. Antes de revertir, correr Q5 y resolver (aprobar o rechazar)
   los `pending_review` que se pueda.
3. Al volver a la versión nueva, revisar lo que se hizo durante la ventana:

   ```sql
   -- "No aplica" creados sin revisión durante la ventana
   select id, activity_id, worksite_id, year, month, week, created_by_user_id, created_at
   from pdtp_execution_deviations
   where kind = 'not_applicable' and status = 'active' and reviewed_at is null
     and created_at >= '<inicio de la ventana>';

   -- ejecuciones registradas sobre una celda con un "No aplica" en revisión
   select e.id, e.activity_id, e.worksite_id, e.year, e.month, e.week, e.status
   from pdtp_executions e
   join pdtp_execution_deviations d on d.activity_id = e.activity_id and d.worksite_id = e.worksite_id
     and d.year = e.year and d.month = e.month and d.week = e.week and d.status = 'pending_review'
   where e.updated_at >= '<inicio de la ventana>';

   -- faenas dadas de baja durante la ventana (quedaron sin fecha de baja)
   select id, name from worksites where is_active = false and deactivated_at is null;
   ```

4. **No restaurar el `pg_dump` previo** salvo como último recurso. Devuelve el esquema a 0328,
   pero pierde todo lo registrado desde el despliegue.

## 5. Crons y procesos de un solo tiro

El contenedor `cron` es el único scheduler de `/api/cron/*`. La lista vive en
`scripts/cron-runner.mjs`, el crontab en `docker-compose.yml`, y la paridad entre los dos la
verifica `lib/__tests__/deploy-workflow.test.ts`. Estos son los **11** de Prevención:

| Job | Agenda (hora del contenedor) | Nota |
|---|---|---|
| `pdtp-weekly-reminders` | lunes 07:15 | |
| `prevention-capa-reminders` | diario 06:05 | |
| `prevention-training-reminders` | diario 06:10 | |
| `prevention-cphs-alerts` | diario 06:20 | |
| `prevention-document-ack-reminders` | diario 06:25 | |
| `sst-weekly-alerts` | diario 06:35 | |
| `deadline-reminders` | diario 06:55 | |
| `prevention-incident-reminders` | cada hora, minuto 10 | Encadena el barrido de reparación del RE-20 |
| `prevention-inspection-programs` | diario 04:50 | Reemplaza al workflow de GitHub Actions retirado |
| `pdtp-evidence-integrity` | diario 05:15 | Sólo observa. Deja la línea `[pdtp/evidence-integrity]` con nivel `error` y, si hay pérdidas, avisa (ver "Alertas") |
| `pdtp-evidence-gc` | diario 04:30 | **En modo de prueba** (sección 8) |

**Alertas (PREV-I13, reemplaza a D28).** Usan la infraestructura de avisos existente
(`createNotifications`: campana de la plataforma + correo por `lib/email/smtp.ts`), sin
proveedor nuevo. Lógica en `lib/services/prevention-ops-alerts.ts`:

- `pdtp-evidence-integrity` con archivos perdidos o alterados → usuarios activos con
  `admin:backups` (por defecto administrador y jefatura: quienes restauran respaldos).
- Cualquiera de estos 11 jobs (más `pdtp-fulfillment-reconcile`, encadenado al semanal) que
  termine en `failed` en `cron_runs` → usuarios activos con `admin:ops_settings` (por
  defecto administrador). El gancho está en `withCronLock`.
- Como máximo **un aviso por job y por día** (`dedupeKey` con el día chileno).
- Sin `RESEND_API_KEY` o con el envío de correos desactivado, el aviso queda en la campana
  y el log registra un `warn` "correo no configurado". La alerta nunca cambia el código de
  salida ni el error del cron.

Para verificar tras el despliegue: que al menos un usuario activo tenga cada permiso (si no,
el log dice "nadie a quien avisar").

Procesos de un solo tiro que **sólo informan** y que el deploy no corre:

- **B01: aprobaciones que sobrevivieron a una revocación** (servicio
  `revert-pdtp-revoked-approvals`, tanda T3). `docker compose run --rm
  revert-pdtp-revoked-approvals` imprime el reporte JSON sin escribir. Aplicarlo es una
  decisión de Prevención y exige un respaldo previo: `docker compose run --rm
  revert-pdtp-revoked-approvals node scripts/revert-pdtp-revoked-approvals.mjs --apply --actor
  <userId>`. Omite y lista los meses y programas cerrados, y declara el período ciego anterior
  al 03-09-2026.
- **D6: cierres desviados** (`npm run pdtp:report-closure-drift`, Q7). Se corre desde un
  checkout, contra la base de producción y con un usuario de solo lectura. Volver a correrlo
  después del despliegue confirma que la cifra coincide con la anticipada.

`preflight-pdtp-wiring`, en cambio, sí corre dentro del deploy (es el diagnóstico del cableado
de acreditación) y tampoco escribe.

## 6. Después: verificación

1. Los 11 crons de la sección 5 aparecen en `cron_runs` en su primera ventana.
2. El workflow de GitHub Actions `prevention-inspection-programs.yml` ya no existe, así que la
   materialización de inspecciones corre una sola vez al día, desde el contenedor.
3. El `created_at` máximo de `drizzle.__drizzle_migrations` es `1790517415741` (0334; si se
   despliega sin la rama `prevencion/c07-m02b`, `1790477821468`, 0333), y Q5
   muestra los mismos conteos que antes del despliegue (todavía no hay estados nuevos).
4. Recorrido corto en `/prevencion/pdtp`: registrar sin archivo muestra el mensaje de evidencia
   obligatoria; declarar un "No aplica" lo deja "en revisión"; el tablero y el listado de
   programas muestran la misma cifra. Subir un archivo deja una fila en `pdtp_evidence_uploads`
   con la faena y el usuario de quien subió.
5. Rechazar con motivo los envíos de Q2 que correspondan.
6. Correr el reporte B01 (sección 5) y revisarlo con Prevención.

## 7. Qué no hacer, y el año 2027

- **El programa 2027 ya se puede crear** (tanda T5). `createAnnualPdtpProgram` parte de una
  copia de la versión vigente del año anterior, no de la Base 2026. El modo `next_year` copia la
  cabecera y la leyenda de roles, pone el título y el período del año nuevo y re-ancla la
  programación, sin actividades retiradas, overrides ni padrón. Orden recomendado:
  1. crear y revisar el borrador 2027 en diciembre;
  2. cerrar diciembre de 2026 en cada faena;
  3. desde el 1 de enero de 2027, cerrar el año 2026 (`closePdtpProgramYear`, con motivo) y
     activar 2027.

  Un hecho de 2027 que llegue antes de la activación queda reintentable en el libro de
  cumplimiento y se acredita al activar.
- No encender `PDTP_EVIDENCE_GC_DELETE=true` sin haber revisado antes las filas del modo de
  prueba (sección 8).
- No borrar programas ni actividades durante una vuelta atrás de código (sección 4).

## 8. GC de evidencia en modo de prueba (T7a, W5-GC, D13; revisión final)

`pdtp-evidence-gc` barre los archivos huérfanos de `storage/pdtp-evidence/` y
`storage/risk-map/`. Un huérfano es un archivo que ninguna fila de la base referencia
(ejecuciones, plan de acción, historial de envíos, instancias programadas o planos) y que
tiene **más de 24 horas**. La ventana de gracia no baja de 24 horas aunque se pida menos: la
ruta responde 400. La revisión final del 2026-09-27 la subió desde una hora, porque en terreno
se sube la foto y el formulario se envía horas después.

- **Agenda:** diario a las 04:30, después del respaldo nocturno (03:00 UTC).
- **Modo:** de prueba mientras `PDTP_EVIDENCE_GC_DELETE` no valga `true` en el servicio `app`.
  En modo de prueba no borra nada: la respuesta dice `"dryRun": true` y `deleted` cuenta lo que
  *habría* borrado. La ruta manual `POST /api/prevencion/pdtp/evidence/gc` obedece la misma
  variable.
- **Respuesta acotada:** el cron y la ruta manual devuelven conteos y una muestra de 20 nombres
  (`deletedSample`). La lista completa queda en la fila de auditoría.
- **Constancia:** cada corrida que encuentra huérfanos deja una fila en `audit_log` con
  `entity_type = 'storage_orphan_sweep'`, el directorio (`entity_code`: `pdtp/evidence-gc` o
  `risk-map/evidence-gc`), el modo y hasta 500 nombres. Una corrida sin huérfanos no escribe
  nada.

**Revisión antes de encender el borrado (1 a 2 semanas):**

```sql
SELECT created_at, entity_code, new_state::jsonb->>'dryRun' AS dry_run,
       new_state::jsonb->>'deleted' AS candidatos, new_state::jsonb->'names' AS nombres
FROM audit_log
WHERE entity_type = 'storage_orphan_sweep'
ORDER BY created_at DESC;
```

Para cada nombre candidato hay que confirmar que de verdad nadie lo usa: que
`/api/prevencion/pdtp/evidence/<nombre>` no lo sirva y que `pdtp-evidence-integrity` no lo
reporte como perdido. Si un nombre aparece y se usa, **no encender**: hay un productor que no
está en `collectPdtpEvidenceReferences`, y hay que agregarlo ahí primero.

**Encender el borrado real:** agregar `PDTP_EVIDENCE_GC_DELETE=true` al `.env` de producción y
recrear `app` (`docker compose up -d --no-deps --force-recreate app`). La primera corrida
siguiente deja una fila con `"dryRun": false`. Lo borrado sigue en el `storage.tar.gz` de los
snapshots mientras esté dentro de la retención. Para volver al modo de prueba, quitar la
variable y recrear `app`. Con la variable encendida, una corrida manual en modo de prueba se
pide con `?dryRun=true`.
