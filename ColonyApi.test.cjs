const test = require("node:test")
const assert = require("node:assert/strict")
const api = require("./ColonyApi.js")

test("buildSearchUrl targets the site route with query and page", () => {
  const url = new URL(api.buildSearchUrl("http://127.0.0.1:3000/", "pornhub", "red & blue", 2))

  assert.equal(url.origin, "http://127.0.0.1:3000")
  assert.equal(url.pathname, "/pornhub/search")
  assert.equal(url.searchParams.get("query"), "red & blue")
  assert.equal(url.searchParams.get("page"), "2")
})

test("buildSearchUrl falls back to defaults for unknown site and bad input", () => {
  const url = new URL(api.buildSearchUrl("", "bogus", "", 0))

  assert.equal(url.origin, "http://127.0.0.1:3000")
  assert.equal(url.pathname, "/eporner/search")
  assert.equal(url.searchParams.get("query"), "all")
  assert.equal(url.searchParams.get("page"), "1")
})

test("supports the full source list and upstream source domains", () => {
  assert.deepEqual(api.SITES.map(site => site.id), [
    "eporner", "pornhub", "xhamster", "spankbang", "xnxx", "xvideos",
    "hentaifox", "hentaicity", "xasiat", "javhdtoday", "javtsunami",
    "javgiga", "missav"
  ])
  assert.equal(api.isSitePageUrl(api.siteById("pornhub"), "https://www.pornhub.com/view/1"), true)
  assert.equal(api.isSitePageUrl(api.siteById("spankbang"), "https://spankbang.party/1"), true)
  assert.equal(api.isSitePageUrl(api.siteById("javhdtoday"), "https://javhd.today/video/1"), true)
  assert.equal(api.isSitePageUrl(api.siteById("missav"), "https://missav.ws/en/video/1"), true)
})

test("buildSearchUrl rejects blocked queries", () => {
  assert.throws(() => api.buildSearchUrl("http://127.0.0.1:3000", "eporner", "teen", 1), /adults only/)
})

test("buildGetUrl encodes the video id", () => {
  const url = new URL(api.buildGetUrl("http://127.0.0.1:3000", "xvideos", "abc 123"))
  assert.equal(url.pathname, "/xvideos/get")
  assert.equal(url.searchParams.get("id"), "abc 123")
  assert.throws(() => api.buildGetUrl("http://127.0.0.1:3000", "xvideos", ""), /id is required/)
})

test("parseCount handles suffixed view strings", () => {
  assert.equal(api.parseCount("366"), 366)
  assert.equal(api.parseCount("1.2M views"), 1200000)
  assert.equal(api.parseCount("3.4K"), 3400)
  assert.equal(api.parseCount("None"), 0)
  assert.equal(api.parseCount(""), 0)
})

test("parseRating and parseDurationSeconds handle site formats", () => {
  assert.equal(api.parseRating("92%"), 92)
  assert.equal(api.parseRating("4.25"), 4.25)
  assert.equal(api.parseRating("None"), 0)
  assert.equal(api.parseDurationSeconds("21:02"), 1262)
  assert.equal(api.parseDurationSeconds("1:02:03"), 3723)
  assert.equal(api.parseDurationSeconds("None"), 0)
})

test("normalizeResponse maps colony rows and reports open-ended pagination", () => {
  const result = api.normalizeResponse({
    success: true,
    data: [{
      link: "https://www.pornhub.com/view_video.php?viewkey=abc123",
      id: "abc123",
      title: "Example title",
      image: "https://cdn.example.com/thumb.jpg",
      views: "1.2M views",
      duration: "21:02",
      rating: "92%"
    }]
  }, "pornhub", 2)

  assert.equal(result.videos.length, 1)
  assert.deepEqual(result.videos[0], {
    id: "abc123",
    title: "Example title",
    keywords: [],
    views: 1200000,
    rating: 92,
    durationSeconds: 1262,
    duration: "21:02",
    pageUrl: "https://www.pornhub.com/view_video.php?viewkey=abc123",
    embedUrl: "https://www.pornhub.com/view_video.php?viewkey=abc123",
    thumbnailUrl: "https://cdn.example.com/thumb.jpg"
  })
  assert.equal(result.pagination.page, 2)
  assert.equal(result.hasMore, true)
})

test("normalizeVideo resolves relative scraper links and approved embed links", () => {
  const video = api.normalizeVideo({
    link: "/en/video/example",
    video: "https://missav.ws/embed/example",
    id: "example",
    title: "Example title",
    image: "/thumb.jpg"
  }, api.siteById("missav"))

  assert.equal(video.pageUrl, "https://missav.ws/en/video/example")
  assert.equal(video.embedUrl, "https://missav.ws/embed/example")
  assert.equal(video.thumbnailUrl, "https://missav.ws/thumb.jpg")
})

test("normalizeResponse drops off-domain links and blocked content", () => {
  const result = api.normalizeResponse({
    success: true,
    data: [
      { link: "https://evil.com/watch/1", id: "1", title: "Adult example" },
      { link: "http://www.pornhub.com/watch/2", id: "2", title: "Adult example" },
      { link: "https://www.pornhub.com/watch/3", id: "3", title: "Underage example" },
      { link: "https://www.pornhub.com/watch/4", id: "4", title: "Adult example" }
    ]
  }, "pornhub", 1)

  assert.deepEqual(result.videos.map(video => video.id), ["4"])
})

test("normalizeResponse accepts a bare array and reports no more pages when empty", () => {
  const result = api.normalizeResponse([], "xnxx", 3)
  assert.deepEqual(result.videos, [])
  assert.equal(result.hasMore, false)
  assert.equal(result.pagination.page, 3)
})

test("mergeSources concatenates eporner-first and dedupes by url", () => {
  const ep = [
    { id: "a", embedUrl: "https://www.eporner.com/embed/a/", title: "A" },
    { id: "b", embedUrl: "https://www.eporner.com/embed/b/", title: "B" }
  ]
  const co = [
    { id: "b2", pageUrl: "https://www.eporner.com/embed/b/", embedUrl: "https://www.eporner.com/embed/b/", title: "B dup" },
    { id: "c", pageUrl: "https://www.pornhub.com/watch/c", embedUrl: "https://www.pornhub.com/watch/c", title: "C" }
  ]
  const merged = api.mergeSources(ep, co, "Pornhub")

  assert.deepEqual(merged.map(v => v.id), ["a", "b", "c"])
  assert.deepEqual(merged.map(v => v.sourceLabel), ["Eporner", "Eporner", "Pornhub"])
})

test("mergeSources tolerates missing and label-less input", () => {
  assert.deepEqual(api.mergeSources(null, undefined, ""), [])
  const merged = api.mergeSources([{ id: "x" }], [], "")
  assert.equal(merged[0].sourceLabel, "Eporner")
})

test("search configures a timeout and reports timeout failures", () => {
  const previous = global.XMLHttpRequest
  let request
  global.XMLHttpRequest = class FakeRequest {
    constructor() {
      request = this
      this.readyState = 0
      this.status = 0
    }
    open() {}
    send() {}
  }

  try {
    let failure = ""
    api.search("http://127.0.0.1:3000", "eporner", "all", 1, () => {}, message => { failure = message })
    assert.equal(request.timeout, api.REQUEST_TIMEOUT_MS)
    request.ontimeout()
    assert.equal(failure, "Colony request timed out")
  } finally {
    global.XMLHttpRequest = previous
  }
})
