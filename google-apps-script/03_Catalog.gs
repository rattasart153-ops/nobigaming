/** Nobi Topup Apps Script 03_Catalog module. */

function publicCatalog() {
  const games = rows_('games').filter(r => truth_(r.active));
  const packages = rows_('packages').filter(r => truth_(r.active));
  return { games: games.map(clean_), packages: packages.map(function(p) { const out=clean_(p); const g=games.find(x=>String(x.id)===String(p.game_id)); out.game_name=g?g.name:''; return out; }) };
}

function publicPromotions() {
  const now = Date.now();
  return rows_('promotions').filter(r => truth_(r.active) && (!r.starts_at || Date.parse(r.starts_at) <= now) && (!r.ends_at || Date.parse(r.ends_at) >= now)).sort((a,b) => Number(a.sort_order||0)-Number(b.sort_order||0)).map(clean_);
}
