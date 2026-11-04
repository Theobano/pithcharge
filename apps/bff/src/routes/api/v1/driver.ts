import { FastifyPluginAsync } from "fastify";

export const driverRoutes: FastifyPluginAsync = async (fastify) => {
  // Protected route requires valid Bearer token
  fastify.get(
    "driver/me",
    { preHandler: [fastify.authenticate] },
    async (request) => {
      // request.user is guaranteed to be populated here
      // const ocppIdToken = await fastify.auth.getDriverIdToken(request.user!.id);
      
      return {
        user: request.user,
        // ocppIdToken,
      };
    }
  );
};

// Allowing guests but enforcing ABAC authorization
