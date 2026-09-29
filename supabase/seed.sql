-- Fictional organizations only. No credentials or auth.users mutations.
begin;
insert into public.organizations(id,name) values
 ('10000000-0000-4000-8000-000000000001','Ateliê Aurora — fictícia'),
 ('20000000-0000-4000-8000-000000000001','Casa Horizonte — fictícia') on conflict(id) do nothing;
insert into public.stores(id,organization_id,name) values
 ('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','Loja Centro'),
 ('10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','Loja Jardim'),
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','Loja Vila Nova') on conflict(id) do nothing;
commit;
