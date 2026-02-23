// Test script to verify if eval('import()') bypasses runtime issues
// with loading @huggingface/transformers

console.log('Starting test-eval-import...');

try {
  console.log('Attempting to load @huggingface/transformers using eval...');
  
  // Use eval to dynamically import the module
  const transformersModule = await eval('import("@huggingface/transformers")');
  
  console.log('✅ Module loaded successfully!');
  console.log('Module exports:', Object.keys(transformersModule));
  
  // Check if pipeline function is available
  if ('pipeline' in transformersModule) {
    console.log('✅ pipeline function is available!');
    
    // Try to get the pipeline function reference
    const pipeline = transformersModule.pipeline;
    console.log('✅ pipeline function retrieved:', typeof pipeline);
    
    // Try to call it with a simple feature-extraction task
    console.log('Attempting to create a feature-extraction pipeline...');
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✅ Pipeline created successfully!');
    
    // Test it with a simple sentence
    const result = await extractor('Hello world');
    console.log('✅ Pipeline executed successfully!');
    console.log('Result shape:', Array.isArray(result) ? result.length : 'N/A');
    
  } else {
    console.error('❌ pipeline function NOT found in module exports');
  }
  
} catch (error) {
  console.error('❌ Error during test:', error);
  console.error('Error message:', error.message);
  console.error('Error stack:', error.stack);
}

console.log('Test completed.');
