import QtQuick 2.15
import QtWebEngine 1.10
import "ColonyApi.js" as Colony

Item {
  id: root

  property string embedUrl: ""
  property string error: ""
  readonly property bool canGoBack: player.canGoBack

  signal fullscreenRequested(bool enabled)
  signal closeRequested()

  function urlText(value) {
    if (value === undefined || value === null) return ""
    try { return String(value.toString()) } catch (e) { return String(value) }
  }

  function isApprovedUrl(value) {
    return Colony.isApprovedHttpsUrl(root.urlText(value))
  }

  function goBack() {
    if (player.canGoBack) player.goBack()
  }

  WebEngineProfile {
    id: profile
    offTheRecord: true
    httpCacheType: WebEngineProfile.MemoryHttpCache
    persistentCookiesPolicy: WebEngineProfile.NoPersistentCookies
    persistentPermissionsPolicy: WebEngineProfile.AskEveryTime

    onDownloadRequested: function(download) { download.cancel() }
  }

  WebEngineView {
    id: player
    anchors.fill: parent
    url: root.embedUrl
    profile: profile
    focus: true
    activeFocusOnPress: true
    backgroundColor: "#000000"

    Keys.onPressed: function(event) {
      if (event.key === Qt.Key_Escape) {
        event.accepted = true
        root.closeRequested()
      } else if (event.key === Qt.Key_Left && (event.modifiers & Qt.AltModifier)) {
        event.accepted = true
        root.goBack()
      }
    }

    settings.javascriptCanOpenWindows: false
    settings.javascriptCanAccessClipboard: false
    settings.fullScreenSupportEnabled: true
    settings.screenCaptureEnabled: false

    onNavigationRequested: function(request) {
      var requestedUrl = root.urlText(request.url)
      if (requestedUrl === "about:blank" && !request.isMainFrame) {
        request.accept()
      } else if (/^https:\/\//i.test(requestedUrl)
        && (!request.isMainFrame || root.isApprovedUrl(request.url))) {
        request.accept()
      } else {
        request.reject()
      }
    }

    onFullScreenRequested: function(request) {
      if (!root.isApprovedUrl(request.origin)) {
        request.reject()
        return
      }
      root.fullscreenRequested(request.toggleOn)
      request.accept()
    }

    onFeaturePermissionRequested: function(securityOrigin, feature) {
      grantFeaturePermission(securityOrigin, feature, false)
    }

    // Provider page scripts must not be able to close the host window.
    onWindowCloseRequested: {}

    onRenderProcessTerminated: function(terminationStatus, exitCode) {
      root.error = "The embedded player stopped"
    }
  }

  Rectangle {
    anchors.fill: parent
    visible: root.error !== ""
    color: "#000000"

    Column {
      anchors.centerIn: parent
      spacing: 12

      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        textFormat: Text.PlainText
        text: root.error
        color: "white"
        font.pixelSize: 14
      }

      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        textFormat: Text.PlainText
        text: "Press Esc to close"
        color: "#707880"
        font.pixelSize: 12
      }
    }
  }
}
