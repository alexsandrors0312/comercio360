param(
  [Parameter(Mandatory = $true)][string]$ConfirmProjectUrl,
  [Parameter(Mandatory = $true)][string]$ConfirmWorkerUrl,
  [switch]$ConfirmNewBuild
)

# Opt-in only, after confirming a fresh deployment in Cloudflare. This script
# never prints API keys, passwords, JWTs, signed URLs or Storage object paths.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$projectRef = 'qiwblpmocldqbijbylwg'
$projectUrl = "https://$projectRef.supabase.co"
$workerUrl = 'https://comercio360.alexsandrors-0312.workers.dev'
$names = @(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'CATALOG_HTTPS_WORKER_URL'
)
$previous = @{}
foreach ($name in $names) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Invoke-SupabaseJson {
  param([string[]]$Arguments)
  # Windows PowerShell 5.1 promotes harmless native stderr to RemoteException
  # under Stop, even when redirected. Preserve the exit code as the gate.
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = & npx --yes supabase@2.119.0 @Arguments --output-format json --agent no 2>$null
    $cliExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($cliExit -ne 0) { throw 'Supabase CLI failure' }
  return ($raw | ConvertFrom-Json)
}

$confirmed = $false
$failed = $false
$phase = 'target'
try {
  if (-not $ConfirmNewBuild) { throw 'New Worker build not confirmed' }
  if ($ConfirmProjectUrl -cne $projectUrl -or $ConfirmWorkerUrl -cne $workerUrl) {
    throw 'Target confirmation mismatch'
  }
  if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -cne $projectRef) {
    throw 'Linked project mismatch'
  }
  $confirmed = $true
  $phase = 'database_preflight'
  $preflight = Invoke-SupabaseJson -Arguments @('db', 'query', '--linked',
    "select (select count(*)=7 and bool_and(version in ('202609070001','202609080001','202609300001','202609300002','202609300003','202610020001','202610030001')) from supabase_migrations.schema_migrations) as migrations_ready, (select count(*) from storage.buckets where id='catalog-private' and public=false)=1 as bucket_ready, (select count(*) from private.catalog_image_attestation_key)=1 as hmac_present, (select count(*) from public.catalog_image_objects)=0 as ledger_empty, (select count(*) from storage.objects where bucket_id='catalog-private')=0 as storage_empty, (select count(*) from auth.users where email like 'catalog.https.%@example.test')=0 as fixture_users_absent, (select count(*) from public.products where name like 'Cloudflare HTTPS probe %')=0 as fixture_products_absent")
  if (-not ($preflight.migrations_ready -and $preflight.bucket_ready -and
      $preflight.hmac_present -and $preflight.ledger_empty -and
      $preflight.storage_empty -and $preflight.fixture_users_absent -and
      $preflight.fixture_products_absent)) {
    throw 'Hosted preflight mismatch'
  }
  $phase = 'api_key_inventory'
  $listed = Invoke-SupabaseJson -Arguments @('projects', 'api-keys', '--project-ref', $projectRef)
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
  $env:CATALOG_HTTPS_WORKER_URL = $workerUrl
  Write-Output 'PASS: preflight HTTPS, migracoes e chave HMAC operacional'
  $phase = 'hosted_probe'
  & node tests/hosted/cloudflare-https.mjs
  if ($LASTEXITCODE -ne 0) { $failed = $true }
} catch {
  $failed = $true
  $safeReasons = @('Supabase CLI failure', 'Hosted preflight mismatch',
    'API key inventory mismatch', 'Target confirmation mismatch',
    'Linked project mismatch', 'New Worker build not confirmed')
  $reason = if ($_.Exception.Message -in $safeReasons) {
    $_.Exception.Message
  } else { $_.Exception.GetType().Name }
  Write-Output "FAIL: preparacao HTTPS em $phase ($reason). Diagnostico sensivel omitido; nenhuma nova tentativa automatica."
} finally {
  if ($confirmed) {
    try {
      $phase = 'database_postflight'
      $postflight = Invoke-SupabaseJson -Arguments @('db', 'query', '--linked',
        "select (select count(*) from auth.users where email like 'catalog.https.%@example.test') as fixture_users, (select count(*) from public.products where name like 'Cloudflare HTTPS probe %') as fixture_products, (select count(*) from storage.objects where bucket_id='catalog-private') as storage_objects, (select count(*) from public.catalog_image_objects) as image_ledger, (select count(*) from private.catalog_image_attestation_key) as hmac_keys")
      foreach ($field in @('fixture_users','fixture_products','storage_objects','image_ledger','hmac_keys')) {
        if ($null -eq $postflight.$field -or [string]$postflight.$field -notmatch '^\d+$') {
          throw 'Postflight count shape mismatch'
        }
      }
      if ([int]$postflight.fixture_users -ne 0 -or
          [int]$postflight.fixture_products -ne 0 -or
          [int]$postflight.storage_objects -ne 0 -or
          [int]$postflight.image_ledger -ne 0 -or
          [int]$postflight.hmac_keys -ne 1) {
        $failed = $true
        Write-Output 'FAIL: postflight com residuos ou chave HMAC operacional ausente.'
      } else {
        Write-Output 'PASS: postflight sem fixtures; chave HMAC operacional preservada'
      }
    } catch {
      $failed = $true
      Write-Output "FAIL: postflight em $phase nao confirmado. Diagnostico sensivel omitido."
    }
  }
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
}
if ($failed) { exit 1 }
