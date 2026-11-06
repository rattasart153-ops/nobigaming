'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({
  DriveApp: {
    Access: { PRIVATE: 'PRIVATE' },
    getFolderById: id => ({
      getSharingAccess: () => id === 'shared-folder' ? 'ANYONE' : 'PRIVATE',
      getEditors: () => [],
      getViewers: () => []
    })
  }
});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', '08_Admin.gs'), 'utf8'),
  context,
  { filename: '08_Admin.gs' }
);

function driveFile(parentIds, sharingAccess = 'PRIVATE', shares = {}) {
  let index = 0;
  return {
    getSharingAccess: () => sharingAccess,
    getEditors: () => shares.editors || [],
    getViewers: () => shares.viewers || [],
    getParents() {
      return {
        hasNext: () => index < parentIds.length,
        next: () => ({ getId: () => parentIds[index++] })
      };
    }
  };
}

test('private Drive file validator accepts files only in the configured folder', () => {
  assert.equal(context.assertDriveFileInPrivateFolder_(driveFile(['private-folder']), 'private-folder'), true);
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(driveFile(['another-folder']), 'private-folder'),
    /DRIVE_FILE_OUTSIDE_PRIVATE_FOLDER/
  );
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(driveFile([]), 'private-folder'),
    /DRIVE_FILE_OUTSIDE_PRIVATE_FOLDER/
  );
});

test('private Drive validator rejects explicit file viewers and editors even when sharing access is PRIVATE', () => {
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(driveFile(['private-folder'], 'PRIVATE', {viewers:[{email:'viewer@example.test'}]}), 'private-folder'),
    /DRIVE_RESOURCE_HAS_EXPLICIT_SHARES/
  );
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(driveFile(['private-folder'], 'PRIVATE', {editors:[{email:'editor@example.test'}]}), 'private-folder'),
    /DRIVE_RESOURCE_HAS_EXPLICIT_SHARES/
  );
});

test('private Drive validator rejects explicit folder shares and unverifiable ACL metadata', () => {
  const sharedFolder = context.DriveApp.getFolderById;
  context.DriveApp.getFolderById = () => ({
    getSharingAccess:()=> 'PRIVATE',
    getEditors:()=>[],
    getViewers:()=>[{email:'viewer@example.test'}]
  });
  try {
    assert.throws(
      () => context.assertDriveFileInPrivateFolder_(driveFile(['private-folder']), 'private-folder'),
      /DRIVE_RESOURCE_HAS_EXPLICIT_SHARES/
    );
  } finally {
    context.DriveApp.getFolderById = sharedFolder;
  }
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_({
      getSharingAccess:()=> 'PRIVATE',
      getParents:()=>({hasNext:()=>false,next:()=>null})
    }, 'private-folder'),
    /DRIVE_ACL_UNVERIFIABLE/
  );
});

test('private Drive file validator fails closed for missing folder, shared folder or unsupported file object', () => {
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(driveFile(['private-folder']), ''),
    /DRIVE_FOLDER_INVALID/
  );
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_({}, 'private-folder'),
    /DRIVE_FOLDER_INVALID/
  );
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(driveFile(['shared-folder']), 'shared-folder'),
    /DRIVE_FOLDER_NOT_PRIVATE/
  );
});


test('private Drive file validator fails closed when file sharing metadata is unavailable', () => {
  const unsupported = {getSharingAccess:()=> 'PRIVATE',getParents: () => ({hasNext: () => false, next: () => null})};
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(unsupported, 'private-folder'),
    /DRIVE_ACL_UNVERIFIABLE/
  );
});

test('private Drive file validator rejects files shared beyond private access', () => {
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(driveFile(['private-folder'], 'ANYONE'), 'private-folder'),
    /DRIVE_FILE_NOT_PRIVATE/
  );
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(driveFile(['private-folder'], 'DOMAIN'), 'private-folder'),
    /DRIVE_FILE_NOT_PRIVATE/
  );
});


function makeAdminMediaHarness(options = {}) {
  const state = {
    folderAccess:options.folderAccess || 'PRIVATE',
    fileAccess:options.fileAccess || 'PRIVATE',
    folderEditors:options.folderEditors || [],
    folderViewers:options.folderViewers || [],
    fileEditors:options.fileEditors || [],
    fileViewers:options.fileViewers || [],
    parentId:options.parentId || 'media-folder',
    auditFailure:Boolean(options.auditFailure),
    files:[],
    createFailure:Boolean(options.createFailure),
    setSharingFailure:Boolean(options.setSharingFailure)
  };
  const context = vm.createContext({
    NOBI:{MAX_SLIP_BYTES:3*1024*1024},
    DriveApp:{
      Access:{PRIVATE:'PRIVATE'},
      Permission:{VIEW:'VIEW'},
      getFolderById:()=>({
        getSharingAccess:()=>state.folderAccess,
        getEditors:()=>state.folderEditors,
        getViewers:()=>state.folderViewers,
        createFile:blob=>{
          if(state.createFailure) throw new Error('SIMULATED_DRIVE_QUOTA');
          const file={
            id:'media-file-'+(state.files.length+1),
            blob,
            trashed:false,
            getId(){return this.id;},
            getSharingAccess:()=>state.fileAccess,
            getEditors:()=>state.fileEditors,
            getViewers:()=>state.fileViewers,
            getParents(){
              let consumed=false;
              return {hasNext:()=>!consumed,next:()=>{consumed=true;return {getId:()=>state.parentId};}};
            },
            setSharing(){if(state.setSharingFailure) throw new Error('SIMULATED_DRIVE_PERMISSION_QUOTA');},
            setTrashed(value){this.trashed=value;}
          };
          state.files.push(file);
          return file;
        }
      })
    },
    PropertiesService:{
      getScriptProperties:()=>({getProperty:key=>key==='NOBI_PRIVATE_MEDIA_FOLDER_ID'?'media-folder':''})
    },
    Utilities:{
      getUuid:()=>'media-uuid',
      base64Decode:value=>Array.from(Buffer.from(String(value),'base64')).map(x=>x>127?x-256:x),
      newBlob:(bytes,mimeType,name)=>({bytes,mimeType,name})
    },
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    requireAdmin_:()=>({admin_id:'admin-1'}),
    appendAdminAuditLogLocked_:()=>{
      if(state.auditFailure) throw new Error('SIMULATED_AUDIT_WRITE_FAILURE');
    }
  });
  for (const file of ['06_Orders.gs','08_Admin.gs']) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', file), 'utf8'),
      context,
      {filename:file}
    );
  }
  return {context,state};
}

test('Admin media upload keeps private files and returns the media reference after audit succeeds',()=>{
  const {context,state}=makeAdminMediaHarness();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  const result=context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:png.toString('base64')
  });
  assert.equal(result.ok,true);
  assert.equal(result.file_id,'media-file-1');
  assert.equal(state.files.length,1);
  assert.equal(state.files[0].trashed,false);
});

test('Admin media upload trashes the file when Drive ACL verification fails',()=>{
  const {context,state}=makeAdminMediaHarness({fileAccess:'ANYONE'});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:png.toString('base64')
  }),/DRIVE_FILE_NOT_PRIVATE/);
  assert.equal(state.files.length,1);
  assert.equal(state.files[0].trashed,true);
});

test('Admin media upload trashes the unreferenced file when audit logging fails',()=>{
  const {context,state}=makeAdminMediaHarness({auditFailure:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:png.toString('base64')
  }),/SIMULATED_AUDIT_WRITE_FAILURE/);
  assert.equal(state.files.length,1);
  assert.equal(state.files[0].trashed,true);
});

test('Admin media upload rejects a shared folder before creating a file',()=>{
  const {context,state}=makeAdminMediaHarness({folderAccess:'ANYONE'});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:png.toString('base64')
  }),/DRIVE_FOLDER_NOT_PRIVATE/);
  assert.equal(state.files.length,0);
});

test('Drive create quota failure fails closed without returning a media reference',()=>{
  const {context,state}=makeAdminMediaHarness({createFailure:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:png.toString('base64')
  }),/SIMULATED_DRIVE_QUOTA/);
  assert.equal(state.files.length,0);
});

test('Drive permission failure trashes the newly created unreferenced media file',()=>{
  const {context,state}=makeAdminMediaHarness({setSharingFailure:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:png.toString('base64')
  }),/SIMULATED_DRIVE_PERMISSION_QUOTA/);
  assert.equal(state.files.length,1);
  assert.equal(state.files[0].trashed,true);
});

test('private Drive file validator fails closed when folder sharing metadata is unavailable',()=>{
  const original = context.DriveApp.getFolderById;
  context.DriveApp.getFolderById = () => ({});
  try {
    assert.throws(
      () => context.assertDriveFileInPrivateFolder_(driveFile(['private-folder']), 'private-folder'),
      /DRIVE_ACL_UNVERIFIABLE/
    );
  } finally {
    context.DriveApp.getFolderById = original;
  }
});

test('Admin media upload rejects invalid Base64 image signatures before creating a Drive file',()=>{
  const {context,state}=makeAdminMediaHarness();
  const jpegBytes=Buffer.from([0xff,0xd8,0xff,0x00,0x01]);
  assert.throws(()=>context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:jpegBytes.toString('base64')
  }),/ไฟล์ภาพไม่ถูกต้องหรือมีขนาดเกิน 3 MB/);
  assert.equal(state.files.length,0,'invalid image bytes must never reach Drive');
});

test('Admin media upload rejects decoded payloads larger than 3 MiB before creating a Drive file',()=>{
  const {context,state}=makeAdminMediaHarness();
  const pngHeader=Buffer.from([137,80,78,71,13,10,26,10]);
  const oversized=Buffer.concat([pngHeader,Buffer.alloc(3*1024*1024)]);
  assert.throws(()=>context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:oversized.toString('base64')
  }),/ไฟล์ภาพไม่ถูกต้องหรือมีขนาดเกิน 3 MB/);
  assert.equal(state.files.length,0,'oversized decoded bytes must never reach Drive');
});

test('Admin media upload rejects a truncated PNG even when its signature is correct',()=>{
  const {context,state}=makeAdminMediaHarness();
  const truncated=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  assert.throws(()=>context.adminStoreMedia('admin-token',{
    mimeType:'image/png',base64:truncated.toString('base64')
  }),/ไฟล์ภาพไม่ถูกต้องหรือมีขนาดเกิน 3 MB/);
  assert.equal(state.files.length,0,'truncated image data must never reach Drive');
});

test('image container validation accepts structurally complete PNG, JPEG and WebP files',()=>{
  const {context}=makeAdminMediaHarness();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  const jpeg=Buffer.from([
    0xff,0xd8, 0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
    0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9
  ]);
  const webp=Buffer.from([
    0x52,0x49,0x46,0x46,0x10,0x00,0x00,0x00,0x57,0x45,0x42,0x50,
    0x56,0x50,0x38,0x20,0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x00
  ]);
  assert.equal(context.validImageSignature_(Array.from(png), 'image/png'),true);
  assert.equal(context.validImageSignature_(Array.from(jpeg), 'image/jpeg'),true);
  assert.equal(context.validImageSignature_(Array.from(webp), 'image/webp'),true);
});

test('image container validation rejects a PNG with a corrupted chunk CRC',()=>{
  const {context}=makeAdminMediaHarness();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  png[52]^=1;
  assert.equal(context.validImageSignature_(Array.from(png),'image/png'),false);
});


function makeAdminSlipHarness(options = {}) {
  const state = {driveReads:0,audits:[],auditFailure:Boolean(options.auditFailure),sessionRevoked:false,lockHeld:false,lockWaits:0,lockReleases:0};
  const bytes = Buffer.from('synthetic-private-slip');
  const file = {
    getName:()=> 'synthetic-slip.png',
    getBlob:()=>{
      if(options.revokeDuringDriveRead) state.sessionRevoked=true;
      return {getContentType:()=> 'image/png',getBytes:()=>Array.from(bytes)};
    },
    getSharingAccess:()=> options.fileAccess || 'PRIVATE',
    getEditors:()=> options.fileEditors || [],
    getViewers:()=> options.fileViewers || [],
    getParents:()=>{
      let consumed=false;
      return {hasNext:()=>!consumed,next:()=>{consumed=true;return {getId:()=>options.parentId || 'private-slip-folder'};}};
    }
  };
  const context=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='NOBI_PRIVATE_DRIVE_FOLDER_ID'?'private-slip-folder':''})},
    DriveApp:{
      Access:{PRIVATE:'PRIVATE'},
      getFolderById:()=>({
        getSharingAccess:()=>options.folderAccess || 'PRIVATE',
        getEditors:()=>options.folderEditors || [],
        getViewers:()=>options.folderViewers || []
      }),
      getFileById:()=>{state.driveReads++;return file;}
    },
    LockService:{getScriptLock:()=>({waitLock(){state.lockWaits++;if(options.lockTimeout)throw new Error('LOCK_TIMEOUT');assert.equal(state.lockHeld,false);state.lockHeld=true;},releaseLock(){assert.equal(state.lockHeld,true);state.lockHeld=false;state.lockReleases++;}})},
    Utilities:{base64Encode:value=>Buffer.from(value).toString('base64'),getUuid:()=>'audit-id'},
    repositoryGetById_:(table,id)=>table==='orders'&&id==='order-1'
      ? {order_id:'order-1',slip_file_id:'drive-slip-1'} : null,
    requireAdmin_:()=>{
      if(options.unauthorized) throw new Error('ADMIN_REQUIRED');
      return {admin_id:'admin-1'};
    },
    requireAdminLocked_:()=>{
      assert.equal(state.lockHeld,true,'final Admin session validation must run under ScriptLock');
      if(options.unauthorized || state.sessionRevoked) throw new Error('SESSION_REVOKED');
      return {admin_id:'admin-1'};
    },
    appendAdminAuditLogLocked_:entry=>{
      state.audits.push(entry);
      if(state.auditFailure) throw new Error('SIMULATED_AUDIT_FAILURE');
    }
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname,'..','google-apps-script','08_Admin.gs'),'utf8'),
    context,
    {filename:'08_Admin.gs'}
  );
  return {context,state,bytes};
}

test('Admin slip retrieval requires an authenticated Admin before reading Drive',()=>{
  const {context,state}=makeAdminSlipHarness({unauthorized:true});
  assert.throws(()=>context.adminSlipData('invalid-token','order-1'),/ADMIN_REQUIRED/);
  assert.equal(state.driveReads,0);
  assert.equal(state.audits.length,0);
});

test('Admin slip retrieval returns bytes only after private-folder validation and audit logging',()=>{
  const {context,state,bytes}=makeAdminSlipHarness();
  const result=context.adminSlipData('admin-token','order-1');
  assert.equal(result.name,'synthetic-slip.png');
  assert.equal(result.mimeType,'image/png');
  assert.equal(result.base64,bytes.toString('base64'));
  assert.equal(state.driveReads,1);
  assert.equal(state.audits.length,1);
  assert.equal(state.audits[0].action,'VIEW_ORDER_SLIP');
  assert.equal(state.audits[0].target_id,'order-1');
  assert.equal(state.audits[0].ip_address,'');
});

test('Admin slip retrieval fails closed for a shared file or shared parent folder',()=>{
  const sharedFile=makeAdminSlipHarness({fileAccess:'ANYONE'});
  assert.throws(()=>sharedFile.context.adminSlipData('admin-token','order-1'),/DRIVE_FILE_NOT_PRIVATE/);

  const sharedFolder=makeAdminSlipHarness({folderAccess:'ANYONE'});
  assert.throws(()=>sharedFolder.context.adminSlipData('admin-token','order-1'),/DRIVE_FOLDER_NOT_PRIVATE/);
});

test('Admin slip bytes are not returned when the required audit write fails',()=>{
  const {context,state}=makeAdminSlipHarness({auditFailure:true});
  assert.throws(()=>context.adminSlipData('admin-token','order-1'),/SIMULATED_AUDIT_FAILURE/);
  assert.equal(state.audits.length,1);
});


test('Admin slip response is denied if the session is revoked while Drive is being read',()=>{
  const {context,state}=makeAdminSlipHarness({revokeDuringDriveRead:true});
  assert.throws(()=>context.adminSlipData('admin-token','order-1'),/SESSION_REVOKED/);
  assert.equal(state.driveReads,1,'the race is simulated after the Drive read begins');
  assert.equal(state.audits.length,0,'revoked session must not create a successful view audit');
  assert.equal(state.lockHeld,false,'ScriptLock must be released after rejection');
  assert.equal(state.lockWaits,1);
  assert.equal(state.lockReleases,1);
});

test('Admin slip response fails closed when final authorization lock cannot be acquired',()=>{
  const {context,state}=makeAdminSlipHarness({lockTimeout:true});
  assert.throws(()=>context.adminSlipData('admin-token','order-1'),/LOCK_TIMEOUT/);
  assert.equal(state.driveReads,1);
  assert.equal(state.audits.length,0);
  assert.equal(state.lockReleases,0,'a lock that was not acquired must not be released');
});
