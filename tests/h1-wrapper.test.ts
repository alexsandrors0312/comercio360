import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";

// Run the real operator wrapper against a disposable local executable fixture.
// No Supabase SDK, real .env.local, real password or HTTP request is involved.
describe.skipIf(process.platform !== "win32")("H1 PowerShell wrapper", () => {
  it.each([false, true])(
    "loads public env, protects diagnostics and clears administrative variables (failure=%s)",
    (failure) => {
      const root = mkdtempSync(join(tmpdir(), "c360-h1-wrapper-"));
      try {
        mkdirSync(join(root, "scripts"));
        writeFileSync(
          join(root, "scripts", "h1-manual.ps1"),
          readFileSync(new URL("../scripts/h1-manual.ps1", import.meta.url)),
        );
        writeFileSync(
          join(root, ".env.local"),
          "NEXT_PUBLIC_SUPABASE_URL=https://fixture.invalid\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=public-fixture-only\n",
        );
        writeFileSync(
          join(root, "scripts", "seed-users.mjs"),
          `
        import { writeFileSync } from 'node:fs';
        const e = process.env;
        if (e.NEXT_PUBLIC_SUPABASE_URL !== 'https://fixture.invalid' ||
            e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== 'public-fixture-only' ||
            e.CONFIRM_SUPABASE_PROJECT_URL !== e.NEXT_PUBLIC_SUPABASE_URL ||
            e.ALLOW_DEVELOPMENT_SEED !== 'yes' ||
            e.SUPABASE_SECRET_KEY !== 'fixture-only-not-a-key' ||
            e.SEED_PASSWORD !== 'fixture-only-not-a-password') process.exit(18);
        writeFileSync('seed-executed.txt', 'local fixture reached');
        console.log(e.SUPABASE_SECRET_KEY);
        if (e.H1_FIXTURE_FAIL === 'yes') {
          console.error(e.SEED_PASSWORD);
          process.exit(69);
        }
      `,
        );
        writeFileSync(
          join(root, "driver.ps1"),
          `
        $ErrorActionPreference = 'Stop'
        $script:publicPrompt = 0
        $script:privatePrompt = 0
        function Read-Host {
          param([string]$Prompt, [switch]$AsSecureString)
          if ($AsSecureString) {
            $script:privatePrompt++
            $value = if ($script:privatePrompt -eq 1) { 'fixture-only-not-a-key' } else { 'fixture-only-not-a-password' }
            $secure = [System.Security.SecureString]::new()
            foreach ($character in $value.ToCharArray()) { $secure.AppendChar($character) }
            $secure.MakeReadOnly()
            return $secure
          }
          $script:publicPrompt++
          if ($script:publicPrompt -eq 1) { return 'https://fixture.invalid' }
          return '202609070001,202609080001'
        }
        $failed = $false
        try { . (Join-Path $PSScriptRoot 'scripts/h1-manual.ps1') -Phase Seed }
        catch { $failed = $true; Write-Output $_.Exception.Message }
        foreach ($name in @('SUPABASE_SECRET_KEY','SEED_PASSWORD','ALLOW_DEVELOPMENT_SEED','CONFIRM_SUPABASE_PROJECT_URL')) {
          if ([Environment]::GetEnvironmentVariable($name, 'Process')) { exit 91 }
        }
        if ($env:NODE_OPTIONS -ne '--no-warnings') { exit 92 }
        if ($failed -ne ($env:H1_FIXTURE_FAIL -eq 'yes')) { exit 93 }
        Write-Output 'WRAPPER_FIXTURE_PASS'
      `,
        );
        const env = {
          ...process.env,
          NODE_OPTIONS: "--no-warnings",
          H1_FIXTURE_FAIL: failure ? "yes" : "no",
        };
        for (const name of [
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_SECRET_KEY",
          "SEED_PASSWORD",
          "ALLOW_DEVELOPMENT_SEED",
          "CONFIRM_SUPABASE_PROJECT_URL",
        ])
          delete env[name as keyof typeof env];
        const result = spawnSync(
          "powershell.exe",
          // Allow locally generated scripts only in this test child process.
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "RemoteSigned",
            "-File",
            join(root, "driver.ps1"),
          ],
          {
            cwd: root,
            env,
            encoding: "utf8",
            windowsHide: true,
            timeout: 20000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(
          result.status,
          (result.stdout + result.stderr)
            .replaceAll("fixture-only-not-a-key", "[fixture]")
            .replaceAll("fixture-only-not-a-password", "[fixture]"),
        ).toBe(0);
        expect(existsSync(join(root, "seed-executed.txt"))).toBe(true);
        const output = result.stdout + result.stderr;
        expect(output).toContain("WRAPPER_FIXTURE_PASS");
        expect(output).not.toContain("fixture-only-not-a-key");
        expect(output).not.toContain("fixture-only-not-a-password");
        if (failure) {
          expect(output).toContain("H1-SEED-69");
          expect(output).toContain("listar usuarios Auth");
          expect(output).not.toContain("quatro contas ficticias preparadas");
        } else expect(output).toContain("quatro contas ficticias preparadas");
      } finally {
        if (
          dirname(resolve(root)) !== resolve(tmpdir()) ||
          !basename(root).startsWith("c360-h1-wrapper-")
        )
          throw new Error("Unexpected fixture cleanup path");
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
