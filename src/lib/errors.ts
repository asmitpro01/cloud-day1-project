/** Base class for expected, user-presentable failures. `code` is stable for clients and logs. */
export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = "Too many requests. Please try again shortly.") {
    super("RATE_LIMITED", message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have access to this") {
    super("FORBIDDEN", message);
  }
}

/** Returns a message safe to show users: the message of an AppError, otherwise a generic one. */
export function publicErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  return error instanceof AppError ? error.message : fallback;
}
