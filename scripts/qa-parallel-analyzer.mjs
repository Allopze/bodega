function chunk(items, size) {
  const out = [];

  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }

  return out;
}

function stripFence(text) {
  return String(text || '')
    .replace(/^```(?:json|markdown)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function makeBar(current, total, width = 22) {
  if (!total) return '[sin tareas]';

  const ratio =
    Math.max(
      0,
      Math.min(1, current / total)
    );

  const filled =
    Math.round(ratio * width);

  return (
    '[' +
    '█'.repeat(filled) +
    '░'.repeat(width - filled) +
    ']'
  );
}

async function requestLLM({
  apiBase,
  apiKey,
  model,
  messages,
  temperature = 0.1
}) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(
        `${apiBase.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',

          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },

          body: JSON.stringify({
            model,
            temperature,
            messages
          }),

          signal:
            AbortSignal.timeout(180_000)
        }
      );

      if (!response.ok) {
        const body =
          await response.text();

        throw new Error(
          `LLM ${response.status}: ${body.slice(0, 800)}`
        );
      }

      const json =
        await response.json();

      const content =
        json?.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error(
          'El worker LLM no devolvió contenido.'
        );
      }

      return content;

    } catch (error) {
      lastError = error;

      if (attempt < 3) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              1000 * attempt
            )
        );
      }
    }
  }

  throw lastError;
}

async function mapLimit(
  items,
  limit,
  fn
) {
  const results =
    new Array(items.length);

  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;

      if (index >= items.length) {
        return;
      }

      results[index] =
        await fn(
          items[index],
          index
        );
    }
  }

  const workerCount =
    Math.min(
      Math.max(1, limit),
      Math.max(1, items.length)
    );

  await Promise.all(
    Array.from(
      { length: workerCount },
      () => runner()
    )
  );

  return results;
}

function buildTasks(
  payload,
  batchSize
) {
  const pages =
    payload.pagesSample || [];

  const flows =
    payload.flows || [];

  const pageBatches =
    chunk(
      pages,
      batchSize
    );

  if (pageBatches.length === 0) {
    pageBatches.push([]);
  }

  const flowBatchSize =
    Math.max(
      1,
      Math.ceil(
        flows.length /
        pageBatches.length
      )
    );

  const flowBatches =
    chunk(
      flows,
      flowBatchSize
    );

  return pageBatches.map(
    (pagesBatch, index) => ({
      id: index + 1,

      pages:
        pagesBatch,

      flows:
        flowBatches[index] || []
    })
  );
}

const WORKER_SYSTEM = `
Eres un subagente QA especializado de Plataforma Chome.

Tu trabajo forma parte de una auditoría distribuida.
Recibes solamente una parte de las rutas y flows.

Analiza exclusivamente la evidencia recibida.

NO inventes:
- bugs
- pantallas
- controles
- comportamientos
- causas

Distingue estrictamente:

PRODUCT BUG
Fallo confirmado por evidencia.

FUNCTIONAL FINDING
Comportamiento sospechoso o parcialmente incorrecto.

UX FINDING
Problema observable de usabilidad, feedback,
navegación, claridad o interacción.

INCONSISTENCY
Patrones, nombres, controles o comportamientos
diferentes para conceptos equivalentes.

AUTOMATION WARNING
El agente o locator no pudo completar una acción.
NO es automáticamente un bug del producto.

COVERAGE GAP
Algo no quedó realmente comprobado.

IMPROVEMENT OPPORTUNITY
Mejora concreta respaldada por evidencia.

Un flow marcado "passed" puede contener pasos
skipped, blocked o no verificados.

"no se pudo comprobar"
NO significa
"funciona correctamente".

Busca especialmente:

- fallos funcionales
- filtros problemáticos
- navegación
- inconsistencias entre módulos
- errores en formularios
- falta de feedback
- errores de consola
- errores HTTP
- errores de APIs
- UX confusa
- acciones difíciles de descubrir
- patrones inconsistentes
- brechas de cobertura

Devuelve ÚNICAMENTE JSON válido:

{
  "summary": "...",
  "confidence": "ALTA|MEDIA|BAJA",

  "bugs": [],

  "functionalFindings": [],

  "uxFindings": [],

  "inconsistencies": [],

  "automationWarnings": [],

  "coverageGaps": [],

  "improvements": [],

  "importantJourneys": []
}

Cada hallazgo debe incluir cuando exista evidencia:

{
  "title": "...",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
  "route": "...",
  "flow": "...",
  "evidence": "...",
  "impact": "...",
  "recommendation": "..."
}

No uses Markdown.
`;

const CONSOLIDATOR_SYSTEM = `
Eres el Principal QA Engineer de Plataforma Chome.

Varios subagentes DeepSeek analizaron distintas partes
de una auditoría web.

Tu tarea es consolidar sus resultados en UN informe QA
completo y profesional.

REGLAS:

1. Elimina hallazgos duplicados.

2. Si dos subagentes reportan el mismo problema,
   conserva la evidencia más concreta.

3. No inventes bugs.

4. AUTOMATION WARNING no equivale a PRODUCT BUG.

5. Un flow "passed" no implica que todos sus pasos
   hayan sido realmente verificados.

6. Usa routeCoverage y stepCoverage como fuente
   principal para métricas.

7. Si pending=0 puedes afirmar:

   "Se procesaron todas las rutas descubiertas."

   NO puedes afirmar:

   "Se auditó el 100% de la aplicación."

8. Diferencia:

   cobertura estructural
   versus
   cobertura funcional.

9. Si MonkeyTest reporta 0 bugs pero existen pasos
   skipped/blocked/no verificados, indícalo.

10. No escondas limitaciones de automatización.

11. No generes recomendaciones genéricas.

12. Todo hallazgo importante debe estar respaldado
    por evidencia.

Genera Markdown en español.

Debe contener EXACTAMENTE estas secciones:

# Informe QA Automatizado - Plataforma Chome

## Resumen ejecutivo

## Alcance de la auditoría

## Métricas de cobertura

Incluye una tabla:

| Métrica | Resultado |
|---|---:|

Incluye:

- rutas descubiertas
- rutas visitadas
- rutas pendientes
- rutas fallidas
- cobertura estructural
- cola de crawl agotada
- flows ejecutados
- pasos totales
- pasos passed
- pasos failed
- pasos skipped
- pasos blocked
- pasos no verificados
- cobertura funcional efectiva
- bugs confirmados

## Evaluación de confianza

ALTA / MEDIA / BAJA

Explica por qué.

## Bugs confirmados

Formato:

### BUG-XXX - Título

- Severidad
- Ruta
- Flujo
- Esperado
- Observado
- Evidencia
- Impacto
- Recomendación

Si no existen:

"No se identificaron bugs confirmados en esta ejecución."

## Hallazgos funcionales

Formato FUNC-XXX.

## Inconsistencias detectadas

Formato INC-XXX.

## Hallazgos UI/UX

Formato UX-XXX.

## Advertencias de automatización

Formato AUTO-XXX.

## Brechas de cobertura

Formato GAP-XXX.

## Oportunidades de mejora

Formato IMP-XXX.

## Flujos ejecutados

Incluye tabla:

| Flujo | Estado | Pasos OK | No verificados | Resultado |

## Errores de consola y red

Clasifica:
- JavaScript
- HTTP
- APIs
- recursos
- autorización

## Evidencias

Usa rutas relativas al repositorio cuando existan.

## Recomendaciones priorizadas

### Prioridad alta

### Prioridad media

### Prioridad baja

## Próximos tests recomendados

## Conclusión

No envuelvas el Markdown en triple backtick.
`;

export async function analyzeParallel({
  payload,
  apiKey,
  apiBase,
  model,
  concurrency = 8,
  batchSize = 30
}) {
  const tasks =
    buildTasks(
      payload,
      Math.max(1, batchSize)
    );

  console.log('');
  console.log(
    `Subagentes QA: ${tasks.length} lotes`
  );

  console.log(
    `Concurrencia: ${concurrency}`
  );

  console.log(
    `Tamaño de lote: ${batchSize} páginas`
  );

  let completed = 0;

  const workerResults =
    await mapLimit(
      tasks,
      concurrency,

      async task => {
        const content =
          await requestLLM({
            apiBase,
            apiKey,
            model,

            temperature: 0.05,

            messages: [
              {
                role: 'system',
                content: WORKER_SYSTEM
              },

              {
                role: 'user',

                content:
                  JSON.stringify(
                    {
                      batch:
                        task.id,

                      audit:
                        payload.audit,

                      pages:
                        task.pages,

                      flows:
                        task.flows
                    },
                    null,
                    2
                  )
              }
            ]
          });

        let parsed;

        try {
          parsed =
            JSON.parse(
              stripFence(content)
            );

        } catch {
          parsed = {
            summary:
              stripFence(content),

            confidence:
              'BAJA',

            bugs: [],

            functionalFindings: [],

            uxFindings: [],

            inconsistencies: [],

            automationWarnings: [],

            coverageGaps: [
              {
                title:
                  `Worker ${task.id} devolvió respuesta no estructurada`,

                severity:
                  'INFO',

                evidence:
                  stripFence(content)
                    .slice(0, 1200)
              }
            ],

            improvements: [],

            importantJourneys: []
          };
        }

        completed++;

        if (process.stdout.isTTY) {
          process.stdout.write(
            '\r' +
            'Agentes LLM ' +
            makeBar(
              completed,
              tasks.length
            ) +
            ` ${completed}/${tasks.length}`
          );
        } else {
          console.log(
            `Worker ${completed}/${tasks.length} terminado`
          );
        }

        return {
          batch:
            task.id,

          pageCount:
            task.pages.length,

          flowCount:
            task.flows.length,

          result:
            parsed
        };
      }
    );

  if (process.stdout.isTTY) {
    process.stdout.write('\n');
  }

  console.log(
    'Consolidando resultados de subagentes...'
  );

  const consolidationInput = {
    audit:
      payload.audit,

    routeCoverage:
      payload.routeCoverage,

    stepCoverage:
      payload.stepCoverage,

    engineStats:
      payload.engineStats,

    confirmedMonkeyTestBugs:
      payload.bugs,

    failedUrls:
      payload.failedUrls,

    pendingUrlsSample:
      (payload.pendingUrls || [])
        .slice(0, 100),

    workers:
      workerResults
  };

  const markdown =
    await requestLLM({
      apiBase,
      apiKey,
      model,

      temperature: 0.1,

      messages: [
        {
          role: 'system',
          content:
            CONSOLIDATOR_SYSTEM
        },

        {
          role: 'user',
          content:
            JSON.stringify(
              consolidationInput,
              null,
              2
            )
        }
      ]
    });

  return {
    markdown:
      stripFence(markdown),

    workerCount:
      tasks.length,

    concurrency,
    batchSize,

    workers:
      workerResults
  };
}
