import React, { useEffect, useRef, useState } from "react";
import { CoachingRequestError, generateBuildSkillPreview, installBuildSkill } from "../services/coaching.ts";
import type { BuildSkillInstallation, BuildSkillPreview } from "../services/coaching.ts";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The skill could not be prepared. Please try again.";
}

/** Only mounted for a completed analysis. No skill is installed before confirmation. */
export default function BuildSkillPanel({ jobId, conversationId, modelId, inputHash }: {
  jobId?: string;
  conversationId: string;
  modelId: string;
  inputHash: string;
}) {
  const [preview, setPreview] = useState<BuildSkillPreview | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [installError, setInstallError] = useState("");
  const [installation, setInstallation] = useState<BuildSkillInstallation | null>(null);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const dialogId = `build-skill-${jobId || conversationId}`;

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    if (installation) successRef.current?.focus({ preventScroll: true });
  }, [installation]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!preview || !dialog) return;
    dialog.showModal();
    cancelRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [preview]);

  async function prepareSkill() {
    if (!jobId || busy.current) return;
    busy.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPreparing(true);
    setPreviewStatus("Preparing a skill from these coaching tips…");
    setError("");
    setInstallError("");
    try {
      const draft = await generateBuildSkillPreview(jobId, controller.signal, (status) => {
        if (!controller.signal.aborted) setPreviewStatus(status);
      });
      if (controller.signal.aborted) return;
      if (draft.conversationId !== conversationId || draft.modelId !== modelId || draft.inputHash !== inputHash) {
        throw new Error("This skill preview belongs to a different analysis. Generate coaching again to continue.");
      }
      setPreview(draft);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause));
    } finally {
      if (!controller.signal.aborted) {
        busy.current = false;
        setPreparing(false);
      }
    }
  }

  function closePreview() {
    if (busy.current) return;
    setPreview(null);
    setInstallError("");
  }

  function keepFocusInDialog(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  async function confirmInstall() {
    if (!jobId || !preview || busy.current) return;
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    setInstalling(true);
    setInstallError("");
    try {
      const installed = await installBuildSkill(preview.draftId, preview.previewHash, controller.signal);
      if (controller.signal.aborted) return;
      if (!installed.skillId || installed.name !== preview.skill.name || installed.owner?.id !== preview.owner.id || installed.allScopes !== true || installed.ownerOnly !== true) {
        throw new Error("The installation result could not be verified. Try again to check this skill’s status.");
      }
      setInstallation(installed);
      setPreview(null);
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof CoachingRequestError && cause.status === 409) {
          setPreview(null);
          setError(errorText(cause));
        } else setInstallError(errorText(cause));
      }
    } finally {
      if (!controller.signal.aborted) {
        busy.current = false;
        setInstalling(false);
      }
    }
  }

  return (
    <section className="ba-coaching__build-skill" aria-labelledby={`${dialogId}-heading`}>
      <div>
        <h4 id={`${dialogId}-heading`}>Build skill</h4>
        <p className="ba-coaching__muted">Help Build Agent interpret this user’s intent in future conversations. Review the skill before installing it.</p>
      </div>
      <button ref={triggerRef} type="button" className="ba-coaching__button ba-coaching__button--secondary" onClick={prepareSkill} disabled={!jobId || preparing || !!installation}>
        {preparing ? "Preparing skill…" : installation ? "Skill installed" : "Build skill"}
      </button>
      {!jobId && <p className="ba-coaching__muted">Generate coaching again to build a skill from this analysis.</p>}
      {preparing && <p className="ba-coaching__status" role="status">{previewStatus}</p>}
      {error && <p className="ba-coaching__error" role="alert">{error}</p>}
      {installation && <p ref={successRef} className="ba-coaching__skill-success" role="status" tabIndex={-1}><strong>{installation.name}</strong> is installed for {installation.owner.name} only, in all application scopes.</p>}

      {preview && (
        <dialog ref={dialogRef} className="ba-coaching__skill-dialog" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`} onKeyDown={keepFocusInDialog} onCancel={(event) => { event.preventDefault(); closePreview(); }}>
          <div className="ba-coaching__skill-dialog-header">
            <span className="ba-coaching__eyebrow">Build skill</span>
            <h3 id={`${dialogId}-title`}>Review and install skill</h3>
            <p id={`${dialogId}-description`} className="ba-coaching__muted">{preview.existingSkill ? "This skill is already installed. The complete instructions are shown below." : "This is the complete skill that will guide Build Agent. Nothing is installed until you confirm."}</p>
          </div>
          <div className="ba-coaching__skill-dialog-body">
            <dl className="ba-coaching__skill-access">
              <div><dt>Conversation owner</dt><dd>{preview.owner.name}{preview.owner.userName && <span> ({preview.owner.userName})</span>}</dd></div>
              <div><dt>Available to</dt><dd>Only {preview.owner.name}</dd></div>
              <div><dt>Application scopes</dt><dd>All application scopes</dd></div>
            </dl>
            <h4>{preview.skill.name}</h4>
            <p className="ba-coaching__text ba-coaching__skill-description">{preview.skill.description}</p>
            <pre className="ba-coaching__skill-content" tabIndex={0} aria-label="Complete skill instructions">{preview.skill.content}</pre>
            {!!preview.warnings?.length && <ul className="ba-coaching__warnings">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
            {installError && <p className="ba-coaching__error" role="alert">{installError}</p>}
            {installing && <p className="ba-coaching__status" role="status"><span className="ba-coaching__spinner" aria-hidden="true" />Creating and installing skill…</p>}
          </div>
          <div className="ba-coaching__skill-dialog-actions">
            <button ref={cancelRef} type="button" className="ba-coaching__button ba-coaching__button--secondary" onClick={closePreview} disabled={installing}>{preview.existingSkill ? "Close" : "Cancel"}</button>
            {!preview.existingSkill && <button type="button" className="ba-coaching__button" onClick={confirmInstall} disabled={installing}>{installing ? "Installing…" : "Create and install skill"}</button>}
          </div>
        </dialog>
      )}
    </section>
  );
}
