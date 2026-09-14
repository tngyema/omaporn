import QtQuick
import QtQuick.Window

Window {
  id: root

  width: 800
  height: 540
  visible: true
  color: "#000000"
  flags: Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint

  property string embedUrl: root.argumentValue("--url")
  property string subtitle: root.argumentValue("--subtitle") || "Eporner"
  property bool fullscreen: false

  Component.onCompleted: {
    if (root.argumentValue("--smoke") === "1") Qt.quit()
  }

  function argumentValue(name) {
    var args = Qt.application.arguments
    for (var i = 0; i < args.length; i++) {
      if (String(args[i]).indexOf(name + "=") === 0)
        return String(args[i]).slice(name.length + 1)
    }
    var index = args.indexOf(name)
    return index >= 0 && index + 1 < args.length ? String(args[index + 1]) : ""
  }

  function setFullscreen(value) {
    root.fullscreen = value
    root.visibility = value ? Window.FullScreen : Window.Windowed
  }

  function closeViewer() {
    if (root.fullscreen) root.setFullscreen(false)
    else Qt.quit()
  }

  Shortcut {
    sequence: "F11"
    onActivated: root.setFullscreen(!root.fullscreen)
  }

  Shortcut {
    sequence: "Escape"
    onActivated: root.closeViewer()
  }

  Loader {
    id: contentLoader
    anchors {
      top: root.fullscreen ? parent.top : header.bottom
      right: parent.right
      bottom: parent.bottom
      left: parent.left
    }
    source: Qt.resolvedUrl("ViewerContent.qml")
    onLoaded: item.embedUrl = root.embedUrl
  }

  Connections {
    target: contentLoader.item
    function onFullscreenRequested(value) { root.setFullscreen(value) }
    function onCloseRequested() { root.closeViewer() }
  }

  Rectangle {
    id: header
    visible: !root.fullscreen
    height: 38
    anchors { top: parent.top; left: parent.left; right: parent.right }
    color: "#151719"

    Text {
      anchors.left: parent.left
      anchors.leftMargin: 14
      anchors.verticalCenter: parent.verticalCenter
      text: "Omaporn  /  " + root.subtitle
      color: "#cacccc"
      font.pixelSize: 13
      font.bold: true
    }

    Text {
      id: headerHint
      anchors.right: parent.right
      anchors.rightMargin: 14
      anchors.verticalCenter: parent.verticalCenter
      text: "F11 fullscreen   Esc close"
      color: "#707880"
      font.pixelSize: 11
    }

    MouseArea {
      anchors.fill: parent
      acceptedButtons: Qt.LeftButton
      onPressed: root.startSystemMove()
    }

    Rectangle {
      visible: contentLoader.item && contentLoader.item.canGoBack
      width: 48
      height: 24
      anchors.right: headerHint.left
      anchors.rightMargin: 12
      anchors.verticalCenter: parent.verticalCenter
      radius: 4
      color: "#25292d"

      Text {
        anchors.centerIn: parent
        text: "Back"
        color: "#cacccc"
        font.pixelSize: 11
      }

      MouseArea {
        anchors.fill: parent
        onClicked: contentLoader.item.goBack()
      }
    }
  }
}
