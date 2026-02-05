import { describe, expect, it } from 'bun:test';
import { NotFoundError, PermissionDeniedError, UnauthenticatedError, ValidationError } from '../errors.js';
import { decodeGrpcStatus } from './decode.js';
import { encodeGrpcStatus } from './encode.js';

describe('encode/decode roundtrip', () => {
  it('should roundtrip ValidationError with localizedMessage', () => {
    const error = new ValidationError({
      details: [{ type: 'localizedMessage', locale: 'en', message: 'Invalid input provided' }],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    expect(decoded.code).toBe(3); // INVALID_ARGUMENT
    expect(decoded.message).toBe('Validation error');
    expect(decoded.localizedMessage).toBe('Invalid input provided');
    expect(decoded.details).toHaveLength(1);
    expect(decoded.details[0]).toEqual({
      type: 'localizedMessage',
      locale: 'en',
      message: 'Invalid input provided',
    });
  });

  it('should roundtrip NotFoundError', () => {
    const error = new NotFoundError();
    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    expect(decoded.code).toBe(5); // NOT_FOUND
    expect(decoded.message).toBe('Not found');
  });

  it('should roundtrip PermissionDeniedError', () => {
    const error = new PermissionDeniedError();
    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    expect(decoded.code).toBe(7); // PERMISSION_DENIED
    expect(decoded.message).toBe('Permission denied');
  });

  it('should roundtrip UnauthenticatedError', () => {
    const error = new UnauthenticatedError();
    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    expect(decoded.code).toBe(16); // UNAUTHENTICATED
    expect(decoded.message).toBe('Unauthenticated');
  });

  it('should roundtrip badRequest detail', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'badRequest',
          fieldViolations: [
            { field: 'email', description: 'Invalid email format' },
            { field: 'name', description: 'Name is required' },
          ],
        },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    expect(decoded.details).toHaveLength(1);
    const detail = decoded.details[0]!;
    expect(detail.type).toBe('badRequest');
    if (detail.type === 'badRequest') {
      expect(detail.fieldViolations).toHaveLength(2);
      expect(detail.fieldViolations[0]).toEqual({
        field: 'email',
        description: 'Invalid email format',
      });
      expect(detail.fieldViolations[1]).toEqual({
        field: 'name',
        description: 'Name is required',
      });
    }
  });

  it('should roundtrip debugInfo detail', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'debugInfo',
          stackEntries: ['at foo()', 'at bar()', 'at main()'],
          detail: 'Something went wrong',
        },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    const detail = decoded.details[0]!;
    expect(detail.type).toBe('debugInfo');
    if (detail.type === 'debugInfo') {
      expect(detail.stackEntries).toEqual(['at foo()', 'at bar()', 'at main()']);
      expect(detail.detail).toBe('Something went wrong');
    }
  });

  it('should roundtrip errorInfo detail', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'errorInfo',
          reason: 'RATE_LIMITED',
          domain: 'api.example.com',
          metadata: { retryAfter: '60', userId: '123' },
        },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    const detail = decoded.details[0]!;
    expect(detail.type).toBe('errorInfo');
    if (detail.type === 'errorInfo') {
      expect(detail.reason).toBe('RATE_LIMITED');
      expect(detail.domain).toBe('api.example.com');
      expect(detail.metadata).toEqual({ retryAfter: '60', userId: '123' });
    }
  });

  it('should roundtrip retryInfo detail', () => {
    const error = new ValidationError({
      details: [{ type: 'retryInfo', retryDelaySeconds: 30 }],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    const detail = decoded.details[0]!;
    expect(detail.type).toBe('retryInfo');
    if (detail.type === 'retryInfo') {
      expect(detail.retryDelaySeconds).toBe(30);
    }
  });

  it('should roundtrip quotaFailure detail', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'quotaFailure',
          violations: [{ subject: 'api_requests', description: 'Exceeded daily limit' }],
        },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    const detail = decoded.details[0]!;
    expect(detail.type).toBe('quotaFailure');
    if (detail.type === 'quotaFailure') {
      expect(detail.violations).toHaveLength(1);
      expect(detail.violations[0]).toEqual({
        subject: 'api_requests',
        description: 'Exceeded daily limit',
      });
    }
  });

  it('should roundtrip preconditionFailure detail', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'preconditionFailure',
          violations: [{ type: 'TOS', subject: 'user', description: 'Terms not accepted' }],
        },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    const detail = decoded.details[0]!;
    expect(detail.type).toBe('preconditionFailure');
    if (detail.type === 'preconditionFailure') {
      expect(detail.violations).toHaveLength(1);
      expect(detail.violations[0]).toEqual({
        type: 'TOS',
        subject: 'user',
        description: 'Terms not accepted',
      });
    }
  });

  it('should roundtrip requestInfo detail', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'requestInfo',
          requestId: 'req-123',
          servingData: 'server-1',
        },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    const detail = decoded.details[0]!;
    expect(detail.type).toBe('requestInfo');
    if (detail.type === 'requestInfo') {
      expect(detail.requestId).toBe('req-123');
      expect(detail.servingData).toBe('server-1');
    }
  });

  it('should roundtrip resourceInfo detail', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'resourceInfo',
          resourceType: 'User',
          resourceName: 'users/123',
          owner: 'admin',
          description: 'User not found',
        },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    const detail = decoded.details[0]!;
    expect(detail.type).toBe('resourceInfo');
    if (detail.type === 'resourceInfo') {
      expect(detail.resourceType).toBe('User');
      expect(detail.resourceName).toBe('users/123');
      expect(detail.owner).toBe('admin');
      expect(detail.description).toBe('User not found');
    }
  });

  it('should roundtrip help detail', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'help',
          links: [
            { description: 'API Documentation', url: 'https://docs.example.com/api' },
            { description: 'FAQ', url: 'https://example.com/faq' },
          ],
        },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    const detail = decoded.details[0]!;
    expect(detail.type).toBe('help');
    if (detail.type === 'help') {
      expect(detail.links).toHaveLength(2);
      expect(detail.links[0]).toEqual({
        description: 'API Documentation',
        url: 'https://docs.example.com/api',
      });
    }
  });

  it('should roundtrip multiple details', () => {
    const error = new ValidationError({
      details: [
        { type: 'localizedMessage', locale: 'en', message: 'Invalid input' },
        {
          type: 'badRequest',
          fieldViolations: [{ field: 'email', description: 'Invalid format' }],
        },
        { type: 'requestInfo', requestId: 'req-456', servingData: '' },
      ],
    });

    const encoded = encodeGrpcStatus(error);
    const decoded = decodeGrpcStatus(encoded);

    expect(decoded.details).toHaveLength(3);
    expect(decoded.details[0]!.type).toBe('localizedMessage');
    expect(decoded.details[1]!.type).toBe('badRequest');
    expect(decoded.details[2]!.type).toBe('requestInfo');
  });
});
