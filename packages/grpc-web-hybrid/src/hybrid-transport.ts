import { grpc } from '@improbable-eng/grpc-web';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import type { IMessageType } from '@protobuf-ts/runtime';
import {
  ClientStreamingCall,
  Deferred,
  DuplexStreamingCall,
  type MethodInfo,
  RpcError,
  type RpcInterceptor,
  type RpcMetadata,
  type RpcOptions,
  RpcOutputStreamController,
  type RpcStatus,
  type RpcTransport,
  type ServerStreamingCall,
  type UnaryCall,
  mergeRpcOptions,
  stackIntercept,
} from '@protobuf-ts/runtime-rpc';

/**
 * Wrapper class that bridges protobuf-ts binary format to @improbable-eng/grpc-web ProtobufMessage interface.
 */
class ProtobufMessageWrapper implements grpc.ProtobufMessage {
  constructor(protected data: Uint8Array) {}

  serializeBinary(): Uint8Array {
    return this.data;
  }

  toObject(): object {
    return {};
  }
}

/**
 * Adapter to bridge protobuf-ts MessageType to @improbable-eng/grpc-web ProtobufMessageClass interface.
 */
function createMessageClass<T extends object>(
  messageType: IMessageType<T>,
): grpc.ProtobufMessageClass<grpc.ProtobufMessage> {
  return class extends ProtobufMessageWrapper {
    static deserializeBinary(bytes: Uint8Array): grpc.ProtobufMessage {
      return new this(bytes);
    }

    override toObject(): object {
      return messageType.fromBinary(this.data);
    }
  } as unknown as grpc.ProtobufMessageClass<grpc.ProtobufMessage>;
}

/**
 * Convert protobuf-ts MethodInfo to @improbable-eng/grpc-web MethodDefinition.
 */
function createMethodDefinition<I extends object, O extends object>(
  method: MethodInfo<I, O>,
): grpc.MethodDefinition<grpc.ProtobufMessage, grpc.ProtobufMessage> {
  const requestType = createMessageClass(method.I);
  const responseType = createMessageClass(method.O);

  return {
    methodName: method.name,
    service: {
      serviceName: method.service.typeName,
    },
    requestStream: method.clientStreaming ?? false,
    responseStream: method.serverStreaming ?? false,
    requestType,
    responseType,
  };
}

/**
 * Convert RpcMetadata to grpc.Metadata.
 */
function toGrpcMetadata(meta?: RpcMetadata): grpc.Metadata {
  const metadata = new grpc.Metadata();
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === 'string') {
        metadata.set(key, value);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          metadata.append(key, v);
        }
      }
    }
  }
  return metadata;
}

/**
 * Convert grpc.Metadata to RpcMetadata.
 */
function fromGrpcMetadata(metadata: grpc.Metadata): RpcMetadata {
  const result: RpcMetadata = {};
  metadata.forEach((key, values) => {
    if (values.length === 1 && values[0] !== undefined) {
      result[key] = values[0];
    } else if (values.length > 0) {
      result[key] = values;
    }
  });
  return result;
}

/**
 * Convert grpc.Code to RpcStatus code string.
 */
function toRpcStatusCode(code: grpc.Code): string {
  return grpc.Code[code] ?? 'UNKNOWN';
}

/**
 * Configuration options for the hybrid transport.
 */
export interface GrpcWebHybridTransportOptions {
  /**
   * Base URL for the gRPC server.
   * Use empty string to use current origin (browser only).
   */
  baseUrl: string;

  /**
   * Interceptors to apply to all calls.
   */
  interceptors?: RpcInterceptor[];
}

/**
 * Hybrid gRPC transport that automatically routes calls to the appropriate transport:
 * - Unary and server streaming calls use HTTP/fetch (GrpcWebFetchTransport)
 * - Client streaming and bidirectional streaming calls use WebSocket (@improbable-eng/grpc-web)
 *
 * This is useful because standard gRPC-web (HTTP) only supports unary and server streaming,
 * while client streaming and bidirectional streaming require WebSocket support.
 *
 * @example
 * ```typescript
 * const transport = new GrpcWebHybridTransport({
 *   baseUrl: '', // Use current origin
 *   interceptors: [
 *     createErrorInterceptor(),
 *     createCsrfTokenInterceptor(() => getCsrfToken()),
 *   ],
 * });
 *
 * const client = new MyServiceClient(transport);
 * ```
 */
export class GrpcWebHybridTransport implements RpcTransport {
  private readonly fetchTransport: GrpcWebFetchTransport;
  private readonly defaultOptions: RpcOptions;
  private readonly baseUrl: string;
  private readonly interceptors: RpcInterceptor[];

  constructor(options: GrpcWebHybridTransportOptions) {
    // Resolve baseUrl for WebSocket transport (empty string means current origin)
    this.baseUrl = options.baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    this.interceptors = options.interceptors ?? [];
    this.defaultOptions = {
      interceptors: this.interceptors,
    };

    // Create fetch transport for unary and server streaming (handles empty baseUrl internally)
    this.fetchTransport = new GrpcWebFetchTransport({
      baseUrl: options.baseUrl,
      interceptors: this.interceptors,
    });
  }

  mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
    return mergeRpcOptions(this.defaultOptions, options);
  }

  /**
   * Unary call - delegates to fetch transport.
   */
  unary<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): UnaryCall<I, O> {
    return this.fetchTransport.unary(method, input, this.fetchTransport.mergeOptions(options));
  }

  /**
   * Server streaming call - delegates to fetch transport.
   */
  serverStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): ServerStreamingCall<I, O> {
    return this.fetchTransport.serverStreaming(method, input, this.fetchTransport.mergeOptions(options));
  }

  /**
   * Client streaming call - uses WebSocket transport.
   */
  clientStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    options: RpcOptions,
  ): ClientStreamingCall<I, O> {
    const opt = this.mergeOptions(options);
    const i = opt.interceptors;

    // Only apply interceptors on first call, not when stackIntercept calls back
    if (i?.length && !options.interceptors) {
      return stackIntercept<I, O>('clientStreaming', this, method, opt);
    }
    return this.performClientStreaming(method, opt);
  }

  private performClientStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    options: RpcOptions,
  ): ClientStreamingCall<I, O> {
    const methodDef = createMethodDefinition(method);
    const meta = options.meta ?? {};

    const headersDeferred = new Deferred<RpcMetadata>();
    const responseDeferred = new Deferred<O>();
    const statusDeferred = new Deferred<RpcStatus>();
    const trailersDeferred = new Deferred<RpcMetadata>();

    const client = grpc.client(methodDef, {
      host: this.baseUrl,
      transport: grpc.WebsocketTransport(),
    });

    client.onHeaders((headers) => {
      headersDeferred.resolve(fromGrpcMetadata(headers));
    });

    client.onMessage((message) => {
      const bytes = message.serializeBinary();
      const response = method.O.fromBinary(bytes, options.binaryOptions);
      responseDeferred.resolve(response);
    });

    client.onEnd((code, message, trailers) => {
      const rpcTrailers = fromGrpcMetadata(trailers);
      trailersDeferred.resolve(rpcTrailers);

      if (code === grpc.Code.OK) {
        statusDeferred.resolve({ code: toRpcStatusCode(code), detail: message });
      } else {
        const error = new RpcError(message, toRpcStatusCode(code), rpcTrailers);
        headersDeferred.rejectPending(error);
        responseDeferred.rejectPending(error);
        statusDeferred.reject(error);
      }
    });

    client.start(toGrpcMetadata(meta));

    const requestStream = {
      send: async (message: I): Promise<void> => {
        const bytes = method.I.toBinary(message, options.binaryOptions);
        const wrapper = new ProtobufMessageWrapper(bytes);
        client.send(wrapper);
      },
      complete: async (): Promise<void> => {
        client.finishSend();
      },
    };

    return new ClientStreamingCall<I, O>(
      method,
      meta,
      requestStream,
      headersDeferred.promise,
      responseDeferred.promise,
      statusDeferred.promise,
      trailersDeferred.promise,
    );
  }

  /**
   * Duplex (bidirectional) streaming call - uses WebSocket transport.
   */
  duplex<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): DuplexStreamingCall<I, O> {
    const opt = this.mergeOptions(options);
    const i = opt.interceptors;

    // Only apply interceptors on first call, not when stackIntercept calls back
    if (i?.length && !options.interceptors) {
      return stackIntercept<I, O>('duplex', this, method, opt);
    }
    return this.performDuplex(method, opt);
  }

  private performDuplex<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    options: RpcOptions,
  ): DuplexStreamingCall<I, O> {
    const methodDef = createMethodDefinition(method);
    const meta = options.meta ?? {};

    const headersDeferred = new Deferred<RpcMetadata>();
    const statusDeferred = new Deferred<RpcStatus>();
    const trailersDeferred = new Deferred<RpcMetadata>();
    const responseStream = new RpcOutputStreamController<O>();

    const client = grpc.client(methodDef, {
      host: this.baseUrl,
      transport: grpc.WebsocketTransport(),
    });

    client.onHeaders((headers) => {
      headersDeferred.resolve(fromGrpcMetadata(headers));
    });

    client.onMessage((message) => {
      const bytes = message.serializeBinary();
      const response = method.O.fromBinary(bytes, options.binaryOptions);
      responseStream.notifyMessage(response);
    });

    client.onEnd((code, message, trailers) => {
      const rpcTrailers = fromGrpcMetadata(trailers);
      trailersDeferred.resolve(rpcTrailers);

      if (code === grpc.Code.OK) {
        statusDeferred.resolve({ code: toRpcStatusCode(code), detail: message });
        responseStream.notifyComplete();
      } else {
        const error = new RpcError(message, toRpcStatusCode(code), rpcTrailers);
        headersDeferred.rejectPending(error);
        statusDeferred.reject(error);
        responseStream.notifyError(error);
      }
    });

    client.start(toGrpcMetadata(meta));

    const requestStream = {
      send: async (message: I): Promise<void> => {
        const bytes = method.I.toBinary(message, options.binaryOptions);
        const wrapper = new ProtobufMessageWrapper(bytes);
        client.send(wrapper);
      },
      complete: async (): Promise<void> => {
        client.finishSend();
      },
    };

    return new DuplexStreamingCall<I, O>(
      method,
      meta,
      requestStream,
      headersDeferred.promise,
      responseStream,
      statusDeferred.promise,
      trailersDeferred.promise,
    );
  }
}
