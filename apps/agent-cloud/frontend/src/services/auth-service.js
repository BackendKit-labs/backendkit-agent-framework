"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = void 0;
const api_1 = require("@/lib/api");
exports.authService = {
    async login(email, password) {
        return api_1.api.post('/auth/login', { email, password }, { skipAuth: true });
    },
    async register(name, email, password) {
        return api_1.api.post('/auth/register', { name, email, password }, { skipAuth: true });
    },
    async getProfile() {
        return api_1.api.get('/auth/profile');
    },
};
//# sourceMappingURL=auth-service.js.map