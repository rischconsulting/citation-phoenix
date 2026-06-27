param(
    [string]$SourceRoot = (Join-Path $PSScriptRoot '..\jurism-zotero'),
    [string]$DestinationRoot = (Join-Path $PSScriptRoot '..'),
    [bool]$InitializeSourceSubmodules = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -Path $DestinationRoot).Path
if (-not (Test-Path -LiteralPath $SourceRoot)) {
    throw "Source root not found: $SourceRoot"
}

$sourceRoot = (Resolve-Path -Path $SourceRoot).Path
$importDirs = @('style-modules', 'juris-abbrevs', 'juris-maps')

function Test-DirectoryHasFiles {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }

    return $null -ne (Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Initialize-SourceSubmodulesIfNeeded {
    param(
        [string]$RepoPath,
        [string[]]$DirsToCheck
    )

    if (-not $InitializeSourceSubmodules) {
        return
    }

    $gitmodulesPath = Join-Path -Path $RepoPath -ChildPath '.gitmodules'
    if (-not (Test-Path -LiteralPath $gitmodulesPath)) {
        return
    }

    $needsInit = $false
    foreach ($dir in $DirsToCheck) {
        $candidate = Join-Path -Path $RepoPath -ChildPath $dir
        if (-not (Test-DirectoryHasFiles -Path $candidate)) {
            $needsInit = $true
            break
        }
    }

    if (-not $needsInit) {
        return
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        throw "git is required to initialize the Juris-M source submodules."
    }

    Write-Host "Initializing Juris-M source submodules..." -ForegroundColor Cyan
    & $git.Source -C $RepoPath submodule update --init --recursive
    if ($LASTEXITCODE -ne 0) {
        throw "git submodule update failed with exit code $LASTEXITCODE"
    }
}

Initialize-SourceSubmodulesIfNeeded -RepoPath $sourceRoot -DirsToCheck $importDirs

foreach ($importDir in $importDirs) {
    $sourceDir = Join-Path -Path $sourceRoot -ChildPath $importDir
    if (-not (Test-Path -LiteralPath $sourceDir)) {
        Write-Warning "Skipping missing source directory: $importDir"
        continue
    }

    $files = Get-ChildItem -LiteralPath $sourceDir -File -Recurse -Force
    if (-not $files) {
        Write-Warning "No files found in source directory: $importDir"
        continue
    }

    foreach ($file in $files) {
        $relative = $file.FullName.Substring($sourceDir.Length).TrimStart('\', '/')
        if ($relative -match '(^|[\\/])\.') {
            continue
        }
        $destinationPath = Join-Path -Path $repoRoot -ChildPath (Join-Path $importDir $relative)

        if ([System.IO.Path]::GetFullPath($file.FullName) -ieq [System.IO.Path]::GetFullPath($destinationPath)) {
            Write-Host "Already in place: $(Join-Path $importDir $relative)" -ForegroundColor DarkGray
            continue
        }

        $destinationDir = Split-Path -Path $destinationPath -Parent
        if (-not (Test-Path -LiteralPath $destinationDir)) {
            New-Item -ItemType Directory -Path $destinationDir | Out-Null
        }

        Copy-Item -LiteralPath $file.FullName -Destination $destinationPath -Force
        Write-Host "Imported $(Join-Path $importDir $relative)" -ForegroundColor Cyan
    }
}

Write-Host "Juris-M asset import complete." -ForegroundColor Green
