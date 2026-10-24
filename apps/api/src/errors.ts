import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: ContentfulStatusCode, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/** The one error shape used by every endpoint. */
export function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

export const unauthorized = (): ApiError => new ApiError(401, "unauthorized", "Please sign in to continue.");
export const notFound = (message = "This address does not exist."): ApiError => new ApiError(404, "not_found", message);
