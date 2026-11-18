# Contributing to PVE Command Center (`pve-panel`)

Thank you for helping improve **PVE Command Center**! This repository contains the core **FastAPI server**, **declarative YAML configuration engine**, **SQLite AlertEngine**, **embedded Liquid Glass Web UI**, **Dockerfile**, and **Proxmox LXC / Linux installer (`install.sh`)**.

## Ecosystem Map

Issues and pull requests should target the repository that owns the component:

| Repository | Scope |
|---|---|
| [`PVE-Center/pve-panel`](https://github.com/PVE-Center/pve-panel) | Core FastAPI backend, embedded React Web UI, Docker image, `install.sh` |
| [`PVE-Center/pve-center-apple`](https://github.com/PVE-Center/pve-center-apple) | Native Swift 6 / SwiftUI apps for iOS, iPadOS, macOS, and tvOS |
| [`PVE-Center/pve-center-clients`](https://github.com/PVE-Center/pve-center-clients) | Cross-platform desktop (Windows/Linux via Tauri v2) and Android (Capacitor 8) clients |
| [`PVE-Center/pve-center-website`](https://github.com/PVE-Center/pve-center-website) | Official VitePress website and full bilingual documentation portal |

## Development Setup

### Prerequisites

- **Python 3.12+**
- **Node.js 22+** and **npm**
- **Docker** (optional, for testing the multi-stage container build)

### 1. Backend (FastAPI + pytest)

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt ruff

# Run backend locally with loopback dev auth bypass (never use in production)
DEV_AUTH_BYPASS=true uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

### 2. Frontend (React 19 + TypeScript + Vite)

```bash
cd frontend
npm ci
npm run dev    # Vite dev server with /api proxy to http://127.0.0.1:8000
npm run build  # TypeScript check (tsc -b) + Vite production bundle into frontend/dist/
```

## Code Standards & Verification

- Formatting defaults are defined in [`.editorconfig`](.editorconfig) and [`pyproject.toml`](pyproject.toml).
- Python code targets **Python 3.12**, uses type annotations (`from __future__ import annotations`), concise docstrings, and passes `ruff check backend`.
- Frontend code uses strict TypeScript (`tsconfig.json`) with zero compiler warnings/errors.
- Before opening a Pull Request, verify everything locally:

```bash
# Backend lint, syntax & test suite
ruff check backend
python -m compileall -q backend/app backend/tests
pytest -v

# Frontend typecheck & production build
cd frontend && npx tsc --noEmit && npm run build && cd ..

# Shell installer syntax
bash -n install.sh
```

## Pull Request Workflow

1. Fork the repository and create a topic branch from `main` (e.g., `feat/my-connector`, `fix/alert-cooldown`).
2. Keep commits focused and follow Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `refactor:`).
3. Update both English and French documentation (`README.md`, `README.fr.md`, `docs/en/`, `docs/fr/`) when adding or changing API routes, environment variables, or `config.yaml` schema options.
4. Ensure you never commit secrets, `.env`, `config/config.yaml`, `services.yaml`, `*.db`, or `*.p8` files.
5. Fill out [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) when opening your PR.

## Community Standards

All contributors are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).
