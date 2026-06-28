import { handleGetUserTimezone } from "../../../src/tools/get-user-timezone.js";

// ─── Helpers ─────────────────────────────────────────────────────

function buildPrompt(args: Record<string, unknown>): string {
  return `get_user_timezone ${JSON.stringify(args)}`;
}

function parseResponse(response: string): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  return JSON.parse(response);
}

// ─── Tests ───────────────────────────────────────────────────────

describe("get_user_timezone tool handler", () => {
  describe("success cases", () => {
    it("should return the correct userId", async () => {
      const prompt = buildPrompt({ userId: "user-123" });
      const response = parseResponse(await handleGetUserTimezone(prompt));

      expect(response.content[0].type).toBe("text");
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.userId).toBe("user-123");
    });

    it("should return a non-empty timezone string", async () => {
      const prompt = buildPrompt({ userId: "user-123" });
      const response = parseResponse(await handleGetUserTimezone(prompt));

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.timezone).toBeDefined();
      expect(typeof parsed.timezone).toBe("string");
      expect(parsed.timezone.length).toBeGreaterThan(0);
    });

    it("should return offset in +HH:mm or -HH:mm format", async () => {
      const prompt = buildPrompt({ userId: "user-123" });
      const response = parseResponse(await handleGetUserTimezone(prompt));

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.offset).toBeDefined();
      expect(typeof parsed.offset).toBe("string");
      expect(parsed.offset).toMatch(/^[+-]\d{2}:\d{2}$/);
    });

    it("should return iana matching timezone", async () => {
      const prompt = buildPrompt({ userId: "user-123" });
      const response = parseResponse(await handleGetUserTimezone(prompt));

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.iana).toBeDefined();
      expect(typeof parsed.iana).toBe("string");
      // iana should match timezone (both come from Intl.DateTimeFormat)
      expect(parsed.iana).toBe(parsed.timezone);
    });

    it("should return all four fields in the response", async () => {
      const prompt = buildPrompt({ userId: "user-123" });
      const response = parseResponse(await handleGetUserTimezone(prompt));

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toHaveProperty("userId");
      expect(parsed).toHaveProperty("timezone");
      expect(parsed).toHaveProperty("offset");
      expect(parsed).toHaveProperty("iana");
    });

    it("should work with any valid userId string", async () => {
      const prompt = buildPrompt({ userId: "alice@example.com" });
      const response = parseResponse(await handleGetUserTimezone(prompt));

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.userId).toBe("alice@example.com");
      expect(parsed.timezone).toBeDefined();
    });
  });

  describe("error cases", () => {
    it("should reject empty userId with isError=true", async () => {
      const prompt = buildPrompt({ userId: "" });
      const response = parseResponse(await handleGetUserTimezone(prompt));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
      expect(response.content[0].text).toContain("userId");
    });

    it("should reject missing userId with isError=true", async () => {
      const prompt = buildPrompt({});
      const response = parseResponse(await handleGetUserTimezone(prompt));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });

    it("should not return isError with valid userId", async () => {
      const prompt = buildPrompt({ userId: "user-valid" });
      const response = parseResponse(await handleGetUserTimezone(prompt));

      expect(response.isError).toBeUndefined();
    });
  });
});
