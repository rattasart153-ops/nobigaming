'use strict';

function createCatalogService(db) {
  return function getCatalog() {
    const games = db.prepare('SELECT * FROM games WHERE active=1 ORDER BY name').all();
    const packages = db.prepare(`SELECT p.*, g.name AS game_name FROM packages p JOIN games g ON g.id=p.game_id WHERE p.active=1 AND g.active=1 ORDER BY p.popular DESC, p.price ASC`).all();
    return { games, packages };
  };
}

module.exports = createCatalogService;
