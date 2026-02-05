import { BinaryReader, WireType } from '@protobuf-ts/runtime';
import type { ErrorDetail } from '../types.js';
import { type Any, parseStatus } from './status.js';

// Type URLs for google.rpc error detail types
const TYPE_URLS = {
  LOCALIZED_MESSAGE: 'type.googleapis.com/google.rpc.LocalizedMessage',
  BAD_REQUEST: 'type.googleapis.com/google.rpc.BadRequest',
  DEBUG_INFO: 'type.googleapis.com/google.rpc.DebugInfo',
  ERROR_INFO: 'type.googleapis.com/google.rpc.ErrorInfo',
  RETRY_INFO: 'type.googleapis.com/google.rpc.RetryInfo',
  QUOTA_FAILURE: 'type.googleapis.com/google.rpc.QuotaFailure',
  PRECONDITION_FAILURE: 'type.googleapis.com/google.rpc.PreconditionFailure',
  REQUEST_INFO: 'type.googleapis.com/google.rpc.RequestInfo',
  RESOURCE_INFO: 'type.googleapis.com/google.rpc.ResourceInfo',
  HELP: 'type.googleapis.com/google.rpc.Help',
} as const;

/**
 * Result of decoding a google.rpc.Status.
 */
export interface DecodedGrpcStatus {
  code: number;
  message: string;
  localizedMessage: string | undefined;
  details: ErrorDetail[];
}

/**
 * Decode binary google.rpc.Status to structured error information.
 */
export function decodeGrpcStatus(data: Uint8Array): DecodedGrpcStatus {
  const status = parseStatus(data);
  const details = status.details.map(parseErrorDetail);

  // Extract localized message for convenience
  const localizedMessageDetail = details.find(
    (d): d is ErrorDetail & { type: 'localizedMessage' } => d.type === 'localizedMessage',
  );

  return {
    code: status.code,
    message: status.message,
    localizedMessage: localizedMessageDetail?.message,
    details,
  };
}

/**
 * Parse an Any message into a typed ErrorDetail.
 */
function parseErrorDetail(any: Any): ErrorDetail {
  switch (any.typeUrl) {
    case TYPE_URLS.LOCALIZED_MESSAGE:
      return parseLocalizedMessage(any.value);
    case TYPE_URLS.BAD_REQUEST:
      return parseBadRequest(any.value);
    case TYPE_URLS.DEBUG_INFO:
      return parseDebugInfo(any.value);
    case TYPE_URLS.ERROR_INFO:
      return parseErrorInfo(any.value);
    case TYPE_URLS.RETRY_INFO:
      return parseRetryInfo(any.value);
    case TYPE_URLS.QUOTA_FAILURE:
      return parseQuotaFailure(any.value);
    case TYPE_URLS.PRECONDITION_FAILURE:
      return parsePreconditionFailure(any.value);
    case TYPE_URLS.REQUEST_INFO:
      return parseRequestInfo(any.value);
    case TYPE_URLS.RESOURCE_INFO:
      return parseResourceInfo(any.value);
    case TYPE_URLS.HELP:
      return parseHelp(any.value);
    default:
      return {
        type: 'unknown',
        typeUrl: any.typeUrl,
        value: any.value,
      };
  }
}

function parseLocalizedMessage(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  let locale = '';
  let message = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) locale = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) message = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { type: 'localizedMessage', locale, message };
}

function parseBadRequest(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  const fieldViolations: Array<{ field: string; description: string }> = [];

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === 1 && wireType === WireType.LengthDelimited) {
      const violationBytes = reader.bytes();
      fieldViolations.push(parseFieldViolation(violationBytes));
    } else {
      reader.skip(wireType);
    }
  }

  return { type: 'badRequest', fieldViolations };
}

function parseFieldViolation(data: Uint8Array): { field: string; description: string } {
  const reader = new BinaryReader(data);
  let field = '';
  let description = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) field = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) description = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { field, description };
}

function parseDebugInfo(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  const stackEntries: string[] = [];
  let detail = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) stackEntries.push(reader.string());
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) detail = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { type: 'debugInfo', stackEntries, detail };
}

function parseErrorInfo(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  let reason = '';
  let domain = '';
  const metadata: Record<string, string> = {};

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) reason = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) domain = reader.string();
        else reader.skip(wireType);
        break;
      case 3:
        if (wireType === WireType.LengthDelimited) {
          const mapEntry = parseMapEntry(reader.bytes());
          metadata[mapEntry.key] = mapEntry.value;
        } else {
          reader.skip(wireType);
        }
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { type: 'errorInfo', reason, domain, metadata };
}

function parseMapEntry(data: Uint8Array): { key: string; value: string } {
  const reader = new BinaryReader(data);
  let key = '';
  let value = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) key = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) value = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { key, value };
}

function parseRetryInfo(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  let retryDelaySeconds = 0;

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === 1 && wireType === WireType.LengthDelimited) {
      // Duration message: seconds (field 1) and nanos (field 2)
      const durationBytes = reader.bytes();
      const durationReader = new BinaryReader(durationBytes);
      while (durationReader.pos < durationBytes.length) {
        const [dFieldNo, dWireType] = durationReader.tag();
        if (dFieldNo === 1 && dWireType === WireType.Varint) {
          retryDelaySeconds = Number(durationReader.int64());
        } else {
          durationReader.skip(dWireType);
        }
      }
    } else {
      reader.skip(wireType);
    }
  }

  return { type: 'retryInfo', retryDelaySeconds };
}

function parseQuotaFailure(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  const violations: Array<{ subject: string; description: string }> = [];

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === 1 && wireType === WireType.LengthDelimited) {
      const violationBytes = reader.bytes();
      violations.push(parseQuotaViolation(violationBytes));
    } else {
      reader.skip(wireType);
    }
  }

  return { type: 'quotaFailure', violations };
}

function parseQuotaViolation(data: Uint8Array): { subject: string; description: string } {
  const reader = new BinaryReader(data);
  let subject = '';
  let description = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) subject = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) description = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { subject, description };
}

function parsePreconditionFailure(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  const violations: Array<{ type: string; subject: string; description: string }> = [];

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === 1 && wireType === WireType.LengthDelimited) {
      const violationBytes = reader.bytes();
      violations.push(parsePreconditionViolation(violationBytes));
    } else {
      reader.skip(wireType);
    }
  }

  return { type: 'preconditionFailure', violations };
}

function parsePreconditionViolation(data: Uint8Array): { type: string; subject: string; description: string } {
  const reader = new BinaryReader(data);
  let type = '';
  let subject = '';
  let description = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) type = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) subject = reader.string();
        else reader.skip(wireType);
        break;
      case 3:
        if (wireType === WireType.LengthDelimited) description = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { type, subject, description };
}

function parseRequestInfo(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  let requestId = '';
  let servingData = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) requestId = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) servingData = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { type: 'requestInfo', requestId, servingData };
}

function parseResourceInfo(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  let resourceType = '';
  let resourceName = '';
  let owner = '';
  let description = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) resourceType = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) resourceName = reader.string();
        else reader.skip(wireType);
        break;
      case 3:
        if (wireType === WireType.LengthDelimited) owner = reader.string();
        else reader.skip(wireType);
        break;
      case 4:
        if (wireType === WireType.LengthDelimited) description = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { type: 'resourceInfo', resourceType, resourceName, owner, description };
}

function parseHelp(data: Uint8Array): ErrorDetail {
  const reader = new BinaryReader(data);
  const links: Array<{ description: string; url: string }> = [];

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === 1 && wireType === WireType.LengthDelimited) {
      const linkBytes = reader.bytes();
      links.push(parseHelpLink(linkBytes));
    } else {
      reader.skip(wireType);
    }
  }

  return { type: 'help', links };
}

function parseHelpLink(data: Uint8Array): { description: string; url: string } {
  const reader = new BinaryReader(data);
  let description = '';
  let url = '';

  while (reader.pos < data.length) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1:
        if (wireType === WireType.LengthDelimited) description = reader.string();
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === WireType.LengthDelimited) url = reader.string();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }

  return { description, url };
}
