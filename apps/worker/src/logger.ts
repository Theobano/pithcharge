export type Logger = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

function write(level: string, obj: object, msg: string) {
  const { err, ...rest } = obj as { err?: unknown };
  const entry = {
    level,
    time: new Date().toISOString(),
    service: 'worker',
    msg,
    ...rest,
    ...(err ? { err: err instanceof Error ? { message: err.message, stack: err.stack } : err } : {}),
  };
  (level === 'error' ? console.error : console.log)(JSON.stringify(entry));
}

export const logger: Logger = {
  info: (obj, msg) => write('info', obj, msg),
  warn: (obj, msg) => write('warn', obj, msg),
  error: (obj, msg) => write('error', obj, msg),
};
