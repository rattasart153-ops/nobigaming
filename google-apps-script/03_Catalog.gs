/** Nobi Topup Apps Script catalog queries backed by Schema v1. */

function publicCatalog() {
  const games = repositoryRows_('games').filter(function(row) {
    return truth_(row.active);
  }).sort(function(a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });

  const packages = repositoryRows_('packages').filter(function(row) {
    return truth_(row.active) && games.some(function(game) {
      return String(game.game_id) === String(row.game_id);
    });
  }).sort(function(a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });

  return {
    games: games.map(function(game) {
      return {
        id: game.game_id,
        name: game.name,
        category: game.category,
        description: game.description,
        active: truth_(game.active)
      };
    }),
    packages: packages.map(function(pack) {
      const game = games.find(function(item) {
        return String(item.game_id) === String(pack.game_id);
      });
      return {
        id: pack.package_id,
        game_id: pack.game_id,
        name: pack.name,
        amount: Number(pack.amount || 0),
        unit: pack.unit,
        price: Number(pack.price_satang || 0) / 100,
        image_url: catalogImageUrl_(pack.image_file_id, pack.image_url),
        popular: truth_(pack.popular),
        active: truth_(pack.active),
        game_name: game ? game.name : ''
      };
    })
  };
}

function publicPromotions() {
  const now = Date.now();
  return repositoryRows_('promotions').filter(function(row) {
    const starts = row.starts_at ? Date.parse(row.starts_at) : NaN;
    const ends = row.ends_at ? Date.parse(row.ends_at) : NaN;
    return truth_(row.active) &&
      (!row.starts_at || (Number.isFinite(starts) && starts <= now)) &&
      (!row.ends_at || (Number.isFinite(ends) && ends >= now));
  }).sort(function(a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  }).map(function(row) {
    return {
      id: row.promotion_id,
      title: row.title,
      subtitle: row.subtitle,
      image_url: catalogImageUrl_(row.image_file_id, row.image_url),
      link_url: row.link_url || '',
      active: truth_(row.active),
      starts_at: row.starts_at,
      ends_at: row.ends_at
    };
  });
}


function catalogImageUrl_(fileId, fallbackUrl) {
  if (fileId) return '/api/public/media/' + encodeURIComponent(String(fileId));
  const value = String(fallbackUrl || '').trim();
  if (/drive\.google\\.com|googleusercontent\.com/i.test(value)) return '';
  return value;
}
