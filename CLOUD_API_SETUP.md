# Cloud API setup

Secrets remain server-side environment variables. Copy `.env.example` into the server's `.env.local` (or hosting secret store), add keys and restart the app. No keys are returned by `/api/settings/cloud`; its authenticated response exposes only presence and model configuration. Environment storage uses the deployment's secret protection, not application database encryption.

## OpenRouter
Set `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` to an accessible model ID and `LLM_PROVIDER=openrouter`.

## Google Gemini
Set `GOOGLE_API_KEY` (or `GEMINI_API_KEY`), `GEMINI_MODEL` and `LLM_PROVIDER=google`.

Both adapters route existing `llmComplete` / `llmCompleteJson` text flows (copywriting, scripts, strategy, etc.). Model IDs are deliberately blank, configurable, and not tied to a plan. Switching is server-wide, for this internal cabinet. Existing Z.AI remains the default until explicitly switched.

These keys do not automatically implement video, image, TTS, music or avatar APIs. Those existing modality adapters remain separate. Specifically Gemini TTS live validation is still required. Settings → AI Providers displays configuration status, not a fake LIVE badge. Adapter failure never silently falls back to a paid alternative and never automatically retries.

HTTP requests follow https://openrouter.ai/docs/quickstart and https://ai.google.dev/api. Requests time out after 60 seconds. On timeout remote billing may be unknown: check provider request history before retrying. No live calls were made during implementation.

## Verification
`node scripts/verify-cloud.cjs`: simulated HTTP contract tests for both providers; missing credentials; HTTP 429; no retries; no secret in status metadata or Google URL. Not a live provider certification.
