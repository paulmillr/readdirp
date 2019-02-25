'use strict';
const {isMatch} = require('micromatch');

const isNegated = f => f.startsWith('!');
const concatFilters = filters => {
  if (!filters.some(isNegated)) {
    return ({name}) => {
      return filters.some(f => isMatch(name, f));
    };
  }

  if (filters.every(isNegated)) {
    return ({name}) => {
      return filters.every(f => isMatch(name, f));
    };
  }

  throw new Error(
    `Can't mix negated with non-negated glob filters: ${filters}\n` +
    'https://github.com/paulmillr/readdirp#filters'
  );
};

const normalizeFilter = filter => {
  if (typeof filter === 'function') return filter;
  if (typeof filter === 'string') {
    return ({name}) => isMatch(name, filter.trim());
  }

  if (Array.isArray(filter)) {
    return concatFilters(filter.map(f => f.trim()));
  }

  return () => true;
};

module.exports = normalizeFilter;
