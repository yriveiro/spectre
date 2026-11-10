DOCKERFILE := docker/Dockerfile

BUN_VERSION ?= 1.4.4
OPENCODE_VERSION ?= 2.2.6
IMAGE ?= spectre:$(OPENCODE_VERSION)

CONTAINER ?= opencode-test
PORT ?= 14096
SERVER_PASSWORD ?= opencode-test

.PHONY: image run
image:
	docker build \
	  --build-arg BUN_VERSION=$(BUN_VERSION) \
	  --build-arg OPENCODE_VERSION=$(OPENCODE_VERSION) \
	  --tag $(IMAGE) \
	  docker

run: image
	@set -e; \
	dir=$$(mktemp -d "$${TMPDIR:-/tmp}/opencode-workspace.XXXXXX"); \
	dir=$$(cd "$$dir" && pwd -P); \
	trap 'rm -rf "$$dir"' EXIT INT TERM; \
	echo "workspace: $$dir"; \
	echo "client: cd $$dir && OPENCODE_SERVER_PASSWORD=$(SERVER_PASSWORD) opencode --server http://127.0.0.1:$(PORT)"; \
	docker run --rm \
	  --name $(CONTAINER) \
	  --workdir "$$dir" \
	  -p $(PORT):14096 \
	  -e OPENCODE_SERVER_PASSWORD=$(SERVER_PASSWORD) \
	  -v "$$dir:$$dir" \
	  $(IMAGE)
