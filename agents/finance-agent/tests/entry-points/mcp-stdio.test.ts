import { MCPServer } from '../../src/entry-points/mcp-stdio';

describe('MCP STDIO Server', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer();
  });

  describe('JSON-RPC parsing', () => {
    it('should parse a valid JSON-RPC request', () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      });

      const result = server.parseRequest(request);
      expect(result).toBeDefined();
      expect(result.jsonrpc).toBe('2.0');
      expect(result.id).toBe(1);
      expect(result.method).toBe('initialize');
    });

    it('should reject invalid JSON', () => {
      expect(() => {
        server.parseRequest('not json');
      }).toThrow();
    });

    it('should reject missing jsonrpc field', () => {
      const request = JSON.stringify({
        id: 1,
        method: 'test',
      });

      expect(() => {
        server.parseRequest(request);
      }).toThrow();
    });

    it('should reject invalid jsonrpc version', () => {
      const request = JSON.stringify({
        jsonrpc: '1.0',
        id: 1,
        method: 'test',
      });

      expect(() => {
        server.parseRequest(request);
      }).toThrow();
    });
  });

  describe('initialize method', () => {
    it('should respond to initialize request', async () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      });

      const response = await server.handleRequest(request);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(1);
      expect(parsed.result).toBeDefined();
      expect(parsed.result.serverInfo.name).toBe('finance-agent');
      expect(parsed.result.capabilities).toBeDefined();
    });
  });

  describe('tools/list method', () => {
    it('should return list of available tools', async () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      const response = await server.handleRequest(request);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(2);
      expect(parsed.result).toBeDefined();
      expect(Array.isArray(parsed.result.tools)).toBe(true);
    });

    it('should include income_statement tool', async () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {},
      });

      const response = await server.handleRequest(request);
      const parsed = JSON.parse(response);
      const toolNames = parsed.result.tools.map((t: any) => t.name);

      expect(toolNames).toContain('get_income_statement');
    });

    it('should include balance_sheet tool', async () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/list',
        params: {},
      });

      const response = await server.handleRequest(request);
      const parsed = JSON.parse(response);
      const toolNames = parsed.result.tools.map((t: any) => t.name);

      expect(toolNames).toContain('get_balance_sheet');
    });

    it('should include cash_flow tool', async () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/list',
        params: {},
      });

      const response = await server.handleRequest(request);
      const parsed = JSON.parse(response);
      const toolNames = parsed.result.tools.map((t: any) => t.name);

      expect(toolNames).toContain('get_cash_flow');
    });
  });

  describe('tools/call method', () => {
    it('should execute a valid tool call', async () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'get_income_statement',
          arguments: { period: '2024-01' },
        },
      });

      const response = await server.handleRequest(request);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(6);
      expect(parsed.result).toBeDefined();
      expect(parsed.result.content).toBeDefined();
    });

    it('should return error for non-existent tool', async () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'non_existent_tool',
          arguments: {},
        },
      });

      const response = await server.handleRequest(request);
      const parsed = JSON.parse(response);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(7);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('error handling', () => {
    it('should return error for unknown method', async () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'unknown_method',
        params: {},
      });

      const response = await server.handleRequest(request);
      const parsed = JSON.parse(response);

      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32601);
    });

    it('should return error for malformed request', async () => {
      const response = await server.handleRequest('not json');
      const parsed = JSON.parse(response);

      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32700);
    });
  });
});
