import {
  type ClientStreamingCall,
  DuplexStreamingCall,
  type MethodInfo,
  RpcError,
  type RpcInterceptor,
  type RpcMetadata,
  RpcOutputStreamController,
  ServerStreamingCall,
} from '@protobuf-ts/runtime-rpc';
import type { BrowserLoggerConfig, CallType, Verbosity } from './types.js';

const streamStyle = 'color: #9752cc;';
const dataStyle = 'color: #5c7ced;';
const errorStyle = 'color: #f00505;';
const cancelledStyle = 'color: #999;text-decoration: line-through;';

let requestId = 0;

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');

  return `${h}:${m}:${s}`;
}

function safeLogs(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('Failed printing log', e);
    console.groupEnd();
  }
}

const verbosityLevels: Record<Verbosity, number> = {
  errors: 0,
  normal: 1,
  verbose: 2,
};

export function createBrowserLogger(config: BrowserLoggerConfig = {}): RpcInterceptor {
  const { typeRegistry, verbosity = 'normal' } = config;
  const jsonOpts = typeRegistry ? { typeRegistry } : undefined;

  const getVerbosity = (method: MethodInfo, callType: CallType): Verbosity => {
    if (typeof verbosity === 'function') {
      return verbosity({ method, callType });
    }

    return verbosity;
  };

  const canLog = (method: MethodInfo, callType: CallType, requiredLevel: Verbosity): boolean => {
    const currentVerbosity = getVerbosity(method, callType);

    return verbosityLevels[currentVerbosity] >= verbosityLevels[requiredLevel];
  };

  return {
    interceptUnary(next, method, input, options) {
      const id = ++requestId;
      const start = Date.now();

      const openGroup = (style: string) =>
        console.groupCollapsed(`%c#${id}: ${Date.now() - start}ms -> ${method.service.typeName}/${method.name}`, style);
      const printSettings = (style: string) => console.log('%csc', style, method);
      const printMetadata = (style: string) => console.log('%c**', style, options);
      const printRequest = (style: string) => console.log('%c>>', style, method.I.toJson(input, jsonOpts));
      const closeGroup = () => console.groupEnd();

      const call = next(method, input, options);

      call.response.then(
        (response) => {
          call.status.then((status) => {
            const failed = status.code !== 'OK';
            const style = failed ? errorStyle : dataStyle;

            if (canLog(method, 'unary', 'normal')) {
              safeLogs(() => {
                openGroup(dataStyle);

                if (canLog(method, 'unary', 'verbose')) {
                  printSettings(dataStyle);
                }

                printRequest(dataStyle);

                if (canLog(method, 'unary', 'verbose')) {
                  printMetadata(dataStyle);
                }

                console.log('%c<<', style, method.O.toJson(response, jsonOpts));
                closeGroup();
              });
            }
          });
        },
        (e) => {
          let style = errorStyle;

          if ((e instanceof RpcError && e.code === 'CANCELLED') || options.abort?.aborted) {
            style = cancelledStyle;
          }

          if (canLog(method, 'unary', 'errors')) {
            safeLogs(() => {
              openGroup(style);

              if (canLog(method, 'unary', 'verbose')) {
                printSettings(style);
              }

              printRequest(style);

              if (canLog(method, 'unary', 'verbose')) {
                printMetadata(style);
              }

              console.log('%c<<', style, e instanceof RpcError ? `${e.code}: ${e.message}` : e);
              closeGroup();
            });
          }
        },
      );

      return call;
    },

    interceptServerStreaming(next, method, input, options) {
      const id = ++requestId;

      const openGroup = (style: string) =>
        console.groupCollapsed(
          `%c#${id}: ${formatTime(new Date())} -> ${method.service.typeName}/${method.name}`,
          style,
        );
      const printSettings = (style: string) => console.log('%csc', style, method);
      const printMetadata = (style: string) => console.log('%c**', style, options);
      const printRequest = (style: string) => console.log('%c>>', style, method.I.toJson(input, jsonOpts));
      const closeGroup = () => console.groupEnd();

      if (canLog(method, 'serverStreaming', 'normal')) {
        safeLogs(() => {
          openGroup(streamStyle);

          if (canLog(method, 'serverStreaming', 'verbose')) {
            printSettings(streamStyle);
          }

          printRequest(streamStyle);

          if (canLog(method, 'serverStreaming', 'verbose')) {
            printMetadata(streamStyle);
          }

          closeGroup();
        });
      }

      const call = next(method, input, options);
      const outputStream = new RpcOutputStreamController<object>();

      call.responses.onNext((message, error, done) => {
        if (message) {
          if (canLog(method, 'serverStreaming', 'normal')) {
            safeLogs(() => {
              openGroup(streamStyle);
              console.log('%c<<', streamStyle, method.O.toJson(message, jsonOpts));
              closeGroup();
            });
          }

          outputStream.notifyMessage(message);
        }

        if (error) {
          let style = errorStyle;

          if ((error instanceof RpcError && error.code === 'CANCELLED') || options.abort?.aborted) {
            style = cancelledStyle;
          }

          if (canLog(method, 'serverStreaming', 'errors')) {
            safeLogs(() => {
              openGroup(style);
              console.log('%c<<', style, error instanceof RpcError ? `${error.code}: ${error.message}` : error);
              closeGroup();
            });
          }

          outputStream.notifyError(error);
        }

        if (done) outputStream.notifyComplete();
      });

      return new ServerStreamingCall(
        method as MethodInfo<object, object>,
        options.meta ?? {},
        input,
        call.headers,
        outputStream,
        call.status,
        call.trailers,
      );
    },

    interceptClientStreaming<I extends object, O extends object>(
      next: (
        method: MethodInfo<I, O>,
        options: { meta?: RpcMetadata; abort?: AbortSignal },
      ) => ClientStreamingCall<I, O>,
      method: MethodInfo<I, O>,
      options: { meta?: RpcMetadata; abort?: AbortSignal },
    ): ClientStreamingCall<I, O> {
      const id = ++requestId;

      const openGroup = (style: string) =>
        console.groupCollapsed(
          `%c#${id}: ${formatTime(new Date())} -> ${method.service.typeName}/${method.name} [client-stream]`,
          style,
        );
      const printSettings = (style: string) => console.log('%csc', style, method);
      const printMetadata = (style: string) => console.log('%c**', style, options);
      const closeGroup = () => console.groupEnd();

      if (canLog(method, 'clientStreaming', 'normal')) {
        safeLogs(() => {
          openGroup(streamStyle);

          if (canLog(method, 'clientStreaming', 'verbose')) {
            printSettings(streamStyle);
          }

          console.log('%c>>', streamStyle, 'client streaming started');

          if (canLog(method, 'clientStreaming', 'verbose')) {
            printMetadata(streamStyle);
          }

          closeGroup();
        });
      }

      const call = next(method, options);

      call.response.then(
        (r) => {
          if (canLog(method, 'clientStreaming', 'normal')) {
            safeLogs(() => {
              openGroup(streamStyle);
              console.log('%c<<', streamStyle, method.O.toJson(r, jsonOpts));
              closeGroup();
            });
          }
        },
        (e) => {
          if (canLog(method, 'clientStreaming', 'errors')) {
            safeLogs(() => {
              openGroup(errorStyle);
              console.log('%c<<', errorStyle, e instanceof RpcError ? `${e.code}: ${e.message}` : e);
              closeGroup();
            });
          }
        },
      );

      return call;
    },

    interceptDuplex<I extends object, O extends object>(
      next: (
        method: MethodInfo<I, O>,
        options: { meta?: RpcMetadata; abort?: AbortSignal },
      ) => DuplexStreamingCall<I, O>,
      method: MethodInfo<I, O>,
      options: { meta?: RpcMetadata; abort?: AbortSignal },
    ): DuplexStreamingCall<I, O> {
      const id = ++requestId;

      const openGroup = (style: string) =>
        console.groupCollapsed(
          `%c#${id}: ${formatTime(new Date())} -> ${method.service.typeName}/${method.name} [duplex]`,
          style,
        );
      const printSettings = (style: string) => console.log('%csc', style, method);
      const printMetadata = (style: string) => console.log('%c**', style, options);
      const closeGroup = () => console.groupEnd();

      if (canLog(method, 'duplex', 'normal')) {
        safeLogs(() => {
          openGroup(streamStyle);

          if (canLog(method, 'duplex', 'verbose')) {
            printSettings(streamStyle);
          }

          console.log('%c<>', streamStyle, 'duplex streaming started');

          if (canLog(method, 'duplex', 'verbose')) {
            printMetadata(streamStyle);
          }

          closeGroup();
        });
      }

      const call = next(method, options);
      const outputStream = new RpcOutputStreamController<O>();

      call.responses.onNext((message, error, done) => {
        if (message) {
          if (canLog(method, 'duplex', 'normal')) {
            safeLogs(() => {
              openGroup(streamStyle);
              console.log('%c<<', streamStyle, method.O.toJson(message, jsonOpts));
              closeGroup();
            });
          }

          outputStream.notifyMessage(message);
        }

        if (error) {
          if (canLog(method, 'duplex', 'errors')) {
            safeLogs(() => {
              openGroup(errorStyle);
              console.log('%c<<', errorStyle, error instanceof RpcError ? `${error.code}: ${error.message}` : error);
              closeGroup();
            });
          }

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
    },
  };
}
