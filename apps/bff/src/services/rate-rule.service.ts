import { Static, Type } from '@sinclair/typebox';
import { db } from '@pithcharge/db';

const Time = Type.Union([Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), Type.Null()]);

export const RateRuleInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 80 }),
  priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
  active: Type.Optional(Type.Boolean()),
  daysOfWeek: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { maxItems: 7 })),
  startTime: Type.Optional(Time),
  endTime: Type.Optional(Time),
  stationIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 })),
  validFrom: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  validUntil: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  ratePerKwh: Type.Number({ minimum: 0 }),
  ratePerMinute: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  sessionFee: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  idleFeePerMinute: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
}, { additionalProperties: false });
export type RateRuleInputType = Static<typeof RateRuleInput>;

export const RateRulePatch = Type.Partial(RateRuleInput);

export type RuleResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };
const fail = (status: number, message: string): { ok: false; status: number; message: string } => ({
  ok: false,
  status,
  message,
});

function validate(data: Partial<RateRuleInputType>): string | null {
  const hasStart = data.startTime !== undefined && data.startTime !== null;
  const hasEnd = data.endTime !== undefined && data.endTime !== null;
  if (hasStart !== hasEnd) return 'Start and end time must be set together.';
  if (hasStart && data.startTime === data.endTime) return 'Start and end time must differ.';
  if (data.validFrom && data.validUntil && new Date(data.validFrom) >= new Date(data.validUntil)) {
    return 'The valid-until date must be after the valid-from date.';
  }
  return null;
}

function toData(data: Partial<RateRuleInputType>) {
  const { validFrom, validUntil, daysOfWeek, ...rest } = data;
  return {
    ...rest,
    ...(daysOfWeek ? { daysOfWeek: [...new Set(daysOfWeek)].sort() } : {}),
    ...(validFrom !== undefined ? { validFrom: validFrom ? new Date(validFrom) : null } : {}),
    ...(validUntil !== undefined ? { validUntil: validUntil ? new Date(validUntil) : null } : {}),
  };
}

export function listRateRules(organizationId: string) {
  return db.rateRule.findMany({
    where: { organizationId },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
}

export async function createRateRule(
  organizationId: string,
  input: RateRuleInputType,
  actorId: string,
) {
  const problem = validate(input);
  if (problem) return fail(400, problem);
  const rule = await db.rateRule.create({
    data: { organizationId, daysOfWeek: [], stationIds: [], ...toData(input), ratePerKwh: input.ratePerKwh },
  });
  await db.auditLog.create({
    data: {
      actorId,
      organizationId,
      action: 'billing.rate_rule.created',
      targetType: 'RateRule',
      targetId: rule.id,
      metadata: { name: rule.name },
    },
  });
  return { ok: true as const, value: rule };
}

export async function updateRateRule(
  organizationId: string,
  ruleId: string,
  patch: Partial<RateRuleInputType>,
  actorId: string,
) {
  const existing = await db.rateRule.findFirst({ where: { id: ruleId, organizationId } });
  if (!existing) return fail(404, 'Rate rule not found.');
  const problem = validate({
    startTime: existing.startTime,
    endTime: existing.endTime,
    validFrom: existing.validFrom?.toISOString() ?? null,
    validUntil: existing.validUntil?.toISOString() ?? null,
    ...patch,
  });
  if (problem) return fail(400, problem);
  const rule = await db.rateRule.update({ where: { id: ruleId }, data: toData(patch) });
  await db.auditLog.create({
    data: {
      actorId,
      organizationId,
      action: 'billing.rate_rule.updated',
      targetType: 'RateRule',
      targetId: rule.id,
      metadata: { changes: Object.keys(patch) },
    },
  });
  return { ok: true as const, value: rule };
}

export async function deleteRateRule(organizationId: string, ruleId: string, actorId: string) {
  const existing = await db.rateRule.findFirst({ where: { id: ruleId, organizationId } });
  if (!existing) return fail(404, 'Rate rule not found.');
  await db.rateRule.delete({ where: { id: ruleId } });
  await db.auditLog.create({
    data: {
      actorId,
      organizationId,
      action: 'billing.rate_rule.deleted',
      targetType: 'RateRule',
      targetId: ruleId,
      metadata: { name: existing.name },
    },
  });
  return { ok: true as const, value: null };
}
