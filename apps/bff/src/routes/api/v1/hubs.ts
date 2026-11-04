import { FastifyPluginAsync } from 'fastify';
import {
  ConnectorType,
  HubQueryParams,
  MapClusterQueryParams,
  StationOperationalStatus,
} from '@pithcharge/cms-adapters';

const hubRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: {
      search?: string;
      connectorType?: ConnectorType;
      accessType?: 'Public' | 'Private' | 'Restricted';
      page?: number;
      limit?: number;
    };
  }>('/hubs', async (request) => {
    const { search, connectorType, accessType, page, limit } = request.query;

    const params: HubQueryParams = {
      search,
      connectorType,
      accessType,
      page,
      limit,
    };

    return fastify.cms.listHubs(params);
  });

  fastify.get<{ Params: { id: string } }>('/hubs/:id', async (request, reply) => {
    const hub = await fastify.cms.getHubDetails(request.params.id);
    if (!hub) {
      return reply.code(404).send({ error: 'Hub not found' });
    }

    return hub;
  });

  fastify.get('/hubs/map', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;

    const zoom = query.zoom === undefined ? 10 : Number(query.zoom);
    if (!Number.isInteger(zoom) || zoom < 1 || zoom > 22) {
      return reply.code(400).send({ error: 'zoom must be an integer between 1 and 22.' });
    }

    const userLat = query.userLat === undefined ? undefined : Number(query.userLat);
    const userLng = query.userLng === undefined ? undefined : Number(query.userLng);
    const invalidUserLocation =
      (userLat === undefined) !== (userLng === undefined) ||
      (userLat !== undefined &&
        userLng !== undefined &&
        (!Number.isFinite(userLat) ||
          !Number.isFinite(userLng) ||
          userLat < -90 ||
          userLat > 90 ||
          userLng < -180 ||
          userLng > 180));
    if (invalidUserLocation) {
      return reply.code(400).send({ error: 'userLat and userLng must be a valid coordinate pair.' });
    }

    let bbox: MapClusterQueryParams['bbox'] = undefined;
    const bounds = [query.swLat, query.swLng, query.neLat, query.neLng];
    if (bounds.some((value) => value !== undefined)) {
      if (bounds.some((value) => value === undefined)) {
        return reply.code(400).send({ error: 'All four viewport bounds are required.' });
      }

      const numericBounds = bounds.map(Number);
      const swLat = numericBounds[0];
      const swLng = numericBounds[1];
      const neLat = numericBounds[2];
      const neLng = numericBounds[3];
      if (
        numericBounds.length !== 4 ||
        !numericBounds.every(Number.isFinite) ||
        swLat === undefined ||
        swLng === undefined ||
        neLat === undefined ||
        neLng === undefined ||
        swLat < -90 ||
        neLat > 90 ||
        swLng < -180 ||
        neLng > 180 ||
        swLat >= neLat ||
        swLng >= neLng
      ) {
        return reply.code(400).send({ error: 'Viewport bounds are invalid.' });
      }

      bbox = {
        swLat,
        swLng,
        neLat,
        neLng,
      };
    }

    const clusterParams: MapClusterQueryParams = {
      bbox,
      zoom,
      userLat,
      userLng,
      connectorType: query.connectorType as ConnectorType | undefined,
      minPowerKw: query.minPowerKw ? parseFloat(query.minPowerKw) : undefined,
      minChargers: query.minChargers ? parseInt(query.minChargers, 10) : undefined,
      status: query.status as StationOperationalStatus | undefined,
    };

    const result = await fastify.cms.getMapClusters(clusterParams);

    return reply.send({
      success: true,
      data: result.items,
      meta: {
        totalHubs: result.totalHubsCount,
        userLocationApplied: result.userLocationApplied,
        zoom,
      },
    });
  });
};

export default hubRoutes;
