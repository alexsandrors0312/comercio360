param(
  [Parameter(Mandatory = $true)]
  [string]$ConfirmProjectUrl,
  [switch]$Extended
)

# Opt-in verification for the H1 disposable project only. Never print API keys,
# passwords, JWTs, HMAC keys, object paths or raw provider responses.
$ErrorActionPreference = 'Stop'
$projectRef = 'qiwblpmocldqbijbylwg'
$projectUrl = "https://$projectRef.supabase.co"
$environmentNames = @(
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY', 'CATALOG_IMAGE_ATTESTATION_KEY', 'CATALOG_HOSTED_EXTENDED'
)
$previous = @{}
foreach ($name in $environmentNames) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Invoke-SupabaseJson {
  param([string[]]$Arguments)
  $raw = & npx --yes supabase@2.119.0 @Arguments --output-format json --agent no 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase CLI failure' }
  return ($raw | ConvertFrom-Json)
}

$keyInserted = $false
$targetConfirmed = $false
$failed = $false
try {
  if ($ConfirmProjectUrl -cne $projectUrl) { throw 'Project confirmation mismatch' }
  if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -cne $projectRef) {
    throw 'Linked project mismatch'
  }
  $targetConfirmed = $true
  $preflight = Invoke-SupabaseJson @('db', 'query', '--linked',
    "select (select count(*)=7 and bool_and(version in ('202609070001','202609080001','202609300001','202609300002','202609300003','202610020001','202610030001')) from supabase_migrations.schema_migrations) as migrations_ready, (select count(*) from storage.buckets where id='catalog-private' and public=false)=1 as bucket_ready, (select count(*) from private.catalog_image_attestation_key)=0 as key_absent, (select count(*) from public.catalog_image_objects)=0 as ledger_empty, (select count(*) from storage.objects where bucket_id='catalog-private')=0 as storage_empty, (select count(*) from auth.users where email like 'catalog.hosted.%@example.test')=0 as test_users_absent")
  if (-not ($preflight.migrations_ready -and $preflight.bucket_ready -and $preflight.key_absent -and
      $preflight.ledger_empty -and $preflight.storage_empty -and $preflight.test_users_absent)) {
    throw 'Hosted preflight mismatch'
  }
  $listed = Invoke-SupabaseJson @('projects', 'api-keys', '--project-ref', $projectRef)
  $publishable = @($listed.keys | Where-Object { $_.type -eq 'publishable' })
  $administrative = @($listed.keys | Where-Object { $_.name -eq 'service_role' })
  if ($publishable.Count -ne 1 -or $administrative.Count -ne 1 -or
      -not $publishable[0].api_key.StartsWith('sb_publishable_') -or
      $administrative[0].api_key.Length -le 100) {
    throw 'API key inventory mismatch'
  }
  $env:NEXT_PUBLIC_SUPABASE_URL = $projectUrl
  $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $publishable[0].api_key
  $env:SUPABASE_SECRET_KEY = $administrative[0].api_key
  $created = Invoke-SupabaseJson @('db', 'query', '--linked',
    "insert into private.catalog_image_attestation_key(singleton,secret) values(true,gen_random_bytes(32)) returning encode(secret,'base64') as attestation_key")
  $keyInserted = $true
  if ($created.attestation_key -notmatch '^[A-Za-z0-9+/]{43}=$') {
    throw 'Attestation key shape mismatch'
  }
  $env:CATALOG_IMAGE_ATTESTATION_KEY = $created.attestation_key
  $env:CATALOG_HOSTED_EXTENDED = if ($Extended) { 'yes' } else { '' }
  Write-Output 'PASS: preflight e chave temporária em memória'
  & node tests/hosted/catalog-storage.mjs
  if ($LASTEXITCODE -ne 0) { $failed = $true }
} catch {
  $failed = $true
  Write-Output 'FAIL: preparação hospedada. Diagnóstico sensível omitido.'
} finally {
  if ($keyInserted) {
    try {
      $removed = Invoke-SupabaseJson @('db', 'query', '--linked',
        'delete from private.catalog_image_attestation_key where singleton=true returning true as removed')
      if (-not $removed.removed) { throw 'Temporary key cleanup failure' }
      Write-Output 'PASS: chave HMAC temporária removida'
    } catch {
      $failed = $true
      Write-Output 'FAIL: remoção da chave temporária. Verificar a tabela privada antes de repetir.'
    }
  }
  if ($targetConfirmed) {
    try {
    $postflight = Invoke-SupabaseJson @('db', 'query', '--linked',
      "select (select count(*) from auth.users where email like 'catalog.hosted.%@example.test') as test_users, (select count(*) from public.products where name like 'Hosted storage probe %' or name like 'Hosted updated %' or name like 'Hosted CAS %') as test_products, (select count(*) from storage.objects where bucket_id='catalog-private') as storage_objects, (select count(*) from public.catalog_image_objects) as image_ledger, (select count(*) from private.catalog_image_attestation_key) as hmac_keys")
    foreach ($field in @('test_users', 'test_products', 'storage_objects', 'image_ledger', 'hmac_keys')) {
      if ($null -eq $postflight.$field -or [string]$postflight.$field -notmatch '^\d+$') {
        throw 'Postflight count shape mismatch'
      }
    }
    $snapshot = [ordered]@{
      project_ref = $projectRef
      executed_at = (Get-Date).ToUniversalTime().ToString('o')
      test_users = [int]$postflight.test_users
      test_products = [int]$postflight.test_products
      storage_objects = [int]$postflight.storage_objects
      image_ledger = [int]$postflight.image_ledger
      hmac_keys = [int]$postflight.hmac_keys
    }
    $reportPath = 'docs/CATALOGO_002_HOSPEDADO_POS_LIMPEZA_' +
      (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ') + '.json'
    $snapshot | ConvertTo-Json -Depth 4 |
      Set-Content -LiteralPath $reportPath -Encoding utf8
    Write-Output "Evidência sanitizada pós-limpeza: $reportPath"
    $residualCounts = @($snapshot.test_users, $snapshot.test_products,
      $snapshot.storage_objects, $snapshot.image_ledger, $snapshot.hmac_keys) |
      Where-Object { $_ -ne 0 }
    if (@($residualCounts).Count -gt 0) {
      $failed = $true
      Write-Output 'FAIL: resíduos de teste após a limpeza.'
    }
    } catch {
      $failed = $true
      Write-Output 'FAIL: consulta final de limpeza. Diagnóstico sensível omitido.'
    }
  }
  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
}
if ($failed) { exit 1 }
