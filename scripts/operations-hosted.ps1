param(
  [Parameter(Mandatory = $true)][string]$ConfirmProjectUrl,
  [Parameter(Mandatory = $true)][string]$ConfirmWorkerUrl,
  [switch]$ConfirmCurrentDeployment
)

# Explicit development-only homologation. Never prints credentials, SQL output,
# session cookies, JWTs, private fingerprints or raw provider diagnostics.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$projectRef = 'qiwblpmocldqbijbylwg'
$projectUrl = "https://$projectRef.supabase.co"
$workerUrl = 'https://comercio360.alexsandrors-0312.workers.dev'
$phase = 'target'
$failed = $false
$confirmed = $false
$baseline = $null
$probe = $null
$script:childTerminationConfirmed = $true
$report = [ordered]@{
  schema_version = 1
  started_at = [DateTime]::UtcNow.ToString('o')
  finished_at = $null
  status = 'failed'
  failed_phase = $null
  checks = @()
  postflight = [ordered]@{ confirmed = $false }
  cleanup_retry = 'not_run'
}
$names = @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY',
  'OPERATIONS_WORKER_URL','OPERATIONS_CONFIRMED','OPERATIONS_MANAGER_ID','OPERATIONS_CASHIER_ID')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function Find-NativeSupabase {
  $cache = Join-Path (Get-Location) '.npm-cache/_npx'
  $entries = @(Get-ChildItem -LiteralPath $cache -Directory)
  if ($entries.Count -gt 64) { throw 'Native CLI unavailable' }
  $candidates = @()
  foreach ($entry in $entries) {
    try {
      $modules = Join-Path $entry.FullName 'node_modules'
      $wrapper = Get-Content -LiteralPath (Join-Path $modules 'supabase/package.json') -Raw | ConvertFrom-Json
      $package = Get-Content -LiteralPath (Join-Path $modules '@supabase/cli-windows-x64/package.json') -Raw | ConvertFrom-Json
      if ($wrapper.name -ceq 'supabase' -and $wrapper.version -ceq '2.119.0' -and
          $package.name -ceq '@supabase/cli-windows-x64' -and $package.version -ceq '2.119.0') {
        $path = (Resolve-Path -LiteralPath (Join-Path $modules '@supabase/cli-windows-x64/bin/supabase.exe')).Path
        if (-not $path.StartsWith((Get-Location).Path + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Native CLI unavailable' }
        $candidates += $path
      }
    } catch { # Unrelated cached packages do not participate.
    }
  }
  if ($candidates.Count -ne 1) { throw 'Native CLI unavailable' }
  return $candidates[0]
}
function Invoke-SupabaseJson {
  param([string[]]$Arguments)
  # Call the native binary directly: npm/cmd can truncate multiline SQL.
  $captured = Invoke-CapturedProcess -FilePath $script:native -Arguments ($Arguments + @('--output-format','json','--agent','no')) -TimeoutMs 120000 -MaxOutput 262144
  if ($captured.ExitCode -ne 0) { throw 'Native CLI failure' }
  return ($captured.Output | ConvertFrom-Json)
}
function ConvertTo-NativeArgument {
  param([string]$Value)
  # Windows CommandLineToArgvW escaping, preserving SQL newlines and quotes.
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}
function Invoke-CapturedProcess {
  param([string]$FilePath,[string[]]$Arguments,[int]$TimeoutMs,[int]$MaxOutput)
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $FilePath
  $info.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.WorkingDirectory = (Get-Location).Path
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  $started = $false
  $completed = $false
  $stdout = $null
  $stderr = $null
  try {
    if (-not $process.Start()) { throw 'Child process failure' }
    $started = $true
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMs)) { throw 'Child process timeout' }
    if (-not $stdout.Wait(5000) -or -not $stderr.Wait(5000)) { throw 'Child output timeout' }
    $output = $stdout.Result
    if ($output.Length -gt $MaxOutput) { throw 'Child output exceeded limit' }
    $completed = $true
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output }
  } finally {
    if ($started -and -not $completed) {
      try {
        if (-not $process.HasExited) {
          # Only the still-live process object we started and its own tree.
          $stopInfo = [Diagnostics.ProcessStartInfo]::new()
          $stopInfo.FileName = Join-Path $env:SystemRoot 'System32/taskkill.exe'
          $stopInfo.Arguments = '/PID ' + $process.Id + ' /T /F'
          $stopInfo.UseShellExecute = $false
          $stopInfo.CreateNoWindow = $true
          $stopInfo.RedirectStandardOutput = $true
          $stopInfo.RedirectStandardError = $true
          $stopProcess = [Diagnostics.Process]::Start($stopInfo)
          try {
            [void]$stopProcess.StandardOutput.ReadToEndAsync()
            [void]$stopProcess.StandardError.ReadToEndAsync()
            if (-not $stopProcess.WaitForExit(10000)) { $stopProcess.Kill() }
          } finally { $stopProcess.Dispose() }
          if (-not $process.WaitForExit(10000)) {
            $process.Kill()
            if (-not $process.WaitForExit(5000)) { $script:childTerminationConfirmed = $false }
          }
        }
        if (-not $process.HasExited) { $script:childTerminationConfirmed = $false }
        # If a descendant holds a pipe after the root exits, its current identity
        # is uncertain. Report that instead of killing a possibly reused PID.
        if (($null -ne $stdout -and -not $stdout.IsCompleted) -or ($null -ne $stderr -and -not $stderr.IsCompleted)) { $script:childTerminationConfirmed = $false }
      } catch { $script:childTerminationConfirmed = $false }
    }
    $process.Dispose()
  }
}
function Read-Baseline {
  param([object[]]$AuditIds)
  $sql = @'
select
 (select count(*)=9 and bool_and(version in ('202609070001','202609080001','202609300001','202609300002','202609300003','202610020001','202610030001','202610090001','202610090002')) from supabase_migrations.schema_migrations) as migrations_ready,
 (select count(*)=1 and bool_and(not public) from storage.buckets where id='catalog-private') as bucket_private,
 (select count(*)=1 from private.catalog_image_attestation_key) as hmac_present,
 (select encode(sha256(secret),'hex') from private.catalog_image_attestation_key where singleton) as hmac_fingerprint,
 encode(sha256(convert_to(jsonb_build_array(
  (select coalesce(jsonb_agg(jsonb_build_array(id,email,encrypted_password) order by id),'[]'::jsonb) from auth.users),
  (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.profiles p),
  (select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]'::jsonb) from public.organizations o),
  (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) from public.stores s),
  (select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'::jsonb) from public.memberships m),
  (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.user_store_access a)
 )::text,'UTF8')),'hex') as identity_fingerprint,
 (select count(*) from public.audit_events) as audit_count,
 (select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from public.audit_events) as audit_ids,
 (select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.audit_events a __AUDIT_PREFIX__) as audit_fingerprint,
 (select count(*) from auth.users) as auth_count,
 (select count(*) from public.catalog_image_objects) as image_ledger,
 (select count(*) from storage.objects where bucket_id='catalog-private') as storage_objects,
 (select count(*) from public.product_images) as cover_count,
 (select coalesce(jsonb_agg(u.id),'[]'::jsonb) from auth.users u join public.memberships m on m.user_id=u.id
  where u.email='gerente.aurora@example.test' and m.organization_id='10000000-0000-4000-8000-000000000001'
   and m.active and m.role='manager' and exists(select 1 from public.user_store_access a join public.stores s
    on s.organization_id=a.organization_id and s.id=a.store_id where a.membership_id=m.id and a.organization_id=m.organization_id
     and s.active and s.id='10000000-0000-4000-8000-000000000011')) as manager_ids,
 (select coalesce(jsonb_agg(u.id),'[]'::jsonb) from auth.users u join public.memberships m on m.user_id=u.id
  where u.email='caixa.aurora@example.test' and m.organization_id='10000000-0000-4000-8000-000000000001'
   and m.active and m.role='cashier' and exists(select 1 from public.user_store_access a join public.stores s
    on s.organization_id=a.organization_id and s.id=a.store_id where a.membership_id=m.id and a.organization_id=m.organization_id
     and s.active and s.id='10000000-0000-4000-8000-000000000011')) as cashier_ids
'@
  $auditPrefix = ''
  if ($PSBoundParameters.ContainsKey('AuditIds')) {
    if ($AuditIds.Count -gt 500) { throw 'Baseline mismatch' }
    foreach ($id in $AuditIds) { if ([string]$id -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'Baseline mismatch' } }
    if ($AuditIds.Count -eq 0) { $auditPrefix = 'where false' }
    else { $auditPrefix = 'where a.id in (' + (($AuditIds | ForEach-Object { "'$_'::uuid" }) -join ',') + ')' }
  }
  $sql = $sql.Replace('__AUDIT_PREFIX__', $auditPrefix)
  $result = Invoke-SupabaseJson -Arguments @('db','query','--linked',$sql)
  if ($null -ne $result.rows) {
    if (@($result.rows).Count -ne 1) { throw 'Baseline mismatch' }
    $result = $result.rows[0]
  }
  if ($result -is [Array]) {
    if ($result.Count -ne 1) { throw 'Baseline mismatch' }
    $result = $result[0]
  }
  if ($result.migrations_ready -isnot [bool] -or $result.bucket_private -isnot [bool] -or $result.hmac_present -isnot [bool] -or
      -not ($result.migrations_ready -and $result.bucket_private -and $result.hmac_present) -or
      $result.hmac_fingerprint -cnotmatch '^[0-9a-f]{64}$' -or $result.identity_fingerprint -cnotmatch '^[0-9a-f]{64}$' -or
      $result.audit_fingerprint -cnotmatch '^[0-9a-f]{64}$' -or @($result.audit_ids).Count -ne [long]$result.audit_count -or
      @($result.manager_ids).Count -ne 1 -or @($result.cashier_ids).Count -ne 1) { throw 'Baseline mismatch' }
  foreach ($field in @('audit_count','auth_count','image_ledger','storage_objects','cover_count')) {
    if ([string]$result.$field -notmatch '^\d+$') { throw 'Baseline mismatch' }
  }
  if (-not $PSBoundParameters.ContainsKey('AuditIds') -and @($result.audit_ids).Count -gt 500) { throw 'Baseline mismatch' }
  return $result
}

try {
  if (-not $ConfirmCurrentDeployment -or $ConfirmProjectUrl -cne $projectUrl -or $ConfirmWorkerUrl -cne $workerUrl) { throw 'Target mismatch' }
  if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -cne $projectRef) { throw 'Target mismatch' }
  $script:native = Find-NativeSupabase
  $projects = Invoke-SupabaseJson -Arguments @('projects','list')
  $projectList = if ($null -ne $projects.projects) { @($projects.projects) } else { @($projects) }
  $matching = @($projectList | Where-Object { $_.id -ceq $projectRef -and $_.name -ceq 'comercio360-dev' })
  if ($matching.Count -ne 1) { throw 'Target mismatch' }
  $confirmed = $true
  $phase = 'database_preflight'
  $baseline = Read-Baseline
  $report.checks += [ordered]@{ name = 'database_preflight'; status = 'PASS' }
  $phase = 'api_key_inventory'
  $listed = Invoke-SupabaseJson -Arguments @('projects','api-keys','--project-ref',$projectRef)
  $publishable = @($listed.keys | Where-Object { $_.type -ceq 'publishable' })
  $administrative = @($listed.keys | Where-Object { $_.name -ceq 'service_role' })
  if ($publishable.Count -ne 1 -or $administrative.Count -ne 1 -or
      -not $publishable[0].api_key.StartsWith('sb_publishable_') -or $administrative[0].api_key.Length -le 100) { throw 'API inventory mismatch' }
  $env:NEXT_PUBLIC_SUPABASE_URL = $projectUrl
  $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $publishable[0].api_key
  $env:SUPABASE_SECRET_KEY = $administrative[0].api_key
  $env:OPERATIONS_WORKER_URL = $workerUrl
  $env:OPERATIONS_CONFIRMED = 'yes'
  $env:OPERATIONS_MANAGER_ID = [string]$baseline.manager_ids[0]
  $env:OPERATIONS_CASHIER_ID = [string]$baseline.cashier_ids[0]
  $phase = 'hosted_probe'
  $nodeExecutable = (Get-Command node -CommandType Application | Select-Object -First 1).Source
  $capturedProbe = Invoke-CapturedProcess -FilePath $nodeExecutable -Arguments @('tests/hosted/operations.mjs') -TimeoutMs 600000 -MaxOutput 65536
  $probeExit = $capturedProbe.ExitCode
  $probe = $capturedProbe.Output | ConvertFrom-Json
  if ($probe.schema_version -ne 1 -or $probe.status -notin @('passed','failed') -or $probe.cleanup_retry -cne 'not_run') { throw 'Probe report invalid' }
  $report.probe = $probe
  if ($probeExit -ne 0 -or $probe.status -cne 'passed') { $failed = $true; $report.failed_phase = 'hosted_probe' }
} catch {
  $failed = $true
  $report.failed_phase = $phase
  $report.checks += [ordered]@{ name = $phase; status = 'FAIL' }
} finally {
  if ($confirmed -and $null -ne $baseline) {
    try {
      $postflight = Read-Baseline -AuditIds @($baseline.audit_ids)
      $identitiesPreserved = $postflight.identity_fingerprint -ceq $baseline.identity_fingerprint -and $postflight.auth_count -eq $baseline.auth_count
      $hmacPreserved = $postflight.hmac_fingerprint -ceq $baseline.hmac_fingerprint
      $imagesPreserved = $postflight.image_ledger -eq $baseline.image_ledger -and $postflight.storage_objects -eq $baseline.storage_objects -and $postflight.cover_count -eq $baseline.cover_count
      $auditPreserved = [long]$postflight.audit_count -ge [long]$baseline.audit_count -and $postflight.audit_fingerprint -ceq $baseline.audit_fingerprint
      if (-not ($identitiesPreserved -and $hmacPreserved -and $imagesPreserved -and $auditPreserved)) { throw 'Postflight mismatch' }
      $report.postflight = [ordered]@{ confirmed = $true; identities_preserved = $true; passwords_preserved = $true; hmac_preserved = $true; images_preserved = $true; audit_preserved = $true; audit_events_added = [long]$postflight.audit_count - [long]$baseline.audit_count; migration_count = 9; bucket_private = $true }
    } catch { $failed = $true; $report.failed_phase = 'database_postflight' }
  } else { $failed = $true }
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
  $report.finished_at = [DateTime]::UtcNow.ToString('o')
  $report.process_termination_confirmed = $script:childTerminationConfirmed
  if (-not $script:childTerminationConfirmed) { $failed = $true }
  if (-not $failed -and $report.postflight.confirmed) { $report.status = 'passed' }
  $directory = Join-Path (Get-Location) 'docs/evidencias'
  [void][IO.Directory]::CreateDirectory($directory)
  $filename = 'operacoes-004-hosted-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ') + '.json'
  $path = Join-Path $directory $filename
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($report | ConvertTo-Json -Depth 12))
  $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  Write-Output ('Evidencia: docs/evidencias/' + $filename)
  Write-Output ('Resultado: ' + $report.status + '; fase: ' + $report.failed_phase)
}
if ($failed) { exit 1 }
