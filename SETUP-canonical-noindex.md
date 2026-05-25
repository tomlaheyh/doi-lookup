# Hiding the GitHub copy from search engines

Your real site is **doilookup.com** (indexed). The GitHub Pages copy
(**tomlaheyh.github.io**) is now set to NOT be indexed, and both sites tell
search engines that doilookup.com is the original — clearing the duplicate-
content flag.

## How it works (no per-site file editing needed)

`canonical.js` (loaded in index.html) and the logic added to `siteNav.js`
(loaded on every other page) detect the hostname at load time:

- On **doilookup.com** → page stays indexable; canonical points to itself.
- On **anything else** (github.io, previews, localhost) → adds
  `<meta name="robots" content="noindex, nofollow">` and a canonical link
  back to doilookup.com.

Because it's host-aware, the SAME files work correctly on both sites. Your
clone workflow doesn't change.

## Optional reinforcement: robots.txt (per site)

robots.txt is served per-domain, so the two sites need different ones.
This only matters if you choose to use robots.txt at all — the meta tag
above already handles indexing on its own.

- `robots-GITHUB.txt`    → rename to `robots.txt`, put in the GitHub repo root.
- `robots-DOILOOKUP.txt` → rename to `robots.txt`, put at doilookup.com root.

If you can't keep different robots.txt files on each (because cloning copies
everything), just DON'T add robots.txt to the GitHub repo and rely on the
meta tag — that's the simplest reliable setup.

## After deploying
1. Visit the github.io copy, View Source, confirm you see
   `<meta name="robots" content="noindex, nofollow">` and a canonical link
   to doilookup.com.
2. Visit doilookup.com, confirm NO robots meta tag, and a canonical to itself.
3. In Google Search Console, you can request removal of any github.io URLs
   already indexed to speed things up.
