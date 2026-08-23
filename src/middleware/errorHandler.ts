import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { fail } from '../utils/response';
import { createLogger } from '../utils/logger';

const log = createLogger('errorHandler');

/**
 * Custom application error with HTTP status code.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Global Express error handler returning consistent JSON errors.
 */
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    log.warn('AppError', {
      method: req.method,
      path: req.path,
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    });
    res.status(err.statusCode).json(fail(err.message, err.code, err.details));
    return;
  }

  if (err instanceof ZodError) {
    const fieldErrors = err.flatten().fieldErrors;
    log.warn('Validation failed', {
      method: req.method,
      path: req.path,
      fieldErrors,
      body: req.body,
    });
    res.status(400).json(
      fail('Validation failed', 'VALIDATION_ERROR', fieldErrors)
    );
    return;
  }

  log.error('Unhandled error', {
    method: req.method,
    path: req.path,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json(fail('Internal server error', 'INTERNAL_ERROR'));
};
