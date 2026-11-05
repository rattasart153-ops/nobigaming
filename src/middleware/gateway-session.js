'use strict';

const ADMIN_COOKIE = 'nobi_admin_session';
const MEMBER_COOKIE = 'nobi_member_session';

function readCookie(req, name) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { return ''; }
    }
  }
  return '';
}

function cookieOptions(req, expiresAt) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || Boolean(req.secure),
    sameSite: 'strict',
    path: '/',
    expires: new Date(expiresAt)
  };
}

function createGatewaySession(client) {
  async function requireAdmin(req, res, next) {
    try {
      const token = readCookie(req, ADMIN_COOKIE);
      if (!token) {
        clearAdminCookie(res);
        return res.status(401).json({error:'กรุณาเข้าสู่ระบบผู้ดูแล'});
      }
      const result = await client.call('adminMe', {token});
      if (!result || !result.authenticated) {
        clearAdminCookie(res);
        return res.status(401).json({error:'เซสชันผู้ดูแลหมดอายุ'});
      }
      req.adminToken = token;
      return next();
    } catch (error) { return next(error); }
  }

  async function requireMember(req, res, next) {
    try {
      const token = readCookie(req, MEMBER_COOKIE);
      if (!token) {
        clearMemberCookie(res);
        return res.status(401).json({error:'กรุณาเข้าสู่ระบบสมาชิก'});
      }
      const result = await client.call('memberMe', {token});
      if (!result || !result.authenticated) {
        clearMemberCookie(res);
        return res.status(401).json({error:'เซสชันสมาชิกหมดอายุ'});
      }
      req.memberToken = token;
      req.member = result.member;
      return next();
    } catch (error) { return next(error); }
  }

  async function optionalMemberId(req) {
    const token = readCookie(req, MEMBER_COOKIE);
    if (!token) return '';
    try {
      const result = await client.call('memberMe', {token});
      return result && result.authenticated && result.member ? String(result.member.member_id || '') : '';
    } catch (_) { return ''; }
  }

  function setAdminCookie(req, res, token, expiresAt) {
    res.cookie(ADMIN_COOKIE, token, cookieOptions(req, expiresAt));
  }
  function setMemberCookie(req, res, token, expiresAt) {
    res.cookie(MEMBER_COOKIE, token, cookieOptions(req, expiresAt));
  }
  function clearAdminCookie(res) {
    res.clearCookie(ADMIN_COOKIE, {httpOnly:true, sameSite:'strict', secure:process.env.NODE_ENV === 'production', path:'/'});
  }
  function clearMemberCookie(res) {
    res.clearCookie(MEMBER_COOKIE, {httpOnly:true, sameSite:'strict', secure:process.env.NODE_ENV === 'production', path:'/'});
  }

  return Object.freeze({
    requireAdmin, requireMember, optionalMemberId,
    setAdminCookie, setMemberCookie, clearAdminCookie, clearMemberCookie
  });
}

module.exports = {createGatewaySession, readCookie, ADMIN_COOKIE, MEMBER_COOKIE};
