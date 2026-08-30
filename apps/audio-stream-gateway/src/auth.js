const crypto = require('crypto');
const config = require('./config');

/**
 * Access codes select which R2 bucket a request reads and writes, so every data route has
 * to know who is asking. Verifying a code returns a signed token that the client sends on
 * each request; the token carries the tenant, so the code itself is transmitted once.
 *
 * Tokens are stateless on purpose - the gateway is restarted often enough (and by the
 * platform, not by us) that anything held in memory would log everyone out at random.
 */

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payload) {
  return base64url(
    crypto.createHmac('sha256', config.accessControl.tokenSecret).update(payload).digest()
  );
}

function equals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  // timingSafeEqual throws on a length mismatch, and comparing lengths first leaks only
  // the length - which for a hex signature is a constant anyway.
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function issueToken(tenant) {
  const expiresAt = Date.now() + config.accessControl.tokenTtlMs;
  const payload = base64url(Buffer.from(JSON.stringify({ t: tenant.id, exp: expiresAt })));
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token) {
    return null;
  }

  const separator = token.lastIndexOf('.');
  if (separator <= 0) {
    return null;
  }

  const payload = token.slice(0, separator);
  if (!equals(token.slice(separator + 1), sign(payload))) {
    return null;
  }

  let claims;
  try {
    claims = JSON.parse(fromBase64url(payload).toString('utf8'));
  } catch {
    return null;
  }

  if (!claims || typeof claims.exp !== 'number' || claims.exp <= Date.now()) {
    return null;
  }

  // A tenant removed from the configuration invalidates its outstanding tokens.
  return config.accessControl.tenantsById.get(claims.t) ?? null;
}

/**
 * Compares against every configured code without an early exit, so response time does not
 * reveal how far through the list a guess matched.
 */
function findTenantByCode(code) {
  let match = null;
  for (const [candidate, tenant] of config.accessControl.tenantsByCode) {
    if (equals(code, candidate)) {
      match = tenant;
    }
  }
  return match;
}

function readBearerToken(req) {
  const header = req.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return '';
  }
  return header.slice(7).trim();
}

function requireTenant(req, res, next) {
  if (!config.accessControl.enabled) {
    if (!config.defaultTenant) {
      return res.status(500).json({ message: 'No bucket configured' });
    }
    req.tenant = config.defaultTenant;
    return next();
  }

  const tenant = verifyToken(readBearerToken(req));
  if (!tenant) {
    return res.status(401).json({
      message: 'Access token missing or expired',
      code: 'ACCESS_TOKEN_INVALID',
    });
  }

  req.tenant = tenant;
  return next();
}

module.exports = {
  issueToken,
  verifyToken,
  findTenantByCode,
  requireTenant,
};
