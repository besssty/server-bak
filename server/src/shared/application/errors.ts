/** Application-файл: errors. */

export type ApplicationErrorKind =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unprocessable'
  | 'external';

export class ApplicationError extends Error {
  constructor(
    message: string,
    public readonly kind: ApplicationErrorKind = 'validation'
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
