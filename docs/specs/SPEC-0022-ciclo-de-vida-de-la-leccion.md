# SPEC-0022: ciclo de vida de la lección

**Fecha:** 2026-11-16
**Estado:** Implementado y publicado (F1 a F4 en v0.44.0). F5 medida en el banco `trading-bot` con el modelo simulado; decisiones D1-D5 aceptadas el 2026-11-16. *(Revisado el 2026-11-18; antes decía: Decisiones D1-D5 aceptadas el 2026-11-16 con las propuestas. F1-F4 implementadas (sin publicar). F5 medida en el banco `trading-bot` con el modelo simulado (sus dos sondas son ahora aserciones): 3 rechazos del error que la lección evita antes de que entrara en el prompt y 0 en las 230 sesiones posteriores, frente a 19 en 245 sesiones sin este cambio. Sustituye a F3 de [SPEC-0019](SPEC-0019-aprendizaje-segunda-iteracion.md) (su D5).)*
**Depende de:** SPEC-0019 F1 y F2 (señal y lecciones por tool, mergeados y sin publicar), `createLearning`, `SuccessCounters`, `QualifiedPatterns`.
**Tipo de cambio:** aditivo, salvo la caducidad por defecto (D1), que **cambia el comportamiento de 0.42.0, ya publicado** (la histéresis de #193 iba en esa versión).
**Objetivo:** que una lección que funciona no desaparezca por funcionar, y que una persona pueda ver y decidir cuándo una lección ya no hace falta.

## 1. El problema, medido

SPEC-0019 D5 propuso: "sin fallos en la ventana ⇒ la lección caduca". El banco `trading-bot` con reloj simulado lo desmintió (SPEC-0019 §8): el agente obedece la lección, deja de fallar, los fallos salen de la ventana, la lección caduca y el error vuelve. **19 rechazos en 245 sesiones; la lección ausente de 170 prompts** entre su primera y su última aparición.

"Sin fallos" no distingue "resuelto" de "resuelto gracias a esta lección". Hoy ambos casos borran la lección igual.

Además (§8): la histéresis hace que un patrón que entró con pocas llamadas se quede aunque los datos posteriores digan que casi siempre acierta.

**Verificado en el código (2026-11-16):**

- `QualifiedPatterns` ya guarda por clave el último día en que el patrón estuvo "dentro" (`confirm`/`has`/`drop`/`prune`) y vive en el almacén de contadores. Es el germen de `PatternRecord`, no hay que empezar de cero.
- El texto de la línea de una lección está en `lessonLines`, un `Map` **en memoria** (`learning/index.ts`). Tras un reinicio se reescribe desde las experiencias de la ventana, así que **el texto puede cambiar entre ejecuciones del proceso** y, si las experiencias ya salieron de la ventana, la línea desaparece. SPEC-0019 prometía un prompt estable; solo lo es dentro de un proceso.
- La propuesta de regla ya lleva `evidence` (`"<n> x <kind> on <subject>, <primera> to <última>"`), pero **sin el número de llamadas ni la tasa**.
- Los contadores de éxito se conservan `2 x window` días (`counters.flush(dayBefore(windowDays * 2))`): saber si un sujeto "sigue en uso" es posible dentro de ese margen.

## 2. Decisiones

| # | Pregunta | Opciones | Propuesta |
|---|---|---|---|
| D1 | ¿Cuándo deja de mostrarse una lección aprendida? | (a) sin fallos en la ventana (SPEC-0019 D5); (b) mientras su sujeto se siga llamando; termina cuando el sujeto deja de llamarse o una persona la resuelve; (c) solo una persona | **(b).** El contador de éxitos ya sabe si el sujeto sigue en uso. Si el agente sigue llamando a `place_order`, la lección sigue siendo lo que lo mantiene a salvo |
| D2 | ¿Cuánto es "deja de llamarse"? | (a) un número fijo de días; (b) configurable con un valor por defecto | **(b)**: `quietAfterDays`, por defecto igual a la ventana (30). Un sujeto sin una sola llamada en ese tiempo no necesita lección |
| D3 | ¿Dónde se guarda lo que la lección necesita para vivir sin sus experiencias? | (a) conservar las experiencias más tiempo; (b) ampliar `QualifiedPatterns` a un registro de patrones con lo que la línea y la propuesta necesitan | **(b).** Las experiencias están acotadas y con ventana; guardar más para sostener una línea es el camino equivocado. De paso arregla que el texto de la línea viva solo en memoria. Un `PatternRecord` pequeño: clave, tipo, sujeto, huella, texto de la línea, fallos y llamadas acumulados, `firstSeen`, `lastFailure`, `lastCall`, estado |
| D4 | ¿Cómo se resuelve a mano? | (a) `forget`; (b) `resolve(patternKey, by)` que conserva el registro y su motivo; (c) ambas | **(b)**, solo por una persona (`approverKinds`). `resolve` deja el registro como `resolved` (con quién y cuándo). Si el patrón reaparece después, la propuesta lo dice ("resuelto el 2030-03-04, ha vuelto") en vez de empezar de cero |
| D5 | ¿Qué evidencia lleva la propuesta de regla? | (a) la de hoy (`n x tipo en sujeto, primera a última`); (b) además llamadas y tasa | **(b).** Una persona que aprueba una regla debe ver "7 fallos en 31 llamadas (23 %), del 2030-02-01 al 2030-03-04". Hoy falta el denominador |

## 3. Estados

```
active ──(sujeto sin llamadas durante quietAfterDays)──▶ quiet     (sale del prompt; el registro se conserva)
active ──(resolve por una persona)─────────────────────▶ resolved  (sale del prompt)
quiet / resolved ──(vuelve a fallar con el umbral)─────▶ active    (y la propuesta lo indica)
```

- La lección enseñada por una persona no entra en este ciclo: solo `forget`, como hoy.
- Una lección `active` no cambia de texto: el prompt sigue siendo estable entre turnos (criterio de SPEC-0019 §4).

## 3b. Estado de la implementación (2026-11-16)

| Punto | Spec | Hecho | Por qué |
|---|---|---|---|
| Estado `quiet` | estado propio | **derivado**: no se guarda; un registro `active` sin llamadas ni fallos durante `quietAfterDays` no entra en el prompt | Se recupera solo si el sujeto vuelve a llamarse o a fallar; no hace falta un cambio de estado escrito |
| Reactivar | "vuelve a fallar con el umbral" | fallos **posteriores** a `resolvedAt` en número de `threshold`, y pasar la tasa otra vez | Los fallos que ya estaban en la ventana al resolver no deben reactivarlo |
| Pista del autor de la tool | no se guarda (viene del código) | **se guarda también** | Un test existente fija que una línea ya en el prompt no se reescribe al registrar una pista después. Coste: una pista mejorada llega solo a los patrones nuevos |
| Orden con los topes | no previsto | los patrones que fallan **ahora** van antes que los que se quedan por uso | Un lección persistente no debe ocupar el sitio de un problema nuevo |
| Migración | "no hay datos que migrar" | **sí los había**: 0.42.0 ya estaba publicado y guarda `qualified`; se siguen leyendo | Falso en el borrador |
| Retención de contadores | no previsto | `2 x max(ventana, quietAfterDays)` días | "En uso" necesita las llamadas de ese periodo |
| F5, el dato | "rechazos ≈ 0" | 0 rechazos de `RISK_MAX_POSITION` tras la primera lección (230 sesiones, 36 con orden); 5 rechazos de otro código (`RISK_MAX_OPEN`), de lo que la lección no trata | El modelo es un guion que lee el prompt: comprueba la plomería, no a un LLM real |
| Criterio de SPEC-0019 §4 "la lección de una tool arreglada desaparece sola" | — | **ya no es cierto** si la tool se sigue llamando | Es el coste de D1: sin la lección el error vuelve. Una persona la resuelve |
| Test cambiado a propósito | `bench-fixes`: "it leaves when its failures leave the window" | ahora comprueba lo contrario | Codificaba el defecto que D1 corrige |

## 4. Fases

- **F1. `PatternRecord` sobre `QualifiedPatterns`.** Se rellena al calificar un patrón, guarda el texto de la línea (estable entre reinicios) y sobrevive a la salida de las experiencias de la ventana. Test: reiniciar el proceso no cambia el prompt. No hay datos que migrar: los patrones de SPEC-0019 F1/F2 aún no están publicados.
- **F2. Caducidad por sujeto en uso (D1, D2).** Test de aceptación, extraído del banco: con la lección activa el error deja de ocurrir y la lección **sigue** en el prompt mientras el sujeto se llama; al dejar de llamarse `quietAfterDays`, sale.
- **F3. `resolve` y reaparición (D4).** Test: un agente no puede resolver su propia lección; un patrón resuelto que reaparece vuelve como propuesta con la nota.
- **F4. Evidencia en la propuesta (D5).** El texto `evidence` de la petición `rule_proposal` incluye llamadas y tasa, y el estado anterior si lo hubo.
- **F5. Regresión del banco.** El escenario de 245 sesiones pasa a ser un test: rechazos tras la primera lección ≈ 0 mientras `place_order` se sigue llamando.

## 5. Criterios de aceptación

- Con la lección activa y el sujeto en uso, el prompt la conserva indefinidamente.
- Un sujeto sin llamadas durante `quietAfterDays` deja de generar lección.
- Solo una persona resuelve; un patrón resuelto que vuelve se propone con la nota de la reaparición.
- La propuesta de regla muestra fallos, llamadas, tasa y fechas.
- El texto de una lección activa no cambia tras reiniciar el proceso.

## 6. Fuera de alcance

- Medir si una lección "funciona" como causa. Con datos observacionales solo se puede decir qué pasó antes y después; el banco lo muestra, el framework no lo afirma. Un A/B real es una evaluación (SPEC-0021, `compare`).
- F2b de SPEC-0019 ("lo que funcionó": la primera llamada correcta tras un fallo).
- Aprendizaje entre tenants.
