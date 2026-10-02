# Security release checklist

Tracks #26. Source 1.4.3 contains the preview XSS and translation proxy fixes;
the existing v1.4.2 Release does not contain them. Preparing an artifact is not
publishing a release. Do not close #26 until the verified ZIP is publicly available.

## Verify and build

1. Run the Security release checks workflow for the exact reviewed commit.
   PR runs build GitHub's merge revision; merging to main automatically runs
   it again. Use the successful main run's artifact for publication. Manual
   workflow dispatch on main is available if a rebuild is required.
2. Require a clean dependency audit, all unit tests, browser security smoke checks, build, ZIP integrity,
   manifest security checks and version consistency to pass.
3. Download `verified-extension-<sha>` from that run. Keep the ZIP,
   `SHA256SUMS`, and `BUILD-SOURCE.txt` together. Verify `sha256sum -c SHA256SUMS`.
   The ZIP contains an inner `dist/` directory. Archive timestamps can differ
   across runs; this checksum identifies the artifact from the recorded run.
4. Load that exact extracted `dist/` in real Chrome. Check local-file opening,
   local images, preview editing, Mermaid, session restore, two independent
   tabs and translation with a configured provider. Browser smoke tests cover
   preview execution; they do not replace a real extension profile test.

## Publish after verification

1. Create a **draft** v1.4.3 Release targeting the reviewed commit (use a new
   tag only; never move an existing tag).
2. Attach the verified ZIP, checksum and source record from the same run.
3. State that 1.4.2 users should upgrade because 1.4.3 sanitizes preview HTML
   and Mermaid SVG and restricts the translation proxy. The proxy now accepts
   only this extension's editor page, blocks redirects, omits cookies and rejects
   embedded URL credentials; providers must accept the configured endpoint
   without redirecting it.
4. Publish only after confirming the manual checks. Update README release and
   download links and close #26 with the release and verification run URLs.

## Upgrade instructions

Download the new ZIP, replace the previously loaded `dist/` with its new
contents, reload the extension at `chrome://extensions`, close old editor tabs
and open a new one. Reloading old files alone does not install a security fix.

## Local checks

```bash
npm ci
npm audit --audit-level=low
npm test
npx playwright install chromium
npm run pack
node scripts/qa-security.mjs
unzip -t chrome-md-editor-v1.4.3.zip
sha256sum chrome-md-editor-v1.4.3.zip
```
