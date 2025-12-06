const { getStore } = require('@netlify/blobs');

// Helper to get blob store with proper configuration for V1 functions
function getBlobStore() {
  const siteID = process.env.BLOB_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  
  if (!siteID || !token) {
    throw new Error(`Blob storage not configured. BLOB_SITE_ID: ${!!siteID}, BLOB_TOKEN: ${!!token}`);
  }
  
  return getStore({
    name: 'instagram-overlays',
    siteID,
    token
  });
}

/**
 * Serves images from Netlify Blobs with clean public URLs.
 * URL pattern: /images/:id.jpg
 * Example: /images/1733512345-abc123.jpg
 */
exports.handler = async (event) => {
  // Handle OPTIONS preflight requests for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  try {
    // Extract image ID from query parameter (passed via redirect)
    const queryParams = event.queryStringParameters || {};
    let imageId = queryParams.id;
    
    // Strip .jpg extension if present (from URL like /images/123-abc.jpg)
    if (imageId && imageId.endsWith('.jpg')) {
      imageId = imageId.slice(0, -4);
    }
    
    if (!imageId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing image ID. Expected: /images/:id.jpg' })
      };
    }
    
    console.log(`[IMAGE] Serving image ID: ${imageId}`);
    
    // Retrieve image from Netlify Blobs
    const store = getBlobStore();
    const imageData = await store.get(`overlays/${imageId}.jpg`, { type: 'arrayBuffer' });
    
    if (!imageData) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Image not found' })
      };
    }
    
    // Serve the image with headers compatible with Instagram Container API
    const buffer = Buffer.from(imageData);
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': buffer.length.toString(),
        // CORS headers for external services like Instagram
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
    
  } catch (err) {
    console.error('Image serving error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to serve image',
        message: err.message 
      })
    };
  }
};
