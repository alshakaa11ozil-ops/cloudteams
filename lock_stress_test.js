// CloudTeams — Soft Lock Concurrency Stress Test
// Tests that exactly ONE request wins when 50 simultaneous
// lock requests are sent for the same file.
// Run: node lock_stress_test.js

const https = require('https');
const http = require('http');

// ─── CONFIGURATION ───────────────────────────────────────────
// Replace these values before running

const BASE_URL = 'http://localhost:3001'; // your local backend
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjYsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTc3OTE1NDYzMCwiZXhwIjoxNzc5NzU5NDMwfQ.kQJN82_W305wpUAXotOUy9D8thhWIJhuM-TLKqP1zb0'; // login and copy from localStorage
const TEAM_ID = 1;   // replace with your actual team ID
const FILE_ID = 1;   // replace with an unlocked file ID in that team

const CONCURRENT_REQUESTS = 100;
const RUNS = 20; // how many times to repeat the test
// ─────────────────────────────────────────────────────────────

function acquireLock() {
  return new Promise((resolve) => {
    const url = `${BASE_URL}/api/teams/${TEAM_ID}/files/${FILE_ID}/lock`;
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: (() => { try { return JSON.parse(data); } catch { return data; } })()
        });
      });
    });

    req.on('error', (err) => {
      resolve({ status: 0, body: { error: err.message } });
    });

    req.end();
  });
}

function releaseLock(lockToken) {
  return new Promise((resolve) => {
    const url = `${BASE_URL}/api/teams/${TEAM_ID}/files/${FILE_ID}/unlock`;
    const body = JSON.stringify({ lockToken });
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(url, options, (res) => {
      res.resume();
      resolve(res.statusCode);
    });

    req.on('error', () => resolve(0));
    req.write(body);
    req.end();
  });
}

async function runTest(runNumber) {
  console.log(`\n─── Run ${runNumber} of ${RUNS} ───`);
  console.log(`Firing ${CONCURRENT_REQUESTS} simultaneous lock requests...`);

  const startTime = Date.now();

  // Fire all requests at exactly the same time
  const results = await Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, () => acquireLock())
  );

  const duration = Date.now() - startTime;

  // Analyze results
  const successes = results.filter(r => r.status === 201);
  const conflicts  = results.filter(r => r.status === 409);
  const errors     = results.filter(r => r.status !== 201 && r.status !== 409);

  console.log(`\nResults (completed in ${duration}ms):`);
  console.log(`  ✓ Acquired (201):  ${successes.length}`);
  console.log(`  ✗ Conflict (409):  ${conflicts.length}`);
  console.log(`  ! Other errors:    ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nError details:');
    errors.forEach(e => console.log(`  Status ${e.status}:`, e.body));
  }

  // Verdict
  const passed = successes.length === 1 && conflicts.length === CONCURRENT_REQUESTS - 1;

  if (passed) {
    console.log('\n  ✅ PASS — Exactly 1 acquisition, 0 race conditions detected');
  } else if (successes.length > 1) {
    console.log(`\n  ❌ FAIL — Race condition detected! ${successes.length} requests acquired the lock simultaneously`);
  } else if (successes.length === 0) {
    console.log('\n  ⚠️  WARNING — No request succeeded. File may already be locked or token is invalid.');
  }

  // Release the lock so next run starts clean
  if (successes.length >= 1 && successes[0].body.lockToken) {
    const token = successes[0].body.lockToken;
    const releaseStatus = await releaseLock(token);
    console.log(`  Lock released (status ${releaseStatus})`);
  } else {
    console.log('  Could not release lock — check manually');
  }

  return {
    run: runNumber,
    successes: successes.length,
    conflicts: conflicts.length,
    errors: errors.length,
    duration,
    passed
  };
}

async function main() {
  console.log('CloudTeams — Soft Lock Concurrency Stress Test');
  console.log('================================================');
  console.log(`Target:     ${BASE_URL}`);
  console.log(`Team ID:    ${TEAM_ID}`);
  console.log(`File ID:    ${FILE_ID}`);
  console.log(`Requests:   ${CONCURRENT_REQUESTS} per run`);
  console.log(`Runs:       ${RUNS}`);

  const allResults = [];

  for (let i = 1; i <= RUNS; i++) {
    const result = await runTest(i);
    allResults.push(result);
    // Small pause between runs to let server settle
    if (i < RUNS) await new Promise(r => setTimeout(r, 1000));
  }

  // Final summary
  console.log('\n════════════════════════════════════════');
  console.log('FINAL SUMMARY');
  console.log('════════════════════════════════════════');

  const totalPassed = allResults.filter(r => r.passed).length;
  const avgDuration = Math.round(allResults.reduce((s, r) => s + r.duration, 0) / RUNS);

  allResults.forEach(r => {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`Run ${r.run}: ${status} | acquired=${r.successes} conflicts=${r.conflicts} errors=${r.errors} time=${r.duration}ms`);
  });

  console.log(`\nPassed: ${totalPassed}/${RUNS} runs`);
  console.log(`Average completion time: ${avgDuration}ms`);

  if (totalPassed === RUNS) {
    console.log('\n✅ ALL RUNS PASSED — Atomic lease model is race-condition free');
  } else {
    console.log(`\n❌ ${RUNS - totalPassed} runs failed — review server implementation`);
  }
}

main().catch(console.error);
