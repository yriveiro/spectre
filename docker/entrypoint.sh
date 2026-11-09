#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
CONFIG_FILE="${CONFIG_DIR}/opencode.json"
PASSWORD_FILE="${CONFIG_DIR}/.server-password"
SERVER_USER="${OPENCODE_SERVER_USERNAME:-opencode}"

if [ "${OPENCODE_SERVER_PASSWORD+x}" = "x" ] && [ -z "${OPENCODE_SERVER_PASSWORD}" ]; then
  echo "docker-entrypoint: OPENCODE_SERVER_PASSWORD is set but empty" >&2
  exit 1
fi

mkdir -p "${CONFIG_DIR}" "$HOME/.local/share/opencode"

if [ -n "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  PASSWORD="${OPENCODE_SERVER_PASSWORD}"
  echo "docker-entrypoint: using OPENCODE_SERVER_PASSWORD from environment" >&2
elif [ -f "${PASSWORD_FILE}" ]; then
  PASSWORD="$(cat "${PASSWORD_FILE}")"
  echo "docker-entrypoint: reusing server password from ${PASSWORD_FILE}" >&2
else
  PASSWORD="$(od -vAn -tx1 -N32 /dev/urandom | tr -d ' \n')"
  printf '%s' "${PASSWORD}" > "${PASSWORD_FILE}"
  chmod 600 "${PASSWORD_FILE}"
  echo "docker-entrypoint: generated server password for user ${SERVER_USER}: ${PASSWORD}" >&2
fi
export OPENCODE_SERVER_PASSWORD="${PASSWORD}"

if [ ! -f "${CONFIG_FILE}" ] && [ ! -f "${CONFIG_DIR}/opencode.jsonc" ]; then
  cat > "${CONFIG_FILE}" <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "update": "disable"
}
EOF
  chmod 600 "${CONFIG_FILE}"
  echo "docker-entrypoint: wrote ${CONFIG_FILE}" >&2
fi

exec opencode "$@"
