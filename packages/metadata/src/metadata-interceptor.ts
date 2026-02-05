import {
  ClientStreamingCall,
  Deferred,
  DuplexStreamingCall,
  type MethodInfo,
  type RpcInterceptor,
  type RpcMetadata,
  type RpcOptions,
  RpcOutputStreamController,
  type RpcStatus,
  ServerStreamingCall,
  UnaryCall,
} from '@protobuf-ts/runtime-rpc';
import type { CallType, MetadataContext, MetadataInterceptorConfig, MetadataProvider } from './types.js';

function resolveMetadata(provider: MetadataProvider, context: MetadataContext): RpcMetadata | Promise<RpcMetadata> {
  if (typeof provider === 'function') {
    return provider(context);
  }

  return provider;
}

/**
 * Creates an interceptor that adds metadata to gRPC calls.
 *
 * Supports static metadata, sync functions, and async functions.
 * Properly handles message buffering for streaming calls while async metadata is being resolved.
 *
 * @example
 * ```typescript
 * // Static metadata
 * createMetadataInterceptor({
 *   metadata: { 'x-api-key': 'key123' }
 * });
 *
 * // Dynamic metadata (sync)
 * createMetadataInterceptor({
 *   metadata: () => ({ 'x-request-id': crypto.randomUUID() })
 * });
 *
 * // Async metadata
 * createMetadataInterceptor({
 *   metadata: async () => ({
 *     'authorization': `Bearer ${await getToken()}`
 *   })
 * });
 *
 * // Multiple headers with filtering
 * createMetadataInterceptor({
 *   metadata: async ({ method }) => ({
 *     'authorization': `Bearer ${await getToken()}`,
 *     'x-method': method.name
 *   }),
 *   callTypes: ['unary', 'serverStreaming']
 * });
 * ```
 */
export function createMetadataInterceptor(config: MetadataInterceptorConfig): RpcInterceptor {
  const { metadata, callTypes } = config;

  const shouldIntercept = (type: CallType): boolean => {
    return callTypes === undefined || callTypes.includes(type);
  };

  return {
    interceptUnary(next, method, input, options) {
      if (!shouldIntercept('unary')) {
        return next(method, input, options);
      }

      const context: MetadataContext = { callType: 'unary', method };
      const resolved = resolveMetadata(metadata, context);

      if (!(resolved instanceof Promise)) {
        const meta = { ...options.meta, ...resolved };

        return next(method, input, { ...options, meta });
      }

      const callPromise = resolved.then((resolvedMeta) => {
        const meta = { ...options.meta, ...resolvedMeta };

        return next(method, input, { ...options, meta });
      });

      return new UnaryCall(
        method,
        options.meta ?? {},
        input,
        callPromise.then((c) => c.headers),
        callPromise.then((c) => c.response),
        callPromise.then((c) => c.status),
        callPromise.then((c) => c.trailers),
      );
    },

    interceptServerStreaming(next, method, input, options) {
      if (!shouldIntercept('serverStreaming')) {
        return next(method, input, options);
      }

      const context: MetadataContext = { callType: 'serverStreaming', method };
      const resolved = resolveMetadata(metadata, context);

      if (!(resolved instanceof Promise)) {
        const meta = { ...options.meta, ...resolved };

        return next(method, input, { ...options, meta });
      }

      const outputStream = new RpcOutputStreamController();

      const callPromise = resolved.then((resolvedMeta) => {
        const meta = { ...options.meta, ...resolvedMeta };
        const call = next(method, input, { ...options, meta });

        call.responses.onNext((message, error, done) => {
          if (message) outputStream.notifyMessage(message);
          if (error) outputStream.notifyError(error);
          if (done) outputStream.notifyComplete();
        });

        return call;
      });

      return new ServerStreamingCall(
        method,
        options.meta ?? {},
        input,
        callPromise.then((c) => c.headers),
        outputStream,
        callPromise.then((c) => c.status),
        callPromise.then((c) => c.trailers),
      );
    },

    interceptClientStreaming<I extends object, O extends object>(
      next: (method: MethodInfo<I, O>, options: RpcOptions) => ClientStreamingCall<I, O>,
      method: MethodInfo<I, O>,
      options: RpcOptions,
    ): ClientStreamingCall<I, O> {
      if (!shouldIntercept('clientStreaming')) {
        return next(method, options);
      }

      const context: MetadataContext = { callType: 'clientStreaming', method };
      const resolved = resolveMetadata(metadata, context);

      if (!(resolved instanceof Promise)) {
        const meta = { ...options.meta, ...resolved };

        return next(method, { ...options, meta });
      }

      const headersDeferred = new Deferred<RpcMetadata>();
      const responseDeferred = new Deferred<O>();
      const statusDeferred = new Deferred<RpcStatus>();
      const trailersDeferred = new Deferred<RpcMetadata>();

      let pendingCall: ClientStreamingCall<I, O> | undefined;
      const pendingMessages: I[] = [];
      let sendCompleted = false;

      resolved.then((resolvedMeta) => {
        const meta = { ...options.meta, ...resolvedMeta };
        const call = next(method, { ...options, meta });
        pendingCall = call;

        call.headers.then((h) => headersDeferred.resolve(h)).catch((e) => headersDeferred.reject(e));
        call.response.then((r) => responseDeferred.resolve(r)).catch((e) => responseDeferred.reject(e));
        call.status.then((s) => statusDeferred.resolve(s)).catch((e) => statusDeferred.reject(e));
        call.trailers.then((t) => trailersDeferred.resolve(t)).catch((e) => trailersDeferred.reject(e));

        for (const msg of pendingMessages) {
          call.requests.send(msg);
        }

        pendingMessages.length = 0;

        if (sendCompleted) {
          call.requests.complete();
        }
      });

      const requestStream = {
        send: async (message: I): Promise<void> => {
          if (pendingCall) {
            return pendingCall.requests.send(message);
          }

          pendingMessages.push(message);
        },
        complete: async (): Promise<void> => {
          if (pendingCall) {
            return pendingCall.requests.complete();
          }

          sendCompleted = true;
        },
      };

      return new ClientStreamingCall<I, O>(
        method,
        options.meta ?? {},
        requestStream,
        headersDeferred.promise,
        responseDeferred.promise,
        statusDeferred.promise,
        trailersDeferred.promise,
      );
    },

    interceptDuplex<I extends object, O extends object>(
      next: (method: MethodInfo<I, O>, options: RpcOptions) => DuplexStreamingCall<I, O>,
      method: MethodInfo<I, O>,
      options: RpcOptions,
    ): DuplexStreamingCall<I, O> {
      if (!shouldIntercept('duplex')) {
        return next(method, options);
      }

      const context: MetadataContext = { callType: 'duplex', method };
      const resolved = resolveMetadata(metadata, context);

      if (!(resolved instanceof Promise)) {
        const meta = { ...options.meta, ...resolved };

        return next(method, { ...options, meta });
      }

      const headersDeferred = new Deferred<RpcMetadata>();
      const statusDeferred = new Deferred<RpcStatus>();
      const trailersDeferred = new Deferred<RpcMetadata>();
      const responseStream = new RpcOutputStreamController<O>();

      let pendingCall: DuplexStreamingCall<I, O> | undefined;
      const pendingMessages: I[] = [];
      let sendCompleted = false;

      resolved.then((resolvedMeta) => {
        const meta = { ...options.meta, ...resolvedMeta };
        const call = next(method, { ...options, meta });
        pendingCall = call;

        call.headers.then((h) => headersDeferred.resolve(h)).catch((e) => headersDeferred.reject(e));
        call.status.then((s) => statusDeferred.resolve(s)).catch((e) => statusDeferred.reject(e));
        call.trailers.then((t) => trailersDeferred.resolve(t)).catch((e) => trailersDeferred.reject(e));

        call.responses.onNext((message, error, done) => {
          if (message) responseStream.notifyMessage(message);
          if (error) responseStream.notifyError(error);
          if (done) responseStream.notifyComplete();
        });

        for (const msg of pendingMessages) {
          call.requests.send(msg);
        }

        pendingMessages.length = 0;

        if (sendCompleted) {
          call.requests.complete();
        }
      });

      const requestStream = {
        send: async (message: I): Promise<void> => {
          if (pendingCall) {
            return pendingCall.requests.send(message);
          }

          pendingMessages.push(message);
        },
        complete: async (): Promise<void> => {
          if (pendingCall) {
            return pendingCall.requests.complete();
          }

          sendCompleted = true;
        },
      };

      return new DuplexStreamingCall<I, O>(
        method,
        options.meta ?? {},
        requestStream,
        headersDeferred.promise,
        responseStream,
        statusDeferred.promise,
        trailersDeferred.promise,
      );
    },
  };
}
