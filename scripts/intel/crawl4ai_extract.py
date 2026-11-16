#!/usr/bin/env python3
"""
BEAN Intelligence — Crawl4AI page extraction lane (self-hosted, Apache-2.0).

One URL in, one JSON object out:
    {"ok": true, "url": "...", "title": "...", "text": "...", "publishedTime": ...}
    {"ok": false, "error": "...", "url": "..."}

Called as a subprocess by src/lib/intel/providers/extract.ts so the Node app
never holds a browser in-process. Extraction uses crawl4ai's pruning content
filter (navigation/boilerplate removed) with a hard text budget.

Usage:
    python3 scripts/intel/crawl4ai_extract.py <url> [--max-chars 24000] [--timeout 40]

Resource contract: spawns a headless chromium, fetches ONE page, exits.
~600MB disk (browser), ~200-400MB RAM transient, ~4-8s wall time.
"""

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--max-chars", type=int, default=24000)
    parser.add_argument("--timeout", type=int, default=40)
    args = parser.parse_args()

    url = args.url
    if not (url.startswith("http://") or url.startswith("https://")):
        print(json.dumps({"ok": False, "error": "only http(s) URLs are supported", "url": url}))
        return 1

    try:
        import asyncio
        import re

        from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
        from crawl4ai.content_filter_strategy import PruningContentFilter
        from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

        async def run():
            browser_cfg = BrowserConfig(
                headless=True,
                text_mode=True,
                light_mode=True,
                extra_args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
            )
            cfg = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                page_timeout=args.timeout * 1000,
                excluded_tags=["nav", "footer", "header", "aside", "script", "style", "form", "noscript"],
                markdown_generator=DefaultMarkdownGenerator(
                    content_filter=PruningContentFilter(threshold=0.45)
                ),
            )
            async with AsyncWebCrawler(config=browser_cfg) as crawler:
                return await crawler.arun(url=url, config=cfg)

        result = asyncio.run(run())
        if not result.success:
            print(json.dumps({
                "ok": False,
                "url": url,
                "error": f"crawl failed: {str(result.error_message or 'unknown')[:300]}",
            }))
            return 1

        # fit markdown (pruned) preferred; raw markdown fallback
        md_obj = result.markdown
        text = str(getattr(md_obj, "fit_markdown", "") or "")
        if len(text) < 200:
            text = str(md_obj) if md_obj else ""
        text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links -> text
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)     # images out
        text = re.sub(r"\n{2,}", "\n", text)
        text = text.strip()[: args.max_chars]

        published = None
        md_meta = getattr(result, "metadata", {}) or {}
        for key in ("published_time", "publishedTime", "date", "last_updated"):
            if isinstance(md_meta.get(key), str) and md_meta[key].strip():
                published = md_meta[key].strip()[:64]
                break

        print(json.dumps({
            "ok": True,
            "url": result.url or url,
            "title": (md_meta.get("title") or "")[:300],
            "publishedTime": published,
            "text": text,
            "chars": len(text),
        }))
        return 0
    except Exception as exc:  # noqa: BLE001 — boundary must return JSON, never a traceback
        print(json.dumps({"ok": False, "url": url, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
