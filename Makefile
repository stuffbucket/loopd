# loopd Makefile
# Build, test, and release automation

# Project info
MODULE := github.com/stuffbucket/loopd
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date -u '+%Y-%m-%dT%H:%M:%SZ')

# Build settings
GO ?= go
GOFLAGS := -trimpath
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.date=$(BUILD_DATE)

# Output directories
DIST_DIR := dist
BIN_DIR := bin

# Cross-compilation targets
PLATFORMS := \
	linux/amd64 \
	linux/arm64 \
	darwin/amd64 \
	darwin/arm64 \
	windows/amd64

# ============================================================================
# Help
# ============================================================================

help: ## Show this help message
	@echo "loopd - Loop to Markdown Exporter"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

# ============================================================================
# Development targets
# ============================================================================

test: ## Run unit tests
	$(GO) test -v -race ./...

test-coverage: ## Run tests with coverage report
	$(GO) test -v -race -coverprofile=coverage.out -covermode=atomic ./...
	$(GO) tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

vet: ## Run go vet
	$(GO) vet ./...

fmt: ## Format code
	$(GO) fmt ./...
	@echo "Code formatted"

fmt-check: ## Check code formatting (for CI)
	@test -z "$$(gofmt -l .)" || (echo "Code not formatted. Run 'make fmt'" && gofmt -l . && exit 1)

check: fmt vet ## Run all checks (fmt, vet)

ci: check test ## Run full CI pipeline (check + test)
	@echo "CI passed ✓"

# ============================================================================
# Build targets
# ============================================================================

build: ## Build binary for current platform
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/loopd .
	@echo "Built: $(BIN_DIR)/loopd"

build-all: ## Build for all platforms
	@mkdir -p $(DIST_DIR)
	@for platform in $(PLATFORMS); do \
		GOOS=$${platform%/*}; \
		GOARCH=$${platform#*/}; \
		ext=""; if [ "$$GOOS" = "windows" ]; then ext=".exe"; fi; \
		output="$(DIST_DIR)/loopd-$${GOOS}-$${GOARCH}$${ext}"; \
		echo "Building $$output..."; \
		CGO_ENABLED=0 GOOS=$$GOOS GOARCH=$$GOARCH \
			$(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $$output . || exit 1; \
	done
	@echo "All builds complete in $(DIST_DIR)/"

install: ## Install to GOPATH/bin
	$(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(GOPATH)/bin/loopd .
	@echo "Installed to $(GOPATH)/bin/loopd"

clean: ## Clean build artifacts
	rm -rf $(DIST_DIR) $(BIN_DIR) coverage.out coverage.html

# ============================================================================
# Dependencies
# ============================================================================

tidy: ## Tidy and verify dependencies
	$(GO) mod tidy
	$(GO) mod verify

# ============================================================================
# Release (for maintainers)
# ============================================================================

release-dry-run: ## Test release process without publishing
	@command -v goreleaser >/dev/null 2>&1 || { echo "Install goreleaser: brew install goreleaser"; exit 1; }
	goreleaser release --snapshot --clean

release: ## Create a release (requires GITHUB_TOKEN)
	@command -v goreleaser >/dev/null 2>&1 || { echo "Install goreleaser: brew install goreleaser"; exit 1; }
	goreleaser release --clean

version: ## Show version info
	@echo "Version: $(VERSION)"
	@echo "Commit:  $(COMMIT)"
	@echo "Date:    $(BUILD_DATE)"

# ============================================================================
# Run
# ============================================================================

run: build ## Build and run
	./$(BIN_DIR)/loopd

.PHONY: help test test-coverage vet fmt fmt-check check ci \
        build build-all install clean tidy \
        release-dry-run release version run

.DEFAULT_GOAL := help
