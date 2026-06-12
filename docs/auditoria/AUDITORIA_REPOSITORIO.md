# Auditoria del repositorio

Fecha de auditoria: 2026-06-12

## Resumen ejecutivo

Estado general: el repo esta bastante avanzado para un sistema interno Next.js/SQLite con RBAC, server actions, XLSX, tests unitarios y E2E. `npm run build`, `npm run lint` y `npm test` pasan, pero hay un P0 real en el flujo de contrasena inicial, E2E roto, secretos locales expuestos en `.env.local`, y deuda de consistencia entre arquitectura modular declarada y codigo real.

Nivel de confianza: medio-alto. Se reviso estructura, documentacion, guias locales de Next.js 16, autenticacion, Server Actions, API routes, exports, schema DB, tests y tooling. No se hicieron cambios de codigo durante la auditoria.

Areas mas criticas:

- Bloquear el flujo de password setup sin token.
- Rotar secretos locales encontrados.
- Reparar E2E admin.
- Resolver o mitigar vulnerabilidades runtime de dependencias.
- Completar la migracion real a permisos derivados del registry.

## Stack y arquitectura detectada

- Lenguajes: TypeScript, TSX, SQL.
- Frameworks: Next.js `16.2.7` App Router, React `19.2.4`.
- Base de datos: SQLite con `better-sqlite3` y Drizzle.
- Auth: `next-auth@5.0.0-beta.31`, Credentials, JWT, RBAC.
- UI: Tailwind CSS v4, Radix UI, Phosphor Icons.
- Exportacion: ExcelJS/XLSX.
- Testing: Vitest, Testing Library, Playwright.
- Arquitectura declarada: monolito modular con `modules/*`, `core/*`, `lib/*`, App Router en `app/*`.
- Scripts relevantes: `dev`, `build`, `lint`, `test`, `test:e2e`, `db:migrate`, `db:seed`.

## Hallazgos criticos y de alta prioridad

### 1. Toma de cuentas precreadas por email

- **Severidad:** Critica
- **Prioridad:** P0
- **Ubicacion:** `app/(auth)/login/actions.ts:24`, `app/(app)/admin/usuarios/actions.ts:148`, `app/(auth)/login/login-form.tsx:52`
- **Descripcion:** el admin puede crear usuarios activos con `pending-password:*`; luego cualquier visitante que conozca el email puede activar la contrasena desde `/login` sin token de invitacion.
- **Impacto:** secuestro de cuentas nuevas antes de que el usuario legitimo entre.
- **Evidencia:** `createUser` guarda `hashedPassword: createPendingPasswordMarker()` y `setInitialPassword` solo recibe `{ email, password, confirmPassword }`.
- **Causa probable:** se mezclaron dos flujos: invitacion con token y usuario creado por admin que define contrasena al iniciar sesion.
- **Solucion recomendada:** exigir token one-time para `setInitialPassword`; guardar hash, expiracion y consumo del token; no revelar desde `getPasswordSetupState` si una cuenta existe o esta pendiente.
- **Tests sugeridos:** Server Action test donde `setInitialPassword` falla sin token, falla con token expirado/usado, y consume un token valido exactamente una vez.

### 2. Secretos reales o sensibles presentes en `.env.local`

- **Severidad:** Alta
- **Prioridad:** P0/P1
- **Ubicacion:** `.env.local`
- **Descripcion:** el archivo local contiene credenciales SMTP y password seed. Esta git-ignored, pero existe en el workspace compartido.
- **Impacto:** si esas credenciales son reales, deben considerarse comprometidas.
- **Evidencia:** `.env.local` tiene `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SEED_ADMIN_PASSWORD`.
- **Causa probable:** uso de archivo local real para desarrollo.
- **Solucion recomendada:** rotar SMTP/passwords, mover secretos a gestor de secretos y dejar `.env.local` saneado para trabajo compartido.
- **Tests sugeridos:** check de CI o pre-commit que bloquee secretos conocidos y `.env*` fuera de allowlist.

### 3. E2E roto en flujos admin

- **Severidad:** Alta
- **Prioridad:** P1
- **Ubicacion:** `e2e/admin-flow.spec.ts:25`, `e2e/admin-flow.spec.ts:39`, `e2e/admin-flow.spec.ts:58`
- **Descripcion:** `npm run test:e2e` fallo en los tests admin.
- **Impacto:** no hay confianza automatizada en CRUD admin, usuarios ni bootstrap operativo.
- **Evidencia:** primer fallo por strict mode: `getByLabel("Codigo")` coincide con boton "Ordenar por Codigo" y textbox. Otros tests quedaron esperando "nuevo producto" e "invitar usuario" hasta timeout.
- **Causa probable:** locators fragiles y/o UI actualizada sin actualizar E2E.
- **Solucion recomendada:** usar locators especificos como `getByRole("textbox", { name: "Codigo" })`, actualizar textos esperados y dividir smoke tests criticos de pruebas largas.
- **Tests sugeridos:** E2E admin minimo para crear faena, producto, proveedor e invitacion, con locators por role/name estables.

### 4. Vulnerabilidad runtime en cadena `next-auth`

- **Severidad:** Alta/Media
- **Prioridad:** P1
- **Ubicacion:** `package.json`
- **Descripcion:** `npm audit --omit=dev` reporta vulnerabilidades en la cadena `next-auth -> @auth/core -> nodemailer`.
- **Impacto:** riesgo en dependencia de autenticacion/correo. El fix automatico propuesto por npm implica cambio mayor peligroso.
- **Evidencia:** audit reporto 3 vulnerabilidades, incluida moderada por SMTP command injection en `nodemailer`.
- **Causa probable:** dependencia beta de Auth.js con transitive vulnerable.
- **Solucion recomendada:** evaluar version corregida de Auth.js/NextAuth beta o mitigacion explicita; no aplicar `npm audit fix --force` sin plan de migracion.
- **Tests sugeridos:** smoke auth completo tras cualquier actualizacion de `next-auth`.

## Hallazgos de severidad media y baja

### 5. Trazabilidad carga tablas completas y filtra en memoria

- **Severidad:** Media
- **Prioridad:** P2
- **Ubicacion:** `lib/services/trazabilidad-export.ts:31`
- **Descripcion:** export trae todos los items, solicitudes, productos, faenas, OC y recepciones; filtra por `canAccessWorksite` dentro del loop.
- **Impacto:** mala minimizacion de datos y performance degradada al crecer la base.
- **Evidencia:** `Promise.all` consulta tablas completas y el filtro de faena ocurre en `if (!canAccessWorksite(session, request.worksiteId)) continue`.
- **Causa probable:** reutilizacion rapida de logica de matriz.
- **Solucion recomendada:** empujar filtros por faena a SQL y consultar entidades relacionadas solo para ids visibles.
- **Tests sugeridos:** test de usuario scoped que confirme que no se consultan ni exportan faenas no visibles.

### 6. Reglas de integridad criticas viven solo en aplicacion

- **Severidad:** Media
- **Prioridad:** P2
- **Ubicacion:** `db/schema/requests.ts:38`, `db/schema/purchasing.ts:37`, `db/schema/stock.ts:8`
- **Descripcion:** cantidades positivas, estados validos, descuentos y exclusividad producto catalogo/texto libre no estan protegidos con constraints DB.
- **Impacto:** scripts, migraciones o bugs pueden dejar datos invalidos.
- **Evidencia:** schemas Drizzle usan `text`/`real` sin `CHECK` para estados o rangos.
- **Causa probable:** invariantes concentrados en Zod y servicios.
- **Solucion recomendada:** anadir `CHECK` constraints en migraciones futuras y tests de schema.
- **Tests sugeridos:** test de schema que intente insertar cantidad negativa, estado invalido y request item sin producto ni texto libre.

### 7. Uploads dependen de filesystem local

- **Severidad:** Media
- **Prioridad:** P2
- **Ubicacion:** `app/(app)/entregas/actions.ts:98`
- **Descripcion:** comprobantes se escriben en `storage/deliveries`.
- **Impacto:** despliegues tipo serverless/lambda pueden perder archivos o no permitir escritura persistente.
- **Evidencia:** `fs.writeFile` escribe en `STORAGE_DIR = path.join(process.cwd(), "storage", "deliveries")`.
- **Causa probable:** implementacion local-first.
- **Solucion recomendada:** documentar hosting requerido o mover adjuntos a storage dedicado.
- **Tests sugeridos:** test de upload que verifique persistencia y descarga; prueba de configuracion para provider de storage.

### 8. Arquitectura modular todavia no coincide con la promesa documental

- **Severidad:** Media
- **Prioridad:** P2
- **Ubicacion:** `modules/permissions.ts:31`, `db/seed.ts:199`
- **Descripcion:** docs dicen que permisos/seed/nav derivan del registry, pero el seed mantiene permisos manuales y el tipo `Permission` sigue legacy.
- **Impacto:** deriva silenciosa cuando se agreguen permisos.
- **Evidencia:** `modules/permissions.ts` re-exporta `Permission` desde `@/lib/auth/types`; `db/seed.ts` lista permisos manualmente.
- **Causa probable:** migracion modular en curso.
- **Solucion recomendada:** derivar seed desde `ALL_MODULE_PERMISSIONS` y hacer que `Permission = RegistryPermission`.
- **Tests sugeridos:** test que compare permisos de registry, tipo/runtime seed y DB seeded.

### 9. Warnings de lint acumulados

- **Severidad:** Baja
- **Prioridad:** P3
- **Ubicacion:** varios archivos
- **Descripcion:** `npm run lint` pasa con 15 warnings.
- **Impacto:** ruido que puede esconder regresiones futuras.
- **Evidencia:** warnings de `react-hooks/set-state-in-effect`, imports/variables no usados y eslint-disable innecesarios.
- **Solucion recomendada:** limpiar warnings faciles y decidir patron para sincronizacion de formularios.
- **Tests sugeridos:** CI con presupuesto de warnings o fail-on-warning cuando el backlog este limpio.

## Bugs potenciales por flujo funcional

### Autenticacion y usuarios

- Password setup inicial sin token permite toma de cuenta precreada.
- `getPasswordSetupState` puede revelar si un email corresponde a una cuenta activa pendiente.
- La cadena de auth usa `next-auth` beta con vulnerabilidad transitive reportada por audit.

### Admin

- E2E admin no representa la UI actual.
- Tests esperan labels/botones que ya no son unicos o no existen con ese nombre.

### Trazabilidad y reportes

- Export XLSX cumple la regla de formato.
- Trazabilidad filtra en memoria tras leer datos globales.

### Entregas y adjuntos

- Upload local funciona para entorno persistente, pero no es portable a serverless.
- Descarga de adjuntos valida auth, faena y path prefix, lo cual es positivo.

## Inconsistencias detectadas

- `docs/planificacion/PLAN.md` menciona exportacion CSV, contradiciendo `AGENTS.md` y la implementacion XLSX.
- `docs/pruebas/TESTING.md` describe E2E con 2 tests y flujo con factura, pero hoy hay 9 tests y fallan en admin.
- `.github/workflows` no existe; no hay CI visible para lint/test/build/e2e.
- La arquitectura dice que permisos y seed se derivan automaticamente del registry, pero hay listas manuales en `db/seed.ts` y `lib/auth/types.ts`.

## Seguridad

Riesgos encontrados:

- P0: password setup sin token.
- P0/P1: secretos locales presentes en `.env.local`.
- P1: vulnerabilidad transitive en `next-auth`.
- P2: trazabilidad no minimiza consultas por scope.

Cambios minimos antes de produccion:

- Exigir token one-time en password setup.
- Rotar credenciales SMTP y password seed.
- Resolver/mitigar dependencia vulnerable.
- Confirmar CI minimo para build, lint, unit y E2E smoke.

## Performance y optimizacion

- Trazabilidad export puede degradarse con el tamano de la base por consultas completas.
- Algunos componentes tienen warnings de `setState` sincronico en effects.
- `npm outdated` muestra parches disponibles para Radix, React, Next y tipos; conviene planificar update controlado.

## Tests recomendados

| Prioridad | Tipo de test | Area | Que debe validar |
|---|---|---|---|
| P0 | Seguridad / Server Action | Login/password setup | No se puede definir contrasena inicial sin token valido |
| P1 | E2E | Admin | CRUD faenas/productos/proveedores/usuarios con locators robustos |
| P1 | Integracion | RBAC | Server Actions no permiten operar faenas ajenas |
| P1 | Dependencias/Auth | Login | Auth sigue funcionando tras actualizar o mitigar NextAuth/Auth.js |
| P2 | DB/schema | Integridad | Cantidades, estados y relaciones invalidas son rechazadas |
| P2 | Performance/seguridad | Trazabilidad | Usuario scoped no consulta ni exporta datos de otras faenas |
| P2 | Upload/download | Entregas | Comprobante se guarda, se autoriza por faena y se descarga correctamente |

## Mejoras de arquitectura y mantenibilidad

- Completar migracion de permisos al registry.
- Mover invariantes repetidos a servicios o constraints compartidos.
- Reducir shims `modules/* -> app/*` cuando termine la fase modular.
- Documentar decision de storage local o abstraerlo tras un provider.
- Convertir advertencias recurrentes de React effects en patrones documentados.

## Mejoras de DX, documentacion y tooling

- Agregar `.github/workflows` con `npm ci`, `npm run lint`, `npm test`, `npm run build` y al menos un E2E smoke.
- Actualizar docs que mencionan CSV.
- Actualizar docs de E2E para reflejar cantidad real de tests y estado de admin flows.
- Anadir una guia segura de variables de entorno, diferenciando `.env.example`, desarrollo local y produccion.
- Considerar un check automatizado contra secretos.

## Plan de accion sugerido

### Fase 1: Correcciones urgentes

- [ ] Bloquear `setInitialPassword` sin token one-time.
- [ ] Rotar secretos presentes en `.env.local`.
- [ ] Corregir E2E admin roto.
- [ ] Evaluar mitigacion para vulnerabilidad de `next-auth`/`nodemailer`.

### Fase 2: Estabilizacion

- [ ] Agregar CI con lint, unit, build y E2E smoke.
- [ ] Mover filtros de trazabilidad a SQL.
- [ ] Anadir tests de RBAC por Server Actions criticas.
- [ ] Limpiar warnings de lint mas simples.

### Fase 3: Optimizacion y mantenimiento

- [ ] Completar migracion de permisos al registry.
- [ ] Anadir constraints DB para invariantes de dominio.
- [ ] Decidir storage persistente para adjuntos.
- [ ] Actualizar documentacion obsoleta.

## Preguntas abiertas o supuestos

- Se asume que las credenciales de `.env.local` pueden ser reales; si son ficticias, aun conviene sanear el archivo compartido.
- No se confirmo si el target de produccion sera serverful con disco persistente o serverless.
- No se completo la suite E2E porque se interrumpio tras fallos largos repetidos.
- No se hizo exploracion manual completa de UI por navegador.

## Archivos revisados

- `package.json`
- `AGENTS.md`
- `README.md`
- `docs/arquitectura/ARCHITECTURE.md`
- `docs/pruebas/TESTING.md`
- `next.config.ts`
- `eslint.config.mjs`
- `proxy.ts`
- `lib/auth/*`
- `app/api/*`
- `app/(auth)/*`
- `app/(app)/*/actions.ts`
- `lib/services/*`
- `lib/reports/export.ts`
- `db/schema/*`
- `db/seed.ts`
- `e2e/*`
- `modules/*`

## Archivos no revisados o cobertura limitada

- No se hizo revision exhaustiva linea por linea de todos los componentes visuales.
- No se inspeccionaron todos los assets/documentos binarios en `docs/`.
- No se ejecuto prueba manual completa de flujo operacional.

## Verificacion ejecutada

| Check | Resultado |
|---|---|
| `npm run lint` | Pasa, 15 warnings |
| `npm test` | Pasa, 23 archivos / 164 tests |
| `npm run build` | Pasa |
| `npm audit --omit=dev` | Falla, 3 vulnerabilidades |
| `npm run test:e2e` | Falla/interrumpido tras 3 fallos y 1 interrupcion |
