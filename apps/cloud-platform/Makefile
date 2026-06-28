.PHONY: help build run test lint clean docker-build agent-image docker-up docker-down k8s-deploy k8s-delete

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build the application
	npm run build

run: ## Run the application in development mode
	npm run start:dev

test: ## Run tests
	npm test

lint: ## Run linter
	npm run lint

clean: ## Clean build artifacts
	rm -rf dist/
	rm -rf coverage/

docker-build: ## Build Docker image
	docker build -t cloud-platform-backend:latest .

agent-image: ## Build the reference agent image (agent-runtime:latest)
	docker build -t agent-runtime:latest docker/agent-runtime

docker-up: ## Start Docker Compose services
	docker-compose up -d

docker-down: ## Stop Docker Compose services
	docker-compose down

docker-logs: ## View Docker Compose logs
	docker-compose logs -f

k8s-deploy: ## Deploy to Kubernetes
	kubectl apply -k k8s/

k8s-delete: ## Delete Kubernetes resources
	kubectl delete -k k8s/

k8s-status: ## Check Kubernetes deployment status
	kubectl get all -n cloud-platform