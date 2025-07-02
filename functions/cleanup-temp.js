const fs = require('fs').promises;
const path = require('path');

exports.handler = async (event) => {
  try {
    const tempDir = '/tmp';
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    const now = Date.now();
    
    // Read all files in temp directory
    const files = await fs.readdir(tempDir);
    const overlayFiles = files.filter(file => file.startsWith('overlay-') && file.endsWith('.jpg'));
    
    let deletedCount = 0;
    let totalCount = overlayFiles.length;
    
    for (const file of overlayFiles) {
      const filePath = path.join(tempDir, file);
      
      try {
        const stats = await fs.stat(filePath);
        const fileAge = now - stats.mtime.getTime();
        
        if (fileAge > maxAge) {
          await fs.unlink(filePath);
          deletedCount++;
          console.log(`Deleted expired file: ${file}`);
        }
      } catch (err) {
        console.warn(`Could not process file ${file}:`, err.message);
      }
    }
    
    console.log(`Cleanup complete: ${deletedCount}/${totalCount} files deleted`);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Cleanup complete: ${deletedCount}/${totalCount} files deleted`,
        deletedCount,
        totalCount
      })
    };
    
  } catch (err) {
    console.error('Cleanup error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false,
        error: 'Cleanup failed',
        message: err.message 
      })
    };
  }
};
