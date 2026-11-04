// import type { FastifyPluginAsync } from "fastify";
// import fp from "fastify-plugin";
// import { auth, toNodeHandler } from "@pithcharge/auth";

// const authRoutesPlugin: FastifyPluginAsync = async (fastify) => {
//   // Allow Better Auth to parse its own body streams without Fastify body parser interference
//   fastify.addContentTypeParser(
//     "application/json",
//     { parseAs: "buffer" },
//     (req, body, done) => {
//       done(null, body);
//     },
//   );

//   // Catch-all route handler for all Better Auth endpoints (sign-in, passkeys, phone-otp, orgs, etc.)
//   fastify.all("/api/v1/auth/*", async (request, reply) => {
//     // Hand off incoming Node request/response directly to Better Auth engine
//     await toNodeHandler(auth)(request.raw, reply.raw);
//     reply.sent = true;
//   });
// };

// export default fp(authRoutesPlugin);
