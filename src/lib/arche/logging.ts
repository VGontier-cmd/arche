export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogService = "cli" | "server" | "worker";
export type LogComponent =
  | "api"
  | "bootstrap"
  | "cli"
  | "git"
  | "http"
  | "jira"
  | "provider"
  | "sandbox"
  | "worker_loop";

type ProcessLogFields = {
  requestId?: string;
  runId?: string;
  ticketKey?: string;
  repoName?: string;
  event?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
};

type ProcessLogPayload = {
  ts: string;
  level: LogLevel;
  service: LogService;
  component: LogComponent;
  msg: string;
  request_id?: string;
  run_id?: string;
  ticket_key?: string;
  repo_name?: string;
  event?: string;
  error_code?: string;
  details?: Record<string, unknown>;
};

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getLogLevel(): LogLevel {
  const value = process.env.ARCHE_LOG_LEVEL;
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

const envSecretNamePattern = /^[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*$/;
const secretFieldPattern =
  /^(token|secret|password|apiKey|accessToken|refreshToken|authorization|authHeader)$/i;
const genericSecretPatterns: Array<[RegExp, string]> = [
  [/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]"],
  [/(Basic\s+)[^\s"']+/gi, "$1[REDACTED]"],
  [/(PRIVATE-TOKEN:\s*)[^\s"']+/gi, "$1[REDACTED]"],
  [/([A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*=)[^\s"']+/gi, "$1[REDACTED]"],
];

export function createLogger(options: {
  service: LogService;
  stream?: NodeJS.WritableStream;
}) {
  const stream = options.stream ?? process.stdout;

  function log(level: LogLevel, component: LogComponent, msg: string, fields: ProcessLogFields = {}) {
    if (levelOrder[level] < levelOrder[getLogLevel()]) {
      return;
    }

    const payload = redactObject({
      ts: new Date().toISOString(),
      level,
      service: options.service,
      component,
      msg,
      ...(fields.requestId ? { request_id: fields.requestId } : {}),
      ...(fields.runId ? { run_id: fields.runId } : {}),
      ...(fields.ticketKey ? { ticket_key: fields.ticketKey } : {}),
      ...(fields.repoName ? { repo_name: fields.repoName } : {}),
      ...(fields.event ? { event: fields.event } : {}),
      ...(fields.errorCode ? { error_code: fields.errorCode } : {}),
      ...(fields.details ? { details: fields.details } : {}),
    }) as ProcessLogPayload;

    stream.write(`${formatPrettyLog(payload, stream)}\n`);
  }

  return {
    debug(component: LogComponent, msg: string, fields?: ProcessLogFields) {
      log("debug", component, msg, fields);
    },
    info(component: LogComponent, msg: string, fields?: ProcessLogFields) {
      log("info", component, msg, fields);
    },
    warn(component: LogComponent, msg: string, fields?: ProcessLogFields) {
      log("warn", component, msg, fields);
    },
    error(component: LogComponent, msg: string, fields?: ProcessLogFields) {
      log("error", component, msg, fields);
    },
  };
}

function formatPrettyLog(payload: ProcessLogPayload, stream: NodeJS.WritableStream) {
  const color = createColorizer(stream);
  const timestamp = formatTimestamp(payload.ts);
  const level = color.level(padLevel(payload.level));
  const scope = color.scope(`${payload.service}/${payload.component}`);
  const event = payload.event ? color.event(payload.event) : "";
  const message = redactText(payload.msg);

  const contextTokens = [
    payload.request_id ? `request=${payload.request_id}` : null,
    payload.run_id ? `run=${payload.run_id}` : null,
    payload.ticket_key ? `ticket=${payload.ticket_key}` : null,
    payload.repo_name ? `repo=${payload.repo_name}` : null,
    payload.error_code ? `code=${payload.error_code}` : null,
  ].filter((value): value is string => Boolean(value));

  const inlineDetails = formatInlineDetails(payload.details);
  if (inlineDetails) {
    contextTokens.push(inlineDetails);
  }

  const head = [
    color.timestamp(timestamp),
    level,
    scope,
    event,
    message,
    contextTokens.length > 0 ? color.meta(contextTokens.join(" ")) : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  const detailBlock = formatDetailBlock(payload.details);
  if (!detailBlock) {
    return head;
  }

  return `${head}\n${detailBlock}`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(11, 19);
}

function padLevel(level: LogLevel) {
  return level.toUpperCase().padEnd(5, " ");
}

function formatInlineDetails(details?: Record<string, unknown>) {
  if (!details) {
    return "";
  }

  return Object.entries(details)
    .filter(([, value]) => isInlineValue(value))
    .map(([key, value]) => `${key}=${formatInlineValue(value)}`)
    .join(" ");
}

function formatDetailBlock(details?: Record<string, unknown>) {
  if (!details) {
    return "";
  }

  const complexEntries = Object.fromEntries(
    Object.entries(details).filter(([, value]) => !isInlineValue(value)),
  );

  if (Object.keys(complexEntries).length === 0) {
    return "";
  }

  const serialized = JSON.stringify(complexEntries, null, 2) ?? "";
  return serialized
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function isInlineValue(value: unknown) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatInlineValue(value: unknown) {
  if (value === null) {
    return "null";
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function createColorizer(stream: NodeJS.WritableStream) {
  const enabled = isTtyStream(stream) && process.env.NO_COLOR === undefined;

  const apply = (code: string, value: string) => (enabled ? `\u001B[${code}m${value}\u001B[0m` : value);

  return {
    timestamp(value: string) {
      return apply("90", value);
    },
    level(value: string) {
      if (value.startsWith("DEBUG")) return apply("36", value);
      if (value.startsWith("INFO")) return apply("32", value);
      if (value.startsWith("WARN")) return apply("33", value);
      return apply("31", value);
    },
    scope(value: string) {
      return apply("1", value);
    },
    event(value: string) {
      return apply("35", value);
    },
    meta(value: string) {
      return apply("90", value);
    },
  };
}

function isTtyStream(stream: NodeJS.WritableStream) {
  return Boolean((stream as NodeJS.WritableStream & { isTTY?: boolean }).isTTY);
}

export function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

export function redactText(value: string) {
  let output = value;
  for (const secret of collectSecretValues()) {
    output = output.split(secret).join("[REDACTED]");
  }
  for (const [pattern, replacement] of genericSecretPatterns) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function redactObject<T>(value: T): T {
  if (typeof value === "string") {
    return redactText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretFieldPattern.test(key) || envSecretNamePattern.test(key)
          ? "[REDACTED]"
          : redactObject(item),
      ]),
    ) as T;
  }
  return value;
}

export function errorDetails(error: unknown) {
  if (!(error instanceof Error)) {
    return { value: redactObject(error) };
  }
  return {
    name: error.name,
    message: redactText(error.message),
  };
}

function collectSecretValues() {
  const secrets = new Set<string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 6) continue;
    if (!envSecretNamePattern.test(key)) continue;
    secrets.add(value);
  }
  return [...secrets].sort((left, right) => right.length - left.length);
}
