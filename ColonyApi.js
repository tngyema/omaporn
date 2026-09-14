// Client for a self-hosted AdultColony-API instance
// (https://github.com/Snowball-01/AdultColony-API).
// There is no usable public instance (adultcolony.site and
// adultcolonyapi.site do not resolve), so the user must run it locally:
//   docker run -p 3000:3000 snowball60/adultcolony-api:latest
// Search shape per site: GET {base}/{site}/search?query=...&page=N
//   -> { success, data: [{link,id,title,image,views,duration,rating}], source }
// Details shape: GET {base}/{site}/get?id=...
//   -> { success, data: {...}, assets: [direct mp4 urls], source }

var DEFAULT_BASE_URL = "http://127.0.0.1:3000"
var MAX_PAGE = 1000000
var REQUEST_TIMEOUT_MS = 10000

// Keep searches and displayed metadata limited to adult content.
var BLOCKED_CONTENT = /\b(?:underage|minor|child|children|kid|kids|preteen|pre-teen|teen|teens|teenager|teenage|schoolgirl|schoolboy)\b/i

// Sites exposed in the panel. `domain` doubles as the viewer allowlist for
// that site: only https pages on the site domain (or its subdomains) are
// ever loaded, and only those watch-page links survive normalization.
var SITES = [
  { id: "eporner",    label: "Eporner",     domain: "eporner.com" },
  { id: "pornhub",    label: "Pornhub",     domain: "pornhub.org" },
  { id: "xhamster",   label: "xHamster",    domain: "xhamster.com" },
  { id: "spankbang",  label: "SpankBang",   domain: "spankbang.party" },
  { id: "xnxx",       label: "XNXX",        domain: "xnxx.com" },
  { id: "xvideos",    label: "XVideos",     domain: "xvideos.com" },
  { id: "hentaifox",  label: "HentaiFox",   domain: "hentaifox.com" },
  { id: "hentaicity", label: "HentaiCity",  domain: "hentaicity.com" },
  { id: "xasiat",     label: "XAsiat",      domain: "xasiat.com" },
  { id: "javhdtoday", label: "JavHD.today", domain: "javhd.today" },
  { id: "javtsunami", label: "JavTsunami",  domain: "javtsunami.com" },
  { id: "javgiga",    label: "JavGiga",     domain: "javgiga.com" },
  { id: "missav",     label: "MissAV",      domain: "missav.ws" }
]

function siteById(siteId) {
  for (var i = 0; i < SITES.length; i++) {
    if (SITES[i].id === String(siteId)) return SITES[i]
  }
  return SITES[0]
}

function positiveInteger(value, fallback, maximum) {
  var parsed = Number(value)
  if (!isFinite(parsed) || parsed < 1) return fallback
  parsed = Math.floor(parsed)
  return maximum && parsed > maximum ? maximum : parsed
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function cleanBaseUrl(value) {
  return cleanText(value).replace(/\/+$/, "") || DEFAULT_BASE_URL
}

function isAllowedQuery(value) {
  return !BLOCKED_CONTENT.test(cleanText(value))
}

function isSitePageUrl(site, value) {
  var url = cleanText(value)
  if (!/^https:\/\//i.test(url)) return false
  var host = ""
  try {
    var withoutProto = url.replace(/^https:\/\//i, "")
    host = withoutProto.split("/")[0].toLowerCase()
  } catch (e) { return false }
  var domain = site.domain.toLowerCase()
  return host === domain || host.slice(-(domain.length + 1)) === "." + domain
}

function resolveSiteUrl(site, value) {
  var url = cleanText(value)
  if (!url || url === "None") return ""
  if (/^https:\/\//i.test(url)) return url
  if (/^\/\//.test(url)) return "https:" + url
  if (url.charAt(0) === "/") return "https://" + site.domain + url
  return ""
}

function isApprovedHttpsUrl(value) {
  var url = cleanText(value)
  if (!/^https:\/\//i.test(url)) return false
  for (var i = 0; i < SITES.length; i++) {
    if (isSitePageUrl(SITES[i], url)) return true
  }
  return false
}

function buildSearchUrl(baseUrl, siteId, query, page) {
  var site = siteById(siteId)
  var search = cleanText(query) || "all"
  if (!isAllowedQuery(search)) throw new Error("Search terms must describe adults only")
  var selectedPage = positiveInteger(page, 1, MAX_PAGE)
  return cleanBaseUrl(baseUrl)
    + "/" + site.id + "/search"
    + "?query=" + encodeURIComponent(search)
    + "&page=" + selectedPage
}

function buildGetUrl(baseUrl, siteId, id) {
  var site = siteById(siteId)
  var key = cleanText(id)
  if (!key) throw new Error("Video id is required")
  return cleanBaseUrl(baseUrl)
    + "/" + site.id + "/get"
    + "?id=" + encodeURIComponent(key)
}

function parseCount(value) {
  var raw = cleanText(value).replace(/,/g, "")
  var match = raw.match(/([\d.]+)\s*([kmb])?/i)
  if (!match) return 0
  var number = Number(match[1])
  if (!isFinite(number)) return 0
  var suffix = (match[2] || "").toLowerCase()
  if (suffix === "k") number *= 1000
  else if (suffix === "m") number *= 1000000
  else if (suffix === "b") number *= 1000000000
  return Math.max(0, Math.floor(number))
}

function parseRating(value) {
  var raw = cleanText(value).replace(/,/g, "")
  var match = raw.match(/([\d.]+)/)
  if (!match) return 0
  var number = Number(match[1])
  return isFinite(number) ? Math.max(0, number) : 0
}

function parseDurationSeconds(value) {
  var parts = cleanText(value).split(":").reverse()
  var total = 0
  var factor = 1
  for (var i = 0; i < parts.length && i < 3; i++) {
    var number = Number(parts[i])
    if (!isFinite(number) || number < 0) return 0
    total += Math.floor(number) * factor
    factor *= 60
  }
  return parts.length ? total : 0
}

function normalizeVideo(raw, site) {
  if (!raw || typeof raw !== "object") return null

  var pageUrl = resolveSiteUrl(site, raw.link)
  if (!isSitePageUrl(site, pageUrl)) return null

  var id = cleanText(raw.id) || pageUrl
  var title = cleanText(raw.title)
  if (!title || title === "None") title = "Untitled video"

  var searchableText = [raw.title, pageUrl].map(cleanText).join(" ")
  if (BLOCKED_CONTENT.test(searchableText)) return null

  var thumbnailUrl = ""
  var image = resolveSiteUrl(site, raw.image)
  if (/^https:\/\//i.test(image) && image !== "None") thumbnailUrl = image

  var embedUrl = resolveSiteUrl(site, raw.video)
  if (!isSitePageUrl(site, embedUrl)) embedUrl = pageUrl

  return {
    id: id,
    title: title,
    keywords: [],
    views: parseCount(raw.views),
    rating: parseRating(raw.rating),
    durationSeconds: parseDurationSeconds(raw.duration),
    duration: cleanText(raw.duration) === "None" ? "" : cleanText(raw.duration),
    pageUrl: pageUrl,
    embedUrl: embedUrl,
    thumbnailUrl: thumbnailUrl
  }
}

function normalizeResponse(payload, siteId, page) {
  var site = siteById(siteId)
  var source = payload && typeof payload === "object" ? payload : {}
  // AdultColony wraps rows in { success, data: [...] }; accept a bare array too.
  var rawVideos = Array.isArray(source) ? source
    : Array.isArray(source.data) ? source.data : []
  var videos = []

  for (var i = 0; i < rawVideos.length; i++) {
    var video = normalizeVideo(rawVideos[i], site)
    if (video) videos.push(video)
  }

  // Colony search responses carry no totals, so pagination is open-ended:
  // `hasMore` drives the Next button.
  return {
    videos: videos,
    pagination: {
      page: positiveInteger(page, 1),
      totalPages: 0,
      totalCount: 0
    },
    hasMore: videos.length > 0
  }
}

function search(baseUrl, siteId, query, page, onSuccess, onError) {
  var site = siteById(siteId)
  var request = new XMLHttpRequest()
  var success = typeof onSuccess === "function" ? onSuccess : function() {}
  var failure = typeof onError === "function" ? onError : function() {}
  var settled = false

  function fail(message) {
    if (settled) return
    settled = true
    failure(message)
  }

  var url = ""
  try {
    url = buildSearchUrl(baseUrl, site.id, query, page)
    request.open("GET", url)
  } catch (error) {
    failure(String(error.message || error))
    return null
  }

  request.timeout = REQUEST_TIMEOUT_MS
  request.onreadystatechange = function() {
    if (request.readyState !== 4 || settled) return
    if (request.status < 200 || request.status >= 300) {
      fail("Colony returned HTTP " + request.status)
      return
    }

    try {
      var payload = JSON.parse(request.responseText)
      if (payload && payload.success === false) {
        fail(cleanText(payload.message) || "Colony returned no results")
        return
      }
      settled = true
      success(normalizeResponse(payload, site.id, page))
    } catch (error) {
      if (!settled) fail("Colony returned invalid JSON")
    }
  }
  request.onerror = function() { fail("Could not reach Colony at " + cleanBaseUrl(baseUrl)) }
  request.ontimeout = function() { fail("Colony request timed out") }
  request.send()
  return request
}

function videoKey(video) {
  if (!video || typeof video !== "object") return ""
  return cleanText(video.embedUrl) || cleanText(video.pageUrl) || cleanText(video.id)
}

// Combined mode: Eporner-first merge with per-URL dedupe. Tags each row
// with sourceLabel so the grid can badge which API served it.
function mergeSources(epornerVideos, colonyVideos, colonyLabel) {
  var seen = {}
  var merged = []
  var lists = [
    { rows: epornerVideos, label: "Eporner" },
    { rows: colonyVideos, label: cleanText(colonyLabel) || "Colony" }
  ]
  for (var l = 0; l < lists.length; l++) {
    var rows = Array.isArray(lists[l].rows) ? lists[l].rows : []
    for (var i = 0; i < rows.length; i++) {
      var video = rows[i]
      if (!video || typeof video !== "object") continue
      var key = videoKey(video)
      if (key && seen[key]) continue
      if (key) seen[key] = true
      if (!cleanText(video.sourceLabel)) video.sourceLabel = lists[l].label
      merged.push(video)
    }
  }
  return merged
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_BASE_URL: DEFAULT_BASE_URL,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    SITES: SITES,
    siteById: siteById,
    buildSearchUrl: buildSearchUrl,
    buildGetUrl: buildGetUrl,
    isAllowedQuery: isAllowedQuery,
    isSitePageUrl: isSitePageUrl,
    isApprovedHttpsUrl: isApprovedHttpsUrl,
    parseCount: parseCount,
    parseRating: parseRating,
    parseDurationSeconds: parseDurationSeconds,
    normalizeResponse: normalizeResponse,
    normalizeVideo: normalizeVideo,
    mergeSources: mergeSources,
    search: search
  }
}
