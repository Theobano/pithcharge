// GraphQL documents mirrored from citrineos-operator-ui (src/lib/queries), as plain strings.
export * from './authorizations';
export * from './change.configurations';
export * from './charging.station.sequences';
export * from './charging.stations';
export * from './components';
export * from './connectors';
export * from './evses';
export * from './installed.certificates';
export * from './locations';
export * from './meter.values';
export * from './ocpp.messages';
export * from './server.network.profiles';
export * from './tariffs';
export * from './tenant.partners';
export * from './transaction.events';
export * from './transactions';
export * from './variable.attributes';
export * from './variables';

// Adapter-specific inventory documents share names with the operator UI ones, so they are namespaced.
export * as inventoryQueries from './inventory';
