← [Índice](./README.md)

# 05 · Limitaciones conocidas

- **El origen de pagos es un archivo JSON sin locking entre procesos.** El subproceso MCP y el
  panel admin escriben cada uno con su propio `read()`+`write()` atómico, pero sin coordinación
  entre sí: dos escrituras que caigan en el mismo instante pueden pisarse (el último `write()`
  gana). En la práctica, poco probable (una corrida diaria, algún clic ocasional en el panel),
  pero es un riesgo real, no sólo hipotético, ahora que hay dos procesos que escriben de verdad.
  Ver [01 · Arquitectura](./01-arquitectura.md).
- **La recurrencia es mensual por día del mes únicamente**; no hay cron por ocurrencia ni pagos
  de una sola vez con fecha exacta. El panel admin no lo cambia — programa lo mismo que ya
  soportaba el JSON, sólo sin tener que editarlo a mano.
- **Un disparo se descarta, no se encola.** Si `TriggerManager` encuentra al agente todavía
  procesando la corrida anterior, descarta el disparo entrante (cron, webhook, o el botón del
  panel) con un aviso. Correcto para no solapar corridas de pago, pero significa que una corrida
  colgada se salta la siguiente entera.
- **`POST /run-now` y el botón del panel fuerzan la corrida completa**, no un pago puntual — no
  hay forma de pedir "reintentá sólo esta ocurrencia" sin que el agente revise también lo demás
  (`list_pending_confirmations`, el resto de `list_due_payments`).
- **El agente nunca puede autoaprobar un `held`.** `POST /api/v1/approvals` en AVAL exige la
  credencial de consola, nunca la del agente — separación de responsabilidades correcta de AVAL,
  no una limitación de este proyecto. El panel admin tampoco lo resuelve a propósito: aprobar un
  retenido sigue siendo un acto humano, en la consola de AVAL.
- **El freno de "atascado" (`STUCK_THRESHOLD`) no distingue la causa de la denegación** — de
  los seis motivos posibles en AVAL, sólo el tope diario se resuelve solo con el tiempo; los
  otros cinco son estructurales. `consecutiveDenials` los cuenta a todos igual, así que un pago
  que por casualidad choca con el tope diario tres corridas seguidas queda marcado "atascado"
  igual que uno con la contraparte mal configurada — falso positivo, pero barato: sólo pide un
  clic en "reactivar" de más. La alternativa (que AVAL exponga la causa exacta de cada
  denegación, no sólo la de contraparte/carril) se evaluó y se descartó para esta vuelta — exige
  cambios en tres repositorios para un beneficio marginal frente al freno genérico. Ver
  [02 · Herramientas](./02-herramientas.md#por-qué-un-pago-puede-quedar-atascado-y-qué-hace-el-agente-con-eso).
- **El panel admin es de un solo token, sin usuarios ni roles**, y sirve HTML sin ningún
  framework de frontend — alcanza para un operador con acceso a la máquina donde corre el
  agente, no para exponerlo como producto multiusuario. Ver
  [03 · Panel admin](./03-panel-admin.md).
- **Pruebas de extremo a extremo parciales.** La suite (`npm test`) cubre `store.ts` (35 casos) y el
  agente completo con un AVAL simulado, el servidor MCP real y un modelo guionizado (pagar una vez,
  registrar, reconciliar en la corrida siguiente, arrancar y apagar el cron). No cubre el modelo real (cuesta
  dinero cada corrida), los triggers de webhook o evento, ni el servidor admin (probado a mano). El simulador
  de AVAL imita lo mínimo del API: no reproduce retenciones ni denegaciones por política.
- **`agent.stop()` no cierra el servidor MCP hijo en `agent-core` anterior a 0.48.10.** Solo paraba los
  triggers. `stopSchedulerAgent(agent)` (`src/agent.ts`) apaga las dos cosas y sirve en cualquier 0.48; desde
  0.48.10 `agent.stop()` ya lo cierra.

---
← [04 · Variables de entorno](./04-variables-de-entorno.md)
