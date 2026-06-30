const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  skipAuth?: boolean;
  params?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(endpoint: string, params?: RequestOptions['params']): string {
  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    }
    const queryString = query.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }
  return url;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, skipAuth = false, params } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (!skipAuth) {
    const token = await getAuthToken();
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }
  }

  const config: RequestInit = {
    method,
    headers: requestHeaders,
  };

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(endpoint, params), config);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'An error occurred' }));
    throw new ApiError(errorData.message || `HTTP ${response.status}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'POST', body }),

  patch: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'PATCH', body }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),
};

export { ApiError };