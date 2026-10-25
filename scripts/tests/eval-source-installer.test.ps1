$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'install-stockfish-remote-server.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Installer has parse errors'}
$tables=$ast.FindAll({param($node) $node -is [Management.Automation.Language.HashtableAst]},$true)
$matches=@($tables | ForEach-Object {$_.KeyValuePairs | Where-Object {$_.Item1.Extent.Text -eq 'localEvalPath'}})
if($matches.Count -ne 1){throw 'Expected one production evaluation path field'}
$expression=[scriptblock]::Create($matches[0].Item2.Extent.Text)
$cases=@(
 @{value=$null;expected=$null},
 @{value=[pscustomobject]@{};expected=$null},
 @{value=[pscustomobject]@{localEvalPath='C:Fixturechosen'};expected='C:Fixturechosen'},
 @{value=[pscustomobject]@{localEvalPath='C:Fixturelegacylichess-cloud-evals'};expected='C:Fixturelegacylichess-cloud-evals'}
)
foreach($case in $cases){
 $existingConfig=$case.value
 $actual=& $expression
 if($actual -ne $case.expected){throw 'The production installer field changed an existing source or pinned a new default'}
}
Write-Output '4 production installer-source expression cases passed; installer/tasks/services were not run.'
