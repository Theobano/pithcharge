import fp from "fastify-plugin";
import type { FastifyError } from "fastify";

/**
 * Every error response uses the Better Auth shape: `{ code, message, ...details }`.
 * Handlers may keep sending `{ error: "text" }`; it is normalized in `onSend`.
 */
const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  402: "PAYMENT_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
};

function defaultCode(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST");
}

export function normalizeErrorBody(status: number, body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    return { code: defaultCode(status), message: body };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { code: defaultCode(status), message: "Request failed." };
  }

  const { error, message, code, ...rest } = body as Record<string, unknown>;
  const text =
    typeof message === "string" && message
      ? message
      : typeof error === "string" && error
        ? error
        : "Request failed.";

  return {
    code: typeof code === "string" && code ? code : defaultCode(status),
    message: text,
    ...rest,
  };
}

export default fp(async (fastify) => {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, "Unhandled request error");

    const message = status >= 500 && process.env.NODE_ENV === "production"
      ? "Something went wrong. Please try again."
      : error.message;
    const code = error.validation
      ? "VALIDATION_ERROR"
      : (error as { code?: string }).code?.startsWith("FST_")
        ? (error as { code: string }).code
        : defaultCode(status);

    return reply.status(status).send({ code, message });
  });

  fastify.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ code: "NOT_FOUND", message: `Route ${request.method} ${request.url} not found.` }),
  );

  fastify.addHook("onSend", async (_request, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== "string" || payload.length === 0) return payload;
    const contentType = String(reply.getHeader("content-type") ?? "");
    if (!contentType.includes("application/json")) return payload;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return payload;
    }
    return JSON.stringify(normalizeErrorBody(reply.statusCode, parsed));
  });
});
