import { basename } from "node:path";

export const FIELD_LIMITS = {
  target: 120,
  fixedInVersion: 80,
  tried: 300,
  expected: 300,
  actual: 350,
  suggestedFix: 350,
  workaround: 350,
  context: 250,
  resolution: 350,
  repo: 80,
} as const;

const REDACTED_GUARD = String.raw`(?!\[REDACTED(?:_[A-Z]+)?\])`;
const SENSITIVE_KEY_NAME =
  "(?:[A-Za-z0-9]+[._-]){0,4}(?:api[_-]?key|apikey|access[_-]?key(?:[_-]?id)?|private[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|authorization|auth|cookie|bearer|password|passwd|pwd|secret|token|pat|credential|credentials)";
const SENSITIVE_KEY_ASSIGN =
  String.raw`(?:\\"${SENSITIVE_KEY_NAME}\\"|"${SENSITIVE_KEY_NAME}"|'${SENSITIVE_KEY_NAME}'|` +
  "`" +
  SENSITIVE_KEY_NAME +
  "`" +
  String.raw`|\b${SENSITIVE_KEY_NAME}\b)\s*[:=]\s*`;

const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@:]+(?::[^/\s@]*)?)@/g;
const SECRET_QUERY_PARAM =
  /([?&](?:token|access_token|refresh_token|api_key|apikey|access_key|private_key|client_secret|authorization|bearer|cookie|key|secret|sig|signature|auth|password|passwd|pwd|jwt)=)(?!\[REDACTED(?:_[A-Z]+)?\])[^&\s"'`<>]+/gi;
const AUTH_HEADER =
  /((?:\\?"|'|`)?\bAuthorization(?:\\?"|'|`)?\s*:\s*(?:\\?"|'|`)?(?:Bearer|Basic|Token)\s+)(?!\[REDACTED(?:_[A-Z]+)?\])[^\s"'`,;}\]\\]+/gi;
const BEARER_OR_BASIC = /(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const GITHUB_CLASSIC_TOKEN = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/g;
const GITHUB_FINE_PAT = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
const SK_API_KEY = /\bsk-(?:proj-|ant-[a-z0-9-]+-)?[A-Za-z0-9_-]{16,}\b/g;
const STRIPE_API_KEY = /\b(?:pk|rk|sk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g;
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g;
const NPM_TOKEN = /\bnpm_[A-Za-z0-9]{20,}\b/g;
const PYPI_TOKEN = /\bpypi-[A-Za-z0-9_-]{20,}\b/g;
const GOOGLE_API_KEY = /\bAIza[0-9A-Za-z_-]{20,}\b/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const JSON_ESCAPED_QUOTED_SECRET = new RegExp(
  String.raw`(${SENSITIVE_KEY_ASSIGN}\\")${REDACTED_GUARD}(?!(?:Bearer|Basic|Token)\s+\[REDACTED(?:_[A-Z]+)?\]\\")(?:[^\\"]|\\\\\\\\|\\\\\\"|\\\\[^\\"]|\\[^\\"])+(\\")`,
  "gi",
);
const DOUBLE_QUOTED_SECRET = new RegExp(
  String.raw`(${SENSITIVE_KEY_ASSIGN}")${REDACTED_GUARD}(?!(?:Bearer|Basic|Token)\s+\[REDACTED(?:_[A-Z]+)?\]")(?:[^"\\]|\\.)+(")`,
  "gi",
);
const SINGLE_QUOTED_SECRET = new RegExp(
  String.raw`(${SENSITIVE_KEY_ASSIGN}')${REDACTED_GUARD}(?!(?:Bearer|Basic|Token)\s+\[REDACTED(?:_[A-Z]+)?\]')(?:[^'\\]|\\.)+(')`,
  "gi",
);
const UNQUOTED_COOKIE_SECRET = new RegExp(
  String.raw`(\b(?:Set-)?Cookie\s*:\s*)${REDACTED_GUARD}(?!["']|\\")[^\s"',;}\]]+(?:\s*;\s*[^\s"',;}\]]+)*`,
  "gi",
);
const UNQUOTED_KEY_VALUE_SECRET = new RegExp(
  String.raw`(${SENSITIVE_KEY_ASSIGN})${REDACTED_GUARD}(?!\\")(?!(?:Bearer|Basic|Token)\s+\[REDACTED(?:_[A-Z]+)?\])(?!(?:null|true|false|undefined)(?=[\s,}\]\)]|$))[^\s"'` +
    "`" +
    String.raw`,;}\]{[\]]{3,}`,
  "gi",
);
const EMAIL_ADDRESS = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const POSIX_HOME_PATH = /(?:file:\/\/)?\/(?:Users|home)\/[^/\s"'`<>]+(?:\/[^\s"'`<>]*)?/g;
const WINDOWS_HOME_PATH = /[A-Za-z]:\\Users\\[^\s"'`<>]+/g;

const stripControlChars = (input: string): string => {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    const keepWhitespace = code === 9 || code === 10 || code === 13;
    if ((code >= 32 && code !== 127) || keepWhitespace) {
      out += input[i];
    }
  }
  return out;
};

export const clipSafe = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  const budget = Math.max(1, maxChars - 1);
  let cut = budget;
  const lastCode = text.charCodeAt(cut - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    cut = Math.max(1, cut - 1);
  }
  return `${text.slice(0, cut)}…`;
};

export const redactText = (raw: string, maxChars: number): string => {
  const scrubbed = stripControlChars(
    raw
      .replace(PEM_PRIVATE_KEY, "[REDACTED_KEY]")
      .replace(URL_CREDENTIALS, "$1[REDACTED_CREDS]@")
      .replace(SECRET_QUERY_PARAM, "$1[REDACTED]")
      .replace(AUTH_HEADER, "$1[REDACTED_AUTH]")
      .replace(BEARER_OR_BASIC, "$1[REDACTED_AUTH]")
      .replace(GITHUB_CLASSIC_TOKEN, "[REDACTED_TOKEN]")
      .replace(GITHUB_FINE_PAT, "[REDACTED_TOKEN]")
      .replace(SK_API_KEY, "[REDACTED_TOKEN]")
      .replace(STRIPE_API_KEY, "[REDACTED_TOKEN]")
      .replace(SLACK_TOKEN, "[REDACTED_TOKEN]")
      .replace(NPM_TOKEN, "[REDACTED_TOKEN]")
      .replace(PYPI_TOKEN, "[REDACTED_TOKEN]")
      .replace(GOOGLE_API_KEY, "[REDACTED_TOKEN]")
      .replace(AWS_ACCESS_KEY, "[REDACTED_TOKEN]")
      .replace(JWT_TOKEN, "[REDACTED_TOKEN]")
      .replace(JSON_ESCAPED_QUOTED_SECRET, "$1[REDACTED]$2")
      .replace(DOUBLE_QUOTED_SECRET, "$1[REDACTED]$2")
      .replace(SINGLE_QUOTED_SECRET, "$1[REDACTED]$2")
      .replace(UNQUOTED_COOKIE_SECRET, "$1[REDACTED]")
      .replace(UNQUOTED_KEY_VALUE_SECRET, "$1[REDACTED]")
      .replace(EMAIL_ADDRESS, "[REDACTED_EMAIL]")
      .replace(POSIX_HOME_PATH, "[REDACTED_PATH]")
      .replace(WINDOWS_HOME_PATH, "[REDACTED_PATH]"),
  )
    .replace(/\s+/g, " ")
    .trim();
  return clipSafe(scrubbed, maxChars);
};

export const redactOptional = (raw: string | undefined, maxChars: number): string | undefined => {
  if (raw === undefined) return undefined;
  const cleaned = redactText(raw, maxChars);
  if (cleaned.length === 0) return undefined;
  return cleaned;
};

export const sanitizeRepoName = (canonicalPath: string): string => {
  const base = basename(canonicalPath);
  const cleaned = redactText(base, FIELD_LIMITS.repo);
  if (cleaned.length === 0 || cleaned === "." || cleaned === "/") return "unknown";
  return cleaned;
};

export const escapeUntrusted = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const escapeOptional = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : escapeUntrusted(text);

export const sanitizeDisplay = (text: string, maxChars: number): string =>
  escapeUntrusted(redactText(text, maxChars));

export const sanitizeDisplayOptional = (
  text: string | undefined,
  maxChars: number,
): string | undefined => escapeOptional(redactOptional(text, maxChars));

export const fenceUntrusted = (escapedBody: string): string =>
  `<UNTRUSTED_CONTENT>\n${escapedBody}\n</UNTRUSTED_CONTENT>`;
