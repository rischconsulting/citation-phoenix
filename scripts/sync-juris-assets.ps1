param(
    [string]$SourceRoot = (Join-Path $PSScriptRoot '..\jurism-zotero'),
    [string]$DestinationRoot = (Join-Path $PSScriptRoot '..'),
    [bool]$UpdateSourceCheckout = $true
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

function Update-SourceCheckout {
    param(
        [string]$RepoPath,
        [string[]]$DirsToCheck
    )

    if (-not $script:UpdateSourceCheckout) {
        return
    }

    $gitDirPath = Join-Path -Path $RepoPath -ChildPath '.git'
    if (-not (Test-Path -LiteralPath $gitDirPath)) {
        return
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        throw "git is required to update the Juris-M source checkout."
    }

    Write-Host "Updating Juris-M source checkout..." -ForegroundColor Cyan
    & $git.Source -C $RepoPath fetch --all --prune
    if ($LASTEXITCODE -ne 0) {
        throw "git fetch failed with exit code $LASTEXITCODE"
    }

    & $git.Source -C $RepoPath pull --ff-only --recurse-submodules=on-demand
    if ($LASTEXITCODE -ne 0) {
        throw "git pull failed with exit code $LASTEXITCODE"
    }

    # Keep submodule content aligned with the checked-out superproject commit.
    & $git.Source -C $RepoPath submodule update --init --recursive
    if ($LASTEXITCODE -ne 0) {
        throw "git submodule update failed with exit code $LASTEXITCODE"
    }
}

function Update-StyleModuleIndex {
    param([string]$StyleModulesRoot)

    if (-not (Test-Path -LiteralPath $StyleModulesRoot)) {
        throw "Style modules directory not found: $StyleModulesRoot"
    }

    $rootPath = (Resolve-Path -LiteralPath $StyleModulesRoot).Path
    $files = Get-ChildItem -LiteralPath $rootPath -File -Recurse -Force |
        Where-Object { $_.Extension -ieq '.csl' } |
        ForEach-Object {
            $_.FullName.Substring($rootPath.Length).TrimStart('\', '/') -replace '\\', '/'
        } |
        Sort-Object

    $payload = [ordered]@{
        files = @($files)
    } | ConvertTo-Json -Depth 3

    Set-Content -LiteralPath (Join-Path -Path $rootPath -ChildPath 'index.json') -Value $payload -Encoding utf8
    Write-Host "Rebuilt style-modules/index.json" -ForegroundColor Cyan
}

function Update-AbbrevDirectoryListing {
    param([string]$AbbrevRoot)

    if (-not (Test-Path -LiteralPath $AbbrevRoot)) {
        throw "Abbrev directory not found: $AbbrevRoot"
    }

    $rootPath = (Resolve-Path -LiteralPath $AbbrevRoot).Path
    $listingPath = Join-Path -Path $rootPath -ChildPath 'DIRECTORY_LISTING.json'
    $existingByFile = @{}

    if (Test-Path -LiteralPath $listingPath) {
        try {
            $existing = Get-Content -LiteralPath $listingPath -Raw | ConvertFrom-Json
            foreach ($item in @($existing)) {
                $filename = ([string]$item.filename).Trim()
                if (-not $filename) { continue }
                $existingByFile[$filename] = [ordered]@{
                    filename = $filename
                    name = ([string]$item.name).Trim()
                }
            }
        } catch {
            Write-Warning "Could not read existing DIRECTORY_LISTING.json; rebuilding from filenames only."
        }
    }

    $files = Get-ChildItem -LiteralPath $rootPath -File -Recurse -Force |
        ForEach-Object {
            $relative = $_.FullName.Substring($rootPath.Length).TrimStart('\', '/')
            $relative -replace '\\', '/'
        } |
        Where-Object { $_ -and ($_ -notmatch '(^|[\\/])\.') -and ($_ -ne 'DIRECTORY_LISTING.json') } |
        Sort-Object

    $entries = foreach ($file in $files) {
        $existing = $existingByFile[$file]
        [ordered]@{
            filename = $file
            name = if ($existing -and $existing.Contains('name') -and $existing['name']) { $existing['name'] } else { $file }
        }
    }

    $payload = $entries | ConvertTo-Json -Depth 4
    Set-Content -LiteralPath $listingPath -Value $payload -Encoding utf8
    Write-Host "Rebuilt juris-abbrevs/DIRECTORY_LISTING.json" -ForegroundColor Cyan
}

Update-SourceCheckout -RepoPath $sourceRoot -DirsToCheck $importDirs

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

Update-StyleModuleIndex -StyleModulesRoot (Join-Path -Path $repoRoot -ChildPath 'style-modules')
Update-AbbrevDirectoryListing -AbbrevRoot (Join-Path -Path $repoRoot -ChildPath 'juris-abbrevs')

Write-Host "Juris-M asset import complete." -ForegroundColor Green
