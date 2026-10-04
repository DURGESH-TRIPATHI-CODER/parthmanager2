param([Parameter(Mandatory = $true)][string]$ExtensionRoot)

$ErrorActionPreference = 'Stop'
$extensionRoot = (Resolve-Path -LiteralPath $ExtensionRoot).Path
$bridgeSource = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\extension-adapter\manager-bridge.js')).Path
$manifestPath = Join-Path $extensionRoot 'manifest.json'
$bridgeTarget = Join-Path $extensionRoot 'background\manager-bridge.js'
$workerPath = Join-Path $extensionRoot 'background\service-worker.js'
$popupPath = Join-Path $extensionRoot 'popup\popup.html'
$readmePath = Join-Path $extensionRoot 'README.md'

foreach ($path in @($manifestPath, $bridgeTarget, $workerPath, $popupPath, $readmePath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required ParthSender file was not found: $path" }
}

$worker = Get-Content -LiteralPath $workerPath -Raw
foreach ($required in @("importScripts('manager-bridge.js')", 'ManagerBridge.status', 'ManagerBridge.canStart', 'ManagerBridge.finishRequest')) {
  if (-not $worker.Contains($required)) { throw "The existing sender worker is missing its Manager handoff hook: $required" }
}
$popup = Get-Content -LiteralPath $popupPath -Raw
if (-not $popup.Contains('manager-pairing-code') -or -not $popup.Contains('manager-connect-toggle')) {
  throw 'The existing ParthSeva Manager pairing UI is missing from the extension popup.'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) { throw 'ParthSender must use Manifest V3 for the service-worker bridge.' }
$manifest.permissions = @($manifest.permissions | Where-Object { $_ -ne 'nativeMessaging' })
$hostPermissions = @($manifest.host_permissions)
if ($hostPermissions -notcontains 'http://127.0.0.1/*') { $hostPermissions += 'http://127.0.0.1/*' }
$manifest.host_permissions = $hostPermissions
$manifest | Add-Member -NotePropertyName minimum_chrome_version -NotePropertyValue '116' -Force

$readme = Get-Content -LiteralPath $readmePath -Raw
$sectionPattern = '(?s)## ParthSeva Manager local integration\r?\n.*?(?=\r?\n---)'
$sectionReplacement = @'
## ParthSeva Manager local integration

The optional Manager bridge runs in the Manifest V3 service worker in `background/manager-bridge.js`. It validates desktop commands and queues accepted messages through ParthSender's existing sender workflow; it does not replace message sending. Pairing uses a five-minute, one-time code that identifies the Manager's runtime-selected loopback WebSocket port. The extension stores only the resulting device ID, session token, and `127.0.0.1` WebSocket URL in `chrome.storage.local`; it does not retain the pairing code.

The bridge reconnects with exponential backoff, authenticates with the saved credential, sends PING/PONG keepalives, rejects malformed or duplicate queues, reports per-message and terminal status, and stops accepting new messages after STOP or a lost connection. The server is local-only; no public endpoint or Native Messaging host is used. Chrome 116 or later is required for reliable WebSocket keepalive in a Manifest V3 service worker. The `http://127.0.0.1/*` host permission is required for the local WebSocket.

See `docs/PARTHSENDER_WEBSOCKET_PROTOCOL.md` in the ParthSeva Manager repository for protocol details. A real WhatsApp sending test requires a logged-in account and a recipient authorized for the test.
'@
$readmeMatches = [regex]::Matches($readme, $sectionPattern).Count
if ($readmeMatches -ne 1) { throw 'Could not find exactly one ParthSeva Manager documentation section.' }
$readme = [regex]::Replace($readme, $sectionPattern, $sectionReplacement, 1)

Copy-Item -LiteralPath $bridgeSource -Destination $bridgeTarget -Force
$manifestJson = $manifest | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($readmePath, $readme, [System.Text.UTF8Encoding]::new($false))

Write-Output 'ParthSender WebSocket pairing bridge, MV3 permission, and protocol documentation updated. Existing sender code was not changed.'
