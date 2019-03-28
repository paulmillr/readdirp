const { isMatch } = require("micromatch");

function negated(f) {
  return f[0] === "!";
}

function isNegated(filters) {
  if (!filters.some(negated)) {
    return false;
  }
  if (filters.every(negated)) {
    return true;
  }

  // if we detect illegal filters, bail out immediately
  throw new Error(
    "Cannot mix negated with non negated glob filters: " +
      filters +
      "\n" +
      "https://github.com/paulmillr/readdirp#filters"
  );
}

function normalizeFilter(filter) {
  if (filter === undefined) {
    return;
  }

  // Turn all filters into a function
  if (typeof filter === "function") {
    return filter;
  }

  if (typeof filter === "string") {
    return entryInfo => isMatch(entryInfo.name, filter.trim());
  }

  if (Array.isArray(filter)) {
    const trimedFilter = filter.map(f => f.trim());

    return isNegated(trimedFilter)
      ? // use AND to concat multiple negated filters
        entryInfo => trimedFilter.every(f => isMatch(entryInfo.name, f))
      : // use OR to concat multiple inclusive filters
        entryInfo => trimedFilter.some(f => isMatch(entryInfo.name, f));
  }
}

module.exports = normalizeFilter;
