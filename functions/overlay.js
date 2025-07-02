const sharp = require('sharp');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const parser = require('lambda-multipart-parser');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Helper function to wrap text with balanced line splitting
function wrapText(context, text, maxWidth) {
    const words = text.split(' ');
    
    // Try to measure text, but handle measurement failures
    let canMeasure = true;
    try {
        const testWidth = context.measureText(text).width;
        if (testWidth < 10 || isNaN(testWidth)) {
            canMeasure = false;
            console.log('[FALLBACK] Text measurement returned invalid result, using word-based wrapping');
        }
    } catch (error) {
        canMeasure = false;
        console.log('[FALLBACK] Text measurement not available, using word-based wrapping');
    }
    
    // If text measurement works and fits on one line, return as is
    if (canMeasure && context.measureText(text).width <= maxWidth) {
        return [text];
    }
    
    // For two-line splitting, find the best midpoint
    if (words.length >= 4) {
        const midPoint = Math.floor(words.length / 2);
        
        if (canMeasure) {
            // Try different split points around the midpoint to find the most balanced
            let bestSplit = midPoint;
            let bestBalance = Infinity;
            
            for (let i = Math.max(1, midPoint - 2); i <= Math.min(words.length - 1, midPoint + 2); i++) {
                const firstLine = words.slice(0, i).join(' ');
                const secondLine = words.slice(i).join(' ');
                
                const firstWidth = context.measureText(firstLine).width;
                const secondWidth = context.measureText(secondLine).width;
                
                // Check if both lines fit within maxWidth
                if (firstWidth <= maxWidth && secondWidth <= maxWidth) {
                    // Calculate balance score (lower is better)
                    const balance = Math.abs(firstWidth - secondWidth);
                    if (balance < bestBalance) {
                        bestBalance = balance;
                        bestSplit = i;
                    }
                }
            }
            
            const firstLine = words.slice(0, bestSplit).join(' ');
            const secondLine = words.slice(bestSplit).join(' ');
            
            // Verify both lines fit
            if (context.measureText(firstLine).width <= maxWidth && 
                context.measureText(secondLine).width <= maxWidth) {
                return [firstLine, secondLine];
            }
        } else {
            // Fallback: split at midpoint when measurement fails
            console.log(`[FALLBACK] Using midpoint split for ${words.length} words`);
            const firstLine = words.slice(0, midPoint).join(' ');
            const secondLine = words.slice(midPoint).join(' ');
            console.log(`[FALLBACK] Split into: "${firstLine}" | "${secondLine}"`);
            return [firstLine, secondLine];
        }
    }
    
    // For shorter text without measurement, try simple word-based splitting
    if (!canMeasure && words.length >= 2) {
        const midPoint = Math.floor(words.length / 2);
        const firstLine = words.slice(0, midPoint).join(' ');
        const secondLine = words.slice(midPoint).join(' ');
        console.log(`[FALLBACK] Simple split: "${firstLine}" | "${secondLine}"`);
        return [firstLine, secondLine];
    }
    
    // Fallback to original greedy wrapping if balanced splitting fails
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
    try {
      const fontPath = path.join(__dirname, '..', 'fonts', 'RobotoCondensed-Regular.ttf');
      GlobalFonts.registerFromPath(fontPath, 'Roboto Condensed');
      fontFamily = 'Roboto Condensed, Arial, sans-serif';
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
    
    // Cap box width at image width to prevent composite errors
    const maxBoxWidth = outputWidth - 20; // Leave 10px margin on each side
    const calculatedBoxWidth = Math.ceil(longestLineWidth) + (padding * 2);
    const boxWidth = Math.min(calculatedBoxWidth, maxBoxWidth);
    
    console.log(`[DEBUG] Calculated box width: ${calculatedBoxWidth}px, capped at: ${boxWidth}px (max: ${maxBoxWidth}px)`);

    // Calculate box height based on number of text lines
    const lineSpacing = 2; // 2px spacing between lines
    const totalTextHeight = (textHeight * lines.length) + (lineSpacing * Math.max(0, lines.length - 1));
    const boxHeight = totalTextHeight + (padding * 2); // padding on top and bottom
    
    console.log(`[DEBUG] Lines: ${lines.length}, text height per line: ${textHeight}px, total text height: ${totalTextHeight}px, box height: ${boxHeight}px`);

    // Calculate final positions with boundary checking
    let boxLeft = Math.round((outputWidth - boxWidth) / 2);
    let boxTop = Math.round(outputHeight - boxHeight - overlayPixelShiftUp);
    
    // Ensure overlay stays within image boundaries
    boxLeft = Math.max(0, Math.min(boxLeft, outputWidth - boxWidth));
    boxTop = Math.max(0, Math.min(boxTop, outputHeight - boxHeight));
    
    // Additional debug logging for boundary checking
    console.log(`[DEBUG] Image dimensions: ${outputWidth}x${outputHeight}px`);
    console.log(`[DEBUG] Overlay boundaries check: boxLeft=${boxLeft}, boxTop=${boxTop}, boxRight=${boxLeft + boxWidth}, boxBottom=${boxTop + boxHeight}`);

    // Canvas text rendering is completely broken on server - switch to Sharp-based SVG text
    console.log(`[DEBUG] Canvas text rendering failed on server, switching to Sharp-based SVG overlay`);
    
    // Create text overlay using Sharp SVG (more reliable on server)
    const textTop = boxTop + padding - 6; // Move text up 6 pixels
    const textLines = lines.map((line, index) => {
      const yPosition = textTop + (index * (fontSize + 2)) + fontSize; // Adjust for SVG baseline
      // Escape text content to prevent control characters
      const escapedLine = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      return `<text x="${boxLeft + (boxWidth / 2)}" y="${yPosition}" 
                    font-family="Arial, sans-serif" 
                    font-size="${fontSize}" 
                    fill="white" 
                    text-anchor="middle" 
                    dominant-baseline="text-before-edge">${escapedLine}</text>`;
    }).join('\n');
    
    const svgOverlay = `
      <svg width="${outputWidth}" height="${outputHeight}" xmlns="http://www.w3.org/2000/svg">
        <!-- Background box with rounded corners -->
        <rect x="${boxLeft}" y="${boxTop}" width="${boxWidth}" height="${boxHeight}" 
              fill="rgba(0,0,0,0.85)" rx="5" ry="5"/>
        <!-- Text lines -->
        ${textLines}
      </svg>
    `;
    
    console.log(`[DEBUG] Created SVG overlay with ${lines.length} text lines`);
    console.log(`[DEBUG] SVG dimensions: ${outputWidth}x${outputHeight}`);
    console.log(`[DEBUG] Text box: ${boxLeft},${boxTop} ${boxWidth}x${boxHeight}`);
    console.log(`[DEBUG] Font family: ${fontFamily}`);
    console.log(`[DEBUG] SVG font: ${fontSize}px Arial`);
    console.log(`[DEBUG] First line preview:`, lines[0] ? lines[0].substring(0, 50) : 'NO LINES');
    console.log(`[DEBUG] Using SVG rendering since Canvas text is broken on server`);
    
    // Convert SVG to buffer for Sharp composite
    const overlayBuffer = Buffer.from(svgOverlay);
    console.log(`[DEBUG] SVG overlay buffer created:`, overlayBuffer.length, 'bytes');

    // Process image: resize and composite single overlay
    let outputBuffer;
    try {
      console.log(`[DEBUG] About to composite full-size overlay: ${outputWidth}x${outputHeight} on ${outputWidth}x${outputHeight} image`);
      outputBuffer = await sharp(imageBuffer)
        .resize(outputWidth, outputHeight, { 
          fit: 'cover', 
          position: 'center',
          withoutEnlargement: false
        })
        .composite([{ input: overlayBuffer }])
        .jpeg({ quality: 100 })
        .toBuffer();
      console.log(`[DEBUG] Composite operation successful, output size: ${outputBuffer.length} bytes`);
    } catch (compositeError) {
      console.error('[ERROR] Composite operation failed:', compositeError.message);
      console.error('[ERROR] Overlay dimensions:', boxWidth, 'x', boxHeight);
      console.error('[ERROR] Overlay position:', boxLeft, ',', boxTop);
      console.error('[ERROR] Image dimensions:', outputWidth, 'x', outputHeight);
      throw new Error(`Image processing failed: ${compositeError.message}`);
    }

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