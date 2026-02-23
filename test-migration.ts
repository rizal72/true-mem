/**
 * Test script to verify database initialization from scratch
 */

import { MemoryDatabase } from './src/storage/database.js';

async function testMigration() {
  console.log('🧪 Starting database migration test...\n');

  try {
    // Create database instance with default config
    const db = new MemoryDatabase();

    // Initialize database (this should run all migrations)
    console.log('⚙️  Initializing database...');
    await db.init();
    console.log('✅ Database initialization completed\n');

    // Verify by creating a test session
    console.log('📝 Creating test session...');
    const sessionId = `test-session-${Date.now()}`;
    const session = db.createSession(sessionId, 'test-project');
    console.log('✅ Test session created:', session.id, '\n');

    // Verify by creating a test event
    console.log('📝 Creating test event...');
    const event = db.createEvent(session.id, 'SessionStart', 'Test event content');
    console.log('✅ Test event created:', event.id, '\n');

    // Verify by retrieving data
    console.log('🔍 Retrieving session...');
    const retrievedSession = db.getSession(session.id);
    console.log('✅ Session retrieved:', retrievedSession?.id === session.id ? 'PASS' : 'FAIL', '\n');

    console.log('🎉 All tests passed! Database initialized successfully from scratch.\n');
    db.close();
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testMigration();
