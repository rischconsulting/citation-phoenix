param(
    [string]$SourceDir = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$localizationPath = Join-Path -Path $SourceDir -ChildPath 'content\localization.json'
$localeRoot = Join-Path -Path $SourceDir -ChildPath 'locale'
$localization = Get-Content -LiteralPath $localizationPath -Raw | ConvertFrom-Json

foreach ($localeProperty in $localization.locales.PSObject.Properties) {
    $localeName = [string]$localeProperty.Name
    $fields = $localeProperty.Value.fields
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('# Generated from content/localization.json by scripts/generate-schema-ftl.ps1.')

    foreach ($fieldProperty in $fields.PSObject.Properties) {
        $fieldName = [string]$fieldProperty.Name
        $messageName = $fieldName -creplace '([a-z0-9])([A-Z])', '$1-$2'
        $messageName = ($messageName -replace '[^a-zA-Z0-9-]+', '-' -replace '-+', '-').Trim('-').ToLowerInvariant()
        $label = ([string]$fieldProperty.Value) -replace '[\r\n]+', ' '
        $lines.Add("citation-phoenix-field-$messageName = $label")
    }

    $localeDirectory = Join-Path -Path $localeRoot -ChildPath $localeName
    [System.IO.Directory]::CreateDirectory($localeDirectory) | Out-Null
    $ftlPath = Join-Path -Path $localeDirectory -ChildPath 'citation-phoenix.ftl'
    $text = [string]::Join([Environment]::NewLine, $lines) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($ftlPath, $text, [System.Text.UTF8Encoding]::new($false))
}

Write-Host "Generated schema field Fluent files in $localeRoot" -ForegroundColor Cyan
