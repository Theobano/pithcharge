// Queries used by CitrineOsAdapter for the station/hub inventory views.

export const CHARGING_STATIONS_LIST_QUERY = `
  query ChargingStationsList(
    $offset: Int
    $limit: Int
    $order_by: [ChargingStations_order_by!]
    $where: ChargingStations_bool_exp
  ) {
    ChargingStations(
      offset: $offset
      limit: $limit
      order_by: $order_by
      where: $where
    ) {
      id
      ocppConnectionName
      isOnline
      protocol
      locationId
      chargePointVendor
      chargePointModel
      firmwareVersion
      createdAt
      updatedAt
      evses: Evses {
        id
        evseTypeId
        evseId
        physicalReference
        connectors: Connectors {
          id
          connectorId
          status
          type
          maximumPowerWatts
          maximumAmperage
          maximumVoltage
          tariffId
          errorCode
          timestamp
        }
      }
      LatestStatusNotifications {
        StatusNotification {
          connectorId
          connectorStatus
          evseId
          timestamp
        }
      }
      transactions: Transactions(where: { isActive: { _eq: true } }) {
        id
        transactionId
        evseId
        totalKwh
        timeSpentCharging
        chargingState
      }
    }
    ChargingStations_aggregate(where: $where) {
      aggregate {
        count
      }
    }
  }
`;

export const CHARGING_STATIONS_GET_BY_PK_QUERY = `
  query GetChargingStationById($id: Int!) {
    ChargingStations_by_pk(id: $id) {
      id
      tenantId
      ocppConnectionName
      isOnline
      protocol
      locationId
      chargePointVendor
      chargePointModel
      firmwareVersion
      createdAt
      updatedAt
      evses: Evses {
        id
        evseTypeId
        evseId
        physicalReference
        connectors: Connectors {
          id
          connectorId
          status
          type
          maximumPowerWatts
          maximumAmperage
          maximumVoltage
          tariffId
          errorCode
          timestamp
        }
      }
      LatestStatusNotifications {
        StatusNotification {
          connectorId
          connectorStatus
          evseId
          timestamp
        }
      }
      transactions: Transactions(where: { isActive: { _eq: true } }) {
        id
        transactionId
        evseId
        totalKwh
        timeSpentCharging
        chargingState
      }
    }
  }
`;

export const ACTIVE_TRANSACTIONS_QUERY = `
  query GetActiveTransactions($where: Transactions_bool_exp) {
    Transactions(where: $where) {
      id
      transactionId
      stationId
      evseId
      totalKwh
      timeSpentCharging
      isActive
      chargingState
      remoteStartId
      createdAt
      updatedAt
      Authorization {
        idToken
      }
      Connector {
        connectorId
      }
    }
  }
`;

export const TRANSACTION_BY_ID_QUERY = `
   query GetTransactionByTransactionId($where: Transactions_bool_exp) {
     Transactions(where: $where, limit: 1) {
       id
       transactionId
       stationId
       evseId
       totalKwh
       timeSpentCharging
       isActive
       chargingState
       remoteStartId
       startTime
       endTime
       stoppedReason
       createdAt
       updatedAt
       Authorization {
         idToken
       }
       Connector {
         connectorId
       }
     }
   }
 `;

export const TRANSACTIONS_SINCE_QUERY = `
   query GetTransactionsSince($where: Transactions_bool_exp) {
     Transactions(where: $where, order_by: { createdAt: asc }, limit: 10) {
       id
       transactionId
       stationId
       evseId
       totalKwh
       timeSpentCharging
       isActive
       chargingState
       remoteStartId
       startTime
       endTime
       stoppedReason
       createdAt
       updatedAt
       Authorization {
         idToken
       }
       Connector {
         connectorId
       }
     }
   }
 `;

export const LATEST_METER_VALUES_QUERY = `
  query LatestMeterValues($transactionDatabaseId: Int!, $limit: Int!) {
    MeterValues(
      where: { transactionDatabaseId: { _eq: $transactionDatabaseId } }
      order_by: { timestamp: desc }
      limit: $limit
    ) {
      timestamp
      sampledValue
    }
  }
`;

export const LOCATIONS_LIST_QUERY = `
  query LocationsList(
    $offset: Int!
    $limit: Int!
    $order_by: [Locations_order_by!]
    $where: Locations_bool_exp
    $chargingStationsWhere: ChargingStations_bool_exp
  ) {
    Locations(
      offset: $offset
      limit: $limit
      order_by: $order_by
      where: $where
    ) {
      id
      name
      address
      city
      postalCode
      state
      country
      coordinates
      createdAt
      updatedAt
      timeZone
      parkingType
      openingHours
      chargingStations: ChargingStations(where: $chargingStationsWhere) {
        id
        locationId
        ocppConnectionName
        isOnline
        protocol
        chargePointVendor
        chargePointModel
        firmwareVersion
        createdAt
        updatedAt
        evses: Evses {
          id
          evseTypeId
          evseId
          physicalReference
          connectors: Connectors {
            id
            connectorId
            status
            type
            maximumPowerWatts
            maximumAmperage
            maximumVoltage
            tariffId
            errorCode
            timestamp
          }
        }
        LatestStatusNotifications {
          StatusNotification {
            connectorId
            connectorStatus
            evseId
            timestamp
          }
        }
        transactions: Transactions(where: { isActive: { _eq: true } }) {
          id
          transactionId
          evseId
          totalKwh
          isActive
          chargingState
        }
      }
    }
    Locations_aggregate(where: $where) {
      aggregate {
        count
      }
    }
  }
`;

export const LOCATIONS_GET_QUERY = `
  query GetLocationById($id: Int!) {
    Locations_by_pk(id: $id) {
      id
      name
      address
      city
      postalCode
      state
      country
      coordinates
      facilities
      timeZone
      parkingType
      openingHours
      createdAt
      updatedAt
      chargingStations: ChargingStations {
        id
        locationId
        ocppConnectionName
        isOnline
        protocol
        chargePointVendor
        chargePointModel
        firmwareVersion
        createdAt
        updatedAt
        evses: Evses {
          id
          evseTypeId
          evseId
          physicalReference
          connectors: Connectors {
            id
            connectorId
            status
            type
            maximumPowerWatts
            maximumAmperage
            maximumVoltage
            tariffId
            errorCode
            timestamp
          }
        }
        LatestStatusNotifications {
          StatusNotification {
            connectorId
            connectorStatus
            evseId
            timestamp
          }
        }
        transactions: Transactions(where: { isActive: { _eq: true } }) {
          id
          transactionId
          evseId
          totalKwh
          isActive
          chargingState
        }
      }
    }
  }
`;


