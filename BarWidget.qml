import QtQuick
import qs.Ui

BarWidget {
  id: root

  moduleName: "io.github.tngyema.omaporn"
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "18+"
    tooltipText: "Omaporn - open combined search"
    horizontalMargin: 8.75
    verticalPadding: 8.75

    onPressed: function(buttonCode) {
      if (!root.bar) return
      if (buttonCode === Qt.LeftButton)
        root.bar.run("omarchy-shell shell toggle io.github.tngyema.omaporn '{\"source\":\"both\",\"query\":\"all\"}'")
    }
  }
}
