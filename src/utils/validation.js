'use strict';

const bool = value => value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
const validDate = value => !value || !Number.isNaN(Date.parse(value));

module.exports = { bool, validDate };
