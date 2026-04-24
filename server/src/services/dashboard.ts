import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentRuntimeState, agents, approvals, companies, costEvents, heartbeatRuns, issues } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";

const DASHBOARD_RUN_ACTIVITY_DAYS = 14;

function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getUtcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getRecentUtcDateKeys(now: Date, days: number): string[] {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const dayOffset = index - (days - 1);
    return formatUtcDateKey(new Date(todayUtc + dayOffset * 24 * 60 * 60 * 1000));
  });
}

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  return {
    summary: async (companyId: string) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      const taskRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .groupBy(issues.status);

      const agentUsageRows = await db
        .select({
          agentId: agents.id,
          agentName: agents.name,
          agentStatus: agents.status,
          inputTokens: sql<number>`coalesce(${agentRuntimeState.totalInputTokens}, 0)::double precision`,
          cachedInputTokens: sql<number>`coalesce(${agentRuntimeState.totalCachedInputTokens}, 0)::double precision`,
          outputTokens: sql<number>`coalesce(${agentRuntimeState.totalOutputTokens}, 0)::double precision`,
          lastError: agentRuntimeState.lastError,
        })
        .from(agents)
        .leftJoin(
          agentRuntimeState,
          and(
            eq(agentRuntimeState.agentId, agents.id),
            eq(agentRuntimeState.companyId, companyId),
          ),
        )
        .where(eq(agents.companyId, companyId));

      const lastSuccessfulRunRows = await db
        .select({
          agentId: heartbeatRuns.agentId,
          lastSuccessfulRunAt: sql<Date | null>`max(${heartbeatRuns.finishedAt})`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.status, "succeeded"),
          ),
        )
        .groupBy(heartbeatRuns.agentId);

      const pendingApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const monthStart = getUtcMonthStart(now);
      const runActivityDays = getRecentUtcDateKeys(now, DASHBOARD_RUN_ACTIVITY_DAYS);
      const runActivityStart = new Date(`${runActivityDays[0]}T00:00:00.000Z`);
      const [{ monthSpend, monthInputTokens, monthCachedInputTokens, monthOutputTokens, monthCostEventCount }] = await db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
          monthInputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
          monthCachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
          monthOutputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
          monthCostEventCount: sql<number>`count(*)::double precision`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        );

      const monthSpendCents = Number(monthSpend);
      const runActivityDayExpr = sql<string>`to_char(${heartbeatRuns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
      const runActivityRows = await db
        .select({
          date: runActivityDayExpr,
          status: heartbeatRuns.status,
          count: sql<number>`count(*)::double precision`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            gte(heartbeatRuns.createdAt, runActivityStart),
          ),
        )
        .groupBy(runActivityDayExpr, heartbeatRuns.status);

      const runActivity = new Map(
        runActivityDays.map((date) => [
          date,
          { date, succeeded: 0, failed: 0, other: 0, total: 0 },
        ]),
      );
      for (const row of runActivityRows) {
        const bucket = runActivity.get(row.date);
        if (!bucket) continue;
        const count = Number(row.count);
        if (row.status === "succeeded") bucket.succeeded += count;
        else if (row.status === "failed" || row.status === "timed_out") bucket.failed += count;
        else bucket.other += count;
        bucket.total += count;
      }

      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);
      const lastSuccessfulRunByAgentId = new Map(
        lastSuccessfulRunRows.map((row) => [row.agentId, row.lastSuccessfulRunAt ?? null]),
      );
      const agentUsage = agentUsageRows
        .map((row) => ({
          agentId: row.agentId,
          agentName: row.agentName,
          agentStatus: row.agentStatus,
          inputTokens: Number(row.inputTokens ?? 0),
          cachedInputTokens: Number(row.cachedInputTokens ?? 0),
          outputTokens: Number(row.outputTokens ?? 0),
          lastError: row.lastError ?? null,
          lastSuccessfulRunAt: lastSuccessfulRunByAgentId.get(row.agentId) ?? null,
        }))
        .sort((left, right) => {
          const leftTotal = left.inputTokens + left.cachedInputTokens + left.outputTokens;
          const rightTotal = right.inputTokens + right.cachedInputTokens + right.outputTokens;
          if (rightTotal !== leftTotal) return rightTotal - leftTotal;
          return left.agentName.localeCompare(right.agentName);
        });
      const runtimeUsage = agentUsage.reduce(
        (totals, row) => ({
          inputTokens: totals.inputTokens + row.inputTokens,
          cachedInputTokens: totals.cachedInputTokens + row.cachedInputTokens,
          outputTokens: totals.outputTokens + row.outputTokens,
        }),
        { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      );
      const monthUsage = {
        inputTokens: Number(monthInputTokens),
        cachedInputTokens: Number(monthCachedInputTokens),
        outputTokens: Number(monthOutputTokens),
      };
      const monthUsageTotal = monthUsage.inputTokens + monthUsage.cachedInputTokens + monthUsage.outputTokens;
      const runtimeUsageTotal = runtimeUsage.inputTokens + runtimeUsage.cachedInputTokens + runtimeUsage.outputTokens;
      const usage =
        Number(monthCostEventCount) > 0 || monthUsageTotal > 0
          ? {
              ...monthUsage,
              totalTokens: monthUsageTotal,
              source: "cost_events" as const,
              isEstimated: false,
            }
          : runtimeUsageTotal > 0
            ? {
                ...runtimeUsage,
                totalTokens: runtimeUsageTotal,
                source: "runtime_state_estimate" as const,
                isEstimated: true,
              }
            : {
                inputTokens: 0,
                cachedInputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                source: "none" as const,
                isEstimated: false,
              };

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
          usage,
        },
        agentUsage,
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        runActivity: Array.from(runActivity.values()),
      };
    },
  };
}
