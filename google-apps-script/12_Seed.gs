/** Idempotent initial catalog seed, preserving any existing custom package catalog. */

const NOBI_DEFAULT_GAMES = [
  ['RoV','moba','Arena of Valor'],
  ['Free Fire','br','เพชร Free Fire'],
  ['Genshin Impact','rpg','Genesis Crystal'],
  ['PUBG Mobile','br','UC'],
  ['Mobile Legends','moba','Diamonds'],
  ['Valorant','fps','VP'],
  ['Honkai: Star Rail','rpg','Oneiric Shard'],
  ['Call of Duty: Mobile','fps','CP'],
  ['Roblox','sandbox','Robux']
];

const NOBI_DEFAULT_PACKAGES = {
  'RoV':['คูปอง',[[90,15],[250,39],[500,75],[1100,159],[2200,299],[5500,699]]],
  'Free Fire':['เพชร',[[110,19],[341,59],[572,99],[1060,139],[2200,279],[5600,699]]],
  'Genshin Impact':['Genesis Crystal',[[60,35],[330,169],[1090,559],[2240,1190],[3880,1890],[8080,3590]]],
  'PUBG Mobile':['UC',[[60,25],[325,129],[660,259],[1800,679],[3850,1390],[8100,2790]]],
  'Mobile Legends':['Diamonds',[[86,20],[172,39],[257,59],[706,159],[2195,479],[4390,949]]],
  'Valorant':['VP',[[125,45],[420,149],[700,249],[1375,479],[2400,829],[4000,1350]]],
  'Honkai: Star Rail':['Oneiric Shard',[[60,39],[330,179],[1090,579],[2240,1250],[3880,1990],[8080,3790]]],
  'Call of Duty: Mobile':['CP',[[80,25],[420,129],[880,259],[2400,679],[5000,1390],[10000,2690]]],
  'Roblox':['Robux',[[80,29],[400,139],[800,269],[1700,559],[4500,1390],[10000,2990]]]
};

/**
 * Run manually after setupNobiDatabase() in a fresh/test spreadsheet.
 * Existing games are preserved; package seeds are added only when the package
 * table was empty at the first invocation. An IN_PROGRESS marker permits safe
 * resumption if Apps Script stops partway through the 54 package inserts.
 */
function seedDefaultCatalog() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now = new Date().toISOString();
    let gamesAdded = 0;
    const gameIds = {};

    NOBI_DEFAULT_GAMES.forEach(function(seed, index) {
      let game = repositoryFindByField_('games', 'name', seed[0])[0];
      if (!game) {
        game = repositoryInsertLocked_('games', {
          game_id:Utilities.getUuid(),
          name:seed[0],
          category:seed[1],
          description:seed[2],
          active:true,
          sort_order:index + 1,
          created_at:now,
          updated_at:now
        });
        gamesAdded++;
      }
      gameIds[seed[0]] = game.game_id;
    });

    let marker = repositoryFindByField_('system_metadata', 'key', 'default_catalog_seed_v1')[0];
    if (marker && marker.value !== 'IN_PROGRESS') {
      return {ok:true, alreadySeeded:true, gamesAdded:gamesAdded, packagesAdded:0, status:marker.value};
    }

    if (!marker) {
      if (repositoryRows_('packages').length) {
        repositoryInsertLocked_('system_metadata', {
          key:'default_catalog_seed_v1',
          value:'SKIPPED_EXISTING_PACKAGES',
          updated_at:now
        });
        return {ok:true, alreadySeeded:false, gamesAdded:gamesAdded, packagesAdded:0, status:'SKIPPED_EXISTING_PACKAGES'};
      }
      marker = repositoryInsertLocked_('system_metadata', {
        key:'default_catalog_seed_v1',
        value:'IN_PROGRESS',
        updated_at:now
      });
    }

    let packagesAdded = 0;
    Object.keys(NOBI_DEFAULT_PACKAGES).forEach(function(gameName) {
      const gameId = gameIds[gameName];
      if (!gameId) throw new Error('DEFAULT_GAME_MISSING: ' + gameName);
      const definition = NOBI_DEFAULT_PACKAGES[gameName];
      const unit = definition[0];
      const packages = definition[1];
      packages.forEach(function(item, index) {
        const amount = item[0];
        const priceBaht = item[1];
        const name = amount.toLocaleString('en-US') + ' ' + unit;
        const exists = repositoryFindByField_('packages', 'game_id', gameId)
          .some(function(pack) { return String(pack.name) === name; });
        if (exists) return;
        repositoryInsertLocked_('packages', {
          package_id:Utilities.getUuid(),
          game_id:gameId,
          name:name,
          amount:amount,
          unit:unit,
          price_satang:priceBaht * 100,
          image_file_id:'',
          image_url:'',
          popular:index === packages.length - 2,
          active:true,
          sort_order:index + 1,
          created_at:now,
          updated_at:now
        });
        packagesAdded++;
      });
    });

    repositoryUpdateLocked_('system_metadata', marker.key, {
      value:'COMPLETE',
      updated_at:new Date().toISOString()
    });
    return {ok:true, alreadySeeded:false, gamesAdded:gamesAdded, packagesAdded:packagesAdded, status:'COMPLETE'};
  } finally {
    lock.releaseLock();
  }
}
