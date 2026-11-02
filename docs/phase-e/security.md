# Phase E — Security and Privacy

## Authority boundaries

- Only existing Learning Intelligence determines mastery, confidence and gap closure.
- Only Goal Manager, Plan Manager and Orchestrator may change their respective domain documents.
- Model output is untrusted input. It has no database credentials and cannot invoke a mutation directly.
- Each proposed tool call is schema-validated by the client and validated again by the business service.
- Existing Repository account-boundary checks, local account binding, Outbox and CAS remain mandatory.

## Browser and local data

No model key is included in browser configuration. IndexedDB is the complete local-first learning database. Domain modules never access IndexedDB directly. Messages are individually stored and bounded; a full event journal is not sent to the model.

The AI consent checkbox is unchecked by default. When unchecked, chat input and learner data remain in local deterministic mode. When enabled for a message, the browser sends the user request and a bounded summary: goal IDs / titles, aggregate mastery summary, limited gap descriptions, limited competency states, active plan metadata and a short conversation tail.

## Server-side provider

supabase/functions/learning-agent:

- requires an authenticated user JWT (verify_jwt=true);
- checks the existing authorized-account RPC before provider use;
- accepts only an exact context-key allowlist and a 20 KiB context limit;
- accepts a 4,000-character user message and a 32 KiB request body;
- calls an HTTPS OpenAI-compatible Chat Completions endpoint with server-only secrets;
- uses a 25-second upstream timeout;
- validates reply length and mutation tool / input shape;
- never writes learning records or executes a model-suggested tool.

Server secrets:

- AI_PROVIDER_API_KEY
- AI_PROVIDER_MODEL
- optional AI_PROVIDER_BASE_URL (must be HTTPS; defaults to the OpenAI-compatible /v1 base)

No secret is committed to Git. Without required provider secrets, the Edge Function returns AI_PROVIDER_NOT_CONFIGURED; local learning and deterministic planning continue to work.

## Prompt-injection controls

The system prompt treats the learner message, conversation tail and context values as untrusted data. It has no elevated tools. Model proposals cannot use arbitrary tool names or arbitrary JSON fields. The application never trusts user-uploaded knowledge text as an instruction to change access or mastery.

## Sync authorization

New document types use the existing learning_archive_documents RLS and existing user/device-bound CAS RPC. The migration extends a type allowlist; it does not relax row ownership, active-device checks, document size limits, idempotency or revision conflict handling.

## Cost and operational limits

Rule mode has no model-token charge. The local IndexedDB engine has no external AI request. Supabase currently lists 500,000 Edge Function invocations per month on Free and 2 million on Pro / Team, with $2 per additional million invocations beyond the included quota; CORS OPTIONS preflight requests are not billed as invocations. These are platform-published plan allowances, not confirmation of this project's subscription or remaining quota. The connected project's billing tier is not exposed by the repository audit.

An opt-in AI message normally makes one Edge Function invocation and provider request. When the model requests read-only learning data, the application executes the bounded request and makes at most one follow-up Edge Function invocation / provider request. Provider input/output tokens for both passes are separately billed by the configured model provider. No provider has been selected and no API key has been configured, so provider cost cannot yet be calculated. Postgres compute, database storage and egress also depend on the project's actual plan and usage. This implementation does not label the entire AI path free or quote an invented monthly total. Review the current [Supabase pricing](https://supabase.com/pricing), [Edge Function invocation billing](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations) and the configured model provider's official pricing before enabling production AI.

This phase adds no new third-party database, queue or hosting service. No actual provider key has been configured or tested in this environment.
