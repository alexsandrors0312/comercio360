param(
  [Parameter(Mandatory = $true)]
  [string]$ConfirmProjectUrl,
  [Parameter(Mandatory = $true)]
  [string]$RuntimeSetterPath,
  [string[]]$RuntimeSetterArguments = @()
)

# Install CATALOG_IMAGE_ATTESTATION_KEY through a trusted runtime secret setter
# that reads one base64 value from stdin. The value never enters arguments,
# repository files or this script's output. This script does not rotate a key.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-SupabaseRow {
  param([string]$Sql)
  $raw = & npx --yes supabase@2.119.0 db query --linked $Sql --output-format json --agent no 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Database query failed' }
  $row = $raw | ConvertFrom-Json
  if ($row -is [array]) {
    if ($row.Count -ne 1) { throw 'Unexpected database response' }
    $row = $row[0]
  }
  if ($null -ne $row -and $null -ne $row.PSObject.Properties['rows']) {
    if (@($row.rows).Count -ne 1) { throw 'Unexpected database response' }
    $row = @($row.rows)[0]
  }
  if ($null -eq $row) { throw 'Unexpected database response' }
  return $row
}

$key = $null
$keyBytes = $null
$failed = $false
$stage = 'target'
try {
  $ref = (Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim()
  if ($ref -cnotmatch '^[a-z0-9]{20}$') { throw 'Linked project unavailable' }
  $expectedUrl = "https://$ref.supabase.co"
  if ($ConfirmProjectUrl -cne $expectedUrl) { throw 'Project confirmation mismatch' }

  $stage = 'installer'
  $setter = Get-Command -Name $RuntimeSetterPath -ErrorAction Stop
  if ($setter.CommandType -notin @('Application', 'ExternalScript')) {
    throw 'Unsupported runtime secret setter'
  }
  $setterPath = if ($setter.CommandType -eq 'Application') { $setter.Source } else { $setter.Path }
  if (-not $setterPath) { throw 'Runtime secret setter path unavailable' }

  $stage = 'preflight'
  $preflight = Invoke-SupabaseRow "select (select count(*) from storage.buckets where id='catalog-private' and public=false)=1 as bucket_ready, (select count(*) from private.catalog_image_attestation_key) as key_count"
  if (-not $preflight.bucket_ready -or [string]$preflight.key_count -cnotmatch '^[01]$') {
    throw 'Database preflight mismatch'
  }

  $stage = 'database key'
  if ([int]$preflight.key_count -eq 0) {
    $result = Invoke-SupabaseRow "insert into private.catalog_image_attestation_key(singleton,secret) values(true,gen_random_bytes(32)) returning encode(secret,'base64') as attestation_key"
  } else {
    $result = Invoke-SupabaseRow "select encode(secret,'base64') as attestation_key from private.catalog_image_attestation_key where singleton=true"
  }
  $key = [string]$result.attestation_key
  if ($key -cnotmatch '^[A-Za-z0-9+/]{43}=$') { throw 'Invalid key shape' }
  $keyBytes = [Convert]::FromBase64String($key)
  if ($keyBytes.Length -ne 32 -or [Convert]::ToBase64String($keyBytes) -cne $key) {
    throw 'Invalid key shape'
  }

  $stage = 'challenge'
  $nonceBytes = New-Object byte[] 16
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($nonceBytes) } finally { $rng.Dispose() }
  $nonce = ([BitConverter]::ToString($nonceBytes)).Replace('-', '').ToLowerInvariant()
  $challenge = "catalog-image-key-v1|$nonce"
  $databaseMac = Invoke-SupabaseRow "select encode(private.catalog_hmac_sha256(convert_to('$challenge','UTF8'),secret),'hex') as mac from private.catalog_image_attestation_key where singleton=true"
  $hmac = New-Object Security.Cryptography.HMACSHA256
  try {
    $hmac.Key = $keyBytes
    $localMac = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($challenge))
  } finally { $hmac.Dispose() }
  if ([string]$databaseMac.mac -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid database MAC' }
  $remoteMac = [Convert]::FromHexString([string]$databaseMac.mac)
  $difference = 0
  for ($index = 0; $index -lt 32; $index++) {
    $difference = $difference -bor ($localMac[$index] -bxor $remoteMac[$index])
  }
  if ($difference -ne 0) { throw 'Database key mismatch' }

  # Capture and discard both streams: a provider may echo its stdin.
  $stage = 'runtime installer'
  $key | & $setterPath @RuntimeSetterArguments 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Runtime setter failed' }

  $stage = 'postflight'
  $fingerprint = [BitConverter]::ToString([Security.Cryptography.SHA256]::HashData($keyBytes)).Replace('-', '').ToLowerInvariant()
  $postflight = Invoke-SupabaseRow "select encode(sha256(secret),'hex') as fingerprint from private.catalog_image_attestation_key where singleton=true"
  if ([string]$postflight.fingerprint -cne $fingerprint) { throw 'Database key changed' }

  Write-Output 'PASS: banco confirmou a chave e o instalador do runtime aceitou o envio; desafio HMAC consistente.'
  Write-Output 'PENDENTE: comprovar a variável no runtime com upload autenticado pela aplicação publicada em HTTPS.'
} catch {
  $failed = $true
  Write-Output "FAIL: provisionamento HMAC incompleto na etapa $stage. Conferir estado dos dois sistemas sem registrar segredos."
} finally {
  if ($null -ne $keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
  $key = $null
}
if ($failed) { exit 1 }
