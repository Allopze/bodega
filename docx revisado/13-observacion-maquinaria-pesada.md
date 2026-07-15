# Módulo 13: Observación de Seguridad - Maquinaria Pesada

> **Documento fuente:**
> `Anexo 5 Observacion de Seguridad Maquinaria Pesada PR-SGC-25.xls`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Observación
> conductual de operación de maquinaria pesada

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona las **observaciones de seguridad** realizadas a
operadores de **maquinaria pesada** (excavadoras, cargadores frontales,
retroexcavadoras, etc.). Sigue la misma estructura del módulo de camión
ampliroll pero con adaptaciones específicas para maquinaria pesada.
Incluye 22 ítems de evaluación en 3 fases.

------------------------------------------------------------------------

## 2. Estructura de Datos

> La estructura de datos es idéntica al Módulo 12 (Observación Camión
> Ampliroll), diferenciándose en: - `tipo_equipo` =
> `maquinaria_pesada` - `código_procedimiento` = `PR-SGC-25` - Los ítems
> del checklist tienen variaciones específicas para equipo rodante
> pesado.

------------------------------------------------------------------------

## 3. Checklist de Observación (22 ítems)

### 3.1 INSPECCIÓN AL INGRESO Y TÉRMINO DE TURNO

| N° | Acción Revisada | Cumple |
|----|----|----|
| 1 | Inspecciona su equipo al inicio del turno, de acuerdo a report uso diario de equipo (instructivo) | Si/No/N/A |
| 2 | Verifica que los peldaños estén limpios de grasas, aceites, lodos, hielo, etc., para evitar caídas | Si/No/N/A |
| 3 | Revisa los equipos adicionales (porta elementos, pala, lanza y garra, pasadores, cilindro y fisuras) | Si/No/N/A |
| 4 | Hace entrega del equipo móvil a su colega que ingresa al turno | Si/No/N/A |
| 5 | Revisa equipos de emergencia (extintor, cuñas, conos, alarma de retroceso, etc.) | Si/No/N/A |

### 3.2 EN EL DESPLAZAMIENTO POR PLANTA

| N° | Acción Revisada | Cumple |
|----|----|----|
| 6 | Antes de iniciar la marcha mira por los espejos | Si/No/N/A |
| 7 | Respeta velocidades establecidas | Si/No/N/A |
| 8 | Respeta señales de tránsito establecidas | Si/No/N/A |
| 9 | Mantiene distancia prudente al ir detrás de otro equipo rodante | Si/No/N/A |
| 10 | Usa cinturón de seguridad | Si/No/N/A |
| 11 | Como peatón transita por zonas demarcadas y autorizadas | Si/No/N/A |

### 3.3 EN LA OPERACIÓN

| N° | Acción Revisada | Cumple |
|----|----|----|
| 12 | Detiene la maniobra ante la presencia de una persona en el área de trabajo e informa por radio de la situación | Si/No/N/A |
| 13 | Toca la bocina al acercarse a un peatón o equipo móvil para advertir su presencia antes de realizar la maniobra | Si/No/N/A |
| 14 | Observa por los espejos antes de realizar cualquier maniobra | Si/No/N/A |
| 15 | Usa cinturón de seguridad | Si/No/N/A |
| 16 | Respeta no llevar acompañante | Si/No/N/A |
| 17 | Al bajar y subir del equipo rodante usa los tres puntos de apoyo | Si/No/N/A |
| 18 | Usa sus elementos de protección personal que entrega la empresa | Si/No/N/A |
| 19 | Al bajar del equipo rodante acciona el freno de mano, detiene el motor y retira las llaves; cuando corresponde corta la corriente según procedimiento de bloqueo | Si/No/N/A |
| 20 | Respeta el NO uso de equipos distractorios en las horas de trabajo (celulares, redes sociales) | Si/No/N/A |
| 21 | Respeta los procedimientos de trabajo que fue capacitado | Si/No/N/A |
| 22 | Se asegura que el pasador de la muela esté bien acoplado (la palanca queda en posición vertical; para asegurarse debe realizar un pequeño movimiento hacia adelante y atrás) | Si/No/N/A |

------------------------------------------------------------------------

## 4. Diferencias con Observación Camión Ampliroll

| Aspecto | Camión Ampliroll (PR-SGC-24) | Maquinaria Pesada (PR-SGC-25) |
|----|----|----|
| Ítem 2 | Peldaños limpios (grasas, aceites, lodos) | Peldaños limpios (grasas, aceites, lodos, **hielo**) |
| Ítem 3 | Hace entrega del camión | **Revisa equipos adicionales** (porta elementos, pala, lanza y garra) |
| Ítem 4 | Revisa equipo ampliroll (gancho, riel) | **Hace entrega del equipo** móvil |
| Ítem 9 | Equipo “móvil” | Equipo **“rodante”** |
| Ítem 17 | Bajar/subir del “camión” | Bajar/subir del “equipo **rodante**” |
| Ítem 18 | EPP (genérico) | EPP “**que entrega la empresa**” |
| Ítem 19 | Bajar del “camión” | Bajar del “equipo **rodante**” |

------------------------------------------------------------------------

## 5. Funcionalidades del Módulo SaaS

> Las funcionalidades son las mismas que el Módulo 12 (Observación
> Camión Ampliroll). La implementación recomendada es **un solo módulo
> de Observaciones de Seguridad** con plantillas configurables por tipo
> de equipo.

### 5.1 Diseño Unificado

- [ ] Un solo módulo con selector de tipo de equipo
- [ ] Plantillas de checklist configurables por tipo
- [ ] Ítems compartidos entre plantillas (evitar duplicación)
- [ ] Ítems específicos por tipo de equipo
- [ ] Nuevo tipo de equipo creado por el administrador

### 5.2 Características Específicas Maquinaria Pesada

- [ ] Verificación de aditamentos (pala, garra, lanza)
- [ ] Control de pasador de muela
- [ ] Verificación de procedimiento de bloqueo
- [ ] Registro de horómetro del equipo

------------------------------------------------------------------------

## 6. Reglas de Negocio

1.  **Frecuencia**: Mensual por cada operador del turno.
2.  **Responsable**: Jefe de Terreno (JT); si no existe, Administrador
    de Contrato.
3.  **Triple firma + huella**: Observador, operador observado,
    prevención + huella digital.
4.  **Reinstrucción**: Si hay ítems no cumplidos, se reinstruye y
    registra.
5.  **Porcentaje**: (Total Buenas / 22) × 100.
6.  **1° Copia**: Enviar a Administrador de Contrato si necesita
    gestión.

------------------------------------------------------------------------

## 7. Integraciones

| Módulo | Relación |
|----|----|
| Módulo 12 (Camión Ampliroll) | Comparten la misma lógica de observación |
| Cronograma SG-SST | Alimenta avance de observaciones de seguridad |
| Seguimiento y Control | Ítems no cumplidos al seguimiento |
| Capacitaciones | Reinstrucción genera registro |
| Equipos Móviles | Complementa inspección técnica |

------------------------------------------------------------------------

## 8. Recomendación de Implementación

> ⚠️ **Los módulos 12 y 13 deberían implementarse como un solo módulo
> “Observaciones de Seguridad”** con plantillas configurables, ya que
> comparten el 95% de la estructura. Las diferencias son solo
> terminológicas y en el orden de algunos ítems.

    Módulo Unificado: Observaciones de Seguridad
    ├── Plantilla: Camión Ampliroll (PR-SGC-24)
    │   └── 22 ítems con terminología de camión
    ├── Plantilla: Maquinaria Pesada (PR-SGC-25)
    │   └── 22 ítems con terminología de maquinaria
    └── Plantilla: [Personalizable]
        └── N ítems definidos por el usuario
