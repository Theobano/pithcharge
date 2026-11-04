import { FastifyPluginAsync } from "fastify";
import { auth, fromNodeHeaders } from "@pithcharge/auth";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Protected route requires valid Bearer token
 fastify.route({
  method: ["GET", "POST"],
  url: "/auth/*",
  async handler(request, reply) {
    try {
      // Construct request URL
      const url = new URL(request.url, `http://${request.headers.host}`);
      
      // Convert Fastify headers to standard Headers object
      const headers = fromNodeHeaders(request.headers);
      // Create Fetch API-compatible request
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      // Process authentication request
      const response = await auth.handler(req);
      // Forward response to client
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    } catch (error :any) {
      fastify.log.error({ err: error }, "Authentication Error");
      return reply.status(500).send({
        code: "AUTH_FAILURE",
        message: "Internal authentication error",
      });
    }
  }
});
};

export default authRoutes;
