# NEWS automation

Existing site and routes remain intact. Admin: /admin/news. No API keys belong in the browser or a chat message.

## Setup

1. Apply the additive editorial_control_room, matching_private_mutual and news_automation_pipeline migrations. These were applied to the configured Supabase project during implementation.
2. Configure server-only SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, NEWS_AI_MODEL and a random CRON_SECRET in hosting and local .env.local. The model must support Responses API strict JSON Schema. Choose a model explicitly; no paid calls are made until configured.
3. Add permitted RSS/Atom/JSON feeds in Sources; record usage permission and mark approved/enabled. Add active topics, required/excluded keywords and source filters. Only Nitra-relevant items from the last 72 hours are eligible.
4. Automation is paused and global auto-publish is OFF by default. Run a specific source manually, inspect discovered candidates, then generate and review a draft.
5. The production Vercel cron runs daily at 06:00 UTC. Hobby scheduling is not minute-precise; source intervals are minimum eligibility intervals, not a guarantee of that frequency. Manual discovery is available. Local Vite does not run cron jobs.

## Safety and budgets

Every API authenticates the Supabase user and checks is_admin. Generation records are server-written and admin-readable. Source data is untrusted and never interpreted as instructions. Evidence excerpts, generated output, usage and errors are persisted. There are no Google image searches or copied source photographs in this pipeline.

One AI generation performs fact extraction, original summary writing and a separate factual audit. This audit is not independent journalistic verification. At most two candidates are generated per discovery invocation; remaining discovered candidates wait for another run. Missing credentials leave discovery operational but generation unavailable. Failed drafts are never published.

Auto-publish additionally requires global opt-in, topic opt-in, enabled/approved OFFICIAL source opt-in, a complete verified generation, no unresolved facts and no sensitive classification. Database checks repeat these gates. Sensitive stories require human review.

Cover exports use local Anton Latin and Latin Extended glyphs and server SVG-to-PNG rendering; no paid image model. Feed: 1080x1350, Story: 1080x1920, OG: 1200x630. Save cover edits before export. Draft exports require authenticated admin access.

## Verification

Run npm test, npm run typecheck, npm run lint and npm run build. Type checking is scoped to the new JavaScript automation modules with checkJs; the legacy site is not converted to TypeScript. Tests use synthetic fixtures and a mock AI provider, not paid requests or published test articles. Security checks confirm service-only auto-publish execution and RLS on internal data. Existing Supabase advisor warnings in legacy chat/poll password APIs and leaked-password protection remain outside this change; see https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable.

## Recovery / known limits

Reprocess uses the stored permitted feed evidence, not scraping the original website. Short feeds may lack enough facts and require manual reporting. Semantic embeddings are not configured; deduplication uses canonical URLs and headline token similarity within the freshness window. Preview and edit before publishing related but not identical stories.

If a process is killed mid-generation, inspect its generation log before retrying; do not blindly repeat paid requests. The processing lock intentionally prevents parallel writes. Admin → Activity has a recovery action for processing jobs older than 15 minutes. It marks them failed, retains saved responses and never retries paid calls automatically. Generated covers are produced on demand, not stored as media objects. OG export is supported; social crawler-specific article metadata remains separate work.
