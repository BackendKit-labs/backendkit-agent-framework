
---

## 🩺 `hermes doctor` — El diagnóstico del sistema

Se ejecuta con:

```bash
hermes doctor          # solo diagnóstica
hermes doctor --fix    # diagnóstica e intenta arreglar
hermes doctor --ack <target>  # reconoce issues conocidos
```

### ¿Qué chequea exactamente?

El comando activa `HERMES_INTERACTIVE=1` y ejecuta estas **8 verificaciones**:

---

### 1️⃣ Variables de Entorno
Lee `~/.hermes/.env` y verifica que estén configuradas las API keys necesarias:
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- y otros proveedores configurados

### 2️⃣ Consistencia de Versiones
Compara la versión declarada en `pyproject.toml` con `hermes_cli.__version__`. Si no coinciden, te avisa.

### 3️⃣ Supervisión de Contenedores (s6)
Si estás dentro de un contenedor, reporta el estado de:
- `main-hermes` — el proceso principal
- Dashboard
- Gateways por perfil

### 4️⃣ Certificados SSL
Valida el bundle de certificados CA mediante `agent.ssl_guard.verify_ca_bundle_with_fallback()`. Asegura que las conexiones HTTPS funcionen.

### 5️⃣ Gateway Service Linger
En Linux, verifica si el servicio systemd del gateway está configurado con **linger** (para que no muera al cerrar sesión).

### 6️⃣ Conectividad con Proveedores LLM
Hace un ping real a los **endpoints de modelos** de cada proveedor configurado. Verifica:
- OpenRouter
- OpenAI
- Otros que tengas configurados

### 7️⃣ Disponibilidad de Herramientas
Verifica qué tools externas están instaladas y disponibles:
- **kanban**
- **honcho**
- Ajusta el comportamiento según el runtime (contendor vs local)

### 8️⃣ Soporte Termux
Si estás en **Termux** (Android), provee notas de instalación alternativas.

---

### ⚡ ¿Qué pasa si algo falla?

- Si usás `--fix`, intenta corregir automáticamente lo que pueda (a futuro).
- Si usás `--ack <target>`, marcás un issue conocido como "reconocido" para que no te lo muestre más.
- Si todo está bien, te devuelve un ✅ verde y seguís tranquilo.

---

Es como un **check-up médico** de todo el ecosistema Hermes. ¿Querés que veamos alguna de las otras notas cuando el vault se recupere, como el gateway o los hooks?

-----
