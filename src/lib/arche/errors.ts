export class ArcheError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class EligibilityError extends ArcheError {}

export class ExternalServiceError extends ArcheError {}

export class NotFoundError extends ArcheError {}

export class CancelledError extends ArcheError {}
