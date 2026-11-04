// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

export const INSTALLED_CERTIFICATE_LIST_QUERY = `
  query InstalledCertificateList(
    $offset: Int!
    $limit: Int!
    $order_by: [InstalledCertificates_order_by!]
    $where: InstalledCertificates_bool_exp
  ) {
    InstalledCertificates(
      offset: $offset
      limit: $limit
      order_by: $order_by
      where: $where
    ) {
      id
      ocppConnectionName
      hashAlgorithm
      issuerNameHash
      issuerKeyHash
      serialNumber
      certificateType
    }
    InstalledCertificates_aggregate(where: $where) {
      aggregate {
        count
      }
    }
  }
`;

export const INSTALLED_CERTIFICATE_GET_QUERY = `
  query GetInstalledCertificateById($id: Int!) {
    InstalledCertificates_by_pk(id: $id) {
      id
      ocppConnectionName
      hashAlgorithm
      issuerNameHash
      issuerKeyHash
      serialNumber
      certificateType
    }
  }
`;
