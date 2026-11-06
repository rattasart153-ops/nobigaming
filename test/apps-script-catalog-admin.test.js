'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeCatalogAdminContext(seed = {}) {
  const data = Object.assign({
    games: [],
    packages: [],
    promotions: [],
    coupons: [],
    orders: [],
    coupon_redemptions: []
  }, seed);
  const audits = [];
  const deleted = [];
  const updated = [];
  const inserted = [];
  const mediaChecks = [];
  const context = {
    NOBI: {
      SHEETS: {
        games:['game_id','name','category','description','active','sort_order','created_at','updated_at'],
        packages:['package_id','game_id','name','amount','unit','price_satang','image_file_id','image_url','popular','active','sort_order','created_at','updated_at'],
        coupons:['coupon_id','code_normalized','code_display','discount_type','discount_value','min_order_satang','game_id','access_type','member_spend_game_id','member_min_game_spend_satang','expires_at','usage_limit','active','allowed_player_ids_json','min_player_spend_satang','created_at','updated_at'],
        promotions:['promotion_id','title','subtitle','image_file_id','image_url','link_url','active','sort_order','starts_at','ends_at','created_at','updated_at']
      }
    },
    Date,
    URL,
    Utilities:{getUuid:()=> 'generated-id-' + (inserted.length + 1)},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='NOBI_PRIVATE_MEDIA_FOLDER_ID'?'private-media-folder':''})},
    DriveApp:{
      Access:{PRIVATE:'PRIVATE'},
      Permission:{VIEW:'VIEW'},
      getFileById:id=>{
        mediaChecks.push({fileId:id,folderId:'private-media-folder'});
        return {
          id,
          getSharingAccess:()=> 'PRIVATE',
          getParents:()=>{
            let consumed=false;
            return {hasNext:()=>!consumed,next:()=>{consumed=true;return {getId:()=> 'private-media-folder'};}};
          }
        };
      },
      getFolderById:()=>({getSharingAccess:()=> 'PRIVATE'})
    },
    requireAdmin_:token=>{assert.equal(token,'valid-admin-token');return {admin_id:'admin-1'};},
    truth_:value=>value===true||value===1||String(value).toLowerCase()==='true',
    clean_:value=>JSON.parse(JSON.stringify(value)),
    repositoryRows_:table=>data[table]||[],
    repositoryGetById_:(table,id)=>{
      const key=context.NOBI.SHEETS[table][0];
      return (data[table]||[]).find(row=>String(row[key])===String(id))||null;
    },
    repositoryFindByField_:(table,field,value)=>(data[table]||[]).filter(row=>String(row[field]??'')===String(value??'')),
    repositoryUpdateLocked_:(table,id,patch)=>{
      const row=context.repositoryGetById_(table,id);
      if(!row)throw new Error('REPOSITORY_NOT_FOUND');
      Object.assign(row,patch);
      updated.push({table,id,patch:{...patch}});
      return row;
    },
    repositoryInsertLocked_:(table,record)=>{
      data[table].push({...record});
      inserted.push({table,record:{...record}});
      return record;
    },
    repositoryDeleteLocked_:(table,id)=>{
      const key=context.NOBI.SHEETS[table][0];
      const index=(data[table]||[]).findIndex(row=>String(row[key])===String(id));
      if(index<0)return false;
      data[table].splice(index,1);
      deleted.push({table,id});
      return true;
    },
    repositorySheet_:()=>{throw new Error('ADMIN CRUD MUST NOT BYPASS REPOSITORY');},
    appendAdminAuditLogLocked_:record=>audits.push({...record}),
  };
  vm.createContext(context);
  const gasDir=path.join(__dirname,'..','google-apps-script');
  for(const file of ['03_Catalog.gs','09_Validation.gs','08_Admin.gs']) {
    vm.runInContext(fs.readFileSync(path.join(gasDir,file),'utf8'),context,{filename:file});
  }
  return {context,data,audits,deleted,updated,inserted,mediaChecks};
}

test('public catalog filters inactive and orphaned records, sorts, maps satang and private media refs',()=>{
  const {context}=makeCatalogAdminContext({
    games:[
      {game_id:'g2',name:'Game 2',category:'rpg',description:'Second',active:true,sort_order:2},
      {game_id:'g1',name:'Game 1',category:'moba',description:'First',active:true,sort_order:1},
      {game_id:'g3',name:'Inactive',category:'fps',description:'Hidden',active:false,sort_order:0}
    ],
    packages:[
      {package_id:'p2',game_id:'g1',name:'Second pack',amount:200,unit:'Diamonds',price_satang:2500,image_file_id:'drive-id-1234567890',image_url:'',popular:false,active:true,sort_order:2},
      {package_id:'p1',game_id:'g1',name:'First pack',amount:100,unit:'Diamonds',price_satang:1500,image_file_id:'',image_url:'',popular:true,active:true,sort_order:1},
      {package_id:'p3',game_id:'g3',name:'Inactive game pack',amount:1,unit:'x',price_satang:100,active:true,sort_order:0},
      {package_id:'p4',game_id:'g2',name:'Inactive pack',amount:1,unit:'x',price_satang:100,active:false,sort_order:0}
    ]
  });
  const result=context.publicCatalog();
  assert.deepEqual(Array.from(result.games,x=>x.id),['g1','g2']);
  assert.deepEqual(Array.from(result.packages,x=>x.id),['p1','p2']);
  assert.equal(result.packages[0].price,15);
  assert.equal(result.packages[1].price,25);
  assert.equal(result.packages[1].game_name,'Game 1');
  assert.equal(result.packages[1].image_url,'/api/public/media/drive-id-1234567890');
});

test('public promotions applies active window and stable sort order',()=>{
  const {context}=makeCatalogAdminContext({promotions:[
    {promotion_id:'later',title:'Later',active:true,sort_order:2,starts_at:'2026-11-01T00:00:00.000Z',ends_at:'2026-12-01T00:00:00.000Z'},
    {promotion_id:'first',title:'First',active:true,sort_order:1,starts_at:'2026-11-01T00:00:00.000Z',ends_at:'2026-12-01T00:00:00.000Z'},
    {promotion_id:'inactive',title:'Inactive',active:false,sort_order:0},
    {promotion_id:'expired',title:'Expired',active:true,sort_order:0,ends_at:'2020-01-01T00:00:00.000Z'}
  ]});
  const result=context.publicPromotions();
  assert.deepEqual(Array.from(result,x=>x.id),['first','later']);
});

test('Admin partial package update validates merged record and preserves existing private image',()=>{
  const existing={package_id:'p1',game_id:'g1',name:'Old pack',amount:100,unit:'Diamonds',price_satang:1500,
    image_file_id:'drive-file-1234567890',image_url:'/api/public/media/drive-file-1234567890',
    popular:false,active:true,sort_order:1,created_at:'2026-11-01T00:00:00.000Z',updated_at:'2026-11-01T00:00:00.000Z'};
  const {context,data,updated,mediaChecks,audits}=makeCatalogAdminContext({
    games:[{game_id:'g1',name:'RoV',category:'moba',active:true}],
    packages:[existing]
  });
  const result=context.adminUpsert('valid-admin-token','packages',{package_id:'p1',name:'Renamed pack'});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{ok:true,id:'p1'});
  assert.equal(data.packages[0].name,'Renamed pack');
  assert.equal(data.packages[0].game_id,'g1');
  assert.equal(data.packages[0].image_file_id,'drive-file-1234567890');
  assert.equal(updated[0].patch.image_file_id,undefined,'omitted image_url must not clear existing private media');
  assert.deepEqual(mediaChecks,[{fileId:'drive-file-1234567890',folderId:'private-media-folder'}]);
  assert.equal(audits.length,1);
});

test('Admin package create returns the generated primary key and persists schema fields',()=>{
  const {context,data,inserted}=makeCatalogAdminContext({
    games:[{game_id:'g1',name:'RoV',category:'moba',active:true}]
  });
  const result=context.adminUpsert('valid-admin-token','packages',{
    game_id:'g1',name:'New pack',amount:100,unit:'Diamonds',price_satang:1500,active:true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{ok:true,id:'generated-id-1'});
  assert.equal(data.packages[0].package_id,'generated-id-1');
  assert.equal(inserted[0].table,'packages');
});

test('Admin delete delegates row mutation to repository while holding the lock',()=>{
  const {context,data,deleted,audits}=makeCatalogAdminContext({
    packages:[{package_id:'p1',game_id:'g1',name:'Pack',amount:1,unit:'x',price_satang:100}]
  });
  const result=context.adminDelete('valid-admin-token','packages','p1');
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{ok:true});
  assert.equal(data.packages.length,0);
  assert.deepEqual(deleted,[{table:'packages',id:'p1'}]);
  assert.equal(audits.length,1);
});
