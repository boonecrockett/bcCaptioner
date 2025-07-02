# 🧠 AI Agent Instructions: Build and Deploy Image Overlay API with Netlify

You are tasked with creating a serverless image overlay service using **Netlify Functions**. This service will receive a binary image and a caption string via HTTP POST, overlay the caption text onto the image using `sharp`, and return a new composited image. The overlay logic will be triggered by an **n8n workflow**.

---

## 📁 Step 1: Project Setup

1. Create a new folder: `image-overlay-netlify`
2. Inside it, create this structure:

```
image-overlay-netlify/
├─ netlify.toml
├─ package.json
├─ functions/
│  └─ overlay.js
```

---

## 🧾 Step 2: Write `package.json`

Install `sharp` as a dependency and prepare for Netlify deploy:

```json
{
  "name": "image-overlay-netlify",
  "version": "1.0.0",
  "dependencies": {
    "sharp": "^0.33.1"
  }
}
```

---

## ⚙️ Step 3: Write `netlify.toml`

Configure Netlify to find functions in the correct folder:

```toml
[build]
functions = "functions"
```

---

## 🖊️ Step 4: Write `functions/overlay.js`

This is the function that receives binary image + caption and returns the captioned image.

```js
const sharp = require('sharp');

exports.handler = async (event) => {
  try {
    const caption = event.headers['x-caption'] || 'No caption';
    const imageBuffer = Buffer.from(event.body, 'base64');

    const svg = \`
      <svg width="1200" height="200">
        <style>
          .caption { fill: white; font-size: 64px; font-weight: bold; text-anchor: middle; }
        </style>
        <text x="600" y="140" class="caption">\${caption}</text>
      </svg>
    \`;

    const outputBuffer = await sharp(imageBuffer)
      .composite([{ input: Buffer.from(svg), gravity: 'south' }])
      .png()
      .toBuffer();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png' },
      body: outputBuffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
```

---

## 🚀 Step 5: Deploy to Netlify

1. Push the folder to GitHub.
2. Go to [Netlify](https://app.netlify.com/) → **New Site from Git** → connect the repo.
3. It will auto-detect and deploy your function.
4. The endpoint will be live at:

```
https://your-netlify-site.netlify.app/.netlify/functions/overlay
```

---

## 🔁 Step 6: Connect from n8n

In your **n8n HTTP Request node**, configure like this:

- **Method**: `POST`  
- **URL**: `https://your-netlify-site.netlify.app/.netlify/functions/overlay`
- **Send Binary Data**: ✅ enabled
- **Binary Property**: `data` (or whatever you stored your image in)
- **Headers**:
  - `Content-Type`: `application/octet-stream`
  - `x-caption`: The headline text (use an expression like `{{$json["headline"]}}`)
- **Response Format**: File (binary)

---

## 🧪 Step 7: Test

Try the endpoint with `curl`:

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/overlay \
  -H "Content-Type: application/octet-stream" \
  -H "x-caption: Hello world" \
  --data-binary "@input.jpg" --output output.png
```

---

## ✅ Final Checklist

- [ ] Uses `sharp` to overlay SVG text
- [ ] Accepts image binary + `x-caption` header
- [ ] Returns a valid PNG image
- [ ] Runs as a Netlify Function at a public URL
- [ ] Compatible with n8n binary workflow
