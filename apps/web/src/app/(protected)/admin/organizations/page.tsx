"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import {
  useAdminMutation,
  useAdminOrganizations,
  type Row,
} from "@/api/adminApi";
import {
  DataTable,
  Field,
  Modal,
  NativeSelect,
  PageHeader,
  Pager,
  formatDate,
  runWithToast,
} from "@/components/admin/admin-ui";
import {
  CurrencySelect,
  DEFAULT_CURRENCY,
} from "@/components/billing/pricing-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminOrganizationsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useAdminOrganizations({
    page,
    search: search.trim() || undefined,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New organization
          </Button>
        }
      />
      <Input
        placeholder="Search organizations"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="sm:max-w-xs"
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <DataTable
            head={[
              "Organization",
              "Members",
              "Billing",
              "Wallet balance",
              "Created",
            ]}
            empty={!data?.data.length}
          >
            {data?.data.map((org: Row) => (
              <tr key={org.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/organizations/${org.id}`}
                    className="font-medium hover:underline"
                  >
                    <div>{org.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {org.slug}
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums">{org._count.members}</td>
                <td className="px-3 py-2">
                  {org.billingPolicy ? (
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary">
                        {org.billingPolicy.billingMode}
                      </Badge>
                      <Badge variant="outline">
                        {org.billingPolicy.walletSharingMode}
                      </Badge>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {org.wallets.balance} {org.billingPolicy?.currency}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {formatDate(org.createdAt)}
                </td>
              </tr>
            ))}
          </DataTable>
          {data && (
            <Pager
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={setPage}
            />
          )}
        </>
      )}
      <CreateOrganizationModal
        open={creating}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

function CreateOrganizationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const create = useAdminMutation("POST");
  const [form, setForm] = useState({
    name: "",
    ownerEmail: "",
    billingMode: "PREPAID",
    walletSharingMode: "SHARED",
    currency: DEFAULT_CURRENCY,
  });

  const submit = async () => {
    let createdId: string | undefined;
    const ok = await runWithToast(async () => {
      const res = await create.mutateAsync({
        path: "/organizations",
        body: {
          name: form.name.trim(),
          ...(form.ownerEmail.trim()
            ? { ownerEmail: form.ownerEmail.trim() }
            : {}),
          policy: {
            billingMode: form.billingMode,
            walletSharingMode: form.walletSharingMode,
            currency: form.currency.toUpperCase(),
          },
        },
      });
      createdId = res.data?.id;
    }, "Organization created.");
    if (ok) {
      onClose();
      if (createdId) router.push(`/admin/organizations/${createdId}`);
    }
  };

  return (
    <Modal
      open={open}
      title="Create organization"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              form.name.trim().length < 2 ||
              form.currency.length !== 3 ||
              create.isPending
            }
          >
            Create
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field
        label="Owner email"
        hint="Optional. Must be an existing registered user."
      >
        <Input
          type="email"
          value={form.ownerEmail}
          onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
        />
      </Field>
      <Field label="Billing mode">
        <NativeSelect
          value={form.billingMode}
          onChange={(e) => setForm({ ...form, billingMode: e.target.value })}
        >
          <option value="PREPAID">Prepaid</option>
          <option value="POSTPAID">Postpaid</option>
        </NativeSelect>
      </Field>
      <Field label="Wallet sharing">
        <NativeSelect
          value={form.walletSharingMode}
          onChange={(e) =>
            setForm({ ...form, walletSharingMode: e.target.value })
          }
        >
          <option value="SHARED">Shared wallet</option>
          <option value="INDIVIDUAL">Individual wallets</option>
          <option value="MIXED">Mixed</option>
        </NativeSelect>
      </Field>
      <Field label="Currency">
        <CurrencySelect
          value={form.currency}
          onChange={(currency) => setForm({ ...form, currency })}
        />
      </Field>
    </Modal>
  );
}
