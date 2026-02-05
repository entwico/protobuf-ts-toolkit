import { type Span, SpanKind, type SpanOptions, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import {
  type ClientStreamingCall,
  DuplexStreamingCall,
  type MethodInfo,
  RpcError,
  type RpcInterceptor,
  type RpcMetadata,
  type RpcOptions,
  RpcOutputStreamController,
  ServerStreamingCall,
} from '@protobuf-ts/runtime-rpc';

/**
 * OpenTelemetry semantic convention attributes for RPC.
 * Using string literals to avoid requiring the semantic-conventions package.
 */
const ATTR_RPC_SYSTEM = 'rpc.system';
const ATTR_RPC_SERVICE = 'rpc.service';
const ATTR_RPC_METHOD = 'rpc.method';
const ATTR_RPC_GRPC_STATUS_CODE = 'rpc.grpc.status_code';

/**
 * Configuration for the OpenTelemetry interceptor.
 */
export interface OtelConfig {
  /**
   * Name for the tracer. Each library should have its own unique name.
   * @default '@protobuf-ts-toolkit/opentelemetry'
   */
  tracerName?: string;

  /**
   * Optional function to customize span names.
   * @default `grpc.{serviceName}/{methodName}`
   */
  spanNameFormatter?: (method: MethodInfo, callType: string) => string;
}

/**
 * Default span name formatter.
 */
function defaultSpanNameFormatter(method: MethodInfo, _callType: string): string {
  return `grpc.${method.service.typeName}/${method.name}`;
}

/**
 * Inject trace context into metadata using W3C Trace Context propagation.
 */
function injectTraceContext(meta: RpcMetadata): RpcMetadata {
  const output: Record<string, string> = {};
  propagation.inject(context.active(), output);

  return { ...meta, ...output };
}

/**
 * Set span attributes from RPC error.
 */
function setSpanError(span: Span, error: unknown): void {
  if (error instanceof RpcError) {
    span.setAttribute(ATTR_RPC_GRPC_STATUS_CODE, error.code);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  } else if (error instanceof Error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  } else {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
}

/**
 * Creates an OpenTelemetry interceptor for gRPC calls.
 *
 * The interceptor:
 * - Creates spans for all gRPC call types
 * - Sets semantic convention attributes (rpc.system, rpc.service, rpc.method)
 * - Automatically propagates trace context via W3C Trace Context headers
 * - Sets span status based on call success/failure
 *
 * @example
 * ```typescript
 * const otelInterceptor = createOtelInterceptor();
 *
 * // Or with custom tracer name
 * const otelInterceptor = createOtelInterceptor({
 *   tracerName: 'my-grpc-client',
 * });
 *
 * const transport = new GrpcTransport({
 *   host: 'localhost:50051',
 *   interceptors: [otelInterceptor],
 * });
 * ```
 */
export function createOtelInterceptor(config: OtelConfig = {}): RpcInterceptor {
  const { tracerName = '@protobuf-ts-toolkit/opentelemetry', spanNameFormatter = defaultSpanNameFormatter } = config;

  const tracer = trace.getTracer(tracerName);

  function createSpanOptions(method: MethodInfo): SpanOptions {
    return {
      attributes: {
        [ATTR_RPC_SYSTEM]: 'grpc',
        [ATTR_RPC_SERVICE]: method.service.typeName,
        [ATTR_RPC_METHOD]: `/${method.service.typeName}/${method.name}`,
      },
      kind: SpanKind.CLIENT,
    };
  }

  return {
    interceptUnary(next, method, input, options) {
      const spanOptions = createSpanOptions(method);
      const spanName = spanNameFormatter(method, 'unary');

      return tracer.startActiveSpan(spanName, spanOptions, (span) => {
        const meta = injectTraceContext(options.meta ?? {});
        const call = next(method, input, { ...options, meta });

        call.response.then(
          () => {
            call.status.then((s) => {
              span.setAttribute(ATTR_RPC_GRPC_STATUS_CODE, s.code);
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
            });
          },
          (e) => {
            setSpanError(span, e);
            span.end();
          },
        );

        return call;
      });
    },

    interceptServerStreaming(next, method, input, options) {
      const spanOptions = createSpanOptions(method);
      const spanName = spanNameFormatter(method, 'serverStreaming');

      return tracer.startActiveSpan(spanName, spanOptions, (span) => {
        const meta = injectTraceContext(options.meta ?? {});
        const call = next(method, input, { ...options, meta });
        const outputStream = new RpcOutputStreamController();

        call.status.then((s) => {
          span.setAttribute(ATTR_RPC_GRPC_STATUS_CODE, s.code);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        });

        call.responses.onNext((message, error, done) => {
          if (message) outputStream.notifyMessage(message);

          if (error) {
            setSpanError(span, error);
            outputStream.notifyError(error);
          }

          if (done) outputStream.notifyComplete();
        });

        return new ServerStreamingCall(
          method,
          options.meta ?? {},
          input,
          call.headers,
          outputStream,
          call.status,
          call.trailers,
        );
      });
    },

    interceptClientStreaming<I extends object, O extends object>(
      next: (method: MethodInfo<I, O>, options: RpcOptions) => ClientStreamingCall<I, O>,
      method: MethodInfo<I, O>,
      options: RpcOptions,
    ): ClientStreamingCall<I, O> {
      const spanOptions = createSpanOptions(method);
      const spanName = spanNameFormatter(method, 'clientStreaming');

      return tracer.startActiveSpan(spanName, spanOptions, (span) => {
        const meta = injectTraceContext(options.meta ?? {});
        const call = next(method, { ...options, meta });

        call.response.then(
          () => {
            call.status.then((s) => {
              span.setAttribute(ATTR_RPC_GRPC_STATUS_CODE, s.code);
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
            });
          },
          (e) => {
            setSpanError(span, e);
            span.end();
          },
        );

        return call;
      });
    },

    interceptDuplex<I extends object, O extends object>(
      next: (method: MethodInfo<I, O>, options: RpcOptions) => DuplexStreamingCall<I, O>,
      method: MethodInfo<I, O>,
      options: RpcOptions,
    ): DuplexStreamingCall<I, O> {
      const spanOptions = createSpanOptions(method);
      const spanName = spanNameFormatter(method, 'duplex');

      return tracer.startActiveSpan(spanName, spanOptions, (span) => {
        const meta = injectTraceContext(options.meta ?? {});
        const call = next(method, { ...options, meta });
        const outputStream = new RpcOutputStreamController<O>();

        call.status.then(
          (s) => {
            span.setAttribute(ATTR_RPC_GRPC_STATUS_CODE, s.code);
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
          },
          (e) => {
            setSpanError(span, e);
            span.end();
          },
        );

        call.responses.onNext((message, error, done) => {
          if (message) outputStream.notifyMessage(message);

          if (error) {
            setSpanError(span, error);
            outputStream.notifyError(error);
          }

          if (done) outputStream.notifyComplete();
        });

        return new DuplexStreamingCall<I, O>(
          method,
          options.meta ?? {},
          call.requests,
          call.headers,
          outputStream,
          call.status,
          call.trailers,
        );
      });
    },
  };
}
