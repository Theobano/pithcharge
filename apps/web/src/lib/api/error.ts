export interface ApiErrorBody {
  code?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Builds an ApiError from a failed response; all BFF errors use the Better Auth `{ code, message }` shape. */
export async function toApiError(response: Response, fallback?: string): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(
    body?.message || fallback || `Request failed with status ${response.status}.`,
    response.status,
    body?.code,
  );
}
