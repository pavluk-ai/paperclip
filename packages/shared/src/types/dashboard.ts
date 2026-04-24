export interface DashboardTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: "cost_events" | "runtime_state_estimate" | "none";
  isEstimated: boolean;
}

export interface DashboardAgentUsageSummary {
  agentId: string;
  agentName: string;
  agentStatus: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  lastError: string | null;
  lastSuccessfulRunAt: Date | null;
}

export interface DashboardRunActivityDay {
  date: string;
  succeeded: number;
  failed: number;
  other: number;
  total: number;
}

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
    usage: DashboardTokenUsage;
  };
  agentUsage: DashboardAgentUsageSummary[];
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
  runActivity: DashboardRunActivityDay[];
}
