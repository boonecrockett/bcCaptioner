const express = require('express');
const multer = require('multer');
const { handler } = require('./functions/overlay');

const app = express();
const upload = multer();

// Middleware to parse binary data
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }));

// Test endpoint that mimics Netlify function
app.post('/test-overlay', upload.single('image'), async (req, res) => {
  try {
    let imageBuffer;
    let caption = 'Test Caption';
    let brandColor = '#667eea';

    // Handle different input methods
    if (req.file) {
      // File upload via form
      imageBuffer = req.file.buffer;
      caption = req.body.caption || caption;
      brandColor = req.body.brandColor || brandColor;
    } else if (req.body && req.body.length > 0) {
      // Raw binary data
      imageBuffer = req.body;
      caption = req.headers['x-caption'] || caption;
      brandColor = req.headers['x-brand-color'] || brandColor;
    } else {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Mock Netlify event
    const mockEvent = {
      body: imageBuffer.toString('base64'),
      headers: {
        'x-caption': caption,
        'x-brand-color': brandColor
      }
    };

    console.log(`📸 Processing image: ${imageBuffer.length} bytes`);
    console.log(`📝 Caption: "${caption}"`);
    console.log(`🎨 Brand color: ${brandColor}`);

    // Call the overlay function
    const result = await handler(mockEvent);

    if (result.statusCode === 200) {
      const outputBuffer = Buffer.from(result.body, 'base64');
      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Length': outputBuffer.length
      });
      res.send(outputBuffer);
      console.log(`✅ Success! Output: ${outputBuffer.length} bytes`);
    } else {
      res.status(result.statusCode).json(JSON.parse(result.body));
    }

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Simple test form
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Instagram Overlay Tester</title></head>
      <body style="font-family: Arial; padding: 20px;">
        <h1>🎨 Instagram Overlay Tester</h1>
        <form action="/test-overlay" method="post" enctype="multipart/form-data">
          <div style="margin: 10px 0;">
            <label>Image File:</label><br>
            <input type="file" name="image" accept="image/*" required>
          </div>
          <div style="margin: 10px 0;">
            <label>Caption:</label><br>
            <input type="text" name="caption" value="A magnificent bull moose in the wild." style="width: 300px;">
          </div>
          <div style="margin: 10px 0;">
            <label>Brand Color:</label><br>
            <input type="color" name="brandColor" value="#667eea">
          </div>
          <div style="margin: 20px 0;">
            <button type="submit" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px;">
              Generate Instagram Image
            </button>
          </div>
        </form>
        
        <h3>📋 Testing Instructions:</h3>
        <ol>
          <li>Upload any image (preferably an OG image 1200x630)</li>
          <li>Enter your caption text</li>
          <li>Choose your brand color</li>
          <li>Click "Generate Instagram Image"</li>
          <li>The processed 16:9 image will download automatically</li>
        </ol>
        
        <h3>🧪 Alternative Testing:</h3>
        <p>You can also test with curl:</p>
        <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
curl -X POST http://localhost:3000/test-overlay \\
  -H "Content-Type: application/octet-stream" \\
  -H "x-caption: Your test caption" \\
  -H "x-brand-color: #667eea" \\
  --data-binary "@your-image.jpg" \\
  --output result.jpg
        </pre>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Test server running at http://localhost:${PORT}`);
  console.log(`📝 Open http://localhost:${PORT} to test the overlay function`);
  console.log(`🎯 Or use the /test-overlay endpoint directly`);
});
