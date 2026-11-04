import { FastifyPluginAsync } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { db } from '@pithcharge/db';
import type { ChargingHubDetails } from '@pithcharge/cms-adapters';
import { auditAdminAction } from '../../../../services/admin.service';
import { resolveChargingRate } from '../../../../services/charging-rate.service';

const Money = Type.Union([Type.Number({ minimum: 0, maximum: 1_000_000 }), Type.Null()]);

const UpsertRate = Type.Object({
  scope: Type.Union([Type.Literal('PLATFORM'), Type.Literal('HUB'), Type.Literal('STATION')]),
  scopeId: Type.Optional(Type.String({ maxLength: 120 })),
  source: Type.Union([Type.Literal('MANUAL'), Type.Literal('CSMS')]),
  currency: Type.String({ minLength: 3, maxLength: 3 }),
  ratePerKwh: Type.Optional(Money),
  ratePerMinute: Type.Optional(Money),
  sessionFee: Type.Optional(Money),
  idleFeePerMinute: Type.Optional(Money),
}, { additionalProperties: false });

const adminChargingRateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requirePlatformAdmin);

  fastify.get('/charging-rates', async () => {
    const [rates, hubs] = await Promise.all([
      db.chargingRate.findMany({ orderBy: [{ scope: 'asc' }, { scopeId: 'asc' }] }),
      fastify.cms.listHubs({ limit: 200 }).then((result) => result.data).catch((): ChargingHubDetails[] => []),
    ]);
    return {
      data: {
        rates,
        hubs: hubs.map((hub: ChargingHubDetails) => ({
          id: hub.id,
          name: hub.name,
          stations: hub.stations.map((station: ChargingHubDetails['stations'][number]) => ({ id: station.id, label: station.label ?? station.ocppConnectionName })),
        })),
      },
    };
  });

  fastify.put<{ Body: Static<typeof UpsertRate> }>(
    '/charging-rates',
    { schema: { body: UpsertRate } },
    async (request, reply) => {
      const body = request.body;
      const scopeId = body.scope === 'PLATFORM' ? '' : body.scopeId?.trim() ?? '';
      if (body.scope !== 'PLATFORM' && !scopeId) {
        return reply.code(400).send({ message: 'A hub or station must be selected.' });
      }
      const values = {
        source: body.source,
        currency: body.currency.toUpperCase(),
        ratePerKwh: body.ratePerKwh ?? null,
        ratePerMinute: body.ratePerMinute ?? null,
        sessionFee: body.sessionFee ?? null,
        idleFeePerMinute: body.idleFeePerMinute ?? null,
        updatedBy: request.user.id,
      };
      if (body.source === 'MANUAL' && values.ratePerKwh === null && values.ratePerMinute === null &&
        values.sessionFee === null && values.idleFeePerMinute === null) {
        return reply.code(400).send({ message: 'Enter at least one price, or choose the CSMS tariff as the source.' });
      }
      const rate = await db.chargingRate.upsert({
        where: { scope_scopeId: { scope: body.scope, scopeId } },
        create: { scope: body.scope, scopeId, ...values },
        update: values,
      });
      await auditAdminAction({
        actorId: request.user.id,
        action: 'admin.charging_rate.saved',
        targetType: 'ChargingRate',
        targetId: rate.id,
        metadata: { scope: body.scope, scopeId: scopeId ?? null, source: body.source },
      });
      return { data: rate };
    },
  );

  fastify.delete<{ Params: { id: string } }>('/charging-rates/:id', async (request, reply) => {
    const rate = await db.chargingRate.findUnique({ where: { id: request.params.id } });
    if (!rate) return reply.code(404).send({ message: 'Rate not found.' });
    await db.chargingRate.delete({ where: { id: rate.id } });
    await auditAdminAction({
      actorId: request.user.id,
      action: 'admin.charging_rate.deleted',
      targetType: 'ChargingRate',
      targetId: rate.id,
      metadata: { scope: rate.scope, scopeId: rate.scopeId ?? null },
    });
    return { success: true };
  });

  fastify.get<{ Querystring: { stationId: string; evseId?: number; connectorId?: number } }>(
    '/charging-rates/effective',
    {
      schema: {
        querystring: Type.Object({
          stationId: Type.String({ minLength: 1 }),
          evseId: Type.Optional(Type.Integer({ minimum: 1 })),
          connectorId: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
      },
    },
    async (request) => {
      const { stationId, evseId = 1, connectorId = 1 } = request.query;
      return { data: await resolveChargingRate(fastify.cms, { stationId, evseId, connectorId }) };
    },
  );
};

export default adminChargingRateRoutes;
