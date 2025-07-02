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
    const fontSize = 15;
    const textHeight = 15; // Exact text height as requested
    const padding = 5; // 5px padding on all sides
    const overlayPixelShiftUp = 13;

    // --- Set up Canvas for Text Measurement ---
    let fontFamily = 'Arial, sans-serif'; // Default fallback
    try {
      const fontPath = path.join(__dirname, '..', 'fonts', 'RobotoCondensed-Bold.ttf');
      GlobalFonts.registerFromPath(fontPath, 'Roboto Condensed Bold');
      fontFamily = 'Roboto Condensed Bold, Arial, sans-serif';
      console.log('Custom font loaded successfully');
    } catch (error) {
      console.warn('Custom font failed to load, using fallback:', error.message);
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

    // Exact box height: text height + 5px padding on top and bottom
    const boxHeight = textHeight + (padding * 2); // 5px top + 5px bottom

    // Calculate final positions
    const boxLeft = Math.round((outputWidth - boxWidth) / 2);
    const boxTop = Math.round(outputHeight - boxHeight - overlayPixelShiftUp);

    // --- Create Canvas-based Text Overlay (more reliable than SVG on server) ---
    const canvas = createCanvas(boxWidth, boxHeight);
    const canvasContext = canvas.getContext('2d');
    
    // Set up canvas for text rendering with rounded corners
    canvasContext.fillStyle = 'rgba(0, 0, 0, 0.95)';
    const cornerRadius = 3; // Slightly rounded corners
    
    // Draw rounded rectangle
    canvasContext.beginPath();
    canvasContext.roundRect(0, 0, boxWidth, boxHeight, cornerRadius);
    canvasContext.fill();
    
    // Configure text rendering
    canvasContext.fillStyle = 'white';
    canvasContext.font = `${fontSize}px "${fontFamily.split(',')[0].replace(/"/g, '')}"`;
    canvasContext.textAlign = 'center';
    canvasContext.textBaseline = 'middle';
    
    // Draw text exactly in the center of the box (5px padding accounted for)
    const textX = boxWidth / 2;
    const textY = (boxHeight / 2) - 1; // Move text up by 1 pixel
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
    console.log(`[DEBUG] Canvas font: ${fontSize}px "${fontFamily.split(',')[0].replace(/"/g, '')}"`);
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

    // Generate unique filename
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(outputBuffer).digest('hex').substring(0, 8);
    const filename = `overlay-${timestamp}-${hash}.jpg`;
    
    // Store image temporarily in /tmp directory
    const tempPath = `/tmp/${filename}`;
    await fs.writeFile(tempPath, outputBuffer);
    
    // Create URL for the temporary file
    const baseUrl = process.env.URL || 'https://bccaptioner.netlify.app';
    const imageUrl = `${baseUrl}/.netlify/functions/serve-temp/${filename}`;
    
    console.log(`Image stored temporarily at: ${tempPath}`);
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
        filename: filename,
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