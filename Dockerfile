FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_BASE_PATH=/legal/
ARG VITE_API_BASE_URL=/legal-api
ARG VITE_AUTH_LOGIN_URL=/access
ARG VITE_CSRF_COOKIE_NAME=legal_csrf
ARG VITE_DEV_AUTH_ENABLED=false

ENV VITE_BASE_PATH=${VITE_BASE_PATH} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_AUTH_LOGIN_URL=${VITE_AUTH_LOGIN_URL} \
    VITE_CSRF_COOKIE_NAME=${VITE_CSRF_COOKIE_NAME} \
    VITE_DEV_AUTH_ENABLED=${VITE_DEV_AUTH_ENABLED}

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm test && npm run build

FROM nginx:1.27-alpine
ENV PORT=8080
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
