# Instagram 16:9 Image Overlay Service

Automated Netlify function that adds branded text overlays to images for Instagram posting.

## 🎯 Purpose

This service processes OG images (1200x630) from your website and converts them into Instagram-optimized 16:9 format (1080x607) with branded caption overlays.

## 🔄 Workflow

1. **n8n cron job** (4x/day) fetches content from your website
2. **n8n extracts** OG image + headline
3. **n8n sends** image + caption to this Netlify function
4. **Function processes** image with branded overlay
5. **n8n receives** Instagram-ready image and auto-posts

## 🚀 Deployment

1. Push this folder to GitHub
2. Connect to Netlify: **New Site from Git**
3. Netlify will auto-detect and deploy
4. Function will be available at:
   ```
   https://your-site.netlify.app/.netlify/functions/overlay
   ```

## 📱 n8n Integration

Configure your HTTP Request node:

```json
{
  "method": "POST",
  "url": "https://your-site.netlify.app/.netlify/functions/overlay",
  "headers": {
    "Content-Type": "application/octet-stream",
    "x-caption": "{{$json.headline}}",
    "x-brand-color": "#your-brand-hex"
  },
  "sendBinaryData": true,
  "binaryPropertyName": "og_image"
}
```

## 🎨 Customization

- **Brand Color**: Pass via `x-brand-color` header (hex format)
- **Caption**: Pass via `x-caption` header
- **Output**: 1080x607 JPEG, optimized for Instagram

## 🧪 Testing

Test with curl:

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/overlay \
  -H "Content-Type: application/octet-stream" \
  -H "x-caption: Your headline here" \
  -H "x-brand-color: #667eea" \
  --data-binary "@your-og-image.jpg" \
  --output instagram-ready.jpg
```

## 📊 Performance

- **Optimized for**: 4x/day automated posting
- **Cache**: 1-hour cache headers
- **Output**: ~100-300KB JPEG files
- **Processing**: ~2-3 seconds per image
