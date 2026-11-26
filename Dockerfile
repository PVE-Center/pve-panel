# Stage 1: Build du frontend React 19 + TypeScript + Vite + Tailwind
FROM node:22-alpine AS frontend-builder
WORKDIR /build

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Runtime Python 3.12 léger (FastAPI sert l'API, WebSockets/SSE et le frontend)
FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends iputils-ping ca-certificates openssh-client git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/config

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CONFIG_PATH=/app/config/config.yaml \
    STATE_DB_PATH=/app/config/state.db \
    STATIC_DIR=/app/static \
    SERVICES_CONFIG_PATH=/app/services.yaml

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=frontend-builder /build/dist ./static

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn app.main:app --host ${LISTEN_HOST:-0.0.0.0} --port ${LISTEN_PORT:-8000} --no-proxy-headers"]
