import { createEngine } from '../../src/core/engine';

describe('Engine', () => {
  describe('createEngine', () => {
    let originalApiKey: string | undefined;

    beforeEach(() => {
      // El entorno real puede tener DEEPSEEK_API_KEY seteada (credencial del
      // agente en uso) — sin aislar esto, los tests de "apiKey faltante" son
      // falsos negativos según la máquina donde corran.
      originalApiKey = process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;
    });

    afterEach(() => {
      if (originalApiKey === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = originalApiKey;
      }
    });

    it('should create an engine with deepseek provider configured', () => {
      const engine = createEngine({
        apiKey: 'test-api-key',
      });
      
      expect(engine).toBeDefined();
      expect(engine).toHaveProperty('complete');
      expect(typeof engine.complete).toBe('function');
    });

    it('should use default vault path when not provided', () => {
      const engine = createEngine({
        apiKey: 'test-api-key',
      });
      
      expect(engine).toBeDefined();
    });

    it('should use custom vault path when provided', () => {
      const engine = createEngine({
        apiKey: 'test-api-key',
        vaultPath: '/custom/vault/path',
      });
      
      expect(engine).toBeDefined();
    });

    it('should throw error when apiKey is missing', () => {
      expect(() => {
        createEngine({});
      }).toThrow('API key de DeepSeek es requerida');
    });

    it('should throw error when apiKey is empty string', () => {
      expect(() => {
        createEngine({ apiKey: '' });
      }).toThrow('API key de DeepSeek es requerida');
    });

    it('should use environment variable for apiKey when not provided', () => {
      process.env.DEEPSEEK_API_KEY = 'env-api-key';

      const engine = createEngine();

      expect(engine).toBeDefined();
    });

    it('should accept custom temperature', () => {
      const engine = createEngine({
        apiKey: 'test-api-key',
        temperature: 0.7,
      });
      
      expect(engine).toBeDefined();
    });

    it('should accept custom maxTokens', () => {
      const engine = createEngine({
        apiKey: 'test-api-key',
        maxTokens: 2048,
      });
      
      expect(engine).toBeDefined();
    });

    it('should reject temperature below 0', () => {
      expect(() => {
        createEngine({
          apiKey: 'test-api-key',
          temperature: -0.1,
        });
      }).toThrow();
    });

    it('should reject temperature above 2', () => {
      expect(() => {
        createEngine({
          apiKey: 'test-api-key',
          temperature: 2.1,
        });
      }).toThrow();
    });

    it('should reject non-positive maxTokens', () => {
      expect(() => {
        createEngine({
          apiKey: 'test-api-key',
          maxTokens: 0,
        });
      }).toThrow();
    });
  });
});