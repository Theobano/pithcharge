"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAdminMutation, useAdminUser } from "@/api/adminApi";
import type { Row } from "@/api/adminApi";
import {
  DataTable,
  Field,
  Modal,
  NativeSelect,
  PageHeader,
  StatCard,
  formatDate,
  runWithToast,
} from "@/components/admin/admin-ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";

type Pending = "ban" | "unban" | "revoke" | "impersonate" | null;

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAdminUser(id);
  const post = useAdminMutation("POST");
  const patch = useAdminMutation("PATCH");
  const [pending, setPending] = useState<Pending>(null);
  const [editing, setEditing] = useState(false);
  const [funding, setFunding] = useState(false);
  const [fund, setFund] = useState({
    walletId: "",
    amount: "",
    reason: "",
    key: "",
  });
  const [form, setForm] = useState({ name: "", email: "", role: "user" });

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-destructive" role="alert">
        {(error as Error | null)?.message ?? "User not found."}
      </p>
    );
  const user = data.data;
  const hasPublicWallet = (user.wallets ?? []).some(
    (w: Row) => w.organization?.slug === "public-network",
  );

  const openFund = (walletId: string) => {
    setFund({ walletId, amount: "", reason: "", key: crypto.randomUUID() });
    setFunding(true);
  };

  const submitFund = async () => {
    const ok = await runWithToast(
      () =>
        post.mutateAsync({
          path: `/users/${id}/wallet/fund`,
          body: {
            ...(fund.walletId ? { walletId: fund.walletId } : {}),
            amount: Number(fund.amount),
            reason: fund.reason,
            idempotencyKey: fund.key,
          },
        }),
      "Wallet funded.",
    );
    if (ok) setFunding(false);
  };
  const confirm = async () => {
    const actions = {
      ban: () => post.mutateAsync({ path: `/users/${id}/ban`, body: {} }),
      unban: () => post.mutateAsync({ path: `/users/${id}/unban` }),
      revoke: () => post.mutateAsync({ path: `/users/${id}/revoke-sessions` }),
    } as const;
    const messages = {
      ban: "User banned and tokens blocked.",
      unban: "User reinstated.",
      revoke: "Sessions revoked.",
    } as const;
    if (pending === "impersonate") {
      setPending(null);
      await impersonate();
      return;
    }
    if (pending && (await runWithToast(actions[pending], messages[pending])))
      setPending(null);
  };

  const openEdit = () => {
    setForm({
      name: user.name ?? "",
      email: user.email ?? "",
      role: user.role ?? "user",
    });
    setEditing(true);
  };

  const save = async () => {
    if (
      await runWithToast(
        () => patch.mutateAsync({ path: `/users/${id}`, body: form }),
        "User updated.",
      )
    )
      setEditing(false);
  };

  const toggleToken = (token: Row) =>
    runWithToast(
      () =>
        patch.mutateAsync({
          path: `/users/${id}/tokens/${token.id}`,
          body: { status: token.status === "ACTIVE" ? "BLOCKED" : "ACTIVE" },
        }),
      "Token updated.",
    );

  const impersonate = async () => {
    const result = await authClient.admin.impersonateUser({ userId: id });
    if (result.error) {
      toast.add({
        type: "error",
        description: result.error.message || "Unable to impersonate this user.",
      });
      return;
    }
    queryClient.clear();
    toast.add({
      type: "success",
      description: `Now viewing as ${user.name || user.email}.`,
    });
    // Full page load is required to reset all client state for the impersonated user.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/dashboard";
  };

  const copy: Record<
    Exclude<Pending, null>,
    { title: string; body: string; label: string }
  > = {
    ban: {
      title: "Ban this user?",
      body: "They are signed out and their charging tokens are blocked in the CSMS.",
      label: "Ban user",
    },
    unban: {
      title: "Reinstate this user?",
      body: "Blocked tokens are reactivated in the CSMS.",
      label: "Reinstate",
    },
    revoke: {
      title: "Revoke all sessions?",
      body: "The user is signed out of every device.",
      label: "Revoke",
    },
    impersonate: {
      title: "Impersonate this user?",
      body: "You will see and act in the app as this user for up to one hour. Everything is recorded in the audit log. Use the banner to return to your admin account.",
      label: "Impersonate",
    },
  };

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <>
            {user.role !== "admin" && !user.banned && (
              <Button
                variant="outline"
                onClick={() => setPending("impersonate")}
              >
                Impersonate
              </Button>
            )}
            {!user.isAnonymous && (
              <Button variant="outline" onClick={openEdit}>
                Edit
              </Button>
            )}
            <Button variant="outline" onClick={() => setPending("revoke")}>
              Revoke sessions
            </Button>
            {user.banned ? (
              <Button onClick={() => setPending("unban")}>Reinstate</Button>
            ) : (
              <Button variant="destructive" onClick={() => setPending("ban")}>
                Ban
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge variant={user.role === "admin" ? "default" : "secondary"}>
          {user.role ?? "user"}
        </Badge>
        {user.banned && (
          <Badge variant="destructive">
            Banned{user.banReason ? `: ${user.banReason}` : ""}
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sessions" value={user.totals.sessions} />
        <StatCard
          label="Energy (kWh)"
          value={Number(user.totals.kwh).toLocaleString(undefined, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
        />
        <StatCard
          label="Spend"
          value={Number(user.totals.spend).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        />
        <StatCard
          label="Last login"
          value={
            <span className="text-sm">
              {formatDate(user.lastLogin?.createdAt)}
            </span>
          }
          hint={user.lastLogin?.ipAddress ?? undefined}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Organizations</h2>
        <DataTable
          head={["Organization", "Role", "Negative balance"]}
          empty={!user.members.length}
        >
          {user.members.map((m: Row) => (
            <tr key={m.id}>
              <td className="px-3 py-2">
                <Link
                  className="hover:underline"
                  href={`/admin/organizations/${m.organization.id}`}
                >
                  {m.organization.name}
                </Link>
              </td>
              <td className="px-3 py-2">{m.role}</td>
              <td className="px-3 py-2">
                {m.allowNegativeBalance
                  ? `Up to ${Number(m.negativeBalanceLimit).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : "No"}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Wallets</h2>
          {!user.isAnonymous && (
            <Button
              size="sm"
              onClick={() => openFund(user.wallets?.[0]?.id ?? "")}
            >
              Fund wallet
            </Button>
          )}
        </div>
        <DataTable
          head={["Wallet", "Balance", "Reserved", "Status"]}
          empty={!user.wallets?.length}
        >
          {(user.wallets ?? []).map((w: Row) => (
            <tr key={w.id}>
              <td className="px-3 py-2">
                <Link
                  className="hover:underline"
                  href={`/admin/organizations/${w.organizationId}`}
                >
                  {w.organization?.slug === "public-network"
                    ? "Public network (personal)"
                    : w.organization?.name}
                </Link>
              </td>
              <td className="px-3 py-2 tabular-nums">
                {Number(w.balance).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} {w.currency}
              </td>
              <td className="px-3 py-2 tabular-nums">{Number(w.reservedBalance).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}</td>
              <td className="px-3 py-2">
                <Badge
                  variant={w.status === "ACTIVE" ? "outline" : "secondary"}
                >
                  {w.status}
                </Badge>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      <Modal
        open={funding}
        title="Fund wallet"
        onClose={() => setFunding(false)}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setFunding(false)}
              disabled={post.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={submitFund}
              disabled={
                !(Number(fund.amount) > 0) ||
                fund.reason.trim().length < 3 ||
                post.isPending
              }
            >
              Add funds
            </Button>
          </>
        }
      >
        <Field label="Wallet">
          <NativeSelect
            value={fund.walletId}
            onChange={(e) => setFund({ ...fund, walletId: e.target.value })}
          >
            {!hasPublicWallet && (
              <option value="">Public network wallet (will be created)</option>
            )}
            {(user.wallets ?? []).map((w: Row) => (
              <option key={w.id} value={w.id}>
                {w.organization?.slug === "public-network"
                  ? "Public network"
                  : w.organization?.name}{" "}
                · {w.balance} {w.currency}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Amount">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={fund.amount}
            onChange={(e) => setFund({ ...fund, amount: e.target.value })}
          />
        </Field>
        <Field
          label="Reason"
          hint="Recorded in the ledger and audit log. The user is notified."
        >
          <Input
            value={fund.reason}
            onChange={(e) => setFund({ ...fund, reason: e.target.value })}
          />
        </Field>
      </Modal>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Charging tokens</h2>
        <DataTable
          head={["Token", "Type", "Status", "Last used", ""]}
          empty={!user.tokens.length}
        >
          {user.tokens.map((t: Row) => (
            <tr key={t.id}>
              <td className="px-3 py-2 font-mono text-xs">
                {t.idToken}
                {t.isDefault && (
                  <Badge variant="outline" className="ml-2">
                    default
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2">{t.tokenType}</td>
              <td className="px-3 py-2">{t.status}</td>
              <td className="px-3 py-2 text-xs">{formatDate(t.lastUsedAt)}</td>
              <td className="px-3 py-2 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleToken(t)}
                  disabled={patch.isPending}
                >
                  {t.status === "ACTIVE" ? "Block" : "Activate"}
                </Button>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Recent sessions</h2>
        <DataTable
          head={["Station", "Status", "Started", "kWh", "Cost"]}
          empty={!user.chargingSessions.length}
        >
          {user.chargingSessions.map((s: Row) => (
            <tr key={s.id}>
              <td className="px-3 py-2">{s.stationId}</td>
              <td className="px-3 py-2">{s.status}</td>
              <td className="px-3 py-2 text-xs">{formatDate(s.startTime)}</td>
              <td className="px-3 py-2 tabular-nums">
                {s.totalKwh != null
                  ? Number(s.totalKwh).toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })
                  : "—"}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {s.totalCost != null
                  ? `${Number(s.totalCost).toLocaleString(undefined, {
                      style: "currency",
                      currency: s.currency ?? "",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : "—"}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? copy[pending].title : ""}
        description={pending ? copy[pending].body : ""}
        confirmLabel={pending ? copy[pending].label : ""}
        destructive={pending === "ban"}
        pending={post.isPending}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
      <Modal
        open={editing}
        title="Edit user"
        onClose={() => setEditing(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={patch.isPending}>
              Save
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
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Platform role">
          <NativeSelect
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="user">User</option>
            <option value="admin">Platform admin</option>
          </NativeSelect>
        </Field>
      </Modal>
    </div>
  );
}
