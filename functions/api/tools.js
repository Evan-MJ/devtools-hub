const TOOL_CATEGORIES = {
    'formatter': ['json-formatter', 'html-formatter', 'sql-formatter', 'yaml-validator'],
    'calculator': ['calculator', 'bmi-calculator', 'loan-calculator', 'age-calculator', 'tip-calculator'],
    'generator': ['qr-code-generator', 'barcode-generator', 'password-generator', 'uuid-generator', 'hash-generator', 'cron-generator', 'text-to-speech', 'wordle-helper'],
    'converter': ['base64-encoder', 'url-encoder', 'binary-hex-converter', 'unit-converter', 'currency-converter', 'timestamp-converter', 'time-zone-converter', 'color-picker', 'color-palette-extractor'],
    'media': ['image-compressor', 'image-resizer', 'image-to-text', 'background-remover', 'screenshot-tool', 'video-to-audio', 'video-compressor', 'audio-to-text'],
    'network': ['speed-test', 'ip-address-lookup', 'dns-lookup', 'ssl-checker', 'email-verifier'],
    'code-testing': ['regex-tester', 'jwt-decoder', 'grammar-checker', 'text-diff', 'math-solver', 'online-timer'],
    'pdf': ['pdf-merger', 'pdf-splitter'],
    'data-live': ['weather-forecast', 'crypto-price-tracker'],
    'ai-language': ['translator', 'word-counter', 'feedback']
};

const CATEGORY_LABELS = {
    'formatter': 'Formatters',
    'calculator': 'Calculators',
    'generator': 'Generators',
    'converter': 'Converters',
    'media': 'Media Tools',
    'network': 'Network Tools',
    'code-testing': 'Code Testing',
    'pdf': 'PDF Tools',
    'data-live': 'Data & Live',
    'ai-language': 'AI Language'
};

const TOOL_DISPLAY_NAMES = {
    'json-formatter': 'JSON Formatter',
    'html-formatter': 'HTML Formatter',
    'sql-formatter': 'SQL Formatter',
    'yaml-validator': 'YAML Validator',
    'qr-code-generator': 'QR Code Generator',
    'barcode-generator': 'Barcode Generator',
    'password-generator': 'Password Generator',
    'uuid-generator': 'UUID Generator',
    'hash-generator': 'Hash Generator',
    'cron-generator': 'Cron Generator',
    'text-to-speech': 'Text to Speech',
    'wordle-helper': 'Wordle Helper',
    'base64-encoder': 'Base64 Encoder',
    'url-encoder': 'URL Encoder',
    'binary-hex-converter': 'Binary Hex Converter',
    'unit-converter': 'Unit Converter',
    'currency-converter': 'Currency Converter',
    'timestamp-converter': 'Timestamp Converter',
    'time-zone-converter': 'Time Zone Converter',
    'color-picker': 'Color Picker',
    'color-palette-extractor': 'Color Palette Extractor',
    'speed-test': 'Speed Test',
    'ip-address-lookup': 'IP Address Lookup',
    'dns-lookup': 'DNS Lookup',
    'ssl-checker': 'SSL Checker',
    'email-verifier': 'Email Verifier',
    'regex-tester': 'Regex Tester',
    'jwt-decoder': 'JWT Decoder',
    'grammar-checker': 'Grammar Checker',
    'text-diff': 'Text Diff Checker',
    'math-solver': 'Math Solver',
    'online-timer': 'Online Timer',
    'calculator': 'Calculator',
    'bmi-calculator': 'BMI Calculator',
    'loan-calculator': 'Loan Calculator',
    'age-calculator': 'Age Calculator',
    'tip-calculator': 'Tip Calculator',
    'image-compressor': 'Image Compressor',
    'image-resizer': 'Image Resizer',
    'image-to-text': 'Image to Text',
    'background-remover': 'Background Remover',
    'screenshot-tool': 'Screenshot Tool',
    'video-to-audio': 'Video to Audio Converter',
    'video-compressor': 'Video Compressor',
    'audio-to-text': 'Audio to Text Converter',
    'pdf-merger': 'PDF Merger',
    'pdf-splitter': 'PDF Splitter',
    'weather-forecast': 'Weather Forecast',
    'crypto-price-tracker': 'Crypto Price Tracker',
    'translator': 'Translator',
    'word-counter': 'Word Counter',
    'feedback': 'Feedback'
};

export async function onRequestGet(context) {
    const tools = [];
    
    for (const [category, toolSlugs] of Object.entries(TOOL_CATEGORIES)) {
        for (const slug of toolSlugs) {
            tools.push({
                slug,
                name: TOOL_DISPLAY_NAMES[slug] || slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                category,
                categoryLabel: CATEGORY_LABELS[category] || category,
                url: `/tools/${slug}/`
            });
        }
    }
    
    return new Response(JSON.stringify({
        categories: CATEGORY_LABELS,
        tools
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=3600'
        }
    });
}
