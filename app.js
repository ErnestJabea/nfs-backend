/**
 * NFS Backend - Root Application Entry Point for cPanel (Phusion Passenger)
 * 
 * cPanel's Node.js Selector requires an entry script in the project root.
 * This wrapper loads the compiled TypeScript distribution from dist/index.js.
 */

// Load environment variables before importing app
require('dotenv').config();

// Ensure dist/index.js is loaded
try {
  require('./dist/index.js');
  console.log('[cPanel App] Successfully booted NFS Backend via app.js');
} catch (error) {
  console.error('[cPanel App Error] Failed to start NFS Backend via app.js:', error);
  process.exit(1);
}
