const sharp = require('sharp');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const parser = require('lambda-multipart-parser');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Helper function to wrap text
function wrapText(context, text, maxWidth) {
    const words = text.split(' ');
    let lines = [];
    let currentLine = words[0] || '';

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = context.measureText(currentLine + ' ' + word).width;
        if (width < maxWidth) {
            currentLine += ' ' + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

exports.handler = async (event) => {
  try {
    // Check if this is a request for a cached image first
    const queryParams = event.queryStringParameters || {};
    if (queryParams.serve === 'image' && queryParams.id) {
      // Retrieve cached image
      global.imageCache = global.imageCache || new Map();
      const cachedImage = global.imageCache.get(queryParams.id);
      
      if (!cachedImage) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Image not found or expired' })
        };
      }
      
      // Serve the cached image
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
          'Content-Length': cachedImage.buffer.length.toString()
        },
        body: cachedImage.buffer.toString('base64'),
        isBase64Encoded: true
      };
    }

    let caption, brandColor, imageBuffer;

    // Check for multipart/form-data, typically from n8n
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    if (contentType && contentType.includes('multipart/form-data')) {
      const result = await parser.parse(event);
      const imageFile = result.files.find(f => f.fieldname === 'image' || f.fieldname === 'file');
      
      if (!imageFile) {
        throw new Error('Image file not found in multipart form data. Please use field name "image" or "file".');
      }

      imageBuffer = imageFile.content;
      caption = (result.caption && result.caption.toString('utf-8')) || 'Default Caption';
      brandColor = (result.brandColor && result.brandColor.toString('utf-8')) || '#667eea';

    } else {
      // Fallback to original method (base64 body and headers)
      caption = event.headers['x-caption'] || 'Default Caption';
      brandColor = event.headers['x-brand-color'] || '#667eea';
      imageBuffer = Buffer.from(event.body, 'base64');
    }

    // Validate input
    if (!imageBuffer || imageBuffer.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No image data provided' })
      };
    }

    // Get image metadata for responsive overlay
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`Processing image: ${metadata.width}x${metadata.height}`);

    const outputWidth = 1200;
    const outputHeight = 628;

    // --- Text and Box Styling ---
    const fontSize = 30;
    const textHeight = fontSize; // Text height matches font size
    const padding = 10; // 10px padding on all sides (doubled with text size)
    const overlayPixelShiftUp = 13;

    // --- Set up Canvas for Text Measurement ---
    let fontFamily = 'Arial, sans-serif'; // Default fallback
    let fontLoaded = false;
    
    try {
      const fontPath = path.join(__dirname, '..', 'fonts', 'OpenSans-Regular.ttf');
      console.log(`Attempting to load font from: ${fontPath}`);
      
      // Check if font file exists
      await fs.access(fontPath);
      console.log('Font file exists, registering...');
      
      // Register Open Sans font (known to work well with @napi-rs/canvas)
      const success = GlobalFonts.registerFromPath(fontPath, 'Open Sans');
      
      if (success) {
        // Verify registration
        const availableFonts = GlobalFonts.families;
        console.log('Available fonts after registration:', availableFonts.slice(-3)); // Show last 3
        
        fontFamily = 'Open Sans, Arial, sans-serif';
        fontLoaded = true;
        console.log('✅ Open Sans font loaded successfully for Netlify compatibility');
      } else {
        console.warn('⚠️ Open Sans font registration failed, trying fallback registration');
        
        // Try without explicit name as fallback
        const fallbackSuccess = GlobalFonts.registerFromPath(fontPath);
        if (fallbackSuccess) {
          const availableFonts = GlobalFonts.families;
          const lastFont = availableFonts[availableFonts.length - 1];
          fontFamily = `${lastFont}, Arial, sans-serif`;
          fontLoaded = true;
          console.log(`✅ Font loaded with automatic name: ${lastFont}`);
        }
      }
    } catch (error) {
      console.warn('❌ Custom font failed to load, using Arial fallback:', error.message);
      console.warn('Font path attempted:', path.join(__dirname, '..', 'fonts', 'OpenSans-Regular.ttf'));
    }

    const measureCanvas = createCanvas(200, 100);
    const measureContext = measureCanvas.getContext('2d');
    measureContext.font = `${fontSize}px "${fontFamily.split(',')[0].replace(/"/g, '')}"`;

    // --- Define Safe Zone and Wrap Text ---
    // Set the maximum width for the text, leaving a margin on the sides of the image.
    const maxTextWidth = outputWidth - 100; // Leave margin for centering
    const lines = wrapText(measureContext, caption, maxTextWidth);

    // --- Calculate Exact Box Dimensions ---
    let longestLineWidth = Math.max(...lines.map(line => measureContext.measureText(line).width));
    
    // Fallback for server measurement issues
    if (longestLineWidth < 10 || isNaN(longestLineWidth)) {
        console.warn('[FALLBACK] Text measurement failed, using character-based estimation');
        const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '');
        longestLineWidth = longestLine.length * (fontSize * 0.6); // Rough character width estimation
        console.log(`[FALLBACK] Estimated width: ${longestLineWidth}px for ${longestLine.length} characters`);
    }
    
    // Exact box sizing: text width + 5px padding on each side
    const boxWidth = Math.ceil(longestLineWidth) + (padding * 2); // 5px left + 5px right

    // Exact box height: text height + 5px padding on top and bottom, reduced by 10px
    const boxHeight = textHeight + (padding * 2) - 10; // 5px top + 5px bottom, minus 10px

    // Calculate final positions
    const boxLeft = Math.round((outputWidth - boxWidth) / 2);
    const boxTop = Math.round(outputHeight - boxHeight - overlayPixelShiftUp);

    // --- Create Canvas-based Text Overlay (more reliable than SVG on server) ---
    const canvas = createCanvas(boxWidth, boxHeight);
    const canvasContext = canvas.getContext('2d');
    
    // Set up canvas for text rendering with rounded corners
    canvasContext.fillStyle = 'rgba(0, 0, 0, 0.85)';
    const cornerRadius = 5; // A bit more rounded corners
    
    // Draw rounded rectangle
    canvasContext.beginPath();
    canvasContext.roundRect(0, 0, boxWidth, boxHeight, cornerRadius);
    canvasContext.fill();
    
    // Configure text rendering
    canvasContext.fillStyle = 'white';
    const fontName = fontLoaded ? fontFamily.split(',')[0].trim() : 'Arial';
    canvasContext.font = `${fontSize}px "${fontName}"`;
    canvasContext.textAlign = 'center';
    canvasContext.textBaseline = 'middle';
    
    console.log(`[DEBUG] Using font: ${fontName} (loaded: ${fontLoaded})`);
    console.log(`[DEBUG] Canvas font string: ${canvasContext.font}`);
    console.log(`[DEBUG] Font family: ${fontFamily}`);
    
    // Draw text exactly in the center of the box (5px padding accounted for)
    const textX = boxWidth / 2;
    const textY = (boxHeight / 2) - 2; // Move text up by 2 pixels (was 4, now moved down 2)
    canvasContext.fillText(lines[0], textX, textY); // Single line for now
    
    // Convert canvas to buffer
    const overlayBuffer = canvas.toBuffer('image/png');
    
    console.log(`[DEBUG] Text lines: ${lines.length}`);
    console.log(`[DEBUG] Lines content:`, lines);
    console.log(`[DEBUG] Longest line width: ${longestLineWidth}px`);
    console.log(`[DEBUG] Box dimensions: ${boxWidth}x${boxHeight}px`);
    console.log(`[DEBUG] Box position: left=${boxLeft}, top=${boxTop}`);
    console.log(`[DEBUG] Text position: left=${boxLeft}, top=${boxTop + 4}`);
    console.log(`[DEBUG] Font family: ${fontFamily}`);
    console.log(`[DEBUG] Font loaded: ${fontLoaded}`);
    console.log(`[DEBUG] Canvas font: ${canvasContext.font}`);
    console.log(`[DEBUG] First line preview:`, lines[0] ? lines[0].substring(0, 50) : 'NO LINES');
    console.log(`[DEBUG] Using Canvas rendering instead of SVG to avoid fontconfig issues`);

    // Process image: resize and composite single overlay
    const outputBuffer = await sharp(imageBuffer)
      .resize(outputWidth, outputHeight, { 
        fit: 'cover', 
        position: 'center',
        withoutEnlargement: false
      })
      .composite([{ input: overlayBuffer, left: boxLeft, top: boxTop }])
      .jpeg({ quality: 100 })
      .toBuffer();

    console.log(`Output image size: ${outputBuffer.length} bytes`);

    // Generate unique ID for this image
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(outputBuffer).digest('hex').substring(0, 8);
    const imageId = `${timestamp}-${hash}`;
    
    // Store image data in memory cache (simple approach)
    global.imageCache = global.imageCache || new Map();
    global.imageCache.set(imageId, {
      buffer: outputBuffer,
      timestamp: timestamp,
      caption: caption
    });
    
    // Clean up old entries (keep only last 10)
    if (global.imageCache.size > 10) {
      const entries = Array.from(global.imageCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < entries.length - 10; i++) {
        global.imageCache.delete(entries[i][0]);
      }
    }
    
    // Create URL for the image
    const baseUrl = process.env.URL || 'https://bccaptioner.netlify.app';
    const imageUrl = `${baseUrl}/.netlify/functions/overlay?serve=image&id=${imageId}`;
    
    console.log(`Image cached with ID: ${imageId}`);
    console.log(`Image URL: ${imageUrl}`);

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        success: true,
        imageUrl: imageUrl,
        imageId: imageId,
        size: outputBuffer.length,
        caption: caption
      })
    };

  } catch (err) {
    console.error('Image processing error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Image processing failed',
        message: err.message 
      })
    };
  }
};