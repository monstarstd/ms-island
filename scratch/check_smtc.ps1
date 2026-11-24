[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
$asyncOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
while ($asyncOp.Status -eq [Windows.Foundation.AsyncStatus]::Started) { Start-Sleep -Milliseconds 50 }
$mgr = $asyncOp.GetResults()
$session = $mgr.GetCurrentSession()
if ($session) {
    Write-Host ("App ID: " + $session.SourceAppUserModelId)
    $propOp = $session.TryGetMediaPropertiesAsync()
    while ($propOp.Status -eq [Windows.Foundation.AsyncStatus]::Started) { Start-Sleep -Milliseconds 50 }
    $props = $propOp.GetResults()
    Write-Host ("Title: " + $props.Title)
    Write-Host ("Artist: " + $props.Artist)
    Write-Host ("Album: " + $props.AlbumTitle)
    $timeline = $session.GetTimelineProperties()
    if ($timeline) {
        Write-Host ("Position: " + $timeline.Position.TotalSeconds + "s / " + $timeline.EndTime.TotalSeconds + "s")
    }
} else {
    Write-Host "No current media session found."
}
