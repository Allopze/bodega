# Reglas de QA y auditoría (`qa/`)

Se cargan cuando se trabaja dentro de `qa/`.

Los comentarios de código y specs que citan ««Locators in this repository» de AGENTS.md» o las clasificaciones de hallazgos (PRODUCT BUG, UX FINDING, INCONSISTENCY) se refieren a este archivo.

<!-- BEGIN:qa-audit-contract -->
# QA and Browser Audit Contract

This repository uses an AI-assisted browser QA pipeline built around Playwright and a locally adapted MonkeyTest workflow. The audit pipeline is evidence for product quality; it does **not** replace deterministic unit/integration/E2E tests.

## Canonical commands

> **Estado del contrato (2026-09-12).** Los scripts `npm run audit`, `npm run audit:full`
> y `npm run audit:report` **no existen** en `package.json` y no hay motor de crawling en
> el repositorio: lo único versionado del pipeline asistido es `scripts/qa-login.mjs`, que
> guarda la sesión en `playwright/.auth/monkeytest.json` para una herramienta externa. Este
> contrato los declaraba canónicos, de modo que el procedimiento documentado para auditar y
> recuperar una liberación no era ejecutable tal como estaba escrito. Lo de abajo describe
> lo que el repositorio sí expone. **No inventes los comandos ausentes ni reportes una
> auditoría como ejecutada porque el contrato la nombre.**

Las puertas deterministas que sí existen, y que son las que gobiernan una liberación:

```bash
npm run typecheck                # tsc sobre el código; no lee .next/** (tsconfig.typecheck.json)
npm run lint
npm run check:secrets            # archivos .env fuera de lugar
npm run check:security-audit     # npm audit con allowlist documentado y con fecha de caducidad
npm run test:fast                # unitarias sin PGlite
npm run test:pglite              # suites contra PGlite
npm run test:e2e                 # Playwright
npm run db:verify-migrations     # cadena de migraciones + inspección del SQL
npm run doctor                   # React Doctor
```

`.github/workflows/ci.yml` corre exactamente estas puertas; si una falla ahí, falla la
liberación. Para el alcance de cada una ver la tabla de más abajo.

`npm run typecheck` usa `tsconfig.typecheck.json`, que no lee `.next/**` ni `next-env.d.ts`:
su resultado no depende de qué `next dev` o `next build` corrió antes en ese checkout (el
2026-10-31 un `.next` desfasado tumbó un deploy con 36 errores ajenos al código). Los
validadores de rutas de Next (`.next/types/validator.ts`) los sigue cubriendo `next build`
en el job de build del CI, no esta puerta.

**Al agregar una migración** hay que registrar su checksum en
`db/migrations/meta/_sql-checksums.json`:

```bash
node scripts/verify-migration-chain.mjs --update-checksums
```

Ese manifiesto es lo que impide reescribir una migración ya publicada (DAT-002):
reescribir un archivo que producción ya aplicó no vuelve a ejecutarlo, así que la
base queda en un estado que el repo ya no describe. El verificador comprueba
además que ningún `DROP` de objeto nuevo venga sin `IF EXISTS` y que ningún
`.sql` quede sin una sola sentencia ejecutable; el criterio con el que se
eligieron esas tres comprobaciones —objetivas y sin falsos positivos— está en
`scripts/migration-sql-checks.mjs`.

### Auditoría de navegador asistida

Sigue siendo válida como **evidencia** de calidad de producto —no reemplaza a las pruebas
deterministas— pero hoy es un recorrido asistido, no un script. Quien la ejecute debe
dejar su salida versionada bajo `qa/reports/` con fecha en el nombre, y decir explícitamente
qué alcance cubrió y qué quedó sin recorrer.

## Mandatory human-readable report

Audits are expected to produce:

```text
qa/reports/latest.md
```

Treat this Markdown file as the primary human-readable QA result. Read it after an audit. Do **not** rely only on MonkeyTest's terminal summary.

The report should distinguish at least:

- confirmed product bugs;
- functional findings;
- UI/UX findings;
- inconsistencies;
- automation warnings;
- coverage gaps;
- improvement opportunities;
- console errors;
- network failures;
- route/step coverage;
- prioritized recommendations.

If an audit completes but the report is missing, report the audit pipeline as incomplete instead of pretending the audit succeeded fully.

## MonkeyTest interpretation rule

MonkeyTest may report an overall flow as `passed` even when one or more individual steps were:

- skipped;
- blocked;
- not located;
- not executed;
- impossible for the automation agent to verify.

Therefore:

```text
flow passed != flow fully verified
```

The analysed report and individual step evidence take precedence over the aggregate green/red flow count.

Use these meanings:

### PRODUCT BUG
Confirmed incorrect application behavior supported by evidence.

### FUNCTIONAL FINDING
Suspicious or partially incorrect behavior requiring investigation, without enough evidence yet to call it a confirmed product bug.

### UX FINDING
Observable usability, clarity, feedback, discoverability or navigation problem.

### INCONSISTENCY
Different patterns, terminology, controls or behavior for equivalent concepts.

### AUTOMATION WARNING
The automation could not perform or observe something. This is **not automatically a product bug**.

### COVERAGE GAP
The functionality was not sufficiently tested or could not be reached/verified.

### IMPROVEMENT OPPORTUNITY
The application works, but evidence supports a concrete improvement.

### PASS
Behavior that was actually verified.

Never convert an automation failure into a product bug without evidence.

## Coverage semantics

Never claim:

> 100% of the application was audited.

The crawler can only audit routes and states that it discovers and can reach.

If an audit reports:

```text
187 routes discovered
187 routes visited
0 pending
```

the correct statement is:

> 100% of the discovered routes were processed.

It does **not** prove that every possible route, modal state, conditional workflow or programmatic navigation path in the application was discovered.

For important full audits, compare crawler coverage against:

- `app/(app)/`;
- route/navigation definitions;
- `modules/registry.ts`;
- relevant module manifests;
- permission mappings;
- conditional/programmatic navigation paths.

## Authenticated QA environment

Browser audits use a dedicated authenticated QA session. Relevant local files may include:

```text
.env.qa
playwright/.auth/monkeytest.json
scripts/qa-login.mjs
```

Hard rules:

- Never commit `.env.qa`.
- Never commit `playwright/.auth/`.
- Never print credentials, API keys, session cookies or tokens in logs, reports or chat output.
- Never copy QA credentials into source code.
- Treat Playwright storage state as a credential.
- If the session expires, regenerate the QA session rather than weakening authentication.
- The browser session should carry application authentication; the LLM does not need the application password.

## QA environment safety

Automated exploratory testing must target development, QA or staging unless explicitly authorized otherwise.

Never point unrestricted exploratory automation at production.

Be especially cautious with actions that can:

- delete records;
- approve/reject business operations;
- send email or notifications;
- create financial/legal documents;
- perform payments;
- modify permissions;
- close operational processes;
- trigger external integrations;
- mutate real production data.

Prefer dedicated QA records with a recognizable `QA_` prefix when test data must be created.

## Local MonkeyTest fork

The current development environment may use a locally patched MonkeyTest checkout under:

```text
~/monkeytest-core
```

It can contain project-specific changes such as authenticated Playwright state support, crawl-limit changes and reporting adaptations.

Do **not** during ordinary application work:

- replace it with the npm package;
- reset/reclone it;
- `git restore` its project-specific changes;
- upgrade it blindly;
- assume upstream MonkeyTest behavior exactly matches the local fork.

Normal application work should interact with QA through the repository gates listed under "Canonical commands", not by modifying the QA engine.

## Test strategy

Use the smallest useful verification first:

| Change | Preferred verification |
|---|---|
| Pure logic | Unit tests |
| Business/service logic | Service/integration tests |
| Server actions/forms | Validation/action tests + UI verification when user-visible |
| UI interaction | Playwright/browser verification |
| Critical user journey | Deterministic Playwright regression test |
| Exploratory product QA | recorrido de navegador asistido (ver "Canonical commands") |
| Cross-application/release QA | `npm run test:e2e` + recorrido asistido de alcance completo |

AI exploratory testing complements deterministic tests. It does not replace them.

### Locators in this repository

At least fifteen screens render the same content twice — cards `md:hidden` **and**
a table `hidden md:block` — and both trees stay in the DOM. The distinction that
decides every case:

- `getByRole()` ignores hidden nodes by default, so role-based locators survive.
- `getByText()`, `getByLabel()` and `locator()` do **not** filter, so they either
  break on strict mode or hang waiting for a node that will never be visible.

Use the `textoVisible()` / `campoInspeccion()` helpers in `e2e/helpers.ts` rather
than `.first()`: `.first()` returns the mobile node, which is the hidden one on a
desktop viewport. That failure mode is the most misleading one in this suite —
it reads exactly like the action under test never happened.

Also: `getByRole(role, { name })` matches the accessible name by **substring**.
`{ name: "Abrir menú" }` also matches "Abrir menú de usuario", and
`{ name: "Limpiar" }` also matches "Limpiar filtros". Pass `exact: true` whenever
one label is a prefix of another.

## When an audit finds something

Do not blindly fix every generated finding.

For each finding:

1. Inspect its evidence.
2. Reproduce it independently when feasible.
3. Classify it as product bug, UX problem, inconsistency, automation limitation, coverage gap or improvement opportunity.
4. Fix confirmed product issues or intentional improvements only after understanding the cause.
5. Re-run the relevant targeted verification.
6. Add regression coverage for important confirmed defects.

If something could not be tested, say so explicitly. Missing evidence must never be silently converted into success.
<!-- END:qa-audit-contract -->
