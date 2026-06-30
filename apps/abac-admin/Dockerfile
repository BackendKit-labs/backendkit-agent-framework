# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY . .

ARG VITE_ABAC_API_URL=http://localhost:3005
ENV VITE_ABAC_API_URL=${VITE_ABAC_API_URL}

RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA fallback: todas las rutas sirven index.html
RUN printf 'server {\n\
    listen 3003;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3003/ || exit 1

EXPOSE 3003

CMD ["nginx", "-g", "daemon off;"]
