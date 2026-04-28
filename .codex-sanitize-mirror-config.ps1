$redactedValue = "__REDACTED__"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )

    [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath $Path), $Content, $utf8NoBom)
}

function Sanitize-JsonConfig {
    param(
        [string]$Path
    )

    try {
        $json = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return
    }

    $changed = $false

    foreach ($property in @($json.PSObject.Properties)) {
        if ($property.Name -match '(?i)(token|key)$' -and $property.Value -is [string] -and $property.Value -ne $redactedValue) {
            $json.PSObject.Properties[$property.Name].Value = $redactedValue
            $changed = $true
        }
    }

    if (-not $changed) {
        return
    }

    $content = ($json | ConvertTo-Json -Depth 100) + [Environment]::NewLine
    Write-Utf8NoBom -Path $Path -Content $content
}

function Sanitize-EnvLikeFile {
    param(
        [string]$Path
    )

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $updated = [System.Text.RegularExpressions.Regex]::Replace(
        $raw,
        '(?im)^(\s*[A-Za-z0-9_]*(TOKEN|KEY)[A-Za-z0-9_]*\s*=\s*).*$',
        "`$1$redactedValue"
    )

    if ($updated -ceq $raw) {
        return
    }

    Write-Utf8NoBom -Path $Path -Content $updated
}

$files = Get-ChildItem -Recurse -File -Force

foreach ($file in $files) {
    if ($file.Name -ieq "config.json") {
        Sanitize-JsonConfig -Path $file.FullName
        continue
    }

    if (
        $file.Name -like ".env*" -or
        $file.Name -like "env*" -or
        $file.Name -like "*env*.txt"
    ) {
        Sanitize-EnvLikeFile -Path $file.FullName
    }
}
