-- Catalog administrative maintenance uses service_role for scoped fixtures and
-- cleanup. CHECK constraints and normalization triggers call these pure helpers.
-- Keep the attestation key table and all other private routines inaccessible.
begin;

grant usage on schema private to service_role;
grant execute on function private.catalog_whitespace(),
  private.catalog_trim(text),private.catalog_spaces(text),
  private.catalog_optional(text) to service_role;

commit;
