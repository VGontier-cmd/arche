export type ArcheErrorContext = {
  runId?: string;
  ticketKey?: string;
  service?: string;
  operation?: string;
};

export class ArcheError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly context?: ArcheErrorContext,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class EligibilityError extends ArcheError {}

export class ExternalServiceError extends ArcheError {}

export class JiraServiceError extends ExternalServiceError {
  constructor(message: string, code?: string, context?: ArcheErrorContext) {
    super(message, code, { service: "jira", ...context });
  }
}

export class GitLabServiceError extends ExternalServiceError {
  constructor(message: string, code?: string, context?: ArcheErrorContext) {
    super(message, code, { service: "gitlab", ...context });
  }
}

export class SandboxError extends ArcheError {
  constructor(message: string, context?: ArcheErrorContext) {
    super(message, "sandbox_error", context);
  }
}

export class ProviderError extends ExternalServiceError {
  constructor(message: string, code?: string, context?: ArcheErrorContext) {
    super(message, code, { service: "provider", ...context });
  }
}

export class ConfigurationError extends ArcheError {
  constructor(message: string, context?: ArcheErrorContext) {
    super(message, "configuration_error", context);
  }
}

export class ConflictError extends ArcheError {
  constructor(message: string, context?: ArcheErrorContext) {
    super(message, "conflict", context);
  }
}

export class NotFoundError extends ArcheError {}

export class CancelledError extends ArcheError {}
