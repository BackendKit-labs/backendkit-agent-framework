# SPEC-0022: ciclo de vida de la lección

**Fecha:** 2026-11-16
**Estado:** Borrador. Decisiones D1-D5 con propuesta. Sustituye a F3 de [SPEC-0019](SPEC-0019-aprendizaje-segunda-iteracion.md) (su D5).
**Depende de:** SPEC-0019 F1 y F2 (señal y lecciones por tool, mergeados y sin publicar), `createLearning`, `SuccessCounters`, `QualifiedPatterns`.
**Tipo de cambio:** aditivo, salvo la caducidad por defecto (D1), que cambia lo que F1/F2 hacen hoy. Por eso conviene decidirlo antes de publicar esas fases.
**Objetivo:** que una lección que funciona no desaparezca por funcionar, y que una persona pueda ver y decidir cuándo una lección ya no hace falta.

## 1. El problema, medido

SPEC-0019 D5 propuso: "sin fallos en la ventana ⇒ la lección caduca". El banco `trading-bot` con reloj simulado lo desmintió (SPEC-0019 §8): el agente obedece la lección, deja de fallar, los fallos salen de la ventana, la lección caduca y el error vuelve. **19 rechazos en 245 sesiones; la lección ausente de 170 prompts** entre su primera y su última aparición.

"Sin fallos" no distingue "resuelto" de "resuelto gracias a esta lección". Hoy ambos casos borran la lección igual.

Además (§8): la histéresis hace que un patrón que entró con pocas llamadas se quede aunque los datos posteriores digan que casi siempre acierta, y la propuesta de regla no muestra la proporción fallos/llamadas para juzgarlo.

## 2. Decisiones

| # | Pregunta | Opciones | Propuesta |
|---|---|---|---|
| D1 | ¿Cuándo deja de mostrarse una lección aprendida? | (a) sin fallos en la ventana (SPEC-0019 D5); (b) mientras su sujeto se siga llamando; termina cuando el sujeto deja de llamarse o una persona la resuelve; (c) solo una persona | **(b).** El contador de éxitos ya sabe si el sujeto sigue en uso. Si el agente sigue llamando a `place_order`, la lección sigue siendo lo que lo mantiene a salvo |
| D2 | ¿Cuánto es "deja de llamarse"? | (a) un número fijo de días; (b) configurable con un valor por defecto | **(b)**: `quietAfterDays`, por defecto igual a la ventana (30). Un sujeto sin una sola llamada en ese tiempo no necesita lección |
| D3 | ¿Dónde se guarda lo que la lección necesita para vivir sin sus experiencias? | (a) conservar las experiencias más tiempo; (b) un registro de patrones activos con lo que la línea y la propuesta necesitan | **(b).** Las experiencias están acotadas y con ventana; guardar más para sostener una línea es el camino equivocado. Un `PatternRecord` pequeño: clave, tipo, sujeto, huella, texto de la línea, fallos y llamadas acumulados, `firstSeen`, `lastFailure`, `lastCall`, estado |
| D4 | ¿Cómo se resuelve a mano? | (a) `forget`; (b) `resolve(patternKey, by)` que conserva el registro y su motivo; (c) ambas | **(b)**, solo por una persona (`approverKinds`). `resolve` deja el registro como `resolved` (con quién y cuándo). Si el patrón reaparece después, la propuesta lo dice ("resuelto el 2030-03-04, ha vuelto") en vez de empezar de cero |
| D5 | ¿La propuesta de regla muestra la evidencia? | (a) no (como hoy); (b) fallos y llamadas, tasa, primera y última aparición | **(b).** Una persona que aprueba una regla debe ver "7 fallos en 31 llamadas, desde el 2030-02-01", no solo un nombre |

## 3. Estados

```
active ──(sujeto sin llamadas durante quietAfterDays)──▶ quiet     (sale del prompt; el registro se conserva)
active ──(resolve por una persona)─────────────────────▶ resolved  (sale del prompt)
quiet / resolved ──(vuelve a fallar con el umbral)─────▶ active    (y la propuesta lo indica)
```

- La lección enseñada por una persona no entra en este ciclo: solo `forget`, como hoy.
- Una lección `active` no cambia de texto: el prompt sigue siendo estable entre turnos (criterio de SPEC-0019 §4).

## 4. Fases

- **F1. `PatternRecord` y su almacén.** Se rellena al calificar un patrón y sobrevive a la salida de las experiencias de la ventana. No hay datos que migrar: los patrones de SPEC-0019 F1/F2 aún no están publicados.
- **F2. Caducidad por sujeto en uso (D1, D2).** Test de aceptación, extraído del banco: con la lección activa el error deja de ocurrir y la lección **sigue** en el prompt mientras el sujeto se llama; al dejar de llamarse `quietAfterDays`, sale.
- **F3. `resolve` y reaparición (D4).** Test: un agente no puede resolver su propia lección; un patrón resuelto que reaparece vuelve como propuesta con la nota.
- **F4. Evidencia en la propuesta (D5).** `Proposal` incluye `failures`, `calls`, `firstSeen`, `lastSeen` y el estado anterior si lo hubo.
- **F5. Regresión del banco.** El escenario de 245 sesiones pasa a ser un test: rechazos tras la primera lección ≈ 0 mientras `place_order` se sigue llamando.

## 5. Criterios de aceptación

- Con la lección activa y el sujeto en uso, el prompt la conserva indefinidamente.
- Un sujeto sin llamadas durante `quietAfterDays` deja de generar lección.
- Solo una persona resuelve; un patrón resuelto que vuelve se propone con la nota de la reaparición.
- La propuesta de regla muestra fallos, llamadas y fechas.

## 6. Fuera de alcance

- Medir si una lección "funciona" como causa. Con datos observacionales solo se puede decir qué pasó antes y después; el banco lo muestra, el framework no lo afirma. Un A/B real es una evaluación (SPEC-0021, `compare`).
- F2b de SPEC-0019 ("lo que funcionó": la primera llamada correcta tras un fallo).
- Aprendizaje entre tenants.
