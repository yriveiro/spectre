DOCKERFILE := docker/Dockerfile

BUN_VERSION ?= 1.4.4
OPENCODE_VERSION ?= 2.2.6
IMAGE ?= spectre:$(OPENCODE_VERSION)

.PHONY: image
image:
	docker build \
	  --build-arg BUN_VERSION=$(BUN_VERSION) \
	  --build-arg OPENCODE_VERSION=$(OPENCODE_VERSION) \
	  --tag $(IMAGE) \
	  docker
