import type { MethodInfo, RpcOptions, UnaryCall } from '@protobuf-ts/runtime-rpc';
import { describe, expect, it, mock } from 'bun:test';
import { createMetadataInterceptor } from './metadata-interceptor.js';

// Mock method info
const mockMethod: MethodInfo = {
  name: 'TestMethod',
  service: {
    typeName: 'test.TestService',
    methods: [],
    options: {},
  },
  localName: 'testMethod',
  I: {} as any,
  O: {} as any,
  options: {},
  idempotency: undefined,
  serverStreaming: false,
  clientStreaming: false,
};

// Mock next function that captures the options
function createMockNext() {
  let capturedOptions: RpcOptions | undefined;
  const next = (method: MethodInfo, input: object, options: RpcOptions) => {
    capturedOptions = options;
    return {
      headers: Promise.resolve({}),
      response: Promise.resolve({}),
      status: Promise.resolve({ code: 'OK', detail: '' }),
      trailers: Promise.resolve({}),
      then: (fn: any) => Promise.resolve({}).then(fn),
    } as unknown as UnaryCall<object, object>;
  };
  return { next, getCapturedOptions: () => capturedOptions };
}

describe('createMetadataInterceptor', () => {
  describe('static metadata', () => {
    it('should add static metadata to calls', async () => {
      const interceptor = createMetadataInterceptor({
        metadata: { 'x-api-key': 'key123' },
      });

      const { next, getCapturedOptions } = createMockNext();
      const options: RpcOptions = { meta: {} };

      interceptor.interceptUnary!(next, mockMethod, {}, options);

      // Wait for async resolution
      await new Promise((r) => setTimeout(r, 0));

      expect(getCapturedOptions()?.meta).toEqual({ 'x-api-key': 'key123' });
    });

    it('should merge with existing metadata', async () => {
      const interceptor = createMetadataInterceptor({
        metadata: { 'x-api-key': 'key123' },
      });

      const { next, getCapturedOptions } = createMockNext();
      const options: RpcOptions = { meta: { existing: 'value' } };

      interceptor.interceptUnary!(next, mockMethod, {}, options);

      await new Promise((r) => setTimeout(r, 0));

      expect(getCapturedOptions()?.meta).toEqual({
        existing: 'value',
        'x-api-key': 'key123',
      });
    });
  });

  describe('sync function metadata', () => {
    it('should call function and add metadata', async () => {
      let callCount = 0;
      const interceptor = createMetadataInterceptor({
        metadata: () => {
          callCount++;
          return { 'x-request-id': `req-${callCount}` };
        },
      });

      const { next, getCapturedOptions } = createMockNext();
      const options: RpcOptions = { meta: {} };

      interceptor.interceptUnary!(next, mockMethod, {}, options);
      await new Promise((r) => setTimeout(r, 0));
      expect(getCapturedOptions()?.meta).toEqual({ 'x-request-id': 'req-1' });

      // Second call should increment
      const { next: next2, getCapturedOptions: getCapturedOptions2 } = createMockNext();
      interceptor.interceptUnary!(next2, mockMethod, {}, options);
      await new Promise((r) => setTimeout(r, 0));
      expect(getCapturedOptions2()?.meta).toEqual({ 'x-request-id': 'req-2' });
    });

    it('should receive context with method info', async () => {
      let receivedContext: any;
      const interceptor = createMetadataInterceptor({
        metadata: (ctx) => {
          receivedContext = ctx;
          return { 'x-method': ctx.method.name };
        },
      });

      const { next } = createMockNext();
      interceptor.interceptUnary!(next, mockMethod, {}, { meta: {} });

      await new Promise((r) => setTimeout(r, 0));

      expect(receivedContext.callType).toBe('unary');
      expect(receivedContext.method.name).toBe('TestMethod');
    });
  });

  describe('async function metadata', () => {
    it('should wait for async metadata', async () => {
      const interceptor = createMetadataInterceptor({
        metadata: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return { authorization: 'Bearer token123' };
        },
      });

      const { next, getCapturedOptions } = createMockNext();
      const options: RpcOptions = { meta: {} };

      interceptor.interceptUnary!(next, mockMethod, {}, options);

      // Should not be set immediately
      expect(getCapturedOptions()).toBeUndefined();

      // Wait for async resolution
      await new Promise((r) => setTimeout(r, 20));

      expect(getCapturedOptions()?.meta).toEqual({ authorization: 'Bearer token123' });
    });
  });

  describe('callTypes filtering', () => {
    it('should only intercept specified call types', async () => {
      const metadataFn = mock(() => ({ 'x-custom': 'value' }));
      const interceptor = createMetadataInterceptor({
        metadata: metadataFn,
        callTypes: ['serverStreaming', 'duplex'],
      });

      const { next } = createMockNext();
      const options: RpcOptions = { meta: {} };

      // Unary should not be intercepted
      interceptor.interceptUnary!(next, mockMethod, {}, options);
      await new Promise((r) => setTimeout(r, 0));

      expect(metadataFn).not.toHaveBeenCalled();
    });

    it('should intercept when call type matches', async () => {
      const metadataFn = mock(() => ({ 'x-custom': 'value' }));
      const interceptor = createMetadataInterceptor({
        metadata: metadataFn,
        callTypes: ['unary'],
      });

      const { next } = createMockNext();
      const options: RpcOptions = { meta: {} };

      interceptor.interceptUnary!(next, mockMethod, {}, options);
      await new Promise((r) => setTimeout(r, 0));

      expect(metadataFn).toHaveBeenCalled();
    });
  });

  describe('multiple headers', () => {
    it('should support multiple headers', async () => {
      const interceptor = createMetadataInterceptor({
        metadata: {
          authorization: 'Bearer token',
          'x-request-id': 'req-123',
          'x-custom': 'custom-value',
        },
      });

      const { next, getCapturedOptions } = createMockNext();
      interceptor.interceptUnary!(next, mockMethod, {}, { meta: {} });

      await new Promise((r) => setTimeout(r, 0));

      expect(getCapturedOptions()?.meta).toEqual({
        authorization: 'Bearer token',
        'x-request-id': 'req-123',
        'x-custom': 'custom-value',
      });
    });
  });
});
