import { ToolRegistry, defineTool } from '../../src/core/tool-registry';
import { z } from 'zod';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('registerNativeTool', () => {
    it('should register a native tool successfully', () => {
      const tool = defineTool({
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: z.object({ name: z.string() }),
        handler: jest.fn().mockResolvedValue({ result: 'success' }),
      });

      registry.registerNativeTool(tool);
      const tools = registry.listTools();
      
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test_tool');
    });

    it('should throw error when registering duplicate tool name', () => {
      const tool = defineTool({
        name: 'duplicate_tool',
        description: 'First tool',
        inputSchema: z.object({}),
        handler: jest.fn().mockResolvedValue({}),
      });

      registry.registerNativeTool(tool);

      const duplicateTool = defineTool({
        name: 'duplicate_tool',
        description: 'Second tool',
        inputSchema: z.object({}),
        handler: jest.fn().mockResolvedValue({}),
      });

      expect(() => {
        registry.registerNativeTool(duplicateTool);
      }).toThrow('ya está registrada');
    });

    it('should register multiple tools', () => {
      const tool1 = defineTool({
        name: 'tool_one',
        description: 'First tool',
        inputSchema: z.object({}),
        handler: jest.fn().mockResolvedValue({}),
      });

      const tool2 = defineTool({
        name: 'tool_two',
        description: 'Second tool',
        inputSchema: z.object({}),
        handler: jest.fn().mockResolvedValue({}),
      });

      registry.registerNativeTool(tool1);
      registry.registerNativeTool(tool2);

      expect(registry.listTools()).toHaveLength(2);
    });
  });

  describe('registerMCPTool', () => {
    it('should register an MCP tool', () => {
      registry.registerMCPTool({
        name: 'mcp_tool',
        description: 'MCP tool',
        inputSchema: { type: 'object', properties: {} },
        serverId: 'server-1',
      });

      const tools = registry.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('mcp_tool');
    });

    it('should allow same name for native and MCP tools', () => {
      const nativeTool = defineTool({
        name: 'shared_name',
        description: 'Native tool',
        inputSchema: z.object({}),
        handler: jest.fn().mockResolvedValue({}),
      });

      registry.registerNativeTool(nativeTool);
      registry.registerMCPTool({
        name: 'shared_name',
        description: 'MCP tool',
        inputSchema: { type: 'object' },
        serverId: 'server-1',
      });

      expect(registry.listTools()).toHaveLength(2);
    });
  });

  describe('executeTool', () => {
    it('should execute a registered native tool', async () => {
      const handler = jest.fn().mockResolvedValue({ balance: 1000 });
      const tool = defineTool({
        name: 'get_balance',
        description: 'Get balance',
        inputSchema: z.object({ period: z.string() }),
        handler,
      });

      registry.registerNativeTool(tool);
      const result = await registry.executeTool('get_balance', { period: '2024-01' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ balance: 1000 });
      expect(result.toolName).toBe('get_balance');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return error result when tool does not exist', async () => {
      const result = await registry.executeTool('non_existent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('no encontrada');
      expect(result.toolName).toBe('non_existent');
    });

    it('should return error result on validation failure', async () => {
      const tool = defineTool({
        name: 'validated_tool',
        description: 'Tool with validation',
        inputSchema: z.object({
          requiredField: z.string(),
        }),
        handler: jest.fn().mockResolvedValue({}),
      });

      registry.registerNativeTool(tool);

      const result = await registry.executeTool('validated_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should pass validated input to handler', async () => {
      const handler = jest.fn().mockResolvedValue({});
      const tool = defineTool({
        name: 'passthrough_tool',
        description: 'Pass through',
        inputSchema: z.object({
          value: z.number(),
        }),
        handler,
      });

      registry.registerNativeTool(tool);
      await registry.executeTool('passthrough_tool', { value: 42 });

      expect(handler).toHaveBeenCalledWith({ value: 42 }, undefined);
    });
  });

  describe('listTools', () => {
    it('should return empty array when no tools registered', () => {
      expect(registry.listTools()).toEqual([]);
    });

    it('should return all registered tools', () => {
      const tool1 = defineTool({
        name: 'tool_a',
        description: 'Tool A',
        inputSchema: z.object({}),
        handler: jest.fn().mockResolvedValue({}),
      });

      const tool2 = defineTool({
        name: 'tool_b',
        description: 'Tool B',
        inputSchema: z.object({}),
        handler: jest.fn().mockResolvedValue({}),
      });

      registry.registerNativeTool(tool1);
      registry.registerNativeTool(tool2);
      registry.registerMCPTool({
        name: 'tool_c',
        description: 'Tool C',
        inputSchema: {},
        serverId: 'server-1',
      });

      const tools = registry.listTools();
      expect(tools).toHaveLength(3);
    });
  });

  describe('getTool', () => {
    it('should return a native tool by name', () => {
      const tool = defineTool({
        name: 'find_me',
        description: 'Find this tool',
        inputSchema: z.object({}),
        handler: jest.fn().mockResolvedValue({}),
      });

      registry.registerNativeTool(tool);
      const found = registry.getTool('find_me');

      expect(found).toBeDefined();
      expect(found!.name).toBe('find_me');
    });

    it('should return undefined for non-existent tool', () => {
      expect(registry.getTool('ghost')).toBeUndefined();
    });
  });
});