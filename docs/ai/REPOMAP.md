# RepoMap — índice estrutural do Comércio 360

Gerado em 2026-10-04 por `npm run repomap`. Heurístico de linhas, sem dependências (aproximação deliberada de tree-sitter para não alterar o lockfile); tipos de parâmetros omitidos — leia o arquivo para o contrato completo. Regenerar após mudanças estruturais. Estimativa: ~4 bytes/token. Roteamento de documentos: `context.md` e `docs/ai/H04_RESULTADOS_INDICE.md`.

## Código e símbolos

### app/actions.ts
- L1 "use server"
- L7 export function login (_previous form
- L20 export function logout ()
- L31 export function changeContext (form
### app/actions/catalog.ts
- L1 "use server"
- L20 export type CatalogMutationResult = | { status: "success"; message: string; id: string; revisio…
- L27 function failure ( status ): CatalogMutationResult
- L41 function databaseFailure (code
- L50 function mutate ( scope input schema rpcName parameters => Record<string, unkno…
- L96 export function createCatalogCategory ( scope input ): Promise<CatalogMutationResult>
- L109 export function updateCatalogCategory ( scope categoryId input ): Promise<CatalogMutationResult>
- L129 export function createCatalogProduct ( scope input ): Promise<CatalogMutationResult>
- L151 export function updateCatalogProduct ( scope productId input ): Promise<CatalogMutationResult>
- L173 export function createCatalogVariant ( scope productId input ): Promise<CatalogMutationResult>
- L194 export function updateCatalogVariant ( scope variantId input ): Promise<CatalogMutationResult>
- L217 export function setCatalogPrice ( scope variantId input ): Promise<CatalogMutationResult>
### app/api/catalog/images/[productId]/route.ts
- L19 export const runtime = "nodejs";
- L24 function reply (status message
- L31 function sqlFailure (code
- L40 function accessFailure (error
- L50 export function GET (request { params }
- L85 export function POST (request { params }
- L237 export function DELETE (request { params }
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
### app/app/produtos/error.tsx
- L1 "use client"
- L5 export default function Error (
### app/app/produtos/loading.tsx
- L3 export default function Loading ()
### app/app/produtos/page.tsx
- L22 function first (value
- L26 export default function CatalogPage (
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
### lib/catalog-image/animation.ts
- L6 export function inspectStaticImageContainer ( bytes ): "image/jpeg" | "image/png" | "image/webp"
- L72 function ascii (bytes offset length
- L76 function readU32BE (bytes offset
- L85 function readU32LE (bytes offset
### lib/catalog-image/attestation.ts
- L3 export type CatalogImageAttestation = { organizationId: string; storeId: string; productId: str…
- L17 export function catalogImageAttestationPayload ( value ): string
- L36 export function parseCatalogImageKey (encoded
- L47 export function signCatalogImageAttestation ( value key ): string
### lib/catalog-image/container-metadata.ts
- L2 export function stripPngMetadata (input
- L40 export function stripWebpMetadata (input
- L83 function concat (parts
- L94 function ascii (bytes offset length
- L98 function readU32BE (bytes offset
- L107 function readU32LE (bytes offset
### lib/catalog-image/contracts.ts
- L1 class CatalogImageError
- L11 export type ProcessedCatalogImage = { bytes: Buffer; mimeType: "image/jpeg" | "image/png" | "im…
### lib/catalog-image/form.ts
- L3 export function readBoundedMultipart ( request maxBytes ): Promise<FormData>
### lib/catalog-image/jpeg-metadata.ts
- L7 export function stripJpegMetadata (input
- L67 function concat (parts
### lib/catalog-image/origin.ts
- L4 export function isSameOrigin (request
### lib/catalog-image/process-cloudflare.ts
- L19 export type CatalogImagesBinding = { info(input: ReadableStream<Uint8Array>): Promise<ImageInfo…
- L30 class CatalogImageServiceError
- L37 function bytesAsStream (bytes
- L46 function assertDimensions (info
- L66 function readBoundedImage (response
- L96 function serviceError (error
- L109 export function processCatalogImageCloudflare ( input images ): Promise<ProcessedCatalogImage>
### lib/catalog-image/process.ts
- L4 export { CatalogImageError }
- L11 export function processCatalogImage ( input ): Promise<ProcessedCatalogImage>
### lib/catalog/server.ts
- L18 export type CatalogScope = z.input<typeof scopeSchema>; export type CatalogFilters = z.input<ty…
- L19 export type CatalogFilters = z.input<typeof filtersSchema>; export type CatalogCategory = { id:…
- L20 export type CatalogCategory = { id: string; name: string; active: boolean; revision: string; };
- L26 export type CatalogPrice = { value: string; revision: string };
- L27 export type CatalogVariant = { id: string; sku: string; color: string | null; size: string | nu…
- L38 export type CatalogProduct = { id: string; name: string; description: string | null; categoryId…
- L48 export type CatalogProductSummary = { id: string; name: string; description: string | null; cat…
- L57 export type CatalogPage = { items: CatalogProductSummary[]; page: number; pageSize: number; tot…
- L64 class CatalogAccessError
- L86 export function authorizeCatalog ( scope mode = … "read")
- L134 export function getCatalogAccess (scope
- L143 export function listCatalogCategories ( scope ): Promise<CatalogCategory[]>
- L173 function priceText (value
- L180 export function listCatalogProducts ( scope filters = … {}): Promise<CatalogPage>
- L258 export function getCatalogProduct ( scope productId ): Promise<CatalogProduct | null>
### lib/supabase/server.ts
- L4 export function isConfigured ()
- L10 export function createClient ()
### lib/tenancy.ts
- L14 export const requireAccess = …
### packages/config/navigation.ts
- L1 export const navigation = …
### packages/domain/catalog.ts
- L6 export function characterCount (value
- L10 export function normalizeCategoryName (value
- L14 export function categoryNameKey (value
- L18 export function normalizeProductName (value
- L22 export function normalizeDescription ( value ): string | null
- L29 export function normalizeSku (value
- L33 export function skuKey (value
- L37 export function normalizeVariantAttribute ( value ): string | null
- L45 export function variantAttributeKey ( value ): string | null
- L52 export function variantCombinationKey ( productId color size ): string
- L63 export function normalizeBarcode ( value ): string | null
- L71 export function barcodeKey (value
- L80 export function parseBrlDecimal (value
- L96 export function brlDecimalToCents (value
- L103 export function formatBrlPrice (value
- L113 export function parseCatalogRevision (value
### packages/domain/tenancy.ts
- L1 export type Store = { id: string; organization_id: string; name: string };
- L2 export type Organization = { id: string; name: string };
- L3 export type Membership = { id: string; organization_id: string; user_id: string; role: string;…
- L11 export function selectableOrganizations ( organizations stores ): Organization[]
- L20 export function selectContext ( stores organizationId? storeId? ): Store | null
### packages/ui/catalog/cover.tsx
- L1 "use client"
- L14 function imageUrl (scope productId revision
- L27 function parseResult (response
- L36 export function CatalogCover (
- L71 function announce (next
- L76 function choose (file
- L93 function upload (event
- L151 function remove ()
### packages/ui/catalog/workspace.tsx
- L1 "use client"
- L44 function hrefFor (filters page = 1, productId = ""): string
- L55 function value (form name
- L58 function optional (form name
- L61 function Field (
- L94 function VariantFields ({ variant }
- L126 export function CatalogWorkspace (
- L147 function perform ( label task => Promise<CatalogMutationResult>, onSuccess?: ( r…
- L175 function submitCategory (event
- L186 function submitCategoryEdit ( event category )
- L201 function submitProduct (event
- L234 function submitProductEdit ( event item )
- L254 function toggleProduct (item
- L269 function submitVariant ( event item )
- L290 function submitVariantEdit ( event variant )
- L309 function toggleVariant (variant
- L326 function submitPrice ( event variant )
- L340 function openPanel (next
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
### packages/validation/catalog.ts
- L22 export const catalogCategoryNameSchema = z
- L30 export const catalogProductNameSchema = z
- L38 export const catalogDescriptionSchema = z
- L47 export const catalogSkuSchema = z
- L52 export const catalogVariantAttributeSchema = z
- L61 export const catalogBarcodeSchema = z
- L70 export const catalogBrlPriceSchema = z
- L75 export const catalogRevisionSchema = z
- L80 export const catalogCategoryInputSchema = …
- L84 export const catalogCategoryUpdateInputSchema = …
- L90 export const catalogProductInputSchema = …
- L99 export const catalogProductUpdateInputSchema = …
- L106 export const catalogVariantInputSchema = …
- L114 export const catalogVariantUpdateInputSchema = …
- L121 export const catalogProductCreateInputSchema = …
- L129 export const catalogPriceInputSchema = …
### packages/validation/index.ts
- L2 export const loginSchema = …
- L6 export const contextSchema = …
### scripts/catalog-image-cleanup.mjs
- L5 function projectOrigin (value)
- L23 export function validateCatalogCleanupEnv (env)
- L34 export function runCatalogImageCleanup (env = process.env, options = {})
- L81 export function catalogCleanupExitCode (result)
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
### supabase/migrations/202609300001_catalog.sql
- L5 CREATE FUNCTION private.catalog_whitespace() RETURNS …
- L11 CREATE FUNCTION private.catalog_trim(p_value text) RETURNS …
- L15 CREATE FUNCTION private.catalog_spaces(p_value text) RETURNS …
- L20 CREATE FUNCTION private.catalog_optional(p_value text) RETURNS …
- L24 CREATE FUNCTION private.catalog_amount(p_value text) RETURNS …
- L37 REVOKE all on function private.catalog_whitespace(),private.catalog_tr…
- L39 GRANT execute on function private.catalog_whitespace(),private.catalo…
- L41 CREATE TABLE public.product_categories
- L47 CREATE INDEX product_categories_name_key
- L49 CREATE TABLE public.products
- L58 CREATE INDEX products_search
- L59 CREATE INDEX products_category_filter
- L61 CREATE TABLE public.product_variants
- L73 CREATE INDEX product_variants_sku_key
- L74 CREATE INDEX product_variants_barcode_key
- L75 CREATE INDEX product_variants_option_key
- L76 CREATE INDEX product_variants_by_product
- L78 CREATE TABLE public.product_prices
- L88 CREATE INDEX product_prices_by_variant
- L90 CREATE TABLE public.catalog_image_objects
- L105 CREATE INDEX catalog_image_cleanup
- L108 CREATE TABLE public.product_images
- L117 CREATE TABLE public.catalog_create_requests
- L124 CREATE FUNCTION private.catalog_request_immutable() RETURNS …
- L129 CREATE TRIGGER catalog_request_no_update
- L131 CREATE TRIGGER catalog_request_no_truncate
- L133 REVOKE all on function private.catalog_request_immutable() from public…
- L136 CREATE FUNCTION private.catalog_before_write() RETURNS …
- L168 CREATE FUNCTION private.catalog_image_object_guard() RETURNS …
- L185 CREATE TRIGGER catalog_image_object_guard
- L187 CREATE FUNCTION private.catalog_guard_keys() RETURNS …
- L205 CREATE FUNCTION private.can_read_catalog(p_org uuid) RETURNS …
- L213 CREATE FUNCTION private.can_write_catalog(p_org uuid,p_store uuid) RETURNS …
- L221 CREATE FUNCTION private.catalog_can_upload_object(p_path text) RETURNS …
- L230 CREATE FUNCTION private.catalog_can_read_object(p_path text) RETURNS …
- L237 REVOKE all on function private.catalog_guard_keys(),private.can_read_c…
- L239 GRANT execute on function private.can_read_catalog(uuid),private.can_…
- L240 REVOKE all on function private.catalog_can_upload_object(text),private…
- L242 GRANT execute on function private.catalog_can_upload_object(text),pri…
- L244 CREATE FUNCTION private.catalog_audit() RETURNS …
- L268 CREATE FUNCTION private.catalog_bump_product() RETURNS …
- L282 CREATE FUNCTION private.catalog_retire_cover_object() RETURNS …
- L301 CREATE FUNCTION public.catalog_search_products(p_organization_id uuid,p_store_id uuid,p_query t…
- L331 REVOKE all on function public.catalog_search_products(uuid,uuid,text,u…
- L332 GRANT execute on function public.catalog_search_products(uuid,uuid,te…
- L333 CREATE TRIGGER catalog_image_object_audit
- L335 CREATE TRIGGER catalog_variant_bump
- L337 CREATE TRIGGER catalog_price_bump
- L339 CREATE TRIGGER catalog_cover_bump
- L341 CREATE TRIGGER catalog_cover_retire
- L344 ALTER TABLE public.product_categories ENABLE RLS
- L345 ALTER TABLE public.products ENABLE RLS
- L346 ALTER TABLE public.product_variants ENABLE RLS
- L347 ALTER TABLE public.product_prices ENABLE RLS
- L348 ALTER TABLE public.product_images ENABLE RLS
- L349 ALTER TABLE public.catalog_image_objects ENABLE RLS
- L350 ALTER TABLE public.catalog_create_requests ENABLE RLS
- L351 REVOKE all on public.product_categories,public.products,public.product…
- L353 GRANT select on public.product_categories,public.products,public.prod…
- L355 GRANT all on public.product_categories,public.products,public.product…
- L357 CREATE POLICY catalog_category_read ON public.product_categories
- L359 CREATE POLICY catalog_product_read ON public.products
- L361 CREATE POLICY catalog_variant_read ON public.product_variants
- L363 CREATE POLICY catalog_price_read ON public.product_prices
- L365 CREATE POLICY catalog_cover_read ON public.product_images
- L371 CREATE POLICY scoped_audit_read ON public.audit_events
- L381 REVOKE all on function private.catalog_before_write(),private.catalog_…
- L384 CREATE FUNCTION private.catalog_require_write(p_org uuid,p_store uuid) RETURNS …
- L392 REVOKE all on function private.catalog_require_write(uuid,uuid) from p…
- L394 CREATE FUNCTION public.catalog_create_category(p_organization_id uuid,p_store_id uuid,p_name te…
- L404 CREATE FUNCTION public.catalog_update_category(p_organization_id uuid,p_store_id uuid,p_categor…
- L420 CREATE FUNCTION public.catalog_create_product(p_organization_id uuid,p_store_id uuid,p_name tex…
- L455 CREATE FUNCTION public.catalog_update_product(p_organization_id uuid,p_store_id uuid,p_product_…
- L471 CREATE FUNCTION public.catalog_create_variant(p_organization_id uuid,p_store_id uuid,p_product_…
- L486 CREATE FUNCTION public.catalog_update_variant(p_organization_id uuid,p_store_id uuid,p_variant_…
- L507 CREATE FUNCTION public.catalog_set_price(p_organization_id uuid,p_store_id uuid,p_variant_id uu…
- L552 CREATE FUNCTION public.catalog_reserve_image(p_organization_id uuid,p_store_id uuid,p_product_i…
- L570 CREATE FUNCTION public.catalog_mark_image_uploaded(p_organization_id uuid,p_store_id uuid,p_obj…
- L587 CREATE FUNCTION public.catalog_set_cover(p_organization_id uuid,p_store_id uuid,p_product_id uu…
- L627 CREATE FUNCTION public.catalog_get_cover_path(p_organization_id uuid,p_store_id uuid,p_product_…
### supabase/migrations/202609300002_catalog_storage.sql
- L13 CREATE POLICY catalog_reserved_object_insert ON storage.objects
- L17 CREATE POLICY catalog_authorized_object_read ON storage.objects
### supabase/migrations/202609300003_catalog_image_attestation.sql
- L6 CREATE TABLE private.catalog_image_attestation_key
- L11 REVOKE all on private.catalog_image_attestation_key from public,anon,a…
- L12 ALTER TABLE private.catalog_image_attestation_key ENABLE RLS
- L19 CREATE FUNCTION private.catalog_hmac_sha256(p_payload bytea,p_key bytea) RETURNS …
- L36 CREATE FUNCTION private.catalog_equal_mac(p_left bytea,p_right bytea) RETURNS …
- L47 CREATE FUNCTION public.catalog_mark_image_attested(p_organization_id uuid,p_store_id uuid,p_obj…
- L95 REVOKE all on function private.catalog_hmac_sha256(bytea,bytea),
- L97 REVOKE all on function public.catalog_mark_image_attested(
- L99 GRANT execute on function public.catalog_mark_image_attested(
### supabase/migrations/202610020001_catalog_service_role_normalization.sql
- L6 GRANT usage on schema private to service_role
- L7 GRANT execute on function private.catalog_whitespace(), private.catal…
### supabase/migrations/202610030001_catalog_conflict_http.sql
- L11 CREATE FUNCTION public.catalog_update_category(p_organization_id uuid,p_store_id uuid,p_categor…
- L27 CREATE FUNCTION public.catalog_create_product(p_organization_id uuid,p_store_id uuid,p_name tex…
- L62 CREATE FUNCTION public.catalog_update_product(p_organization_id uuid,p_store_id uuid,p_product_…
- L78 CREATE FUNCTION public.catalog_update_variant(p_organization_id uuid,p_store_id uuid,p_variant_…
- L99 CREATE FUNCTION public.catalog_set_price(p_organization_id uuid,p_store_id uuid,p_variant_id uu…
- L130 CREATE FUNCTION public.catalog_set_cover(p_organization_id uuid,p_store_id uuid,p_product_id uu…
### supabase/tests/bootstrap.sql
- L6 CREATE TABLE auth.users
- L7 CREATE FUNCTION auth.uid() RETURNS …
- L8 GRANT usage on schema public,auth to anon,authenticated,service_role
- L9 GRANT execute on function auth.uid() to authenticated,service_role

## Testes (describe/it/test)

### tests/catalog-application.test.ts
- L85 describe('catalog application authorization')
- L86 it('maps a domain PT409 to conflict without exposing th…')
- L96 it('requires an active member with an explicit active s…')
- L105 it('keeps read roles from mutating and denies revoked s…')
- L120 it('does not treat a valid ID from another tenant as pe…')
- L126 it('does not invoke RPC after revocation and supplies o…')
### tests/catalog-cleanup-guard.test.ts
- L16 describe('catalog image cleanup preflight')
- L17 it('requires explicit flag, separate matching origin an…')
- L33 it('returns a failed deletion to the delayed retry queu…')
### tests/catalog-domain.test.ts
- L34 describe('catalog normalization and boundaries')
- L35 it('preserves category display accents but folds whites…')
- L53 it('checks product name and optional description limits…')
- L68 it('normalizes SKU and attributes, retaining exact barc…')
- L92 it('requires the first-cycle unit UN and accepts an unc…')
- L105 it('validates atomic product creation and idempotency k…')
- L127 describe('exact BRL prices and revisions')
- L128 it('normalizes decimal text without floating point and …')
- L140 it('aligns the input maximum with numeric(12,2) and rej…')
- L162 it('transports PostgreSQL bigint revisions as bounded d…')
### tests/catalog-image-animation.test.ts
- L5 describe('catalog image container animation boundary')
- L6 it('accepts ordinary static PNG and WebP')
- L16 it('rejects APNG declaration before a decoder could fla…')
- L30 it('rejects WebP animation flag and malformed RIFF leng…')
### tests/catalog-image-attestation.test.ts
- L22 describe('Catalog image attestation')
- L59 it('matches the standard HMAC-SHA256 output')
- L69 it('rejects forged, stale and unauthorized marks; accep…')
### tests/catalog-image-cloudflare.test.ts
- L49 describe('Cloudflare catalog image adapter')
- L50 it('returns reencoded JPEG with final orientation and n…')
- L76 it('rejects unsupported and oversized input before invo…')
- L89 it('reports binding quota distinctly from invalid input')
- L101 it('fails closed on mismatched output MIME')
- L113 it('bounds the encoded output stream before storing')
### tests/catalog-image-container-metadata.test.ts
- L25 describe('PNG and WebP metadata sanitizer')
- L26 it('removes textual, EXIF, XMP and ICC side data from P…')
- L56 it('removes EXIF, XMP and ICC chunks from static WebP')
- L81 it('fails closed on truncated containers')
### tests/catalog-image-jpeg-metadata.test.ts
- L15 describe('JPEG binding output metadata sanitizer')
- L35 it('fails closed on truncated or trailing data')
### tests/catalog-image.test.ts
- L9 describe('catalog cover processing')
- L10 it('accepts the received host and rejects a different o…')
- L21 it('decodes, reencodes and strips source metadata befor…')
- L40 it('rejects unsupported, malformed, oversized and extre…')
- L72 it('bounds multipart bytes before parsing, including re…')
### tests/catalog-sql.test.ts
- L68 describe('Catálogo 002 SQL')
- L106 it('applies incrementally over H1 with RLS on each new …')
- L116 it('allows service_role to normalize administrative cat…')
- L141 it('requires role and live store grant for read/write, …')
- L195 it('normalizes uniqueness, returns same idempotent resu…')
- L257 it('raises PT409 for category, variant and price CAS co…')
- L321 it('isolates price by store, preserves decimals and rol…')
- L389 it('rejects administrative cross-tenant relations and s…')
- L412 it('keeps existing products under an inactive category …')
- L449 it('reserves SKU, barcode and option combination after …')
- L498 it('paginates deterministically with a textual store pr…')
- L546 it('removes catalog and price visibility immediately af…')
- L674 it('atomically replaces a validated cover and retires t…')
- L779 it('rejects a direct cover link after the product is de…')
### tests/catalog-ui.test.tsx
- L76 describe('Catálogo: apresentação com escopo de loja')
- L77 it('mostra ausência de preço sem transformar em zero e …')
- L84 it('não oferece controles de alteração a quem só consul…')
- L93 it('oferece edição de produto e preço ao papel autoriza…')
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
### tests/e2e/catalog.spec.ts
- L11 test('manager searches and reads store price in the catal…')
- L43 test('cashier can read catalog but cannot edit it')
- L56 test('manager creates a product and sets its store price')
- L74 test('catalog fits viewport at ${width}px')
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
### tests/https-auth.test.ts
- L62 describe('HTTPS session cookies')
- L63 it('marks the real Supabase SSR login cookie Secure in …')
- L86 it('marks renewed session cookies Secure through the pr…')
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
