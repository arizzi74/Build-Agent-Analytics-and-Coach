declare const window: Window & { g_ck?: string };

const BASE = "/api/x_snc_build_agranx/coaching";
const REQUEST_TIMEOUT_MS = 120000;
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;

export interface CoachingModel {
  id: string;
  label: string;
  provider?: string;
}

export interface CoachingModels {
  models: CoachingModel[];
  defaultModelId?: string;
  message?: string;
  warnings?: string[];
}

export interface CoachingActivity {
  tool: string;
  count: number;
  successful?: number;
  failed?: number;
  unknown?: number;
}

export interface CoachingTurn {
  turnId: string;
  prompt: string;
  responseSummary: string;
  errors: Array<CoachingActivity | string>;
  generated: Array<CoachingActivity | string>;
  promptTruncated?: boolean;
  responseTruncated?: boolean;
  assistantReportedError?: boolean;
  assistantErrors?: string[];
  userReportedError?: boolean;
  userErrors?: string[];
}

export interface PreparedConversation {
  turns: CoachingTurn[];
  inputHash: string;
  stats?: Record<string, number | string | boolean>;
  warnings?: string[];
  canAnalyze?: boolean;
  analysisInput?: string;
}

export interface CoachingTip {
  turnId: string;
  evidenceTurnIds: string[];
  issue: string;
  promptMistake: string;
  misunderstanding: string;
  why: string;
  rewrite: string;
  category?: string;
}

export interface CoachingResult {
  /** Persisted analysis used to bind a skill preview to the exact reviewed result. */
  jobId?: string;
  summary: string;
  tips: CoachingTip[];
  limitations?: string[];
  modelId?: string;
  modelLabel?: string;
  actualModel?: string;
}

export interface BuildSkillOwner {
  id: string;
  name: string;
  userName: string;
}

export interface BuildSkillPreview {
  draftId: string;
  jobId: string;
  conversationId: string;
  modelId: string;
  inputHash: string;
  previewHash: string;
  owner: BuildSkillOwner;
  availability: { allScopes: true; ownerOnly: true };
  skill: { name: string; description: string; content: string };
  warnings?: string[];
  existingSkill?: { id: string; name: string };
}

interface BuildSkillDraftJob extends Partial<BuildSkillPreview> {
  status: "running" | "completed" | "failed";
  error?: string | { message?: string };
  message?: string;
}

export interface BuildSkillInstallation {
  skillId: string;
  name: string;
  owner: BuildSkillOwner;
  allScopes: true;
  ownerOnly: true;
  alreadyInstalled?: boolean;
}

interface CoachingJob {
  jobId?: string;
  status?: string;
  result?: CoachingResult;
  summary?: string;
  tips?: CoachingTip[];
  error?: string | { message?: string };
  message?: string;
}

export class CoachingRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CoachingRequestError";
    this.status = status;
  }
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return undefined;
}

/** Keep the session token in headers; conversation text is prepared on the server. */
async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (window.g_ck) headers["X-UserToken"] = window.g_ck;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    // Scripted REST APIs wrap response bodies in {result: ...}.
    const data = payload && "result" in payload && !payload.jobId && !payload.status
      ? payload.result
      : payload;
    if (!response.ok || data?.error) {
      throw new CoachingRequestError(errorMessage(data?.error) || errorMessage(payload?.error) || data?.message || `Coaching request failed (${response.status}).`, response.status);
    }
    if (!data || typeof data !== "object") throw new Error("The coaching service returned an empty response. Please try again.");
    return data as T;
  } catch (error) {
    if (timedOut && !signal.aborted) throw new Error("The coaching request timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function fetchCoachingModels(signal: AbortSignal): Promise<CoachingModels> {
  return request("/models", signal);
}

export function prepareConversation(conversationId: string, signal: AbortSignal): Promise<PreparedConversation> {
  return request("/prepare", signal, { conversationId });
}

export async function generateBuildSkillPreview(jobId: string, signal: AbortSignal, onStatus?: (status: string) => void): Promise<BuildSkillPreview> {
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  let draft = await request<BuildSkillDraftJob>("/skills/preview", signal, { jobId });
  const draftId = draft.draftId;
  while (true) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (draft.status === "failed") throw new Error(errorMessage(draft.error) || draft.message || "The skill could not be prepared. Please try again.");
    if (draft.status === "completed") {
      if (draft.draftId !== draftId || !draftId || draft.jobId !== jobId || !draft.previewHash || !draft.owner?.id || !draft.owner?.name
        || draft.availability?.allScopes !== true || draft.availability?.ownerOnly !== true
        || !draft.skill?.name || !draft.skill?.description || !draft.skill?.content) {
        throw new Error("The skill preview could not be verified. Please prepare it again.");
      }
      return draft as BuildSkillPreview;
    }
    if (!draftId || draft.status !== "running") throw new Error("The skill service returned an incomplete preview. Please try again.");
    if (Date.now() >= deadline) throw new Error("Preparing the skill is taking longer than expected. Please try again later.");
    onStatus?.("Building a skill with your selected coaching model…");
    await delay(2000, signal);
    draft = await request<BuildSkillDraftJob>(`/skills/previews/${encodeURIComponent(draftId)}`, signal);
  }
}

export async function installBuildSkill(draftId: string, previewHash: string, signal: AbortSignal): Promise<BuildSkillInstallation> {
  return request("/skills/install", signal, { draftId, previewHash, confirm: true });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Supports direct responses and persisted asynchronous analysis jobs. */
export async function generateCoaching(
  conversationId: string,
  modelId: string,
  inputHash: string,
  signal: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<CoachingResult> {
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  let job = await request<CoachingJob>("/analyze", signal, { conversationId, modelId, inputHash });
  const jobId = job.jobId;

  while (true) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (Array.isArray(job.tips) && typeof job.summary === "string") return { ...job as CoachingResult, jobId: job.jobId || jobId };
    if (job.result && Array.isArray(job.result.tips) && typeof job.result.summary === "string") return { ...job.result, jobId: job.jobId || jobId };
    if (["failed", "error", "cancelled"].includes(job.status || "")) {
      throw new Error(errorMessage(job.error) || job.message || "The model could not complete the analysis. Please try again.");
    }
    if (["completed", "complete"].includes(job.status || "")) {
      throw new Error("The coaching service completed without a valid analysis. Please try again.");
    }
    if (!jobId) throw new Error("The coaching service returned an incomplete result. Please try again.");
    if (Date.now() >= deadline) throw new Error("Analysis is taking longer than expected. Please try again later.");
    onStatus?.(job.status === "queued" ? "Waiting for the model…" : "Reviewing prompts, responses, and corrections…");
    await delay(2000, signal);
    job = await request<CoachingJob>(`/jobs/${encodeURIComponent(jobId)}`, signal);
  }
}
