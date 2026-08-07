import type { Server } from 'http';
import express from 'express';
import { createMCPServer } from '../../src/entry-points/mcp-http';

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

describe('MCP HTTP Server', () => {
  let app: express.Application;
  let server: Server;

  beforeAll(async () => {
    app = createMCPServer(PORT);
    await new Promise<void>((resolve) => {
      server = app.listen(PORT, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('Server creation', () => {
    it('should create an Express application', () => {
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe('function');
    });

    // El parseo de JSON ya se verifica por comportamiento en "POST /chat" y
    // "POST /tools/:toolName/execute" (envían body JSON y esperan que el
    // handler reciba los campos correctos) — no hace falta un test aparte que
    // dependa de la estructura interna de _router.stack, que cambió entre
    // Express 4 y 5 y no es estable para testear directamente.
  });

  describe('GET /health', () => {
    it('should return status ok', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('GET /tools', () => {
    it('should return list of tools', async () => {
      const response = await fetch(`${BASE_URL}/tools`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tools).toBeDefined();
      expect(Array.isArray(data.tools)).toBe(true);
    });
  });

  describe('POST /tools/:toolName/execute', () => {
    it('should execute a valid tool', async () => {
      const response = await fetch(`${BASE_URL}/tools/get_balance_sheet/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: '2024-01' }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should return 400 for non-existent tool', async () => {
      const response = await fetch(`${BASE_URL}/tools/non_existent/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 400 for invalid JSON body', async () => {
      const response = await fetch(`${BASE_URL}/tools/test/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /chat', () => {
    it('should process a chat message', async () => {
      const response = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
    });

    it('should return 400 when message is missing', async () => {
      const response = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Mensaje requerido');
    });

    it('should return 400 when message is not a string', async () => {
      const response = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 123 }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Mensaje requerido');
    });
  });
});
