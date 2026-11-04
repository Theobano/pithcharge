import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createCmsAdapter, ICmsAdapter, OcppIdTokenType } from "@pithcharge/cms-adapters";
import { setTokenRegistrar } from "@pithcharge/auth";

declare module "fastify" {
  interface FastifyInstance {
    cms: ICmsAdapter;
  }
}

const cmsPlugin: FastifyPluginAsync = async (fastify) => {
  const configuredProvider = process.env.CMS_PROVIDER;
  if (
    process.env.NODE_ENV === "production" &&
    configuredProvider !== "citrineos"
  ) {
    throw new Error(
      "Production requires CMS_PROVIDER=citrineos; the mock adapter is development-only.",
    );
  }
  const provider = configuredProvider || "mock";
  if (provider !== "mock" && provider !== "citrineos") {
    throw new Error(`Unsupported CMS_PROVIDER "${provider}".`);
  }
  if (
    process.env.NODE_ENV === "production" &&
    provider === "citrineos" &&
    !process.env.CITRINEOS_WEBHOOK_SECRET
  ) {
    throw new Error("Production CitrineOS integration requires CITRINEOS_WEBHOOK_SECRET.");
  }
  let adapter: ICmsAdapter;
  switch (provider) {
    case "citrineos":
      const baseUrl = process.env.CITRINEOS_URL;
      const apiKey = process.env.CITRINEOS_API_KEY;
      const graphqlUrl = process.env.CITRINEOS_GRAPHQL_URL;
      if (!baseUrl) {
        throw new Error("CitrineOS configuration requires CITRINEOS_URL.");
      }
      if (!apiKey) {
        throw new Error("CitrineOS configuration requires CITRINEOS_API_KEY.");
      }

      adapter = createCmsAdapter({
        provider,
        citrineos: {
          baseUrl,
          graphqlUrl,
          apiKey,
          adminSecret: process.env.CITRINEOS_HASURA_ADMIN_SECRET,
          tenantId: process.env.CITRINEOS_TENANT_ID,
        },
      });
      break;

    case "mock":
      adapter = createCmsAdapter({ provider: "mock" });
      fastify.log.warn("Using the mock CMS adapter; configure CitrineOS before production.");
      break;
  }

  fastify.decorate("cms", adapter);
  setTokenRegistrar(async ({ idToken, tokenType, concurrentTransaction }) => {
    const result = await adapter.syncIdToken({
      idToken,
      idTokenType: tokenType as OcppIdTokenType,
      status: "Accepted",
      concurrentTransaction: concurrentTransaction ?? true,
    });
    return { accepted: result.status === "Accepted" };
  });
  fastify.addHook("onClose", async () => setTokenRegistrar(undefined));
  fastify.log.info({ provider }, "CMS Adapter initialized");
};

export default fp(cmsPlugin, { name: "cms-adapter" });
