# Patch Lens

Patch Lens is a compact review sandbox for running one patch through an
AI-assisted review loop. The app stays intentionally small:

- one page
- one review route
- one `ToolLoopAgent`
- two tools
- one typed verdict schema
- one deterministic fallback path

## What It Does

- Accepts a title, optional summary, and diff
- Streams the review run to the browser
- Shows tool activity directly from typed `tool-*` message parts
- Stores the final verdict in message metadata so the UI can render a stable card
- Falls back to deterministic scoring when model access is unavailable

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Add a gateway API key to `.env.local`:

```bash
PATCH_LENS_GATEWAY_API_KEY=...
```

Optional model override:

```bash
PATCH_LENS_MODEL_ID=google/gemini-2.5-flash-lite
```

## Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm eval
pnpm check
```

## Architecture

- `components/review-workbench.tsx` owns the one-shot form and renders the current run only.
- `app/api/review/route.ts` normalizes the draft, decides between agent and fallback, and attaches the typed verdict to message metadata.
- `lib/agents/pr-review-agent.ts` defines the reusable reviewer with loop control and structured output.
- `lib/tools/review-tools.ts` contains the tiny checklist and service-profile tools.
- `lib/fallback-review.ts` provides the stable deterministic safety net used by the fixture suite.
- `docs/architecture.md` captures the request flow and the main design choices.

## Design Choices

- The first tool call is forced so the multi-step loop is visible and predictable.
- The final verdict is schema-validated with `Output.object(...)`.
- The fallback path returns the same verdict shape as the agent path, so the UI does not branch on response shape.
- A future background version can reuse the same reviewer behind a durable job runner without changing the core agent or schema.
