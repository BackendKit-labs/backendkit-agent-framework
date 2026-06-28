"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = exports.api = void 0;
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}
exports.ApiError = ApiError;
async function getAuthToken() {
    if (typeof window === 'undefined')
        return null;
    return localStorage.getItem('accessToken');
}
async function request(endpoint, options = {}) {
    const { method = 'GET', headers = {}, body, skipAuth = false } = options;
    const requestHeaders = {
        'Content-Type': 'application/json',
        ...headers,
    };
    if (!skipAuth) {
        const token = await getAuthToken();
        if (token) {
            requestHeaders['Authorization'] = `Bearer ${token}`;
        }
    }
    const config = {
        method,
        headers: requestHeaders,
    };
    if (body && method !== 'GET') {
        config.body = JSON.stringify(body);
    }
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'An error occurred' }));
        throw new ApiError(errorData.message || `HTTP ${response.status}`, response.status);
    }
    if (response.status === 204) {
        return undefined;
    }
    return response.json();
}
exports.api = {
    get: (endpoint, options) => request(endpoint, { ...options, method: 'GET' }),
    post: (endpoint, body, options) => request(endpoint, { ...options, method: 'POST', body }),
    patch: (endpoint, body, options) => request(endpoint, { ...options, method: 'PATCH', body }),
    delete: (endpoint, options) => request(endpoint, { ...options, method: 'DELETE' }),
};
//# sourceMappingURL=api.js.map