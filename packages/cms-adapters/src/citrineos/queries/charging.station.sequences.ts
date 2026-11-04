// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

export const CHARGING_STATION_SEQUENCES_GET_QUERY = `
  query ChargingStationSequencesGet($stationId: Int!, $type: String!) {
    ChargingStationSequences(
      where: { stationId: { _eq: $stationId }, type: { _eq: $type } }
    ) {
      value
    }
  }
`;
