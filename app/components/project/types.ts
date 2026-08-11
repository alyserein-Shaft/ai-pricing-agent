export type DashboardAction = {
  id: string; projectId: string; projectName?: string; priority: number;
  severity: string; title: string; description: string; owner: string;
  requiredRole: string; dueDate?: string | null; blocking: boolean; route: string;
};
export type DashboardRisk = {
  id: string; type: string; severity: string; trigger: string; impact: string;
  module: string; recommendedAction: string; owner: string;
};
export type WorkflowStage = {
  id: string; name: string; weight: number; route: string; owner: string;
  status: string; progress: number; blockingIssues: number; warningCount: number;
  nextAction: string;
};
export type ServerProjectDashboard = {
  modelVersion: string;
  project: { id: string; name: string; client?: string; tenderNumber?: string;
    dueDate?: string; currency: string; owner: string; effectiveRole?: string | null;
    organizationId?: string | null; systemDomain?: string; initialStatus?: string;
    status: string; updatedAt?: string };
  workflow: { version: string; stages: WorkflowStage[]; progress: number; ready: boolean };
  nextAction: DashboardAction | null; actions: DashboardAction[]; risks: DashboardRisk[];
  facts: Record<string, number>; totals?: { currency: string; estimatedCost: number;
    quotedValue: number; averageMargin: number }; commercialRestricted: boolean;
  updatedAt: string; refreshAfterMs: number;
};
export type PreSalesWorkflow = {
  modelVersion: string; lifecycleState: string; workflowStatus: string;
  workflowStage: string; status: string; progress: number; currentStageId: string;
  readyForQuotation: boolean; readyForIssue: boolean;
  stages: Array<{ id: string; name: string; owner: string; route: string; status: string;
    progress: number; blockers: string[]; warnings: string[]; action: string }>;
  blockers: Array<{ stageId: string; stage: string; message: string; route: string; owner: string }>;
  warnings: Array<{ stageId: string; stage: string; message: string; route: string; owner: string }>;
  nextAction: { title: string; route: string; owner: string; stageId: string } | null;
  facts: Record<string, number>;
};
export type EstimatorReadiness = {
  modelVersion: string;
  summary: { total: number; ready: number; review: number; missing: number; excluded: number; aiCoverage: number; quotationCoverage: number };
  items?: Array<{ boqItemId: string; understanding: { status: string; normalizedDescription?: { value?: string | null } | string | null; system?: { value?: string | null } | string | null; equipmentType?: { value?: string | null } | string | null; attributes?: Record<string, { value?: unknown; origin?: string; confidence?: number }>; missingInformation?: Array<{ value?: string } | string>; confidence?: string } }>;
};
