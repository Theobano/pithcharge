import { FastifyPluginAsync } from "fastify";
import {
  ConnectorType,
  StationOperationalStatus,
} from "@pithcharge/cms-adapters";
import { createUserNotification } from "../../../services/notification.service";
import { ChargingStartError, startCharging } from "../../../services/charging";
import { stopCharging } from "../../../services/charging/sessions";

const stationRoutes: FastifyPluginAsync = async (fastify, opts) => {
  // GET /api/v1/stations - Search & filter chargers
  fastify.get<{
    Querystring: {
      hubId?: string;
      search?: string;
      status?: StationOperationalStatus;
      connectorType?: ConnectorType;
      page?: number;
      limit?: number;
    };
  }>('/stations', async (request) => {
    const { hubId, search, status, connectorType, page, limit } = request.query;
    return fastify.cms.listStations({
      hubId,
      search,
      status,
      connectorType,
      page,
      limit,
    });
  });

  // GET /api/v1/stations/:id - Charger details & live EVSE states
  fastify.get<{
    Params: { id: string };
  }>("/stations/:id", async (request, reply) => {
    const station = await fastify.cms.getStationDetails(request.params.id);
    if (!station) {
      return reply.code(404).send({ error: "Station not found" });
    }
    return station;
  });

  // GET /api/v1/stations/:id/status - Real-time status telemetry
  fastify.get<{
    Params: { id: string };
  }>("/stations/:id/status", async (request) => {
    return fastify.cms.getStationStatus(request.params.id);
  });

  // POST /api/v1/stations/:id/remote-start - Start a charging session
  fastify.post<{
    Params: { id: string };
    Body: { evseId: number; connectorId?: number; idToken?: string; limitKw?: number; idempotencyKey?: string };
  }>("/stations/:id/remote-start", {
    preHandler: [
      fastify.authenticate,
      fastify.authorize("ocpp:RemoteStart", () => ({
        stationId: "",
        isOnline: true,
        connectorStatus: "Available",
        ownerOrganizationId: "",
      })),
    ],
  }, async (request, reply) => {
    try {
      const outcome = await startCharging(
        { cms: fastify.cms, log: fastify.log },
        {
          actor: {
            userId: request.user.id,
            isAnonymous: request.isAnonymous,
            organizationId: request.user.organizationId,
            defaultIdToken: request.user.idToken,
          },
          stationId: request.params.id,
          evseId: request.body.evseId,
          connectorId: request.body.connectorId,
          idToken: request.body.idToken,
          limitKw: request.body.limitKw,
          idempotencyKey: request.body.idempotencyKey,
        },
      );
      return outcome.accepted ? outcome.body : reply.code(400).send(outcome.body);
    } catch (error) {
      if (error instanceof ChargingStartError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  // POST /api/v1/stations/:id/remote-stop - Stop a charging session
  fastify.post<{
    Params: { id: string };
    Body: { sessionId?: string; transactionId?: string };
  }>("/stations/:id/remote-stop", {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      return await stopCharging(
        { cms: fastify.cms, log: fastify.log },
        {
          id: request.user.id,
          role: request.user.role,
          organizationId: request.user.organizationId,
          organizationRole: request.user.organizationRole,
        },
        { id: request.body.sessionId, transactionId: request.body.transactionId },
      );
    } catch (error) {
      if (error instanceof ChargingStartError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  // POST /api/v1/stations/:id/unlock - Unlock EVSE connector solenoid
  fastify.post<{
    Params: { id: string };
    Body: { evseId: number; connectorId: number };
  }>("/stations/:id/unlock", {
    preHandler: [
      fastify.requireRegistered,
      fastify.authorize("ocpp:ResetHardware", () => ({
        stationId: "",
        isOnline: true,
        connectorStatus: "Available",
        ownerOrganizationId: "",
      })),
    ],
  }, async (request) => {
    const { evseId, connectorId } = request.body;
    fastify.log.info(
      { userId: request.user.id, stationId: request.params.id, evseId, connectorId },
      "Connector unlock requested",
    );
    return fastify.cms.unlockConnector({
      stationId: request.params.id,
      evseId,
      connectorId,
    });
  });

  // POST /api/v1/stations/:id/reset - Hard/Soft reboot charger
  fastify.post<{
    Params: { id: string };
    Body: { type?: "Hard" | "Soft" };
  }>("/stations/:id/reset", {
    preHandler: [
      fastify.requireRegistered,
      fastify.authorize("ocpp:ResetHardware", () => ({
        stationId: "",
        isOnline: true,
        connectorStatus: "Available",
        ownerOrganizationId: "",
      })),
    ],
  }, async (request) => {
    fastify.log.info(
      { userId: request.user.id, stationId: request.params.id, type: request.body.type || "Soft" },
      "Station reset requested",
    );
    return fastify.cms.resetStation({
      stationId: request.params.id,
      type: request.body.type || "Soft",
    });
  });
};

export default stationRoutes;
