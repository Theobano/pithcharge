import fp from "fastify-plugin";
import cors, { FastifyCorsOptions } from "@fastify/cors";

const PRIVATE_NETWORK_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/;

export default fp<FastifyCorsOptions>(async (fastify) => {
  const trustedOrigins = (process.env.TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV === 'production' && trustedOrigins.length === 0) {
    throw new Error('TRUSTED_ORIGINS must contain at least one browser origin in production.');
  }

  await fastify.register(cors, {
    // Development also accepts private-network origins so the app can be tested from a phone.
    origin: process.env.NODE_ENV === 'production'
      ? trustedOrigins
      : [...trustedOrigins, PRIVATE_NETWORK_ORIGIN],
    exposedHeaders: ["X-Guest-ID"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "x-api-key",
      "x-tenant-id",
      "x-guest-id",
    ],
    credentials: true,
    strictPreflight: false,
  });
});
