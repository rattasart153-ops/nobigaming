/** Nobi Topup Apps Script 02_Database module. */

function setupNobiDatabase() {
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('NOBI_SHEET_ID');
  let ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.create('Nobi Topup Database');
  props.setProperty('NOBI_SHEET_ID', ss.getId());
  Object.keys(NOBI.SHEETS).forEach(function(name) {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = NOBI.SHEETS[name];
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    else { const existing = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String); const missing = headers.filter(h => !existing.includes(h)); if (missing.length) sh.getRange(1,sh.getLastColumn()+1,1,missing.length).setValues([missing]); }
    sh.setFrozenRows(1);
  });
  const folderId = props.getProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID');
  if (!folderId) {
    const folder = DriveApp.createFolder('Nobi Topup Private Files');
    props.setProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID', folder.getId());
  }
  return { spreadsheetId: ss.getId(), message: 'Database sheets and private file folder prepared. Keep the spreadsheet and folder private.' };
}

function sheet_(name) {
  const id=PropertiesService.getScriptProperties().getProperty('NOBI_SHEET_ID');
  if(!id) throw new Error('Run setupNobiDatabase first.');
  const sh=SpreadsheetApp.openById(id).getSheetByName(name);
  if(!sh) throw new Error('Missing sheet: '+name);
  return sh;
}

function rows_(name) {
  const sh=sheet_(name), values=sh.getDataRange().getValues();
  if(values.length<2) return [];
  const headers=values[0];
  return values.slice(1).filter(row=>row.some(v=>v!=='' && v!==null)).map(row=>{
    const o={}; headers.forEach((h,i)=>o[h]=row[i]); return o;
  });
}

function append_(name, record) {
  const sh=sheet_(name), headers=NOBI.SHEETS[name];
  sh.appendRow(headers.map(h=>record[h]===undefined ? '' : record[h]));
}

function deleteById_(name,id) {
  const sh=sheet_(name), values=sh.getDataRange().getValues(), headers=values[0], idIndex=headers.indexOf('id');
  for(let i=1;i<values.length;i++) if(String(values[i][idIndex])===String(id)) { sh.deleteRow(i+1); return true; }
  return false;
}

function updateById_(name,id,patch) {
  const sh=sheet_(name), values=sh.getDataRange().getValues(), headers=values[0], idIndex=headers.indexOf('id');
  for(let i=1;i<values.length;i++) if(String(values[i][idIndex])===String(id)) {
    Object.keys(patch).forEach(k=>{const col=headers.indexOf(k);if(col>=0)sh.getRange(i+1,col+1).setValue(patch[k]);});
    return true;
  }
  throw new Error('ไม่พบรายการที่ต้องการแก้ไข');
}
