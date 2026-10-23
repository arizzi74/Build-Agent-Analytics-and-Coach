import React, { useEffect, useRef, useState } from "react";
import { fetchCoachingModels } from "../services/coaching.ts";
import type { CoachingModels } from "../services/coaching.ts";
import { fetchCoachAutomationSettings, saveCoachAutomationSettings, describeCoachModel } from "../services/coachAutomation.ts";
import type { CoachAutomationSettings as Settings } from "../services/coachAutomation.ts";
import "../styles/coachAutomation.css";

const INITIAL: Settings = { automaticEnabled: false, activeCoachEnabled: false, modelId: "gpt-5.6-sol" };

export default function CoachAutomationSettings() {
  const [settings, setSettings] = useState<Settings>(INITIAL);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [models, setModels] = useState<CoachingModels>({ models: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [modelError, setModelError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, []);

  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setModelError("");
    const [settingsResult, modelsResult] = await Promise.allSettled([
      fetchCoachAutomationSettings(controller.signal), fetchCoachingModels(controller.signal),
    ]);
    if (controller.signal.aborted) return;
    if (settingsResult.status === "fulfilled") {
      setSettings(settingsResult.value);
      setSaved(settingsResult.value);
    } else setError(settingsResult.reason instanceof Error ? settingsResult.reason.message : "Coach settings could not be loaded.");
    if (modelsResult.status === "fulfilled" && Array.isArray(modelsResult.value.models)) setModels(modelsResult.value);
    else setModelError("Available coaching models could not be loaded. You can still turn coaching off.");
    setLoading(false);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || loading || !saved) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await saveCoachAutomationSettings(settings, controller.signal);
      if (controller.signal.aborted) return;
      setSettings(result);
      setSaved(result);
      setNotice("Your coaching settings are saved. Open Build Agent to use your coach.");
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Coach settings could not be saved.");
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  function change(next: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...next }));
    setNotice("");
  }

  const dirty = !!saved && (saved.automaticEnabled !== settings.automaticEnabled || saved.activeCoachEnabled !== settings.activeCoachEnabled || saved.modelId !== settings.modelId);
  const enabled = settings.automaticEnabled || settings.activeCoachEnabled;
  const modelAvailable = models.models.some((model) => model.id === settings.modelId);
  const unavailableEnabled = enabled && !modelAvailable;

  return (
    <section className="ba-automation" aria-labelledby="ba-automation-title">
      <header className="ba-automation__header">
        <span className="ba-automation__eyebrow">Your personal Build Agent coach</span>
        <h1 id="ba-automation-title">Coach automation</h1>
        <p>Learn from your conversations and get help with the next prompt. These settings apply only to your signed-in user, across application scopes.</p>
      </header>
      {loading && <p className="ba-automation__status" role="status">Loading your coaching settings…</p>}
      {error && <p className="ba-automation__error" role="alert">{error} {!saved && <button type="button" onClick={load}>Try again</button>}</p>}
      {!loading && saved && <form onSubmit={save}>
        <fieldset className="ba-automation__options" disabled={saving}>
          <legend className="ba-automation__sr-only">Personal coaching options</legend>
          <label className={`ba-automation__option ${settings.automaticEnabled ? "ba-automation__option--on" : ""}`}>
            <span className="ba-automation__option-text"><strong>Automatic coach</strong><span>Review each finished Build Agent turn using its prompt, a summary of the full response, and earlier conversation context. The coach builds a private, progressive memory of useful tips.</span><small>Runs once per turn in your conversations, including responses without tools. Analysis uses the selected model and consumes assists.</small></span>
            <input type="checkbox" role="switch" checked={settings.automaticEnabled} onChange={(event) => change({ automaticEnabled: event.target.checked })} aria-label="Automatic coach" />
          </label>
          <label className={`ba-automation__option ${settings.activeCoachEnabled ? "ba-automation__option--on" : ""}`}>
            <span className="ba-automation__option-text"><strong>Active coach in Build Agent</strong><span>Show the floating Otto coach. Click it while drafting a prompt to review a suggested revision, then choose whether to apply it.</span><small>With Automatic coach enabled, relevant tips also appear in a suggestion balloon. Changes are applied only after your confirmation.</small></span>
            <input type="checkbox" role="switch" checked={settings.activeCoachEnabled} onChange={(event) => change({ activeCoachEnabled: event.target.checked })} aria-label="Active coach in Build Agent" />
          </label>
          <div className="ba-automation__model">
            <label htmlFor="ba-automation-model">Coaching model</label>
            <select id="ba-automation-model" value={settings.modelId} onChange={(event) => change({ modelId: event.target.value })} disabled={!models.models.length} aria-describedby="ba-automation-model-help">
              {!modelAvailable && <option value={settings.modelId}>{describeCoachModel(models.models, settings.modelId)} · unavailable</option>}
              {models.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
            <p id="ba-automation-model-help">Used for automatic coaching and prompt revisions. Raw tool inputs and results are excluded from coaching context.</p>
            {modelError && <p className="ba-automation__error">{modelError}</p>}
            {models.message && <p>{models.message}</p>}
            {unavailableEnabled && <p className="ba-automation__error">Select an available model before enabling coaching.</p>}
          </div>
        </fieldset>
        <footer className="ba-automation__footer">
          <p>{dirty ? "You have unsaved changes." : saved.automaticEnabled || saved.activeCoachEnabled ? "Your personal coach settings are up to date." : "Coaching automation is off for your user."}</p>
          <button type="submit" disabled={!dirty || saving || unavailableEnabled}>{saving ? "Saving…" : "Save settings"}</button>
        </footer>
      </form>}
      <p className="ba-automation__notice" role="status" aria-live="polite">{notice}</p>
    </section>
  );
}
