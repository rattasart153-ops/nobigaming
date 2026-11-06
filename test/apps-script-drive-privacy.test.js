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
