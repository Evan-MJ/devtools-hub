#!/bin/bash
# 自动更新 sitemap.xml
# 运行方式: ./update-sitemap.sh

SITE_URL="https://tools.scoreroute.com"
SITEMAP_FILE="sitemap.xml"
TOOLS_DIR="tools"

echo "Generating sitemap..."

# 开始 XML
echo '<?xml version="1.0" encoding="UTF-8"?>' > "$SITEMAP_FILE"
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' >> "$SITEMAP_FILE"

# 添加首页
echo '  <url>' >> "$SITEMAP_FILE"
echo '    <loc>'"$SITE_URL"'/</loc>' >> "$SITEMAP_FILE"
echo '    <changefreq>weekly</changefreq>' >> "$SITEMAP_FILE"
echo '    <priority>1.0</priority>' >> "$SITEMAP_FILE"
echo '  </url>' >> "$SITEMAP_FILE"

# 遍历 tools 目录下的每个工具
for dir in "$TOOLS_DIR"/*/; do
    if [ -f "${dir}index.html" ]; then
        tool_name=$(basename "$dir")
        url="${SITE_URL}/tools/${tool_name}/"
        
        echo '  <url>' >> "$SITEMAP_FILE"
        echo '    <loc>'"$url"'</loc>' >> "$SITEMAP_FILE"
        echo '    <changefreq>monthly</changefreq>' >> "$SITEMAP_FILE"
        echo '    <priority>0.9</priority>' >> "$SITEMAP_FILE"
        echo '  </url>' >> "$SITEMAP_FILE"
        
        echo "  Added: $url"
    fi
done

# 结束 XML
echo '</urlset>' >> "$SITEMAP_FILE"

count=$(grep -c "<loc>" "$SITEMAP_FILE")
echo ""
echo "✅ Sitemap 生成完成: $count 个 URL"
echo "📁 文件: $SITEMAP_FILE"
