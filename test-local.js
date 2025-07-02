const fs = require('fs');
const path = require('path');
const { handler } = require('./functions/overlay');

async function testOverlay() {
  try {
    // Create a test image (you can replace this with any image file)
    const testImagePath = './vt-staterecords-fb.jpg';
    
    // Check if test image exists
    if (!fs.existsSync(testImagePath)) {
      console.log('❌ Test image not found. Please add a test-image.jpg file to the project root.');
      console.log('You can download any OG image from your website for testing.');
      return;
    }

    // Read test image
    const imageBuffer = fs.readFileSync(testImagePath);
    const base64Image = imageBuffer.toString('base64');

    // Mock Netlify event
    const mockEvent = {
      body: base64Image,
      headers: {
        'x-caption': 'This is a medium length caption that should show how the background resizes',
        'x-brand-color': '#667eea'
      }
    };

    console.log('🚀 Testing overlay function locally...');
    console.log(`📸 Input image size: ${imageBuffer.length} bytes`);
    console.log(`📝 Caption: "${mockEvent.headers['x-caption']}"`);
    console.log(`🎨 Brand color: ${mockEvent.headers['x-brand-color']}`);

    // Call the function
    const result = await handler(mockEvent);

    if (result.statusCode === 200) {
      // Save the result
      const outputBuffer = Buffer.from(result.body, 'base64');
      const outputPath = './test-output.jpg';
      fs.writeFileSync(outputPath, outputBuffer);
      
      console.log('✅ Success!');
      console.log(`📤 Output image size: ${outputBuffer.length} bytes`);
      console.log(`💾 Saved to: ${outputPath}`);
      console.log('🎉 Open test-output.jpg to see the result!');
    } else {
      console.log('❌ Error:', result.statusCode);
      console.log(result.body);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testOverlay();
