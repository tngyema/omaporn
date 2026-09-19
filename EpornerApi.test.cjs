const test = require("node:test")
const assert = require("node:assert/strict")
const api = require("./EpornerApi.js")

test("buildSearchUrl encodes the query and uses the JSON search defaults", () => {
  const url = new URL(api.buildSearchUrl("red & blue", 2, "top-rated"))

  assert.equal(url.origin + url.pathname, "https://www.eporner.com/api/v2/video/search/")
  assert.equal(url.searchParams.get("query"), "red & blue")
  assert.equal(url.searchParams.get("page"), "2")
  assert.equal(url.searchParams.get("order"), "top-rated")
  assert.equal(url.searchParams.get("format"), "json")
  assert.equal(url.searchParams.get("thumbsize"), "big")
})

test("buildSearchUrl keeps ordinary searches straight and gay category strict", () => {
  const ordinary = new URL(api.buildSearchUrl("amateur", 1, "latest"))
  const gay = new URL(api.buildSearchUrl("gay", 1, "latest"))

  assert.equal(ordinary.searchParams.get("gay"), "0")
  assert.equal(ordinary.searchParams.get("lq"), "0")
  assert.equal(gay.searchParams.get("gay"), "2")
  assert.equal(gay.searchParams.get("lq"), "0")
})

test("normalizeResponse keeps safe metadata and pagination", () => {
  const result = api.normalizeResponse({
    total_count: 1200,
    total_pages: 40,
    page: 2,
    videos: [{
      id: "abc123",
      title: "Example title",
      keywords: "one, two",
      views: 42,
      rate: "4.25",
      length_sec: 91,
      length_min: "1:31",
      url: "https://www.eporner.com/hd-porn/abc123/example/",
      embed: "https://www.eporner.com/embed/abc123/",
      default_thumb: { src: "https://static-ca-cdn.eporner.com/thumb.jpg" }
    }]
  })

  assert.deepEqual(result.pagination, { page: 2, totalPages: 40, totalCount: 1200 })
  assert.deepEqual(result.videos[0], {
    id: "abc123",
    title: "Example title",
    keywords: ["one", "two"],
    views: 42,
    rating: 4.25,
    durationSeconds: 91,
    duration: "1:31",
    pageUrl: "https://www.eporner.com/hd-porn/abc123/example/",
    embedUrl: "https://www.eporner.com/embed/abc123/",
    thumbnailUrl: "https://static-ca-cdn.eporner.com/thumb.jpg",
    storyboardUrls: []
  })
})

test("normalizeResponse excludes results marked as underage content", () => {
  const result = api.normalizeResponse({
    videos: [
      { id: "safe", title: "Adult example", embed: "https://www.eporner.com/embed/safe/" },
      { id: "blocked", title: "Underage example", embed: "https://www.eporner.com/embed/blocked/" }
    ]
  })

  assert.deepEqual(result.videos.map(video => video.id), ["safe"])
})

test("isAllowedQuery gates adult-only search terms", () => {
  assert.equal(api.isAllowedQuery("all"), true)
  assert.equal(api.isAllowedQuery("amateur"), true)
  assert.equal(api.isAllowedQuery("  "), true)
  assert.equal(api.isAllowedQuery("teen"), false)
  assert.equal(api.isAllowedQuery("schoolgirl"), false)
  assert.equal(api.isAllowedQuery("adult schoolboy compilation"), false)
})

test("buildSearchUrl rejects blocked queries", () => {
  assert.throws(() => api.buildSearchUrl("teen", 1, "latest"), /adults only/)
})

test("buildSearchUrl falls back to safe defaults", () => {
  const url = new URL(api.buildSearchUrl("", 0, "bogus-order"))
  assert.equal(url.searchParams.get("query"), "all")
  assert.equal(url.searchParams.get("page"), "1")
  assert.equal(url.searchParams.get("order"), "latest")
})

test("supports daily, weekly, monthly, and all-time popularity orders", () => {
  assert.deepEqual(api.ORDERS.slice(0, 4), [
    "top-daily", "top-weekly", "top-monthly", "most-popular"
  ])
  for (const order of api.ORDERS.slice(0, 4)) {
    const url = new URL(api.buildSearchUrl("all", 1, order))
    assert.equal(url.searchParams.get("order"), order)
  }
})

test("normalizeVideo rejects unapproved embed and page urls", () => {
  const base = { id: "x1", title: "Adult example" }
  assert.equal(api.normalizeVideo(null), null)
  assert.equal(api.normalizeVideo({ ...base, embed: "https://evil.com/embed/x1/" }), null)
  assert.equal(api.normalizeVideo({ ...base, embed: "https://www.eporner.com/video-x1/slug/" }), null)
  assert.equal(api.normalizeVideo({ ...base, id: "", embed: "https://www.eporner.com/embed/x1/" }), null)
})

test("normalizeVideo only keeps eporner-hosted thumbnails", () => {
  const good = api.normalizeVideo({
    id: "x1", title: "Adult example",
    embed: "https://www.eporner.com/embed/x1/",
    default_thumb: { src: "https://static-ca-cdn.eporner.com/thumb.jpg" }
  })
  const bad = api.normalizeVideo({
    id: "x2", title: "Adult example",
    embed: "https://www.eporner.com/embed/x2/",
    default_thumb: { src: "https://evil.com/thumb.jpg" }
  })
  assert.equal(good.thumbnailUrl, "https://static-ca-cdn.eporner.com/thumb.jpg")
  assert.equal(bad.thumbnailUrl, "")
})

test("normalizeVideo keeps approved storyboard thumbnails and formats long durations", () => {
  const video = api.normalizeVideo({
    id: "long",
    title: "Adult example",
    length_sec: 4500,
    embed: "https://www.eporner.com/embed/long/",
    default_thumb: { src: "https://static-ca-cdn.eporner.com/default.jpg" },
    thumbs: [
      { src: "https://static-ca-cdn.eporner.com/1.jpg" },
      { src: "https://evil.example/2.jpg" },
      { src: "https://static-ca-cdn.eporner.com/3.jpg" }
    ]
  })

  assert.equal(video.duration, "1:15:00")
  assert.deepEqual(video.storyboardUrls, [
    "https://static-ca-cdn.eporner.com/1.jpg",
    "https://static-ca-cdn.eporner.com/3.jpg"
  ])
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
    api.search("all", 1, "latest", () => {}, message => { failure = message })
    assert.equal(request.timeout, api.REQUEST_TIMEOUT_MS)
    request.ontimeout()
    assert.equal(failure, "Eporner request timed out")
  } finally {
    global.XMLHttpRequest = previous
  }
})

test("normalizeResponse defaults pagination when the api omits it", () => {
  const result = api.normalizeResponse({ videos: [] })
  assert.deepEqual(result.pagination, { page: 1, totalPages: 1, totalCount: 0 })
})
