'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { startTransition, useDeferredValue, useState } from 'react';
import { type ReviewUIMessage } from '@/lib/review-message';
import {
  demoReviewScenarios,
  getReviewScenario,
} from '@/lib/review-scenarios';
import {
  reviewMessageMetadataSchema,
  type ReviewMessageMetadata,
} from '@/lib/review-types';

type DraftState = {
  title: string;
  summary: string;
  diff: string;
  scenarioId?: string;
  simulateFallback: boolean;
};

const emptyDraft: DraftState = {
  title: '',
  summary: '',
  diff: '',
  scenarioId: undefined,
  simulateFallback: false,
};

function isToolPart(
  part: ReviewUIMessage['parts'][number],
): part is Extract<ReviewUIMessage['parts'][number], { type: `tool-${string}` }> {
  return part.type.startsWith('tool-');
}

function getAssistantMessage(messages: ReviewUIMessage[]) {
  return [...messages].reverse().find(message => message.role === 'assistant');
}

function getAssistantText(message: ReviewUIMessage | undefined) {
  if (!message) {
    return '';
  }

  return message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('');
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatStatus(status: 'submitted' | 'streaming' | 'ready' | 'error') {
  switch (status) {
    case 'submitted':
      return 'Queued';
    case 'streaming':
      return 'Streaming';
    case 'error':
      return 'Error';
    case 'ready':
      return 'Ready';
  }
}

function formatRiskLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value: string | undefined) {
  if (!value) {
    return 'Not finished';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(value: number) {
  if (value <= 0) {
    return 'In progress';
  }

  if (value < 1_000) {
    return `${value} ms`;
  }

  return `${(value / 1_000).toFixed(1)} s`;
}

function formatFallbackReason(value: ReviewMessageMetadata['fallbackReason']) {
  switch (value) {
    case 'simulate':
      return 'simulated fallback';
    case 'no-model-access':
      return 'no model access';
    case 'agent-error':
      return 'agent fallback';
    default:
      return undefined;
  }
}

function ToolTrace({ message }: { message: ReviewUIMessage }) {
  const toolParts = message.parts.filter(isToolPart);

  if (toolParts.length === 0) {
    return null;
  }

  return (
    <>
      {toolParts.map(part => {
        const title =
          part.type === 'tool-getReviewChecklist'
            ? 'Checklist lookup'
            : 'Service profile lookup';

        return (
          <article
            className="trace-card"
            key={`${message.id}-${part.type}-${part.toolCallId}`}
          >
            <header>
              <strong>{title}</strong>
              <span className="trace-pill mono">{part.state}</span>
            </header>
            <p className="trace-meta mono">Tool call id: {part.toolCallId}</p>
            <div className="code-card">
              <strong>Input</strong>
              <code className="json-block">{formatJson(part.input)}</code>
            </div>
            {part.state === 'output-available' ? (
              <div className="code-card">
                <strong>Output</strong>
                <code className="json-block">{formatJson(part.output)}</code>
              </div>
            ) : null}
            {part.state === 'output-error' ? (
              <p>{part.errorText}</p>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

export function ReviewWorkbench() {
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const deferredDiff = useDeferredValue(draft.diff);

  const {
    messages,
    sendMessage,
    setMessages,
    stop,
    status,
    error,
    clearError,
  } = useChat<ReviewUIMessage>({
    transport: new DefaultChatTransport({
      api: '/api/review',
    }),
    messageMetadataSchema: reviewMessageMetadataSchema,
  });

  const latestAssistantMessage = getAssistantMessage(messages);
  const assistantText = getAssistantText(latestAssistantMessage);
  const metadata = latestAssistantMessage?.metadata as
    | ReviewMessageMetadata
    | undefined;
  const verdict = metadata?.verdict;
  const hideStructuredAssistantText =
    Boolean(verdict) && assistantText.trim().startsWith('{');

  const lineCount = deferredDiff ? deferredDiff.split('\n').length : 0;
  const additions = deferredDiff
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
  const deletions = deferredDiff
    .split('\n')
    .filter(line => line.startsWith('-') && !line.startsWith('---')).length;

  function updateDraft<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft(current => ({
      ...current,
      [key]: value,
      scenarioId: key === 'simulateFallback' ? current.scenarioId : undefined,
    }));

    if (error) {
      clearError();
    }
  }

  function applyScenario(scenarioId: string) {
    const scenario = getReviewScenario(scenarioId);

    if (!scenario) {
      return;
    }

    startTransition(() => {
      setDraft({
        title: scenario.title,
        summary: scenario.summary,
        diff: scenario.diff,
        scenarioId: scenario.id,
        simulateFallback: false,
      });
      setMessages([]);
      clearError();
    });
  }

  function resetAll() {
    startTransition(() => {
      setDraft(emptyDraft);
      setMessages([]);
      clearError();
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (status === 'submitted' || status === 'streaming') {
      return;
    }

    if (error) {
      clearError();
    }

    await sendMessage(
      {
        text: `Review patch: ${draft.title || 'Untitled patch'}`,
      },
      {
        body: {
          draft,
        },
      },
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <span className="eyebrow mono">Single patch review</span>
        <h1>Patch Lens</h1>
        <p>
          Submit one patch, stream the tool loop, and inspect a typed verdict
          without extra product surface area.
        </p>
        <div className="hero-highlights">
          <span className="hero-highlight mono">Typed verdicts</span>
          <span className="hero-highlight mono">Streamed tools</span>
          <span className="hero-highlight mono">One patch scope</span>
        </div>
      </section>

      <section className="page-grid">
        <div className="panel">
          <div className="panel-inner">
            <div className="panel-heading">
              <div>
                <h2>Patch Input</h2>
                <p className="panel-copy">
                  Keep the scope tight: title, optional summary, one unified
                  diff, one review run.
                </p>
              </div>
              <span className={`status-pill mono status-${status}`}>
                {formatStatus(status)}
              </span>
            </div>

            <div className="meta-row">
              <span className="metric-chip mono">{lineCount} lines</span>
              <span className="metric-chip mono">+{additions} additions</span>
              <span className="metric-chip mono">-{deletions} deletions</span>
            </div>

            <div className="scenario-grid">
              {demoReviewScenarios.map(scenario => (
                <button
                  className={`scenario-button${
                    draft.scenarioId === scenario.id ? ' active' : ''
                  }`}
                  key={scenario.id}
                  onClick={() => applyScenario(scenario.id)}
                  type="button"
                >
                  <span className="scenario-title">{scenario.label}</span>
                  <span className="scenario-subtitle">{scenario.title}</span>
                </button>
              ))}
            </div>

            <form className="form-grid" onSubmit={handleSubmit}>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="title">Title</label>
                  <input
                    id="title"
                    onChange={event => updateDraft('title', event.target.value)}
                    placeholder="Describe the patch in one line"
                    required
                    value={draft.title}
                  />
                </div>

                <div className="field">
                  <label htmlFor="summary">Summary</label>
                  <input
                    id="summary"
                    onChange={event => updateDraft('summary', event.target.value)}
                    placeholder="Optional context from the author"
                    value={draft.summary}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="diff">Unified Diff</label>
                <textarea
                  className="diff-area"
                  id="diff"
                  onChange={event => updateDraft('diff', event.target.value)}
                  placeholder="Paste one patch here"
                  required
                  value={draft.diff}
                />
                <p className="helper-text mono">
                  Unified diff only. Keep the patch narrow enough for one
                  decision.
                </p>
              </div>

              <label className="toggle">
                <input
                  checked={draft.simulateFallback}
                  onChange={event =>
                    updateDraft('simulateFallback', event.target.checked)
                  }
                  type="checkbox"
                />
                <span className="toggle-copy">
                  <strong>Simulate fallback</strong>
                  <span className="helper-text">
                    Skip the model path and run the deterministic reviewer.
                  </span>
                </span>
              </label>

              <div className="action-row">
                <button
                  className="primary-button"
                  disabled={!draft.title || !draft.diff || status === 'submitted' || status === 'streaming'}
                  type="submit"
                >
                  Review Patch
                </button>
                <button
                  className="ghost-button"
                  onClick={resetAll}
                  type="button"
                >
                  Reset
                </button>
                <button
                  className="ghost-button"
                  disabled={status !== 'submitted' && status !== 'streaming'}
                  onClick={() => void stop()}
                  type="button"
                >
                  Stop
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="panel results-panel">
          <div className="panel-inner">
            <div className="panel-heading">
              <div>
                <h2>Review Run</h2>
                <p className="panel-copy">
                  The latest assistant message carries the streamed tool trace
                  and the final typed verdict.
                </p>
              </div>
              <span
                className={`status-pill mono ${
                  verdict ? `risk-${verdict.riskLevel}` : `status-${status}`
                }`}
              >
                {verdict ? formatRiskLabel(verdict.riskLevel) : formatStatus(status)}
              </span>
            </div>

            {error ? <div className="error-banner">{error.message}</div> : null}

            {!latestAssistantMessage ? (
              <div className="empty-state">
                Pick a demo scenario or paste a diff, then run a review. This
                panel only renders the current result path.
              </div>
            ) : (
              <>
                <div className="summary-grid">
                  <article className="summary-card">
                    <strong>Action</strong>
                    <p>{verdict?.recommendedAction ?? 'In progress'}</p>
                  </article>
                  <article className="summary-card">
                    <strong>Confidence</strong>
                    <p className="mono">
                      {verdict ? `${verdict.confidence}/100` : 'Streaming'}
                    </p>
                  </article>
                  <article className="summary-card">
                    <strong>Run Details</strong>
                    <p className="mono">
                      {metadata?.reviewPath ?? 'agent'}
                      {metadata?.modelId ? ` · ${metadata.modelId}` : ''}
                      {metadata ? ` · ${formatDuration(metadata.durationMs)}` : ''}
                      {metadata?.fallbackReason
                        ? ` · fallback: ${formatFallbackReason(metadata.fallbackReason)}`
                        : ''}
                    </p>
                  </article>
                </div>

                {verdict ? (
                  <>
                    <article className="assistant-card">
                      <strong>Executive Summary</strong>
                      <p>{verdict.executiveSummary}</p>
                    </article>

                    <article className="assistant-card">
                      <strong>Reasoning</strong>
                      <ul>
                        {verdict.reasoning.map(item => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </article>

                    <article className="assistant-card">
                      <strong>Missing Info</strong>
                      <ul>
                        {verdict.missingInfo.length > 0 ? (
                          verdict.missingInfo.map(item => (
                            <li key={item}>{item}</li>
                          ))
                        ) : (
                          <li>No additional gaps were attached to this verdict.</li>
                        )}
                      </ul>
                    </article>

                    <article className="assistant-card">
                      <strong>Rollback Plan</strong>
                      <p>{verdict.rollbackPlan}</p>
                      <p className="trace-meta mono">
                        Completed {formatDate(metadata?.completedAt)}
                        {metadata?.totalTokens
                          ? ` · ${metadata.totalTokens} tokens`
                          : ''}
                      </p>
                    </article>
                  </>
                ) : null}

                <ToolTrace message={latestAssistantMessage} />

                <article className="assistant-card">
                  <strong>Assistant Stream</strong>
                  {hideStructuredAssistantText ? (
                    <p>
                      Structured model output is hidden here. The verdict card
                      above is the authoritative rendered result for this run.
                    </p>
                  ) : (
                    <code className="assistant-stream">
                      {assistantText || 'Waiting for streamed content.'}
                    </code>
                  )}
                </article>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
