interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    skipAuth?: boolean;
}
declare class ApiError extends Error {
    status: number;
    constructor(message: string, status: number);
}
export declare const api: {
    get: <T>(endpoint: string, options?: RequestOptions) => Promise<T>;
    post: <T>(endpoint: string, body?: unknown, options?: RequestOptions) => Promise<T>;
    patch: <T>(endpoint: string, body?: unknown, options?: RequestOptions) => Promise<T>;
    delete: <T>(endpoint: string, options?: RequestOptions) => Promise<T>;
};
export { ApiError };
