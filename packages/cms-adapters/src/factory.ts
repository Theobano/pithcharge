import { ICmsAdapter } from './types';
import { CitrineOsAdapter, CitrineOsConfig } from './citrineos';
import { MockCmsAdapter } from './mock-adapter';

export type CmsProviderType = 'citrineos' | 'mock';

export interface CreateCmsAdapterConfig {
  provider: CmsProviderType;
  /** CitrineOS specific configuration options */
  citrineos?: Partial<CitrineOsConfig>;
  /** Direct configuration fallbacks (environment variable mapping) */
  baseUrl?: string;
  graphqlUrl?: string;
  apiKey?: string;
  adminSecret?: string;
  tenantId?: string;
}

export function createCmsAdapter(config: CreateCmsAdapterConfig): ICmsAdapter {
  switch (config.provider) {
    case 'citrineos': {
      const baseUrl = config.citrineos?.baseUrl || config.baseUrl;

      if (!baseUrl) {
        throw new Error(
          '[CmsAdapterFactory] CitrineOS provider requires a non-empty "baseUrl".'
        );
      }

      return new CitrineOsAdapter({
        baseUrl,
        graphqlUrl: config.citrineos?.graphqlUrl || config.graphqlUrl,
        apiKey: config.citrineos?.apiKey || config.apiKey,
        adminSecret: config.citrineos?.adminSecret || config.adminSecret,
        tenantId: config.citrineos?.tenantId || config.tenantId,
      });
    }

    case 'mock':
    default:
      return new MockCmsAdapter();
  }
}