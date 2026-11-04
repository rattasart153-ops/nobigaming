/** Nobi Topup Apps Script 10_Utilities module. */

function passwordHash_(password,salt) { return sha256_(String(salt)+'|'+String(password)); }

function sha256_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join(''); }

function money_(n) { return Math.round((Number(n)+Number.EPSILON)*100)/100; }

function truth_(v) { return v===true || v===1 || String(v).toLowerCase()==='true'; }

function clean_(r) { const out={}; Object.keys(r).forEach(k=>{if (k !== 'password_hash' && k !== 'password_salt' && k !== 'token_hash') { const v=r[k]; out[k]=v instanceof Date ? v.toISOString() : v; }}); return out; }
