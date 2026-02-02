/**
 * Minimal compatibility shim for `loadFixture` used in tests.
 * This simply calls the fixture function to produce a fresh deployment object.
 * It does not use snapshots, but provides functional parity for tests.
 */
export async function loadFixture(fixture) {
  // Call the fixture function to deploy fresh contracts for the test
  return await fixture();
}
