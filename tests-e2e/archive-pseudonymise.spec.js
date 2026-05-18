/* tests-e2e/archive-pseudonymise.spec.js
 *
 * R2-23 regression test: the admin "Pseudonymise names in export"
 * checkbox now also rewrites the full JSON archive download
 * (previously only the .txt group-answers download honoured it).
 *
 * Strategy:
 *   1. Load the platform in LOCAL mode (fixtures.forceLocalMode).
 *   2. lib.js attaches pseudonymiseTree as a window global; build a
 *      synthetic session tree shaped like /sessions/{code} and pass it
 *      to the live function via page.evaluate, intercepting the
 *      Blob produced by downloadFullArchive.
 *   3. Assert that with the toggle ON, the produced archive contains
 *      "Student-A" / "Student-B" pseudonyms and ZERO raw participant
 *      names anywhere in the JSON text.
 *   4. Assert that with the toggle OFF, raw names DO appear (so we
 *      haven't accidentally regressed the no-toggle behaviour).
 *
 * Why drive the live function via the page (rather than just unit-test
 * lib.js): downloadFullArchive composes the archive envelope, picks
 * the filename, and only THEN reaches into pseudonymiseTree. A unit
 * test of pseudonymiseTree alone could pass while downloadFullArchive
 * still skipped the call — the bug we're fixing was exactly that
 * composition gap.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Build a tree shaped the way /sessions/{code} looks on disk: pool +
   rooms with answers/score/calls. Two participants with distinct
   real names. */
function syntheticTree() {
  return {
    pool: {
      cAAA: { name: "Marie-Laure Dupont", university: "Caen",   year: 5, english: "B2", at: 100 },
      cBBB: { name: "Yamada Hiroshi",     university: "Nagoya", year: 4, english: "B1", at: 200 }
    },
    rooms: {
      "Room 1": {
        teamName: "Team Alpha",
        stage: 2,
        answers: {
          moduleA: {
            ans1: { by: "Marie-Laure Dupont", cid: "cAAA", text: "Ask about red flags first", at: 150 },
            ans2: { by: "Yamada Hiroshi",     cid: "cBBB", text: "Then targeted neuro exam", at: 160 }
          }
        },
        score: {
          manual: {
            m1: { by: "Marie-Laure Dupont", points: 5, tag: "good answer", at: 170 }
          }
        },
        presence: {
          cAAA: { name: "Marie-Laure Dupont", at: 180 }
        }
      }
    }
  };
}

test.describe("R2-23: archive pseudonymisation honours the admin toggle", () => {
  test("ON: archive contains Student-A / Student-B and ZERO raw names", async ({ page }) => {
    await page.goto("/");

    // Wait for lib.js to attach pseudonymiseTree (defer-loaded, but very fast).
    await page.waitForFunction(() => typeof window.pseudonymiseTree === "function");

    const result = await page.evaluate((tree) => {
      // Simulate the admin having ticked the checkbox: build a hidden
      // input element with id="anon-export" set to checked. The live
      // downloadFullArchive() reads el("anon-export").checked.
      let toggle = document.getElementById("anon-export");
      if (!toggle) {
        toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.id = "anon-export";
        document.body.appendChild(toggle);
      }
      toggle.checked = true;

      // Intercept the Blob URL the function tries to download.
      let capturedJson = null;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        return blob.text().then(t => { capturedJson = t; }).then(() => "blob:fake-url");
      };
      // download trigger: stub anchor click so the browser doesn't
      // actually try to save a file (would hang Playwright).
      const origCreateEl = document.createElement.bind(document);
      document.createElement = function (tag) {
        const node = origCreateEl(tag);
        if (tag === "a") { node.click = function () { /* no-op */ }; }
        return node;
      };

      // Build the Blob synchronously so we can read it back below.
      let blobText = null;
      const realBlob = window.Blob;
      window.Blob = function (parts, opts) {
        blobText = (parts && parts.join) ? parts.join("") : String(parts);
        return new realBlob(parts, opts);
      };

      window.downloadFullArchive(tree, "TEST-CODE");

      // restore
      URL.createObjectURL = origCreate;
      document.createElement = origCreateEl;
      window.Blob = realBlob;

      return blobText;
    }, syntheticTree());

    expect(result, "downloadFullArchive must have produced a Blob payload").toBeTruthy();
    // Pseudonyms are present
    expect(result).toContain("Student-A");
    expect(result).toContain("Student-B");
    // Raw participant names are ABSENT — the entire point of R2-23
    expect(result).not.toContain("Marie-Laure Dupont");
    expect(result).not.toContain("Yamada Hiroshi");
    // Envelope marks the export as pseudonymised
    expect(result).toContain("\"pseudonymised\": true");
    // Free-text bodies are preserved (only NAMES are pseudonymised)
    expect(result).toContain("Ask about red flags first");
    expect(result).toContain("Then targeted neuro exam");
  });

  test("OFF: archive contains raw names (sanity — toggle is the gate)", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => typeof window.pseudonymiseTree === "function");

    const result = await page.evaluate((tree) => {
      let toggle = document.getElementById("anon-export");
      if (!toggle) {
        toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.id = "anon-export";
        document.body.appendChild(toggle);
      }
      toggle.checked = false;

      let blobText = null;
      const realBlob = window.Blob;
      window.Blob = function (parts, opts) {
        blobText = (parts && parts.join) ? parts.join("") : String(parts);
        return new realBlob(parts, opts);
      };
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = () => "blob:fake-url";
      const origCreateEl = document.createElement.bind(document);
      document.createElement = function (tag) {
        const node = origCreateEl(tag);
        if (tag === "a") { node.click = function () {}; }
        return node;
      };

      window.downloadFullArchive(tree, "TEST-CODE");

      URL.createObjectURL = origCreate;
      document.createElement = origCreateEl;
      window.Blob = realBlob;
      return blobText;
    }, syntheticTree());

    expect(result).toBeTruthy();
    // Toggle OFF: raw names DO appear (so the toggle is what gates it)
    expect(result).toContain("Marie-Laure Dupont");
    expect(result).toContain("Yamada Hiroshi");
    expect(result).toContain("\"pseudonymised\": false");
  });
});
