const picomatch = require("picomatch");

const BANG = '!';
const negated = (str) => str.charAt(0) === BANG;

function isNegated(filters) {
  if (!filters.some(negated)) return false;
  if (filters.every(negated)) return true;

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
    const glob = picomatch(filter.trim());
    return entryInfo => glob(entryInfo.basename);
  }

  if (Array.isArray(filter)) {
    const trimedFilter = filter.map(f => f.trim());

    // use AND to concat multiple negated filters
    // use OR to concat multiple inclusive filters
    const filters = trimedFilter.map(f => picomatch(f));
    // const isMatch = f => f(entryInfo.basename)
    return isNegated(trimedFilter)
      ? entryInfo => filters.every(f => f(entryInfo.basename))
      : entryInfo => filters.some(f => f(entryInfo.basename));
  }
}

module.exports = normalizeFilter;
