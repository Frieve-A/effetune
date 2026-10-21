$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$runner = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools\test-msix-installed.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($runner, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$evaluation = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-WackEvaluation' }, $true)
if ($evaluation.Count -ne 1) { throw 'Expected the installed runner WACK evaluator.' }
. ([scriptblock]::Create($evaluation[0].Extent.Text))
function Assert($condition, [string]$message) { if (-not $condition) { throw $message } }
[xml]$pass = '<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE"><REQUIREMENTS><REQUIREMENT><TEST INDEX="31" NAME="Manifest" OPTIONAL="FALSE"><MESSAGES/><RESULT>PASS</RESULT></TEST></REQUIREMENT></REQUIREMENTS></REPORT>'
$result = Get-WackEvaluation $pass
Assert ($result.accepted -and $result.status -eq 'passed' -and $result.nonPassTests.Count -eq 0) 'Normal PASS changed'
[xml]$warning = '<REPORT OVERALL_RESULT="WARNING" PARTIAL_RUN="FALSE"><REQUIREMENTS><REQUIREMENT><TEST INDEX="88" NAME="Optional test" OPTIONAL="TRUE"><MESSAGES><MESSAGE TEXT="Optional finding retained"/></MESSAGES><RESULT>FAIL</RESULT></TEST><TEST INDEX="92" NAME="Required warning" OPTIONAL="FALSE"><MESSAGES><MESSAGE TEXT="Warning retained"/></MESSAGES><RESULT>WARNING</RESULT></TEST></REQUIREMENT></REQUIREMENTS></REPORT>'
$result = Get-WackEvaluation $warning
Assert ($result.accepted -and $result.status -eq 'passed-with-warnings' -and $result.overallResult -eq 'WARNING') 'SDK warning result was misclassified'
Assert ($result.nonPassTests.Count -eq 2 -and $result.nonPassTests[0].result -eq 'FAIL' -and $result.nonPassTests[0].optional -eq 'TRUE' -and $result.nonPassTests[0].messages[0] -eq 'Optional finding retained') 'Optional failure details were hidden'
Assert ($result.nonPassTests[1].result -eq 'WARNING' -and $result.nonPassTests[1].messages[0] -eq 'Warning retained') 'Required warning details were hidden'
$requiredFail = $warning.Clone()
$requiredFail.SelectSingleNode('//TEST[@INDEX="92"]/RESULT').InnerText = 'FAIL'
Assert (-not (Get-WackEvaluation $requiredFail).accepted) 'Required FAIL accepted under overall WARNING'
foreach ($overall in @('FAIL', 'UNKNOWN', '')) {
  $invalid = $pass.Clone(); $invalid.DocumentElement.SetAttribute('OVERALL_RESULT', $overall)
  Assert (-not (Get-WackEvaluation $invalid).accepted) ('Invalid overall result accepted: ' + $overall)
}
foreach ($state in @('NOTRUN', 'UNKNOWN', '')) {
  $invalid = $pass.Clone(); $invalid.SelectSingleNode('//RESULT').InnerText = $state
  Assert (-not (Get-WackEvaluation $invalid).accepted) ('Unknown/unfinished test accepted: ' + $state)
}
$partial = $pass.Clone(); $partial.DocumentElement.SetAttribute('PARTIAL_RUN', 'TRUE')
Assert (-not (Get-WackEvaluation $partial).accepted) 'Partial report accepted'
$unknownOptional = $pass.Clone(); $unknownOptional.SelectSingleNode('//TEST').RemoveAttribute('OPTIONAL')
Assert (-not (Get-WackEvaluation $unknownOptional).accepted) 'Unknown requirement classification accepted'
[xml]$empty = '<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE"><REQUIREMENTS/></REPORT>'
Assert (-not (Get-WackEvaluation $empty).accepted) 'Empty report accepted'
Write-Output ('PASS: WACK normal pass, warnings/optional failures retained, required/unknown/incomplete rejected. PS ' + $PSVersionTable.PSVersion)
