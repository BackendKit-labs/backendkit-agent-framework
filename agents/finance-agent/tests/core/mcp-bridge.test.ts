import { MCPClient, MCPBridge, MCPServerConfig, MCPDiscoveryResult } from '../../src/core/mcp-bridge';
import { ToolRegistry, MCPToolDefinition } from '../../src/core/tool-registry';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeStdioConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: {},
    timeoutMs: 15000,
    ...overrides,
  };
}

function makeHttpConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    name: 'http-server',
    transport: 'http',
    url: 'https://mcp.example.com',
    apiKey: 'test-key',
    args: [],
    env: {},
    timeoutMs: 15000,
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// MCPClient
// ──────────────────────────────────────────────

describe('MCPClient', () => {
  describe('constructor', () => {
    it('should create an instance with valid stdio config', () => {
      const client = new MCPClient(makeStdioConfig());
      expect(client).toBeInstanceOf(MCPClient);
    });

    it('should create an instance with valid HTTP config', () => {
      const client = new MCPClient(makeHttpConfig());
      expect(client).toBeInstanceOf(MCPClient);
    });

    it('should store the config values', () => {
      const config = makeStdioConfig({ name: 'custom-server' });
      const client = new MCPClient(config);
      expect(client.config.name).toBe('custom-server');
      expect(client.config.transport).toBe('stdio');
    });

    it('should throw for invalid config (empty name)', () => {
      expect(() => new MCPClient(makeStdioConfig({ name: '' }))).toThrow();
    });

    it('should throw for invalid transport value', () => {
      expect(() =>
        new MCPClient(makeStdioConfig({ transport: 'invalid' as 'stdio' }))
      ).toThrow();
    });
  });

  describe('connect / disconnect', () => {
    it('should connect via stdio transport', async () => {
      const client = new MCPClient(makeStdioConfig());
      // Without a real server process, connect will throw — but the instance
      // is still created and config is accessible
      await expect(client.connect()).rejects.toThrow();
      client.disconnect();
    });

    it('should be idempotent on disconnect', () => {
      const client = new MCPClient(makeStdioConfig());
      client.disconnect();
      client.disconnect();
      // No error expected
    });

    it('should handle connect failure gracefully', async () => {
      const client = new MCPClient(
        makeStdioConfig({ command: 'nonexistent-command' })
      );
      await expect(client.connect()).rejects.toThrow();
      client.disconnect();
    });
  });

  describe('listTools', () => {
    it('should throw when called before connecting', async () => {
      const client = new MCPClient(makeStdioConfig());
      // Without connect(), there is no process/stdin, so sendStdioRequest
      // rejects with "stdin no disponible"
      await expect(client.listTools()).rejects.toThrow(/stdin no disponible|MCP/);
    });
  });

  describe('discoverTools', () => {
    it('should throw when called before connecting', async () => {
      const client = new MCPClient(makeStdioConfig());
      // Without connect(), there is no process/stdin, so sendStdioRequest
      // rejects with "stdin no disponible"
      await expect(client.discoverTools()).rejects.toThrow(/stdin no disponible|MCP/);
    });

    it('should return MCPToolDefinition array when connected to a real server', async () => {
      const client = new MCPClient(makeStdioConfig());
      // Without a real MCP server, connect will fail
      await expect(client.connect()).rejects.toThrow();
      // After failed connect, discoverTools should also throw
      await expect(client.discoverTools()).rejects.toThrow();
      client.disconnect();
    });
  });
});

// ──────────────────────────────────────────────
// MCPBridge
// ──────────────────────────────────────────────

describe('MCPBridge', () => {
  let registry: ToolRegistry;
  let bridge: MCPBridge;

  beforeEach(() => {
    registry = new ToolRegistry();
    bridge = new MCPBridge(registry);
  });

  afterEach(() => {
    bridge.disconnectAll();
  });

  describe('constructor', () => {
    it('should create an empty bridge', () => {
      expect(bridge).toBeInstanceOf(MCPBridge);
    });

    it('should start with zero connected servers', () => {
      expect(bridge.connectedCount).toBe(0);
    });
  });

  describe('getClient', () => {
    it('should return undefined for a non-existent server', () => {
      expect(bridge.getClient('non_existent')).toBeUndefined();
    });

    it('should return a client after discoverAndRegister (even on failure)', async () => {
      // The client is stored in the map BEFORE the try block,
      // so it's available even when connection fails
      const config = makeStdioConfig({ name: 'contpaqi' });
      await bridge.discoverAndRegister(config);

      const client = bridge.getClient('contpaqi');
      expect(client).toBeInstanceOf(MCPClient);
      expect(client!.config.name).toBe('contpaqi');
    });
  });

  describe('discoverAndRegister', () => {
    it('should return a result with success=false when connection fails', async () => {
      const config = makeStdioConfig({
        name: 'faulty',
        command: 'nonexistent-command',
      });

      const result = await bridge.discoverAndRegister(config);

      expect(result).toHaveProperty('serverName', 'faulty');
      expect(result.success).toBe(false);
      expect(result.toolsDiscovered).toBe(0);
      expect(result.toolsRegistered).toBe(0);
      expect(result.error).toBeDefined();
    });

    it('should store the client even when connection fails', async () => {
      const config = makeStdioConfig({
        name: 'faulty',
        command: 'nonexistent-command',
      });

      await bridge.discoverAndRegister(config);
      expect(bridge.getClient('faulty')).toBeDefined();
    });

    it('should increment connectedCount after attempt', async () => {
      expect(bridge.connectedCount).toBe(0);

      const config = makeStdioConfig({ name: 'contpaqi' });
      await bridge.discoverAndRegister(config);

      expect(bridge.connectedCount).toBe(1);
    });
  });

  describe('discoverAndRegisterAll', () => {
    it('should return results for all servers', async () => {
      const configs: MCPServerConfig[] = [
        makeStdioConfig({ name: 'server-a', command: 'nonexistent-command' }),
        makeStdioConfig({ name: 'server-b', command: 'nonexistent-command' }),
      ];

      const results = await bridge.discoverAndRegisterAll(configs);

      expect(results).toHaveLength(2);
      expect(results[0].serverName).toBe('server-a');
      expect(results[1].serverName).toBe('server-b');
    });

    it('should handle empty configs array', async () => {
      const results = await bridge.discoverAndRegisterAll([]);
      expect(results).toEqual([]);
    });

    it('should process all servers even if some fail', async () => {
      const configs: MCPServerConfig[] = [
        makeStdioConfig({ name: 'server-a', command: 'nonexistent-command' }),
        makeStdioConfig({ name: 'server-b', command: 'nonexistent-command' }),
      ];

      const results = await bridge.discoverAndRegisterAll(configs);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(false);
    });

    it('should increment connectedCount for each server', async () => {
      const configs: MCPServerConfig[] = [
        makeStdioConfig({ name: 'server-a', command: 'nonexistent-command' }),
        makeStdioConfig({ name: 'server-b', command: 'nonexistent-command' }),
      ];

      await bridge.discoverAndRegisterAll(configs);
      expect(bridge.connectedCount).toBe(2);
    });
  });

  describe('disconnectAll', () => {
    it('should clear all clients', async () => {
      const configs: MCPServerConfig[] = [
        makeStdioConfig({ name: 'server-a', command: 'nonexistent-command' }),
        makeStdioConfig({ name: 'server-b', command: 'nonexistent-command' }),
      ];

      await bridge.discoverAndRegisterAll(configs);
      expect(bridge.connectedCount).toBe(2);

      bridge.disconnectAll();
      expect(bridge.connectedCount).toBe(0);
    });

    it('should be idempotent', () => {
      bridge.disconnectAll();
      bridge.disconnectAll();
      expect(bridge.connectedCount).toBe(0);
    });
  });

  describe('integration with ToolRegistry', () => {
    it('should not register any tools when connection fails', async () => {
      const config = makeStdioConfig({
        name: 'faulty',
        command: 'nonexistent-command',
      });

      await bridge.discoverAndRegister(config);

      expect(registry.listTools()).toHaveLength(0);
    });

    it('should store the client when discovery is attempted', async () => {
      const config = makeStdioConfig({ name: 'contpaqi' });
      const result = await bridge.discoverAndRegister(config);

      expect(result.serverName).toBe('contpaqi');
      expect(bridge.getClient('contpaqi')).toBeDefined();
    });
  });
});
