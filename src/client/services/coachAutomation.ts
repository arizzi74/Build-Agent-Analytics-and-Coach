import type { CoachingModel } from "./coaching.ts";

export interface CoachAutomationSettings {
  automaticEnabled: boolean;
  activeCoachEnabled: boolean;
  modelId: string;
  updatedAt?: string;
}

export interface CoachAutomationTip {
  id: string;
  title: string;
  suggestion: string;
  why?: string;
  createdAt?: string;
}

export interface CoachAutomationState {
  conversationId: string;
  status: "idle" | "queued" | "running" | "completed" | "failed";
  latestTip?: CoachAutomationTip;
  memoryTipCount?: number;
  updatedAt?: string;
}

export interface CoachPromptRevision {
  revisionId: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: { original: string; revised: string; why: string };
  error?: string;
}

const BASE = "/api/x_snc_build_agranx/coaching/automation";

async function request<T>(method: "GET" | "PATCH", signal: AbortSignal, body?: CoachAutomationSettings): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = (window as Window & { g_ck?: string }).g_ck;
  if (token) headers["X-UserToken"] = token;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}/settings`, {
    method,
    credentials: "same-origin",
    headers,
    body: body ? JSON.stringify({ automaticEnabled: body.automaticEnabled, activeCoachEnabled: body.activeCoachEnabled, modelId: body.modelId }) : undefined,
    signal,
  });
  const payload = await response.json().catch(() => null);
  const data = payload?.result ?? payload;
  if (!response.ok || data?.error) {
    throw new Error(typeof data?.error === "string" ? data.error : data?.error?.message || payload?.error?.message || `Coach settings could not be ${method === "GET" ? "loaded" : "saved"} (${response.status}).`);
  }
  if (!data || typeof data.automaticEnabled !== "boolean" || typeof data.activeCoachEnabled !== "boolean" || typeof data.modelId !== "string") {
    throw new Error("The coach service returned incomplete settings. Please try again.");
  }
  return data as T;
}

export function fetchCoachAutomationSettings(signal: AbortSignal): Promise<CoachAutomationSettings> {
  return request("GET", signal);
}

export function saveCoachAutomationSettings(settings: CoachAutomationSettings, signal: AbortSignal): Promise<CoachAutomationSettings> {
  return request("PATCH", signal, settings);
}

export function describeCoachModel(models: CoachingModel[], modelId: string): string {
  return models.find((model) => model.id === modelId)?.label || modelId;
}
