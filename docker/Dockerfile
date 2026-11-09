ARG BUN_VERSION=1.4.4
ARG OPENCODE_VERSION=2.2.6
FROM oven/bun:${BUN_VERSION}-slim AS build

ARG OPENCODE_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN bun install -g --trust "@opencode/cli@${OPENCODE_VERSION}" \
  && opencode --version \
  && bun --version \
  && git --version \
  && rg --version \
  && curl --version

FROM build

COPY opencode.json /root/.config/opencode/opencode.json
COPY cli.json /root/.config/opencode/cli.json
COPY service.json /root/.config/opencode/service.json

WORKDIR /workspace
EXPOSE 4096
ENV OPENCODE_SERVER_PASSWORD=opencode-test
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["curl", "-sS", "-o", "/dev/null", "http://127.0.0.1:4096/"]
ENTRYPOINT ["opencode"]
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
