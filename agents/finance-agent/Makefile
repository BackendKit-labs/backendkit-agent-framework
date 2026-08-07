# ============================================================
# Finance Agent — Makefile
# ============================================================
# Common tasks for development, testing, and deployment.
# Usage: make <target>

.PHONY: help install build test lint clean dev docker-build docker-up docker-down k8s-apply k8s-delete

# Default target
help:
	@echo "Finance Agent — Makefile"
	@echo ""
	@echo "Development:"
	@echo "  make install       Install dependencies"
	@echo "  make dev           Start development server"
	@echo "  make build         Build TypeScript"
	@echo "  make test          Run tests"
	@echo "  make test:watch    Run tests in watch mode"
	@echo "  make test:coverage Run tests with coverage"
	@echo "  make lint          Run linter"
	@echo "  make clean         Remove dist/ and node_modules"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build  Build Docker image"
	@echo "  make docker-up     Start all services (docker compose up)"
	@echo "  make docker-down   Stop all services"
	@echo "  make docker-logs   Tail logs"
	@echo ""
	@echo "Kubernetes:"
	@echo "  make k8s-apply     Apply all k8s manifests"
	@echo "  make k8s-delete    Delete all k8s resources"
	@echo "  make k8s-status    Check deployment status"
	@echo ""

# --- Development ---

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

test:
	npm test

test-watch:
	npm run test:watch

test-coverage:
	npm run test:coverage

lint:
	npm run lint

clean:
	rm -rf dist/ coverage/ node_modules/
	rm -rf frontend/.next frontend/node_modules/

# --- Docker ---

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-restart: docker-down docker-up

# --- Kubernetes ---

k8s-apply:
	kubectl apply -f k8s/ --namespace=finance

k8s-delete:
	kubectl delete -f k8s/ --namespace=finance

k8s-status:
	kubectl rollout status deployment/finance-agent --namespace=finance --timeout=60s
	kubectl get pods --namespace=finance -o wide
	kubectl get svc --namespace=finance
	kubectl get hpa --namespace=finance

k8s-logs:
	kubectl logs -l app=finance-agent --namespace=finance --tail=100 -f

k8s-restart:
	kubectl rollout restart deployment/finance-agent --namespace=finance
