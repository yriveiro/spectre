ARG BUN_VERSION=1.4.4
ARG OPENCODE_VERSION=2.2.6
FROM oven/bun:${BUN_VERSION}-slim AS build

ARG OPENCODE_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN bun install -g --trust "@opencode/cli@${OPENCODE_VERSION}" \
  && mkdir -p /opt/dist \
  && cp "$(readlink -f /usr/local/bin/opencode)" /opt/dist/opencode \
  && /opt/dist/opencode --version \
  && bun --version \
  && git --version \
  && rg --version \
  && curl --version
COPY entrypoint.sh /opt/dist/entrypoint.sh

FROM oven/bun:${BUN_VERSION}-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/dist/opencode /usr/local/bin/opencode
COPY --from=build /opt/dist/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && opencode --version

WORKDIR /workspace
EXPOSE 4096
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["curl", "-sS", "-o", "/dev/null", "http://127.0.0.1:4096/"]
ENTRYPOINT ["entrypoint.sh"]
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
