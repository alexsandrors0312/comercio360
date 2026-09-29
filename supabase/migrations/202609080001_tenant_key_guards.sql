-- Corrective package 001.1. Append-only migration; do not rewrite Foundation.
begin;
create function private.guard_structural_keys() returns trigger
language plpgsql set search_path='' as $$
declare keys text[]; key text; before_doc jsonb; after_doc jsonb;
begin
 keys=case tg_table_name
  when 'organizations' then array['id']
  when 'stores' then array['id','organization_id']
  when 'memberships' then array['id','organization_id','user_id']
  when 'user_store_access' then array['id','organization_id','membership_id','store_id']
 end;
 before_doc=to_jsonb(old); after_doc=to_jsonb(new);
 foreach key in array keys loop
  if before_doc->key is distinct from after_doc->key then
   raise exception 'Structural key %.% is immutable; revoke/deactivate and create a new record',tg_table_name,key using errcode='23514';
  end if;
 end loop;
 return new;
end; $$;
revoke all on function private.guard_structural_keys() from public,anon,authenticated,service_role;
do $$ declare tbl text; begin
 foreach tbl in array array['organizations','stores','memberships','user_store_access'] loop
  execute format('create trigger guard_structural_keys before update on public.%I for each row execute function private.guard_structural_keys()',tbl);
 end loop;
end $$;

-- Defense in depth, including explicit service_role inserts into the audit stream.
-- Validate existing rows as well. A failure must be investigated, never silently erased.
alter table public.audit_events add constraint audit_payload_tenant_consistency check (
 (not coalesce(old_value ? 'organization_id',false) or (old_value->>'organization_id') is not distinct from organization_id::text)
 and (not coalesce(new_value ? 'organization_id',false) or (new_value->>'organization_id') is not distinct from organization_id::text)
 and (entity_type <> 'organizations' or (
  (old_value is null or (old_value->>'id') is not distinct from organization_id::text)
  and (new_value is null or (new_value->>'id') is not distinct from organization_id::text)
 ))
);
commit;
