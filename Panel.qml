import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "EpornerApi.js" as Api
import "ColonyApi.js" as Colony

Item {
  id: root

  property var shell: null
  property var manifest: null

  property bool opened: false
  property bool ageConfirmed: false
  property string pendingQuery: "all"
  property string searchQuery: "all"
  property string selectedOrder: "latest"
  property string selectedSource: "eporner"
  property string selectedSite: "eporner"
  property string colonyBase: Colony.DEFAULT_BASE_URL
  property bool colonyHasMore: false
  property int currentPage: 1
  property int totalPages: 1
  property int totalCount: 0
  property bool searching: false
  property string error: ""
  property var videos: []
  property var activeRequests: []
  property int requestSerial: 0

  property var selectedVideo: null
  property bool viewerOpen: false
  property bool viewerDetached: false
  property bool expectedViewerStop: false

  readonly property int popupWidth: 800
  readonly property int popupHeight: 540
  readonly property string pluginId: (manifest && manifest.id) ? String(manifest.id) : "io.github.tngyema.omaporn"
  readonly property string viewerWindowPath: String(Qt.resolvedUrl("ViewerWindow.qml"))
  readonly property var targetScreen: {
    var monitor = Hyprland.focusedMonitor
    var monitorName = monitor ? String(monitor.name || "") : ""
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++) {
      if (monitorName !== "" && String(screens[i].name || "") === monitorName) return screens[i]
    }
    return screens.length > 0 ? screens[0] : null
  }

  function open(payloadJson) {
    var payload = {}
    try { payload = JSON.parse(payloadJson || "{}") || {} } catch (e) {}

    var requestedQuery = String(payload.query || "all").trim() || "all"
    root.pendingQuery = Api.isAllowedQuery(requestedQuery) ? requestedQuery : "all"
    root.searchQuery = root.pendingQuery
    root.selectedSource = "eporner"
    var requestedSource = String(payload.source || "eporner")
    if (requestedSource === "colony" || requestedSource === "both") root.selectedSource = requestedSource
    root.selectedSite = Colony.siteById(String(payload.site || "eporner")).id
    if (payload.colonyBaseUrl !== undefined)
      root.colonyBase = String(payload.colonyBaseUrl).trim() || Colony.DEFAULT_BASE_URL
    root.colonyHasMore = false
    root.opened = true
    root.error = ""
    root.videos = []
    root.totalPages = 1
    root.totalCount = 0
    root.currentPage = 1
    root.selectedVideo = null
    root.viewerOpen = false
    root.viewerDetached = false
    if (viewerProcess.running) {
      root.expectedViewerStop = true
      viewerProcess.running = false
    }
    cancelRequest()

    Qt.callLater(function() {
      searchField.text = root.pendingQuery
      colonyBaseField.text = root.colonyBase
      if (root.opened) {
        keyCatcher.forceActiveFocus()
        if (root.ageConfirmed) root.startSearch(root.pendingQuery, 1)
      }
    })
  }

  function close() {
    root.requestSerial += 1
    cancelRequest()
    if (viewerProcess.running) {
      root.expectedViewerStop = true
      viewerProcess.running = false
    }
    root.viewerDetached = false
    root.viewerOpen = false
    root.opened = false
    root.error = ""
    root.videos = []
    root.selectedVideo = null
    root.searching = false
  }

  function dismiss() {
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
    else root.close()
  }

  function cancelRequest() {
    for (var i = 0; i < root.activeRequests.length; i++) {
      var pending = root.activeRequests[i]
      if (pending && typeof pending.abort === "function") {
        try { pending.abort() } catch (e) {}
      }
    }
    root.activeRequests = []
  }

  function confirmAge() {
    root.ageConfirmed = true
    root.startSearch(root.pendingQuery, 1)
    Qt.callLater(function() {
      if (root.opened && root.ageConfirmed) searchField.forceActiveFocus()
    })
  }

  function startSearch(nextQuery, nextPage) {
    var normalizedQuery = String(nextQuery || "").trim() || "all"
    if (!Api.isAllowedQuery(normalizedQuery)) {
      root.error = "Search terms must describe adults only"
      return
    }

    root.requestSerial += 1
    var serial = root.requestSerial
    cancelRequest()
    root.searchQuery = normalizedQuery
    root.currentPage = Math.max(1, Number(nextPage) || 1)
    root.searching = true
    root.error = ""
    root.videos = []
    root.colonyHasMore = false
    searchField.text = normalizedQuery

    function onDone(result) {
      if (!root.opened || serial !== root.requestSerial) return
      root.searching = false
      root.videos = result.videos
      root.totalPages = result.pagination.totalPages
      root.totalCount = result.pagination.totalCount
      root.colonyHasMore = result.hasMore === true
    }

    function onFail(message) {
      if (!root.opened || serial !== root.requestSerial) return
      root.searching = false
      root.videos = []
      root.error = String(message || "Search failed")
    }

    function tagVideos(rows, label) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && typeof rows[i] === "object" && !rows[i].sourceLabel) rows[i].sourceLabel = label
      }
    }

    if (root.selectedSource === "both") {
      var settled = 0
      var epResult = null
      var coResult = null
      var failures = []
      var colonyLabel = Colony.siteById(root.selectedSite).label
      function settleBoth() {
        settled += 1
        if (settled < 2) return
        if (!root.opened || serial !== root.requestSerial) return
        root.searching = false
        if (epResult) {
          root.totalPages = epResult.pagination.totalPages
          root.totalCount = epResult.pagination.totalCount
        } else {
          root.totalPages = 0
          root.totalCount = 0
        }
        root.colonyHasMore = coResult ? coResult.hasMore === true : false
        root.videos = Colony.mergeSources(
          epResult ? epResult.videos : [],
          coResult ? coResult.videos : [],
          colonyLabel)
        if (failures.length === 2) {
          root.videos = []
          root.error = failures.join("   ·   ")
        } else if (failures.length === 1) {
          root.error = "Partial results (" + failures[0] + ")"
        }
      }
      root.activeRequests.push(Api.search(
        normalizedQuery,
        root.currentPage,
        root.selectedOrder,
        function(result) { epResult = result; settleBoth() },
        function(message) { failures.push("Eporner: " + message); settleBoth() }
      ))
      root.activeRequests.push(Colony.search(
        root.colonyBase,
        root.selectedSite,
        normalizedQuery,
        root.currentPage,
        function(result) { coResult = result; settleBoth() },
        function(message) { failures.push("Colony: " + message); settleBoth() }
      ))
      return
    }

    if (root.selectedSource === "colony") {
      var siteLabel = Colony.siteById(root.selectedSite).label
      root.activeRequests.push(Colony.search(
        root.colonyBase,
        root.selectedSite,
        normalizedQuery,
        root.currentPage,
        function(result) { tagVideos(result.videos, siteLabel); onDone(result) },
        onFail
      ))
    } else {
      root.activeRequests.push(Api.search(
        normalizedQuery,
        root.currentPage,
        root.selectedOrder,
        function(result) { tagVideos(result.videos, "Eporner"); onDone(result) },
        onFail
      ))
    }
  }

  function cycleOrder() {
    if (root.selectedSource === "colony") return
    var index = Api.ORDERS.indexOf(root.selectedOrder)
    root.selectedOrder = Api.ORDERS[(index + 1) % Api.ORDERS.length]
    if (root.ageConfirmed) root.startSearch(root.searchQuery, 1)
  }

  function cycleSource() {
    if (root.selectedSource === "eporner") root.selectedSource = "colony"
    else if (root.selectedSource === "colony") root.selectedSource = "both"
    else root.selectedSource = "eporner"
    if (root.ageConfirmed) root.startSearch(root.searchQuery, 1)
  }

  function sourceLabel() {
    if (root.selectedSource === "colony") return "Colony"
    if (root.selectedSource === "both") return "Both"
    return "Eporner"
  }

  function orderLabel() {
    var labels = {
      "latest": "Latest",
      "longest": "Longest",
      "shortest": "Shortest",
      "top-rated": "Top rated",
      "most-popular": "Most popular",
      "top-weekly": "Top weekly",
      "top-monthly": "Top monthly"
    }
    return labels[root.selectedOrder] || root.selectedOrder
  }

  function formatCount(value) {
    var count = Math.max(0, Number(value) || 0)
    if (count >= 1000000000) return (count / 1000000000).toFixed(1) + "B"
    if (count >= 1000000) return (count / 1000000).toFixed(1) + "M"
    if (count >= 1000) return (count / 1000).toFixed(1) + "K"
    return String(Math.floor(count))
  }

  function formatRating(value) {
    var rating = Number(value) || 0
    return rating > 5 ? Math.round(rating) + "%" : rating.toFixed(2) + "/5"
  }

  function hasNextPage() {
    if (root.searching) return false
    if (root.selectedSource === "colony") return root.colonyHasMore
    if (root.selectedSource === "both") return root.colonyHasMore || root.currentPage < root.totalPages
    return root.currentPage < root.totalPages
  }

  function selectSite(siteId) {
    root.selectedSite = Colony.siteById(siteId).id
    if (root.ageConfirmed) root.startSearch(root.searchQuery, 1)
  }

  function applyColonyBase(nextBase) {
    root.colonyBase = String(nextBase || "").trim() || Colony.DEFAULT_BASE_URL
    colonyBaseField.text = root.colonyBase
    if (root.ageConfirmed && root.selectedSource !== "eporner") root.startSearch(root.searchQuery, 1)
  }

  function openVideo(video) {
    if (!video || !video.embedUrl || viewerProcess.running) return
    if (!Api.isApprovedHttpsUrl(video.embedUrl) && !Colony.isApprovedHttpsUrl(video.embedUrl)) return
    root.selectedVideo = video
    root.viewerOpen = true
    root.viewerDetached = true
    root.expectedViewerStop = false
    root.opened = false
    viewerProcess.command = [
      "env",
      "QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu",
      "qml6",
      root.viewerWindowPath,
      "--",
      "--url=" + String(video.embedUrl),
      "--subtitle=" + root.viewerSubtitle()
    ]
    viewerProcess.running = true
  }

  function viewerSubtitle() {
    if (root.selectedSource === "eporner") return "Eporner"
    if (root.selectedSource === "colony") return "Colony  /  " + Colony.siteById(root.selectedSite).label
    return "Both  /  Eporner + " + Colony.siteById(root.selectedSite).label
  }

  function returnFromViewer(exitCode) {
    if (!root.viewerDetached) return
    root.viewerDetached = false
    root.viewerOpen = false
    root.selectedVideo = null
    root.opened = true
    if (exitCode !== 0) root.error = "The embedded viewer could not start"
  }

  function handleEscape(event) {
    if (event) event.accepted = true
    root.dismiss()
  }

  Process {
    id: viewerProcess
    command: []

    onExited: function(exitCode) {
      if (root.expectedViewerStop) {
        root.expectedViewerStop = false
        return
      }
      root.returnFromViewer(exitCode)
    }
  }

  PanelWindow {
    id: panel
    screen: root.targetScreen
    visible: root.opened
    color: "transparent"
    anchors { top: true; bottom: true; left: true; right: true }
    exclusionMode: ExclusionMode.Ignore

    WlrLayershell.namespace: "io.github.tngyema.omaporn"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: root.opened
      ? WlrKeyboardFocus.Exclusive
      : WlrKeyboardFocus.None

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: root.opened
      Keys.onEscapePressed: root.handleEscape(event)
    }

    Shortcut {
      sequence: "Escape"
      enabled: root.opened
      onActivated: root.handleEscape()
    }

    Rectangle {
      anchors.fill: parent
      color: Qt.rgba(0, 0, 0, 0.72)

      MouseArea {
        anchors.fill: parent
        onClicked: root.dismiss()
      }
    }

    BorderSurface {
      id: card
      anchors.centerIn: parent
      width: Math.min(root.popupWidth, Math.max(320, parent.width - Style.space(32)))
      height: Math.min(root.popupHeight, Math.max(260, parent.height - Style.space(32)))
      radius: Style.cornerRadius
      color: Color.popups.background
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
      padding: Style.space(14)

      MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        onClicked: {}
      }

      ColumnLayout {
        anchors.fill: parent
        anchors.leftMargin: card.contentLeftInset
        anchors.rightMargin: card.contentRightInset
        anchors.topMargin: card.contentTopInset
        anchors.bottomMargin: card.contentBottomInset
        spacing: 14

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.controlGap

          Text {
            Layout.fillWidth: true
            textFormat: Text.PlainText
            text: "Omaporn"
            color: Color.popups.text
            font.family: Style.font.family
            font.pixelSize: Style.font.title
            font.bold: true
          }

          Text {
            textFormat: Text.PlainText
            text: root.viewerSubtitle()
            color: Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }

          Button {
            text: "Close"
            onClicked: root.dismiss()
          }
        }

        StackLayout {
          Layout.fillWidth: true
          Layout.fillHeight: true
          currentIndex: root.ageConfirmed ? 1 : 0

          Item {
            ColumnLayout {
              anchors.centerIn: parent
              width: Math.min(460, parent.width - Style.space(32))
              spacing: 14

              Text {
                Layout.fillWidth: true
                textFormat: Text.PlainText
                text: "Age-restricted content"
                color: Color.popups.text
                font.family: Style.font.family
                font.pixelSize: Style.font.title
                font.bold: true
                horizontalAlignment: Text.AlignHCenter
              }

              Text {
                Layout.fillWidth: true
                textFormat: Text.PlainText
                text: "Confirm that you are 18 or older. The source sites remain responsible for their own age and access checks."
                color: Color.muted
                font.family: Style.font.family
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
              }

              Button {
                Layout.alignment: Qt.AlignHCenter
                text: "I am 18 or older"
                bordered: true
                onClicked: root.confirmAge()
              }
            }
          }

          ColumnLayout {
            spacing: Style.spacing.controlGap

            RowLayout {
              Layout.fillWidth: true
              spacing: Style.spacing.controlGap

              TextField {
                id: searchField
                Layout.fillWidth: true
                placeholderText: "Search " + root.sourceLabel()
                onAccepted: root.startSearch(text, 1)
              }

              Button {
                text: root.searching ? "Searching..." : "Search"
                enabled: !root.searching
                onClicked: root.startSearch(searchField.text, 1)
              }

              Button {
                text: root.sourceLabel()
                tooltipText: "Change search source (Eporner / Colony / Both)"
                enabled: !root.searching
                onClicked: root.cycleSource()
              }

              Button {
                text: root.orderLabel()
                tooltipText: "Change result order"
                enabled: !root.searching && root.selectedSource !== "colony"
                onClicked: root.cycleOrder()
              }
            }

            RowLayout {
              visible: root.selectedSource !== "eporner"
              Layout.fillWidth: true
              spacing: Style.spacing.controlGap

              TextField {
                id: colonyBaseField
                Layout.fillWidth: true
                placeholderText: "Colony base URL (self-hosted)"
                onAccepted: root.applyColonyBase(text)
              }

              Button {
                text: "Apply"
                enabled: !root.searching
                onClicked: root.applyColonyBase(colonyBaseField.text)
              }
            }

            Flickable {
              id: siteFlick
              visible: root.selectedSource !== "eporner"
              Layout.fillWidth: true
              Layout.preferredHeight: Style.space(34)
              clip: true
              contentWidth: siteRow.width
              contentHeight: height
              boundsBehavior: Flickable.StopAtBounds

              Row {
                id: siteRow
                width: implicitWidth
                height: siteFlick.height
                spacing: Style.spacing.controlGap

                Repeater {
                  model: Colony.SITES

                  Button {
                    required property var modelData
                    text: modelData.label
                    selected: root.selectedSite === modelData.id
                    enabled: !root.searching
                    onClicked: root.selectSite(modelData.id)
                  }
                }
              }
            }

            Flickable {
              id: categoryFlick
              visible: root.selectedSource !== "colony"
              Layout.fillWidth: true
              Layout.preferredHeight: Style.space(34)
              clip: true
              contentWidth: categoryRow.width
              contentHeight: height
              boundsBehavior: Flickable.StopAtBounds

              Row {
                id: categoryRow
                width: implicitWidth
                height: categoryFlick.height
                spacing: Style.spacing.controlGap

                Repeater {
                  model: Api.CATEGORIES

                  Button {
                    required property var modelData
                    text: modelData.label
                    selected: root.searchQuery === modelData.query
                    enabled: !root.searching
                    onClicked: root.startSearch(modelData.query, 1)
                  }
                }
              }
            }

            Text {
              visible: root.error !== ""
              Layout.fillWidth: true
              textFormat: Text.PlainText
              text: root.error
              color: Color.urgent
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
            }

            Item {
              id: resultsFrame
              Layout.fillWidth: true
              Layout.fillHeight: true

              GridView {
                id: resultGrid
                anchors.fill: parent
                clip: true
                model: root.videos
                interactive: root.videos.length > 0
                property int gridColumns: width >= Style.space(640) ? 2 : 1
                cellWidth: Math.max(260, Math.floor(width / gridColumns))
                cellHeight: Style.space(132)

                delegate: Item {
                  required property var modelData
                  property var storyboardUrls: modelData.storyboardUrls || []
                  property string previewSource: modelData.thumbnailUrl || ""
                  width: resultGrid.cellWidth - Style.space(8)
                  height: resultGrid.cellHeight - Style.space(8)

                  BorderSurface {
                    anchors.fill: parent
                    radius: Style.cornerRadius
                    color: Color.menu.selectedBackground
                    borderSpec: Border.none()

                    RowLayout {
                      anchors.fill: parent
                      anchors.margins: Style.space(8)
                      spacing: Style.spacing.controlGap

                      Rectangle {
                        Layout.preferredWidth: 156
                        Layout.fillHeight: true
                        color: Color.background
                        radius: Style.cornerRadius
                        clip: true

                        Text {
                          anchors.centerIn: parent
                          visible: preview.status !== Image.Ready
                          textFormat: Text.PlainText
                          text: preview.status === Image.Error ? "No preview" : "Loading..."
                          color: Color.muted
                          font.family: Style.font.family
                          font.pixelSize: Style.font.caption
                        }

                        Image {
                          id: preview
                          anchors.fill: parent
                          source: previewSource
                          cache: true
                          asynchronous: true
                          fillMode: Image.PreserveAspectCrop
                        }
                      }

                      ColumnLayout {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        spacing: Style.space(4)

                        Text {
                          Layout.fillWidth: true
                          textFormat: Text.PlainText
                          text: modelData.title
                          color: Color.popups.text
                          font.family: Style.font.family
                          font.pixelSize: Style.font.body
                          font.bold: true
                          elide: Text.ElideRight
                          maximumLineCount: 2
                        }

                        Text {
                          Layout.fillWidth: true
                          textFormat: Text.PlainText
                          text: (modelData.sourceLabel || "Eporner")
                            + (modelData.duration ? "  |  " + modelData.duration : "")
                            + "  |  " + root.formatCount(modelData.views) + " views  |  " + root.formatRating(modelData.rating)
                          color: Color.muted
                          font.family: Style.font.family
                          font.pixelSize: Style.font.caption
                          elide: Text.ElideRight
                        }

                        Text {
                          Layout.fillWidth: true
                          Layout.fillHeight: true
                          textFormat: Text.PlainText
                          text: modelData.keywords.slice(0, 4).join(" / ")
                          color: Color.muted
                          font.family: Style.font.family
                          font.pixelSize: Style.font.caption
                          elide: Text.ElideRight
                          maximumLineCount: 2
                          wrapMode: Text.Wrap
                        }

                        Text {
                          Layout.fillWidth: true
                          textFormat: Text.PlainText
                          text: "Open embedded viewer"
                          color: Color.accent
                          font.family: Style.font.family
                          font.pixelSize: Style.font.caption
                          font.bold: true
                        }
                      }
                    }

                    MouseArea {
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onEntered: {
                        if (storyboardUrls.length > 0)
                          previewSource = storyboardUrls[Math.floor(storyboardUrls.length / 2)]
                      }
                      onExited: previewSource = modelData.thumbnailUrl || ""
                      onPositionChanged: function(mouse) {
                        if (storyboardUrls.length < 2) return
                        var thumbnailX = mouse.x - Style.space(8)
                        var thumbnailWidth = 156
                        if (thumbnailX < 0 || thumbnailX > thumbnailWidth) return
                        var index = Math.min(storyboardUrls.length - 1,
                          Math.floor(thumbnailX / thumbnailWidth * storyboardUrls.length))
                        previewSource = storyboardUrls[index]
                      }
                      onClicked: root.openVideo(modelData)
                    }
                  }
                }
              }

              Text {
                anchors.centerIn: parent
                visible: !root.searching && root.error === "" && root.videos.length === 0
                textFormat: Text.PlainText
                text: "No results"
                color: Color.muted
                font.family: Style.font.family
                font.pixelSize: Style.font.body
              }

              Text {
                anchors.centerIn: parent
                visible: root.searching
                textFormat: Text.PlainText
                text: "Searching " + root.sourceLabel() + "..."
                color: Color.muted
                font.family: Style.font.family
                font.pixelSize: Style.font.body
              }
            }

            RowLayout {
              Layout.fillWidth: true
              spacing: Style.spacing.controlGap

              Text {
                Layout.fillWidth: true
                textFormat: Text.PlainText
                text: root.selectedSource === "colony"
                  ? ((root.videos.length > 0 || root.currentPage > 1 || root.searching)
                    ? "Page " + root.currentPage + "  |  " + Colony.siteById(root.selectedSite).label : "")
                  : (root.totalCount > 0
                    ? "Page " + root.currentPage + " of " + root.totalPages + "  |  " + root.formatCount(root.totalCount) + " total"
                      + (root.selectedSource === "both" ? "  +  Colony " + Colony.siteById(root.selectedSite).label : "")
                    : ((root.selectedSource === "both" && (root.videos.length > 0 || root.currentPage > 1 || root.searching))
                      ? "Page " + root.currentPage + "  |  Colony " + Colony.siteById(root.selectedSite).label : ""))
                color: Color.muted
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
              }

              Button {
                text: "Previous"
                enabled: !root.searching && root.currentPage > 1
                onClicked: root.startSearch(root.searchQuery, root.currentPage - 1)
              }

              Button {
                text: "Next"
                enabled: root.hasNextPage()
                onClicked: root.startSearch(root.searchQuery, root.currentPage + 1)
              }
            }
          }
        }
      }
    }
  }
}
