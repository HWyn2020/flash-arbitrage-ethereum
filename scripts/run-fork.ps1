# Run forked environment, deploy mocks, run arbitrage, and save logs
# Usage (PowerShell):
#   pwsh -ExecutionPolicy Bypass -File .\scripts\run-fork.ps1

param()

function Read-EnvValue($key) {
  if (Test-Path .env) {
    Get-Content .env | ForEach-Object { $_.Trim() } | Where-Object { $_ -like "$key*" } | ForEach-Object { ($_ -split '=')[1].Trim('"') } | Select-Object -First 1
  } else {
    return $null
  }
}

$rpc = Read-EnvValue 'RPC_URL'
if (-not $rpc) {
  Write-Host "No RPC_URL found in .env. Please set RPC_URL in .env or edit this script to set the RPC." -ForegroundColor Yellow
  exit 1
}

$infuraTest = $rpc
Write-Host "Using RPC: $infuraTest"

$logsDir = Join-Path -Path (Get-Location) -ChildPath 'logs'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

$runLog = Join-Path $logsDir 'fork-run-output.txt'
Remove-Item -Force -ErrorAction SilentlyContinue $runLog

Write-Host "Attempting programmatic fork and deploy (in-process)..." -ForegroundColor Cyan
$env:MAINNET_RPC_URL = $infuraTest
$cmd = "npx hardhat run scripts/fork-sim.js --network hardhat"
Write-Host "Running: $cmd"

try {
  & npx hardhat run scripts/fork-sim.js --network hardhat 2>&1 | Tee-Object -FilePath $runLog
  $exit = $LASTEXITCODE
} catch {
  $_ | Out-File -FilePath $runLog -Append
  $exit = 1
}

if ($exit -eq 0) {
  Write-Host "Programmatic fork succeeded. Output written to $runLog" -ForegroundColor Green
  Write-Host "Please paste the tx hash / totalProfits lines from the log here when ready."
  exit 0
}

Write-Host "Programmatic fork failed (HH604 or provider issue). Falling back to starting a persistent forked node." -ForegroundColor Yellow

# Try to start a persistent forked node in a new PowerShell process
$nodeLog = Join-Path $logsDir 'hardhat-node-output.txt'
if (Test-Path $nodeLog) { Remove-Item -Force $nodeLog }

$nodeCmd = "npx hardhat node --fork `"$infuraTest`""
Write-Host "Starting Hardhat node with: $nodeCmd"
Write-Host "This will open a new process. Leave that terminal open. The node output will be written to $nodeLog"

# Start the node in a separate PowerShell window
Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command \"$nodeCmd > '$nodeLog' 2>&1\"" -WindowStyle Normal

Write-Host "Waiting 3 seconds for the node to start..."
Start-Sleep -Seconds 3

Write-Host "Deploying mocks to localhost..."
try {
  npx hardhat run scripts/setup-mock.js --network localhost 2>&1 | Tee-Object -FilePath $runLog -Append
  npx hardhat run scripts/run-arb.js --network localhost 2>&1 | Tee-Object -FilePath $runLog -Append
  Write-Host "Deploy + run finished. Logs appended to $runLog" -ForegroundColor Green
} catch {
  Write-Host "Deploy/run failed. Check $nodeLog and $runLog for details." -ForegroundColor Red
}

Write-Host "If the persistent node failed to start (see $nodeLog), try a different RPC provider or run the local mock flow instead:" -ForegroundColor Yellow
Write-Host "  npx hardhat run scripts/setup-mock.js --network hardhat" -ForegroundColor Yellow
Write-Host "  npx hardhat run scripts/run-arb.js --network hardhat" -ForegroundColor Yellow

Write-Host "Done. Paste the relevant lines from $runLog (tx hash, gasUsed, effectiveGasPrice, totalProfits) and I'll compute net + USD and update the JSON report." -ForegroundColor Cyan
