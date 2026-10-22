import React, { useEffect, useRef, useState } from "react";
import BuildSkillPanel from "./BuildSkillPanel.tsx";
import {
  CoachingRequestError,
  fetchCoachingModels,
  generateCoaching,
  prepareConversation,
} from "../services/coaching.ts";
import type {
  CoachingActivity,
  CoachingModels,
  CoachingResult,
  CoachingTip,
  CoachingTurn,
  PreparedConversation,
} from "../services/coaching.ts";

function describeActivity(activity: CoachingActivity | string): string {
  if (typeof activity === "string") return activity;
  const statuses: string[] = [];
  if (activity.successful) statuses.push(`${activity.successful} succeeded`);
  if (activity.failed) statuses.push(`${activity.failed} failed`);
  if (activity.unknown) statuses.push(`${activity.unknown} unconfirmed`);
  return `${activity.tool}${activity.count > 1 ? ` × ${activity.count}` : ""}${statuses.length ? ` (${statuses.join(", ")})` : ""}`;
}

function promptNumber(turnId: string): string {
  return turnId.replace(/^T/i, "");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function WarningList({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <ul className="ba-coaching__warnings">{messages.map((message, index) => <li key={index}>{message}</li>)}</ul>;
}

function TurnPreview({ turn, id }: { turn: CoachingTurn; id: string }) {
  return (
    <details className="ba-coaching__turn" id={id}>
      <summary>
        <span className="ba-coaching__turn-label">Prompt {promptNumber(turn.turnId)}</span>
        <span className="ba-coaching__turn-excerpt">{turn.prompt || "No text prompt"}</span>
        {(!!turn.errors?.length || turn.assistantReportedError || turn.userReportedError) && <span className="ba-coaching__badge ba-coaching__badge--error">Errors</span>}
      </summary>
      <div className="ba-coaching__turn-body">
        <h4>User prompt</h4>
        <p className="ba-coaching__text">{turn.prompt || "No text prompt"}</p>
        {turn.promptTruncated && <p className="ba-coaching__muted">Long prompt shortened for analysis.</p>}
        {!!turn.userErrors?.length && (
          <div className="ba-coaching__activity ba-coaching__activity--error">
            <strong>User-reported errors:</strong>
            <ul className="ba-coaching__error-list">{turn.userErrors.map((error, index) => <li key={index}>{error}</li>)}</ul>
          </div>
        )}
        {turn.userReportedError && !turn.userErrors?.length && <p className="ba-coaching__activity ba-coaching__activity--error">The user reported a possible error or failure; see the prompt for context.</p>}
        <h4>Response summary</h4>
        <p className="ba-coaching__text">{turn.responseSummary || "No assistant response recorded."}</p>
        {turn.responseTruncated && <p className="ba-coaching__muted">Long response shortened for analysis.</p>}
        {!!turn.generated?.length && (
          <p className="ba-coaching__activity"><strong>Build / change activity:</strong> {turn.generated.map(describeActivity).join(" · ")}</p>
        )}
        {!!turn.errors?.length && (
          <p className="ba-coaching__activity ba-coaching__activity--error"><strong>Errors:</strong> {turn.errors.map(describeActivity).join(" · ")}</p>
        )}
        {!!turn.assistantErrors?.length && (
          <div className="ba-coaching__activity ba-coaching__activity--error">
            <strong>Assistant-reported errors:</strong>
            <ul className="ba-coaching__error-list">{turn.assistantErrors.map((error, index) => <li key={index}>{error}</li>)}</ul>
          </div>
        )}
        {turn.assistantReportedError && !turn.assistantErrors?.length && <p className="ba-coaching__activity ba-coaching__activity--error">The assistant mentioned a possible error or failure; see the response summary for context.</p>}
      </div>
    </details>
  );
}

function TipCard({ tip, turn, onEvidence }: {
  tip: CoachingTip;
  turn?: CoachingTurn;
  onEvidence: (turnId: string) => void;
}) {
  const agentOrEnvironment = tip.category === "agent_or_environment";
  return (
    <article className="ba-coaching__tip">
      <div className="ba-coaching__tip-heading">
        <button className="ba-coaching__evidence" type="button" onClick={() => onEvidence(tip.turnId)}>
          Prompt {promptNumber(tip.turnId)}
        </button>
        {tip.category && <span className="ba-coaching__badge">{tip.category.replace(/_/g, " ")}</span>}
      </div>
      {turn?.prompt && <blockquote className="ba-coaching__quote">{turn.prompt.length > 320 ? `${turn.prompt.slice(0, 320)}…` : turn.prompt}</blockquote>}
      <h4>{tip.issue}</h4>
      <dl className="ba-coaching__diagnosis">
        <div>
          <dt>{agentOrEnvironment ? "Prompt assessment" : "What went wrong"}</dt>
          <dd className="ba-coaching__text">{tip.promptMistake?.trim() || "Not assessed in this saved tip."}</dd>
        </div>
        <div>
          <dt>{agentOrEnvironment ? "What the response shows" : "How the agent misunderstood it"}</dt>
          <dd className="ba-coaching__text">{tip.misunderstanding?.trim() || "Not assessed in this saved tip."}</dd>
        </div>
      </dl>
      <div className="ba-coaching__rewrite">
        <h5>Try this prompt</h5>
        <p className="ba-coaching__text">{tip.rewrite}</p>
      </div>
      <p className="ba-coaching__why ba-coaching__text"><strong>Why this helps:</strong> {tip.why}</p>
      {!!tip.evidenceTurnIds?.length && (
        <div className="ba-coaching__evidence-row">
          <span>Evidence:</span>
          {Array.from(new Set([tip.turnId, ...tip.evidenceTurnIds])).map((turnId) => (
            <button key={turnId} type="button" className="ba-coaching__evidence" onClick={() => onEvidence(turnId)}>
              Prompt {promptNumber(turnId)}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

/** A conversation change replaces all state before render, including pending requests. */
export default function ConversationCoaching({ conversationId }: { conversationId: string }) {
  return <ConversationCoachingPanel key={conversationId} conversationId={conversationId} />;
}

/** No model invocation occurs until the user explicitly requests coaching. */
function ConversationCoachingPanel({ conversationId }: { conversationId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [models, setModels] = useState<CoachingModels | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelId, setModelId] = useState("");
  const [modelError, setModelError] = useState("");
  const [prepared, setPrepared] = useState<PreparedConversation | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const [previewOutdated, setPreviewOutdated] = useState(false);
  const [result, setResult] = useState<CoachingResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const modelRequest = useRef<AbortController | null>(null);
  const prepareRequest = useRef<AbortController | null>(null);
  const analysisRequest = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLDetailsElement>(null);
  const revision = useRef(0);
  const sectionId = `coaching-${conversationId}`;

  useEffect(() => () => {
    revision.current += 1;
    modelRequest.current?.abort();
    prepareRequest.current?.abort();
    analysisRequest.current?.abort();
  }, [conversationId]);

  async function loadModels() {
    modelRequest.current?.abort();
    const controller = new AbortController();
    modelRequest.current = controller;
    setModelsLoading(true);
    setModelError("");
    try {
      const data = await fetchCoachingModels(controller.signal);
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.models)) throw new Error("Available coaching models could not be loaded.");
      setModels(data);
      setModelId(data.models.some((model) => model.id === data.defaultModelId) ? data.defaultModelId! : data.models[0]?.id || "");
    } catch (error) {
      if (!controller.signal.aborted) setModelError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setModelsLoading(false);
    }
  }

  function toggleExpanded() {
    if (!expanded && !models && !modelsLoading) void loadModels();
    setExpanded(!expanded);
  }

  function changeModel(nextModelId: string) {
    revision.current += 1;
    analysisRequest.current?.abort();
    setModelId(nextModelId);
    setResult(null);
    setAnalysisError("");
    setAnalyzing(false);
    setAnalysisStatus("");
  }

  async function prepare() {
    prepareRequest.current?.abort();
    analysisRequest.current?.abort();
    revision.current += 1;
    const controller = new AbortController();
    prepareRequest.current = controller;
    setPreparing(true);
    setPrepared(null);
    setResult(null);
    setAnalyzing(false);
    setPrepareError("");
    setPreviewOutdated(false);
    setAnalysisError("");
    try {
      const data = await prepareConversation(conversationId, controller.signal);
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.turns) || (data.canAnalyze !== false && !data.inputHash)) throw new Error("The conversation preview could not be prepared. Please try again.");
      setPrepared(data);
      setPreviewOpen(true);
    } catch (error) {
      if (!controller.signal.aborted) setPrepareError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setPreparing(false);
    }
  }

  async function analyze() {
    if (!modelId || !prepared?.turns.length || !prepared.inputHash || prepared.canAnalyze === false || previewOutdated) return;
    analysisRequest.current?.abort();
    const controller = new AbortController();
    analysisRequest.current = controller;
    const thisRevision = ++revision.current;
    setAnalyzing(true);
    setResult(null);
    setAnalysisError("");
    setAnalysisStatus("Reviewing prompts, responses, and corrections…");
    try {
      const data = await generateCoaching(conversationId, modelId, prepared.inputHash, controller.signal, (status) => {
        if (thisRevision === revision.current && !controller.signal.aborted) setAnalysisStatus(status);
      });
      if (thisRevision !== revision.current || controller.signal.aborted) return;
      setResult(data);
      setPreviewOpen(false);
    } catch (error) {
      if (thisRevision === revision.current && !controller.signal.aborted) {
        if (error instanceof CoachingRequestError && error.status === 409) setPreviewOutdated(true);
        else setAnalysisError(errorText(error));
      }
    } finally {
      if (thisRevision === revision.current && !controller.signal.aborted) setAnalyzing(false);
    }
  }

  function showEvidence(turnId: string) {
    const target = document.getElementById(`${sectionId}-${turnId}`) as HTMLDetailsElement | null;
    if (!target) return;
    setPreviewOpen(true);
    if (previewRef.current) previewRef.current.open = true;
    target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.querySelector("summary")?.focus({ preventScroll: true });
  }

  const selectedModel = models?.models.find((model) => model.id === modelId);
  const canGenerate = !!modelId && !!prepared?.turns.length && !!prepared.inputHash && prepared.canAnalyze !== false && !previewOutdated && !preparing && !analyzing;

  return (
    <section className="ba-section ba-coaching" aria-labelledby={`${sectionId}-title`}>
      <h2 className="ba-coaching__heading">
      <button className="ba-coaching__toggle" type="button" aria-expanded={expanded} aria-controls={`${sectionId}-body`} onClick={toggleExpanded}>
        <span>
          <span className="ba-coaching__eyebrow">Build Agent Coach</span>
          <span className="ba-coaching__title" id={`${sectionId}-title`}>Better prompts. Fewer corrections.</span>
          <span className="ba-coaching__intro">Get concise, specific suggestions from this conversation’s corrections and errors.</span>
        </span>
        <span className="ba-coaching__toggle-label">{expanded ? "Close coach −" : "Open coach +"}</span>
      </button>
      </h2>

      <div id={`${sectionId}-body`} className="ba-coaching__body" hidden={!expanded}>
        <div className="ba-coaching__controls">
          <div className="ba-coaching__model-field">
            <label htmlFor={`${sectionId}-model`}>Coaching model</label>
            <select id={`${sectionId}-model`} value={modelId} onChange={(event) => changeModel(event.target.value)} disabled={modelsLoading || !models?.models.length}>
              {!modelId && <option value="">{modelsLoading ? "Loading available models…" : "No model available"}</option>}
              {models?.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </div>
          <button className="ba-coaching__button ba-coaching__button--secondary" type="button" onClick={prepare} disabled={preparing || analyzing}>
            {preparing ? "Preparing preview…" : prepared ? "Refresh preview" : "Preview conversation"}
          </button>
          <button className="ba-coaching__button" type="button" onClick={analyze} disabled={!canGenerate}>
            {analyzing ? "Analyzing…" : result ? "Show saved coaching" : "Generate coaching"}
          </button>
        </div>
        {modelError && <div className="ba-coaching__error" role="alert">{modelError} <button type="button" className="ba-coaching__evidence" onClick={loadModels}>Retry models</button></div>}
        {models?.message && <p className="ba-coaching__muted">{models.message}</p>}
        {models && !models.models.length && !models.message && <p className="ba-coaching__muted">No supported coaching model is available on this instance.</p>}
        <WarningList messages={models?.warnings} />
        {!prepared && !preparing && !prepareError && <p className="ba-coaching__muted">Preview the prompts and response summaries, then generate coaching with your selected model.</p>}
        {preparing && <p className="ba-coaching__status" role="status">Preparing prompts and response summaries…</p>}
        {prepareError && <p className="ba-coaching__error" role="alert">{prepareError}</p>}

        {prepared && (
          <>
            <p className="ba-coaching__muted">{prepared.turns.length} prompt{prepared.turns.length === 1 ? "" : "s"} prepared. Raw tool inputs and results are excluded; generated work and failures are summarized.</p>
            <WarningList messages={prepared.warnings} />
            {!prepared.turns.length && <p className="ba-coaching__muted">No user prompts are available for coaching in this conversation.</p>}
            {prepared.canAnalyze === false && <p className="ba-coaching__error" role="alert">This conversation cannot be analyzed. Review the preparation details above.</p>}
          </>
        )}
        <div aria-live="polite" aria-atomic="true">
          {analyzing && <p className="ba-coaching__status"><span className="ba-coaching__spinner" aria-hidden="true" />{analysisStatus} This may take a few minutes.</p>}
          {result && <p className="ba-coaching__complete">Coaching ready · {result.modelLabel || selectedModel?.label}</p>}
        </div>
        {analysisError && <p className="ba-coaching__error" role="alert">{analysisError}</p>}
        {previewOutdated && <p className="ba-coaching__error" role="alert">This conversation has changed since the preview was prepared. Select Refresh preview, then generate coaching again.</p>}

        {result && (
          <div className="ba-coaching__results">
            <h3>Your coaching tips</h3>
            <p className="ba-coaching__muted">Saved for this conversation snapshot.</p>
            {result.actualModel && <p className="ba-coaching__muted">Model used: {result.actualModel}</p>}
            <p className="ba-coaching__summary ba-coaching__text">{result.summary}</p>
            <div className="ba-coaching__tips">
              {result.tips.slice(0, 5).map((tip, index) => <TipCard key={`${tip.turnId}-${index}`} tip={tip} turn={prepared?.turns.find((turn) => turn.turnId === tip.turnId)} onEvidence={showEvidence} />)}
            </div>
            {!result.tips.length && <p className="ba-coaching__muted">No specific prompt changes were supported by this conversation.</p>}
            <WarningList messages={result.limitations} />
            {!!result.tips.length && <BuildSkillPanel key={`${result.jobId || "legacy"}-${modelId}-${prepared?.inputHash || ""}`} jobId={result.jobId} conversationId={conversationId} modelId={modelId} inputHash={prepared?.inputHash || ""} />}
          </div>
        )}

        {prepared && (
          <details className="ba-coaching__preview" ref={previewRef} open={previewOpen} onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
            <summary>Conversation prepared for analysis <span>{prepared.turns.length} prompts</span></summary>
            <div className="ba-coaching__turns">
              {prepared.turns.map((turn) => <TurnPreview key={turn.turnId} turn={turn} id={`${sectionId}-${turn.turnId}`} />)}
            </div>
            {prepared.analysisInput && <details className="ba-coaching__input"><summary>View complete analysis input</summary><pre>{prepared.analysisInput}</pre></details>}
          </details>
        )}
      </div>
    </section>
  );
}
