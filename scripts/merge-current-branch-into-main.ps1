param(
    [string]$MainBranch = 'main',
    [switch]$Push
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
try {
    $statusLines = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "git status --porcelain failed with exit code $LASTEXITCODE"
    }

    if ($statusLines.Count -gt 0) {
        throw "Working tree is not clean. Commit or stash changes before merging into $MainBranch."
    }

    $currentBranch = (git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "git branch --show-current failed with exit code $LASTEXITCODE"
    }

    if (-not $currentBranch) {
        throw 'Could not determine the current branch.'
    }

    if ($currentBranch -eq $MainBranch) {
        throw "You are already on $MainBranch. Check out the source branch first."
    }

    Write-Host "Merging $currentBranch into $MainBranch" -ForegroundColor Cyan

    Invoke-Git -Arguments @('checkout', $MainBranch)
    Invoke-Git -Arguments @('pull', '--ff-only')
    Invoke-Git -Arguments @('merge', '--no-ff', $currentBranch)

    if ($Push) {
        Invoke-Git -Arguments @('push')
    }

    Write-Host "Merge complete: $currentBranch -> $MainBranch" -ForegroundColor Green
    if ($Push) {
        Write-Host "Pushed $MainBranch to its remote." -ForegroundColor Green
    }
}
finally {
    Pop-Location
}
