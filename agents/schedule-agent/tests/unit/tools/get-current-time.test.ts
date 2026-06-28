import { handleGetCurrentTime } from "../../../src/tools/get-current-time.js";

// ─── Helpers ─────────────────────────────────────────────────────

function parseResponse(response: string): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  return JSON.parse(response);
}

// ─── Tests ───────────────────────────────────────────────────────

describe("get_current_time tool handler", () => {
  describe("success cases", () => {
    it("should return a valid ISO 8601 timestamp", async () => {
      const response = parseResponse(await handleGetCurrentTime());

      expect(response.content[0].type).toBe("text");
      const parsed = JSON.parse(response.content[0].text);

      expect(parsed.iso).toBeDefined();
      expect(typeof parsed.iso).toBe("string");
      // ISO 8601 format: 2024-01-15T10:30:00.000Z
      expect(parsed.iso).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });

    it("should return a non-empty timezone string", async () => {
      const response = parseResponse(await handleGetCurrentTime());

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.timezone).toBeDefined();
      expect(typeof parsed.timezone).toBe("string");
      expect(parsed.timezone.length).toBeGreaterThan(0);
    });

    it("should return offset in +HH:mm or -HH:mm format", async () => {
      const response = parseResponse(await handleGetCurrentTime());

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.offset).toBeDefined();
      expect(typeof parsed.offset).toBe("string");
      // Format: +HH:mm or -HH:mm (e.g. "+03:00", "-05:30")
      expect(parsed.offset).toMatch(/^[+-]\d{2}:\d{2}$/);
    });

    it("should return a positive unix timestamp (number)", async () => {
      const response = parseResponse(await handleGetCurrentTime());

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.unix).toBeDefined();
      expect(typeof parsed.unix).toBe("number");
      // Unix timestamp for year 2024+ should be > 1.7 trillion
      expect(parsed.unix).toBeGreaterThan(1_700_000_000_000);
    });

    it("should return all four fields in the response", async () => {
      const response = parseResponse(await handleGetCurrentTime());

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toHaveProperty("iso");
      expect(parsed).toHaveProperty("timezone");
      expect(parsed).toHaveProperty("offset");
      expect(parsed).toHaveProperty("unix");
    });
  });

  describe("no input required", () => {
    it("should work without any input parameters", async () => {
      const response = parseResponse(await handleGetCurrentTime());

      expect(response.content[0].type).toBe("text");
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.iso).toBeDefined();
    });
  });

  describe("error cases", () => {
    it("should not return isError in normal conditions", async () => {
      const response = parseResponse(await handleGetCurrentTime());

      expect(response.isError).toBeUndefined();
    });
  });
});
