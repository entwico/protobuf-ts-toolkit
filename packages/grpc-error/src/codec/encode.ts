import { BinaryWriter, WireType } from '@protobuf-ts/runtime';
import type { GrpcError } from '../errors.js';
import type {
  BadRequestDetail,
  DebugInfoDetail,
  ErrorDetail,
  ErrorInfoDetail,
  HelpDetail,
  LocalizedMessageDetail,
  PreconditionFailureDetail,
  QuotaFailureDetail,
  RequestInfoDetail,
  ResourceInfoDetail,
  RetryInfoDetail,
} from '../types.js';
import { type Any, encodeStatus } from './status.js';

// Type URLs for google.rpc error detail types
const TYPE_URLS = {
  localizedMessage: 'type.googleapis.com/google.rpc.LocalizedMessage',
  badRequest: 'type.googleapis.com/google.rpc.BadRequest',
  debugInfo: 'type.googleapis.com/google.rpc.DebugInfo',
  errorInfo: 'type.googleapis.com/google.rpc.ErrorInfo',
  retryInfo: 'type.googleapis.com/google.rpc.RetryInfo',
  quotaFailure: 'type.googleapis.com/google.rpc.QuotaFailure',
  preconditionFailure: 'type.googleapis.com/google.rpc.PreconditionFailure',
  requestInfo: 'type.googleapis.com/google.rpc.RequestInfo',
  resourceInfo: 'type.googleapis.com/google.rpc.ResourceInfo',
  help: 'type.googleapis.com/google.rpc.Help',
} as const;

/**
 * gRPC status codes mapping from error class names.
 */
const ERROR_TO_GRPC_CODE: Record<string, number> = {
  AbortedError: 10, // ABORTED
  AlreadyExistsError: 6, // ALREADY_EXISTS
  DeadlineExceededError: 4, // DEADLINE_EXCEEDED
  NotFoundError: 5, // NOT_FOUND
  PermissionDeniedError: 7, // PERMISSION_DENIED
  RaceUpdateError: 10, // ABORTED
  ValidationError: 3, // INVALID_ARGUMENT
  UnavailableError: 14, // UNAVAILABLE
  UnauthenticatedError: 16, // UNAUTHENTICATED
  UnknownError: 2, // UNKNOWN
  GrpcError: 2, // UNKNOWN (base class)
};

/**
 * Encode a GrpcError to binary google.rpc.Status.
 *
 * @example
 * ```typescript
 * const error = new ValidationError({
 *   localizedMessage: 'Invalid input',
 *   details: [{
 *     type: 'badRequest',
 *     fieldViolations: [{ field: 'email', description: 'Invalid format' }]
 *   }]
 * });
 *
 * const binary = encodeGrpcStatus(error);
 * // Use binary in grpc-status-details-bin trailer
 * ```
 */
export function encodeGrpcStatus(error: GrpcError): Uint8Array {
  const details: Any[] = [];

  // Encode all error details
  for (const detail of error.details) {
    const encoded = encodeErrorDetail(detail);
    if (encoded) {
      details.push(encoded);
    }
  }

  const grpcCode = ERROR_TO_GRPC_CODE[error.constructor.name] ?? 2;

  return encodeStatus({
    code: grpcCode,
    message: error.message,
    details,
  });
}

/**
 * Encode an ErrorDetail to an Any message.
 */
function encodeErrorDetail(detail: ErrorDetail): Any | null {
  switch (detail.type) {
    case 'localizedMessage':
      return {
        typeUrl: TYPE_URLS.localizedMessage,
        value: encodeLocalizedMessage(detail),
      };
    case 'badRequest':
      return {
        typeUrl: TYPE_URLS.badRequest,
        value: encodeBadRequest(detail),
      };
    case 'debugInfo':
      return {
        typeUrl: TYPE_URLS.debugInfo,
        value: encodeDebugInfo(detail),
      };
    case 'errorInfo':
      return {
        typeUrl: TYPE_URLS.errorInfo,
        value: encodeErrorInfo(detail),
      };
    case 'retryInfo':
      return {
        typeUrl: TYPE_URLS.retryInfo,
        value: encodeRetryInfo(detail),
      };
    case 'quotaFailure':
      return {
        typeUrl: TYPE_URLS.quotaFailure,
        value: encodeQuotaFailure(detail),
      };
    case 'preconditionFailure':
      return {
        typeUrl: TYPE_URLS.preconditionFailure,
        value: encodePreconditionFailure(detail),
      };
    case 'requestInfo':
      return {
        typeUrl: TYPE_URLS.requestInfo,
        value: encodeRequestInfo(detail),
      };
    case 'resourceInfo':
      return {
        typeUrl: TYPE_URLS.resourceInfo,
        value: encodeResourceInfo(detail),
      };
    case 'help':
      return {
        typeUrl: TYPE_URLS.help,
        value: encodeHelp(detail),
      };
    case 'unknown':
      // Pass through unknown details as-is
      return {
        typeUrl: detail.typeUrl,
        value: detail.value,
      };
    default:
      return null;
  }
}

function encodeLocalizedMessage(detail: LocalizedMessageDetail): Uint8Array {
  const writer = new BinaryWriter();
  if (detail.locale) {
    writer.tag(1, WireType.LengthDelimited).string(detail.locale);
  }
  if (detail.message) {
    writer.tag(2, WireType.LengthDelimited).string(detail.message);
  }
  return writer.finish();
}

function encodeBadRequest(detail: BadRequestDetail): Uint8Array {
  const writer = new BinaryWriter();
  for (const violation of detail.fieldViolations) {
    const violationWriter = new BinaryWriter();
    if (violation.field) {
      violationWriter.tag(1, WireType.LengthDelimited).string(violation.field);
    }
    if (violation.description) {
      violationWriter.tag(2, WireType.LengthDelimited).string(violation.description);
    }
    writer.tag(1, WireType.LengthDelimited).bytes(violationWriter.finish());
  }
  return writer.finish();
}

function encodeDebugInfo(detail: DebugInfoDetail): Uint8Array {
  const writer = new BinaryWriter();
  for (const entry of detail.stackEntries) {
    writer.tag(1, WireType.LengthDelimited).string(entry);
  }
  if (detail.detail) {
    writer.tag(2, WireType.LengthDelimited).string(detail.detail);
  }
  return writer.finish();
}

function encodeErrorInfo(detail: ErrorInfoDetail): Uint8Array {
  const writer = new BinaryWriter();
  if (detail.reason) {
    writer.tag(1, WireType.LengthDelimited).string(detail.reason);
  }
  if (detail.domain) {
    writer.tag(2, WireType.LengthDelimited).string(detail.domain);
  }
  for (const [key, value] of Object.entries(detail.metadata)) {
    const mapWriter = new BinaryWriter();
    mapWriter.tag(1, WireType.LengthDelimited).string(key);
    mapWriter.tag(2, WireType.LengthDelimited).string(value);
    writer.tag(3, WireType.LengthDelimited).bytes(mapWriter.finish());
  }
  return writer.finish();
}

function encodeRetryInfo(detail: RetryInfoDetail): Uint8Array {
  const writer = new BinaryWriter();
  if (detail.retryDelaySeconds > 0) {
    // Duration message
    const durationWriter = new BinaryWriter();
    durationWriter.tag(1, WireType.Varint).int64(BigInt(detail.retryDelaySeconds));
    writer.tag(1, WireType.LengthDelimited).bytes(durationWriter.finish());
  }
  return writer.finish();
}

function encodeQuotaFailure(detail: QuotaFailureDetail): Uint8Array {
  const writer = new BinaryWriter();
  for (const violation of detail.violations) {
    const violationWriter = new BinaryWriter();
    if (violation.subject) {
      violationWriter.tag(1, WireType.LengthDelimited).string(violation.subject);
    }
    if (violation.description) {
      violationWriter.tag(2, WireType.LengthDelimited).string(violation.description);
    }
    writer.tag(1, WireType.LengthDelimited).bytes(violationWriter.finish());
  }
  return writer.finish();
}

function encodePreconditionFailure(detail: PreconditionFailureDetail): Uint8Array {
  const writer = new BinaryWriter();
  for (const violation of detail.violations) {
    const violationWriter = new BinaryWriter();
    if (violation.type) {
      violationWriter.tag(1, WireType.LengthDelimited).string(violation.type);
    }
    if (violation.subject) {
      violationWriter.tag(2, WireType.LengthDelimited).string(violation.subject);
    }
    if (violation.description) {
      violationWriter.tag(3, WireType.LengthDelimited).string(violation.description);
    }
    writer.tag(1, WireType.LengthDelimited).bytes(violationWriter.finish());
  }
  return writer.finish();
}

function encodeRequestInfo(detail: RequestInfoDetail): Uint8Array {
  const writer = new BinaryWriter();
  if (detail.requestId) {
    writer.tag(1, WireType.LengthDelimited).string(detail.requestId);
  }
  if (detail.servingData) {
    writer.tag(2, WireType.LengthDelimited).string(detail.servingData);
  }
  return writer.finish();
}

function encodeResourceInfo(detail: ResourceInfoDetail): Uint8Array {
  const writer = new BinaryWriter();
  if (detail.resourceType) {
    writer.tag(1, WireType.LengthDelimited).string(detail.resourceType);
  }
  if (detail.resourceName) {
    writer.tag(2, WireType.LengthDelimited).string(detail.resourceName);
  }
  if (detail.owner) {
    writer.tag(3, WireType.LengthDelimited).string(detail.owner);
  }
  if (detail.description) {
    writer.tag(4, WireType.LengthDelimited).string(detail.description);
  }
  return writer.finish();
}

function encodeHelp(detail: HelpDetail): Uint8Array {
  const writer = new BinaryWriter();
  for (const link of detail.links) {
    const linkWriter = new BinaryWriter();
    if (link.description) {
      linkWriter.tag(1, WireType.LengthDelimited).string(link.description);
    }
    if (link.url) {
      linkWriter.tag(2, WireType.LengthDelimited).string(link.url);
    }
    writer.tag(1, WireType.LengthDelimited).bytes(linkWriter.finish());
  }
  return writer.finish();
}
