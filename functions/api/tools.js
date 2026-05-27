const TOOL_CATEGORIES = {
    'formatter': ['json-formatter', 'html-formatter', 'sql-formatter', 'css-formatter', 'yaml-validator'],
    'generator': ['qr-code-generator', 'barcode-generator', 'password-generator', 'uuid-generator', 'hash-generator', 'cron-generator'],
    'converter': ['base64-encoder', 'url-encoder', 'binary-hex-converter', 'unit-converter', 'currency-converter', 'timestamp-converter', 'time-zone-converter', 'color-palette-extractor'],
    'network': ['dns-lookup', 'ssl-checker', 'ip-address-lookup', 'speed-test', 'email-verifier'],
    'testing': ['regex-tester', 'jwt-decoder'],
    'math': ['calculator', 'bmi-calculator', 'loan-calculator', 'math-solver', 'tip-calculator'],
    'image': ['image-compressor', 'image-resizer', 'image-to-text', 'screenshot-tool'],
    'pdf': ['pdf-merger', 'pdf-splitter'],
    'other': ['weather-forecast', 'crypto-price-tracker', 'translator', 'grammar-checker', 'word-counter', 'online-timer', 'text-diff', 'text-to-speech', 'feedback']
};

const CATEGORY_LABELS = {
    'formatter': 'Formatters',
    'generator': 'Generators',
    'converter': 'Converters',
    'network': 'Network Tools',
    'testing': 'Code Testing',
    'math': 'Calculators & Math',
    'image': 'Image Tools',
    'pdf': 'PDF Tools',
    'other': 'Other'
};

const TOOL_DISPLAY_NAMES = {
    'json-formatter': 'JSON Formatter',
    'html-formatter': 'HTML Formatter',
    'sql-formatter': 'SQL Formatter',
    'css-formatter': 'CSS Formatter',
    'yaml-validator': 'YAML Validator',
    'qr-code-generator': 'QR Code Generator',
    'barcode-generator': 'Barcode Generator',
    'password-generator': 'Password Generator',
    'uuid-generator': 'UUID Generator',
    'hash-generator': 'Hash Generator',
    'cron-generator': 'Cron Generator',
    'base64-encoder': 'Base64 Encoder',
    'url-encoder': 'URL Encoder',
    'binary-hex-converter': 'Binary Hex Converter',
    'unit-converter': 'Unit Converter',
    'currency-converter': 'Currency Converter',
    'timestamp-converter': 'Timestamp Converter',
    'time-zone-converter': 'Time Zone Converter',
    'color-palette-extractor': 'Color Palette Extractor',
    'dns-lookup': 'DNS Lookup',
    'ssl-checker': 'SSL Checker',
    'ip-address-lookup': 'IP Address Lookup',
    'speed-test': 'Speed Test',
    'regex-tester': 'Regex Tester',
    'jwt-decoder': 'JWT Decoder',
    'calculator': 'Calculator',
    'bmi-calculator': 'BMI Calculator',
    'loan-calculator': 'Loan Calculator',
    'math-solver': 'Math Solver',
    'tip-calculator': 'Tip Calculator',
    'image-compressor': 'Image Compressor',
    'image-resizer': 'Image Resizer',
    'image-to-text': 'Image to Text',
    'screenshot-tool': 'Screenshot Tool',
    'pdf-merger': 'PDF Merger',
    'pdf-splitter': 'PDF Splitter',
    'weather-forecast': 'Weather Forecast',
    'crypto-price-tracker': 'Crypto Price Tracker',
    'translator': 'Translator',
    'grammar-checker': 'Grammar Checker',
    'word-counter': 'Word Counter',
    'online-timer': 'Online Timer',
    'text-diff': 'Text Diff',
    'text-to-speech': 'Text to Speech',
    'feedback': 'Feedback',
    'email-verifier': 'Email Verifier'
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
