# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve
# Use node:alpine so we can run both nginx and the WebDAV proxy in one container.
FROM node:20-alpine
RUN apk add --no-cache nginx
WORKDIR /app
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY proxy/server.js proxy/ssrfGuard.js proxy/package.json ./proxy/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 80
CMD ["./docker-entrypoint.sh"]
