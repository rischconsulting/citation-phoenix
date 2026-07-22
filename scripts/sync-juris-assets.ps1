param(
    [string]$SourceCacheRoot = (Join-Path $env:LOCALAPPDATA 'indigo-phoenix\juris-source-cache'),
    [string]$DestinationRoot = (Join-Path $PSScriptRoot '..'),
    [bool]$UpdateSourceCheckout = $true,
    # Deprecated: conflicts now always back up the local file and overwrite it with upstream.
    [bool]$PreferCanonicalGenerated = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -Path $DestinationRoot).Path
$cacheRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, $SourceCacheRoot))

$sourceRepos = @(
    [ordered]@{
        Name = 'style-modules'
        RepoUrl = 'https://github.com/Juris-M/style-modules.git'
        CheckoutPath = Join-Path $cacheRoot 'style-modules'
        SourcePath = Join-Path $cacheRoot 'style-modules'
        DestinationPath = Join-Path $repoRoot 'style-modules'
        Include = @('*.csl', 'README.md', 'LICENSE')
        PruneAll = $true
    },
    [ordered]@{
        Name = 'styles'
        RepoUrl = 'https://github.com/Juris-M/styles.git'
        CheckoutPath = Join-Path $cacheRoot 'styles'
        SourcePath = Join-Path $cacheRoot 'styles'
        DestinationPath = Join-Path $repoRoot 'styles'
        Include = @('jm-*.csl')
        PruneAll = $true
    }
)

$lrrCheckoutPath = Join-Path $cacheRoot 'legal-resource-registry'
$lrrBuildRoot = Join-Path $cacheRoot 'legal-resource-registry-build'
$lrrBuildMapRoot = Join-Path $lrrBuildRoot 'juris-maps'
$lrrBuildAbbrevRoot = Join-Path $lrrBuildRoot 'juris-abbrevs'
$mlzAbbrevCheckoutPath = Join-Path $cacheRoot 'mlz-abbreviations'
$syncReportPath = Join-Path $repoRoot 'scripts\sync-juris-assets-report.json'
$syncStartedAt = Get-Date
$syncBackupRoot = Join-Path $repoRoot ('scripts\sync-juris-assets-backup\{0}' -f $syncStartedAt.ToString('yyyyMMdd-HHmmss'))
$syncConflicts = [System.Collections.Generic.List[object]]::new()
$syncDateOnlyUpdates = [System.Collections.Generic.List[object]]::new()

function Get-GitCommand {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        throw 'git is required to sync upstream Juris-M assets.'
    }
    return $git.Source
}

function Get-NodeCommand {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw 'node is required to compile legal-resource-registry jurisdiction maps.'
    }
    return $node.Source
}

function Get-NpmCommand {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    }
    if (-not $npm) {
        throw 'npm is required to install legal-resource-registry build dependencies.'
    }
    return $npm.Source
}

function Ensure-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Ensure-GitCheckout {
    param(
        [string]$RepoUrl,
        [string]$CheckoutPath,
        [string]$Name
    )

    $git = Get-GitCommand
    $checkoutExists = Test-Path -LiteralPath $CheckoutPath
    $gitDirPath = Join-Path $CheckoutPath '.git'

    if (-not $checkoutExists) {
        if (-not $script:UpdateSourceCheckout) {
            throw "Missing cached source checkout for $Name at $CheckoutPath. Re-run with -UpdateSourceCheckout:`$true to clone it."
        }

        Ensure-Directory -Path (Split-Path -Path $CheckoutPath -Parent)
        Write-Host "Cloning $Name from $RepoUrl" -ForegroundColor Cyan
        & $git clone --depth 1 $RepoUrl $CheckoutPath
        if ($LASTEXITCODE -ne 0) {
            throw "git clone failed for $Name with exit code $LASTEXITCODE"
        }
        return
    }

    if (-not (Test-Path -LiteralPath $gitDirPath)) {
        throw "Cached source checkout for $Name is not a git repository: $CheckoutPath"
    }

    if (-not $script:UpdateSourceCheckout) {
        Write-Host "Using cached $Name checkout at $CheckoutPath" -ForegroundColor DarkGray
        return
    }

    Write-Host "Updating $Name checkout..." -ForegroundColor Cyan
    & $git -C $CheckoutPath fetch --all --prune
    if ($LASTEXITCODE -ne 0) {
        throw "git fetch failed for $Name with exit code $LASTEXITCODE"
    }

    & $git -C $CheckoutPath pull --ff-only
    if ($LASTEXITCODE -ne 0) {
        throw "git pull failed for $Name with exit code $LASTEXITCODE"
    }
}

function Get-RelativeFiles {
    param(
        [string]$RootPath,
        [string[]]$Include
    )

    if (-not (Test-Path -LiteralPath $RootPath)) {
        throw "Source path not found: $RootPath"
    }

    $root = (Resolve-Path -LiteralPath $RootPath).Path
    $files = Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object {
            $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/') -replace '\\', '/'
            foreach ($pattern in $Include) {
                if ($relative -like $pattern) {
                    return $true
                }
            }
            return $false
        }

    $relativeFiles = $files |
        Sort-Object -Property FullName -Unique |
        ForEach-Object {
            $_.FullName.Substring($root.Length).TrimStart('\', '/') -replace '\\', '/'
        } |
        Where-Object { $_ -and ($_ -notmatch '(^|[\\/])\.git([\\/]|$)') }

    return @($relativeFiles)
}

function Normalize-GeneratedDateMetadata {
    param(
        [string]$Path,
        [string]$RelativePath
    )

    $extension = [System.IO.Path]::GetExtension($RelativePath).ToLowerInvariant()
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)

    if ($extension -eq '.json') {
        return $text `
            -replace '("timestamp"\s*:\s*")[^"]*(")', '$1__SYNC_DATE__$2' `
            -replace '("version"\s*:\s*")\d{4}-\d{2}-\d{2}[^"]*(")', '$1__SYNC_DATE__$2'
    }

    if ($extension -eq '.csl') {
        return $text -replace '(<updated>)[^<]*(</updated>)', '$1__SYNC_DATE__$2'
    }

    return $text
}

function Test-OnlyGeneratedDateMetadataChanged {
    param(
        [string]$SourcePath,
        [string]$DestinationPath,
        [string]$RelativePath
    )

    $extension = [System.IO.Path]::GetExtension($RelativePath).ToLowerInvariant()
    if ($extension -ne '.json' -and $extension -ne '.csl') {
        return $false
    }

    try {
        $sourceNormalized = Normalize-GeneratedDateMetadata -Path $SourcePath -RelativePath $RelativePath
        $destinationNormalized = Normalize-GeneratedDateMetadata -Path $DestinationPath -RelativePath $RelativePath
        return $sourceNormalized -eq $destinationNormalized
    } catch {
        return $false
    }
}

function Sync-ManagedFiles {
    param(
        [string]$Label,
        [string]$SourcePath,
        [string]$DestinationPath,
        [string[]]$Include
    )

    Ensure-Directory -Path $DestinationPath
    $sourceRoot = (Resolve-Path -LiteralPath $SourcePath).Path
    $targetRoot = (Resolve-Path -LiteralPath $DestinationPath).Path

    $relativeFiles = Get-RelativeFiles -RootPath $sourceRoot -Include $Include
    if (-not $relativeFiles) {
        throw "No matching files found for $Label in $sourceRoot"
    }

    $managed = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($relative in $relativeFiles) {
        [void]$managed.Add($relative)

        $fromPath = Join-Path $sourceRoot $relative
        $toPath = Join-Path $targetRoot $relative
        $toDir = Split-Path -Path $toPath -Parent
        Ensure-Directory -Path $toDir

        if (-not (Test-Path -LiteralPath $toPath)) {
            Copy-Item -LiteralPath $fromPath -Destination $toPath -Force
            Write-Host "Imported $Label/$relative" -ForegroundColor Cyan
            continue
        }

        $sourceHash = (Get-FileHash -LiteralPath $fromPath -Algorithm SHA256).Hash
        $destinationHash = (Get-FileHash -LiteralPath $toPath -Algorithm SHA256).Hash
        if ($sourceHash -eq $destinationHash) {
            Write-Host "Unchanged $Label/$relative" -ForegroundColor DarkGray
            continue
        }

        if (Test-OnlyGeneratedDateMetadataChanged -SourcePath $fromPath -DestinationPath $toPath -RelativePath $relative) {
            Copy-Item -LiteralPath $fromPath -Destination $toPath -Force
            $script:syncDateOnlyUpdates.Add([ordered]@{
                label = $Label
                relativePath = $relative
                resolution = 'date-metadata-only'
                destinationPath = $toPath
                sourcePath = $fromPath
            }) | Out-Null
            Write-Host "Updated generated date metadata only for $Label/$relative" -ForegroundColor DarkGray
            continue
        }

        $backupPath = Join-Path $syncBackupRoot $Label
        $backupPath = Join-Path $backupPath $relative
        $backupDir = Split-Path -Path $backupPath -Parent
        Ensure-Directory -Path $backupDir
        Copy-Item -LiteralPath $toPath -Destination $backupPath -Force
        Copy-Item -LiteralPath $fromPath -Destination $toPath -Force

        $script:syncConflicts.Add([ordered]@{
            label = $Label
            relativePath = $relative
            resolution = 'replaced-with-upstream'
            destinationPath = $toPath
            sourcePath = $fromPath
            backupPath = $backupPath
        }) | Out-Null
        Write-Warning "Replaced existing $Label/$relative with upstream version; backup saved to $backupPath"
    }
}

function Write-SyncReport {
    if ($script:syncConflicts.Count -eq 0) {
        $payload = [ordered]@{
            generatedAt = (Get-Date).ToString('o')
            overwriteLocalOnConflict = $true
            backupRoot = $syncBackupRoot
            summary = [ordered]@{
                preservedLocal = 0
                replacedWithUpstream = 0
                dateMetadataOnly = $script:syncDateOnlyUpdates.Count
                total = 0
            }
            dateMetadataOnly = @($script:syncDateOnlyUpdates)
            conflicts = @()
        } | ConvertTo-Json -Depth 5

        Set-Content -LiteralPath $syncReportPath -Value $payload -Encoding utf8
        return
    }

    $preservedCount = 0
    $replacedCount = @($script:syncConflicts | Where-Object { $_.resolution -eq 'replaced-with-upstream' }).Count

    $payload = [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        overwriteLocalOnConflict = $true
        backupRoot = $syncBackupRoot
        summary = [ordered]@{
            preservedLocal = $preservedCount
            replacedWithUpstream = $replacedCount
            dateMetadataOnly = $script:syncDateOnlyUpdates.Count
            total = $script:syncConflicts.Count
        }
        dateMetadataOnly = @($script:syncDateOnlyUpdates)
        conflicts = @($script:syncConflicts)
    } | ConvertTo-Json -Depth 5

    Set-Content -LiteralPath $syncReportPath -Value $payload -Encoding utf8
    Write-Warning "Recorded $($script:syncConflicts.Count) upstream differences ($replacedCount replaced, $preservedCount preserved). Continuing; see $syncReportPath"
}

function Build-LegalResourceRegistryOutputs {
    $node = Get-NodeCommand
    $npm = Get-NpmCommand

    Ensure-GitCheckout -RepoUrl 'https://github.com/Juris-M/legal-resource-registry.git' -CheckoutPath $lrrCheckoutPath -Name 'legal-resource-registry'

    Ensure-Directory -Path $lrrBuildRoot
    Ensure-Directory -Path $lrrBuildMapRoot
    Ensure-Directory -Path $lrrBuildAbbrevRoot

    $nodeModulesPath = Join-Path $lrrCheckoutPath 'node_modules'
    if ($script:UpdateSourceCheckout -or -not (Test-Path -LiteralPath $nodeModulesPath)) {
        Write-Host 'Installing legal-resource-registry build dependencies...' -ForegroundColor Cyan
        Push-Location $lrrCheckoutPath
        try {
            & $npm install --no-audit --no-fund
        } finally {
            Pop-Location
        }
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed for legal-resource-registry with exit code $LASTEXITCODE"
        }
    }

    $jurisUpdateHome = Join-Path $lrrBuildRoot '.jurisUpdate-home'
    Ensure-Directory -Path $jurisUpdateHome

    $jurisUpdateConfigPath = Join-Path $jurisUpdateHome '.jurisUpdate'
    $config = [ordered]@{
        path = [ordered]@{
            jurisSrcDir = (Join-Path $lrrCheckoutPath 'src')
            jurisMapDir = $lrrBuildMapRoot
            jurisAbbrevsDir = $lrrBuildAbbrevRoot
        }
    } | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($jurisUpdateConfigPath, $config, [System.Text.UTF8Encoding]::new($false))

    Write-Host 'Compiling legal-resource-registry maps...' -ForegroundColor Cyan
    $originalUserProfile = $env:USERPROFILE
    $originalHome = $env:HOME
    Push-Location $lrrCheckoutPath
    try {
        $env:USERPROFILE = $jurisUpdateHome
        $env:HOME = $jurisUpdateHome
        & $node .\scripts\index.js -a
        if ($LASTEXITCODE -ne 0) {
            throw "legal-resource-registry compilation failed with exit code $LASTEXITCODE"
        }
    } finally {
        $env:USERPROFILE = $originalUserProfile
        $env:HOME = $originalHome
        Pop-Location
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
    Write-Host 'Rebuilt style-modules/index.json' -ForegroundColor Cyan
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
            $existing = Get-Content -LiteralPath $listingPath -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($item in @($existing)) {
                $filename = ([string]$item.filename).Trim()
                if (-not $filename) { continue }
                $existingByFile[$filename] = [ordered]@{
                    filename = $filename
                    name = ([string]$item.name).Trim()
                }
            }
        } catch {
            Write-Warning 'Could not read existing DIRECTORY_LISTING.json; rebuilding from filenames only.'
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
    [System.IO.File]::WriteAllText($listingPath, $payload + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Rebuilt juris-abbrevs/DIRECTORY_LISTING.json' -ForegroundColor Cyan
}

function Format-DatasetLabel {
    param([string]$Dataset)

    $value = [string]$Dataset
    if ([string]::IsNullOrWhiteSpace($value)) {
        return ''
    }

    $value = $value -replace '^juris-', ''
    $value = $value -replace '-map$', ''
    $value = $value -replace '-', ' '
    return [System.Globalization.CultureInfo]::InvariantCulture.TextInfo.ToTitleCase($value)
}

function Get-MapDisplayName {
    param(
        [string]$FilePath,
        [string]$FallbackName
    )

    try {
        $data = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $name = [string]$data.name
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            return $name.Trim()
        }

        $jurisdictions = @($data.jurisdictions.default)
        foreach ($item in $jurisdictions) {
            $row = @($item)
            if ($row.Count -lt 2) {
                continue
            }

            $label = [string]$row[1]
            if (-not [string]::IsNullOrWhiteSpace($label)) {
                return $label.Trim()
            }
        }
    } catch {
        # Fall through to the filename-based fallback.
    }

    return $FallbackName
}

function Update-JurisMapDirectoryListing {
    param([string]$MapRoot)

    if (-not (Test-Path -LiteralPath $MapRoot)) {
        throw "Map directory not found: $MapRoot"
    }

    $rootPath = (Resolve-Path -LiteralPath $MapRoot).Path
    $listingPath = Join-Path -Path $rootPath -ChildPath 'DIRECTORY_LISTING.json'
    $existingByFile = @{}

    if (Test-Path -LiteralPath $listingPath) {
        try {
            $existing = Get-Content -LiteralPath $listingPath -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($item in @($existing)) {
                $filename = ([string]$item.filename).Trim()
                if (-not $filename) { continue }
                $existingByFile[$filename] = [ordered]@{
                    filename = $filename
                    name = ([string]$item.name).Trim()
                }
            }
        } catch {
            Write-Warning 'Could not read existing juris-maps DIRECTORY_LISTING.json; rebuilding from files.'
        }
    }

    $files = Get-ChildItem -LiteralPath $rootPath -File -Recurse -Force |
        ForEach-Object {
            $relative = $_.FullName.Substring($rootPath.Length).TrimStart('\', '/')
            $relative -replace '\\', '/'
        } |
        Where-Object { $_ -and ($_ -notmatch '(^|[\\/])\.') -and ($_ -match '^juris-.*-map\.json$') } |
        Sort-Object

    $entries = foreach ($file in $files) {
        $existing = $existingByFile[$file]
        $dataset = ([System.IO.Path]::GetFileNameWithoutExtension($file) -replace '^juris-', '' -replace '-map$', '')
        $fallbackName = Format-DatasetLabel -Dataset $dataset
        [ordered]@{
            filename = $file
            name = if ($existing -and $existing.Contains('name') -and $existing['name']) {
                $existing['name']
            } else {
                Get-MapDisplayName -FilePath (Join-Path -Path $rootPath -ChildPath $file) -FallbackName $fallbackName
            }
        }
    }

    $payload = $entries | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($listingPath, $payload + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Rebuilt juris-maps/DIRECTORY_LISTING.json' -ForegroundColor Cyan
}

Ensure-Directory -Path $cacheRoot

foreach ($sourceRepo in $sourceRepos) {
    Ensure-GitCheckout -RepoUrl $sourceRepo.RepoUrl -CheckoutPath $sourceRepo.CheckoutPath -Name $sourceRepo.Name
    Sync-ManagedFiles -Label $sourceRepo.Name -SourcePath $sourceRepo.SourcePath -DestinationPath $sourceRepo.DestinationPath -Include $sourceRepo.Include
}

Build-LegalResourceRegistryOutputs
Sync-ManagedFiles -Label 'juris-maps' -SourcePath $lrrBuildMapRoot -DestinationPath (Join-Path $repoRoot 'juris-maps') -Include @('juris-*-map.json', 'versions.json')
Sync-ManagedFiles -Label 'juris-abbrevs-auto' -SourcePath $lrrBuildAbbrevRoot -DestinationPath (Join-Path $repoRoot 'juris-abbrevs') -Include @('auto-*.json')

Ensure-GitCheckout -RepoUrl 'https://github.com/fbennett/mlz-abbreviations.git' -CheckoutPath $mlzAbbrevCheckoutPath -Name 'mlz-abbreviations'
Sync-ManagedFiles -Label 'juris-abbrevs-static' -SourcePath $mlzAbbrevCheckoutPath -DestinationPath (Join-Path $repoRoot 'juris-abbrevs') -Include @('secondary-*.json', 'abbreviations-empty.json', 'README.md', 'LICENSE')

Update-StyleModuleIndex -StyleModulesRoot (Join-Path -Path $repoRoot -ChildPath 'style-modules')
Update-AbbrevDirectoryListing -AbbrevRoot (Join-Path -Path $repoRoot -ChildPath 'juris-abbrevs')
Update-JurisMapDirectoryListing -MapRoot (Join-Path -Path $repoRoot -ChildPath 'juris-maps')
Write-SyncReport

Write-Host 'Juris-M asset sync complete.' -ForegroundColor Green
