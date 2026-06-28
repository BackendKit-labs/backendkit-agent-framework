"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.middleware = middleware;
const server_1 = require("next/server");
const publicPaths = ['/login', '/register', '/'];
function middleware(request) {
    const token = request.cookies.get('accessToken')?.value ||
        request.headers.get('authorization')?.replace('Bearer ', '');
    const { pathname } = request.nextUrl;
    const isPublicPath = publicPaths.some(path => pathname === path || pathname.startsWith('/_next') || pathname.startsWith('/api'));
    if (isPublicPath) {
        return server_1.NextResponse.next();
    }
    if (!token && pathname.startsWith('/dashboard')) {
        return server_1.NextResponse.redirect(new URL('/login', request.url));
    }
    return server_1.NextResponse.next();
}
exports.config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
//# sourceMappingURL=middleware.js.map