# SPEC-0038: evaluar lo que el agente aprendió

**Fecha:** 2026-11-18
**Estado:** Borrador. Sin implementar. **Con criterio de entrada** (§3).
**Origen:** la identidad del framework como producto para agentes de empresa (2026-11-18). Una empresa no acepta "el agente aprende" si no puede ver si lo aprendido sirvió. El autoaprendizaje (SPEC-0017 F6, SPEC-0022) ya hace lo difícil: propone y una persona aprueba. Lo que no hace es **decir si lo aprobado funcionó**.
**Depende de:** `Learning` (`packages/core/src/learning`), [SPEC-0021](SPEC-0021-evaluaciones-de-agentes.md) (evals, en borrador), `agent-testkit`.
**Tipo de cambio:** aditivo, en `agent-core` (solo lectura sobre los almacenes existentes). Sin paquete nuevo.
**Objetivo:** que quien aprueba una lección o una regla vea, antes y después, qué habría cambiado y si cambió.

## 1. De dónde se parte

Verificado en `packages/core/src/learning` el 2026-11-18:

- Los fallos repetidos de una tool se vuelven un **patrón** (`PatternRecord`: clave, agente, tenant, gravedad, `count`, `state`), del que sale una **lección** en el prompt del agente y una **regla propuesta** que una persona aprueba (`approverKinds`: por defecto, una persona). Un agente no aprueba lo que aprendió ni cierra sus patrones (`resolve`).
- Una persona puede **enseñar** una lección (`teach`) y **retirarla** (`forget`).
- `records()` guarda por patrón su estado, su línea y sus fechas, y **si volvió a fallar después de resuelto**.
- Cada llamada a una tool deja un `AuditEvent` con tool, decisión, resultado (`outcome`), código de error, agente, tenant y quién aprobó. **No guarda los argumentos** (solo su hash).
- Falta: nada mide el efecto de una lección o de una regla. La persona aprueba a ciegas respecto de su efecto, y no hay modo de ver que una lección "no sirvió".

## 2. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Qué se evalúa? | Dos cosas distintas. **Una regla** (decide sobre una tool) se evalúa **contrafactualmente**: qué habría hecho sobre las llamadas ya registradas. **Una lección** (texto del prompt) solo se evalúa por **lo observado**: los fallos del patrón antes y después. No se finge medir una lección con un modelo de guion: un guion no cambia de comportamiento al cambiar el prompt. |
| D2 | ¿Quién decide? | **Siempre una persona.** La evaluación informa; no aprueba, no retira y no cierra nada. Mantiene el principio de SPEC-0017: lo que aprende un agente lo valida un humano. |
| D3 | ¿Dónde vive? | En `agent-core`, como funciones de lectura sobre los almacenes de `Learning`. Sin paquete nuevo y sin escribir en los almacenes. |
| D4 | ¿Qué datos hacen falta? | Solo los que ya existen (eventos de auditoría y registros de patrones), más **la fecha de aprobación** de cada regla y lección si hoy no se guarda (F0 lo comprueba). |
| D5 | ¿Cómo se evita una conclusión falsa con pocos datos? | Un **mínimo de muestra** configurable. Por debajo, el informe dice "sin datos suficientes", no un porcentaje. |

## 3. Criterio de entrada

No se empieza hasta que se cumpla algo de esto:

1. Alguien usa el autoaprendizaje con **tráfico real** suficiente para que "antes y después" tenga muestra (decenas de llamadas por patrón, no unidades).
2. O una persona que aprueba reglas pide ver su efecto antes de aprobar.

Sin tráfico, el informe saldría casi siempre "sin datos suficientes" y no justificaría el código.

## 4. Diseño

### 4a. Efecto observado (lecciones y reglas, F1)

Para un patrón o una regla aprobada, con la fecha de aprobación `T`:

- la **tasa de fallo** de ese patrón (o de las llamadas que la regla cubre) en una ventana antes de `T` y otra igual después, con el tamaño de cada muestra;
- el **estado**: `sin datos suficientes`, `mejoró`, `sin efecto`, `empeoró`, o `volvió` (ya lo guarda `records()`: falló de nuevo tras `resolve`).

Una caída puede deberse a otra cosa (un arreglo en la tool, menos tráfico). El informe lo dice: **correlación, no causa**.

### 4b. Efecto contrafactual de una regla propuesta (F2)

Antes de aprobar una regla, "qué habría pasado": sobre las llamadas ya registradas de esa tool, cuántas la regla **habría denegado**, y de ellas cuántas **habían salido bien** (falsos positivos) y cuántas habían fallado (aciertos).

**Límite de partida:** los eventos no guardan argumentos, así que solo se pueden evaluar reglas que decidan por **tool y efecto** (lo que una `ToolRule` exige hoy: nombrar la tool y un efecto). Una regla condicionada a los argumentos no se evalúa; el informe lo dice.

### 4c. Lecciones contra un conjunto de casos (F3, opcional)

Si hay un conjunto de evals (SPEC-0021), una lección se puede probar con un modelo **real** sobre los casos del agente, con y sin la lección. Es opt-in, cuesta dinero y mide un modelo concreto. No sustituye a 4a.

## 5. Fases

- **F0. Verificar.** Qué guarda hoy cada almacén (fecha de aprobación de una regla o lección, tenant, agente) y si `AuditEvent` basta para reconstruir "las llamadas que una regla cubre". Medir cuántos eventos hay en un uso real.
- **F1. Efecto observado** (4a): `learning.evaluate(...)` con el mínimo de muestra y los estados. Pruebas con eventos sembrados en el tiempo (antes y después), incluido el caso "sin datos suficientes".
- **F2. Efecto contrafactual de una regla** (4b), con el límite de los argumentos dicho en el informe.
- **F3. Lecciones con evals** (4c), cuando exista SPEC-0021.
- **F4. Documentación** en la web (autoaprendizaje) y el informe en el ejemplo de `EnterpriseLearning`.

## 6. Criterios de aceptación

- La evaluación **no escribe** en ningún almacén y no aprueba nada.
- Con menos datos que el mínimo, el informe dice "sin datos suficientes" y no un porcentaje.
- El informe dice que es correlación y no causa.
- Una regla que depende de los argumentos se declara no evaluable, no se evalúa mal.

## 7. Riesgos y fuera de alcance

- **Se puede dar una falsa confianza.** Un "mejoró" con poca muestra o con otra causa lleva a aprobar más. Por eso D5 y el aviso de correlación.
- **Fuera de alcance:** que el agente decida con la evaluación (D2); evaluar el modelo en general (es SPEC-0021); medir calidad de respuestas (no solo fallos de tools).
