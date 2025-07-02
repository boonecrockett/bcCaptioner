const sharp = require('sharp');
const { Canvas } = require('skia-canvas');
const parser = require('lambda-multipart-parser');

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
        throw new Error('Image file not found in multipart form data. Please use field name \"image\" or \"file\".');
      }

      imageBuffer = imageFile.content;
      caption = result.fields.caption || 'Default Caption';
      brandColor = result.fields.brandColor || '#667eea';

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
    const horizontalPadding = 11; // 11px on each side
    const verticalPadding = 6; // 3px top, 3px bottom
    const topPadding = verticalPadding / 2;
    const overlayPixelShiftUp = 13;

    // --- Set up Canvas for Text Measurement ---
    const canvas = new Canvas(200, 200); // Dummy canvas
    const context = canvas.getContext('2d');
    context.font = `bold ${fontSize}px "Arial Narrow"`;

    // --- Define Safe Zone and Wrap Text ---
    // The safe zone is the width of the square crop (628px) minus some padding
    const maxTextWidth = outputHeight - (horizontalPadding * 2);
    const lines = wrapText(context, caption, maxTextWidth);

    // --- Calculate Dynamic Box Dimensions ---
    const longestLineWidth = Math.max(...lines.map(line => context.measureText(line).width));
    const boxWidth = longestLineWidth + (horizontalPadding * 2);

    // Calculate box height based on the number of lines and line height, plus padding.
    const boxHeight = (lines.length * lineHeight) + verticalPadding;

    // Calculate the Y position for the text to be vertically centered.
    // This positions the vertical center of the first line of text.
    const textY = topPadding + (lineHeight / 2);

    // --- Create Multi-line Text SVG ---
    const textElements = lines.map((line, index) => 
        `<tspan x="50%" dy="${index === 0 ? 0 : lineHeight}px">${line}</tspan>`
    ).join('');

    const textSvg = `
      <svg width="${boxWidth}" height="${boxHeight}">
        <text
          x="50%"
          y="${textY}"
          dominant-baseline="middle"
          text-anchor="middle"
          fill="#FFFFFF"
          font-family="Arial Narrow, sans-serif"
          font-size="${fontSize}"
          font-weight="bold"
        >
          ${textElements}
        </text>
      </svg>
    `;

    // --- Create Background Box SVG ---
    const boxSvg = `
      <svg width="${boxWidth}" height="${boxHeight}">
        <rect
          x="0"
          y="0"
          width="${boxWidth}"
          height="${boxHeight}"
          rx="5"
          ry="5"
          style="fill:#000000;fill-opacity:0.95;"
        />
      </svg>
    `;

    // --- Calculate final positions ---
    const boxLeft = Math.round((outputWidth - boxWidth) / 2);
    const boxTop = Math.round(outputHeight - boxHeight - overlayPixelShiftUp);
    
    // Text is positioned with the box
    const textLeft = boxLeft;
    const textTop = boxTop + 4; // Manual vertical adjustment

    console.log(`[DEBUG] boxTop: ${boxTop}, textTop: ${textTop}`);

    // Process image: resize and composite layers
    const outputBuffer = await sharp(imageBuffer)
      .resize(outputWidth, outputHeight, { 
        fit: 'cover', 
        position: 'center',
        withoutEnlargement: false
      })
      .composite([
        { input: Buffer.from(boxSvg), top: boxTop, left: boxLeft },
        { input: Buffer.from(textSvg), top: textTop, left: textLeft }
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
