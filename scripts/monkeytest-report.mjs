import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const MONKEY_DIR = path.join(ROOT, '.monkeytest');
const REPORT_DIR = path.join(ROOT, 'qa', 'reports');

const API_KEY =
  process.env.OPENAI_COMPATIBLE_API_KEY ||
  process.env.CMD_API_KEY;

const BASE_URL =
  process.env.OPENAI_COMPATIBLE_BASE_URL ||
  'https://api.commandcode.ai/provider/v1';

const MODEL =
  process.env.MONKEYTEST_REPORT_MODEL ||
  process.env.MONKEYTEST_MODEL ||
  'deepseek/deepseek-v4-flash';

if (!API_KEY) {
  console.error(
    'ERROR: falta OPENAI_COMPATIBLE_API_KEY o CMD_API_KEY'
  );
  process.exit(1);
}

await fs.mkdir(REPORT_DIR, { recursive: true });

/**
 * Obtiene el último run directamente desde MonkeyTest.
 */
async function getLatestRun() {
  const { stdout } = await execFileAsync(
    'monkeytest',
    ['report', 'latest', '--json'],
    {
      cwd: ROOT,
      maxBuffer: 50 * 1024 * 1024
    }
  );

  return JSON.parse(stdout);
}

/**
 * Lee JSON si existe.
 */
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Evita mandar DOM gigantesco al modelo.
 */
function sanitizeBug(bug) {
  return {
    id: bug.id,
    fingerprint: bug.fingerprint,
    title: bug.title,
    severity: bug.severity,
    affectedFlow: bug.affectedFlow,
    reproSteps: bug.reproSteps,
    observed: bug.observed,
    expected: bug.expected,
    triageNotes: bug.triageNotes,

    evidence: {
      screenshots: bug.evidence?.screenshots || [],
      consoleErrors: bug.evidence?.consoleErrors || [],
      networkFailures: bug.evidence?.networkFailures || []
    }
  };
}

function sanitizeRun(stored) {
  const run = stored.run;

  return {
    id: stored.id,
    createdAt: stored.createdAt,

    startUrl: run.startUrl,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,

    stats: run.stats,

    flows: run.flows.map(flow => ({
      flowId: flow.flowId,
      name: flow.name,
      description: flow.description,
      kind: flow.kind,
      startUrl: flow.startUrl,
      status: flow.status,
      failureReason: flow.failureReason,
      durationMs: flow.durationMs,

      steps: flow.steps.map(step => ({
        index: step.index,
        action: step.action,
        expectation: step.expectation,
        status: step.status,
        observation: step.observation,
        screenshotPath: step.screenshotPath
          ? path.relative(ROOT, step.screenshotPath)
          : null
      }))
    })),

    bugs: (run.bugs || []).map(sanitizeBug)
  };
}

function calculateObservedStats(run) {
  const steps = run.flows.flatMap(flow => flow.steps);

  const byStatus = {};

  for (const step of steps) {
    byStatus[step.status] =
      (byStatus[step.status] || 0) + 1;
  }

  const unverified = steps.filter(
    step => step.status !== 'passed'
  );

  return {
    stepsTotal: steps.length,
    byStatus,

    verified:
      byStatus.passed || 0,

    unverified:
      unverified.length,

    unverifiedSteps: unverified.map(step => ({
      status: step.status,
      action: step.action,
      observation: step.observation,
      screenshotPath: step.screenshotPath
    }))
  };
}

function sanitizeSiteMap(siteMap) {
  if (!siteMap) return null;

  return {
    startUrl: siteMap.startUrl,
    siteType: siteMap.siteType,
    productName: siteMap.productName,
    summary: siteMap.summary,

    pagesVisited: siteMap.pages?.length || 0,
    pendingUrls: siteMap.pendingUrls?.length || 0,
    failedUrls: siteMap.failedUrls?.length || 0,

    pages: (siteMap.pages || []).map(page => ({
      url: page.url,
      title: page.title,
      summary: page.summary,
      authGated: page.authGated,

      interactive: (page.interactive || []).map(item => ({
        role: item.role,
        name: item.name,
        href: item.href
      }))
    }))
  };
}

function sanitizePlan(plan) {
  if (!plan) return null;

  const actualPlan = plan.plan || plan;

  return {
    startUrl: actualPlan.startUrl,
    siteType: actualPlan.siteType,
    notes: actualPlan.notes,

    flows: (actualPlan.flows || []).map(flow => ({
      id: flow.id,
      name: flow.name,
      description: flow.description,
      kind: flow.kind,
      startUrl: flow.startUrl,
      expectation: flow.expectation,
      severityIfFails: flow.severityIfFails,
      steps: flow.steps
    }))
  };
}

async function analyzeWithLLM(data) {
  const system = `
Eres un Principal QA Engineer especializado en:

- testing exploratorio
- testing funcional
- UI/UX
- accesibilidad
- aplicaciones empresariales
- Playwright
- análisis de regresiones
- diseño de producto
- consistencia de interfaces
- flujos operacionales

Estás analizando evidencia real obtenida mediante MonkeyTest y Playwright.

Debes producir SIEMPRE un informe QA completo en Markdown.

Tu objetivo NO es simplemente enumerar bugs.
Debes evaluar de forma crítica la calidad general de la aplicación
basándote exclusivamente en la evidencia disponible.

============================================================
REGLAS DE EVIDENCIA
============================================================

1. No inventes bugs, pantallas, acciones ni comportamientos.

2. No conviertas automáticamente una interacción fallida del agente
   en un bug de producto.

3. Distingue estrictamente entre:

PRODUCT BUG
Fallo reproducible o evidencia suficientemente fuerte de comportamiento
incorrecto de la aplicación.

FUNCTIONAL FINDING
Comportamiento funcional sospechoso, inconsistente o parcialmente
incorrecto que merece revisión pero cuya evidencia todavía no permite
afirmar que sea un bug confirmado.

UX FINDING
Problema observable de usabilidad, claridad, feedback, navegación,
consistencia o interacción.

INCONSISTENCY
Comportamientos, nombres, controles, rutas, filtros o patrones que
parecen inconsistentes entre distintas partes de la aplicación.

AUTOMATION WARNING
El agente, locator o herramienta no consiguió completar una acción y
no existe evidencia suficiente para atribuirlo al producto.

COVERAGE GAP
Parte del sistema que no pudo ser comprobada completamente.

IMPROVEMENT OPPORTUNITY
Algo que funciona pero podría diseñarse o implementarse de forma más
clara, segura, eficiente, consistente o usable.

PASS
Comportamiento realmente verificado.

4. Nunca confundas:

"No se pudo comprobar"

con:

"Funciona correctamente".

5. Un flow marcado como passed por MonkeyTest NO significa que todos
   sus pasos hayan sido comprobados.

Debes revisar individualmente:

- status
- observation
- expectation
- screenshotPath
- consoleErrors
- networkFailures

6. Si MonkeyTest declara un flow como passed pero contiene pasos
   skipped, blocked, noop o acciones no ejecutadas, debes señalarlo
   explícitamente como una inconsistencia del resultado de automatización.

7. Si existe una contradicción entre estadísticas agregadas y evidencia
   detallada, confía en la evidencia detallada.

8. Todo hallazgo debe indicar qué evidencia lo respalda.

9. Si no existen bugs confirmados, escribe explícitamente:

"No se identificaron bugs confirmados en esta ejecución."

Pero continúa analizando:

- inconsistencias
- UX
- brechas
- oportunidades de mejora
- cobertura
- advertencias

10. No generes recomendaciones genéricas.

Cada recomendación debe estar vinculada a algo observado durante
la auditoría.

============================================================
ANÁLISIS FUNCIONAL
============================================================

Busca evidencia de:

- botones que no responden
- controles imposibles de utilizar
- enlaces rotos
- navegación incorrecta
- acciones que no producen resultado
- formularios incompletos
- filtros que no funcionan
- estados incorrectos
- acciones duplicadas
- errores de validación
- feedback insuficiente
- problemas en CRUD
- inconsistencias entre acciones equivalentes
- rutas que terminan en estados inesperados
- errores HTTP
- errores JavaScript
- errores de autorización
- comportamiento distinto entre módulos equivalentes

============================================================
ANÁLISIS UI/UX
============================================================

Busca evidencia de:

- falta de claridad
- acciones poco descubribles
- controles ambiguos
- jerarquía visual inconsistente
- nomenclatura inconsistente
- navegación confusa
- filtros difíciles de utilizar
- acciones importantes escondidas
- falta de feedback
- estados de carga deficientes
- estados vacíos deficientes
- errores difíciles de entender
- exceso de pasos
- affordances deficientes
- patrones distintos para tareas equivalentes
- inconsistencias entre módulos
- ausencia de confirmaciones
- oportunidades de simplificación

No inventes problemas visuales que no puedan inferirse de la evidencia.

============================================================
COBERTURA
============================================================

Debes analizar:

- páginas visitadas
- rutas descubiertas
- rutas pendientes
- rutas fallidas
- flows planificados
- flows ejecutados
- pasos totales
- pasos pasados
- pasos fallidos
- pasos skipped
- pasos blocked
- pasos no verificados

Calcula cuando sea posible:

Cobertura de rutas =
visitadas / (visitadas + pendientes + fallidas)

Cobertura efectiva de pasos =
pasos realmente verificados / pasos totales

No presentes 100% de cobertura si existen rutas pendientes,
fallidas o pasos no verificados.

============================================================
CONFIANZA
============================================================

Asigna una confianza global:

ALTA
La mayor parte del alcance fue comprobado y existe poca evidencia
ambigua.

MEDIA
Existe buena cobertura, pero quedan rutas, pasos o comportamientos
sin comprobar.

BAJA
Gran parte del sistema quedó fuera del alcance o hubo demasiados
problemas de automatización.

Explica siempre la razón.

============================================================
SEVERIDADES
============================================================

CRITICAL
Bloquea una función crítica, compromete datos o impide una operación
central.

HIGH
Problema importante que afecta un flujo relevante.

MEDIUM
Problema funcional o UX significativo con alternativa disponible.

LOW
Problema menor de consistencia, claridad o experiencia.

INFO
Oportunidad de mejora sin impacto funcional significativo.

============================================================
FORMATO OBLIGATORIO
============================================================

Genera exactamente estas secciones:

# Informe QA Automatizado — Plataforma Chome

## Resumen ejecutivo

Incluye:

- resultado general
- principales riesgos
- cobertura obtenida
- cantidad de bugs
- cantidad de hallazgos
- cantidad de gaps
- nivel de confianza

## Alcance de la auditoría

Describe:

- URL inicial
- modo de auditoría
- modelo utilizado
- páginas/rutas exploradas
- cantidad de flows
- limitaciones relevantes

## Métricas de cobertura

Incluye una tabla con:

| Métrica | Resultado |
|---|---:|

Debe incluir al menos:

- páginas visitadas
- rutas pendientes
- rutas fallidas
- flows ejecutados
- pasos totales
- pasos verificados
- pasos fallidos
- pasos no verificados
- bugs confirmados
- cobertura aproximada de rutas
- cobertura efectiva de pasos

## Evaluación de confianza

Indica:

ALTA / MEDIA / BAJA

y justifica.

## Bugs confirmados

Cada bug:

### BUG-XXX — Título

- Severidad:
- Tipo:
- Ruta:
- Flujo:
- Evidencia:
- Resultado esperado:
- Resultado observado:
- Reproducción:
- Impacto:
- Recomendación:

Si no existen, dilo explícitamente.

## Hallazgos funcionales

Utiliza:

### FUNC-XXX — Título

Incluye:

- Severidad
- Evidencia
- Interpretación
- Impacto
- Recomendación

## Inconsistencias detectadas

Utiliza:

### INC-XXX — Título

Busca especialmente diferencias entre:

- nombres
- filtros
- botones
- patrones
- comportamiento
- navegación
- feedback

## Hallazgos UI/UX

Utiliza:

### UX-XXX — Título

Incluye:

- Severidad
- Contexto
- Evidencia
- Problema
- Impacto UX
- Recomendación

## Advertencias de automatización

Utiliza:

### AUTO-XXX — Título

Incluye:

- Flujo
- Paso
- Acción
- Observación
- Posible causa
- Evidencia

No las presentes como bugs.

## Brechas de cobertura

Utiliza:

### GAP-XXX — Título

Explica exactamente qué no se pudo comprobar y por qué.

## Oportunidades de mejora

Utiliza:

### IMP-XXX — Título

Incluye oportunidades concretas relacionadas con:

- diseño
- navegación
- consistencia
- eficiencia operacional
- feedback
- prevención de errores
- mantenibilidad de UX
- observabilidad

No inventes mejoras sin evidencia.

## Flujos ejecutados

Crea una tabla:

| Flujo | Estado | Pasos OK | No verificados | Resultado |

Después añade detalle solamente de los flows relevantes.

## Errores de consola y red

Clasifica:

- JavaScript
- HTTP
- recursos
- APIs
- autorización

Si no existen, indícalo.

## Evidencias

Enumera screenshots y cualquier otra evidencia disponible.

Usa rutas relativas al repositorio.

## Recomendaciones priorizadas

### Prioridad alta

Acciones concretas.

### Prioridad media

Acciones concretas.

### Prioridad baja

Acciones concretas.

No repitas exactamente los hallazgos.
Convierte los hallazgos en acciones.

## Próximos tests recomendados

Indica qué debería comprobarse en la siguiente ejecución para mejorar
la cobertura o confirmar hallazgos ambiguos.

## Conclusión

Resume:

- estabilidad funcional
- calidad observable de UX
- riesgos principales
- cobertura conseguida
- nivel de confianza

No uses lenguaje exageradamente positivo.
No declares la aplicación "sin errores" simplemente porque MonkeyTest
no haya encontrado bugs confirmados.

Escribe todo el informe en español.
`;

  const response = await fetch(
    `${BASE_URL.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',

      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        model: MODEL,

        messages: [
          {
            role: 'system',
            content: system
          },
          {
            role: 'user',
            content:
              'Analiza la siguiente ejecución QA y genera el informe Markdown.\n\n' +
              JSON.stringify(data, null, 2)
          }
        ],

        temperature: 0.15
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Command Code respondió ${response.status}: ${body}`
    );
  }

  const json = await response.json();

  const content = json?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(
      'Command Code no devolvió contenido de análisis'
    );
  }

  return content;
}

const stored = await getLatestRun();

const sitemap = await readJson(
  path.join(MONKEY_DIR, 'sitemap.json')
);

const plan = await readJson(
  path.join(MONKEY_DIR, 'plan.json')
);

const auditMeta = await readJson(
  path.join(MONKEY_DIR, 'audit-meta.json')
);

const run = sanitizeRun(stored);

const observedStats = calculateObservedStats(run);

const input = {
  generatedAt: new Date().toISOString(),

  audit: auditMeta,

  engineReportedStats: run.stats,

  independentlyCalculatedStats: observedStats,

  siteMap: sanitizeSiteMap(sitemap),

  plan: sanitizePlan(plan),

  run
};

console.log('Analizando último run con:', MODEL);

const markdown = await analyzeWithLLM(input);

const safeTimestamp =
  new Date().toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, 'Z');

const auditMode =
  auditMeta?.mode === 'full'
    ? 'audit-full'
    : 'audit';

const datedFile = path.join(
  REPORT_DIR,
  `${safeTimestamp}-${auditMode}.md`
);

const latestFile = path.join(
  REPORT_DIR,
  'latest.md'
);

const header = `<!--
Generado automáticamente.
Run MonkeyTest: ${stored.id}
Modelo de análisis: ${MODEL}
Fecha: ${new Date().toISOString()}
-->

`;

const completeReport = header + markdown.trim() + '\n';

await fs.writeFile(
  datedFile,
  completeReport,
  'utf8'
);

await fs.writeFile(
  latestFile,
  completeReport,
  'utf8'
);

console.log('');
console.log('Informe QA generado:');
console.log(path.relative(ROOT, datedFile));
console.log('');
console.log('Último informe:');
console.log(path.relative(ROOT, latestFile));
