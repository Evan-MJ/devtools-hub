# devtools-hub

Free browser-based developer tools — formatters, validators, converters, generators,
calculators, PDF and media utilities. Everything runs in the visitor's browser:
no signup, no API key, no upload.

**Live site: https://tools.scoreroute.com/**

## Popular tools

- [Age Calculator by Photo - How Old Do I Look?](https://tools.scoreroute.com/tools/face-age-estimator/) - free AI face age estimator, runs in your browser
- [Voice Changer - Free Online Audio Voice Effects](https://tools.scoreroute.com/tools/voice-changer/) - 10 presets plus custom pitch and speed
- [Audio Editor - Free Online Audio Effects & Editing Tool](https://tools.scoreroute.com/tools/audio-editor/) - cut, fade, normalize, EQ, reverse
- [Audio to Text Converter - Free Online Speech to Text](https://tools.scoreroute.com/tools/audio-to-text/) - real-time browser speech recognition
- [Free AI PPT Maker - Generate Editable Powerpoint Slides](https://tools.scoreroute.com/tools/ai-ppt-maker/) - real editable .pptx files in 10 seconds
- [AI Image Generator - Free Unlimited Image Creation](https://tools.scoreroute.com/tools/ai-image-generator/) - no API key, no watermark, no daily limit
- [Free Poster Maker - Custom Online Poster Design Tool](https://tools.scoreroute.com/tools/poster-maker/) - 8 templates, 9 sizes, PNG/PDF export
- [Condom Size Calculator - Find Your Exact Fit](https://tools.scoreroute.com/tools/condom-size-calculator/) - girth and length to nominal width, privately
- [URL Metadata Extractor - Link Preview and Meta Tags](https://tools.scoreroute.com/tools/url-metadata-extractor/) - OG tags, Twitter cards, JSON-LD, headings

## Categories

- [Code Formatters](https://tools.scoreroute.com/tools/formatters/)
- [Calculators](https://tools.scoreroute.com/tools/calculators/)
- [Generators](https://tools.scoreroute.com/tools/generators/)
- [Converters](https://tools.scoreroute.com/tools/converters/)
- [Media Tools](https://tools.scoreroute.com/tools/media/)
- [Network Tools](https://tools.scoreroute.com/tools/network/)
- [Code Testing](https://tools.scoreroute.com/tools/code-testing/)
- [PDF Tools](https://tools.scoreroute.com/tools/pdf-tools/)
- [Daily Life](https://tools.scoreroute.com/tools/life/)
- [Money & Markets](https://tools.scoreroute.com/tools/finance/)
- [AI Language](https://tools.scoreroute.com/tools/ai-language/)

## For coding agents

- [`/api/tools`](https://tools.scoreroute.com/api/tools) - the catalogue (slug, name, description, tags, category) as JSON
- [`/llms.txt`](https://tools.scoreroute.com/llms.txt) - compact index of every tool
- [`/AGENTS.md`](https://tools.scoreroute.com/AGENTS.md) - how to cite a tool correctly
- [`/sitemap.xml`](https://tools.scoreroute.com/sitemap.xml) - every published URL

## Run it locally

```bash
npm install
npx wrangler pages dev .
```

`manifest.txt` is the single source of truth for the tool catalogue - a tool row is
`slug|category|featured|isnew|name|description|tags`. The Pages Functions read it at
request time, so adding a tool is one manifest line plus `tools/<slug>/index.html`.

## Deploy

`scripts/pre-deploy.sh` is the gate: it regenerates `tool-dates.json`, `sitemap.xml`,
`llms.txt` and `llms-full.txt`, redacts secrets and parks the test harness before
`wrangler pages deploy`. `scripts/publish-github.sh` publishes the deployed tree to
GitHub as a single snapshot commit.
