param([Parameter(Mandatory=$true)][ValidateSet('Seed','Verify')][string]$Phase)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

# Execute in a private terminal without transcription. Values are never command arguments.
function Read-PrivateValue([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer) }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)
        $secure.Dispose()
    }
}

function Get-SeedFailure([int]$Code) {
    $preflight = @{
        20='Confirmacao de ambiente descartavel ausente.'
        21='URL publica de destino ausente no ambiente ou .env.local.'
        22='A URL de confirmacao nao foi preenchida.'
        23='URL invalida ou confirmacao diferente do destino. Confira a origem HTTPS no painel.'
        24='Chave administrativa nao preenchida.'
        25='A senha das contas precisa ter pelo menos 12 caracteres.'
    }
    if ($preflight.ContainsKey($Code)) { return "H1-SEED-${Code}: $($preflight[$Code]) Nenhuma escrita iniciada." }
    $stages = @{4='inicializar cliente';5='conferir seed SQL';6='listar usuarios Auth';7='criar usuario Auth';8='gravar perfil';9='gravar vinculo';10='gravar acesso a loja'}
    $reasons = @{1='acesso recusado; confira se a chave e administrativa e pertence ao projeto';2='falha de comunicacao';3='tabela ausente no schema da API';4='relacionamento exigido ausente';5='restricao de integridade';6='senha recusada pela politica do Auth';7='empresas ou lojas ficticias do seed.sql ausentes';9='erro sem classificacao segura'}
    $stage = [int][Math]::Floor($Code / 10)
    $category = $Code % 10
    if ($stages.ContainsKey($stage) -and $reasons.ContainsKey($category)) {
        return "H1-SEED-${Code}: etapa '$($stages[$stage])': $($reasons[$category]). Nao continuar a homologacao."
    }
    return 'H1-SEED-RUNTIME: Node nao iniciou ou terminou sem diagnostico reconhecido. Conferir Node, dependencias e .env.local. Nenhuma conclusao sobre escritas.'
}

try {
    $env:CONFIRM_SUPABASE_PROJECT_URL = Read-Host 'URL conferida separadamente no painel do projeto DESCARTAVEL de desenvolvimento'
    if ([string]::IsNullOrWhiteSpace($env:CONFIRM_SUPABASE_PROJECT_URL)) { throw (Get-SeedFailure 22) }
    $history = Read-Host 'Apos conferir migration list: digite 202609070001,202609080001 somente se ambas constarem em Remote e o seed SQL estiver aplicado'
    if ($history -ne '202609070001,202609080001') { throw 'Historico nao confirmado; nenhuma escrita executada.' }
    $env:ALLOW_DEVELOPMENT_SEED = 'yes'
    $env:SUPABASE_SECRET_KEY = Read-PrivateValue 'Chave administrativa (entrada oculta; nunca enviar ao chat)'
    if ([string]::IsNullOrWhiteSpace($env:SUPABASE_SECRET_KEY)) { throw (Get-SeedFailure 24) }
    $env:SEED_PASSWORD = Read-PrivateValue 'Senha das contas example.test (12+ caracteres; entrada oculta)'
    if ($env:SEED_PASSWORD.Length -lt 12) { throw (Get-SeedFailure 25) }
    if ($Phase -eq 'Seed') {
        # Same entry point as npm run seed:users; --env-file is a Node CLI option.
        # Redirect in the child process, so native stderr cannot become a
        # terminating PowerShell error and hide the classified exit code.
        $seedProcess = [System.Diagnostics.Process]::new()
        try {
            $seedProcess.StartInfo.FileName = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
            $seedProcess.StartInfo.Arguments = '--env-file=.env.local scripts/seed-users.mjs'
            $seedProcess.StartInfo.WorkingDirectory = (Get-Location).Path
            $seedProcess.StartInfo.UseShellExecute = $false
            $seedProcess.StartInfo.CreateNoWindow = $true
            $seedProcess.StartInfo.RedirectStandardOutput = $true
            $seedProcess.StartInfo.RedirectStandardError = $true
            $null = $seedProcess.Start()
            $stdoutTask = $seedProcess.StandardOutput.ReadToEndAsync()
            $stderrTask = $seedProcess.StandardError.ReadToEndAsync()
            $seedProcess.WaitForExit()
            $result = $seedProcess.ExitCode
            $null = $stdoutTask.GetAwaiter().GetResult()
            $null = $stderrTask.GetAwaiter().GetResult()
        } catch {
            throw (Get-SeedFailure 1)
        } finally {
            $seedProcess.Dispose()
            $stdoutTask = $null
            $stderrTask = $null
        }
        if ($result -ne 0) { throw (Get-SeedFailure $result) }
        Write-Host 'PASS: quatro contas ficticias preparadas. Senhas existentes preservadas.'
    } else {
        & node --env-file=.env.local tests/hosted/h1.mjs
        if ($LASTEXITCODE -ne 0) { throw 'H1 nao aprovado. Consulte apenas os resultados sanitizados em docs/H1_RESULTADOS.json.' }
    }
} finally {
    foreach ($variable in @('SUPABASE_SECRET_KEY','SEED_PASSWORD','ALLOW_DEVELOPMENT_SEED','CONFIRM_SUPABASE_PROJECT_URL')) {
        [Environment]::SetEnvironmentVariable($variable, $null, 'Process')
    }
}
