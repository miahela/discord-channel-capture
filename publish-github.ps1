param(
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]*$')]
    [string]$RepositoryName = 'discord-channel-capture',
    [ValidateSet('public', 'private')]
    [string]$Visibility = 'public'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath $PSScriptRoot

function Invoke-CaptureCommand {
    param([string]$Command, [string[]]$CommandArguments)
    & $Command @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed. No later publish steps were run. Fix the reported error, then rerun this script."
    }
}

foreach ($captureCommand in @('git', 'gh', 'node')) {
    if (-not (Get-Command $captureCommand -ErrorAction SilentlyContinue)) {
        throw "$captureCommand is required. Install it, then rerun this script."
    }
}

# Check a shared/sandbox-created repository before signing in or building files.
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.git')) {
    $captureRepositoryCheck = @(& git rev-parse --show-toplevel 2>&1)
    if ($LASTEXITCODE -ne 0) {
        $captureRepositoryError = $captureRepositoryCheck -join [Environment]::NewLine
        if ($captureRepositoryError -match 'dubious ownership') {
            $captureSafePath = $PSScriptRoot.Replace('\', '/')
            throw @"
Git blocked this repository because it is owned by another Windows account.
Run this once in your own PowerShell to trust only this project, then rerun the publish script:
git config --global --add safe.directory "$captureSafePath"
"@
        }
        throw "Could not access this Git repository. No commit or push was made.`n$captureRepositoryError"
    }
}

$captureUserJson = & gh api user 2>$null
if ($LASTEXITCODE -ne 0) {
    Invoke-CaptureCommand 'gh' @('auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web')
    $captureUserJson = & gh api user
    if ($LASTEXITCODE -ne 0) { throw 'GitHub sign-in could not be verified. Nothing was published.' }
}
$captureUser = $captureUserJson | ConvertFrom-Json
if (-not $captureUser.login -or -not $captureUser.id) { throw 'GitHub did not return an account identity.' }
$captureRepository = "$($captureUser.login)/$RepositoryName"
$captureExpectedRemote = "https://github.com/$captureRepository.git"

Invoke-CaptureCommand 'node' @('build-setup.cjs')
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.git'))) {
    Invoke-CaptureCommand 'git' @('init', '-b', 'main')
}
$captureBranch = & git branch --show-current
if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect the Git branch. See the Git error above. No commit or push was made.'
}
if ($captureBranch -ne 'main') {
    throw 'Expected the main branch in this project. No commit or push was made.'
}
$captureRemote = & git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0) {
    $captureAllowedRemotes = @($captureExpectedRemote, "https://github.com/$captureRepository", "git@github.com:$captureRepository.git")
    if ($captureRemote -notin $captureAllowedRemotes) { throw 'Origin points to another repository. No commit or push was made.' }
} else {
    $captureRemote = $null
}

# Use a GitHub noreply address only in this project, leaving global Git identity alone.
Invoke-CaptureCommand 'git' @('config', '--local', 'user.name', $captureUser.login)
Invoke-CaptureCommand 'git' @('config', '--local', 'user.email', "$($captureUser.id)+$($captureUser.login)@users.noreply.github.com")

# Stage only the project files, never arbitrary captures or other local files.
$captureFiles = @(
    '.gitattributes', '.gitignore', '.github/workflows/check.yml',
    'README.md', 'LICENSE', 'package.json', 'package-lock.json',
    'capture.js', 'build-setup.cjs', 'setup.html', 'verify.cjs',
    'docs/demo.html', 'docs/screenshot.png', 'publish-github.ps1'
)
Invoke-CaptureCommand 'git' (@('add', '--') + $captureFiles)
$captureStaged = @(& git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect staged files. Nothing was published.' }
if (@($captureStaged | Where-Object { $_ -notin $captureFiles }).Count -gt 0) {
    throw 'Other files are already staged. Unstage them before publishing this project.'
}
Invoke-CaptureCommand 'git' @('diff', '--cached', '--check')
if ($captureStaged.Count -gt 0) {
    Invoke-CaptureCommand 'git' @('commit', '-m', 'Add Discord chat capture bookmarklet')
}

Invoke-CaptureCommand 'gh' @('auth', 'setup-git', '--hostname', 'github.com')
if ($captureRemote) {
    # This also makes a retry safe if repository creation worked but its first push failed.
    Invoke-CaptureCommand 'git' @('push', '--set-upstream', 'origin', 'main')
} else {
    Invoke-CaptureCommand 'gh' @('repo', 'create', $captureRepository, "--$Visibility", '--source', '.', '--remote', 'origin', '--push')
}
Invoke-CaptureCommand 'gh' @(
    'repo', 'edit', $captureRepository,
    '--description', 'A local browser bookmarklet that saves Discord channels, DMs, and group DMs as TXT or JSON.',
    '--add-topic', 'discord', '--add-topic', 'bookmarklet', '--add-topic', 'javascript',
    '--add-topic', 'browser-automation', '--add-topic', 'chat-export'
)
Write-Host "Published: https://github.com/$captureRepository"
