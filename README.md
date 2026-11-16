# Fast Markdown renderer

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/kainze29/markdown-render-speed-02/rank.svg)](https://make.fun/c/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/kainze29/markdown-render-speed-02/reward.svg)](https://make.fun/c/markdown-render-speed-02)

A from-scratch, dependency-free Markdown renderer written for the
[Make Markdown rendering faster](https://make.fun/c/markdown-render-speed-02)
competition on make.fun. Its `parse(markdown)` returns exactly the HTML that
marked 18.1.3 renders with its default options (GFM on, breaks off,
pedantic off), byte for byte on every CommonMark 0.31.2 and GFM 0.29 spec
example, and it renders a full set of 720 cases faster than marked itself.

## How it works

`parse.js` is a single-pass parser that renders straight to HTML strings
while it scans, with no token objects and no caching across calls. Block
scanning covers ATX and setext headings, fenced and indented code,
blockquotes with lazy continuation, nested task lists (loose and tight),
thematic breaks, HTML blocks, link reference definitions, tables, and
paragraphs. Inline rendering covers code spans, emphasis and strong emphasis
with the full delimiter-run rules, inline, reference and shortcut links,
images, autolinks and extended autolinks, raw HTML, hard and soft breaks,
numeric character references, backslash escapes, and strikethrough.

Two details matter for byte-identical output: named entities are never
decoded (only numeric character references are), and link reference
definitions are collected across the whole document before any inline
rendering runs.

## Files

- `parse.js` — the renderer, a dependency-free ES module exporting `parse`.
- `main.ts` — the driver the harness runs: reads `/input/cases.json` and
  writes `/output/html.json`.
- `LICENSE` — MIT.

## License

MIT. See [LICENSE](LICENSE).
