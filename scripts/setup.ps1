# Linkbeam setup for Windows 10/11 (PowerShell 5.1 or newer).
# Run from the repository root:  .\scripts\setup.ps1

$ErrorActionPreference = "Stop"

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "Checking tools..."

if (-not (Test-Command "node")) {
    Write-Host "Node.js is missing. Install Node 20 or newer (LTS) from https://nodejs.org and run this script again."
    exit 1
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
    Write-Host "Node $nodeMajor is too old. Install Node 20 or newer."
    exit 1
}

if (-not (Test-Command "git")) {
    Write-Host "Git is missing. Install it from https://git-scm.com and run this script again."
    exit 1
}

if (-not (Test-Command "pnpm")) {
    Write-Host "pnpm is missing. Installing it with Corepack..."
    corepack enable
    corepack prepare pnpm@10.28.0 --activate
}

# Keep Wrangler from sending usage data.
$env:WRANGLER_SEND_METRICS = "false"
[Environment]::SetEnvironmentVariable("WRANGLER_SEND_METRICS", "false", "User")

Write-Host "Installing dependencies..."
pnpm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running checks..."
pnpm check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done. Start the project in two terminals:"
Write-Host "  pnpm dev:api   (API on http://127.0.0.1:8787)"
Write-Host "  pnpm dev:web   (site on http://localhost:4321)"
