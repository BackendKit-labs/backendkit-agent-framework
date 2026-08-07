import { ApiGatewayClient, ApiGatewayError, ApiGatewayServerError } from '../../src/api-gateway/client';

/**
 * Tests de integración para ApiGatewayClient.
 * 
 * NOTA: Estos tests requieren un servidor de API Gateway en ejecución.
 * Se saltan automáticamente si la variable de entorno INTEGRATION_TESTS no está definida.
 */

const runIntegrationTests = process.env.INTEGRATION_TESTS === 'true';

const testIf = (condition: boolean) => condition ? describe : describe.skip;

testIf(runIntegrationTests)('ApiGatewayClient - Integration Tests', () => {
  const baseUrl = process.env.API_GATEWAY_URL || 'http://localhost:3001';
  const apiKey = process.env.API_GATEWAY_API_KEY || 'test-key';
  const client = new ApiGatewayClient({ baseUrl, apiKey, timeoutMs: 5000 });

  describe('GET requests', () => {
    it('debe obtener datos del endpoint de health', async () => {
      const result = await client.get<{ status: string }>('/health');
      expect(result).toHaveProperty('status');
      expect(result.status).toBe('ok');
    });

    it('debe obtener la lista de tools disponibles', async () => {
      const result = await client.get<{ tools: unknown[] }>('/tools');
      expect(result).toHaveProperty('tools');
      expect(Array.isArray(result.tools)).toBe(true);
    });
  });

  describe('POST requests', () => {
    it('debe ejecutar una tool correctamente', async () => {
      const result = await client.post<{ success: boolean }>('/tools/balance-sheet/execute', {
        period: '2024-01',
        companyId: 'test-company',
      });
      expect(result).toHaveProperty('success');
    });

    it('debe rechazar solicitudes con datos inválidos (4xx)', async () => {
      await expect(
        client.post('/tools/nonexistent/execute', {})
      ).rejects.toThrow(ApiGatewayError);
    });
  });

  describe('Error handling', () => {
    it('debe lanzar ApiGatewayError para endpoints que no existen (404)', async () => {
      await expect(
        client.get('/api/v1/nonexistent-endpoint')
      ).rejects.toThrow(ApiGatewayError);
    });

    it('debe lanzar ApiGatewayServerError si el servidor falla (500)', async () => {
      // Asumiendo que existe un endpoint que fuerza un error 500
      await expect(
        client.post('/tools/force-error', {})
      ).rejects.toThrow(ApiGatewayServerError);
    });
  });
});