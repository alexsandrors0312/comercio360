param([switch]$SetterFailure)

# Isolated provision/retry contract. All database and runtime calls are fakes.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$global:fixture = [byte[]](0..31)
$global:encoded = [Convert]::ToBase64String($global:fixture)
$global:keyCount = 0
$global:insertCount = 0
$global:queries = @()

function global:npx {
  $sql = [string]$args[5]
  $global:queries += $sql
  $global:LASTEXITCODE = 0
  if ($sql -like '*as bucket_ready*') {
    return (@{ rows = @(@{ bucket_ready = $true; key_count = $global:keyCount }) } | ConvertTo-Json -Compress -Depth 4)
  }
  if ($sql -like 'insert into private.catalog_image_attestation_key*') {
    $global:insertCount++
    $global:keyCount = 1
    return (@{ attestation_key = $global:encoded } | ConvertTo-Json -Compress)
  }
  if ($sql -like "select encode(secret,'base64')*") {
    return (@{ attestation_key = $global:encoded } | ConvertTo-Json -Compress)
  }
  if ($sql -match "convert_to\('([^']+)','UTF8'\)") {
    $hmac = New-Object Security.Cryptography.HMACSHA256
    try {
      $hmac.Key = $global:fixture
      $mac = [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Matches[1]))).Replace('-', '').ToLowerInvariant()
    } finally { $hmac.Dispose() }
    return (@{ mac = $mac } | ConvertTo-Json -Compress)
  }
  if ($sql -like "select encode(sha256(secret),'hex')*") {
    $fingerprint = [BitConverter]::ToString([Security.Cryptography.SHA256]::HashData($global:fixture)).Replace('-', '').ToLowerInvariant()
    return (@{ fingerprint = $fingerprint } | ConvertTo-Json -Compress)
  }
  throw 'Unexpected SQL in isolated test'
}

$ref = (Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim()
$url = "https://$ref.supabase.co"
if ($SetterFailure) {
  $failureSetter = (Resolve-Path 'tests/support/catalog-key-test-setter-fail.ps1').Path
  $failureResult = & scripts/catalog-image-key.ps1 -ConfirmProjectUrl $url -RuntimeSetterPath $failureSetter
  if ($LASTEXITCODE -ne 1 -or $failureResult -notlike '*etapa runtime installer*' -or
      $failureResult -match [regex]::Escape($global:encoded)) {
    throw 'Expected sanitized runtime setter failure'
  }
  Write-Output 'PASS: falha do instalador foi detectada sem divulgar segredo.'
  return
}
$rejected = & scripts/catalog-image-key.ps1 -ConfirmProjectUrl 'https://wrong.supabase.co' -RuntimeSetterPath (Resolve-Path 'tests/support/catalog-key-test-setter.ps1').Path
if ($LASTEXITCODE -ne 1 -or $rejected -notlike '*etapa target*' -or $global:queries.Count -ne 0) {
  throw 'Destination guard contract failed'
}
$counterPath = Join-Path $env:TEMP ("catalog-key-test-" + [guid]::NewGuid().ToString('N') + '.txt')
try {
  $setterPath = (Resolve-Path 'tests/support/catalog-key-test-setter.ps1').Path
  $first = & scripts/catalog-image-key.ps1 -ConfirmProjectUrl $url -RuntimeSetterPath $setterPath -RuntimeSetterArguments @($counterPath)
  $second = & scripts/catalog-image-key.ps1 -ConfirmProjectUrl $url -RuntimeSetterPath $setterPath -RuntimeSetterArguments @($counterPath)
  $setterCount = if (Test-Path -LiteralPath $counterPath) { [int](Get-Content -LiteralPath $counterPath -Raw) } else { 0 }
  if ($global:insertCount -ne 1 -or $setterCount -ne 2 -or
      @($first).Count -ne 2 -or @($second).Count -ne 2 -or
      (@($first, $second) -join "`n") -match [regex]::Escape($global:encoded)) {
    throw "Provision/retry contract failed: inserts=$global:insertCount setters=$setterCount first=$(@($first).Count) second=$(@($second).Count); result=$first"
  }
} finally {
  Remove-Item -LiteralPath $counterPath -ErrorAction SilentlyContinue
}
$failureOutput = & pwsh -NoProfile -File tests/catalog-image-key.test.ps1 -SetterFailure 2>&1
if ($LASTEXITCODE -ne 0 -or $failureOutput -notlike '*falha do instalador foi detectada*' -or
    $failureOutput -match [regex]::Escape($global:encoded)) {
  throw 'Runtime setter failure contract failed'
}
Write-Output 'PASS: provisionamento isolado e repetição idempotente, sem segredo na saída.'
Write-Output 'PASS: falha do instalador reportada sem divulgar segredo.'
Write-Output 'PASS: destino divergente bloqueado antes de consultar o banco.'
