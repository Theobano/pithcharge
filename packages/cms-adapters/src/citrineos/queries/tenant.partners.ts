// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

export const PARTNERS_LIST_QUERY = `
  query TenantPartners(
    $limit: Int
    $offset: Int
    $order_by: [TenantPartners_order_by!]
    $where: TenantPartners_bool_exp
  ) {
    TenantPartners(
      limit: $limit
      offset: $offset
      order_by: $order_by
      where: $where
    ) {
      id
      countryCode
      partyId
      partnerProfileOCPI
    }
    TenantPartners_aggregate(where: $where) {
      aggregate {
        count
      }
    }
  }
`;

export const PARTNER_DETAIL_QUERY = `
  query TenantPartner($id: Int!) {
    TenantPartners_by_pk(id: $id) {
      id
      countryCode
      partyId
      partnerProfileOCPI
    }
  }
`;

export const PARTNER_CREATE_MUTATION = `
  mutation CreatePartner($object: TenantPartners_insert_input!) {
    insert_TenantPartners_one(object: $object) {
      id
    }
  }
`;

export const PARTNER_UPDATE_MUTATION = `
  mutation UpdatePartner($id: Int!, $object: TenantPartners_set_input!) {
    update_TenantPartners_by_pk(pk_columns: { id: $id }, _set: $object) {
      id
    }
  }
`;
