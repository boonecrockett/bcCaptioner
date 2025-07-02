const fs = require('fs').promises;
const path = require('path');

exports.handler = async (event) => {
  try {
    // Extract filename from the path
    const filename = event.path.split('/').pop();
    
    if (!filename || !filename.match(/^overlay-\d+-[a-f0-9]{8}\.jpg$/)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid filename format' })
      };
    }
    
    const tempPath = `/tmp/${filename}`;
    
    // Check if file exists
    try {
      await fs.access(tempPath);
    } catch (err) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'File not found or expired' })
      };
    }
    
    // Read and serve the file
    const imageBuffer = await fs.readFile(tempPath);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        'Content-Length': imageBuffer.length.toString()
      },
      body: imageBuffer.toString('base64'),
      isBase64Encoded: true
    };
    
  } catch (err) {
    console.error('Error serving temporary file:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to serve file' })
    };
  }
};
