var API_BASE = "https://www.eporner.com/api/v2/video/search/"
var DEFAULT_PAGE_SIZE = 30
var MAX_PAGE = 1000000
var REQUEST_TIMEOUT_MS = 10000

var ORDERS = [
  "top-daily",
  "top-weekly",
  "top-monthly",
  "most-popular",
  "latest",
  "longest",
  "shortest",
  "top-rated"
]

// Keep searches and displayed metadata limited to adult content.
var BLOCKED_CONTENT = /\b(?:underage|minor|child|children|kid|kids|preteen|pre-teen|teen|teens|teenager|teenage|schoolgirl|schoolboy)\b/i

var CATEGORIES = [
  { label: "All", query: "all" },
  { label: "Amateur", query: "amateur" },
  { label: "Anal", query: "anal" },
  { label: "Asian", query: "asian" },
  { label: "BDSM", query: "bdsm" },
  { label: "Blonde", query: "blonde" },
  { label: "Brunette", query: "brunette" },
  { label: "Couples", query: "couples" },
  { label: "Gay", query: "gay" },
  { label: "Lesbian", query: "lesbian" },
  { label: "MILF", query: "milf" },
  { label: "POV", query: "pov" },
  { label: "Redhead", query: "redhead" },
  { label: "Trans", query: "trans" },
  { label: "VR", query: "vr" }
]

function positiveInteger(value, fallback, maximum) {
  var parsed = Number(value)
  if (!isFinite(parsed) || parsed < 1) return fallback
  parsed = Math.floor(parsed)
  return maximum && parsed > maximum ? maximum : parsed
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function isAllowedQuery(value) {
  return !BLOCKED_CONTENT.test(cleanText(value))
}

function isApprovedHttpsUrl(value) {
  return /^https:\/\/(?:[^/]+\.)?eporner\.com(?:\/|$)/i.test(cleanText(value))
}

function gayModeForQuery(query) {
  return /\bgay\b/i.test(cleanText(query)) ? 2 : 0
}

function buildSearchUrl(query, page, order) {
  var search = cleanText(query) || "all"
  if (!isAllowedQuery(search)) throw new Error("Search terms must describe adults only")

  var selectedOrder = ORDERS.indexOf(order) !== -1 ? order : "latest"
  var selectedPage = positiveInteger(page, 1, MAX_PAGE)
  return API_BASE
    + "?query=" + encodeURIComponent(search)
    + "&per_page=" + DEFAULT_PAGE_SIZE
    + "&page=" + selectedPage
    + "&thumbsize=big"
    + "&order=" + encodeURIComponent(selectedOrder)
    + "&gay=" + gayModeForQuery(search)
    + "&lq=0"
    + "&format=json"
}

function splitKeywords(value) {
  if (Array.isArray(value)) value = value.join(",")
  var raw = cleanText(value)
  if (!raw) return []

  var result = []
  var values = raw.split(",")
  for (var i = 0; i < values.length; i++) {
    var keyword = values[i].trim()
    if (keyword && result.indexOf(keyword) === -1) result.push(keyword)
  }
  return result
}

function safeNumber(value, fallback) {
  var parsed = Number(value)
  return isFinite(parsed) ? parsed : fallback
}

function durationText(seconds, fallback) {
  var duration = positiveInteger(seconds, 0)
  if (!duration) return cleanText(fallback)
  var hours = Math.floor(duration / 3600)
  var minutes = Math.floor(duration / 60)
  var remaining = duration % 60
  if (hours > 0) {
    minutes = Math.floor((duration % 3600) / 60)
    return hours + ":" + (minutes < 10 ? "0" : "") + minutes
      + ":" + (remaining < 10 ? "0" : "") + remaining
  }
  return minutes + ":" + (remaining < 10 ? "0" : "") + remaining
}

function storyboardUrls(value) {
  if (!Array.isArray(value)) return []
  var urls = []
  for (var i = 0; i < value.length; i++) {
    var item = value[i]
    var url = cleanText(item && typeof item === "object" ? item.src : item)
    if (isApprovedHttpsUrl(url) && urls.indexOf(url) === -1) urls.push(url)
  }
  return urls
}

function normalizeVideo(raw) {
  if (!raw || typeof raw !== "object") return null

  var id = cleanText(raw.id)
  var embedUrl = cleanText(raw.embed)
  if (!id || !isApprovedHttpsUrl(embedUrl) || !/\/embed\/[^/]+\/?$/i.test(embedUrl)) return null

  var pageUrl = cleanText(raw.url)
  if (!isApprovedHttpsUrl(pageUrl)) pageUrl = embedUrl

  var thumbnailUrl = ""
  if (raw.default_thumb && isApprovedHttpsUrl(raw.default_thumb.src))
    thumbnailUrl = cleanText(raw.default_thumb.src)

  var keywords = splitKeywords(raw.keywords)
  var searchableText = [raw.title, raw.keywords, pageUrl].map(cleanText).join(" ")
  if (BLOCKED_CONTENT.test(searchableText)) return null

  return {
    id: id,
    title: cleanText(raw.title) || "Untitled video",
    keywords: keywords,
    views: Math.max(0, Math.floor(safeNumber(raw.views, 0))),
    rating: Math.max(0, safeNumber(raw.rate, 0)),
    durationSeconds: positiveInteger(raw.length_sec, 0),
    duration: durationText(raw.length_sec, raw.length_min),
    pageUrl: pageUrl,
    embedUrl: embedUrl,
    thumbnailUrl: thumbnailUrl,
    storyboardUrls: storyboardUrls(raw.thumbs)
  }
}

function normalizeResponse(payload) {
  var source = payload && typeof payload === "object" ? payload : {}
  var rawVideos = Array.isArray(source.videos) ? source.videos : []
  var videos = []

  for (var i = 0; i < rawVideos.length; i++) {
    var video = normalizeVideo(rawVideos[i])
    if (video) videos.push(video)
  }

  return {
    videos: videos,
    pagination: {
      page: positiveInteger(source.page, 1),
      totalPages: positiveInteger(source.total_pages, 1),
      totalCount: Math.max(0, Math.floor(safeNumber(source.total_count, videos.length)))
    }
  }
}

function search(query, page, order, onSuccess, onError) {
  var request = new XMLHttpRequest()
  var success = typeof onSuccess === "function" ? onSuccess : function() {}
  var failure = typeof onError === "function" ? onError : function() {}
  var settled = false

  function fail(message) {
    if (settled) return
    settled = true
    failure(message)
  }

  try {
    request.open("GET", buildSearchUrl(query, page, order))
  } catch (error) {
    failure(String(error.message || error))
    return null
  }

  request.timeout = REQUEST_TIMEOUT_MS
  request.onreadystatechange = function() {
    if (request.readyState !== 4 || settled) return
    if (request.status < 200 || request.status >= 300) {
      fail("Eporner returned HTTP " + request.status)
      return
    }

    try {
      settled = true
      success(normalizeResponse(JSON.parse(request.responseText)))
    } catch (error) {
      if (!settled) fail("Eporner returned invalid JSON")
    }
  }
  request.onerror = function() { fail("Could not reach Eporner") }
  request.ontimeout = function() { fail("Eporner request timed out") }
  request.send()
  return request
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    API_BASE: API_BASE,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    ORDERS: ORDERS,
    CATEGORIES: CATEGORIES,
    buildSearchUrl: buildSearchUrl,
    gayModeForQuery: gayModeForQuery,
    isApprovedHttpsUrl: isApprovedHttpsUrl,
    isAllowedQuery: isAllowedQuery,
    normalizeResponse: normalizeResponse,
    normalizeVideo: normalizeVideo,
    search: search
  }
}
