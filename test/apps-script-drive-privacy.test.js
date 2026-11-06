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
      getSharingAccess: () => id === 'shared-folder' ? 'ANYONE' : 'PRIVATE'
    })
  }
});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', '08_Admin.gs'), 'utf8'),
  context,
  { filename: '08_Admin.gs' }
);

function driveFile(parentIds, sharingAccess = 'PRIVATE') {
  let index = 0;
  return {
    getSharingAccess: () => sharingAccess,
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
  const unsupported = {getParents: () => ({hasNext: () => false, next: () => null})};
  assert.throws(
    () => context.assertDriveFileInPrivateFolder_(unsupported, 'private-folder'),
    /DRIVE_FOLDER_INVALID/
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
    parentId:options.parentId || 'media-folder',
    auditFailure:Boolean(options.auditFailure),
    files:[]
  };
  const context = vm.createContext({
    NOBI:{MAX_SLIP_BYTES:3*1024*1024},
    DriveApp:{
      Access:{PRIVATE:'PRIVATE'},
      Permission:{VIEW:'VIEW'},
      getFolderById:()=>({
        getSharingAccess:()=>state.folderAccess,
        createFile:blob=>{
          const file={
            id:'media-file-'+(state.files.length+1),
            blob,
            trashed:false,
            getId(){return this.id;},
            getSharingAccess:()=>state.fileAccess,
            getParents(){
              let consumed=false;
              return {hasNext:()=>!consumed,next:()=>{consumed=true;return {getId:()=>state.parentId};}};
            },
            setSharing(){},
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

test('private Drive file validator fails closed when folder sharing metadata is unavailable',()=>{
  const original = context.DriveApp.getFolderById;
  context.DriveApp.getFolderById = () => ({});
  try {
    assert.throws(
      () => context.assertDriveFileInPrivateFolder_(driveFile(['private-folder']), 'private-folder'),
      /DRIVE_FOLDER_INVALID/
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
