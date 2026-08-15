# TODO — Remediación de auditoría de cambios (2026-08-14)

Checklist vivo de la auditoría del working tree contra `HEAD`. Un ítem se marca
como completado sólo después de implementar su corrección y ejecutar una prueba
enfocada que demuestre la regresión.

## Integridad y despliegue

- [x] **AUD-01 — Proteger retiros de tablas históricas.** Agregar preflight
  fail-closed para `pdtp_action_plan`, `pdtp_action_plan_followups`,
  `sst_action_plan` y `ppa_corrective_actions`, e integrarlo a todas las rutas de
  migración antes de los `DROP TABLE` de 0161/0165.
- [x] **AUD-02 — Ejecutar los preflight en el runner standalone.** El servicio
  Compose y `deploy:prod` deben aplicar las mismas precondiciones que
  `npm run db:migrate`, incluido el vínculo único DTE.
- [x] **AUD-03 — Impedir desactivar una faena desde edición general.** El estado
  activo sólo cambia mediante el flujo explícito de cierre/reactivación.
- [x] **AUD-04 — Hacer atómico el cierre de faena.** Membresía PDTP, CAPA,
  obligaciones, estado y auditoría deben confirmar o revertir juntos.
- [x] **AUD-05 — Preservar historial CAPA al eliminar una evaluación SST.** Usar
  el actor real, transición auditada y control de estados/versiones.

## CPHS, certificación y organización preventiva

- [x] **AUD-06 — Expirar delegados por fecha.** Un `termEndsOn` vencido no debe
  bloquear reemplazo ni contar como cumplimiento.
- [x] **AUD-07 — Exigir y mostrar evidencia en declaraciones manuales.** Una
  declaración manual no se guarda como cumplida sin referencia y la referencia
  debe permanecer visible en borrador y snapshot.
- [x] **AUD-08 — Congelar certificaciones sin carreras.** Lectura, CAS, snapshot
  y creación CAPA deben compartir una sola transacción y versión consistente.
- [x] **AUD-09 — Corregir umbrales de mandato 60/30/7.** Cada ventana debe usar
  el umbral más cercano ya alcanzado y una deduplicación distinta.
- [x] **AUD-10 — Inmutabilidad de sesiones cerradas.** No admitir invitados ni
  otras mutaciones de asistencia después del cierre/cancelación.
- [x] **AUD-11 — Serializar reemplazos de integrantes.** Sólo una transacción
  puede reemplazar al integrante activo original.
- [x] **AUD-12 — Incluir estado del programa en la ficha preventiva de faena.**

## DTE, facturación, PDTP y cola operacional

- [x] **AUD-13 — `dryRun` realmente sin escrituras.** No crear corrida, factura,
  cursor durable ni otra persistencia en una simulación.
- [x] **AUD-14 — Conciliación DTE basada en todos los vínculos.** Las
  discrepancias preexistentes deben mantener la corrida en `partial`.
- [x] **AUD-15 — Admitir `module=cphs` en los filtros de `/pendientes`.**
- [x] **AUD-16 — Deduplicar CAPA PDTP por instancia de checklist.** Incluir el
  identificador de instancia/sujeto en `source_ref` y en la consulta.
- [x] **AUD-17 — Alinear el alcance documentado del retiro SST/PPA.** El plan
  debe reflejar expresamente la fase que ejecuta 0165.

## Archivos e interfaz

- [x] **AUD-18 — Hacer atómica/compensable la carga de mapa MIPER.** Persistir
  el MIME detectado por bytes y eliminar el archivo si falla el registro DB.
- [x] **AUD-19 — Llevar acciones globales de programa/certificación a
  `PageHeader.actions`.**
- [x] **AUD-20 — Convertir KPIs en controles accionables y evitar ceros/guiones
  vacíos sin orientación.**
- [x] **AUD-21 — Formatear fechas con `formatDate`/`formatDateTime`.**
- [x] **AUD-22 — Completar estados vacíos con `EmptyState` y CTA real.**
- [x] **AUD-23 — Traducir el enum de estado documental antes del `Badge`.**

## Gate final

- [x] **AUD-24 — Volver determinista la prueba de manipulación AES-GCM.**
- [x] **AUD-25 — Gates completos.** `git diff --check`, pruebas enfocadas,
  `test:fast`, PGlite, ESLint, TypeScript, cadena de migraciones, secretos,
  auditoría de dependencias, React Doctor y build de producción.

## Evidencia acumulada

- Estado inicial: `main == origin/main`, 124 archivos tracked modificados y 73
  archivos no rastreados antes de esta remediación.
- Auditoría inicial: build, TypeScript, ESLint, PGlite (635/635), secretos y
  migraciones pasaron; `test:fast` quedó rojo por AUD-24.
- AUD-01/AUD-02: `migration-preflight.test.ts` y
  `deploy-workflow.test.ts`, 16/16 pruebas enfocadas en verde. El preflight
  rechaza historia legacy, conflictos DTE y PDTP no reconciliado antes de llamar
  al migrador standalone.
- AUD-03–AUD-11: 89/89 pruebas enfocadas en verde. Incluye rollback integral
  del cierre de faena, transición CAPA auditada al borrar SST, delegados
  vencidos, snapshot/versionado de certificación, ventanas 60/30/7, actas
  cerradas inmutables y reemplazo CAS de integrantes.
- AUD-12–AUD-16: 70/70 pruebas enfocadas en verde. La ficha expone el último
  programa CPHS; `dryRun` conserva corrida, facturas y cursor sin cambios; la
  conciliación considera vínculos ya persistidos; `module=cphs` sobrevive al
  parser; y cada CAPA PDTP queda identificada por su instancia de checklist.
- AUD-17: `tasks/plan.md` declara que la ampliación de alcance fue ejecutada en
  la Fase 5 por la migración 0165; ya no presenta SST/PPA como trabajo futuro.
- AUD-18: 2/2 pruebas de ruta en verde. El POST registra archivo y layout en
  una sola operación, normaliza extensión/MIME desde magic bytes y compensa el
  archivo si falla la escritura transaccional en base.
- AUD-19–AUD-23: 4/4 contratos de interfaz y ESLint enfocado en verde. Las
  acciones globales se proyectan al `PageHeader`; los KPI filtran; fechas,
  vacíos y estados documentales usan los componentes/catálogos compartidos.
- AUD-24: 4/4 pruebas criptográficas en verde. La manipulación ahora altera un
  byte real del ciphertext decodificado, no un carácter base64url que podía
  coincidir con el valor existente o modificar sólo bits de relleno.
- AUD-25: `git diff --check`, TypeScript, ESLint, cadena de 169 migraciones,
  secretos, auditoría de dependencias y build de Next 16.2.12 en verde;
  `test:fast` 4.060/4.060 y PGlite 672/672. React Doctor ejecutado sobre los
  cambios: 84/100, 69 advertencias sin errores; ninguna nace de las líneas UI
  corregidas y los `await` de transición CAPA se mantienen seriales por contrato
  transaccional.
