/**
 * Finance Agent — Frontend Dashboard
 *
 * Endpoints consumidos:
 *   GET  /health                → estado del agente
 *   POST /chat                  → enviar consulta (query)
 *   GET  /tools                 → listar tools (como sustituto de /api/reports/templates)
 *   POST /api/reports/generate  → generar reporte
 *
 * Nota: El backend expone /tools (lista de tools registradas) y /chat (consulta LLM).
 *       Los endpoints /api/reports/templates y /api/reports/generate se asumen
 *       como rutas adicionales del mismo servidor Express.
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Configuración
  // ──────────────────────────────────────────────

  /** @type {string} */
  const BASE_URL = (function () {
    // Si la app se sirve desde el mismo origen, usar relative
    const protocol = window.location.protocol;
    const host = window.location.host;
    // En desarrollo el backend suele estar en puerto 3000/3001
    // Si estamos en un puerto diferente (ej: 5500 de Live Server), apuntar al backend
    if (host.includes(':')) {
      const port = parseInt(host.split(':')[1], 10);
      if (port !== 3000 && port !== 3001) {
        return protocol + '//' + host.split(':')[0] + ':3000';
      }
    }
    return ''; // mismo origen
  })();

  // ──────────────────────────────────────────────
  // Utilidades
  // ──────────────────────────────────────────────

  /**
   * Fetch wrapper con manejo de errores.
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  async function apiFetch(url, options) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      let msg;
      try {
        const body = await res.json();
        msg = body.error || body.message || body.detail || JSON.stringify(body);
      } catch {
        msg = res.statusText || `HTTP ${res.status}`;
      }
      throw new Error(msg);
    }
    return res.json();
  }

  /**
   * Muestra un modal con título y contenido.
   * @param {string} title
   * @param {string} body
   */
  function showModal(title, body) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').textContent = body;
    document.getElementById('modalOverlay').classList.add('open');
  }

  /** Cierra el modal. */
  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
  }

  // Exponer globalmente para onclick
  window.closeModal = closeModal;

  // ──────────────────────────────────────────────
  // Reloj
  // ──────────────────────────────────────────────

  /**
   * Actualiza el reloj cada segundo.
   */
  function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('es-CO', { hour12: false });
    document.getElementById('clock').textContent = time;
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ──────────────────────────────────────────────
  // Health Check
  // ──────────────────────────────────────────────

  /**
   * Consulta GET /health y actualiza la barra de estado.
   */
  async function checkHealth() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const ts = document.getElementById('statusTimestamp');

    try {
      const data = await apiFetch(BASE_URL + '/health');
      dot.className = 'status-dot online';
      text.textContent = '🟢 En línea — ' + (data.status || 'ok');
      ts.textContent = data.timestamp
        ? new Date(data.timestamp).toLocaleString('es-CO')
        : '';
    } catch (err) {
      dot.className = 'status-dot offline';
      text.textContent = '🔴 Sin conexión — ' + err.message;
      ts.textContent = '';
    }
  }

  // ──────────────────────────────────────────────
  // Query (POST /chat)
  // ──────────────────────────────────────────────

  /**
   * Envía una consulta al backend vía POST /chat.
   * Expuesta globalmente para el onclick del botón.
   */
  async function sendQuery() {
    const input = document.getElementById('queryInput');
    const resultDiv = document.getElementById('queryResult');
    const btn = document.getElementById('btnQuery');
    const message = input.value.trim();

    if (!message) {
      resultDiv.innerHTML = '<div class="error">Escribe una consulta antes de enviar.</div>';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Consultando...';
    resultDiv.innerHTML = '';

    try {
      const data = await apiFetch(BASE_URL + '/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });

      const response = data.response || JSON.stringify(data, null, 2);
      resultDiv.innerHTML =
        '<div class="result-card">' +
        '<div class="label">Respuesta</div>' +
        '<div class="value">' + escapeHtml(response) + '</div>' +
        '</div>';
    } catch (err) {
      resultDiv.innerHTML = '<div class="error">❌ ' + escapeHtml(err.message) + '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar consulta';
    }
  }

  window.sendQuery = sendQuery;

  // ──────────────────────────────────────────────
  // Templates (GET /api/reports/templates)
  // ──────────────────────────────────────────────

  /**
   * Carga la lista de plantillas desde GET /api/reports/templates.
   * Expuesta globalmente para el onclick del botón.
   */
  async function loadTemplates() {
    const container = document.getElementById('templateList');
    const btn = document.getElementById('btnLoadTemplates');
    const form = document.getElementById('generateForm');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Cargando...';

    try {
      const data = await apiFetch(BASE_URL + '/api/reports/templates');
      const templates = data.templates || [];

      if (templates.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:0.85rem">No hay plantillas disponibles.</span>';
        form.style.display = 'none';
        return;
      }

      container.innerHTML = '';
      templates.forEach(function (name) {
        const chip = document.createElement('span');
        chip.className = 'template-chip';
        chip.textContent = name;
        chip.dataset.name = name;
        chip.addEventListener('click', function () {
          // Deseleccionar todas
          container.querySelectorAll('.template-chip').forEach(function (c) {
            c.classList.remove('selected');
          });
          chip.classList.add('selected');
          // Mostrar formulario
          form.style.display = 'flex';
        });
        container.appendChild(chip);
      });

      // Si solo hay una, seleccionarla automáticamente
      if (templates.length === 1) {
        container.querySelector('.template-chip').classList.add('selected');
        form.style.display = 'flex';
      }
    } catch (err) {
      container.innerHTML = '<span class="error">Error: ' + escapeHtml(err.message) + '</span>';
      form.style.display = 'none';
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 Cargar plantillas';
    }
  }

  window.loadTemplates = loadTemplates;

  // ──────────────────────────────────────────────
  // Generate Report (POST /api/reports/generate)
  // ──────────────────────────────────────────────

  /**
   * Genera un reporte vía POST /api/reports/generate.
   * Expuesta globalmente para el onclick del botón.
   */
  async function generateReport() {
    const resultDiv = document.getElementById('generateResult');
    const btn = document.getElementById('btnGenerate');

    // Obtener template seleccionado
    const selected = document.querySelector('.template-chip.selected');
    if (!selected) {
      resultDiv.innerHTML = '<div class="error">Selecciona una plantilla primero.</div>';
      return;
    }
    const template = selected.dataset.name;

    const period = document.getElementById('reportPeriod').value.trim() || '2026-Q1';
    const title = document.getElementById('reportTitle').value.trim() || undefined;

    // Formatos checkeados
    const formatCheckboxes = document.querySelectorAll('#formatCheckboxes input[type="checkbox"]:checked');
    const formats = Array.from(formatCheckboxes).map(function (cb) { return cb.value; });

    if (formats.length === 0) {
      resultDiv.innerHTML = '<div class="error">Selecciona al menos un formato de exportación.</div>';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generando...';
    resultDiv.innerHTML = '';

    try {
      const data = await apiFetch(BASE_URL + '/api/reports/generate', {
        method: 'POST',
        body: JSON.stringify({
          template: template,
          period: period,
          formats: formats,
          title: title,
        }),
      });

      // Mostrar resultado en modal
      const pretty = JSON.stringify(data, null, 2);
      showModal('Reporte generado: ' + (data.title || template), pretty);

      resultDiv.innerHTML = '<div class="success">✅ Reporte generado exitosamente.</div>';
    } catch (err) {
      resultDiv.innerHTML = '<div class="error">❌ ' + escapeHtml(err.message) + '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generar reporte';
    }
  }

  window.generateReport = generateReport;

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  /**
   * Escapa HTML para prevenir XSS.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str);
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ──────────────────────────────────────────────
  // Init
  // ──────────────────────────────────────────────

  // Health check al cargar y cada 30s
  checkHealth();
  setInterval(checkHealth, 30_000);

  // Cargar plantillas automáticamente al inicio
  loadTemplates();

})();
