type LogMeta = Record<string, unknown> | undefined;

/**
 * Formats optional metadata for console output.
 */
const formatMeta = (meta: LogMeta): string => {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' [meta unserializable]';
  }
};

/**
 * Creates a namespaced logger for server-side diagnostics.
 */
export const createLogger = (scope: string) => {
  const prefix = `[${scope}]`;

  return {
    /**
     * Verbose diagnostic output — development only.
     */
    debug: (message: string, meta?: LogMeta): void => {
      if (process.env.NODE_ENV === 'production') {
        return;
      }
      console.log(`${prefix} ${message}${formatMeta(meta)}`);
    },

    /**
     * Normal operational events worth tracing in production.
     */
    info: (message: string, meta?: LogMeta): void => {
      console.log(`${prefix} ${message}${formatMeta(meta)}`);
    },

    /**
     * Unexpected but non-fatal conditions.
     */
    warn: (message: string, meta?: LogMeta): void => {
      console.warn(`${prefix} ${message}${formatMeta(meta)}`);
    },

    /**
     * Failures and exceptions.
     */
    error: (message: string, meta?: LogMeta): void => {
      console.error(`${prefix} ${message}${formatMeta(meta)}`);
    },
  };
};
