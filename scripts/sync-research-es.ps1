# 研究リポジトリの就活ES素材を katazuku 側へ取り込む。
#
# 流れ: 研究リポジトリ(C:\Users\okuya\research)で /es-material を回して
#   research/portfolio/es-research.md を最新化 → 本スクリプトで取り込む →
#   書類提出エージェント submit の §8 研究欄(chrome-prompts/research-es.local.md 参照)が最新になる。
#
# 取り込み先 research-es.local.md は *.local.md で gitignore 済み(個人情報・研究室の守秘を含みうる)。

$ErrorActionPreference = 'Stop'
$src = Join-Path $env:USERPROFILE 'research\research\portfolio\es-research.md'
$dst = Join-Path $PSScriptRoot '..\chrome-prompts\research-es.local.md'

if (-not (Test-Path $src)) {
    Write-Error "研究側の素材が見つからない: $src`n → 研究リポジトリで /es-material を実行して生成してください。"
    exit 1
}

Copy-Item $src $dst -Force
$lines = (Get-Content $dst | Measure-Object -Line).Lines
Write-Host "同期完了: es-research.md -> chrome-prompts/research-es.local.md ($lines 行)"
Write-Host "submit の §8 研究欄はこのファイルを参照します。"
