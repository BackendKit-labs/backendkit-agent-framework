// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — API Client
// Thin fetch wrapper for the backend endpoints:
//   /health, /api/query, /api/config, /api/reports
//
// Every public function returns a typed Result-like shape so callers can
// handle success / error uniformly without try/catch at every callsite.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ApiResponse,
  CompanyConfig,
  ReportRequest,
  ReportResult,
} from "./types";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Configuration
// ═════════════════════════════════════════════════════════════════════════

/**
 * Base URL for the backend API.
 * Falls back to "http://localhost:3001" when the env var is not set.
 */
const BASE_URL: string =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/** Default request timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 10_000;

// ═════════════════════════════════════════════════════════════════════════
// 2.  Internal helpers
// ═════════════════════════════════════════════════════════════════════════

/* ─── Error shape returned by every function ────────────────────────── */

export interface ApiError {
  /** Human-readable error message */
  message: string;
  /** HTTP status code (0 if the request never reached the server) */
  status: number;
  /** Optional raw server error payload */
  raw?: unknown;
}

/* ─── Result union returned by every function ───────────────────────── */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

/* ─── Timeout-aware fetch ───────────────────────────────────────────── */

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Build full URL ────────────────────────────────────────────────── */

function buildUrl(path: string, searchParams?: Record<string, string>): string {
  const url = new URL(path, BASE_URL);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/* ─── Parse JSON safely ─────────────────────────────────────────────── */

async function parseJson<T>(response: Response): Promise<ApiResult<T>> {
  try {
    const body = (await response.json()) as T;
    return { ok: true, data: body };
  } catch (err) {
    return {
      ok: false,
      error: {
        message: `Failed to parse JSON response: ${(err as Error).message}`,
        status: response.status,
      },
    };
  }
}

/* ─── Handle non-2xx responses ──────────────────────────────────────── */

async function handleHttpError(response: Response): Promise<ApiError> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    raw = await response.text().catch(() => undefined);
  }

  const message =
    typeof raw === "object" && raw !== null && "error" in raw
      ? String((raw as Record<string, unknown>).error)
      : `Request failed with status ${response.status}`;

  return { message, status: response.status, raw };
}

// ═════════════════════════════════════════════════════════════════════════
// 3.  Public API functions
// ═════════════════════════════════════════════════════════════════════════

/* ─── 3.1  Health check ─────────────────────────────────────────────── */

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  uptime: number;
  version: string;
  timestamp: string;
}

/**
 * GET /health
 * Returns the backend's health status.
 */
export async function getHealth(): Promise<ApiResult<HealthStatus>> {
  const url = buildUrl("/health");

  try {
    const response = await fetchWithTimeout(url, { method: "GET" });

    if (!response.ok) {
      return { ok: false, error: await handleHttpError(response) };
    }

    return parseJson<HealthStatus>(response);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Health check timed out"
        : (err as Error).message;
    return { ok: false, error: { message, status: 0 } };
  }
}

/* ─── 3.2  Query endpoint ───────────────────────────────────────────── */

export interface QueryRequest {
  /** Natural-language query or structured command */
  query: string;
  /** Optional period filter (e.g. "2025-01", "2025-Q1") */
  period?: string;
  /** Optional tool name to scope the query */
  tool?: string;
}

export interface QueryResponse {
  /** The tool that handled the query */
  tool: string;
  /** Structured result data */
  result: unknown;
  /** Human-readable explanation */
  explanation: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
}

/**
 * POST /api/query
 * Sends a natural-language or structured query to the backend engine.
 */
export async function postQuery(
  body: QueryRequest,
): Promise<ApiResult<ApiResponse<QueryResponse>>> {
  const url = buildUrl("/api/query");

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { ok: false, error: await handleHttpError(response) };
    }

    return parseJson<ApiResponse<QueryResponse>>(response);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Query request timed out"
        : (err as Error).message;
    return { ok: false, error: { message, status: 0 } };
  }
}

/* ─── 3.3  Config endpoint ──────────────────────────────────────────── */

/**
 * GET /api/config
 * Returns the current company configuration.
 */
export async function getConfig(): Promise<
  ApiResult<ApiResponse<CompanyConfig>>
> {
  const url = buildUrl("/api/config");

  try {
    const response = await fetchWithTimeout(url, { method: "GET" });

    if (!response.ok) {
      return { ok: false, error: await handleHttpError(response) };
    }

    return parseJson<ApiResponse<CompanyConfig>>(response);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Config request timed out"
        : (err as Error).message;
    return { ok: false, error: { message, status: 0 } };
  }
}

/**
 * PUT /api/config
 * Updates the company configuration.
 */
export async function updateConfig(
  config: Partial<CompanyConfig>,
): Promise<ApiResult<ApiResponse<CompanyConfig>>> {
  const url = buildUrl("/api/config");

  try {
    const response = await fetchWithTimeout(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      return { ok: false, error: await handleHttpError(response) };
    }

    return parseJson<ApiResponse<CompanyConfig>>(response);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Config update timed out"
        : (err as Error).message;
    return { ok: false, error: { message, status: 0 } };
  }
}

/* ─── 3.4  Reports endpoint ─────────────────────────────────────────── */

/**
 * POST /api/reports
 * Generates a financial report based on the given request.
 */
export async function postReport(
  body: ReportRequest,
): Promise<ApiResult<ApiResponse<ReportResult>>> {
  const url = buildUrl("/api/reports");

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { ok: false, error: await handleHttpError(response) };
    }

    return parseJson<ApiResponse<ReportResult>>(response);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Report request timed out"
        : (err as Error).message;
    return { ok: false, error: { message, status: 0 } };
  }
}

/**
 * GET /api/reports?status=...
 * Lists previously generated reports, optionally filtered by status.
 */
export async function listReports(
  params?: { status?: string; limit?: number; offset?: number },
): Promise<ApiResult<ApiResponse<ReportResult[]>>> {
  const searchParams: Record<string, string> = {};
  if (params?.status) searchParams.status = params.status;
  if (params?.limit !== undefined) searchParams.limit = String(params.limit);
  if (params?.offset !== undefined) searchParams.offset = String(params.offset);

  const url = buildUrl("/api/reports", searchParams);

  try {
    const response = await fetchWithTimeout(url, { method: "GET" });

    if (!response.ok) {
      return { ok: false, error: await handleHttpError(response) };
    }

    return parseJson<ApiResponse<ReportResult[]>>(response);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "List reports request timed out"
        : (err as Error).message;
    return { ok: false, error: { message, status: 0 } };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// 4.  Convenience: typed helpers for common patterns
// ═════════════════════════════════════════════════════════════════════════

/**
 * Unwraps an ApiResult, throwing if it's an error.
 * Useful in server components or `use` contexts where you want exceptions.
 *
 * @example
 * ```ts
 * const { data } = unwrap(await getHealth());
 * ```
 */
export function unwrap<T>(result: ApiResult<T>): { data: T } {
  if (result.ok) {
    return { data: result.data };
  }
  /* result is narrowed to { ok: false; error: ApiError } by the return above */
  throw new Error((result as { ok: false; error: ApiError }).error.message);
}
