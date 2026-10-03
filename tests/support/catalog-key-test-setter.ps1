param(
  [Parameter(Mandatory = $true)]
  [string]$CounterPath,
  [Parameter(ValueFromPipeline = $true)]
  [string]$InputObject
)
process {
  # Fixed public fixture; this helper is never a production secret provider.
  $expected = [Convert]::ToBase64String([byte[]](0..31))
  if ($InputObject -cne $expected) { exit 2 }
  $count = if (Test-Path -LiteralPath $CounterPath) {
    [int](Get-Content -LiteralPath $CounterPath -Raw)
  } else { 0 }
  Set-Content -LiteralPath $CounterPath -Value ($count + 1) -NoNewline
}
