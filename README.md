# markdown-render-speed-02

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/kainze29/markdown-render-speed-02/rank.svg)](https://make.fun/c/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/kainze29/markdown-render-speed-02/reward.svg)](https://make.fun/c/markdown-render-speed-02)

A fast, dependency-free Markdown renderer for the [make.fun](https://make.fun/c/markdown-render-speed-02) competition "Make Markdown rendering faster".

`parse.js` exports `parse(markdown)`, which returns exactly the HTML that [marked](https://github.com/markedjs/marked) 18.1.3 renders with its default options (GFM on, breaks off, pedantic off, async off), for every string. It is a from-scratch, single-pass parser: block scanning and inline rendering both work directly on the source and build the HTML string as they go, with no token objects and no per-case caching. It covers the full CommonMark 0.31.2 spec and the GFM 0.29 extensions (tables, strikethrough, task lists, autolinks), including marked's quirks around link reference definitions, list looseness, blockquote continuation, and numeric character references.

`main.ts` is the harness driver: it reads every case from `/input/cases.json`, renders each one alone with `parse()`, and writes `/output/html.json`.

## Verification

On the kit's practice set (720 cases: 680 CommonMark and GFM spec examples plus 40 generated README documents of 20,000 to 100,000 characters), this entry matches marked 18.1.3 byte for byte on all 720 cases, and renders the set in about 600 ms of CPU time, against about 720 ms for marked itself on the same machine.

## Files

- `parse.js` — the renderer (dependency-free ES module, no install step)
- `main.ts` — the harness driver
- `LICENSE` — MIT
