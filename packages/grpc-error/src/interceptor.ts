import {
  ClientStreamingCall,
  DuplexStreamingCall,
  type MethodInfo,
  RpcError,
  type RpcInterceptor,
  type RpcMetadata,
  type RpcOptions,
  RpcOutputStreamController,
  ServerStreamingCall,
  UnaryCall,
} from '@protobuf-ts/runtime-rpc';
import { decodeGrpcStatus } from './codec/index.js';
import {
  AbortedError,
  AlreadyExistsError,
  DeadlineExceededError,
  type GrpcError,
  NotFoundError,
  PermissionDeniedError,
  UnauthenticatedError,
  UnavailableError,
  UnknownError,
  ValidationError,
} from './errors.js';
import type { GrpcErrorOptions } from './types.js';

/**
 * gRPC status codes as strings (how they appear in RpcError.code).
 */
const GrpcStatusCode = {
  OK: 'OK',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  FAILED_PRECONDITION: 'FAILED_PRECONDITION',
  ABORTED: 'ABORTED',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  UNIMPLEMENTED: 'UNIMPLEMENTED',
  INTERNAL: 'INTERNAL',
  UNAVAILABLE: 'UNAVAILABLE',
  DATA_LOSS: 'DATA_LOSS',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
} as const;

/**
 * Configuration options for the error interceptor.
 */
export interface ErrorInterceptorConfig {
  /**
   * Callback invoked when any error occurs.
   * Useful for logging, analytics, or triggering global actions (e.g., redirect on auth error).
   */
  onError?: (error: GrpcError) => void;
}

// Type for globalThis with optional atob/Buffer
const g = globalThis as {
  atob?: (data: string) => string;
  Buffer?: { from(s: string, e: string): Uint8Array };
};

/**
 * Decode base64 to binary. Works in all modern JS environments:
 * browsers (main thread + workers), Node.js 16+, Bun, Deno.
 */
function decodeBase64(base64: string): Uint8Array {
  if (typeof g.atob === 'function') {
    return Uint8Array.from(g.atob(base64), (c) => c.charCodeAt(0));
  }

  if (g.Buffer) {
    return new Uint8Array(g.Buffer.from(base64, 'base64'));
  }

  throw new Error('No base64 decoder available');
}

/**
 * Parse rich error details from the grpc-status-details-bin metadata header.
 */
function parseRichErrorDetails(meta: RpcMetadata): GrpcErrorOptions {
  const richError = meta['grpc-status-details-bin'];

  if (!richError) {
    return { details: [] };
  }

  try {
    const binary = decodeBase64(richError as string);
    const decoded = decodeGrpcStatus(binary);

    return { details: decoded.details };
  } catch {
    return { details: [] };
  }
}

/**
 * Capture the current stack trace for later use.
 * This is used to provide better stack traces that point to the call site
 * rather than deep inside gRPC connection pool internals.
 */
function captureCallSiteStack(): string | undefined {
  const captureTarget = { stack: '' };

  if (Error.captureStackTrace) {
    Error.captureStackTrace(captureTarget, captureCallSiteStack);

    return captureTarget.stack;
  }

  return new Error().stack;
}

/**
 * Apply a captured call-site stack trace to an error.
 * Preserves the error's name and message while using the call-site stack.
 */
function applyCallSiteStack(error: GrpcError, callSiteStack: string | undefined): void {
  if (!callSiteStack) return;

  const errorHeader = `${error.name}: ${error.message}`;
  const stackLines = callSiteStack.split('\n').slice(1);
  error.stack = `${errorHeader}\n${stackLines.join('\n')}`;
}

/**
 * Map an RpcError to the appropriate GrpcError subclass.
 */
function mapRpcError(
  e: unknown,
  abort: { aborted: boolean } | undefined,
  onError: ((error: GrpcError) => void) | undefined,
  callSiteStack: string | undefined,
): Error {
  if (!(e instanceof RpcError)) {
    return e instanceof Error ? e : new UnknownError();
  }

  if (abort?.aborted) {
    const error = new AbortedError();
    applyCallSiteStack(error, callSiteStack);
    onError?.(error);

    return error;
  }

  const parsed = parseRichErrorDetails(e.meta);
  const options: GrpcErrorOptions = {
    ...parsed,
    cause: e,
  };

  let error: GrpcError;

  switch (e.code) {
    case GrpcStatusCode.CANCELLED:
    case GrpcStatusCode.ABORTED:
      error = new AbortedError(options);
      break;
    case GrpcStatusCode.UNAUTHENTICATED:
      error = new UnauthenticatedError(options);
      break;
    case GrpcStatusCode.UNAVAILABLE:
      error = new UnavailableError(options);
      break;
    case GrpcStatusCode.ALREADY_EXISTS:
      error = new AlreadyExistsError(options);
      break;
    case GrpcStatusCode.NOT_FOUND:
      error = new NotFoundError(options);
      break;
    case GrpcStatusCode.INVALID_ARGUMENT:
    case GrpcStatusCode.FAILED_PRECONDITION:
      error = new ValidationError(options);
      break;
    case GrpcStatusCode.DEADLINE_EXCEEDED:
      error = new DeadlineExceededError(options);
      break;
    case GrpcStatusCode.PERMISSION_DENIED:
      error = new PermissionDeniedError(options);
      break;
    default:
      error = new UnknownError(options);
  }

  applyCallSiteStack(error, callSiteStack);
  onError?.(error);

  return error;
}

/**
 * Creates a gRPC interceptor that maps RpcError to typed GrpcError subclasses.
 *
 * The interceptor:
 * - Captures the call-site stack trace before the gRPC call
 * - Catches RpcError from gRPC calls
 * - Parses rich error details from grpc-status-details-bin metadata
 * - Maps gRPC status codes to appropriate GrpcError subclasses
 * - Optionally invokes a callback on each error
 *
 * @example
 * ```typescript
 * const transport = new GrpcWebFetchTransport({
 *   baseUrl: '/api',
 *   interceptors: [
 *     createErrorInterceptor({
 *       onError: (error) => {
 *         if (error instanceof UnauthenticatedError) {
 *           router.push('/login');
 *         }
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export function createErrorInterceptor(config?: ErrorInterceptorConfig): RpcInterceptor {
  const onError = config?.onError;

  function createCatchError(options: RpcOptions): (e: unknown) => never {
    const callSiteStack = captureCallSiteStack();

    return (e: unknown): never => {
      throw mapRpcError(e, options.abort, onError, callSiteStack);
    };
  }

  return {
    interceptUnary(next, method, input, options) {
      const call = next(method, input, options);
      const catchError = createCatchError(options);

      return new UnaryCall(
        method,
        options.meta ?? {},
        input,
        call.headers,
        call.response.catch(catchError),
        call.status.catch(catchError),
        call.trailers.catch(catchError),
      );
    },

    interceptServerStreaming(next, method, input, options) {
      const call = next(method, input, options);
      const catchError = createCatchError(options);
      const outputStream = new RpcOutputStreamController();

      call.responses.onNext((message, error, done) => {
        if (message) outputStream.notifyMessage(message);
        if (error) outputStream.notifyError(catchError(error));
        if (done) outputStream.notifyComplete();
      });

      return new ServerStreamingCall(
        method,
        options.meta ?? {},
        input,
        call.headers,
        outputStream,
        call.status.catch(catchError),
        call.trailers.catch(catchError),
      );
    },

    interceptClientStreaming<I extends object, O extends object>(
      next: (method: MethodInfo<I, O>, options: RpcOptions) => ClientStreamingCall<I, O>,
      method: MethodInfo<I, O>,
      options: RpcOptions,
    ): ClientStreamingCall<I, O> {
      const call = next(method, options);
      const catchError = createCatchError(options);

      return new ClientStreamingCall<I, O>(
        method,
        options.meta ?? {},
        call.requests,
        call.headers,
        call.response.catch(catchError),
        call.status.catch(catchError),
        call.trailers.catch(catchError),
      );
    },

    interceptDuplex<I extends object, O extends object>(
      next: (method: MethodInfo<I, O>, options: RpcOptions) => DuplexStreamingCall<I, O>,
      method: MethodInfo<I, O>,
      options: RpcOptions,
    ): DuplexStreamingCall<I, O> {
      const call = next(method, options);
      const catchError = createCatchError(options);
      const outputStream = new RpcOutputStreamController<O>();

      call.responses.onNext((message, error, done) => {
        if (message) outputStream.notifyMessage(message);
        if (error) outputStream.notifyError(catchError(error));
        if (done) outputStream.notifyComplete();
      });

      return new DuplexStreamingCall<I, O>(
        method,
        options.meta ?? {},
        call.requests,
        call.headers,
        outputStream,
        call.status.catch(catchError),
        call.trailers.catch(catchError),
      );
    },
  };
}
