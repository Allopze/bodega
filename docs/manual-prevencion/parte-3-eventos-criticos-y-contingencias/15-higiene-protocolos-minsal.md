# Capítulo 15: Higiene Ocupacional, GES y Protocolos MINSAL

> **Marco Normativo:** Decreto Supremo 594 (Límites Permisibles Ponderados LPP) y Protocolos de Vigilancia Epidemiológica del Ministerio de Salud (MINSAL).  
> **Rutas en Plataforma:**  
> *   Vigilancia e Higiene: `/prevencion/higiene`  
> *   Grupos de Exposición Similar: `/prevencion/higiene/grupos`  
> *   Programas de Vigilancia: `/prevencion/higiene/programas`  
> **Actividades PDTP Asociadas:** N° 45, 46, 47, 48, 49 y 50.

---

## 1. El Control de la Salud Ocupacional en Faena

Mientras la seguridad industrial previene los accidentes repentinos (caídas, choques, golpes), la **Higiene Ocupacional** previene la aparición de **enfermedades profesionales** causadas por la exposición prolongada y silenciosa a agentes físicos, químicos, ergonómicos o psicosociales.

El módulo de Higiene centraliza la gestión de los **6 Protocolos Obligatorios del MINSAL**:

| Protocolo MINSAL | Agente de Riesgo | Puestos Típicos Expuestos en CHOME | Actividad PDTP |
|---|---|---|---|
| **PREXOR** | Ruido ocupacional | Mecánicos de taller, operadores de grúa horquilla, pañoleros cerca de máquinas. | N° 46 |
| **PLANESI** | Sílice libre cristalizada (polvo de roca/cemento) | Operadores en faenas de áridos, caminos de tierra sin estabilizar, barrido seco. | N° 47 |
| **TMERT** | Trastornos musculoesqueléticos en extremidades superiores | Tareas de amarre de carga repetitivo, digitación intensa, manejo de herramientas vibratorias. | N° 48 |
| **Radiación UV Solar** | Exposición a rayos ultravioleta de origen solar | Conductores de patio, personal de terreno abierto, señaleros. | N° 49 |
| **CEAL-SM / SUSESO** | Riesgos psicosociales en el trabajo | Toda la dotación de la faena (evaluación mediante encuesta estandarizada). | N° 49 |
| **MMC (Ley 20.949)** | Manejo manual de cargas (límite 25 kg hombres / 20 kg mujeres) | Estibadores, cargadores, mecánicos manipulando repuestos pesados. | N° 51 |

---

## 2. Grupos de Exposición Similar (GES)

No es práctico medir individualmente a 50 conductores que realizan la misma ruta en el mismo camión. Por eso la normativa utiliza el concepto de **Grupo de Exposición Similar (GES)**: *un conjunto de trabajadores que realizan labores equivalentes y están expuestos a niveles similares de peligro*.

### Cómo Consultar y Administrar los GES de tu Faena:
1. Entra a `/prevencion/higiene/grupos`.
2. Filtra por tu faena.
3. Verás la lista de grupos definidos (ej. *GES Conducción de Carretera Masisa*, *GES Mantenimiento en Taller Santa Fe*).
4. Revisa la dotación asignada a cada GES para asegurar que todos los trabajadores nuevos de esos cargos queden incorporados al programa de vigilancia correspondiente.

---

## 3. Pronunciamiento sobre Protocolos MINSAL (Actividades N° 46 a 49)

La autoridad sanitaria (SEREMI de Salud) y el PDTP exigen que la empresa emita un **pronunciamiento técnico formal** sobre si cada protocolo aplica o no a las actividades de la faena:

```
[Ir a /prevencion/higiene]
            │
            ▼
[Seleccionar Protocolo MINSAL (ej. PREXOR o PLANESI)]
            │
            ▼
1. Marcar: ¿Aplica en la Faena? (SÍ / NO)
2. Si APLICA: Adjuntar Estudio Cuantitativo de la Mutual
3. Si NO APLICA: Adjuntar Justificación Técnica Escrita
            │
            ▼
[Guardar Pronunciamiento y Acreditar en el PDTP]
```

*   **Si el Protocolo Aplica:** Debes subir el informe de evaluación cualitativa o cuantitativa entregado por los higienistas de la Mutual (Mutual de Seguridad, ACHS o IST), indicando si los niveles están sobre o bajo el Límite Permisible Ponderado (LPP).
*   **Si el Protocolo No Aplica:** Debes adjuntar la minuta técnica que fundamente por qué la faena está exenta (ej. *En Faena Masisa no existe manipulación de cuarzo ni polvo de hormigón, por lo que PLANESI no aplica*).
*   **Impacto en el PDTP:** Al guardar el pronunciamiento respaldado con documento, se acredita la actividad correspondiente (N° 46 para PREXOR, N° 47 para PLANESI, N° 48 para TMERT y N° 49 para Radiación UV/Psicosocial).

---

## 4. Vigilancia Médica de la Salud y Exámenes Ocupacionales (Actividad PDTP N° 50)

Para los trabajadores expuestos a agentes con nivel de acción superado (por ejemplo, ruido sobre 82 dB(A) o sílice):

1. **Coordinación de Batería de Exámenes con la Mutual:**
   * Audiometrías periódicas de tamizaje (PREXOR).
   * Radiografías de tórax con técnica OIT (PLANESI).
   * Exámenes de aptitud para conducción profesional y altura física.
2. **Registro de Cobertura en Plataforma:**
   * En `/prevencion/higiene/programas`, registra la nómina de trabajadores que completaron su evaluación médica.
   * Selecciona su aptitud laboral informada por el médico de la Mutual (*Apto*, *Apto con restricciones* o *No apto*).
3. **Cierre de la Meta:** Alcanzar la cobertura programada de exámenes acredita la actividad **N° 50** del PDTP.

> [!WARNING]
> **Confidencialidad Médica Absoluta (Ley 21.719):**  
> El Prevencionista de Faena **solo tiene acceso al Certificado de Aptitud Laboral** emitido por el organismo administrador. Bajo ninguna circunstancia se deben subir ni compartir en la plataforma audiogramas detallados, fichas clínicas privadas ni diagnósticos de patologías personales de los trabajadores.
