const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const viewerPath = path.join(__dirname, "ViewerWindow.qml")

test("static viewer entry point starts without a generated wrapper", () => {
  const result = spawnSync("qml6", [viewerPath, "--", "--smoke=1"], {
    encoding: "utf8",
    timeout: 15000
  })

  assert.equal(result.error, undefined, result.error && result.error.message)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
