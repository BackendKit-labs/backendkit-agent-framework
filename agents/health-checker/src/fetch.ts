// ---------------------------------------------------------------------------
// Helper compartido: fetch con timeout
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 5000;

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}
