"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  useAdminMutation,
  useAdminOrgLedger,
  useAdminOrgSessions,
  useAdminOrgAudit,
  useAdminOrganization,
  adminFetch,
  type Row,
} from "@/api/adminApi";
import { useQueryClient } from "@tanstack/react-query";
import {
  DataTable,
  Field,
  Modal,
  NativeSelect,
  PageHeader,
  Pager,
  StatCard,
  formatDate,
  runWithToast,
} from "@/components/admin/admin-ui";
import {
  CurrencySelect,
  TimezoneSelect,
} from "@/components/billing/pricing-options";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  RateRulesEditor,
  type RateRule,
} from "@/components/billing/rate-rules-editor";
import {
  BillingCycleFields,
  GenerateInvoiceButton,
  runInvoiceJob,
  type InvoiceJobView,
  describeCycle,
  invoiceBreakdown,
  normalizeCycle,
  type CycleSettings,
} from "@/components/billing/invoice-cycle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const sections = [
  "Members",
  "Billing",
  "Rates",
  "Wallets",
  "Ledger",
  "Sessions",
  "Audit",
  "Invoices",
] as const;
type Section = (typeof sections)[number];

const cycleOf = (policy: Row): CycleSettings =>
  normalizeCycle(policy as Record<string, unknown>);

export default function AdminOrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAdminOrganization(id);
  const remove = useAdminMutation("DELETE");
  const issue = useAdminMutation("POST");
  const [section, setSection] = useState<Section>("Members");
  const [deleting, setDeleting] = useState(false);

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-destructive" role="alert">
        {(error as Error | null)?.message ?? "Organization not found."}
      </p>
    );
  const {
    policy,
    members,
    wallets,
    invoices,
    currentPeriod: usage30d,
    rateRules,
  } = data.data;

  const deleteOrg = async () => {
    if (
      await runWithToast(
        () => remove.mutateAsync({ path: `/organizations/${id}` }),
        "Organization deleted.",
      )
    ) {
      router.replace("/admin/organizations");
    } else {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Members" value={members.length} />
        <StatCard label="Sessions (this period)" value={usage30d.sessions} />
        <StatCard
          label="Energy (this period, kWh)"
          value={Number(usage30d.kwh).toLocaleString(undefined, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
        />
        <StatCard
          label={`Spend (${describeCycle(cycleOf(policy).billingCycleUnit, cycleOf(policy).billingCycleInterval).toLowerCase()} period)`}
          value={`${Number(usage30d.spend).toLocaleString(undefined, {
            style: "currency",
            currency: policy.currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
        />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
        {sections.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={section === name}
            onClick={() => setSection(name)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
              section === name
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {section === "Members" && (
        <MembersSection orgId={id} members={members} wallets={wallets} />
      )}
      {section === "Billing" && <PolicySection orgId={id} policy={policy} />}
      {section === "Rates" && (
        <RatesSection orgId={id} policy={policy} rules={rateRules} />
      )}
      {section === "Wallets" && <WalletsSection orgId={id} wallets={wallets} />}
      {section === "Ledger" && <LedgerSection orgId={id} />}
      {section === "Sessions" && <SessionsSection orgId={id} />}
      {section === "Audit" && <AuditSection orgId={id} />}
      {section === "Invoices" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <GenerateInvoiceButton
              onGenerate={async () => {
                await runInvoiceJob(
                  async () =>
                    (
                      await issue.mutateAsync({
                        path: `/organizations/${id}/invoices`,
                      })
                    ).data.jobId as string,
                  async (jobId) =>
                    (
                      await adminFetch<{ data: InvoiceJobView }>(
                        `/organizations/${id}/invoices/jobs/${encodeURIComponent(jobId)}`,
                      )
                    ).data,
                );
                await queryClient.invalidateQueries({ queryKey: ["admin"] });
              }}
            />
          </div>
          <DataTable
            head={["Period", "Breakdown", "Amount due", "Status"]}
            empty={!invoices.length}
          >
            {invoices.map((inv: Row) => (
              <tr key={inv.id}>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {formatDate(inv.periodStart).split(",")[0]} –{" "}
                  {formatDate(inv.periodEnd).split(",")[0]}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {invoiceBreakdown(inv as never)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {inv.amountDue} {inv.currency}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant={inv.status === "PAID" ? "outline" : "secondary"}
                  >
                    {inv.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        title="Delete organization?"
        description="Only organizations without financial history, funded wallets or live sessions can be deleted."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={deleteOrg}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}

function MembersSection({
  orgId,
  members,
  wallets,
}: {
  orgId: string;
  members: Row[];
  wallets: Row[];
}) {
  const post = useAdminMutation("POST");
  const patch = useAdminMutation("PATCH");
  const del = useAdminMutation("DELETE");
  const [adding, setAdding] = useState(false);
  const [add, setAdd] = useState({ email: "", role: "user" });
  const [removing, setRemoving] = useState<Row | null>(null);
  const [credit, setCredit] = useState<Row | null>(null);
  const [limit, setLimit] = useState("0");

  const submitAdd = async () => {
    if (
      await runWithToast(
        () =>
          post.mutateAsync({
            path: `/organizations/${orgId}/members`,
            body: add,
          }),
        "Member added.",
      )
    ) {
      setAdding(false);
      setAdd({ email: "", role: "user" });
    }
  };
  const update = (member: Row, body: Row, message = "Member updated.") =>
    runWithToast(
      () =>
        patch.mutateAsync({
          path: `/organizations/${orgId}/members/${member.id}`,
          body,
        }),
      message,
    );

  const saveCredit = async () => {
    const value = Number(limit);
    if (
      credit &&
      (await update(
        credit,
        { allowNegativeBalance: value > 0, negativeBalanceLimit: value },
        "Credit limit updated.",
      ))
    )
      setCredit(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>Add member</Button>
      </div>
      <DataTable
        head={["Member", "Role", "Wallet", "Credit limit", ""]}
        empty={!members.length}
      >
        {members.map((m: Row) => (
          <tr key={m.id}>
            <td className="px-3 py-2">
              <Link
                href={`/admin/users/${m.user.id}`}
                className="font-medium hover:underline"
              >
                {m.user.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {m.user.email}
              </div>
            </td>
            <td className="px-3 py-2">
              {m.role === "owner" ? (
                <Badge>owner</Badge>
              ) : (
                <NativeSelect
                  value={m.role === "member" ? "user" : m.role}
                  onChange={(e) =>
                    update(m, { role: e.target.value }, "Role updated.")
                  }
                  className="h-8 w-28"
                  aria-label={`Role for ${m.user.name}`}
                >
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                  <option value="auditor">Auditor</option>
                </NativeSelect>
              )}
            </td>
            <td className="px-3 py-2">
              <NativeSelect
                value={m.billingWalletId ?? ""}
                onChange={(e) =>
                  update(
                    m,
                    { billingWalletId: e.target.value || null },
                    "Wallet assignment updated.",
                  )
                }
                className="h-8 w-40"
                aria-label={`Wallet for ${m.user.name}`}
              >
                <option value="">Default</option>
                {wallets
                  .filter((w) => w.status === "ACTIVE")
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label || w.scopeKey}
                    </option>
                  ))}
              </NativeSelect>
            </td>
            <td className="px-3 py-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCredit(m);
                  setLimit(String(m.negativeBalanceLimit ?? 0));
                }}
              >
                {m.allowNegativeBalance ? Number(m.negativeBalanceLimit).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) : "None"}
              </Button>
            </td>
            <td className="px-3 py-2 text-right">
              {m.role !== "owner" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRemoving(m)}
                >
                  Remove
                </Button>
              )}
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal
        open={adding}
        title="Add member"
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitAdd}
              disabled={!add.email.includes("@") || post.isPending}
            >
              Add
            </Button>
          </>
        }
      >
        <Field label="Email" hint="Must be an existing registered user.">
          <Input
            type="email"
            value={add.email}
            onChange={(e) => setAdd({ ...add, email: e.target.value })}
          />
        </Field>
        <Field label="Role">
          <NativeSelect
            value={add.role}
            onChange={(e) => setAdd({ ...add, role: e.target.value })}
          >
            <option value="admin">Admin</option>
            <option value="user">User</option>
            <option value="auditor">Auditor (view only)</option>
          </NativeSelect>
        </Field>
      </Modal>
      <Modal
        open={credit !== null}
        title="Negative balance limit"
        onClose={() => setCredit(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setCredit(null)}>
              Cancel
            </Button>
            <Button onClick={saveCredit} disabled={patch.isPending}>
              Save
            </Button>
          </>
        }
      >
        <Field
          label="Maximum overdraft"
          hint="Set to 0 to disable negative balance for this member."
        >
          <Input
            type="number"
            min={0}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </Field>
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Remove member?"
        description={`${removing?.user.name ?? "This user"} will lose access to the organization.`}
        confirmLabel="Remove"
        destructive
        pending={del.isPending}
        onConfirm={async () => {
          if (
            removing &&
            (await runWithToast(
              () =>
                del.mutateAsync({
                  path: `/organizations/${orgId}/members/${removing.id}`,
                }),
              "Member removed.",
            ))
          )
            setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function RatesSection({
  orgId,
  policy,
  rules,
}: {
  orgId: string;
  policy: Row;
  rules: RateRule[];
}) {
  const post = useAdminMutation("POST");
  const patch = useAdminMutation("PATCH");
  const del = useAdminMutation("DELETE");
  const base = `/organizations/${orgId}/rate-rules`;
  return (
    <RateRulesEditor
      rules={rules}
      currency={policy.currency}
      timezone={policy.timezone ?? "UTC"}
      canEdit
      onCreate={(body) =>
        runWithToast(
          () => post.mutateAsync({ path: base, body }),
          "Rate rule added.",
        )
      }
      onUpdate={(ruleId, body) =>
        runWithToast(
          () => patch.mutateAsync({ path: `${base}/${ruleId}`, body }),
          "Rate rule updated.",
        )
      }
      onDelete={(ruleId) =>
        runWithToast(
          () => del.mutateAsync({ path: `${base}/${ruleId}` }),
          "Rate rule deleted.",
        )
      }
    />
  );
}

function PolicySection({ orgId, policy }: { orgId: string; policy: Row }) {
  const optionalNumber = (v: string) => (v.trim() === "" ? null : Number(v));
  const patch = useAdminMutation("PATCH");
  const [form, setForm] = useState({
    billingMode: policy.billingMode as string,
    walletSharingMode: policy.walletSharingMode as string,
    currency: policy.currency as string,
    ratePerKwh: policy.ratePerKwh == null ? "" : String(policy.ratePerKwh),
    ratePerMinute:
      policy.ratePerMinute == null ? "" : String(policy.ratePerMinute),
    timezone: String(policy.timezone ?? "UTC"),
    sessionFee: policy.sessionFee == null ? "" : String(policy.sessionFee),
    idleFeePerMinute: String(policy.idleFeePerMinute ?? 0),
    sessionAuthorizationAmount: String(policy.sessionAuthorizationAmount ?? 10),
    monthlyMinimumSpend: String(policy.monthlyMinimumSpend ?? 0),
    paymentTermDays: String(policy.paymentTermDays ?? 30),
    allowNegativeBalance: Boolean(policy.allowNegativeBalance),
    negativeBalanceLimit: String(policy.negativeBalanceLimit ?? 0),
    lowCreditThreshold:
      policy.lowCreditThreshold == null
        ? ""
        : String(policy.lowCreditThreshold),
  });
  const [cycle, setCycle] = useState<CycleSettings>(() => cycleOf(policy));
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm({ ...form, [key]: value });
  const num = (
    key: keyof typeof form,
    label: string,
    step = "0.01",
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={0}
        step={step}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );

  const save = () =>
    runWithToast(
      () =>
        patch.mutateAsync({
          path: `/organizations/${orgId}/policy`,
          body: {
            billingMode: form.billingMode,
            walletSharingMode: form.walletSharingMode,
            currency: form.currency.toUpperCase(),
            ratePerKwh: optionalNumber(form.ratePerKwh),
            ratePerMinute: optionalNumber(form.ratePerMinute),
            timezone: form.timezone.trim() || "UTC",
            sessionFee: optionalNumber(form.sessionFee),
            idleFeePerMinute: Number(form.idleFeePerMinute),
            sessionAuthorizationAmount: Number(form.sessionAuthorizationAmount),
            monthlyMinimumSpend: Number(form.monthlyMinimumSpend),
            paymentTermDays: Number(form.paymentTermDays),
            ...cycle,
            allowNegativeBalance: form.allowNegativeBalance,
            negativeBalanceLimit: Number(form.negativeBalanceLimit),
            lowCreditThreshold:
              form.lowCreditThreshold === ""
                ? null
                : Number(form.lowCreditThreshold),
          },
        }),
      "Billing policy saved.",
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Billing mode"
          hint="Only platform admins can change this."
        >
          <NativeSelect
            value={form.billingMode}
            onChange={(e) => set("billingMode", e.target.value)}
          >
            <option value="PREPAID">Prepaid</option>
            <option value="POSTPAID">Postpaid</option>
          </NativeSelect>
        </Field>
        <Field label="Wallet sharing">
          <NativeSelect
            value={form.walletSharingMode}
            onChange={(e) => set("walletSharingMode", e.target.value)}
          >
            <option value="SHARED">Shared</option>
            <option value="INDIVIDUAL">Individual</option>
            <option value="MIXED">Mixed</option>
          </NativeSelect>
        </Field>
        <Field label="Currency">
          <CurrencySelect
            value={form.currency}
            onChange={(v) => set("currency", v)}
          />
        </Field>
        {num(
          "ratePerKwh",
          "General price per kWh",
          "0.0001",
          "Optional. Blank uses the CSMS tariff.",
        )}
        {num(
          "ratePerMinute",
          "General price per minute",
          "0.0001",
          "Optional. Blank uses the CSMS tariff.",
        )}
        <Field label="Pricing timezone" hint="Used by time-based rate rules.">
          <TimezoneSelect
            value={form.timezone}
            onChange={(v) => set("timezone", v)}
          />
        </Field>
        {num(
          "sessionFee",
          "Session fee",
          "0.01",
          "Optional. Blank uses the CSMS tariff.",
        )}
        {num("idleFeePerMinute", "Idle fee per minute", "0.0001")}
        {num("sessionAuthorizationAmount", "Session authorization hold")}
        {num("monthlyMinimumSpend", "Minimum spend per billing period")}
        {num("paymentTermDays", "Payment terms (days)", "1")}
        <BillingCycleFields value={cycle} onChange={setCycle} />
        <Field
          label="Low credit alert threshold"
          hint="Leave empty to disable alerts."
        >
          <Input
            type="number"
            min={0}
            value={form.lowCreditThreshold}
            onChange={(e) => set("lowCreditThreshold", e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={form.allowNegativeBalance}
            onCheckedChange={(v) => set("allowNegativeBalance", Boolean(v))}
          />
          Allow negative balance
        </label>
        {form.allowNegativeBalance && (
          <div className="w-44">
            {num("negativeBalanceLimit", "Overdraft limit")}
          </div>
        )}
      </div>
      <Button onClick={save} disabled={patch.isPending}>
        Save policy
      </Button>
    </div>
  );
}

function WalletsSection({ orgId, wallets }: { orgId: string; wallets: Row[] }) {
  const post = useAdminMutation("POST");
  const patch = useAdminMutation("PATCH");
  const [target, setTarget] = useState<Row | null>(null);
  const [mode, setMode] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");

  const open = (wallet: Row, next: "credit" | "debit") => {
    setTarget(wallet);
    setMode(next);
    setAmount("");
    setReason("");
    setKey(crypto.randomUUID());
  };

  const submit = async () => {
    const value = Number(amount);
    if (!target) return;
    const ok = await runWithToast(
      () =>
        post.mutateAsync({
          path: `/organizations/${orgId}/wallets/${target.id}/adjust`,
          body: {
            amount: mode === "credit" ? value : -value,
            reason,
            idempotencyKey: key,
          },
        }),
      mode === "credit" ? "Credit added." : "Wallet debited.",
    );
    if (ok) setTarget(null);
  };

  const setStatus = (wallet: Row, status: string) =>
    runWithToast(
      () =>
        patch.mutateAsync({
          path: `/organizations/${orgId}/wallets/${wallet.id}`,
          body: { status },
        }),
      `Wallet ${status.toLowerCase()}.`,
    );

  return (
    <>
      <DataTable
        head={["Wallet", "Owner", "Balance", "Reserved", "Status", ""]}
        empty={!wallets.length}
      >
        {wallets.map((w: Row) => (
          <tr key={w.id}>
            <td className="px-3 py-2">{w.label || w.scopeKey}</td>
            <td className="px-3 py-2 text-xs">
              {w.user ? w.user.name : "Shared"}
            </td>
            <td className="px-3 py-2 tabular-nums">
              {w.balance} {w.currency}
            </td>
            <td className="px-3 py-2 tabular-nums">{w.reservedBalance}</td>
            <td className="px-3 py-2">
              <Badge variant={w.status === "ACTIVE" ? "outline" : "secondary"}>
                {w.status}
              </Badge>
            </td>
            <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
              <Button
                size="sm"
                onClick={() => open(w, "credit")}
                disabled={w.status === "CLOSED"}
              >
                Add credit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => open(w, "debit")}
                disabled={w.status === "CLOSED"}
              >
                Debit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setStatus(w, w.status === "FROZEN" ? "ACTIVE" : "FROZEN")
                }
                disabled={w.status === "CLOSED"}
              >
                {w.status === "FROZEN" ? "Unfreeze" : "Freeze"}
              </Button>
            </td>
          </tr>
        ))}
      </DataTable>
      <Modal
        open={target !== null}
        title={`${mode === "credit" ? "Add credit to" : "Debit"} ${target?.label || target?.scopeKey || "wallet"}`}
        onClose={() => setTarget(null)}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={post.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={
                !(Number(amount) > 0) ||
                reason.trim().length < 3 ||
                post.isPending
              }
            >
              Confirm
            </Button>
          </>
        }
      >
        <Field label={`Amount (${target?.currency ?? ""})`}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Reason" hint="Recorded in the ledger and audit log.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}

function SessionsSection({ orgId }: { orgId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminOrgSessions(orgId, page);
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-3">
      <DataTable
        head={["Member", "Station", "Status", "Started", "Ended", "kWh", "Cost"]}
        empty={!data?.data.length}
      >
        {data?.data.map((s: Row) => (
          <tr key={s.id}>
            <td className="px-3 py-2">
              <div className="font-medium">{s.user?.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">
                {s.user?.email}
              </div>
            </td>
            <td className="px-3 py-2">{s.stationId}</td>
            <td className="px-3 py-2">{s.status}</td>
            <td className="whitespace-nowrap px-3 py-2 text-xs">
              {formatDate(s.startTime)}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-xs">
              {s.endTime ? formatDate(s.endTime) : "—"}
            </td>
            <td className="px-3 py-2 tabular-nums">
              {Number(s.totalKwh ?? 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </td>
            <td className="px-3 py-2 tabular-nums">
              {Number(s.totalCost ?? 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} {s.currency}
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
    </div>
  );
}

function AuditSection({ orgId }: { orgId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminOrgAudit(orgId, page);
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-3">
      <DataTable
        head={["When", "Action", "Target", "By"]}
        empty={!data?.data.length}
      >
        {data?.data.map((log: Row) => (
          <tr key={log.id}>
            <td className="whitespace-nowrap px-3 py-2 text-xs">
              {formatDate(log.createdAt)}
            </td>
            <td className="px-3 py-2 font-mono text-xs">{log.action}</td>
            <td className="px-3 py-2 text-xs">
              {log.targetType}
              {log.targetId ? ` · ${log.targetId}` : ""}
            </td>
            <td className="px-3 py-2 text-xs">{log.actor?.name ?? "System"}</td>
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
    </div>
  );
}

function LedgerSection({ orgId }: { orgId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminOrgLedger(orgId, page);
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-3">
      <DataTable
        head={["Posted", "Reference", "Description", "Entries"]}
        empty={!data?.data.length}
      >
        {data?.data.map((tx: Row) => (
          <tr key={tx.id}>
            <td className="whitespace-nowrap px-3 py-2 text-xs">
              {formatDate(tx.postedAt)}
            </td>
            <td className="px-3 py-2 text-xs">{tx.referenceType}</td>
            <td className="px-3 py-2">{tx.description}</td>
            <td className="px-3 py-2 text-xs tabular-nums">
              {tx.entries.map((e: Row, i: number) => (
                <div key={i}>
                  {e.direction} {e.amount} · {e.account.code}
                </div>
              ))}
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
    </div>
  );
}
