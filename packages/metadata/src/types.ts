import type { MethodInfo, RpcMetadata } from '@protobuf-ts/runtime-rpc';

/**
 * Types of gRPC calls.
 */
export type CallType = 'unary' | 'serverStreaming' | 'clientStreaming' | 'duplex';

/**
 * Context passed to metadata provider functions.
 */
export interface MetadataContext {
  readonly callType: CallType;
  readonly method: MethodInfo;
}

/**
 * Metadata provider - can be a static object or a function returning metadata.
 */
export type MetadataProvider = RpcMetadata | ((context: MetadataContext) => RpcMetadata | Promise<RpcMetadata>);

/**
 * Configuration for the metadata interceptor.
 */
export interface MetadataInterceptorConfig {
  /**
   * Metadata to add to calls.
   * Can be:
   * - Static object: `{ 'x-api-key': 'key123' }`
   * - Sync function: `() => ({ 'x-request-id': crypto.randomUUID() })`
   * - Async function: `async () => ({ 'authorization': 'Bearer ' + await getToken() })`
   */
  readonly metadata: MetadataProvider;

  /**
   * Filter which call types to intercept.
   * If not specified, all call types are intercepted.
   * @default All call types
   */
  readonly callTypes?: CallType[];
}
