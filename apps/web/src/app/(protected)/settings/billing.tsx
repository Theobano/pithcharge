"use client";

import { toApiError } from "@/lib/api/error";
import { bffUrl } from "@/lib/api/base-url";
import { useCallback, useEffect, useState } from "react";
import { CreditCard, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FundWalletForm } from "@/components/billing/fund-wallet";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/lib/auth-client";
import {
  RateRulesEditor,
  type RateRule,
} from "@/components/billing/rate-rules-editor";
import {
  BillingCycleFields,
  GenerateInvoiceButton,
  runInvoiceJob,
  type InvoiceJobView,
  invoiceBreakdown,
  normalizeCycle,
  type CycleSettings,
  type InvoiceLike,
} from "@/components/billing/invoice-cycle";
import {
  CurrencySelect,
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  TimezoneSelect,
} from "@/components/billing/pricing-options";

type BillingPolicy = CycleSettings & {
  billingMode: "PREPAID" | "POSTPAID";
  walletSharingMode: "SHARED" | "INDIVIDUAL" | "MIXED";
  currency: string;
  ratePerKwh: number | null;
  ratePerMinute: number | null;
  timezone: string;
  sessionFee: number | null;
  idleFeePerMinute: number;
  sessionAuthorizationAmount: number;
  monthlyMinimumSpend: number;
  paymentTermDays: number;
  allowNegativeBalance: boolean;
  negativeBalanceLimit: number;
  lowCreditThreshold: number | null;
};

type WalletSummary = {
  id: string;
  label: string | null;
  currency: string;
  balance: number | string;
  reservedBalance: number | string;
  availableBalance?: number | string;
  status: string;
  user?: { id: string; name: string | null; email: string } | null;
  members?: Array<{ userId: string }>;
};

type LedgerTransaction = {
  id: string;
  description: string;
  referenceType: string;
  postedAt: string;
  currency: string;
  entries: Array<{ direction: "DEBIT" | "CREDIT"; amount: number | string }>;
};

type MonthlyInvoice = InvoiceLike;

type OrganizationMember = {
  user: { id: string; name: string | null; email: string };
  allowNegativeBalance: boolean;
  negativeBalanceLimit: number | string | null;
};

const apiUrl = { toString: bffUrl };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.json() as Promise<T>;
}

function normalizePolicy(value: Record<string, unknown>): BillingPolicy {
  return {
    billingMode: value.billingMode === "POSTPAID" ? "POSTPAID" : "PREPAID",
    walletSharingMode:
      value.walletSharingMode === "INDIVIDUAL" ||
      value.walletSharingMode === "MIXED"
        ? value.walletSharingMode
        : "SHARED",
    currency: String(value.currency ?? DEFAULT_CURRENCY),
    ratePerKwh: value.ratePerKwh == null ? null : Number(value.ratePerKwh),
    ratePerMinute:
      value.ratePerMinute == null ? null : Number(value.ratePerMinute),
    timezone: String(value.timezone ?? DEFAULT_TIMEZONE),
    sessionFee: value.sessionFee == null ? null : Number(value.sessionFee),
    idleFeePerMinute: Number(value.idleFeePerMinute ?? 0),
    sessionAuthorizationAmount: Number(value.sessionAuthorizationAmount ?? 25),
    monthlyMinimumSpend: Number(value.monthlyMinimumSpend ?? 0),
    paymentTermDays: Number(value.paymentTermDays ?? 30),
    ...normalizeCycle(value),
    allowNegativeBalance: Boolean(value.allowNegativeBalance),
    negativeBalanceLimit: Number(value.negativeBalanceLimit ?? 0),
    lowCreditThreshold:
      value.lowCreditThreshold === null ||
      value.lowCreditThreshold === undefined
        ? null
        : Number(value.lowCreditThreshold),
  };
}

export default function BillingSettings() {
  const { data: session } = useSession();
  const [policy, setPolicy] = useState<BillingPolicy | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [wallets, setWallets] = useState<WalletSummary[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [ledger, setLedger] = useState<LedgerTransaction[]>([]);
  const [invoices, setInvoices] = useState<MonthlyInvoice[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [rateRules, setRateRules] = useState<RateRule[]>([]);
  const [canSetBillingMode, setCanSetBillingMode] = useState(false);
  const [canTopUp, setCanTopUp] = useState(false);
  const [publicNetwork, setPublicNetwork] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [walletName, setWalletName] = useState("");
  const [assignUserId, setAssignUserId] = useState("");
  const [assignWalletId, setAssignWalletId] = useState("");

  const refresh = useCallback(async () => {
    const current = await request<{
      data: {
        policy: Record<string, unknown>;
        rateRules: RateRule[];
        wallet: WalletSummary;
        canManage: boolean;
        canSetBillingMode: boolean;
        canTopUp: boolean;
        publicNetwork?: boolean;
      };
    }>("/billing/me");
    const [ledgerResult, invoiceResult, walletsResult, membersResult] =
      await Promise.all([
        request<{ data: LedgerTransaction[] }>("/billing/ledger"),
        request<{ data: MonthlyInvoice[] }>("/billing/invoices"),
        current.data.canManage
          ? request<{ data: WalletSummary[] }>("/billing/wallets")
          : Promise.resolve({ data: [] as WalletSummary[] }),
        current.data.canManage
          ? request<{ data: OrganizationMember[] }>(
              "/organizations/current/members",
            )
          : Promise.resolve({ data: [] as OrganizationMember[] }),
      ]);
    setPolicy(normalizePolicy(current.data.policy));
    setRateRules(current.data.rateRules ?? []);
    setWallet(current.data.wallet);
    setCanManage(current.data.canManage);
    setCanSetBillingMode(current.data.canSetBillingMode);
    setCanTopUp(current.data.canTopUp);
    setPublicNetwork(Boolean(current.data.publicNetwork));
    setLedger(ledgerResult.data);
    setInvoices(invoiceResult.data);
    setWallets(walletsResult.data);
    setMembers(membersResult.data);
  }, []);

  useEffect(() => {
    if (!session?.user || session.user.isAnonymous) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      refresh()
        .catch((error: unknown) => {
          if (active) {
            toast.add({
              type: "error",
              description:
                error instanceof Error
                  ? error.message
                  : "Unable to load billing details.",
            });
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });
    return () => {
      active = false;
    };
  }, [session?.user, refresh]);

  const savePolicy = async () => {
    if (!policy) return;
    setSavingPolicy(true);
    try {
      const result = await request<{ data: Record<string, unknown> }>(
        "/billing/policy",
        {
          method: "PATCH",
          body: JSON.stringify(policy),
        },
      );
      setPolicy(normalizePolicy(result.data));
      toast.add({
        type: "success",
        description: "Organization billing policy updated.",
      });
      await refresh();
    } catch (error) {
      toast.add({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : "Unable to update billing policy.",
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  const createWallet = async () => {
    try {
      await request("/billing/wallets", {
        method: "POST",
        body: JSON.stringify({ name: walletName.trim() || undefined }),
      });
      setWalletName("");
      toast.add({
        type: "success",
        description: "Organization wallet created.",
      });
      await refresh();
    } catch (error) {
      toast.add({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : "Unable to create organization wallet.",
      });
    }
  };

  const assignWallet = async () => {
    if (!assignUserId) return;
    try {
      await request(
        `/billing/members/${encodeURIComponent(assignUserId)}/wallet`,
        {
          method: "PATCH",
          body: JSON.stringify({ walletId: assignWalletId || null }),
        },
      );
      toast.add({
        type: "success",
        description: "Member wallet assignment updated.",
      });
      await refresh();
    } catch (error) {
      toast.add({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : "Unable to update member wallet.",
      });
    }
  };

  const generateInvoice = async () => {
    const issued = await runInvoiceJob(
      async () =>
        (
          await request<{ data: { jobId: string } }>(
            "/billing/invoices/trigger",
            { method: "POST" },
          )
        ).data.jobId,
      async (jobId) =>
        (
          await request<{ data: InvoiceJobView }>(
            `/billing/invoices/jobs/${encodeURIComponent(jobId)}`,
          )
        ).data,
    );
    if (issued) await refresh();
  };

  const payInvoice = async (invoiceId: string) => {
    try {
      await request(`/billing/invoices/${encodeURIComponent(invoiceId)}/pay`, {
        method: "POST",
      });
      toast.add({
        type: "success",
        description: "Invoice paid from the organization wallet.",
      });
      await refresh();
    } catch (error) {
      toast.add({
        type: "error",
        description:
          error instanceof Error ? error.message : "Unable to pay the invoice.",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading billing…
        </CardContent>
      </Card>
    );
  }
  if (!policy || !wallet) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-6">
          <p className="text-sm text-muted-foreground">
            Select an organization to access billing and wallets.
          </p>
          <Button variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const balance = Number(wallet.balance);
  const reserved = Number(wallet.reservedBalance);
  const available =
    wallet.availableBalance === undefined
      ? balance - reserved
      : Number(wallet.availableBalance);
  const mutateRule = async (
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) => {
    try {
      const response = await fetch(`${apiUrl}/api/v1${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw await toApiError(response);
      toast.add({ type: "success", description: success });
      await refresh();
      return true;
    } catch (error) {
      toast.add({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : "Unable to update rate rule.",
      });
      return false;
    }
  };

  const setPolicyField = <K extends keyof BillingPolicy>(
    key: K,
    value: BillingPolicy[K],
  ) => {
    setPolicy((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-4 w-4" />
              Wallet balance
            </CardTitle>
            <CardDescription>
              {publicNetwork
                ? "Your personal wallet for charging on the public network"
                : wallet.label ||
                  (policy.walletSharingMode === "SHARED"
                    ? "Organization shared wallet"
                    : "Your assigned wallet")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Available</p>
                <p className="mt-1 text-xl font-semibold">
                  {available.toLocaleString(undefined, {
                    style: "currency",
                    currency: wallet.currency,
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div className="border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Reserved</p>
                <p className="mt-1 text-xl font-semibold">
                  {reserved.toLocaleString(undefined, {
                    style: "currency",
                    currency: wallet.currency,
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
            {canTopUp && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-sm font-medium">Add funds</p>
                <FundWalletForm currency={wallet.currency} />
                <p className="text-xs text-muted-foreground">
                  Funds are held in the wallet and the actual cost is deducted
                  after each charge.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CreditCard className="h-4 w-4" />
              Billing activity
            </CardTitle>
            <CardDescription>
              Recent posted, balanced ledger transactions for this wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ledger.length === 0 ? (
              <p className="py-5 text-sm text-muted-foreground">
                No posted wallet transactions yet.
              </p>
            ) : (
              ledger.map((item) => {
                const entry = item.entries[0];
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {item.description}
                      </p>
                      <time className="text-xs text-muted-foreground">
                        {new Date(item.postedAt).toLocaleString()}
                      </time>
                    </div>
                    <p className="shrink-0 text-sm font-medium">
                      {entry?.direction === "CREDIT" ? "+" : "−"}
                      {Number(entry?.amount ?? 0).toLocaleString(undefined, {
                        style: "currency",
                        currency: item.currency,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                );
              })
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
              className="gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      </div>

      {canSetBillingMode && !publicNetwork && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Organization billing policy
            </CardTitle>
            <CardDescription>
              Rates, minimums, wallet sharing, and postpaid credit are
              controlled by platform administrators.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1 text-xs text-muted-foreground">
                Billing mode
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  value={policy.billingMode}
                  disabled={!canSetBillingMode}
                  onChange={(event) =>
                    setPolicyField(
                      "billingMode",
                      event.target.value as BillingPolicy["billingMode"],
                    )
                  }
                >
                  <option value="PREPAID">Prepaid</option>
                  <option value="POSTPAID">Postpaid</option>
                </select>
                {!canSetBillingMode && (
                  <span className="block text-[11px]">
                    Billing mode is managed by a platform administrator.
                  </span>
                )}
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Wallet sharing
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  value={policy.walletSharingMode}
                  onChange={(event) =>
                    setPolicyField(
                      "walletSharingMode",
                      event.target.value as BillingPolicy["walletSharingMode"],
                    )
                  }
                >
                  <option value="SHARED">Shared organization wallet</option>
                  <option value="INDIVIDUAL">Individual member wallets</option>
                  <option value="MIXED">Mixed with member assignments</option>
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Currency (ISO 4217)
                <CurrencySelect
                  value={policy.currency}
                  onChange={(value) => setPolicyField("currency", value)}
                />
              </label>
              <OptionalNumberField
                label="General price per kWh (blank = CSMS)"
                value={policy.ratePerKwh}
                onChange={(value) => setPolicyField("ratePerKwh", value)}
              />
              <OptionalNumberField
                label="General price per minute (blank = CSMS)"
                value={policy.ratePerMinute}
                onChange={(value) => setPolicyField("ratePerMinute", value)}
              />
              <label className="space-y-1 text-xs text-muted-foreground">
                Pricing timezone (IANA)
                <TimezoneSelect
                  value={policy.timezone}
                  onChange={(value) => setPolicyField("timezone", value)}
                />
              </label>
              <OptionalNumberField
                label="Per-session fee (blank = CSMS)"
                value={policy.sessionFee}
                onChange={(value) => setPolicyField("sessionFee", value)}
              />
              <NumberField
                label="Idle fee per minute"
                value={policy.idleFeePerMinute}
                onChange={(value) => setPolicyField("idleFeePerMinute", value)}
              />
              <NumberField
                label="Session authorization reserve"
                value={policy.sessionAuthorizationAmount}
                onChange={(value) =>
                  setPolicyField("sessionAuthorizationAmount", value)
                }
              />
              <NumberField
                label="Minimum spend per billing period"
                value={policy.monthlyMinimumSpend}
                onChange={(value) =>
                  setPolicyField("monthlyMinimumSpend", value)
                }
              />
              <NumberField
                label="Payment term (days)"
                value={policy.paymentTermDays}
                onChange={(value) => setPolicyField("paymentTermDays", value)}
                step="1"
              />
              <BillingCycleFields
                value={policy}
                onChange={(next) =>
                  setPolicy((current) =>
                    current ? { ...current, ...next } : current,
                  )
                }
              />
              <NumberField
                label="Low credit notification threshold"
                value={policy.lowCreditThreshold ?? 0}
                onChange={(value) =>
                  setPolicyField("lowCreditThreshold", value > 0 ? value : null)
                }
              />
              <NumberField
                label="Negative balance limit"
                value={policy.negativeBalanceLimit}
                onChange={(value) =>
                  setPolicyField("negativeBalanceLimit", value)
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3 border border-border bg-muted/30 p-3">
              <div>
                <p className="text-sm font-medium">
                  Allow negative wallet balances
                </p>
                <p className="text-xs text-muted-foreground">
                  Permit postpaid charging up to the configured credit limit.
                </p>
              </div>
              <Switch
                checked={policy.allowNegativeBalance}
                onCheckedChange={(checked) => {
                  setPolicy((current) =>
                    current
                      ? {
                          ...current,
                          allowNegativeBalance: checked,
                          negativeBalanceLimit: checked
                            ? current.negativeBalanceLimit
                            : 0,
                        }
                      : current,
                  );
                }}
                aria-label="Allow negative wallet balances"
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => void savePolicy()}
                disabled={
                  savingPolicy ||
                  (policy.allowNegativeBalance &&
                    policy.negativeBalanceLimit <= 0)
                }
              >
                {savingPolicy ? "Saving…" : "Save billing policy"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!publicNetwork && (canSetBillingMode || rateRules.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Rate schedule</CardTitle>
            <CardDescription>
              Time-of-day, day-of-week, and station-specific pricing on top of
              the standard rate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RateRulesEditor
              rules={rateRules}
              currency={policy.currency}
              timezone={policy.timezone}
              canEdit={canSetBillingMode}
              onCreate={(body) =>
                mutateRule(
                  "/billing/rate-rules",
                  "POST",
                  body,
                  "Rate rule added.",
                )
              }
              onUpdate={(ruleId, body) =>
                mutateRule(
                  `/billing/rate-rules/${ruleId}`,
                  "PATCH",
                  body,
                  "Rate rule updated.",
                )
              }
              onDelete={(ruleId) =>
                mutateRule(
                  `/billing/rate-rules/${ruleId}`,
                  "DELETE",
                  undefined,
                  "Rate rule deleted.",
                )
              }
            />
          </CardContent>
        </Card>
      )}

      {!publicNetwork && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-lg">Invoices</CardTitle>
              <CardDescription>
                Invoices are issued at the end of each billing period for
                uninvoiced charges and any minimum spend shortfall.
              </CardDescription>
            </div>
            {canManage && (
              <GenerateInvoiceButton onGenerate={generateInvoice} />
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {invoices.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No invoices have been issued.
              </p>
            ) : (
              invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex flex-col gap-3 border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {new Date(invoice.periodStart).toLocaleDateString()} -{" "}
                      {new Date(invoice.periodEnd).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invoiceBreakdown(invoice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">
                      {Number(invoice.amountDue).toLocaleString(undefined, {
                        style: "currency",
                        currency: invoice.currency,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span
                      className={`text-xs ${invoice.status === "PAID" ? "text-emerald-600" : "text-amber-600"}`}
                    >
                      {invoice.status.toLowerCase()}
                    </span>
                    {canManage && invoice.status === "ISSUED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void payInvoice(invoice.id)}
                      >
                        Pay from wallet
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {canManage && policy.walletSharingMode === "MIXED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Mixed wallet assignments</CardTitle>
            <CardDescription>
              Create organization wallets and optionally assign members to them.
              Unassigned members receive individual wallets.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={walletName}
                onChange={(event) => setWalletName(event.target.value)}
                placeholder="New wallet name"
              />
              <Button className="shrink-0" onClick={() => void createWallet()}>
                Create wallet
              </Button>
            </div>
            <div className="space-y-2">
              {wallets.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border border-border p-3 text-sm"
                >
                  <span>
                    {item.label || "Organization wallet"} · {item.currency}{" "}
                    {Number(item.balance).toLocaleString(undefined, {
                      style: "currency",
                      currency: item.currency,
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.members?.length ?? 0} assigned
                  </span>
                </div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={assignUserId}
                onChange={(event) => setAssignUserId(event.target.value)}
                aria-label="Organization member"
              >
                <option value="">Select a member</option>
                {members.map(({ user }) => (
                  <option key={user.id} value={user.id}>
                    {user.name || user.email}
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={assignWalletId}
                onChange={(event) => setAssignWalletId(event.target.value)}
                aria-label="Wallet assignment"
              >
                <option value="">Individual wallet</option>
                {wallets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label || item.id}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                onClick={() => void assignWallet()}
                disabled={!assignUserId}
              >
                Assign
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OptionalNumberField({
  label,
  value,
  onChange,
  step = "0.01",
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: string;
}) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        min="0"
        step={step}
        placeholder="CSMS tariff"
        value={value ?? ""}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = "0.01",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
}) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
