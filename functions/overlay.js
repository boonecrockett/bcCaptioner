const sharp = require('sharp');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const parser = require('lambda-multipart-parser');
const path = require('path');

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
    const lineHeight = fontSize * 1.2; // For multi-line text
    const horizontalPadding = -14; // Added 3px back to width (6px total, 3px on each side)
    const verticalPadding = 10; // 5px top, 5px bottom
    const topPadding = verticalPadding / 2;
    const overlayPixelShiftUp = 13;

    // --- Set up Canvas for Text Measurement ---
    const canvas = createCanvas(200, 200); // Dummy canvas
    // Register the font with error handling
    let fontFamily = 'Arial, sans-serif'; // Default fallback
    try {
      const fontPath = path.join(__dirname, '..', 'fonts', 'RobotoCondensed-Bold.ttf');
      GlobalFonts.registerFromPath(fontPath, 'Roboto Condensed Bold');
      fontFamily = 'Roboto Condensed Bold, Arial, sans-serif';
      console.log('Custom font loaded successfully');
    } catch (error) {
      console.warn('Custom font failed to load, using fallback:', error.message);
    }

    const context = canvas.getContext('2d');
    context.font = `${fontSize}px "${fontFamily}"`;

    // --- Define Safe Zone and Wrap Text ---
    // Set the maximum width for the text, leaving a margin on the sides of the image.
    const maxTextWidth = outputWidth - 80 - (horizontalPadding * 2); // 40px margin on each side
    const lines = wrapText(context, caption, maxTextWidth);

    // --- Calculate Dynamic Box Dimensions ---
    let longestLineWidth = Math.max(...lines.map(line => context.measureText(line).width));
    
    // Fallback for server measurement issues
    if (longestLineWidth < 10 || isNaN(longestLineWidth)) {
        console.warn('[FALLBACK] Text measurement failed, using character-based estimation');
        const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '');
        longestLineWidth = longestLine.length * (fontSize * 0.6); // Rough character width estimation
        console.log(`[FALLBACK] Estimated width: ${longestLineWidth}px for ${longestLine.length} characters`);
    }
    
    // Add generous padding to prevent clipping due to font rendering differences
    const boxWidth = Math.ceil(longestLineWidth * 1.1) + (horizontalPadding * 2) + 40; // 10% safety margin + extra padding + 10px each side

    // Calculate box height based on the number of lines and line height, plus padding.
    const boxHeight = (lines.length * lineHeight) + verticalPadding;

    // Calculate the Y position for the text to be vertically centered.
    // This positions the vertical center of the first line of text.
    const textY = topPadding + (lineHeight / 2) + 5; // Move text down 5px (4px + 1px additional)

    // --- Create Combined Background and Text SVG ---
    const textElements = lines.map((line, index) => 
        `<tspan x="50%" dy="${index === 0 ? 0 : lineHeight}px">${line}</tspan>`
    ).join('');

    const combinedSvg = `
      <svg width="${boxWidth}" height="${boxHeight}">
        <!-- Background Box -->
        <rect
          x="0"
          y="0"
          width="${boxWidth}"
          height="${boxHeight}"
          rx="5"
          ry="5"
          style="fill:#000000;fill-opacity:0.95;"
        />
        <!-- Text -->
        <text
          x="50%"
          y="${textY}"
          dominant-baseline="middle"
          text-anchor="middle"
          fill="#FFFFFF"
          font-family="${fontFamily}"
          font-size="${fontSize}"
          font-weight="bold"
        >
          ${textElements}
        </text>
      </svg>
    `;

    // --- Calculate final positions ---
    const boxLeft = Math.round((outputWidth - boxWidth) / 2);
    const boxTop = Math.round(outputHeight - boxHeight - overlayPixelShiftUp);
    
    // Text is positioned with the box
    console.log(`[DEBUG] Text lines: ${lines.length}`);
    console.log(`[DEBUG] Lines content:`, lines);
    console.log(`[DEBUG] Longest line width: ${longestLineWidth}px`);
    console.log(`[DEBUG] Box dimensions: ${boxWidth}x${boxHeight}px`);
    console.log(`[DEBUG] Box position: left=${boxLeft}, top=${boxTop}`);
    console.log(`[DEBUG] Text position: left=${boxLeft}, top=${boxTop + 4}`);
    console.log(`[DEBUG] Font family: ${fontFamily}`);
    console.log(`[DEBUG] Text Y position: ${textY}`);
    console.log(`[DEBUG] Text elements:`, textElements);
    console.log(`[DEBUG] Combined SVG preview:`, combinedSvg.substring(0, 400) + '...');
    console.log(`[DEBUG] SVG text element details: x=50%, y=${textY}, font=${fontFamily}, size=${fontSize}`);
    console.log(`[DEBUG] First line preview:`, lines[0] ? lines[0].substring(0, 50) : 'NO LINES');
    
    // Test simple SVG text rendering
    const testSvg = `<svg width="200" height="50"><text x="10" y="25" fill="white" font-family="Arial" font-size="16">TEST</text></svg>`;
    console.log(`[DEBUG] Simple SVG test:`, testSvg);

    // Process image: resize and composite single overlay
    const outputBuffer = await sharp(imageBuffer)
      .resize(outputWidth, outputHeight, { 
        fit: 'cover', 
        position: 'center',
        withoutEnlargement: false
      })
      .composite([
        { input: Buffer.from(combinedSvg), top: boxTop, left: boxLeft }
      ])
      .jpeg({ 
        quality: 100,
        progressive: true,
        mozjpeg: true
      })
      .toBuffer();

    console.log(`Output image size: ${outputBuffer.length} bytes`);

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-cache', // Disable cache for testing
        'Content-Length': outputBuffer.length.toString()
      },
      body: outputBuffer.toString('base64'),
      isBase64Encoded: true
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