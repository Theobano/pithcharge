// apps/bff/src/routes/user.ts
import type { FastifyInstance } from "fastify";
import { db } from "@pithcharge/db";

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/user/profile",
    { preHandler: [fastify.requireRegistered] },
    async (req, reply) => {
      const profile = await db.user.findUnique({
        where: { id: req.user.id },
        include: { members: { include: { organization: true } } },
      });

      return reply.send({ data: profile });
    }
  );
}