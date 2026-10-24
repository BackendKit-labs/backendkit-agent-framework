# ADR-0007: Un límite declarado debe aplicarse

**Fecha:** 2026-10-24
**Estado:** Aceptado
**Implementado en:** SPEC-0009 §C3 (hermes: `maxConcurrent`, presupuesto del blueprint opcional, avisos); el presupuesto aplicado queda pendiente (§C3b). Sin publicar.
**Spec:** [SPEC-0009 §C3](../specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md)

## Contexto
Hermes (`@backendkit-labs/hermes`) acepta límites en `fleet.yaml` y en los blueprints. Lo verificado en el código (2026-10-24):

| Límite | Dónde | Estado |
|---|---|---|
| `limits.ttlMinutes` | blueprint | **Aplicado:** fija `expiresAt` y retira la instancia (`Provisioning.ts:222-233`). |
| `maxLive` | política de aprovisionamiento | **Aplicado:** se comprueba antes de crear. |
| `limits.maxConcurrent` | entrada del fleet (`schema.ts:67`) | **No aplicado** al escribir esto: el propio schema decía "concurrency and budget are not enforced yet". **Aplicado desde 2026-10-24** (Decisión 2). |
| `limits.budgetUsdPerDay` | entrada del fleet (`schema.ts:68`) | **No aplicado.** |
| `limits.budgetUsdPerDay` | blueprint (`provisioning.ts:23`) | **Obligatorio y no aplicado:** si el creador tiene techo, el blueprint debe declararlo y no superarlo (`provisioning.ts:88-91`), pero nada lo vigila como gasto. |

El último caso es el más dañino. Obliga al operador a escribir una cifra que no controla nada, y esa cifra parece una garantía en el `fleet.yaml` y en el registro de auditoría. Es peor que dejar el campo opcional.

El core ya tiene la mitad de la solución para el presupuesto: `CostTracker` calcula el costo por ejecución y por día, y `abortOnBudget` detiene el motor ([ADR-0002](0002-aborto-automatico-por-presupuesto.md)). Lo que falta es conectar el límite declarado por un agente de la flota con ese mecanismo, y hoy el presupuesto es por engine, no por agente de la flota.

## Decisión
**Un campo de límite no entra en un schema público si no tiene enforcement o un aviso explícito de que no lo tiene.** Se aplica a Hermes y al core.

1. **Regla de revisión:** un PR que añade un campo de límite a un schema declara en su descripción quién lo aplica y con qué test. Si no lo aplica, el campo se rechaza, o se acepta con un aviso visible y un criterio de retirada.
2. **`maxConcurrent`: aplicado (2026-10-24).** Un semáforo por agente dentro de `Hermes.run`. Decisiones de implementación:
   - **Se rechaza, no se encola:** pasado el límite, una llamada nueva falla al instante con `AGENT_BUSY` y quien llama decide si reintenta. Una cola ocultaría la carga y dejaría llamadores esperando a un agente que no da abasto. (El spec decía "esperan hasta `deadlineMs` o fallan"; `deadlineMs` acota la espera del *resultado*, no la admisión.)
   - **Cuenta runs de capabilities, no flows:** los flows son procesos de negocio largos y contarlos los dejaría sin hueco.
   - **Se comprueba antes de pedir aprobación y se reclama después:** no se pide a una persona aprobar algo que no puede arrancar, y no se retiene el hueco mientras decide (puede tardar minutos); al volver se comprueba otra vez.
   - **Comprobar y reclamar es un solo paso síncrono**, por lo que llamadas simultáneas no pueden pasar todas.
   - **Un run recuperado tras un reinicio ocupa hueco** hasta que termina, sin comprobar el límite (ya estaba en marcha).
   - **El hueco se libera antes de escribir el estado final**, no después: el store muestra el estado nuevo en cuanto empieza la actualización, y su escritura a disco tarda más; liberar después dejaba una ventana en la que quien acababa de ver `done` o `cancelled` recibía `AGENT_BUSY`. La invariante es: si ves un estado final, el hueco ya está libre.
3. **Presupuesto del blueprint: ya no es obligatorio (2026-10-24).** `creator.budgetUsdPerDay` sigue **acotando** lo declarado (declarar más es un error), pero no se exige declarar una cifra.
4. **Lo que sigue sin aplicarse se dice en voz alta (2026-10-24).** `fleetWarnings(fleet)` lista cada presupuesto declarado sin enforcement: `agents[].limits.budgetUsdPerDay`, `blueprints[].limits.budgetUsdPerDay` (y el techo del creador cuando el blueprint no declara ninguno) y **`policies.budget.perRunUsd` / `perDayUsd`**, un tercer campo que esta decisión no había listado y que el schema ya marcaba "accepted and kept; not enforced". `bk-hermes validate` los imprime como `warning:` en stderr y sigue saliendo con 0 y la línea `ok:` en stdout. El registro de auditoría de una creación anota `budget N USD/day (declared, not enforced)`. **No se rechazan** los `fleet.yaml` existentes.
5. **Presupuesto aplicado: pendiente, y el diseño original no era viable.** Este punto decía que Hermes construye el engine de un agente en proceso con `observability.budget` y `abortOnBudget`. No es así: `InProcessConnector` recibe **funciones** (`handler`), no un engine, y una instancia aprovisionada la construye el provisionador del anfitrión a partir de un `template` que Hermes no interpreta. Hermes no ve el gasto de los agentes que supervisa. Aplicar el límite exige un **canal de coste**: que el conector informe de `costUsd` por run (un `RunOutcome.costUsd` opcional, que el handler en proceso puede devolver y que `agent-protocol` puede transportar), que Hermes acumule el total diario por agente (día UTC) en el store de runs, y que rechace nuevas ejecuciones con un código claro al alcanzarlo. Eso cambia contratos (`connectors/types`, `agent-protocol`) y queda como fase aparte ([SPEC-0009 §C3b](../specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md)). Hasta entonces, todo presupuesto es declarativo y así se avisa.

## Consecuencias
### Positivas
- Lo que dice el `fleet.yaml` coincide con lo que ocurre, o dice con claridad que no ocurre.
- Se retira la falsa garantía del presupuesto obligatorio.
- La regla evita que el problema reaparezca con los campos que se añadan después, por ejemplo el tipo `Capability` de [SPEC-0009 §C5](../specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md).

### Negativas / trade-offs
- Trabajo extra al añadir cualquier límite: hay que cablearlo y probarlo antes de exponerlo.
- Un presupuesto aplicado exigirá un canal de coste en los conectores; un agente remoto solo podrá aplicarlo si su servidor informa del coste.
- Los avisos son ruido hasta que el enforcement llegue.
- `AGENT_BUSY` es un error nuevo que los llamadores (y los modelos, vía las herramientas `agent_*`) deben saber manejar.

## Alternativas consideradas
- **Quitar los campos del schema.** Rechazada: rompe `fleet.yaml` existentes por un límite que sí se quiere aplicar pronto.
- **Dejarlos como están.** Rechazada: es la falsa garantía que motiva esta decisión.
- **Rechazar los `fleet.yaml` que declaran límites no aplicados.** Rechazada por ahora: incompatible sin ganancia. Puede volver como endurecimiento en una versión posterior si el enforcement sigue sin llegar.
- **Aplicar el presupuesto solo en el core, sin tocar Hermes.** Insuficiente: el core no sabe qué agente de la flota es quién; la atribución por agente es parte del trabajo.
