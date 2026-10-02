# RepoMap — índice estrutural do Comércio 360

Gerado em 2026-09-30 por `npm run repomap`. Heurístico de linhas, sem dependências (aproximação deliberada de tree-sitter para não alterar o lockfile); tipos de parâmetros omitidos — leia o arquivo para o contrato completo. Regenerar após mudanças estruturais. Estimativa: ~4 bytes/token. Roteamento de documentos: `context.md` e `docs/ai/H04_RESULTADOS_INDICE.md`.

## Código e símbolos

### app/actions.ts
- L1 "use server"
- L7 export function login (_previous form
- L20 export function logout ()
- L31 export function changeContext (form
### app/app/[module]/page.tsx
- L6 export default function Module (
### app/app/error.tsx
- L1 "use client"
- L2 export default function ErrorPage ({ reset })
### app/app/layout.tsx
- L3 export const dynamic = "force-dynamic";
- L4 export default function AppLayout (
### app/app/page.tsx
- L2 export default function App ()
### app/demo/[[...module]]/page.tsx
- L7 export const dynamic = "force-dynamic";
- L8 export default function Demo (
### app/layout.tsx
- L3 export const metadata = …
- L7 export default function RootLayout (
### app/login/form.tsx
- L1 "use client"
- L4 export function LoginForm ({ configured }
### app/login/page.tsx
- L4 export const dynamic = "force-dynamic";
- L5 export default function Login ()
### app/manifest.ts
- L2 export default function manifest (): MetadataRoute.Manifest
### app/page.tsx
- L2 export default function Home ()
### app/sem-acesso/page.tsx
- L2 export default function NoAccess ()
### lib/supabase/server.ts
- L4 export function isConfigured ()
- L10 export function createClient ()
### lib/tenancy.ts
- L14 export const requireAccess = …
### packages/config/navigation.ts
- L1 export const navigation = …
### packages/domain/tenancy.ts
- L1 export type Store = { id: string; organization_id: string; name: string };
- L2 export type Organization = { id: string; name: string };
- L3 export type Membership = { id: string; organization_id: string; user_id: string; role: string;…
- L11 export function selectableOrganizations ( organizations stores ): Organization[]
- L20 export function selectContext ( stores organizationId? storeId? ): Store | null
### packages/ui/dashboard.tsx
- L1 "use client"
- L19 export function Dashboard ()
### packages/ui/shell.tsx
- L1 "use client"
- L29 export const usePreview = …
- L44 function ContextSubmit ()
- L52 export function Shell (
### packages/ui/states.tsx
- L2 export function Construction ({ label }
- L17 export function Loading ()
- L30 export function Empty ()
### packages/validation/index.ts
- L2 export const loginSchema = …
- L6 export const contextSchema = …
### scripts/harness/dsh-mcp-telemetry.mjs
- L42 function telemetryAvailable ()
- L50 function parseUsage (raw, runId)
- L82 function persistTelemetry (record)
- L89 function stopOwnedChild (child)
- L97 function log (message)
- L101 function findDsh ()
- L110 function spawnSyncProbe (args)
- L123 function runHeadless (task, cwd, timeoutMs, runId)
- L277 function health ()
- L300 function send (message)
- L315 function handle (request)
### scripts/harness/dsh-telemetry-headless.mjs
- L55 function summarize (session, firstSeq)
- L80 function emitUsage (session, firstSeq)
- L119 function streamReasoning (ctx, agent, stderr)
- L171 function fail (io, error)
- L181 function run (ctx, task, io)
- L229 function apply (ctx, config)
- L242 export { Config, apply, inject, internals, name }
### scripts/harness/telemetry-turn-events.mjs
- L2 export function firstCompleteTurnEvents (events)
### scripts/seed-diagnostics.mjs
- L2 export function seedPreflightExitCode (env)
- L11 export function seedFailureExitCode (stage, error)
### scripts/seed-guard.mjs
- L2 function projectOrigin (value)
- L31 export function validateSeedTarget (env)
- L51 export function assertFictionalAccounts (specs)
### scripts/seed-users.mjs
- L50 function must (result)

## Scripts do harness

- scripts/harness/validate.mjs — validador de envelopes/resultados 0.1 (CLI: `node scripts/harness/validate.mjs task|result …`)
- scripts/harness/check-skills.mjs — confere estrutura das seis skills
- scripts/harness/repomap.mjs — gera este índice

## Migrações SQL

### supabase/migrations/202609070001_foundation.sql
- L3 REVOKE all on schema private from public, anon, authenticated
- L4 GRANT usage on schema private to authenticated
- L6 CREATE TABLE public.organizations
- L10 CREATE TABLE public.stores
- L16 CREATE TABLE public.profiles
- L21 CREATE TABLE public.memberships
- L28 CREATE TABLE public.user_store_access
- L35 CREATE TABLE public.audit_events
- L42 CREATE INDEX memberships_by_user
- L43 CREATE INDEX store_access_by_store
- L44 CREATE INDEX audit_by_org_time
- L45 CREATE INDEX audit_by_actor_time
- L47 CREATE FUNCTION private.is_member(p_org uuid) RETURNS …
- L50 CREATE FUNCTION private.can_access_store(p_org uuid,p_store uuid) RETURNS …
- L56 REVOKE all on function private.is_member(uuid),private.can_access_stor…
- L57 GRANT execute on function private.is_member(uuid),private.can_access_…
- L59 ALTER TABLE public.organizations ENABLE RLS
- L60 ALTER TABLE public.stores ENABLE RLS
- L61 ALTER TABLE public.profiles ENABLE RLS
- L62 ALTER TABLE public.memberships ENABLE RLS
- L63 ALTER TABLE public.user_store_access ENABLE RLS
- L64 ALTER TABLE public.audit_events ENABLE RLS
- L65 REVOKE all on public.organizations,public.stores,public.profiles,publi…
- L66 GRANT select on public.organizations,public.stores,public.profiles,pu…
- L68 GRANT all on public.organizations,public.stores,public.profiles,publi…
- L69 CREATE POLICY org_member_read ON public.organizations
- L70 CREATE POLICY authorized_store_read ON public.stores
- L71 CREATE POLICY own_profile_read ON public.profiles
- L72 CREATE POLICY own_membership_read ON public.memberships
- L73 CREATE POLICY own_store_access_read ON public.user_store_access
- L76 CREATE POLICY scoped_audit_read ON public.audit_events
- L81 CREATE FUNCTION private.touch_updated_at() RETURNS …
- L83 CREATE FUNCTION private.audit_foundation() RETURNS …
- L93 CREATE FUNCTION private.reject_audit_change() RETURNS …
- L95 CREATE TRIGGER audit_immutable
- L96 CREATE TRIGGER audit_no_truncate
- L106 CREATE FUNCTION public.set_active_store(p_organization_id uuid,p_store_id uuid) RETURNS …
- L118 REVOKE all on function public.set_active_store(uuid,uuid) from public,…
- L119 GRANT execute on function public.set_active_store(uuid,uuid) to authe…
- L120 REVOKE all on function private.touch_updated_at(),private.audit_founda…
### supabase/migrations/202609080001_tenant_key_guards.sql
- L3 CREATE FUNCTION private.guard_structural_keys() RETURNS …
- L21 REVOKE all on function private.guard_structural_keys() from public,ano…
- L30 ALTER TABLE public.audit_events ADD constraint
### supabase/tests/bootstrap.sql
- L6 CREATE TABLE auth.users
- L7 CREATE FUNCTION auth.uid() RETURNS …
- L8 GRANT usage on schema public,auth to anon,authenticated,service_role
- L9 GRANT execute on function auth.uid() to authenticated,service_role

## Testes (describe/it/test)

### tests/database.test.ts
- L27 describe('PostgreSQL migration, RLS and audit')
- L45 it('seed is repeatable and every exposed foundation tab…')
- L56 it('A sees A only; explicit B reads yield zero rows')
- L82 it('B cannot read A, including audit records')
- L100 it('cashier cannot read or select an unauthorized store…')
- L111 it('user without membership gets no business records an…')
- L125 it('anonymous reads and RPC are forbidden')
- L140 it('authorized context selection is audited once; repea…')
- L164 it('cross-tenant context and mismatched organization/st…')
- L173 it('direct inserts, role escalation, deletions and audi…')
- L200 it('composite foreign keys reject cross-organization st…')
- L208 it('privileged membership changes record before and aft…')
- L227 it('revoking membership immediately removes store reads…')
- L239 it('deactivating a store removes it from reads and sele…')
### tests/e2e/auth.spec.ts
- L8 test('active membership without stores is hidden while an…')
- L46 test('active membership without any authorized store rema…')
- L60 test('valid login, authorized store selection, audited RP…')
- L87 test('authenticated user without membership is refused')
- L94 test('cashier cannot expand access with a forged cookie')
- L119 test('invalid login shows an actionable error and does no…')
### tests/e2e/foundation.spec.ts
- L3 test('navigation and demo states at ${width}px')
- L38 test('protected routes require a real session; demo canno…')
- L51 test('demo context selection is explicit and navigation h…')
### tests/expiry-checks.test.ts
- L8 describe('H1 expiry timing and sanitized evidence')
- L9 it('waits beyond the documented 30 seconds instead of c…')
- L27 it('waits for the last token and reports progress in ch…')
- L45 it('accounts for the observed server clock without chan…')
- L56 it('does not wait again if expiration plus tolerance ha…')
- L72 it('rejects waits beyond the configured limit')
- L77 it('estimates server offset from HTTP Date and round tr…')
- L82 it('rejects missing server date and excessive clock dif…')
- L90 it('keeps only status and fixed reason, never raw provi…')
### tests/harness-contract.test.mjs
- L76 test('accepts a bounded read-only task and evidenced repo…')
- L81 test('rejects traversal and protected writes')
- L90 test('rejects unsupported baselines and unknown contract …')
- L96 test('rejects PASS without evidence and missing criteria')
- L103 test('rejects invented execution data and baseline mismat…')
- L110 test('rejects a result through the API after HEAD advance…')
- L119 test('rejects missing and escaping finding evidence refer…')
- L131 test('rejects reported changes in review mode, even when …')
- L137 test('accepts a clean Git worktree for a read-only result')
- L144 test('detects an index change masked by worktree content …')
- L177 test('rejects a read-only result with ${state} Git change…')
- L186 test('compares real changed paths with the assigned and r…')
### tests/harness-telemetry.test.mjs
- L13 test('usage aggregation receives only the complete turn, …')
- L44 test('bridge captures provider usage, duration and unavai…')
### tests/seed-diagnostics.test.ts
- L18 describe('seed sanitized diagnostics with loopback API only')
### tests/seed-guard.test.ts
- L16 describe('seed preflight')
- L17 it('accepts an independently confirmed project origin, …')
- L51 it('still requires the development flag and secret inpu…')
- L62 it('permits explicit local development while comparing …')
- L78 it('validates every fictional account, not just the fir…')
### tests/tenancy.test.ts
- L11 describe('context authorization')
- L16 it('excludes active memberships with no authorized stor…')
- L22 it('returns no selectable organization when the user ha…')
- L26 it('preserves authorized multi-organization choices and…')
- L32 it('chooses only within supplied authorized stores')
- L37 it('does not manufacture access for users without stores')
- L39 it('validates inputs before login or switching')
### tests/tenant-keys.test.ts
- L49 describe('001.1 structural tenant keys and audit SQL')
- L108 it('rejects jointly valid cross-tenant relationship rew…')
- L115 it('rejects retargeting an access to a different store …')
- L124 it('allows ordinary administrative updates and identica…')
- L152 it('rejects tenant changes even on unreferenced or deac…')
- L184 it('rejects another organization root snapshot in audit…')
- L191 it('authorized cross-organization selections never copy…')
