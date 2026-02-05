import type { ErrorDetail, GrpcErrorOptions } from './types.js';

/**
 * Base class for all gRPC errors.
 * Can be used on both client (caught from interceptor) and server (thrown to be converted to gRPC status).
 */
export class GrpcError extends Error {
  /**
   * Structured error details from google.rpc error_details.
   */
  readonly details: ReadonlyArray<ErrorDetail>;

  /**
   * User-facing localized error message from LocalizedMessageDetail in details.
   */
  get localizedMessage(): string | undefined {
    const detail = this.details.find((d) => d.type === 'localizedMessage');
    return detail?.type === 'localizedMessage' ? detail.message : undefined;
  }

  constructor(message: string, options?: GrpcErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.details = options?.details ?? [];

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if ('captureStackTrace' in Error) {
      (Error as { captureStackTrace: (t: object, c?: new (...args: unknown[]) => unknown) => void }).captureStackTrace(
        this,
        this.constructor as new (...args: unknown[]) => unknown,
      );
    }
  }
}

/**
 * The operation was aborted, typically due to client cancellation.
 * Maps to gRPC status code CANCELLED (1) and ABORTED (10).
 */
export class AbortedError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Aborted by client', options);
  }
}

/**
 * The resource already exists.
 * Maps to gRPC status code ALREADY_EXISTS (6).
 */
export class AlreadyExistsError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Already exists', options);
  }
}

/**
 * The deadline expired before the operation could complete.
 * Maps to gRPC status code DEADLINE_EXCEEDED (4).
 */
export class DeadlineExceededError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Request took too long to respond', options);
  }
}

/**
 * The requested resource was not found.
 * Maps to gRPC status code NOT_FOUND (5).
 */
export class NotFoundError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Not found', options);
  }
}

/**
 * The caller does not have permission to execute the operation.
 * Maps to gRPC status code PERMISSION_DENIED (7).
 */
export class PermissionDeniedError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Permission denied', options);
  }
}

/**
 * The resource was modified by another operation concurrently.
 * This is a specialized error for optimistic locking failures.
 * Typically maps to gRPC status code ABORTED (10) with specific semantics.
 */
export class RaceUpdateError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Attempt to update after the item is already updated elsewhere', options);
  }
}

/**
 * The request contains invalid arguments.
 * Maps to gRPC status codes INVALID_ARGUMENT (3) and FAILED_PRECONDITION (9).
 */
export class ValidationError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Validation error', options);
  }
}

/**
 * The service is currently unavailable.
 * Maps to gRPC status code UNAVAILABLE (14).
 */
export class UnavailableError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Cannot connect to the server', options);
  }
}

/**
 * The request does not have valid authentication credentials.
 * Maps to gRPC status code UNAUTHENTICATED (16).
 */
export class UnauthenticatedError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Unauthenticated', options);
  }
}

/**
 * An unknown error occurred.
 * Maps to gRPC status codes UNKNOWN (2) and INTERNAL (13).
 */
export class UnknownError extends GrpcError {
  constructor(options?: GrpcErrorOptions) {
    super('Unknown error', options);
  }
}
