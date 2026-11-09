ARG BUN_VERSION=1.4.4
ARG OPENCODE_VERSION=2.2.6
ARG APT_DEPS="ca-certificates curl git ripgrep"
FROM oven/bun:${BUN_VERSION}-slim AS deps

ARG APT_DEPS
ARG OPENCODE_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends ${APT_DEPS} \
  && rm -rf /var/lib/apt/lists/*
RUN bun install -g --trust "@opencode/cli@${OPENCODE_VERSION}" \
  && mkdir -p /opt/dist \
  && cp "$(readlink -f /usr/local/bin/opencode)" /opt/dist/opencode \
  && /opt/dist/opencode --version \
  && bun --version \
  && git --version \
  && rg --version \
  && curl --version

FROM oven/bun:${BUN_VERSION}-slim

ARG APT_DEPS
RUN apt-get update \
  && apt-get install -y --no-install-recommends ${APT_DEPS} \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /opt/dist/opencode /usr/local/bin/opencode
RUN opencode --version

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace
EXPOSE 4096
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["curl", "-sS", "-o", "/dev/null", "http://127.0.0.1:4096/"]
ENTRYPOINT ["entrypoint.sh"]
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
