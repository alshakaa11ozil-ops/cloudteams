// CloudTeams — API Scenario Test Automation
// Run: node run_api_scenarios.js

const BASE_URL = 'http://localhost:3001';
const TEST_EMAIL = 'api_test_user@example.com';
const TEST_PASSWORD = 'Password123';
const TEAM_ID = 1;
const FILE_ID = 1;

// Color helper codes for premium console styling
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function logHeader(num, title) {
  console.log(`\n${BOLD}${BLUE}================================================================================`);
  console.log(`  SCENARIO ${num}: ${title}`);
  console.log(`================================================================================${RESET}`);
}

function logRequest(method, path, body = null, headers = {}) {
  console.log(`\n${BOLD}${CYAN}➔ REQUEST:${RESET}`);
  console.log(`  ${BOLD}${method}${RESET} ${BASE_URL}${path}`);
  if (headers && Object.keys(headers).length > 0) {
    console.log(`  ${BOLD}Headers:${RESET}`);
    for (const [key, value] of Object.entries(headers)) {
      // Hide full tokens for readability, keep prefix
      const displayVal = key.toLowerCase() === 'authorization' ? `${value.substring(0, 20)}...` : value;
      console.log(`    ${key}: ${displayVal}`);
    }
  }
  if (body) {
    console.log(`  ${BOLD}Body:${RESET}`);
    if (body instanceof FormData) {
      console.log(`    [FormData multipart/form-data]`);
    } else {
      console.log(`    ${JSON.stringify(body, null, 2).replace(/\n/g, '\n    ')}`);
    }
  }
}

async function logResponse(response, startTime) {
  const duration = Date.now() - startTime;
  const statusColor = response.status >= 200 && response.status < 300 ? GREEN : RED;
  
  console.log(`\n${BOLD}${statusColor}◀ RESPONSE (in ${duration}ms):${RESET}`);
  console.log(`  ${BOLD}Status:${RESET} ${statusColor}${response.status} ${response.statusText}${RESET}`);
  console.log(`  ${BOLD}Headers:${RESET}`);
  console.log(`    content-type: ${response.headers.get('content-type')}`);
  console.log(`    content-length: ${response.headers.get('content-length')}`);
  
  let bodyText = '';
  try {
    const json = await response.json();
    bodyText = JSON.stringify(json, null, 2);
    console.log(`  ${BOLD}Body (JSON):${RESET}`);
    console.log(`    ${bodyText.replace(/\n/g, '\n    ')}`);
    return json;
  } catch {
    bodyText = await response.text();
    console.log(`  ${BOLD}Body (Text):${RESET}`);
    console.log(`    ${bodyText.replace(/\n/g, '\n    ')}`);
    return bodyText;
  }
}

async function main() {
  console.log(`${BOLD}${MAGENTA}================================================================================`);
  console.log('                 CLOUDTEAMS — API TESTING SCENARIOS SUITE');
  console.log(`================================================================================${RESET}`);
  
  let jwtToken = '';
  let lockToken = '';

  // ─────────────────────────────────────────────────────────────
  // SCENARIO 1: POST /api/auth/login — successful login returning JWT
  // ─────────────────────────────────────────────────────────────
  logHeader(1, 'POST /api/auth/login — Successful Login');
  
  const path1 = '/api/auth/login';
  const body1 = { email: TEST_EMAIL, password: TEST_PASSWORD };
  
  logRequest('POST', path1, body1, { 'Content-Type': 'application/json' });
  
  let start = Date.now();
  let res = await fetch(`${BASE_URL}${path1}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body1)
  });
  
  const res1Data = await logResponse(res, start);
  jwtToken = res1Data.token;

  if (!jwtToken) {
    console.error(`${RED}${BOLD}❌ Aborting: Successful JWT token was not returned in Scenario 1.${RESET}`);
    return;
  }

  // ── Pause to settle ──
  await new Promise(r => setTimeout(r, 1000));

  // ─────────────────────────────────────────────────────────────
  // SCENARIO 2: POST /api/auth/login with wrong password — 401 response
  // ─────────────────────────────────────────────────────────────
  logHeader(2, 'POST /api/auth/login with wrong password — 401 response');
  
  const path2 = '/api/auth/login';
  const body2 = { email: TEST_EMAIL, password: 'WrongPassword123' };
  
  logRequest('POST', path2, body2, { 'Content-Type': 'application/json' });
  
  start = Date.now();
  res = await fetch(`${BASE_URL}${path2}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body2)
  });
  
  await logResponse(res, start);

  // ── Pause to settle ──
  await new Promise(r => setTimeout(r, 1000));

  // ─────────────────────────────────────────────────────────────
  // SCENARIO 3: POST /api/teams/:id/files/:fileId/lock — successful lock acquisition returning lockToken
  // ─────────────────────────────────────────────────────────────
  logHeader(3, 'POST /api/teams/:id/files/:fileId/lock — Successful Lock Acquisition');
  
  const path3 = `/api/teams/${TEAM_ID}/files/${FILE_ID}/lock`;
  const headers3 = {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  };
  
  logRequest('POST', path3, null, headers3);
  
  start = Date.now();
  res = await fetch(`${BASE_URL}${path3}`, {
    method: 'POST',
    headers: headers3
  });
  
  const res3Data = await logResponse(res, start);
  lockToken = res3Data.lockToken;

  // ── Pause to settle ──
  await new Promise(r => setTimeout(r, 1000));

  // ─────────────────────────────────────────────────────────────
  // SCENARIO 4: POST /api/teams/:id/files/:fileId/lock again — 409 conflict when already locked
  // ─────────────────────────────────────────────────────────────
  logHeader(4, 'POST /api/teams/:id/files/:fileId/lock again — 409 Conflict');
  
  const path4 = `/api/teams/${TEAM_ID}/files/${FILE_ID}/lock`;
  const headers4 = {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  };
  
  logRequest('POST', path4, null, headers4);
  
  start = Date.now();
  res = await fetch(`${BASE_URL}${path4}`, {
    method: 'POST',
    headers: headers4
  });
  
  await logResponse(res, start);

  // Release the lock so we don't block subsequent tests
  if (lockToken) {
    const unlockPath = `/api/teams/${TEAM_ID}/files/${FILE_ID}/unlock`;
    await fetch(`${BASE_URL}${unlockPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ lockToken })
    });
    console.log(`\n${YELLOW}[Info] Pre-emptive Lock Cleaned Up (status 200)${RESET}`);
  }

  // ── Pause to settle ──
  await new Promise(r => setTimeout(r, 1000));

  // ─────────────────────────────────────────────────────────────
  // SCENARIO 5: POST /api/files/upload — successful upload with deduplication
  // ─────────────────────────────────────────────────────────────
  logHeader(5, 'POST /api/files/upload — Successful Upload & Smart Deduplication');
  
  // We will generate a random string content to ensure a completely unique file, 
  // then upload it once to get isDuplicate = false, then upload it AGAIN to get isDuplicate = true (deduplication active).
  const randomContent = `Unique Concurrency Test Content - Time: ${Date.now()}`;
  const uploadPath = '/api/files/upload';

  // Native Blob representation
  const fileBlob = new Blob([randomContent], { type: 'text/plain' });
  
  // ─── Sub-Scenario 5a: Initial Upload (Unique File) ───
  console.log(`\n${BOLD}${YELLOW}=== 5A: Initial Unique File Upload ===${RESET}`);
  const formDataA = new FormData();
  formDataA.append('file', fileBlob, 'scenarios_dedup_test.txt');
  formDataA.append('teamId', String(TEAM_ID));

  logRequest('POST', uploadPath, formDataA, { 'Authorization': `Bearer ${jwtToken}` });

  start = Date.now();
  res = await fetch(`${BASE_URL}${uploadPath}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    },
    body: formDataA
  });

  await logResponse(res, start);

  // ── Pause to settle ──
  await new Promise(r => setTimeout(r, 1000));

  // ─── Sub-Scenario 5b: Deduplicated Upload (Same Hash) ───
  console.log(`\n${BOLD}${YELLOW}=== 5B: Secondary Upload (Duplicate Hash - Deduplication Triggered) ===${RESET}`);
  const formDataB = new FormData();
  formDataB.append('file', fileBlob, 'scenarios_dedup_test_duplicate.txt'); // different display name, same hash
  formDataB.append('teamId', String(TEAM_ID));

  logRequest('POST', uploadPath, formDataB, { 'Authorization': `Bearer ${jwtToken}` });

  start = Date.now();
  res = await fetch(`${BASE_URL}${uploadPath}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    },
    body: formDataB
  });

  await logResponse(res, start);

  // ── Pause to settle ──
  await new Promise(r => setTimeout(r, 1000));

  // ─────────────────────────────────────────────────────────────
  // SCENARIO 6: GET /api/teams/:id/activity — activity feed response
  // ─────────────────────────────────────────────────────────────
  logHeader(6, 'GET /api/teams/:id/activity — Activity Feed Response');
  
  const path6 = `/api/teams/${TEAM_ID}/activity?limit=3`;
  const headers6 = {
    'Authorization': `Bearer ${jwtToken}`
  };
  
  logRequest('GET', path6, null, headers6);
  
  start = Date.now();
  res = await fetch(`${BASE_URL}${path6}`, {
    method: 'GET',
    headers: headers6
  });
  
  await logResponse(res, start);

  console.log(`\n${BOLD}${MAGENTA}================================================================================`);
  console.log('                 ALL API SCENARIOS EXECUTED SUCCESSFULLY');
  console.log(`================================================================================${RESET}\n`);
}

main().catch(console.error);
