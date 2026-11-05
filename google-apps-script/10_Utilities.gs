/** Shared security, encoding and money helpers. */

const NOBI_PASSWORD_ITERATIONS = 120000;

function passwordHash_(password, salt) {
  const saltBytes = Utilities.newBlob(String(salt), 'text/plain').getBytes();
  const block = saltBytes.concat([0, 0, 0, 1]);
  let u = Utilities.computeHmacSha256Signature(block, String(password), Utilities.Charset.UTF_8);
  const derived = u.slice();
  for (let i = 1; i < NOBI_PASSWORD_ITERATIONS; i++) {
    u = Utilities.computeHmacSha256Signature(u, String(password), Utilities.Charset.UTF_8);
    for (let j = 0; j < derived.length; j++) derived[j] = derived[j] ^ u[j];
  }
  return Utilities.base64EncodeWebSafe(derived).replace(/=+$/g, '');
}

function passwordVerify_(password, salt, expectedHash, algorithm) {
  if (String(algorithm) !== 'PBKDF2-SHA256-120000') return false;
  const actual = passwordHash_(password, salt);
  const expected = String(expectedHash || '');
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function sha256_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function money_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function truth_(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function clean_(record) {
  const output = {};
  Object.keys(record).forEach(function(key) {
    if (key !== 'password_hash' && key !== 'password_salt' && key !== 'token_hash' &&
        key !== 'checkout_token_hash') {
      const value = record[key];
      output[key] = value instanceof Date ? value.toISOString() : value;
    }
  });
  return output;
}
