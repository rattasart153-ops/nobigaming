'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeRange {
  constructor(sheet,row,column,rowCount=1,columnCount=1) {
    Object.assign(this,{sheet,row,column,rowCount,columnCount});
  }
  getValues() {
    return Array.from({length:this.rowCount},(_,r)=>
      Array.from({length:this.columnCount},(_,c)=>
        this.sheet.rows[this.row+r-1]?.[this.column+c-1] ?? ''));
  }
  setValues(matrix) {
    matrix.forEach((values,r)=>{
      const index=this.row+r-1;
      while(this.sheet.rows.length<=index)this.sheet.rows.push([]);
      values.forEach((value,c)=>{this.sheet.rows[index][this.column+c-1]=value;});
    });
  }
  setValue(value){this.setValues([[value]]);}
}
class FakeSheet {
  constructor(name){this.name=name;this.rows=[];}
  getLastRow(){
    for(let i=this.rows.length-1;i>=0;i--){
      if(this.rows[i].some(v=>v!==''&&v!==null&&v!==undefined))return i+1;
    }
    return 0;
  }
  getLastColumn(){
    const row=this.rows[0]||[];let n=row.length;
    while(n&&(row[n-1]===''||row[n-1]==null))n--;
    return n;
  }
  getRange(r,c,nr,nc){return new FakeRange(this,r,c,nr,nc);}
  getDataRange(){return new FakeRange(this,1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));}
  appendRow(row){this.rows.push(row.slice());}
  setFrozenRows(){}
  deleteRow(index){this.rows.splice(index-1,1);}
}
class FakeSpreadsheet {
  constructor(){this.sheets=new Map();}
  getId(){return 'wallet-test-sheet';}
  getSheetByName(name){return this.sheets.get(name)||null;}
  insertSheet(name){
    if(this.sheets.has(name))throw new Error('Sheet already exists');
    const sheet=new FakeSheet(name);this.sheets.set(name,sheet);return sheet;
  }
}

function createRuntime() {
  const spreadsheet=new FakeSpreadsheet();
  const props={
    NOBI_SHEET_ID:spreadsheet.getId(),
    NOBI_WALLET_WRITES_ENABLED:'true',
    NOBI_FINANCIAL_WRITER_MODE:'API_ONLY',
    NOBI_LEGACY_WRITER_DISABLED:'true',
    NOBI_PROMPTPAY_ID:'0812345678',
    NOBI_PRIVATE_DRIVE_FOLDER_ID:'private-slips-folder'
  };
  let uuid=0;
  const files=new Map();
  const folder={
    getSharingAccess:()=> 'PRIVATE',
    getEditors:()=>[],
    getViewers:()=>[],
    createFile(blob){
      const id='drive-file-'+(++uuid);
      const file={
        id,name:blob.name,mimeType:blob.mimeType,bytes:blob.bytes,
        getId(){return id;},getName(){return this.name;},
        setSharing(){},setTrashed(){},
        getBlob(){return {getBytes:()=>this.bytes,getContentType:()=>this.mimeType};}
      };
      files.set(id,file);return file;
    }
  };
  const context={
    PropertiesService:{getScriptProperties:()=>({
      getProperty:key=>props[key]??null,
      setProperty:(key,value)=>{props[key]=String(value);},
      deleteProperty:key=>{delete props[key];}
    })},
    SpreadsheetApp:{openById:()=>spreadsheet,create:()=>spreadsheet},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    Utilities:{
      getUuid:()=> 'uuid-'+(++uuid),
      computeDigest:(alg,value)=>Array.from(crypto.createHash('sha256').update(String(value)).digest()),
      base64Decode:value=>Array.from(Buffer.from(value,'base64')),
      base64Encode:value=>Buffer.from(value).toString('base64'),
      newBlob:(bytes,mimeType,name)=>({bytes,mimeType,name}),
      Charset:{UTF_8:'UTF_8'},
      DigestAlgorithm:{SHA_256:'SHA_256'}
    },
    DriveApp:{
      Access:{PRIVATE:'PRIVATE'},
      Permission:{VIEW:'VIEW'},
      getFolderById:()=>folder,
      getFileById:id=>files.get(String(id))
    }
  };
  const source=fs.readFileSync(path.join(__dirname,'..','staging','api-only','Code.gs'),'utf8');
  vm.runInNewContext(source+`
    globalThis.__setup=setupNobiDatabase;
    globalThis.__insert=repositoryInsert_;
    globalThis.__get=repositoryGetById_;
    globalThis.__rows=repositoryRows_;
  `,context);
  context.__setup();
  const member={
    member_id:'member-001',full_name:'Synthetic Member',
    login_id_normalized:'synthetic1',login_id_display:'Synthetic1',
    status:'Active',auth_version:1
  };
  context.__insert('members',member);
  const admin={admin_id:'admin-001'};
  context.requireMemberLocked_=(token)=>{if(token!=='member-token')throw new Error('UNAUTHENTICATED');return member;};
  context.requireMember_=(token)=>{if(token!=='member-token')throw new Error('UNAUTHENTICATED');return member;};
  context.requireAdminLocked_=(token)=>{if(token!=='admin-token')throw new Error('UNAUTHENTICATED');return admin;};
  context.requireAdmin_=(token)=>{if(token!=='admin-token')throw new Error('UNAUTHENTICATED');return admin;};
  context.validImageSignature_=()=>true;
  context.assertDriveFolderPrivate_=()=>true;
  context.assertDriveFileInPrivateFolder_=()=>true;
  return {context,spreadsheet,files,props,member};
}

test('Member top-up request is idempotent, proof is private, and Admin approval posts exactly one Paid credit',()=>{
  const {context,spreadsheet,files}=createRuntime();
  const first=context.memberCreateWalletTopup('member-token',{
    requestKey:'member-topup-0001',amountSatang:5000,paymentMethod:'PROMPTPAY'
  });
  assert.equal(first.topup.status,'AWAITING_PROOF');
  const replay=context.memberCreateWalletTopup('member-token',{
    requestKey:'member-topup-0001',amountSatang:5000,paymentMethod:'PROMPTPAY'
  });
  assert.equal(replay.replayed,true);
  assert.equal(replay.topup.topupId,first.topup.topupId);
  assert.throws(()=>context.memberCreateWalletTopup('member-token',{
    requestKey:'member-topup-0001',amountSatang:6000,paymentMethod:'PROMPTPAY'
  }),/IDEMPOTENCY_CONFLICT/);

  const proof=context.memberSubmitWalletTopupProof('member-token',{
    topupId:first.topup.topupId,slip:{mimeType:'image/png',base64:Buffer.from('synthetic image bytes').toString('base64')}
  });
  assert.equal(proof.status,'PENDING_REVIEW');
  const topup=context.__get('wallet_topups',first.topup.topupId);
  assert.equal(topup.status,'PENDING_REVIEW');
  assert.ok(files.has(topup.slip_file_id));
  const memberList=context.memberWalletTopups('member-token',10);
  assert.equal(memberList.length,1);
  assert.equal(Object.hasOwn(memberList[0],'slip_file_id'),false);
  assert.equal(context.adminWalletTopups('admin-token','PENDING_REVIEW',10).length,1);
  const proofView=context.adminWalletTopupProof('admin-token',first.topup.topupId);
  assert.equal(proofView.mimeType,'image/png');

  const approved=context.adminApproveWalletTopup('admin-token',{
    topupId:first.topup.topupId,requestKey:'admin-approve-0001',
    confirmation:true,reason:'Synthetic payment checked'
  });
  assert.equal(approved.status,'APPROVED');
  assert.equal(context.__get('wallets','member-001').paid_balance_satang,5000);
  assert.equal(context.__rows('wallet_ledger').filter(x=>x.reference_id===first.topup.topupId).length,1);
  assert.equal(context.__rows('admin_audit_logs').filter(x=>x.target_id===first.topup.topupId && x.action==='WALLET_TOPUP_APPROVED').length,1);
  assert.equal(context.adminApproveWalletTopup('admin-token',{
    topupId:first.topup.topupId,requestKey:'admin-approve-0002',
    confirmation:true,reason:'Retry'
  }).alreadyApproved,true);
  assert.equal(context.__rows('wallet_ledger').filter(x=>x.reference_id===first.topup.topupId).length,1);
});

test('Admin rejection is journaled and never credits the wallet; awaiting-proof requests expire after 24 hours',()=>{
  const {context,spreadsheet}=createRuntime();
  const rejected=context.memberCreateWalletTopup('member-token',{
    requestKey:'member-topup-0002',amountSatang:5000,paymentMethod:'PROMPTPAY'
  });
  context.memberSubmitWalletTopupProof('member-token',{
    topupId:rejected.topup.topupId,slip:{mimeType:'image/jpeg',base64:Buffer.from('fake image').toString('base64')}
  });
  const result=context.adminRejectWalletTopup('admin-token',{
    topupId:rejected.topup.topupId,requestKey:'admin-reject-0001',reason:'Synthetic mismatch'
  });
  assert.equal(result.status,'REJECTED');
  assert.equal(context.__get('wallet_topups',rejected.topup.topupId).status,'REJECTED');
  assert.equal(context.__rows('wallet_ledger').length,0);
  assert.equal(context.__rows('admin_audit_logs').length,1);

  const expired=context.memberCreateWalletTopup('member-token',{
    requestKey:'member-topup-0003',amountSatang:5000,paymentMethod:'PROMPTPAY'
  });
  const old=new Date(Date.now()-25*60*60*1000).toISOString();
  const row=context.__get('wallet_topups',expired.topup.topupId);
  const sheet=context.__get('wallet_topups',expired.topup.topupId);
  assert.ok(row && sheet);
  const topups=context.__rows('wallet_topups');
  assert.equal(topups.find(x=>x.topup_id===expired.topup.topupId).status,'AWAITING_PROOF');
  const headers=spreadsheet.getSheetByName('wallet_topups').rows[0];
  const rowIndex=spreadsheet.getSheetByName('wallet_topups').rows.findIndex(x=>x[0]===expired.topup.topupId);
  spreadsheet.getSheetByName('wallet_topups').getRange(rowIndex+1,headers.indexOf('created_at')+1,1,1).setValue(old);
  const run=context.runWalletTopupExpiry();
  assert.equal(run.expired,1);
  assert.equal(context.__get('wallet_topups',expired.topup.topupId).status,'EXPIRED');
});

test('Admin direct Paid Credit and finite Bonus grants are separately ledgered and idempotent',()=>{
  const {context}=createRuntime();
  const paid=context.adminGrantPaidCredit('admin-token',{
    memberId:'member-001',requestKey:'admin-paid-000001',
    amountSatang:1200,reason:'Synthetic goodwill credit'
  });
  assert.equal(paid.amountSatang,1200);
  assert.equal(context.__get('wallets','member-001').paid_balance_satang,1200);
  const replay=context.adminGrantPaidCredit('admin-token',{
    memberId:'member-001',requestKey:'admin-paid-000001',
    amountSatang:1200,reason:'Synthetic goodwill credit'
  });
  assert.equal(replay.replayed,true);
  assert.equal(context.__rows('wallet_ledger').filter(x=>x.entry_type==='ADMIN_CREDIT').length,1);
  assert.throws(()=>context.adminGrantPaidCredit('admin-token',{
    memberId:'member-001',requestKey:'admin-paid-000001',
    amountSatang:1300,reason:'Synthetic goodwill credit'
  }),/WALLET_IDEMPOTENCY_CONFLICT/);

  const bonus=context.adminCreateBonusGrant('admin-token',{
    memberId:'member-001',requestKey:'admin-bonus-000001',
    amountSatang:2500,reason:'Synthetic promotion reward',
    sourceType:'PROMOTION',sourceId:'promo-test-1',durationDays:3
  });
  assert.equal(context.__get('wallets','member-001').bonus_balance_satang,2500);
  const grants=context.__rows('wallet_bonus_grants');
  assert.equal(grants.length,1);
  assert.equal(grants[0].remaining_satang,2500);
  assert.ok(Date.parse(grants[0].expires_at)>Date.now());
  assert.equal(context.__rows('wallet_ledger').filter(x=>x.entry_type==='BONUS_GRANT').length,1);
  const bonusReplay=context.adminCreateBonusGrant('admin-token',{
    memberId:'member-001',requestKey:'admin-bonus-000001',
    amountSatang:2500,reason:'Synthetic promotion reward',
    sourceType:'PROMOTION',sourceId:'promo-test-1',durationDays:3
  });
  assert.equal(bonusReplay.replayed,true);
  assert.equal(context.__rows('wallet_bonus_grants').length,1);
});
