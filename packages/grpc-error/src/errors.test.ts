import { describe, expect, it } from 'bun:test';
import {
  AbortedError,
  AlreadyExistsError,
  DeadlineExceededError,
  GrpcError,
  NotFoundError,
  PermissionDeniedError,
  RaceUpdateError,
  UnauthenticatedError,
  UnavailableError,
  UnknownError,
  ValidationError,
} from './errors.js';

describe('GrpcError', () => {
  it('should create error with message', () => {
    const error = new GrpcError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('GrpcError');
    expect(error.details).toEqual([]);
  });

  it('should create error with details', () => {
    const error = new GrpcError('Test error', {
      details: [{ type: 'localizedMessage', locale: 'en', message: 'Localized message' }],
    });
    expect(error.details).toHaveLength(1);
    expect(error.details[0]).toEqual({
      type: 'localizedMessage',
      locale: 'en',
      message: 'Localized message',
    });
  });

  it('should get localizedMessage from details', () => {
    const error = new GrpcError('Test error', {
      details: [{ type: 'localizedMessage', locale: 'en', message: 'User-friendly message' }],
    });
    expect(error.localizedMessage).toBe('User-friendly message');
  });

  it('should return undefined if no localizedMessage in details', () => {
    const error = new GrpcError('Test error');
    expect(error.localizedMessage).toBeUndefined();
  });

  it('should preserve cause', () => {
    const cause = new Error('Original error');
    const error = new GrpcError('Wrapped error', { cause });
    expect(error.cause).toBe(cause);
  });
});

describe('Error subclasses', () => {
  it('AbortedError should have correct message and name', () => {
    const error = new AbortedError();
    expect(error.message).toBe('Aborted by client');
    expect(error.name).toBe('AbortedError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('AlreadyExistsError should have correct message and name', () => {
    const error = new AlreadyExistsError();
    expect(error.message).toBe('Already exists');
    expect(error.name).toBe('AlreadyExistsError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('DeadlineExceededError should have correct message and name', () => {
    const error = new DeadlineExceededError();
    expect(error.message).toBe('Request took too long to respond');
    expect(error.name).toBe('DeadlineExceededError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('NotFoundError should have correct message and name', () => {
    const error = new NotFoundError();
    expect(error.message).toBe('Not found');
    expect(error.name).toBe('NotFoundError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('PermissionDeniedError should have correct message and name', () => {
    const error = new PermissionDeniedError();
    expect(error.message).toBe('Permission denied');
    expect(error.name).toBe('PermissionDeniedError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('RaceUpdateError should have correct message and name', () => {
    const error = new RaceUpdateError();
    expect(error.message).toBe('Attempt to update after the item is already updated elsewhere');
    expect(error.name).toBe('RaceUpdateError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('ValidationError should have correct message and name', () => {
    const error = new ValidationError();
    expect(error.message).toBe('Validation error');
    expect(error.name).toBe('ValidationError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('UnavailableError should have correct message and name', () => {
    const error = new UnavailableError();
    expect(error.message).toBe('Cannot connect to the server');
    expect(error.name).toBe('UnavailableError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('UnauthenticatedError should have correct message and name', () => {
    const error = new UnauthenticatedError();
    expect(error.message).toBe('Unauthenticated');
    expect(error.name).toBe('UnauthenticatedError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('UnknownError should have correct message and name', () => {
    const error = new UnknownError();
    expect(error.message).toBe('Unknown error');
    expect(error.name).toBe('UnknownError');
    expect(error).toBeInstanceOf(GrpcError);
  });

  it('subclasses should accept details', () => {
    const error = new ValidationError({
      details: [
        {
          type: 'badRequest',
          fieldViolations: [{ field: 'email', description: 'Invalid format' }],
        },
      ],
    });
    expect(error.details).toHaveLength(1);
    expect(error.details[0]).toEqual({
      type: 'badRequest',
      fieldViolations: [{ field: 'email', description: 'Invalid format' }],
    });
  });
});
