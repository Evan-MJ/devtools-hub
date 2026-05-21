#!/bin/bash
# IndexNow URL Submission Script for DevTools Hub
# Submits all sitemap URLs to IndexNow for immediate Bing indexing

KEY="f0ed603a5ff64d91903321956f48ceec"
KEY_LOCATION="https://tools.scoreroute.com/f0ed603a5ff64d91903321956f48ceec.txt"
HOST="tools.scoreroute.com"
SITEMAP_URL="https://tools.scoreroute.com/sitemap.xml"

echo "Fetching URLs from sitemap..."
URLS=$(curl -s "$SITEMAP_URL" | grep -o '<loc>[^<]*</loc>' | sed 's/<loc>//;s/<\/loc>//')

if [ -z "$URLS" ]; then
    echo "Error: No URLs found in sitemap"
    exit 1
fi

echo "Found $(echo "$URLS" | wc -l) URLs"

# Create JSON payload
JSON_FILE="/tmp/indexnow-payload-$$.json"
cat > "$JSON_FILE" << JSONEOF
{
  "host": "$HOST",
  "key": "$KEY",
  "keyLocation": "$KEY_LOCATION",
  "urlList": [
$(echo "$URLS" | while read url; do echo "      \"$url\","; done | sed '$ s/,$//')
  ]
}
JSONEOF

echo "Submitting to IndexNow..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d @"$JSON_FILE")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "SUCCESS: URLs submitted successfully to IndexNow"
else
    echo "FAILED: HTTP $HTTP_CODE"
    echo "$RESPONSE"
fi

rm -f "$JSON_FILE"
